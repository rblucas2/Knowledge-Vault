/* Service worker — app shell offline para o Knowledge Vault */
const VERSION = "kvault-v8";
const CORE = [
  "./", "./index.html",
  "./base.css", "./app.css",
  "./store.js", "./sync.js", "./ai.js", "./app.js",
  "./manifest.webmanifest", "./icons/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Nunca interferir com chamadas externas (Anthropic, Supabase, fontes).
  if (url.origin !== location.origin) return;

  // network-first para a mesma origem: última versão quando há rede, cache como fallback offline.
  e.respondWith(
    fetch(req).then((r) => {
      if (r && r.ok) { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); }
      return r;
    }).catch(() => caches.match(req).then((m) => m || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
