/**
 * @file service-worker.js
 * アプリシェルをキャッシュしてオフライン利用を可能にする。
 * バージョンを上げると古いキャッシュは自動的に破棄される。
 */

const CACHE_VERSION = 'chinese-trainer-v2';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './parser.js',
  './quiz.js',
  './speech.js',
  './storage.js',
  './review.js',
  './gist.js',
  './manifest.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 同一オリジンのアプリシェル: キャッシュ優先、なければネットワーク取得後キャッシュへ保存
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
            return response;
          })
          .catch(() => caches.match('./index.html'));
      })
    );
    return;
  }

  // 外部リソース（ピンイン自動変換ライブラリ等）: stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
