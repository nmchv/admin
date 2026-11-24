/*!
 * nmchv maintenance guard
 *
 * Подключение: первым скриптом в head приложения — script с
 *   src="https://admin.nmchv.ru/maintenance.js" и атрибутом data-service="geotrainer".
 *   Подробности: docs/connect-service.md в репозитории Control Center.
 *
 * Что делает:
 *  - до отрисовки приложения спрашивает у Supabase (RPC cc_get_maintenance), не на обслуживании ли сервис;
 *  - если да — полностью заменяет страницу на единую заглушку SYSTEM MAINTENANCE;
 *  - каждые 20 секунд и при возвращении на вкладку перепроверяет состояние;
 *  - запоминает последнее известное состояние: если сервис был закрыт, а Supabase
 *    временно не отвечает, заглушка остаётся (не дольше 6 часов);
 *  - сообщает панели, что заглушка подключена на сайте (RPC cc_guard_ping).
 *
 * Важно: это клиентская проверка — она скрывает интерфейс. Данные закрывает
 * серверная часть: миграция 0006 ставит RLS-политики на таблицы сервисов, поэтому
 * во время обслуживания БД недоступна пользователям, даже в обход этой страницы.
 * Если состояние неизвестно (первый визит и Supabase не отвечает) — приложение
 * НЕ блокируется (fail-open), чтобы сбой проверки не уронил сайт.
 *
 * Значения __NMCHV_*__ подставляются при сборке Control Center (публичный anon key).
 */
