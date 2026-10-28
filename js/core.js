/* Funi core: helpers, themes, navigation, accounts, notifications (in-app + phone push), live updates. */
(function () {
  "use strict";

  const F = (window.Funi = {
    sb: null, me: null, cfg: {},
    s: { items: [], modules: [], tasks: [], sessions: [], profile: null, partners: [], invitesIn: [], invitesOut: [],
         partnerSessions: {}, online: new Set(), convos: {}, notifs: [], chatWith: null, view: "dash" },
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
  F.usernameOf = (user) => {
    if (!user) return "";
    const m = user.user_metadata || {};
    if (m.username) return String(m.username).toLowerCase();
    return user.email ? user.email.split("@")[0] : "";
  };
  // old accounts were made before emails, with a made-up address
  F.hasRealEmail = (user) => !!(user && user.email && !user.email.endsWith("@" + "users.studywithfuni.app"));
  F.nameOf = (p) => (p ? (p.display_name && p.display_name.trim()) || p.username || "Study partner" : "Study partner");
  F.showError = (id, msg) => { const el = $(id); if (!el) return; el.textContent = msg || ""; el.hidden = !msg; };
  F.status = (id, msg) => F.showError(id, msg);
  F.isPhoto = (a) => typeof a === "string" && a.indexOf("photo:") === 0;
  // a person's picture: their uploaded photo, or their cartoon showing how they feel
  F.avatar = (p, feeling) => {
    if (p && F.isPhoto(p.avatar)) return '<img class="ava-photo" src="' + F.esc(p.avatar.slice(6)) + '" alt="">';
    return window.FuniArt.avatarSVG(p && p.avatar, feeling || (p && p.feeling) || "Happy", p && p.id);
  };
  F.face = (f) => window.FuniArt.feelingSVG(f);
  F.FEELING_NOTES = { "Feeling great": "On top of it today", "Happy": "Things are going well", "Okay": "Getting through it",
    "Confused": "Some of this isn't clicking", "Stressed": "A lot on my plate", "Need help": "Your partners will be told" };

  let toastTimer = null, toastClick = null;
  F.looksOffline = (err) => !navigator.onLine || !!(err && /fetch|network|load failed|offline|retryable|timed? ?out/i.test((err.name || "") + " " + (err.message || err)));
  // the login saved on this phone (used only when there's no internet to check it)
  F.savedSession = () => {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (/^sb-.*-auth-token$/.test(k)) { const v = JSON.parse(localStorage.getItem(k)); if (v && v.user && v.user.id && v.access_token) return { key: k, session: v }; }
      }
    } catch (e) {}
    return null;
  };
  F.toast = (msg, opts) => {
    const o = opts || {}, t = $("toast");
    if (typeof msg === "string" && /failed to fetch|networkerror|load failed|you're offline"?$/i.test(msg) && F.looksOffline(msg))
      msg = "You're offline. This needs internet. Your saved stuff still works.";
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
    { id: "lavender", name: "Lavender", sw: ["#FAF5F4", "#7556DC"], meta: "#FAF5F4" },
    { id: "blush", name: "Blush", sw: ["#FBF1F4", "#B04A72"], meta: "#FBF1F4" },
    { id: "ocean", name: "Ocean", sw: ["#EEF3FF", "#3550D4"], meta: "#EEF3FF" },
    { id: "navy", name: "Deep navy", sw: ["#0E1528", "#7D95FF"], meta: "#0E1528" },
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
  const VIEWS = { dash: "vDash", hub: "vHub", study: "vStudy", plan: "vPlan", priorities: "vPriorities", marks: "vMarks",
    reminders: "vReminders", exams: "vExams", partners: "vPartners", invite: "vInvite", feeling: "vFeeling",
    messages: "vMessages", chat: "vChat", notifs: "vNotifs", profile: "vProfile", files: "vFiles", modfiles: "vModFiles",
    share: "vShare", rooms: "vRooms", room: "vRoom", board: "vBoard", garden: "vGarden", decks: "vDecks", deck: "vDeck", flash: "vFlash", battle: "vBattle", house: "vHouse", fc: "vFc", call: "vCall" };
  const TAB_OF = { dash: "dash", notifs: "dash", hub: "hub", plan: "hub", priorities: "hub", marks: "hub", reminders: "hub", exams: "hub",
    profile: "hub", files: "hub", modfiles: "hub", share: "hub", rooms: "partners", room: "partners", board: "partners", garden: "partners", decks: "partners", deck: "partners", flash: "partners", battle: "partners", house: "partners", fc: "partners", call: "partners", study: "study", partners: "partners", invite: "partners", feeling: "partners", messages: "messages", chat: "messages" };
  const history = [];
  F.go = (target, opts) => {
    const [view, sub] = String(target).split(":");
    if (!VIEWS[view]) return;
    if (!(opts && opts.back) && F.s.view && F.s.view !== view) history.push(F.s.view);
    if (history.length > 30) history.shift();
    if (view !== "chat") F.s.chatWith = null;
    Object.entries(VIEWS).forEach(([k, id]) => { $(id).hidden = k !== view; });
    F.s.view = view;
    const tab = TAB_OF[view];
    document.querySelectorAll(".tab[data-tab]").forEach((b) => {
      if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    $("composer").hidden = view !== "chat";
    document.body.classList.toggle("in-chat", view === "chat");
    if (view !== "chat") window.scrollTo(0, 0);
    F.emit("view:" + view, sub);
  };
  F.back = () => {
    let prev = history.pop();
    while (prev && prev === F.s.view) prev = history.pop();
    F.go(prev || TAB_OF[F.s.view] || "dash", { back: true });
  };
  document.querySelectorAll(".tab[data-tab]").forEach((b) => b.addEventListener("click", () => { history.length = 0; F.go(b.dataset.tab); }));
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-go]"); if (g) { F.go(g.dataset.go); return; }
    if (e.target.closest("[data-back]")) F.back();
  });
  // links from phone notifications: /#reminders, /#invites, /#partners, /#chat-<id>
  F.openLink = (url) => {
    const h = String(url || "").split("#")[1] || "";
    if (!h || !F.me) return;
    if (h.indexOf("chat-") === 0 && F.openChat) F.openChat(h.slice(5));
    else if (h === "invites") F.go("partners:invites");
    else if (h === "reminders") F.go("reminders");
    else if (h === "partners") F.go("partners");
    else if (h === "study") F.go("study");
    else if (h.indexOf("room-") === 0) F.go("room:" + h.slice(5));
    else if (h.indexOf("battle-") === 0) F.go("battle:" + h.slice(7));
    else if (h.indexOf("deck-") === 0) F.go("deck:" + h.slice(5));
    else if (h === "decks") F.go("decks:shared");
    else if (h.indexOf("share-") === 0) F.go("share:" + h.slice(6));
    else if (h.indexOf("house-") === 0) F.go("house:" + h.slice(6));
    else if (h === "house") F.go("house");
    else if (h === "fc") F.go("fc");
    try { window.history.replaceState(null, "", "/"); } catch (e) {}
  };
  window.addEventListener("hashchange", () => { if (F.me && location.hash.length > 1) F.openLink(location.href); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "open") F.openLink(e.data.url); });

  /* ---------- accounts: username + verified email + password ---------- */
  const PANELS = ["signupForm", "loginForm", "forgotForm", "checkEmail", "newPassForm"];
  function authPanel(name) {
    PANELS.forEach((id) => { $(id).hidden = id !== name; });
    const tabs = name === "signupForm" || name === "loginForm";
    document.querySelector("#authScreen .seg").hidden = !tabs;
    $("tabSignup").setAttribute("aria-selected", String(name === "signupForm"));
    $("tabLogin").setAttribute("aria-selected", String(name === "loginForm"));
    ["signupError", "loginError", "forgotError", "ceError", "npError"].forEach((id) => F.showError(id, ""));
    if (name === "signupForm") showSpots();
  }
  F.authPanel = authPanel;
  function setAuthTab(which) { authPanel(which === "signup" ? "signupForm" : "loginForm"); }
  $("tabSignup").onclick = () => setAuthTab("signup");
  $("tabLogin").onclick = () => setAuthTab("login");
  const cleanUsername = (raw) => String(raw || "").trim().toLowerCase();
  const cleanEmail = (raw) => String(raw || "").trim().toLowerCase();
  const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  const home = () => location.origin + "/";
  function usernameProblem(u) {
    if (u.length < 3) return "Your username needs at least 3 characters.";
    if (u.length > 20) return "Keep your username to 20 characters or fewer.";
    if (!/^[a-z0-9_.]+$/.test(u)) return "Use only letters, numbers, dots or underscores. No spaces.";
    return "";
  }
  async function signupStatus(user) {
    if (!F.sb) return null;
    const { data, error } = await F.sb.rpc("funi_signup_status", { p_username: user || null });
    return error ? null : data;
  }
  async function showSpots() {
    const st = await signupStatus();
    if (!st) return;
    $("spotsLine").textContent = st.spots_left > 0
      ? "We'll email you a link to confirm it's you. " + st.spots_left + " of " + st.max + " spots left."
      : "Funi is full right now (" + st.max + " people). Ask Funi to open more spots.";
  }
  let pendingEmail = "", pendingKind = "signup";
  function showCheckEmail(email, kind) {
    pendingEmail = email; pendingKind = kind || "signup";
    $("ceTitle").textContent = pendingKind === "reset" ? "Check your email" : "Confirm your email";
    $("ceText").textContent = pendingKind === "reset"
      ? "If " + email + " has a Funi account, we sent it a link to choose a new password."
      : "We sent a link to " + email + ". Tap it to confirm, then you're in!";
    $("ceResend").hidden = pendingKind === "reset";
    authPanel("checkEmail");
  }
  /* Female / Male: sets the starting theme and avatar (both can be changed later in Profile) */
  F.START_LOOK = {
    female: [{ skin: 4, hair: "puffs", hairColor: 0, hoodie: 0 }, { skin: 2, hair: "afro", hairColor: 1, hoodie: 1 }, { skin: 5, hair: "braids", hairColor: 0, hoodie: 3 }],
    male: [{ skin: 4, hair: "beanie", hairColor: 0, hoodie: 5, phones: true }, { skin: 1, hair: "beanie", hairColor: 3, hoodie: 5, phones: true }]
  };
  F.START_THEME = { female: "lavender", male: "ocean" };
  F.startLookFor = (sx, id) => { const l = F.START_LOOK[sx]; return l[Math.abs([...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % l.length]; };
  let signSex = "";
  function drawAuthArt() {
    $("authArt").innerHTML = window.FuniArt.dreamyScene(signSex === "male" ? F.START_LOOK.male[0] : F.START_LOOK.female[0], "Happy", "funi");
  }
  function pickSex(sx) {
    signSex = sx;
    document.querySelectorAll("#suSex [data-sex]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.sex === sx)));
    $("suSexHint").textContent = sx === "male"
      ? "You'll start with the blue Ocean theme and a guy avatar. Change both anytime."
      : "You'll start with the Lavender theme and a girl avatar. Change both anytime.";
    F.applyTheme(F.START_THEME[sx]);
    drawAuthArt();
  }
  $("suSex").addEventListener("click", (e) => { const b = e.target.closest("[data-sex]"); if (b) { pickSex(b.dataset.sex); F.showError("signupError", ""); } });
  $("suSex").addEventListener("keydown", (e) => {
    if (!/^Arrow/.test(e.key)) return;
    e.preventDefault(); const nx = signSex === "male" ? "female" : "male"; pickSex(nx); document.querySelector('[data-sex="' + nx + '"]').focus();
  });
  F.showAuth = () => {
    $("appScreen").hidden = true; $("authScreen").hidden = false;
    drawAuthArt();
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
    if ($("signupForm").hidden === false) showSpots();
  };
  F.showApp = () => {
    $("authScreen").hidden = true; $("appScreen").hidden = false;
    history.length = 0;
    F.go("dash");
    F.emit("login");
  };
  $("signupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!F.sb) return F.showError("signupError", "Funi can't reach the internet. Check your connection and try again.");
    const user = cleanUsername($("suUser").value), email = cleanEmail($("suEmail").value), p1 = $("suPass").value, p2 = $("suPass2").value;
    if (!signSex) return F.showError("signupError", "Choose Female or Male first.");
    const bad = usernameProblem(user);
    if (bad) return F.showError("signupError", bad);
    if (!emailOk(email)) return F.showError("signupError", "Type your full email, like you@gmail.com.");
    if (p1.length < 6) return F.showError("signupError", "Your password needs at least 6 characters.");
    if (p1 !== p2) return F.showError("signupError", "The two passwords don't match.");
    F.showError("signupError", "");
    const busy = (on) => { $("signupBtn").disabled = on; $("signupBtn").textContent = on ? "Creating…" : "Create account"; };
    busy(true);
    const st = await signupStatus(user);
    if (st && st.spots_left <= 0) { busy(false); return F.showError("signupError", "Sorry, Funi is full right now (" + st.max + " people)."); }
    if (st && !st.username_free) { busy(false); return F.showError("signupError", "That username is taken. Try another one."); }
    const { data, error } = await F.sb.auth.signUp({ email, password: p1, options: { data: { username: user, sex: signSex }, emailRedirectTo: home() } });
    busy(false);
    if (error) {
      const m = error.message || "";
      if (/already|registered|exists/i.test(m)) return F.showError("signupError", "That email already has a Funi account. Log in instead.");
      if (/rate limit|too many/i.test(m)) return F.showError("signupError", "Too many sign-ups right now. Please try again in an hour.");
      if (/database error/i.test(m)) {
        const again = await signupStatus(user);
        if (again && again.spots_left <= 0) return F.showError("signupError", "Sorry, Funi is full right now (" + again.max + " people).");
        if (again && !again.username_free) return F.showError("signupError", "That username is taken. Try another one.");
      }
      if (/sending|smtp|email/i.test(m)) return F.showError("signupError", "We couldn't send the confirmation email. Tell Funi support: " + m);
      return F.showError("signupError", m);
    }
    // Supabase hides whether an email is used: a used email comes back with no identities
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
      return F.showError("signupError", "That email already has a Funi account. Log in instead.");
    $("suPass").value = ""; $("suPass2").value = "";
    if (data.session) { F.me = data.user; F.showApp(); F.toast("Welcome to Funi, " + user + "! Pick your avatar in your profile.", { long: true, onClick: () => F.go("profile") }); return; }
    showCheckEmail(email, "signup");
  });
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!F.sb) return F.showError("loginError", "Funi can't reach the internet. Check your connection and try again.");
    const who = $("liUser").value.trim(), pass = $("liPass").value;
    if (!who || !pass) return F.showError("loginError", "Enter your username (or email) and password.");
    F.showError("loginError", "");
    const busy = (on) => { $("loginBtn").disabled = on; $("loginBtn").textContent = on ? "Logging in…" : "Log in"; };
    busy(true);
    let email = who.includes("@") ? cleanEmail(who) : "";
    if (!email) {
      const { data, error } = await F.sb.rpc("funi_login_email", { p_username: cleanUsername(who), p_password: pass });
      if (error && /FUNI_TOO_MANY/.test(error.message)) { busy(false); return F.showError("loginError", "Too many wrong tries. Wait 15 minutes, or reset your password."); }
      if (error) email = cleanUsername(who) + "@" + F.USERNAME_DOMAIN; // database not updated yet: old-style accounts
      else if (!data) { busy(false); return F.showError("loginError", "Wrong username or password."); }
      else email = data;
    }
    const { data, error } = await F.sb.auth.signInWithPassword({ email, password: pass });
    busy(false);
    if (error) {
      if (/not confirmed/i.test(error.message)) { showCheckEmail(email, "signup"); F.showError("ceError", "Confirm your email first, then log in."); return; }
      return F.showError("loginError", who.includes("@") ? "Wrong email or password." : "Wrong username or password.");
    }
    F.me = data.user; $("liPass").value = "";
    F.showApp();
  });
  // forgot password → email link → choose a new one
  $("forgotBtn").onclick = () => { const v = $("liUser").value.trim(); $("fgEmail").value = v.includes("@") ? v : ""; authPanel("forgotForm"); $("fgEmail").focus(); };
  $("forgotBack").onclick = () => authPanel("loginForm");
  $("forgotForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = cleanEmail($("fgEmail").value);
    if (!emailOk(email)) return F.showError("forgotError", "Type the email on your Funi account.");
    $("forgotSend").disabled = true;
    const { error } = await F.sb.auth.resetPasswordForEmail(email, { redirectTo: home() });
    $("forgotSend").disabled = false;
    if (error && /rate limit|too many|seconds/i.test(error.message)) return F.showError("forgotError", "Please wait a minute before asking again.");
    if (error) return F.showError("forgotError", error.message);
    showCheckEmail(email, "reset");
  });
  $("ceResend").onclick = async () => {
    if (!pendingEmail) return;
    $("ceResend").disabled = true;
    const { error } = await F.sb.auth.resend({ type: "signup", email: pendingEmail, options: { emailRedirectTo: home() } });
    $("ceResend").disabled = false;
    if (error) return F.showError("ceError", /seconds|rate/i.test(error.message) ? "Please wait a minute before sending again." : error.message);
    F.toast("Sent again to " + pendingEmail + ".");
  };
  $("ceBack").onclick = () => { if (pendingEmail) $("liUser").value = pendingEmail; authPanel("loginForm"); $("liPass").focus(); };
  F.showNewPassword = () => { F.showAuth(); authPanel("newPassForm"); };
  $("newPassForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const p1 = $("npPass").value, p2 = $("npPass2").value;
    if (p1.length < 6) return F.showError("npError", "Your password needs at least 6 characters.");
    if (p1 !== p2) return F.showError("npError", "The two passwords don't match.");
    $("npSave").disabled = true;
    const { data, error } = await F.sb.auth.updateUser({ password: p1 });
    $("npSave").disabled = false;
    if (error) return F.showError("npError", /expired|session/i.test(error.message) ? "That link expired. Ask for a new one from Log in › Forgot your password." : error.message);
    $("npPass").value = ""; $("npPass2").value = "";
    F.me = data.user; F.showApp(); F.toast("New password saved. You're logged in.");
  });
  F.logout = async () => {
    F.stopLive();
    await F.unsubscribePush();
    if (F.sb) await F.sb.auth.signOut();
    // remove this account's offline copies from the phone
    try { if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.filter((k) => k === "funi-data" || k.startsWith("funi-files-")).map((k) => caches.delete(k))); } } catch (e) {}
    F.me = null; F.startedOffline = false; if (F.offlineBar) F.offlineBar();
    Object.assign(F.s, { items: [], modules: [], tasks: [], sessions: [], profile: null, partners: [], invitesIn: [], invitesOut: [], partnerSessions: {}, online: new Set(), convos: {}, notifs: [], chatWith: null });
    document.body.classList.remove("bigclock-mode");
    F.showAuth(); setAuthTab("login");
    F.toast("Logged out.");
  };

  /* ---------- download / install ---------- */
  const isIOS = (F.isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
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
  F.pushOn = false;
  function b64ToBytes(b64) {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }
  // register this phone with Funi's server so alerts arrive even when the app is closed
  F.subscribePush = async () => {
    F.pushOn = false;
    if (!F.canNotify() || Notification.permission !== "granted" || !("PushManager" in window) || !F.cfg.vapidPublic || !F.me) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(F.cfg.vapidPublic) });
      const j = sub.toJSON();
      const { error } = await F.sb.from("push_subscriptions").upsert({ user_id: F.me.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
      if (error) { console.warn("push save", error.message); return false; }
      F.pushOn = true; return true;
    } catch (e) { console.warn("push", e); return false; }
  };
  F.unsubscribePush = async () => {
    try {
      if (!("serviceWorker" in navigator)) return;
      const reg = await navigator.serviceWorker.ready;
      const sub = reg.pushManager && (await reg.pushManager.getSubscription());
      if (sub) { if (F.sb) await F.sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
    } catch (e) {}
    F.pushOn = false;
  };
  F.enableNotifications = async () => {
    if (!F.canNotify()) {
      if (isIOS && !F.isInstalled) { $("iosSheet").showModal(); return false; }
      F.toast("This browser can't show notifications."); return false;
    }
    const p = await Notification.requestPermission();
    if (p === "granted") {
      const push = await F.subscribePush();
      F.toast(push ? "Notifications are on, even when Funi is closed." : "Notifications are on while Funi is open.", { long: true });
    } else F.toast("Notifications are off. Turn them on in your phone's Settings › Notifications › Funi.", { long: true });
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
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "study_messages", filter: "recipient_id=eq." + me }, (p) => F.emit("rt:messageUpdate", p.new))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + me }, (p) => F.emit("rt:notification", p.new))
      .on("postgres_changes", { event: "*", schema: "public", table: "study_partners" }, (p) => F.emit("rt:partners", p))
      .on("postgres_changes", { event: "*", schema: "public", table: "study_sessions" }, (p) => F.emit("rt:session", p.new || p.old))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "study_profiles" }, (p) => F.emit("rt:profile", p.new))
      .subscribe((status) => { if (status === "CHANNEL_ERROR") console.warn("Live updates unavailable. Run funi-v2-setup.sql."); });
    onlineChannel = F.sb.channel("funi-online", { config: { presence: { key: me } } });
    onlineChannel
      .on("presence", { event: "sync" }, () => { F.s.online = new Set(Object.keys(onlineChannel.presenceState())); F.emit("presence"); })
      .subscribe(async (status) => { if (status === "SUBSCRIBED") await onlineChannel.track({ at: Date.now() }); });
  };
  F.stopLive = () => {
    if (liveChannel && F.sb) F.sb.removeChannel(liveChannel);
    if (onlineChannel && F.sb) F.sb.removeChannel(onlineChannel);
    liveChannel = onlineChannel = null;
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && F.me) F.emit("resume"); });
})();
