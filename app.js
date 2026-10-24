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
    openTab("tabHome");
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
    await loadModules();
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

  /* ---------- bottom tabs ---------- */
  function openTab(id) {
    ["tabHome", "tabPlan", "tabModules", "tabFocus", "tabMarks"].forEach((t) => { $(t).hidden = t !== id; });
    if (id === "tabPlan") renderPlan();
    if (id === "tabModules") renderModules();
    document.querySelectorAll(".tab[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
    window.scrollTo(0, 0);
  }
  document.querySelectorAll(".tab[data-tab]").forEach((b) => b.addEventListener("click", () => openTab(b.dataset.tab)));
  $("goPlan").onclick = () => openTab("tabPlan");

  /* ---------- focus timer ---------- */
  let fLeft = 25 * 60, fTimer = null, fBreak = false;
  function fDraw() {
    const m = Math.floor(fLeft / 60), s = fLeft % 60;
    $("focusClock").textContent = (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  function fStop() { clearInterval(fTimer); fTimer = null; }
  $("focusStart").onclick = () => {
    if (fTimer) { fStop(); $("focusStart").textContent = "Resume"; $("focusLabel").textContent = "PAUSED"; return; }
    $("focusStart").textContent = "Pause";
    $("focusLabel").textContent = fBreak ? "BREAK TIME" : "FOCUSING";
    fTimer = setInterval(() => {
      fLeft--; fDraw();
      if (fLeft > 0) return;
      fStop();
      if (!fBreak) {
        const key = "funi.focus." + todayISO(); const n = read(key, 0) + 1; store(key, n);
        $("focusDone").textContent = "Sessions finished today: " + n;
        notify("Focus session done", "Take a 5 minute break. You earned it.");
        fBreak = true; fLeft = 5 * 60; $("focusLabel").textContent = "BREAK READY";
      } else {
        notify("Break's over", "Ready for another 25 minutes?");
        fBreak = false; fLeft = 25 * 60; $("focusLabel").textContent = "READY WHEN YOU ARE";
      }
      $("focusStart").textContent = fBreak ? "Start break" : "Start focus"; fDraw();
    }, 1000);
  };
  $("focusReset").onclick = () => {
    fStop(); fBreak = false; fLeft = 25 * 60; fDraw();
    $("focusStart").textContent = "Start focus"; $("focusLabel").textContent = "READY WHEN YOU ARE";
  };
  $("focusDone").textContent = "Sessions finished today: " + read("funi.focus." + todayISO(), 0);

  /* ---------- what do I need? ---------- */
  function marks() {
    const cm = +$("mClass").value, w = +$("mWeight").value / 100, sub = +$("mSub").value;
    $("mClassV").textContent = cm + "%"; $("mWeightV").textContent = Math.round(w * 100) + "%"; $("mSubV").textContent = sub + "%";
    const need = (t) => Math.max(0, Math.ceil(Math.max((t - cm * (1 - w)) / w, sub)));
    const fmt = (n) => (n > 100 ? "Out of reach" : n + "%");
    const p = need(50);
    $("mPass").textContent = p > 100 ? "—" : p + "%";
    $("mNote").textContent = p > 100 ? "This exam alone can't get you there. Ask about a supp or deferred exam."
      : p <= sub ? "Your class mark carries you. Just clear the subminimum."
      : "That's " + Math.max(0, p - cm) + " points above your class mark.";
    $("m60").textContent = fmt(need(60)); $("m75").textContent = fmt(need(75));
  }
  ["mClass", "mWeight", "mSub"].forEach((id) => $(id).addEventListener("input", marks));
  let marksModule = null, marksSaveTimer = null;
  $("mClass").addEventListener("change", () => {
    if (!marksModule || !sb) return;
    const val = +$("mClass").value;
    clearTimeout(marksSaveTimer);
    marksSaveTimer = setTimeout(async () => {
      const { error } = await sb.from("modules").update({ class_mark: val }).eq("id", marksModule.id);
      if (!error) { marksModule.class_mark = val; toast("Class mark saved for " + marksModule.code + "."); }
    }, 300);
  });
  function openMarksFor(mod) {
    marksModule = mod;
    $("marksFor").textContent = mod.code + (mod.name ? " · " + mod.name : "") + ". Your class mark saves automatically.";
    if (mod.class_mark != null) $("mClass").value = mod.class_mark;
    marks(); openTab("tabMarks");
  }
  marks();

  /* ---------- modules: what matters most ---------- */
  let modules = [];
  async function loadModules() {
    if (!sb || !me) return;
    const { data, error } = await sb.from("modules").select("*").order("priority", { ascending: true, nullsFirst: false }).order("created_at");
    if (!error) { modules = data || []; store("funi.mods." + me.id, modules); }
    else modules = read("funi.mods." + me.id, []);
  }
  const READY = ["", "Lost", "Shaky", "Okay", "Good", "Ready"];
  function renderModules() {
    const box = $("modList");
    if (!modules.length) {
      box.innerHTML = '<div class="empty"><b>No modules yet</b><span>Add your modules below. Funi also picks up modules from your tests and exams.</span></div>';
      suggestModules(); return;
    }
    box.innerHTML = modules.map((m, i) => {
      const conf = m.confidence || 3;
      let dots = "";
      for (let k = 1; k <= 5; k++) dots += '<button type="button" class="dot' + (k <= conf ? " on" : "") + (conf <= 2 ? " low" : "") + '" data-conf="' + k + '" data-id="' + esc(m.id) + '" aria-label="Readiness ' + k + ' of 5"></button>';
      const exam = nextExamFor(m.code);
      return '<div class="mod"><span class="rank">' + (i + 1) + '</span><div class="body">' +
        "<b>" + esc(m.code) + (m.name ? " · " + esc(m.name) : "") + "</b>" +
        "<span>" + (exam ? exam.kind + " in " + daysLeft(exam.due_date) + " days" : "No test or exam added") + (m.class_mark != null ? " · class mark " + m.class_mark + "%" : "") + "</span>" +
        '<div class="dots">' + dots + "<em>" + READY[conf] + "</em></div>" +
        '<div class="mod-links"><button type="button" data-need="' + esc(m.id) + '">What do I need?</button><button type="button" class="rm" data-rm="' + esc(m.id) + '">Remove</button></div>' +
        '</div><div class="acts"><button type="button" class="arrow" data-up="' + i + '" aria-label="Move up">▲</button><button type="button" class="arrow" data-down="' + i + '" aria-label="Move down">▼</button></div></div>';
    }).join("");
    suggestModules();
  }
  // Offer modules that appear in tests/exams but aren't in the list yet
  function suggestModules() {
    const have = new Set(modules.map((m) => m.code.toUpperCase()));
    const missing = [...new Set(items.map((x) => x.module.trim()))].filter((c) => c && !have.has(c.toUpperCase()));
    if (!missing.length) return;
    $("modList").insertAdjacentHTML("beforeend", '<div class="nudge"><span>From your tests: ' + missing.map(esc).join(", ") + '</span><button class="link-btn" type="button" id="addMissing">Add them</button></div>');
    $("addMissing").onclick = async () => {
      for (const code of missing) await addModule(code, "");
      renderModules();
    };
  }
  function nextExamFor(code) {
    return upcoming().find((x) => x.module.trim().toUpperCase() === String(code).trim().toUpperCase());
  }
  async function addModule(code, name) {
    const row = { code: code.trim().toUpperCase(), name: name.trim() || null, priority: modules.length + 1, confidence: 3 };
    const { data, error } = await sb.from("modules").insert(row).select().single();
    if (error) { showError("modError", "Couldn't add: " + error.message); return false; }
    modules.push(data); store("funi.mods." + me.id, modules); return true;
  }
  $("modForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sb) return showError("modError", "You're offline.");
    const code = $("modCode").value.trim();
    if (!code) return showError("modError", "Add the module code.");
    if (modules.some((m) => m.code.toUpperCase() === code.toUpperCase())) return showError("modError", "That module is already in your list.");
    showError("modError", "");
    if (await addModule(code, $("modName").value)) { $("modForm").reset(); renderModules(); toast("Module added."); }
  });
  async function savePriorities() {
    modules.forEach((m, i) => { m.priority = i + 1; });
    store("funi.mods." + me.id, modules);
    await Promise.all(modules.map((m) => sb.from("modules").update({ priority: m.priority }).eq("id", m.id)));
  }
  $("modList").addEventListener("click", async (e) => {
    const t = e.target.closest("button"); if (!t || !sb) return;
    if (t.dataset.conf) {
      const m = modules.find((x) => x.id === t.dataset.id); const v = +t.dataset.conf;
      m.confidence = v; renderModules();
      await sb.from("modules").update({ confidence: v }).eq("id", m.id);
    } else if (t.dataset.up || t.dataset.down) {
      const i = +(t.dataset.up || t.dataset.down), j = t.dataset.up ? i - 1 : i + 1;
      if (j < 0 || j >= modules.length) return;
      [modules[i], modules[j]] = [modules[j], modules[i]];
      renderModules(); await savePriorities();
    } else if (t.dataset.need) {
      openMarksFor(modules.find((x) => x.id === t.dataset.need));
    } else if (t.dataset.rm) {
      const { error } = await sb.from("modules").delete().eq("id", t.dataset.rm);
      if (error) return toast("Couldn't remove: " + error.message);
      modules = modules.filter((x) => x.id !== t.dataset.rm); await savePriorities(); renderModules();
    }
  });

  /* ---------- study plan ---------- */
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function planSettings() {
    return read("funi.plan." + (me ? me.id : "x"), { hours: 3, rest: 0, from: "08:00", to: "22:00", classes: [] });
  }
  function toMin(t) { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); }
  function toHM(n) { const h = Math.floor(n / 60), m = n % 60; return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m; }
  function isoOf(d) { return d.toLocaleDateString("en-CA"); }

  // Free time = study window minus classes
  function freeSlots(date, st, isToday) {
    let start = toMin(st.from), end = toMin(st.to);
    if (isToday) { const now = new Date(); start = Math.max(start, Math.ceil((now.getHours() * 60 + now.getMinutes() + 15) / 30) * 30); }
    const busy = st.classes.filter((c) => +c.day === date.getDay()).map((c) => [toMin(c.start), toMin(c.end)]).sort((a, b) => a[0] - b[0]);
    const slots = []; let cur = start;
    for (const [b0, b1] of busy) { if (b0 > cur) slots.push([cur, Math.min(b0, end)]); cur = Math.max(cur, b1 + 15); }
    if (cur < end) slots.push([cur, end]);
    return slots.filter(([a, b]) => b - a >= 45);
  }

  function subjectsFor(dateISO) {
    const n = Math.max(modules.length, 1);
    const codes = new Map();
    modules.forEach((m, i) => codes.set(m.code.toUpperCase(), { code: m.code, rank: i, conf: m.confidence || 3 }));
    upcoming().forEach((x) => { const k = x.module.trim().toUpperCase(); if (!codes.has(k)) codes.set(k, { code: x.module.trim(), rank: n, conf: 3 }); });
    const out = [];
    codes.forEach((s, k) => {
      const exam = upcoming().find((x) => x.module.trim().toUpperCase() === k && x.due_date > dateISO);
      const sameDay = upcoming().some((x) => x.module.trim().toUpperCase() === k && x.due_date === dateISO);
      if (sameDay) return; // don't study a module on its own exam day
      const daysTo = exam ? Math.round((new Date(exam.due_date + "T00:00:00") - new Date(dateISO + "T00:00:00")) / 86400000) : 60;
      const score = 10 / Math.max(daysTo, 1) + 3 * (n - Math.min(s.rank, n) + 1) / (n + 1) + 3 * (6 - s.conf) / 5;
      out.push({ code: s.code, conf: s.conf, daysTo: daysTo, exam: exam, score: score });
    });
    return out;
  }

  function taskFor(s) {
    if (s.exam && s.daysTo <= 3) return "Timed past paper, then mark it with the memo";
    if (s.exam && s.daysTo <= 7) return "Past paper questions on your weakest topics";
    if (s.conf <= 2) return "Rework your notes and redo tutorial problems";
    return "Practice questions and a quick summary sheet";
  }

  function buildDay(date, st, isToday) {
    const dateISO = isoOf(date);
    if (+st.rest === date.getDay()) return { rest: true, blocks: [] };
    const subs = subjectsFor(dateISO);
    let left = st.hours * 60; const blocks = [];
    if (!subs.length) return { rest: false, blocks: [], empty: true };
    for (const [a, b] of freeSlots(date, st, isToday)) {
      let t = a;
      while (left >= 30 && b - t >= 45) {
        const len = Math.min(90, left, b - t);
        subs.sort((x, y) => y.score - x.score);
        const s = subs[0];
        blocks.push({ start: t, end: t + len, code: s.code, task: taskFor(s), daysTo: s.daysTo, exam: s.exam, conf: s.conf, key: dateISO + "|" + t + "|" + s.code });
        s.score *= 0.55; // mix subjects through the day
        left -= len; t += len + 15;
      }
      if (left < 30) break;
    }
    return { rest: false, blocks: blocks };
  }

  let planSel = 0;
  function renderPlan() {
    const st = planSettings();
    const base = new Date(); base.setHours(0, 0, 0, 0);
    $("planWeek").textContent = "Next 7 days · " + st.hours + "h a day";
    let strip = "";
    for (let i = 0; i < 7; i++) {
      const d = new Date(base); d.setDate(base.getDate() + i);
      const rest = +st.rest === d.getDay();
      strip += '<button type="button" class="day' + (i === planSel ? " sel" : "") + (rest ? " rest" : "") + '" data-pi="' + i + '"><small>' + (i === 0 ? "Today" : DAY[d.getDay()]) + "</small><b>" + d.getDate() + "</b></button>";
    }
    $("planDays").innerHTML = strip;

    const day = new Date(base); day.setDate(base.getDate() + planSel);
    const plan = buildDay(day, st, planSel === 0);
    const done = read("funi.done." + (me ? me.id : "x"), {});
    if (plan.rest) { $("planBody").innerHTML = '<div class="card rest-card"><h2>Rest day</h2><p>No study blocks today. Rest is part of the plan.</p></div>'; return; }
    if (plan.empty) { $("planBody").innerHTML = '<div class="empty"><b>Nothing to plan yet</b><span>Add your tests and exams, and your modules, then come back.</span></div>'; return; }

    const classes = st.classes.filter((c) => +c.day === day.getDay()).map((c) => ({ start: toMin(c.start), html: '<div class="slot"><span class="at">' + c.start + '</span><div class="cls">Class · ' + esc(c.label || "Class") + " until " + c.end + "</div></div>" }));
    const blocks = plan.blocks.map((b) => {
      const urgent = b.exam && b.daysTo <= 7;
      const tag = b.exam ? '<span class="tag ' + (b.daysTo <= 7 ? "soon" : "mid") + '">' + b.exam.kind.toUpperCase() + " IN " + b.daysTo + " D</span>" : (b.conf <= 2 ? '<span class="tag mid">SHAKY</span>' : '<span class="tag far">REVIEW</span>');
      const isDone = !!done[b.key];
      return { start: b.start, html: '<div class="slot"><span class="at">' + toHM(b.start) + '</span><div class="blk' + (urgent ? " urgent" : "") + (isDone ? " done" : "") + '">' +
        '<div class="blk-top"><b>' + esc(b.code) + " · " + (b.end - b.start >= 60 ? Math.floor((b.end - b.start) / 60) + "h" + ((b.end - b.start) % 60 ? " " + (b.end - b.start) % 60 + "m" : "") : (b.end - b.start) + "m") + "</b>" + tag + "</div>" +
        "<p>" + esc(b.task) + "</p>" +
        '<div class="blk-btns">' + (planSel === 0 && !isDone ? '<button type="button" class="mini primary" data-start="1">Start</button>' : "") +
        '<button type="button" class="mini ghost" data-done="' + esc(b.key) + '">' + (isDone ? "Undo" : "Mark done") + "</button></div></div></div>" };
    });
    $("planBody").innerHTML = '<div class="slots">' + classes.concat(blocks).sort((x, y) => x.start - y.start).map((x) => x.html).join("") + "</div>";
  }
  $("planDays").addEventListener("click", (e) => { const b = e.target.closest("[data-pi]"); if (!b) return; planSel = +b.dataset.pi; renderPlan(); });
  $("planBody").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.start) { openTab("tabFocus"); return; }
    if (b.dataset.done) {
      const key = "funi.done." + me.id, done = read(key, {});
      if (done[b.dataset.done]) delete done[b.dataset.done]; else done[b.dataset.done] = 1;
      store(key, done); renderPlan();
    }
  });

  // settings
  let draftClasses = [];
  function drawClasses() {
    $("classList").innerHTML = draftClasses.length ? draftClasses.map((c, i) =>
      '<div class="class-row"><span>' + DAY[c.day] + " " + c.start + "–" + c.end + " · " + esc(c.label || "Class") + '</span><button type="button" data-ci="' + i + '">Remove</button></div>').join("")
      : '<p class="hint">No classes added yet.</p>';
  }
  $("planSettingsBtn").onclick = () => {
    const st = planSettings();
    $("psHours").value = String(st.hours); $("psRest").value = String(st.rest); $("psFrom").value = st.from; $("psTo").value = st.to;
    draftClasses = st.classes.slice(); drawClasses(); $("planDlg").showModal();
  };
  $("cAdd").onclick = () => {
    const c = { day: +$("cDay").value, start: $("cStart").value, end: $("cEnd").value, label: $("cLabel").value.trim() };
    if (!c.start || !c.end || toMin(c.end) <= toMin(c.start)) return toast("The class must end after it starts.");
    draftClasses.push(c); draftClasses.sort((a, b) => (a.day - b.day) || (toMin(a.start) - toMin(b.start)));
    $("cLabel").value = ""; drawClasses();
  };
  $("classList").addEventListener("click", (e) => { const b = e.target.closest("[data-ci]"); if (!b) return; draftClasses.splice(+b.dataset.ci, 1); drawClasses(); });
  $("psSave").onclick = () => {
    if (toMin($("psTo").value) <= toMin($("psFrom").value)) return toast("'Stop studying at' must be after 'Study from'.");
    store("funi.plan." + me.id, { hours: +$("psHours").value, rest: +$("psRest").value, from: $("psFrom").value, to: $("psTo").value, classes: draftClasses });
    $("planDlg").close(); renderPlan(); toast("Plan rebuilt.");
  };

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