(function () {
  'use strict';

  var CFG = { url: '__NMCHV_SUPABASE_URL__', key: '__NMCHV_SUPABASE_ANON_KEY__' };
  var script = document.currentScript;
  var service = script && script.getAttribute('data-service');
  if (!service || !/^https?:\/\//.test(CFG.url) || !CFG.key) return;

  var POLL_MS = 20000;
  var CACHE_KEY = 'nmchv_mt_' + service;
  var CACHE_TTL_MS = 6 * 3600 * 1000;
  var FIRST_CHECK_TIMEOUT_MS = 2500;
  var inMaintenance = false;

  // Прячем страницу до ответа, чтобы не мигал интерфейс. Не дольше FIRST_CHECK_TIMEOUT_MS.
  var hider = document.createElement('style');
  hider.textContent = 'html{visibility:hidden!important}';
  (document.head || document.documentElement).appendChild(hider);
  function unhide() {
    if (hider && hider.parentNode) hider.parentNode.removeChild(hider);
  }
  var hideTimer = setTimeout(unhide, FIRST_CHECK_TIMEOUT_MS);

  function rpc(name, args) {
    return fetch(CFG.url + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: {
        apikey: CFG.key,
        Authorization: 'Bearer ' + CFG.key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      cache: 'no-store',
    });
  }

  function saveCache(state) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), state: state }));
    } catch (e) {}
  }
  function loadCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && c.state && c.state.is_active && Date.now() - c.at < CACHE_TTL_MS) return c.state;
    } catch (e) {}
    return null;
  }

  function check() {
    return rpc('cc_get_maintenance', { p_slug: service })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      })
      .then(function (rows) {
        var row = Array.isArray(rows) ? rows[0] : rows;
        var state = row || { is_active: false };
        saveCache(state);
        return state;
      });
  }

  // Сообщаем панели, что заглушка подключена (не чаще раза в 10 минут — ограничивает сама функция).
  function ping() {
    try {
      rpc('cc_guard_ping', { p_slug: service }).catch(function () {});
    } catch (e) {}
  }

  var STYLE =
    'html,body{margin:0;height:100%;background:#08090B;color:#F4F5F7;font-family:Manrope,"Segoe UI",system-ui,-apple-system,sans-serif}' +
    '.mt{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;text-align:center;' +
    'background:radial-gradient(ellipse at 50% 30%,rgba(91,141,239,.10),transparent 60%),#08090B}' +
    '.mt:before{content:"";position:absolute;inset:0;opacity:.35;pointer-events:none;' +
    'background-image:linear-gradient(#252A34 1px,transparent 1px),linear-gradient(90deg,#252A34 1px,transparent 1px);' +
    'background-size:56px 56px;-webkit-mask-image:radial-gradient(ellipse at center,#000 10%,transparent 70%);mask-image:radial-gradient(ellipse at center,#000 10%,transparent 70%)}' +
    '.mt>*{position:relative}' +
    '.mt svg{width:132px;height:132px;margin-bottom:28px}' +
    '.mt .gear{transform-origin:66px 66px;animation:mtspin 24s linear infinite}' +
    '@keyframes mtspin{to{transform:rotate(360deg)}}' +
    '.mt .tag{font-size:12px;font-weight:700;letter-spacing:.32em;color:#5B8DEF;margin:0 0 14px}' +
    '.mt h1{font-size:clamp(26px,5vw,38px);font-weight:800;letter-spacing:-.02em;margin:0 0 14px}' +
    '.mt .msg{max-width:480px;margin:0 0 18px;font-size:16px;line-height:1.6;color:#9299A7;white-space:pre-line;overflow-wrap:anywhere}' +
    '.mt .eta{margin:0;padding:10px 16px;border:1px solid #252A34;border-radius:12px;background:#111318;font-size:14px;color:#9299A7}' +
    '.mt .eta b{color:#F4F5F7;font-weight:700}' +
    '.mt .brand{position:absolute;bottom:28px;left:0;right:0;font-size:13px;font-weight:800;letter-spacing:.04em;color:#9299A7}' +
    '.mt .brand span{color:#5B8DEF}' +
    '@media (prefers-reduced-motion:reduce){.mt .gear{animation:none}}';

  // Статичная доверенная иллюстрация (шестерёнка в рамке терминала).
  var ILLUSTRATION =
    '<svg viewBox="0 0 132 132" fill="none" aria-hidden="true">' +
    '<rect x="6" y="6" width="120" height="120" rx="28" fill="#111318" stroke="#252A34" stroke-width="2"/>' +
    '<g class="gear" stroke="#5B8DEF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="66" cy="66" r="14"/>' +
    '<path d="M66 30v10M66 92v10M30 66h10M92 66h10M40.5 40.5l7 7M84.5 84.5l7 7M40.5 91.5l7-7M84.5 47.5l7-7"/>' +
    '</g></svg>';

  function formatEta(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    if (isNaN(d.getTime()) || d.getTime() < Date.now()) return null;
    try {
      return d.toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' });
    } catch (e) {
      return d.toLocaleString();
    }
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text; // только textContent — сообщение администратора не интерпретируется как HTML
    return n;
  }

  function render(state) {
    inMaintenance = true;
    try {
      window.stop();
    } catch (e) {}

    var html = document.documentElement;
    while (html.firstChild) html.removeChild(html.firstChild);
    var head = document.createElement('head');
    var body = document.createElement('body');
    html.appendChild(head);
    html.appendChild(body);

    var meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1';
    head.appendChild(meta);
    var title = document.createElement('title');
    title.textContent = 'Технические работы — nmchv';
    head.appendChild(title);
    head.appendChild(el('style', null, STYLE));

    var root = el('div', 'mt');
    root.setAttribute('role', 'alert');
    var art = document.createElement('div');
    art.innerHTML = ILLUSTRATION;
    root.appendChild(art.firstChild);
    root.appendChild(el('p', 'tag', 'SYSTEM MAINTENANCE'));
    root.appendChild(el('h1', null, 'Ведутся технические работы'));
    root.appendChild(el('p', 'msg', state.message || 'Сервис временно недоступен. Мы скоро вернёмся.'));

    var eta = formatEta(state.scheduled_until);
    var etaEl = el('p', 'eta');
    etaEl.appendChild(document.createTextNode('Ожидаемое время восстановления: '));
    etaEl.appendChild(el('b', null, eta || 'уточняется'));
    root.appendChild(etaEl);

    var brand = el('div', 'brand');
    brand.appendChild(el('span', null, 'nm'));
    brand.appendChild(document.createTextNode('chv'));
    root.appendChild(brand);

    body.appendChild(root);
    html.style.visibility = 'visible';
  }

  function tick(isFirst) {
    check().then(
      function (state) {
        if (isFirst) {
          clearTimeout(hideTimer);
          unhide();
        }
        if (state.is_active && !inMaintenance) render(state);
        else if (!state.is_active && inMaintenance) location.reload();
        // после render: window.stop() внутри него отменил бы уже начатый запрос
        if (isFirst) ping();
      },
      function () {
        if (isFirst) {
          clearTimeout(hideTimer);
          // сервис был закрыт, а проверить сейчас нельзя — остаёмся на заглушке
          var known = loadCache();
          if (known && !inMaintenance) {
            render(known);
          } else {
            unhide(); // состояние неизвестно: fail-open
          }
        }
      }
    );
  }

  tick(true);
  setInterval(function () {
    tick(false);
  }, POLL_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') tick(false);
  });
})();
