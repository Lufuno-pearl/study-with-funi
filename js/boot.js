/* Funi start-up: connect to Supabase, restore the login, load everything. */
(function () {
  "use strict";
  const F = window.Funi;

  F.on("login", async () => {
    F.renderDash();
    await Promise.all([F.loadStudy(), F.loadSocial()]);
    F.renderDash();
    // phone notifications: re-register this phone if notifications are already allowed
    if (F.canNotify() && Notification.permission === "granted") F.subscribePush();
    F.openLink(location.href);
  });

  async function start() {
    F.applyTheme(F.read("funi.theme", "lavender"));
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      F.cfg = await res.json();
      if (!F.cfg.url || !F.cfg.anonKey) {
        F.showAuth(); F.status("authStatus", "Funi isn't connected to its database yet. Add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel.");
        return;
      }
      F.sb = window.supabase.createClient(F.cfg.url, F.cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    } catch (e) {
      F.showAuth(); F.status("authStatus", "You're offline. Connect to the internet to log in.");
      return;
    }
    const { data } = await F.sb.auth.getSession();
    const user = data && data.session ? data.session.user : null;
    if (user && !user.is_anonymous && user.email) { F.me = user; F.showApp(); }
    else { if (user) await F.sb.auth.signOut(); F.showAuth(); }
  }
  start();
})();
