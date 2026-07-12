// Service worker del panel de administración.
//
// El admin es un panel de datos en vivo (órdenes, stock, ingresos) — no
// tiene sentido mostrar información vieja desde caché mientras haya
// conexión. Por eso esta estrategia es "network-first": siempre intenta
// la red primero, y solo cae a caché si de verdad no hay internet (para
// que al menos abra la app en vez de mostrar el error del navegador).
//
// El único propósito real de este archivo es cumplir el requisito técnico
// de Chrome/Android para poder "Agregar a pantalla de inicio" — un
// service worker registrado con un manejador de "fetch" es parte de ese
// criterio de instalabilidad.

const CACHE_NAME = "jonara-admin-shell-v1";
const SHELL_FILES = [
  "/admin",
  "/admin-icon-192.png",
  "/admin-icon-512.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Nunca interceptar llamadas a la API (Stripe/Firestore vía /api/*) —
  // esas siempre deben ir directo a la red, sin ningún tipo de caché.
  if (event.request.url.includes("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
