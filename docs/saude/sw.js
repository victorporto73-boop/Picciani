// Service worker: abre o app sem internet depois da primeira visita.
// Os dados vêm do Apps Script (outra origem) e não passam por aqui.
const CACHE = 'gestao-saude-v1';
const SHELL = [
  './', './index.html', './estilo.css', './manifest.webmanifest', './icon.svg',
  './js/app.js', './js/store.js', './js/modulos.js', './js/ui.js', './js/util.js',
  './js/icones.js', './js/config.js', './js/demo.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro (pega a versão nova assim que publicada); cache se estiver offline.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
