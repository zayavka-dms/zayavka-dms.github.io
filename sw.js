/* Копия файлов страницы для работы без интернета.
   Кэшируются только файлы самой страницы. Данные из формы сюда не попадают: они живут в localStorage браузера.
   При замене библиотек, шрифтов интерфейса или значков увеличьте VERSION: тогда браузеры обновят копию.
   index.html, config.json и шаблон (assets/base.pdf, assets/serif.ttf) берутся из сети при каждом открытии. */
'use strict';

var VERSION = '1.1.0';
var CACHE = 'zayavka-dms-' + VERSION;
// Без этих файлов PDF не собрать: если хоть один не скачался, установка не засчитывается и повторится позже
var CORE = [
  './', 'config.json', 'assets/base.pdf', 'assets/serif.ttf',
  'vendor/pdf-lib.min.js', 'vendor/fontkit.umd.min.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js'
];
// Без этих страница работает, просто проще выглядит или без подсказок
var EXTRA = [
  'manifest.webmanifest', 'assets/icon-180.png', 'assets/icon-192.png', 'assets/icon-512.png',
  'vendor/petrovich.min.js', 'vendor/standard_fonts/FoxitDingbats.pfb', 'vendor/standard_fonts/FoxitSymbol.pfb',
  'fonts/fonts.css',
  'fonts/golos-text-cyrillic-400-normal.woff2', 'fonts/golos-text-cyrillic-500-normal.woff2',
  'fonts/golos-text-cyrillic-600-normal.woff2', 'fonts/golos-text-latin-400-normal.woff2',
  'fonts/golos-text-latin-500-normal.woff2', 'fonts/golos-text-latin-600-normal.woff2',
  'fonts/pt-serif-cyrillic-400-normal.woff2', 'fonts/pt-serif-cyrillic-700-normal.woff2',
  'fonts/pt-serif-latin-400-normal.woff2', 'fonts/pt-serif-latin-700-normal.woff2'
];
// Эти файлы правят вместе (координаты текста в index.html под шаблон): всегда сначала сеть
var FRESH = { '': true, 'index.html': true, 'config.json': true, 'base.pdf': true, 'serif.ttf': true };

function mainKey() { return new URL('./', self.registration.scope).href; }
function fileOf(url) { return url.pathname.slice(url.pathname.lastIndexOf('/') + 1); }

// ответ после перенаправления браузер не примет для открытия страницы: пересобираем его без этой пометки
function plain(res) {
  if (!res.redirected) { return res; }
  return res.blob().then(function (body) {
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    function get(url) {
      return fetch(new Request(url, { cache: 'reload' })).then(plain).then(function (res) {
        if (!res.ok) { throw new Error(url + ': ' + res.status); }
        return cache.put(url, res);
      });
    }
    return Promise.all([
      Promise.all(CORE.map(get)),
      Promise.all(EXTRA.map(function (url) { return get(url).catch(function () { /* подтянется при открытии */ }); }))
    ]);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('zayavka-dms-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') { return; }
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) { return; }
  var name = fileOf(url);
  if (req.mode === 'navigate' || FRESH[name]) { event.respondWith(networkFirst(url, name)); }
  else { event.respondWith(cacheFirst(req)); }
});

// Сначала сеть; без сети, при ошибке сервера или если сеть думает дольше 4 с (config.json: 2,5 с), берем копию.
// Главная страница хранится под одним ключом и только как HTML: открытый в браузере config.json ее не подменит.
function networkFirst(url, name) {
  var main = name === '' || name === 'index.html';
  var key = main ? mainKey() : url.origin + url.pathname;
  var wait = name === 'config.json' ? 2500 : 4000;
  return caches.open(CACHE).then(function (cache) {
    var net = fetch(new Request(url.href, { cache: 'no-cache', credentials: 'same-origin' })).then(plain).then(function (res) {
      var html = /text\/html/i.test(res.headers.get('content-type') || '');
      if (res.ok && (!main || html)) { cache.put(key, res.clone()); }
      return res;
    });
    var slow = new Promise(function (resolve) { setTimeout(resolve, wait, null); });
    return Promise.race([net.catch(function () { return null; }), slow]).then(function (res) {
      if (res && res.ok) { return res; }
      return cache.match(key).then(function (hit) { return hit || res || net; });
    });
  });
}

function cacheFirst(req) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) { return hit; }
      return fetch(req).then(function (res) {
        if (res.ok && res.type === 'basic') { cache.put(req, res.clone()); }
        return res;
      });
    });
  });
}
