/*
  Prayer Wall service worker — caches the app shell so it opens
  instantly (and works offline) once installed. It does NOT cache
  live prayer data: that lives in localStorage today (see js/app.js)
  or in a real backend once one is wired in — this worker only
  speeds up loading the app itself.

  Bump CACHE_NAME whenever you ship a change to any cached file so
  returning users get the update instead of a stale copy.
*/
var CACHE_NAME = 'prayer-wall-shell-v1';
var APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function(event){
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache){ return cache.addAll(APP_SHELL); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE_NAME; })
            .map(function(k){ return caches.delete(k); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(event){
  var req = event.request;
  if(req.method !== 'GET') return;

  var url = new URL(req.url);
  var isSameOrigin = url.origin === self.location.origin;

  if(isSameOrigin){
    // App shell: cache-first, falling back to network, so it works offline.
    event.respondWith(
      caches.match(req).then(function(cached){
        return cached || fetch(req).then(function(res){
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); });
          return res;
        }).catch(function(){
          if(req.mode === 'navigate') return caches.match('./index.html');
        });
      })
    );
  } else {
    // Third-party (fonts, QR script): network-first, cache as a fallback.
    event.respondWith(
      fetch(req).then(function(res){
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); });
        return res;
      }).catch(function(){ return caches.match(req); })
    );
  }
});
