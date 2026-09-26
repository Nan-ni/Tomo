// Tomo · service worker: permite instalar la app y abrirla aunque no haya internet.
// Al publicar cambios, sube el número de VERSION para que todos reciban la versión nueva
// (y el mismo número en index.html, en "Tomo · versión N" del menú Mi cuenta).
const VERSION = "tomo-v13";
const BASE = ["./", "./index.html", "./cuenta.js", "./config.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/favicon-64.png", "./icons/apple-touch-icon.png"];
// La librería de Supabase: sin ella la app no abre, así que se guarda desde el principio (si falla, se guardará al usarla)
const LIBS = ["https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"];
const CDN = /^(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) =>
    c.addAll(BASE).then(() => Promise.all(LIBS.map((u) => c.add(new Request(u, { mode: "cors" })).catch(() => {}))))
  ).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // La app misma: primero internet (para tener siempre lo último), y si no hay, la copia guardada.
  // Con internet lento (señal débil en el celular) no se espera más de 4 s: se abre la copia y la nueva se guarda por detrás.
  if (url.origin === location.origin) {
    const red = fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then((ca) => ca.put(req, c)); } return r; });
    const guardada = () => caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === "navigate" ? caches.match("./index.html") : undefined));
    e.respondWith(new Promise((resolve) => {
      let listo = false;
      const dar = (r) => { if (!listo && r) { listo = true; resolve(r); } };
      const t = setTimeout(() => guardada().then(dar), 4000);
      red.then((r) => { clearTimeout(t); dar(r); })
        .catch(() => { clearTimeout(t); guardada().then((r) => { dar(r); if (!listo) { listo = true; resolve(Response.error()); } }); });
    }));
    e.waitUntil(red.catch(() => {}));
    return;
  }
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
