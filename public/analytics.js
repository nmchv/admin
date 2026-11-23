/*!
 * nmchv analytics SDK
 *
 * Подключение (в HTML приложения):
 *   1) script с src="https://admin.nmchv.ru/analytics.js"
 *   2) после него вызов: window.NMCHV_ANALYTICS.init({ service: 'geotrainer' });
 *   Подробности: docs/analytics-sdk.md в репозитории Control Center.
 *
 * Параметры init:
 *   service         — идентификатор сервиса из Control Center (обязательно)
 *   requireConsent  — true: ничего не сохранять и не отправлять, пока не вызван grantConsent()
 *   ignoreLocalhost — по умолчанию true: не считать localhost / 127.0.0.1 / файловые страницы
 *
 * API: init(opts), track(name), grantConsent(), revokeConsent()
 *
 * Что собирается: тип события, путь страницы (без query и без #-параметров), случайный
 * анонимный id посетителя и сессии, класс устройства, браузер, ОС и hostname внешнего
 * источника перехода. НЕ собираются: IP, user-agent целиком, содержимое форм, cookie,
 * токены, тексты страниц, query-параметры.
 *
 * Не отправляет данные при включённых Do Not Track / Global Privacy Control, у ботов
 * и автоматизированных браузеров.
 *
 * Значения __NMCHV_*__ подставляются при сборке Control Center (публичный anon key).
 */
