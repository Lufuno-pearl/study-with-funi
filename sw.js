// Service worker: keeps Funi opening offline and shows notifications (also when the app is closed).
const CACHE = "funi-v11";
const SHELL = [
  "/", "/index.html", "/styles.css", "/manifest.json",
  "/js/art.js", "/js/core.js", "/js/study.js", "/js/social.js", "/js/files.js", "/js/dash.js", "/js/boot.js",
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
  if ((!sameOrigin && !isLibrary) || url.pathname.startsWith("/api/")) return;
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

// A push from Funi's server (reminders, messages, invites, partners studying)
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: "Funi", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(data.title || "Funi", {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || "/" }
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    if (list.length) {
      list[0].postMessage({ type: "open", url });
      return list[0].focus();
    }
    return self.clients.openWindow(url);
  }));
});
