/* Study with Funi — v1.1
 * - Welcome screen: Create account (username, password, confirm) or Log in. No email, no OTP.
 *   Usernames are stored in Supabase as username@users.studywithfuni.app; nothing is ever emailed.
 * - Tests/exams live in Supabase (table: assessments) with a local copy for offline.
 * - Notification bell + "Download app" button (iPhone: Add to Home Screen steps).
 */
(function () {
  "use strict";

  const USERNAME_DOMAIN = "users.studywithfuni.app";
  const CACHE_KEY = "funi.items.v1";
  const $ = (id) => document.getElementById(id);
  let sb = null;
  let me = null;      // the logged-in Supabase user
  let items = [];

  /* ---------- small helpers ---------- */
  function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function todayISO() { return new Date().toLocaleDateString("en-CA"); } // YYYY-MM-DD, local time
  function daysLeft(dateStr) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((new Date(dateStr + "T00:00:00") - t) / 86400000);
  }
  function niceDate(dateStr) {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
  }
  function niceTime(t) { return t ? String(t).slice(0, 5) : ""; }
  function chipClass(n) { return n <= 7 ? "soon" : n <= 21 ? "mid" : "far"; }
  function usernameOf(user) { return user && user.email ? user.email.split("@")[0] : ""; }
  function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function read(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }
  function showError(id, msg) { const el = $(id); el.textContent = msg || ""; el.hidden = !msg; }
  function status(id, msg) { const el = $(id); el.textContent = msg || ""; el.hidden = !msg; }

  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => $(b.dataset.close).close()));
  document.querySelectorAll("[data-eye]").forEach((b) => b.addEventListener("click", () => {
    const input = $(b.dataset.eye);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    b.setAttribute("aria-label", show ? "Hide password" : "Show password");
  }));

  /* ---------- screens ---------- */
  function showAuth() {
    $("appScreen").hidden = true; $("authScreen").hidden = false;
    document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  }
  async function showApp() {
    $("authScreen").hidden = true; $("appScreen").hidden = false;
    $("greeting").textContent = "Hi, " + usernameOf(me);
    items = read(CACHE_KEY + "." + me.id, []);
    render();
    await loadItems();
  }

  /* ---------- create account / log in ---------- */
  function setTab(which) {
    const signup = which === "signup";
    $("tabSignup").setAttribute("aria-selected", String(signup));
    $("tabLogin").setAttribute("aria-selected", String(!signup));
    $("signupForm").hidden = !signup; $("loginForm").hidden = signup;
    showError("signupError", ""); showError("loginError", "");
  }
  $("tabSignup").onclick = () => setTab("signup");
  $("tabLogin").onclick = () => setTab("login");

  function cleanUsername(raw) { return String(raw || "").trim().toLowerCase(); }
  function usernameProblem(u) {
    if (u.length < 3) return "Your username needs at least 3 characters.";
    if (u.length > 20) return "Keep your username to 20 characters or fewer.";
    if (!/^[a-z0-9_.]+$/.test(u)) return "Use only letters, numbers, dots or underscores. No spaces.";
    return "";
  }

  $("signupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sb) return showError("signupError", "Funi can't reach the internet. Check your connection and try again.");
    const user = cleanUsername($("suUser").value), p1 = $("suPass").value, p2 = $("suPass2").value;
    const bad = usernameProblem(user);
    if (bad) return showError("signupError", bad);
    if (p1.length < 6) return showError("signupError", "Your password needs at least 6 characters.");
    if (p1 !== p2) return showError("signupError", "The two passwords don't match.");
    showError("signupError", "");
    $("signupBtn").disabled = true; $("signupBtn").textContent = "Creating…";
    const { data, error } = await sb.auth.signUp({ email: user + "@" + USERNAME_DOMAIN, password: p1 });
    $("signupBtn").disabled = false; $("signupBtn").textContent = "Create account";
    if (error) {
      const taken = /already|registered|exists/i.test(error.message);
      return showError("signupError", taken ? "That username is taken. Try another one." : error.message);
    }
    if (!data.session) {
      return showError("signupError", "Account made, but Supabase is still asking for email confirmation. Turn off 'Confirm email' in Supabase, then log in.");
    }
    me = data.user;
    $("suPass").value = ""; $("suPass2").value = "";
    toast("Welcome to Funi, " + user + "!");
    showApp();
  });

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sb) return showError("loginError", "Funi can't reach the internet. Check your connection and try again.");
    const user = cleanUsername($("liUser").value), pass = $("liPass").value;
    if (!user || !pass) return showError("loginError", "Enter your username and password.");
    showError("loginError", "");
    $("loginBtn").disabled = true; $("loginBtn").textContent = "Logging in…";
    const { data, error } = await sb.auth.signInWithPassword({ email: user + "@" + USERNAME_DOMAIN, password: pass });
    $("loginBtn").disabled = false; $("loginBtn").textContent = "Log in";
    if (error) return showError("loginError", "Wrong username or password. Forgot it? Message Funi support to reset it.");
    me = data.user;
    $("liPass").value = "";
    toast("Welcome back, " + user + ".");
    showApp();
  });

  $("accountBtn").onclick = () => { $("accName").textContent = usernameOf(me); $("accountDlg").showModal(); };
  $("logoutBtn").onclick = async () => {
    if (sb) await sb.auth.signOut();
    me = null; items = [];
    setTab("login");
    showAuth();
    toast("Logged out.");
  };

  /* ---------- rendering ---------- */
  function upcoming() {
    const today = todayISO();
    return items.filter((x) => x.due_date >= today).sort((a, b) =>
      (a.due_date + (a.start_time || "")).localeCompare(b.due_date + (b.start_time || "")));
  }

  function render() {
    $("today").textContent = new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
    const list = upcoming();
    const hero = $("hero");

    if (!list.length) {
      hero.innerHTML = '<div class="empty"><b>No tests or exams yet</b><span>Tap <strong>Add test or exam</strong> and Funi starts counting down.</span></div>';
      $("listWrap").hidden = true;
    } else {
      const n = list[0], d = daysLeft(n.due_date);
      const big = d === 0 ? "Today" : String(d);
      const what = d === 0 ? "Good luck!" : (d === 1 ? "day left" : "days left");
      hero.innerHTML =
        '<div class="hero"><span class="eyebrow">NEXT UP</span>' +
        '<div class="row"><span class="num">' + big + '</span><div><div class="what">' + what + '</div>' +
        '<div class="sub">' + esc(n.module) + " · " + esc(n.kind) + "</div></div></div>" +
        '<span class="sub">' + niceDate(n.due_date) + (n.start_time ? " · " + niceTime(n.start_time) : "") +
        (n.venue ? " · " + esc(n.venue) : "") + "</span></div>";

      const rest = list.slice(1);
      $("listWrap").hidden = !rest.length;
      $("list").innerHTML = rest.map((x) => {
        const dl = daysLeft(x.due_date);
        return '<div class="item"><div class="txt"><b>' + esc(x.module) + " · " + esc(x.kind) + "</b><span>" +
          niceDate(x.due_date) + (x.start_time ? " · " + niceTime(x.start_time) : "") + (x.venue ? " · " + esc(x.venue) : "") +
          '</span></div><span class="chip ' + chipClass(dl) + '">' + dl + " d</span>" +
          '<button class="del" data-id="' + esc(x.id) + '" aria-label="Delete ' + esc(x.module) + '">×</button></div>';
      }).join("");
    }

    const soon = list.filter((x) => daysLeft(x.due_date) <= 7).length;
    $("badge").hidden = !soon; $("badge").textContent = soon;
  }

  /* ---------- tests & exams ---------- */
  function saveCache() { if (me) store(CACHE_KEY + "." + me.id, items); }

  async function loadItems() {
    if (!sb || !me) return render();
    const { data, error } = await sb.from("assessments").select("*").gte("due_date", todayISO()).order("due_date");
    if (error) { status("status", "Showing your saved copy. Couldn't reach Funi's server."); render(); return; }
    status("status", "");
    items = data || [];
    saveCache();
    render();
    dailyCheck();
  }

  $("addBtn").onclick = () => {
    $("addForm").reset(); $("fTime").value = "09:00"; $("fDate").min = todayISO();
    showError("addError", ""); $("addDlg").showModal();
  };

  $("addForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sb) return showError("addError", "You're offline. Connect to the internet to add a test.");
    const row = {
      module: $("fModule").value.trim(),
      kind: $("fKind").value,
      due_date: $("fDate").value,
      start_time: $("fTime").value || null,
      venue: $("fVenue").value.trim() || null
    };
    if (!row.module || !row.due_date) return showError("addError", "Add the module and the date.");
    $("addSave").disabled = true;
    const { data, error } = await sb.from("assessments").insert(row).select().single();
    $("addSave").disabled = false;
    if (error) return showError("addError", "Couldn't save: " + error.message);
    items.push(data); saveCache();
    $("addDlg").close(); render();
    const d = daysLeft(data.due_date);
    toast(d === 0 ? "Saved. It's today, you've got this!" : "Saved. " + d + (d === 1 ? " day" : " days") + " to go.");
  });

  $("list").addEventListener("click", async (e) => {
    const btn = e.target.closest(".del");
    if (!btn || !sb) return;
    const id = btn.dataset.id;
    const { error } = await sb.from("assessments").delete().eq("id", id);
    if (error) return toast("Couldn't delete: " + error.message);
    items = items.filter((x) => x.id !== id); saveCache(); render();
    toast("Deleted.");
  });

  /* ---------- download / install ---------- */
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isInstalled = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let installPrompt = null;
  if (!isInstalled && isIOS) $("installBtn").hidden = false;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; $("installBtn").hidden = false; });
  window.addEventListener("appinstalled", () => { $("installBtn").hidden = true; toast("Funi is on your home screen."); });
  $("installBtn").onclick = async () => {
    if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $("installBtn").hidden = true; }
    else $("iosDlg").showModal();
  };

  /* ---------- notification bell ---------- */
  function weekSummary() {
    const soon = upcoming().filter((x) => daysLeft(x.due_date) <= 7);
    if (!soon.length) return "Nothing in the next 7 days. Keep going!";
    return soon.map((x) => {
      const d = daysLeft(x.due_date);
      return x.module + " " + x.kind.toLowerCase() + (d === 0 ? " today" : " in " + d + (d === 1 ? " day" : " days"));
    }).join(" · ");
  }
  async function notify(title, body) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, { body: body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" });
    } catch (e) {}
  }
  $("bellBtn").onclick = async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      if (isIOS && !isInstalled) { $("iosDlg").showModal(); return; }
      toast("This browser can't show notifications."); return;
    }
    const p = await Notification.requestPermission();
    if (p === "granted") { notify("Funi reminders are on", weekSummary()); toast("Reminders are on."); }
    else toast("Reminders are off. Turn them on in Settings › Notifications › Funi.");
  };
  function dailyCheck() {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const today = todayISO();
    if (read("funi.lastNotified", "") === today) return;
    store("funi.lastNotified", today);
    if (upcoming().some((x) => daysLeft(x.due_date) <= 7)) notify("This week with Funi", weekSummary());
  }

  /* ---------- start ---------- */
  async function start() {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      const cfg = await res.json();
      if (!cfg.url || !cfg.anonKey) {
        showAuth(); status("authStatus", "Funi isn't connected to its database yet. Add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel.");
        return;
      }
      sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    } catch (e) {
      showAuth(); status("authStatus", "You're offline. Connect to the internet to log in.");
      return;
    }
    const { data } = await sb.auth.getSession();
    const user = data && data.session ? data.session.user : null;
    if (user && !user.is_anonymous && user.email) { me = user; showApp(); }
    else {
      if (user) await sb.auth.signOut(); // clear any old hidden account from the first version
      showAuth();
    }
  }
  start();
})();
