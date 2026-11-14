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
    // old accounts: ask once per visit to add an email so they can reset their password
    if (F.me && !F.hasRealEmail(F.me) && !F.me.new_email && !sessionStorage.getItem("funi.emailNudge")) {
      sessionStorage.setItem("funi.emailNudge", "1");
      setTimeout(() => F.toast("Add your email in Profile so you can reset your password yourself.", { long: true, onClick: () => F.go("profile") }), 1500);
    }
    const link = F.pendingLink || location.href; F.pendingLink = null;
    F.openLink(link);
  });

  async function start() {
    F.applyTheme(F.read("funi.theme", "lavender"));
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    try {
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        F.cfg = await res.json();
        if (F.cfg && F.cfg.url) F.store("funi.cfg", F.cfg);
      } catch (err) {
        // no internet: use the settings saved last time so Funi still opens
        F.cfg = F.read("funi.cfg", null);
        if (!F.cfg) throw err;
        F.noNet = true;
      }
      if (!F.cfg.url || !F.cfg.anonKey) {
        F.showAuth(); F.status("authStatus", "Funi isn't connected to its database yet. Add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel.");
        return;
      }
      // links from Funi emails come back with #...type=signup / recovery / email_change (or an error)
      const hash = new URLSearchParams(location.hash.slice(1));
      F.linkType = hash.get("type") || "";
      F.linkError = hash.get("error_description") || "";
      const saved = F.savedSession();
      if (saved && (F.noNet || !navigator.onLine)) {
        // No internet: open with the login saved on this phone, without trying to refresh it
        // (that would make you wait). Your data comes from the copy saved on this phone.
        const sess = Object.assign({}, saved.session, { expires_at: Math.floor(Date.now() / 1000) + 86400, expires_in: 86400 });
        F.startedOffline = true;
        F.sb = window.supabase.createClient(F.cfg.url, F.cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey: saved.key,
          storage: { getItem: (k) => (k === saved.key ? JSON.stringify(sess) : null), setItem() {}, removeItem() {} } } });
      } else F.sb = window.supabase.createClient(F.cfg.url, F.cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    } catch (e) {
      F.showAuth(); F.status("authStatus", "You're offline. Connect to the internet once to log in. After that Funi opens without internet too.");
      return;
    }
    let res = { data: null, error: null };
    try { res = await F.sb.auth.getSession(); } catch (e) { res.error = e; }
    let user = res.data && res.data.session ? res.data.session.user : null;
    // Phones often wake Funi up before the internet is ready, so checking the login fails even though
    // you're still logged in. Keep you logged in: try again a few times, and if the server still can't be
    // reached, open with the login saved on this phone (it reconnects by itself). Only a login the server
    // says is no longer valid sends you back to the login screen.
    const definite = (err) => !!err && /invalid refresh token|refresh token not found|already used|invalid_grant|user not found|session_not_found/i.test(err.message || "");
    if (!user && !F.startedOffline && !definite(res.error)) {
      const kept = F.savedSession();
      if (kept && kept.session.refresh_token) {
        let lastErr = res.error;
        for (let i = 0; i < 3 && !user; i++) {
          await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
          try {
            const r = await F.sb.auth.refreshSession({ refresh_token: kept.session.refresh_token });
            if (r.data && r.data.session) user = r.data.session.user; else lastErr = r.error;
          } catch (e) { lastErr = e; }
          if (definite(lastErr)) break;
        }
        if (!user && !definite(lastErr) && F.savedSession()) {
          const sv = F.savedSession(), sess = Object.assign({}, sv.session, { expires_at: Math.floor(Date.now() / 1000) + 86400, expires_in: 86400 });
          F.startedOffline = true;
          F.sb = window.supabase.createClient(F.cfg.url, F.cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey: sv.key,
            storage: { getItem: (k) => (k === sv.key ? JSON.stringify(sess) : null), setItem() {}, removeItem() {} } } });
          user = sv.session.user;
        }
        if (!user) try { localStorage.setItem("funi.authWhy", (lastErr && lastErr.message) || "no session"); } catch (e) {}
      }
    }
    if (F.linkType === "recovery" && user) { F.me = user; F.showNewPassword(); return; }
    if (user && !user.is_anonymous && user.email) {
      F.me = user; F.showApp();
      if (F.linkType === "signup") F.toast("Email confirmed! Welcome to Funi, " + F.usernameOf(user) + ".", { long: true });
      if (F.linkType === "email_change") F.toast("Your email is updated.");
    } else {
      if (user) await F.sb.auth.signOut();
      F.showAuth();
      // if a login keeps ending by itself, say why (helps find the cause)
      let why = null; try { why = localStorage.getItem("funi.authWhy"); localStorage.removeItem("funi.authWhy"); } catch (e) {}
      if (why && !F.noNet) F.status("authStatus", "You were logged out (" + why.slice(0, 120) + "). Log in again, and if this keeps happening, screenshot this message.");
      if (F.noNet) F.status("authStatus", "You're offline. Connect to the internet once to log in. After that Funi opens without internet too.");
      if (F.linkError) { F.authPanel("loginForm"); F.showError("loginError", /expired|invalid/i.test(F.linkError) ? "That email link expired or was already used. Log in, or ask for a new link." : F.linkError); }
    }
    if (F.linkType || F.linkError) try { window.history.replaceState(null, "", "/"); } catch (e) {}
    F.sb.auth.onAuthStateChange((ev) => {
      if (ev === "PASSWORD_RECOVERY") F.showNewPassword();
      if (ev === "SIGNED_OUT" && F.me && !F.loggingOut) { try { localStorage.setItem("funi.authWhy", "signed out by the server at " + new Date().toISOString()); } catch (e) {} }
    });
  }
  start();

  /* ---------- offline: show a small bar, refresh everything when the internet is back ---------- */
  function offlineBar() {
    const off = !navigator.onLine || F.startedOffline;
    F.$("offlineBar").hidden = !off || !F.me;
    document.body.classList.toggle("is-offline", off && !!F.me);
  }
  F.offlineBar = offlineBar;
  window.addEventListener("offline", offlineBar);
  // opened offline: check now and then if the internet is back, then reload to log in properly
  async function backOnline() {
    if (!F.startedOffline) return;
    try {
      // reload only when Funi's login server answers too, and never more than 3 times in 10 minutes
      const r = await fetch(F.cfg.url + "/auth/v1/health", { cache: "no-store", headers: { apikey: F.cfg.anonKey } });
      let n = []; try { n = JSON.parse(sessionStorage.getItem("funi.reloads") || "[]").filter((t) => Date.now() - t < 600000); } catch (e) {}
      if (r.ok && n.length < 3) { try { sessionStorage.setItem("funi.reloads", JSON.stringify(n.concat(Date.now()))); } catch (e) {} location.reload(); return; }
    } catch (e) {}
    setTimeout(backOnline, 20000);
  }
  F.on("login", () => { if (F.startedOffline) setTimeout(backOnline, 20000); });
  window.addEventListener("online", () => {
    if (F.startedOffline) { backOnline(); return; }
    offlineBar();
    if (F.me) { F.emit("resume"); F.toast("You're back online."); }
  });
  F.on("login", offlineBar);
})();
