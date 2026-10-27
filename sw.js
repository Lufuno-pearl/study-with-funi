// Service worker: keeps Funi opening offline and shows notifications (also when the app is closed).
const CACHE = "funi-v33";
const DATA = "funi-data"; // last copy of your Funi data, so pages still show when you're offline
const SHELL = [
  "/", "/index.html", "/styles.css", "/manifest.json",
  "/js/art.js", "/js/core.js", "/js/study.js", "/js/social.js", "/js/files.js", "/js/fun.js", "/js/cards.js", "/js/dash.js", "/js/boot.js",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png",
  "/js/vendor/pdf.min.js", "/js/vendor/pdf.worker.min.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE && k !== DATA && !k.startsWith("funi-files-")).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// Network first (so updates show up), cache as a fallback when offline.
const FONTS = ["fonts.googleapis.com", "fonts.gstatic.com"];
// dates in a query change every day (e.g. "exams from today"), so they don't count for the saved copy
const dataKey = (url) => url.origin + url.pathname + "?" + url.search.slice(1).replace(/=(gte|lte|gt|lt)\.[^&]*/g, "=$1.*");
function withTimeout(p, ms) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("slow")), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); }); }
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // your Funi data (exams, tasks, files list, partners, flashcards…): fresh when online, last copy when not
  if (url.hostname.endsWith(".supabase.co") && url.pathname.startsWith("/rest/v1/")) {
    const key = dataKey(url);
    const net = fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put(key, copy)); }
      return res;
    });
    e.respondWith(withTimeout(net, 7000).catch(() => caches.match(key).then((r) => r || net.catch(() =>
      new Response(JSON.stringify({ message: "You're offline", code: "offline" }), { status: 503, headers: { "Content-Type": "application/json" } })))));
    return;
  }
  const sameOrigin = url.origin === location.origin;
  const isLibrary = url.hostname === "cdn.jsdelivr.net" || FONTS.includes(url.hostname);
  if ((!sameOrigin && !isLibrary) || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    withTimeout(fetch(e.request), 8000).then((res) => {
      if (res.ok || res.type === "opaque") {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || (e.request.mode === "navigate" ? caches.match("/index.html") : Response.error())))
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