(function () {
  'use strict';

  if (window.NMCHV_ANALYTICS) return;

  var CFG = { url: '__NMCHV_SUPABASE_URL__', key: '__NMCHV_SUPABASE_ANON_KEY__' };

  var SESSION_TTL_MS = 30 * 60 * 1000; // сессия истекает после 30 минут бездействия
  var FLUSH_MS = 5000;
  var MIN_FLUSH_GAP_MS = 1000;
  var BATCH_MAX = 10;
  var QUEUE_MAX = 50;
  var RATE_MAX = 60; // событий в минуту с одной страницы
  var DEDUP_MS = 1500;
  var MAX_FAILS = 3;

  var state = {
    ready: false, // init выполнен
    active: false, // сбор идёт (есть согласие и нет запретов)
    service: null,
    requireConsent: false,
    visitorId: null,
    sessionId: null,
    queue: [],
    lastFlush: 0,
    flushTimer: null,
    fails: 0,
    lastPath: null,
    lastPathAt: 0,
    sent: [],
    ended: false,
  };

  // ---------- утилиты ----------
  function safeStorage(kind) {
    try {
      var s = window[kind];
      var k = '__nmchv_t';
      s.setItem(k, '1');
      s.removeItem(k);
      return s;
    } catch (e) {
      return null;
    }
  }
  var LS = safeStorage('localStorage');

  function uuid() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      var b = new Uint8Array(16);
      crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    } catch (e) {
      return 'f' + Math.random().toString(16).slice(2) + Date.now().toString(16);
    }
  }

  function ls(key, val) {
    if (!LS) return null;
    try {
      if (val === undefined) return LS.getItem(key);
      if (val === null) LS.removeItem(key);
      else LS.setItem(key, val);
    } catch (e) {}
    return null;
  }

  // ---------- определение окружения (только категории, не сырой UA) ----------
  function detectDevice(ua) {
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'tablet'; // iPadOS
    if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return 'mobile';
    return 'desktop';
  }
  function detectBrowser(ua) {
    if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
    if (/OPR\/|Opera/.test(ua)) return 'Opera';
    if (/YaBrowser/.test(ua)) return 'Yandex';
    if (/SamsungBrowser/.test(ua)) return 'Samsung';
    if (/Firefox\/|FxiOS/.test(ua)) return 'Firefox';
    if (/Chrome\/|CriOS/.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua)) return 'Safari';
    return 'Other';
  }
  function detectOS(ua) {
    if (/Windows/.test(ua)) return 'Windows';
    if (/Android/.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
    if (/CrOS/.test(ua)) return 'ChromeOS';
    if (/Macintosh|Mac OS X/.test(ua)) return navigator.maxTouchPoints > 1 ? 'iOS' : 'macOS';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Other';
  }

  function isBlocked(opts) {
    var ua = navigator.userAgent || '';
    if (/bot|crawl|spider|headless|lighthouse|prerender|phantom/i.test(ua)) return true;
    if (navigator.webdriver) return true;
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true) return true;
    if (opts.ignoreLocalhost !== false) {
      var h = location.hostname;
      if (location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true;
    }
    return false;
  }

  // ---------- идентификаторы ----------
  function getVisitorId() {
    var id = ls('nmchv_vid');
    if (!id || id.length < 8) {
      id = uuid();
      ls('nmchv_vid', id);
    }
    return id;
  }

  /** Возвращает true, если начата новая сессия. */
  function touchSession() {
    var key = 'nmchv_sess_' + state.service;
    var now = Date.now();
    var raw = ls(key);
    var cur = null;
    try { cur = raw ? JSON.parse(raw) : null; } catch (e) {}
    if (cur && cur.id && now - cur.last < SESSION_TTL_MS) {
      state.sessionId = cur.id;
      ls(key, JSON.stringify({ id: cur.id, last: now }));
      return false;
    }
    state.sessionId = state.sessionId && !LS ? state.sessionId : uuid();
    ls(key, JSON.stringify({ id: state.sessionId, last: now }));
    return true;
  }

  // ---------- сбор данных страницы ----------
  function currentPath() {
    var p = location.pathname || '/';
    var h = location.hash || '';
    if (h.indexOf('#/') === 0) p += h.split('?')[0]; // hash-роутинг: #/page, без параметров
    return p.slice(0, 256);
  }

  function externalReferrerHost() {
    try {
      if (!document.referrer) return null;
      var u = new URL(document.referrer);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      if (u.hostname === location.hostname) return null;
      return u.hostname;
    } catch (e) {
      return null;
    }
  }

  // ---------- очередь и отправка ----------
  var env = null;
  function base(type) {
    if (!env) {
      var ua = navigator.userAgent || '';
      env = { d: detectDevice(ua), b: detectBrowser(ua), o: detectOS(ua) };
    }
    return { t: type, s: state.sessionId, v: state.visitorId, d: env.d, b: env.b, o: env.o };
  }

  function rateOk() {
    var now = Date.now();
    state.sent = state.sent.filter(function (t) { return now - t < 60000; });
    if (state.sent.length >= RATE_MAX) return false;
    state.sent.push(now);
    return true;
  }

  function enqueue(ev) {
    if (!state.active || state.fails >= MAX_FAILS) return;
    if (!rateOk()) return;
    if (state.queue.length >= QUEUE_MAX) state.queue.shift();
    state.queue.push(ev);
    if (state.queue.length >= BATCH_MAX) flush();
    else if (!state.flushTimer) state.flushTimer = setTimeout(flush, FLUSH_MS);
  }

  function flush(force) {
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    if (!state.queue.length || state.fails >= MAX_FAILS) return;
    var now = Date.now();
    if (!force && now - state.lastFlush < MIN_FLUSH_GAP_MS) {
      state.flushTimer = setTimeout(flush, MIN_FLUSH_GAP_MS);
      return;
    }
    state.lastFlush = now;
    var batch = state.queue.splice(0, BATCH_MAX);
    send(batch);
    if (state.queue.length) state.flushTimer = setTimeout(flush, MIN_FLUSH_GAP_MS);
  }

  function send(batch) {
    try {
      fetch(CFG.url + '/rest/v1/rpc/cc_track_events', {
        method: 'POST',
        keepalive: true,
        headers: { apikey: CFG.key, Authorization: 'Bearer ' + CFG.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_service: state.service, p_events: batch }),
      }).then(
        function (r) { if (r.ok) state.fails = 0; else state.fails++; },
        function () { state.fails++; }
      );
    } catch (e) {
      state.fails++;
    }
  }

  // ---------- события ----------
  function pageView(force) {
    var path = currentPath();
    var now = Date.now();
    // защита от дублей: pushState + popstate/hashchange дают одно и то же событие
    if (!force && path === state.lastPath && now - state.lastPathAt < DEDUP_MS) return;
    state.lastPath = path;
    state.lastPathAt = now;
    var isNew = touchSession();
    if (isNew) {
      var s = base('session_start');
      s.p = path;
      var r = externalReferrerHost();
      if (r) s.r = r;
      enqueue(s);
    }
    var ev = base('page_view');
    ev.p = path;
    enqueue(ev);
  }

  function onNavigate() {
    if (!state.active) return;
    // дать SPA обновить location/hash перед чтением
    setTimeout(function () { pageView(false); }, 0);
  }

  function hookHistory() {
    ['pushState', 'replaceState'].forEach(function (m) {
      var orig = history[m];
      if (!orig || orig.__nmchv) return;
      var wrapped = function () {
        var r = orig.apply(this, arguments);
        onNavigate();
        return r;
      };
      wrapped.__nmchv = true;
      history[m] = wrapped;
    });
    window.addEventListener('popstate', onNavigate);
    window.addEventListener('hashchange', onNavigate);
  }

  function endSession() {
    if (!state.active || state.ended) return;
    state.ended = true;
    var ev = base('session_end');
    ev.p = currentPath();
    state.queue.push(ev); // в обход лимитов: событие одно за уход со страницы
    flush(true);
  }

  function start() {
    state.visitorId = getVisitorId();
    state.active = true;
    state.ended = false;
    pageView(true);
  }

  // ---------- публичный API ----------
  var API = {
    init: function (opts) {
      opts = opts || {};
      if (state.ready) return;
      if (!/^[a-z0-9_-]{1,64}$/.test(opts.service || '')) return;
      if (!/^https?:\/\//.test(CFG.url) || !CFG.key) return;
      if (isBlocked(opts)) return;

      state.ready = true;
      state.service = opts.service;
      state.requireConsent = opts.requireConsent === true;

      hookHistory();
      window.addEventListener('pagehide', endSession);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flush(true);
        else if (state.active) { state.ended = false; touchSession(); }
      });

      if (state.requireConsent && ls('nmchv_consent') !== 'granted') return; // ждём grantConsent()
      start();
    },

    /** Пользовательское событие: имя — латиница, цифры, _ . - (до 48 символов). Без параметров и данных. */
    track: function (name) {
      if (!state.active || typeof name !== 'string') return;
      var n = name.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 48);
      if (!n) return;
      touchSession();
      var ev = base('event:' + n);
      ev.p = currentPath();
      enqueue(ev);
    },

    grantConsent: function () {
      if (!state.ready) return;
      ls('nmchv_consent', 'granted');
      if (!state.active) start();
    },

    /** Отзыв согласия: остановить сбор и удалить локальные идентификаторы. */
    revokeConsent: function () {
      ls('nmchv_consent', null);
      ls('nmchv_vid', null);
      if (state.service) ls('nmchv_sess_' + state.service, null);
      state.active = false;
      state.queue = [];
    },
  };

  window.NMCHV_ANALYTICS = API;
})();
