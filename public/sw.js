/*
 * Service worker mínimo y prudente.
 * - Solo precachea la página estática "sin conexión" y los iconos.
 * - NUNCA cachea respuestas autenticadas ni de la API de Supabase: en un
 *   dispositivo compartido podría exponer datos personales de otra persona.
 * - Para navegaciones sin red, muestra /offline.html.
 */
const CACHE = "portal-estatico-v1";
const PRECACHE = ["/offline.html", "/icons/icon-192.png", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  event.respondWith(
    fetch(request).catch(() =>
      caches.match("/offline.html").then((res) => res || Response.error()),
    ),
  );
});
