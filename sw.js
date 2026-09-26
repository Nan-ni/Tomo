// Tomo · service worker: permite instalar la app y abrirla aunque no haya internet.
// Al publicar cambios, sube el número de VERSION para que todos reciban la versión nueva.
const VERSION = "tomo-v5";
const BASE = ["./", "./index.html", "./config.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // La app misma: primero internet (para tener siempre lo último), y si no hay, la copia guardada
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then((ca) => ca.put(req, c)); } return r; })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")))
    );
    return;
  }
  // Librerías y tipografías: la copia guardada al instante y se actualiza por detrás
  if (/^(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname)) {
    e.respondWith(
      caches.open(VERSION).then((ca) => ca.match(req).then((hit) => {
        const red = fetch(req).then((r) => { if (r.ok) ca.put(req, r.clone()); return r; }).catch(() => hit);
        return hit || red;
      }))
    );
  }
  // Todo lo demás (base de datos, portadas) va directo a internet
});
