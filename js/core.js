/* Funi core: helpers, themes, navigation, accounts, notifications, live updates. */
(function () {
  "use strict";

  const F = (window.Funi = {
    sb: null, me: null,
    s: { items: [], modules: [], tasks: [], profile: null, partners: [], invitesIn: [], invitesOut: [],
         partnerSessions: {}, online: new Set(), convos: {}, notifs: [], chatWith: null, view: "home", seg: "plan" },
    USERNAME_DOMAIN: "users.studywithfuni.app"
  });

  /* ---------- tiny event system ---------- */
  const handlers = {};
  F.on = (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); };
  F.emit = (name, data) => { (handlers[name] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(name, e); } }); };

  /* ---------- helpers ---------- */
  const $ = (F.$ = (id) => document.getElementById(id));
  F.esc = (s) => { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; };
  F.isoOf = (d) => d.toLocaleDateString("en-CA");
  F.todayISO = () => F.isoOf(new Date());
  F.daysLeft = (dateStr) => { const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(dateStr + "T00:00:00") - t) / 86400000); };
  F.niceDate = (dateStr) => new Date(dateStr + "T00:00:00").toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
  F.niceTime = (t) => (t ? String(t).slice(0, 5) : "");
  F.clockOf = (iso) => new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
  F.timeAgo = (iso) => {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "Just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 7 * 86400) return Math.floor(s / 86400) + "d ago";
    return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
  };
  F.store = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} };
  F.read = (key, fallback) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } };
  F.usernameOf = (user) => (user && user.email ? user.email.split("@")[0] : "");
  F.nameOf = (p) => (p ? (p.display_name && p.display_name.trim()) || p.username || "Study partner" : "Study partner");
  F.showError = (id, msg) => { const el = $(id); if (!el) return; el.textContent = msg || ""; el.hidden = !msg; };
  F.status = (id, msg) => F.showError(id, msg);
  F.avatar = (p, feeling) => window.FuniArt.avatarSVG(p && p.avatar, feeling || (p && p.feeling) || "Happy", p && p.id);
  F.face = (f) => window.FuniArt.feelingSVG(f);

  let toastTimer = null, toastClick = null;
  F.toast = (msg, opts) => {
    const o = opts || {}, t = $("toast");
    t.innerHTML = (o.icon ? '<span class="ava">' + o.icon + "</span>" : "") + "<span>" + F.esc(msg) + "</span>";
    t.hidden = false; toastClick = o.onClick || null;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, o.long ? 6000 : 3500);
  };
  $("toast").addEventListener("click", () => { $("toast").hidden = true; if (toastClick) toastClick(); });

  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-close]");
    if (c) $(c.dataset.close).close();
    const eye = e.target.closest("[data-eye]");
    if (eye) {
      const input = $(eye.dataset.eye), show = input.type === "password";
      input.type = show ? "text" : "password";
      eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
    }
  });
  // tap outside a sheet closes it
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));

  F.confirm = (title, text, okLabel) => new Promise((resolve) => {
    $("confirmTitle").textContent = title; $("confirmText").textContent = text || "";
    $("confirmOk").textContent = okLabel || "Yes";
    const dlg = $("confirmSheet");
    let answered = false;
    $("confirmOk").onclick = () => { answered = true; dlg.close(); resolve(true); };
    dlg.addEventListener("close", function once() { dlg.removeEventListener("close", once); if (!answered) resolve(false); });
    dlg.showModal();
  });

  /* ---------- themes ---------- */
  F.THEMES = [
    { id: "lavender", name: "Lavender", sw: ["#F7F3FB", "#7556DC"], meta: "#F7F3FB" },
    { id: "blush", name: "Blush", sw: ["#FBF1F4", "#B04A72"], meta: "#FBF1F4" },
    { id: "midnight", name: "Midnight", sw: ["#14101E", "#A890FB"], meta: "#14101E" },
    { id: "night", name: "Night", sw: ["#0F0F13", "#F0A5C7"], meta: "#0F0F13" }
  ];
  F.applyTheme = (id) => {
    const t = F.THEMES.find((x) => x.id === id) || F.THEMES[0];
    document.documentElement.setAttribute("data-theme", t.id);
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute("content", t.meta);
    F.store("funi.theme", t.id);
    F.emit("theme", t.id);
  };
  F.currentTheme = () => document.documentElement.getAttribute("data-theme") || "lavender";

  /* ---------- navigation ---------- */
  const VIEWS = { home: "vHome", study: "vStudy", partners: "vPartners", messages: "vMessages", chat: "vChat", profile: "vProfile" };
  F.go = (target) => {
    const [view, sub] = String(target).split(":");
    if (!VIEWS[view]) return;
    if (view !== "chat") F.s.chatWith = null;
    Object.entries(VIEWS).forEach(([k, id]) => { $(id).hidden = k !== view; });
    F.s.view = view;
    const tabName = view === "chat" ? "messages" : view;
    document.querySelectorAll(".tab[data-tab]").forEach((b) => {
      if (b.dataset.tab === tabName) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    $("fab").hidden = view !== "home";
    $("composer").hidden = view !== "chat";
    if (view !== "chat") window.scrollTo(0, 0);
    F.emit("view:" + view, sub);
  };
  document.querySelectorAll(".tab[data-tab]").forEach((b) => b.addEventListener("click", () => F.go(b.dataset.tab)));
  document.addEventListener("click", (e) => { const g = e.target.closest("[data-go]"); if (g) F.go(g.dataset.go); });

  /* ---------- accounts (username + password, no email) ---------- */
  function setAuthTab(which) {
    const signup = which === "signup";
    $("tabSignup").setAttribute("aria-selected", String(signup));
    $("tabLogin").setAttribute("aria-selected", String(!signup));
    $("signupForm").hidden = !signup; $("loginForm").hidden = signup;
    F.showError("signupError", ""); F.showError("loginError", "");
  }
  $("tabSignup").onclick = () => setAuthTab("signup");
  $("tabLogin").onclick = () => setAuthTab("login");
  const cleanUsername = (raw) => String(raw || "").trim().toLowerCase();
  function usernameProblem(u) {
    if (u.length < 3) return "Your username needs at least 3 characters.";
    if (u.length > 20) return "Keep your username to 20 characters or fewer.";
    if (!/^[a-z0-9_.]+$/.test(u)) return "Use only letters, numbers, dots or underscores. No spaces.";
    return "";
  }

  F.showAuth = () => {
    $("appScreen").hidden = true; $("authScreen").hidden = false;
    $("authArt").innerHTML = window.FuniArt.studyScene({ skin: 4, hair: "puffs", hairColor: 0, hoodie: 0 }, "Happy", "funi");
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  };
  F.showApp = () => {
    $("authScreen").hidden = true; $("appScreen").hidden = false;
    F.go("home");
    F.emit("login");
  };

  $("signupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!F.sb) return F.showError("signupError", "Funi can't reach the internet. Check your connection and try again.");
    const user = cleanUsername($("suUser").value), p1 = $("suPass").value, p2 = $("suPass2").value;
    const bad = usernameProblem(user);
    if (bad) return F.showError("signupError", bad);
    if (p1.length < 6) return F.showError("signupError", "Your password needs at least 6 characters.");
    if (p1 !== p2) return F.showError("signupError", "The two passwords don't match.");
    F.showError("signupError", "");
    $("signupBtn").disabled = true; $("signupBtn").textContent = "Creating…";
    const { data, error } = await F.sb.auth.signUp({ email: user + "@" + F.USERNAME_DOMAIN, password: p1 });
    $("signupBtn").disabled = false; $("signupBtn").textContent = "Create account";
    if (error) {
      const taken = /already|registered|exists/i.test(error.message);
      return F.showError("signupError", taken ? "That username is taken. Try another one." : error.message);
    }
    if (!data.session) return F.showError("signupError", "Account made, but Supabase still wants email confirmation. Turn off 'Confirm email' in Supabase, then log in.");
    F.me = data.user;
    $("suPass").value = ""; $("suPass2").value = "";
    F.showApp();
    F.toast("Welcome to Funi, " + user + "!");
  });

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!F.sb) return F.showError("loginError", "Funi can't reach the internet. Check your connection and try again.");
    const user = cleanUsername($("liUser").value), pass = $("liPass").value;
    if (!user || !pass) return F.showError("loginError", "Enter your username and password.");
    F.showError("loginError", "");
    $("loginBtn").disabled = true; $("loginBtn").textContent = "Logging in…";
    const { data, error } = await F.sb.auth.signInWithPassword({ email: user + "@" + F.USERNAME_DOMAIN, password: pass });
    $("loginBtn").disabled = false; $("loginBtn").textContent = "Log in";
    if (error) return F.showError("loginError", "Wrong username or password. Forgot it? Message Funi support to reset it.");
    F.me = data.user; $("liPass").value = "";
    F.showApp();
  });

  F.logout = async () => {
    F.stopLive();
    if (F.sb) await F.sb.auth.signOut();
    F.me = null;
    Object.assign(F.s, { items: [], modules: [], tasks: [], profile: null, partners: [], invitesIn: [], invitesOut: [], partnerSessions: {}, online: new Set(), convos: {}, notifs: [], chatWith: null });
    document.body.classList.remove("bigclock-mode");
    setAuthTab("login");
    F.showAuth();
    F.toast("Logged out.");
  };

  /* ---------- download / install ---------- */
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  F.isInstalled = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let installPrompt = null;
  if (!F.isInstalled) $("installBtn").hidden = false;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; });
  window.addEventListener("appinstalled", () => { $("installBtn").hidden = true; F.toast("Funi is on your home screen."); });
  F.install = async () => {
    if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; return; }
    $("iosSheet").showModal();
  };
  $("installBtn").onclick = F.install;
  $("installBtn2").onclick = F.install;

  /* ---------- notifications on this device ---------- */
  F.canNotify = () => "Notification" in window && "serviceWorker" in navigator;
  F.enableNotifications = async () => {
    if (!F.canNotify()) {
      if (isIOS && !F.isInstalled) { $("iosSheet").showModal(); return false; }
      F.toast("This browser can't show notifications."); return false;
    }
    const p = await Notification.requestPermission();
    if (p === "granted") { F.systemNotify("Notifications are on", "Funi will pop up when your partners message you or start studying."); F.toast("Notifications are on."); }
    else F.toast("Notifications are off. Turn them on in your phone's Settings › Notifications › Funi.", { long: true });
    F.emit("notifperm", p);
    return p === "granted";
  };
  F.systemNotify = async (title, body, tag) => {
    if (!F.canNotify() || Notification.permission !== "granted") return;
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, { body: body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: tag || undefined });
    } catch (e) {}
  };

  /* ---------- live updates (Supabase Realtime) ---------- */
  let liveChannel = null, onlineChannel = null;
  F.startLive = () => {
    if (!F.sb || !F.me) return;
    F.stopLive();
    const me = F.me.id;
    liveChannel = F.sb.channel("funi-live-" + me)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "study_messages", filter: "recipient_id=eq." + me }, (p) => F.emit("rt:message", p.new))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "study_messages", filter: "sender_id=eq." + me }, (p) => F.emit("rt:messageRead", p.new))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + me }, (p) => F.emit("rt:notification", p.new))
      .on("postgres_changes", { event: "*", schema: "public", table: "study_partners" }, (p) => F.emit("rt:partners", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "study_sessions" }, (p) => F.emit("rt:session", p.new || p.old))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "study_profiles" }, (p) => F.emit("rt:profile", p.new))
      .subscribe((status) => { if (status === "CHANNEL_ERROR") console.warn("Live updates unavailable. Run funi-v2-setup.sql."); });

    onlineChannel = F.sb.channel("funi-online", { config: { presence: { key: me } } });
    onlineChannel
      .on("presence", { event: "sync" }, () => {
        F.s.online = new Set(Object.keys(onlineChannel.presenceState()));
        F.emit("presence");
      })
      .subscribe(async (status) => { if (status === "SUBSCRIBED") await onlineChannel.track({ at: Date.now() }); });
  };
  F.stopLive = () => {
    if (liveChannel && F.sb) F.sb.removeChannel(liveChannel);
    if (onlineChannel && F.sb) F.sb.removeChannel(onlineChannel);
    liveChannel = onlineChannel = null;
  };
  // when the phone wakes the app up again, catch up on anything missed
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && F.me) F.emit("resume"); });
})();
