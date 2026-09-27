// Tomo · service worker: permite instalar la app, abrirla al instante y usarla aunque no haya internet.
// Al publicar cambios, sube el número de VERSION para que todos reciban la versión nueva
// (y el mismo número en index.html, en "Tomo · versión N" del menú Mi cuenta).
const VERSION = "tomo-v35";
const BASE = ["./", "./index.html", "./cuenta.js", "./config.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/favicon-64.png", "./icons/apple-touch-icon.png"];
// La librería de Supabase: sin ella la app no abre, así que se guarda desde el principio (si falla, se guardará al usarla)
const LIBS = ["https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"];
const CDN = /^(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

self.addEventListener("install", (e) => {
  // cache "reload": los archivos nuevos vienen del servidor, no de la memoria del navegador
  e.waitUntil(caches.open(VERSION).then((c) =>
    c.addAll(BASE.map((u) => new Request(u, { cache: "reload" })))
      .then(() => Promise.all(LIBS.map((u) => c.add(new Request(u, { mode: "cors" })).catch(() => {}))))
  ).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // Portadas del catálogo de colecciones: nunca cambian, así que primero la copia guardada
    if (url.pathname.includes("/catalogo/")) {
      e.respondWith(caches.open(VERSION).then((ca) => ca.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) ca.put(req, r.clone()); return r; }))));
      return;
    }
    // La app: se abre al instante con la copia guardada y la de internet se guarda por detrás para la próxima vez
    // (una versión nueva de verdad llega con un sw.js nuevo, que la instala entera y la app avisa para recargar).
    const red = fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then((ca) => ca.put(req, c)); } return r; });
    e.waitUntil(red.then(() => {}, () => {}));
    e.respondWith(
      caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined))
        .then((hit) => hit || red)
        .catch(() => Response.error())
    );
    return;
  }
  // El idioma del lector de fotos (citas) lo guarda el mismo lector en el navegador: no hace falta otra copia de 2 MB
  if (url.pathname.includes("/@tesseract.js-data/")) return;
  // Librerías y tipografías: la copia guardada al instante y se actualiza por detrás
  if (CDN.test(url.hostname)) {
    e.respondWith(
      caches.open(VERSION).then((ca) => ca.match(req, { ignoreVary: true }).then((hit) => {
        const red = fetch(req).then((r) => { if (r.ok) ca.put(req, r.clone()); return r; }).catch(() => hit || Response.error());
        if (hit) e.waitUntil(red.catch(() => {}));
        return hit || red;
      }))
    );
  }
  // Todo lo demás (base de datos, portadas) va directo a internet
});
