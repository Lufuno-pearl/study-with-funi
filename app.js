/* Study with Funi — v1
 * - Instant start: every phone gets a private hidden account (Supabase anonymous sign-in, no email).
 * - Optional username + password so the same account works on another device.
 * - Tests/exams live in Supabase (table: assessments), with a local copy for offline.
 * - Notification bell + "Download app" button (iPhone: Add to Home Screen steps).
 */
(function () {
  "use strict";

  const USERNAME_DOMAIN = "users.studywithfuni.app"; // usernames are stored as username@this-domain; no email is ever sent
  const CACHE_KEY = "funi.items.v1";
  const $ = (id) => document.getElementById(id);
  let sb = null;
  let items = [];

  /* ---------- small helpers ---------- */
  function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function todayISO() { return new Date().toLocaleDateString("en-CA"); } // YYYY-MM-DD in local time
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
  function showError(id, msg) { const el = $(id); el.textContent = msg; el.hidden = !msg; }
  function status(msg) { const el = $("status"); el.textContent = msg || ""; el.hidden = !msg; }

  document.querySelectorAll("[data-close]").forEach((b) => {
    b.addEventListener("click", () => $(b.dataset.close).close());
  });

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
    updateNudge();
  }

  /* ---------- account (no emails) ---------- */
  async function currentUser() {
    if (!sb) return null;
    const { data } = await sb.auth.getUser();
    return data ? data.user : null;
  }

  let lastAuthError = "";
  async function ensureSession() {
    if (!sb) { lastAuthError = "Funi isn't connected yet. Check your internet and refresh."; return false; }
    const { data } = await sb.auth.getSession();
    if (data && data.session) return true;
    const { error } = await sb.auth.signInAnonymously();
    if (error) {
      lastAuthError = /anonymous/i.test(error.message)
        ? "Anonymous sign-ins are turned off in Supabase (Authentication › Sign In / Providers)."
        : "Funi couldn't start your account: " + error.message;
      status(lastAuthError);
      return false;
    }
    lastAuthError = "";
    status("");
    return true;
  }

  async function updateGreeting() {
    const u = await currentUser();
    const name = usernameOf(u);
    $("greeting").textContent = name ? "Hi, " + name : "Study with Funi";
  }

  async function updateNudge() {
    const u = await currentUser();
    $("nudge").hidden = !(u && u.is_anonymous && items.length >= 2);
  }

  async function openAccount() {
    const u = await currentUser();
    const saved = u && !u.is_anonymous && u.email;
    $("accSaved").hidden = !saved;
    $("saveForm").hidden = !!saved;
    $("loginForm").hidden = true;
    if (saved) $("accName").textContent = usernameOf(u);
    showError("saveError", ""); showError("loginError", "");
    $("accountDlg").showModal();
  }
  $("accountBtn").onclick = openAccount;
  $("nudgeBtn").onclick = openAccount;
  $("showLogin").onclick = () => { $("saveForm").hidden = true; $("loginForm").hidden = false; };
  $("backToSave").onclick = () => { $("loginForm").hidden = true; $("saveForm").hidden = false; };

  function cleanUsername(raw) { return String(raw || "").trim().toLowerCase(); }
  function validUsername(u) { return /^[a-z0-9_.]{3,20}$/.test(u); }

  $("saveForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = cleanUsername($("sUser").value), pass = $("sPass").value;
    if (!validUsername(user)) return showError("saveError", "Use 3–20 letters, numbers, dots or underscores.");
    if (pass.length < 6) return showError("saveError", "Your password needs at least 6 characters.");
    showError("saveError", "");
    if (!(await ensureSession())) return showError("saveError", lastAuthError);
    const email = user + "@" + USERNAME_DOMAIN;
    let res = await sb.auth.updateUser({ email: email });
    if (res.error) {
      const taken = /already|registered|exists/i.test(res.error.message);
      return showError("saveError", taken ? "That username is taken. Try another one." : res.error.message);
    }
    res = await sb.auth.updateUser({ password: pass });
    if (res.error) return showError("saveError", res.error.message);
    $("accountDlg").close();
    $("sPass").value = "";
    toast("Saved. Log in with " + user + " on any device.");
    updateGreeting(); updateNudge();
  });

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = cleanUsername($("lUser").value), pass = $("lPass").value;
    showError("loginError", "");
    const { error } = await sb.auth.signInWithPassword({ email: user + "@" + USERNAME_DOMAIN, password: pass });
    if (error) return showError("loginError", "Wrong username or password. Forgot it? Message Funi support to reset it.");
    $("accountDlg").close(); $("lPass").value = "";
    toast("Welcome back, " + user + ".");
    await updateGreeting(); await loadItems();
  });

  $("logoutBtn").onclick = async () => {
    await sb.auth.signOut();
    items = []; store(CACHE_KEY, []);
    await ensureSession();
    $("accountDlg").close();
    toast("Logged out.");
    await updateGreeting(); await loadItems();
  };

  /* ---------- tests & exams ---------- */
  async function loadItems() {
    if (!sb) return render();
    const { data, error } = await sb.from("assessments").select("*").gte("due_date", todayISO()).order("due_date");
    if (error) { status("Showing your saved copy. Couldn't reach Funi's server."); render(); return; }
    status("");
    items = data || [];
    store(CACHE_KEY, items);
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
    if (!(await ensureSession())) return showError("addError", lastAuthError);
    $("addSave").disabled = true;
    const { data, error } = await sb.from("assessments").insert(row).select().single();
    $("addSave").disabled = false;
    if (error) return showError("addError", "Couldn't save: " + error.message);
    items.push(data); store(CACHE_KEY, items);
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
    items = items.filter((x) => x.id !== id); store(CACHE_KEY, items); render();
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
    items = read(CACHE_KEY, []);
    render();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    try {
      const res = await fetch("/api/config", { cache: "no-store" });
      const cfg = await res.json();
      if (!cfg.url || !cfg.anonKey) { status("Funi isn't connected to its database yet. Add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel."); return; }
      sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    } catch (e) {
      status("You're offline. Showing your saved countdowns.");
      return;
    }
    if (await ensureSession()) { await updateGreeting(); await loadItems(); }
  }
  start();
})();
