/* App-shell cache only. Version must match the ?v= cache-bust in index.html. */
const VERSION = '20261006a';
const CACHE = 'nhl-digest-shell-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './css/app.css?v=' + VERSION,
  './js/config.js?v=' + VERSION,
  './js/mock-data.js?v=' + VERSION,
  './js/api.js?v=' + VERSION,
  './js/bridge.js?v=' + VERSION,
  './js/auth.js?v=' + VERSION,
  './js/app.js?v=' + VERSION
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key !== CACHE;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

function isAppShell(url) {
  if (url.origin !== self.location.origin) return false;
  var base = new URL(self.registration.scope).pathname.replace(/\/$/, '');
  var path = url.pathname.replace(/\/$/, '');
  if (path === base || path === base + '/index.html') return true;
  if (path === base + '/css/app.css') return true;
  if (path === base + '/js/config.js') return true;
  if (path === base + '/js/mock-data.js') return true;
  if (path === base + '/js/api.js') return true;
  if (path === base + '/js/bridge.js') return true;
  if (path === base + '/js/auth.js') return true;
  if (path === base + '/js/app.js') return true;
  return false;
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (!isAppShell(url)) return;
  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) {
          return cache.put(req, copy);
        }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (cached) {
        if (cached) return cached;
        if (req.mode === 'navigate') {
          return caches.match('./index.html').then(function (index) {
            return index || caches.match('./');
          });
        }
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});
