// Service worker: keeps Funi opening offline and shows notifications.
const CACHE = "funi-v5";
const SHELL = [
  "/", "/index.html", "/styles.css", "/app.js", "/manifest.json",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Network first (so updates show up), cache as a fallback when offline.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const sameOrigin = url.origin === location.origin;
  const isLibrary = url.hostname === "cdn.jsdelivr.net";
  if (!sameOrigin && !isLibrary) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html")))
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => {
    if (list.length) return list[0].focus();
    return self.clients.openWindow("/");
  }));
});
