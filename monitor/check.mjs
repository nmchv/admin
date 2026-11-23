#!/usr/bin/env node
/**
 * nmchv monitor — серверная проверка доступности сервисов и Supabase.
 * Запускается по расписанию в GitHub Actions (.github/workflows/monitor.yml). Без зависимостей, Node 18+.
 *
 * Переменные окружения:
 *   SUPABASE_URL        — https://<ref>.supabase.co
 *   SUPABASE_ANON_KEY   — публичный anon-ключ
 *   MONITOR_TOKEN       — токен из Settings → Services → «Выпустить токен» (хранится только как secret)
 *   FORCE=1             — игнорировать настроенный интервал и проверить всё сейчас
 *   DRY_RUN=1           — проверить, но не записывать результаты
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const TOKEN = process.env.MONITOR_TOKEN || '';
const FORCE = process.env.FORCE === '1' || process.env.FORCE === 'true';
const DRY_RUN = process.env.DRY_RUN === '1';

if (!SUPABASE_URL || !ANON_KEY || !TOKEN) {
  console.error('Не заданы SUPABASE_URL, SUPABASE_ANON_KEY или MONITOR_TOKEN.');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function errorType(err) {
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return 'timeout';
  const code = err?.cause?.code || err?.code || '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  if (/CERT|TLS|SSL|UNABLE_TO_VERIFY|DEPTH_ZERO|SELF_SIGNED/i.test(code)) return 'tls';
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_SOCKET'].includes(code)) return 'connection';
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return 'timeout';
  return 'other';
}

/** Один HTTP-запрос. Возвращает {ok, status, ms, errorType, message}. Тело ответа не читается. */
async function probe(url, headers, timeoutMs) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'nmchv-monitor/1.0', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Math.round(performance.now() - t0);
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return { ok: res.status < 400, status: res.status, ms };
  } catch (e) {
    return { ok: false, status: null, ms: Math.round(performance.now() - t0), errorType: errorType(e), message: e?.cause?.code || e?.message || 'error' };
  }
}

/** Повторяет неудачный запрос один раз через 2 с, чтобы не поднимать тревогу из-за разовой ошибки. */
async function probeWithRetry(url, headers, timeoutMs) {
  const first = await probe(url, headers, timeoutMs);
  if (first.ok) return first;
  await sleep(Number(process.env.RETRY_DELAY_MS ?? 2000));
  const second = await probe(url, headers, timeoutMs);
  return second.ok ? second : { ...second, retried: true };
}

function classify(p, slowMs) {
  if (!p.ok) {
    return {
      status: 'unavailable',
      http_status: p.status,
      error_type: p.status == null ? p.errorType : p.status >= 500 ? 'http_5xx' : 'http_4xx',
      error_message: p.status == null ? `нет ответа: ${p.message}` : `HTTP ${p.status}`,
    };
  }
  if (p.ms > slowMs) {
    return { status: 'degraded', http_status: p.status, error_type: 'slow', error_message: `медленный ответ: ${p.ms} мс (порог ${slowMs} мс)` };
  }
  return { status: 'operational', http_status: p.status, error_type: null, error_message: null };
}

const RANK = { operational: 0, degraded: 1, unavailable: 2 };

async function checkService(svc, cfg) {
  const base = new URL(svc.url);
  const paths = Array.isArray(svc.paths) && svc.paths.length ? svc.paths : ['/'];
  const results = [];
  for (const path of paths) {
    const url = new URL(path, base).toString();
    const p = await probeWithRetry(url, {}, cfg.timeout_ms);
    const c = classify(p, cfg.slow_ms);
    results.push({ path, p, c });
  }
  // итог — худший статус; время ответа — по первому (основному) пути
  const worst = results.reduce((a, b) => (RANK[b.c.status] > RANK[a.c.status] ? b : a));
  const failing = results.filter((r) => r.c.status !== 'operational');
  return {
    slug: svc.slug,
    status: worst.c.status,
    response_time: results[0].p.ms,
    http_status: worst.c.http_status,
    error_type: worst.c.error_type,
    error_message: failing.length
      ? failing.map((r) => `${r.path}: ${r.c.error_message}`).join('; ').slice(0, 500)
      : null,
  };
}

async function checkInfra(dbMs, dbOk, dbError, slowMs, timeoutMs) {
  const out = [{
    component: 'database',
    status: dbOk ? (dbMs > slowMs ? 'degraded' : 'operational') : 'unavailable',
    response_time: dbMs,
    error_message: dbOk ? (dbMs > slowMs ? `медленный ответ: ${dbMs} мс` : null) : dbError,
  }];
  const targets = [
    ['api', `${SUPABASE_URL}/rest/v1/`],
    ['auth', `${SUPABASE_URL}/auth/v1/health`],
  ];
  for (const [component, url] of targets) {
    const p = await probeWithRetry(url, { apikey: ANON_KEY }, timeoutMs);
    // Для REST корня 200 означает «API отвечает». Любой статус < 500 тоже доказывает, что шлюз жив.
    const alive = p.status != null && p.status < 500;
    out.push({
      component,
      status: !alive ? 'unavailable' : p.ms > slowMs ? 'degraded' : 'operational',
      response_time: p.ms,
      error_message: !alive ? (p.status == null ? `нет ответа: ${p.message}` : `HTTP ${p.status}`) : p.ms > slowMs ? `медленный ответ: ${p.ms} мс` : null,
    });
  }
  return out;
}

async function main() {
  const t0 = performance.now();
  let targets;
  let dbOk = true;
  let dbError = null;
  try {
    targets = await rpc('cc_monitor_targets', { p_token: TOKEN });
  } catch (e) {
    // Если не отвечает БД, записать результат всё равно невозможно — это видно в панели по устаревшей «последней проверке».
    console.error('Не удалось получить список сервисов:', e.message);
    process.exit(1);
  }
  const dbMs = Math.round(performance.now() - t0);

  const cfg = {
    interval_minutes: targets.config?.interval_minutes ?? 5,
    slow_ms: targets.config?.slow_ms ?? 3000,
    timeout_ms: targets.config?.timeout_ms ?? 10000,
  };

  const now = Date.now();
  const due = (targets.services || []).filter((s) => {
    if (FORCE || !s.last_checked_at) return true;
    // небольшой запас, т.к. cron в GitHub Actions срабатывает с погрешностью
    return now - new Date(s.last_checked_at).getTime() >= cfg.interval_minutes * 60_000 - 60_000;
  });

  console.log(`Сервисов: ${targets.services?.length ?? 0}, к проверке: ${due.length}, интервал: ${cfg.interval_minutes} мин`);

  const results = [];
  for (const svc of due) {
    const r = await checkService(svc, cfg);
    results.push(r);
    console.log(`  ${r.status.padEnd(11)} ${svc.slug} ${r.response_time} мс${r.error_message ? ' — ' + r.error_message : ''}`);
  }

  const infra = await checkInfra(dbMs, dbOk, dbError, cfg.slow_ms, cfg.timeout_ms);
  for (const i of infra) console.log(`  [supabase] ${i.status.padEnd(11)} ${i.component} ${i.response_time} мс${i.error_message ? ' — ' + i.error_message : ''}`);

  if (DRY_RUN) {
    console.log('DRY_RUN: результаты не записаны.');
    return;
  }
  const n = await rpc('cc_record_health', { p_token: TOKEN, p_results: results, p_infra: infra });
  console.log(`Записано проверок сервисов: ${n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
