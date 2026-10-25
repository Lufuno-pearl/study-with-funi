/* Funi study features: home dashboard, tests & exams, modules with marks, study plan,
 * focus / study sessions, and tasks & reminders. */
(function () {
  "use strict";
  const F = window.Funi, $ = F.$, esc = F.esc, S = F.s;
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const READY = ["", "Lost", "Shaky", "Okay", "Good", "Ready"];
  const ico = {
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    grip: '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>'
  };
  const key = (k) => "funi." + k + "." + (F.me ? F.me.id : "x");

  /* =====================================================================
     TESTS & EXAMS
     ===================================================================== */
  F.upcoming = () => {
    const today = F.todayISO();
    return S.items.filter((x) => x.due_date >= today).sort((a, b) =>
      (a.due_date + (a.start_time || "")).localeCompare(b.due_date + (b.start_time || "")));
  };
  const sameCode = (a, b) => String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase();
  F.nextExamFor = (code) => F.upcoming().find((x) => sameCode(x.module, code));
  const chipClass = (n) => (n <= 7 ? "soon" : n <= 21 ? "mid" : "far");

  async function loadItems() {
    S.items = F.read(key("items"), []);
    const { data, error } = await F.sb.from("assessments").select("*").gte("due_date", F.todayISO()).order("due_date");
    if (error) { F.status("homeStatus", "Showing your saved copy. Couldn't reach Funi's server."); return; }
    F.status("homeStatus", "");
    S.items = data || []; F.store(key("items"), S.items);
  }

  function examRow(x, withDelete) {
    const d = F.daysLeft(x.due_date);
    return '<div class="item"><div class="txt"><b>' + esc(x.module) + " · " + esc(x.kind) + "</b><span>" +
      F.niceDate(x.due_date) + (x.start_time ? " · " + F.niceTime(x.start_time) : "") + (x.venue ? " · " + esc(x.venue) : "") +
      '</span></div><span class="chip-d ' + chipClass(d) + '">' + (d === 0 ? "Today" : d + " d") + "</span>" +
      (withDelete ? '<button class="x-btn" data-del-exam="' + esc(x.id) + '" aria-label="Delete ' + esc(x.module) + " " + esc(x.kind) + '">×</button>' : "") + "</div>";
  }
  function renderExams() {
    const list = F.upcoming();
    $("examList").innerHTML = list.length ? list.map((x) => examRow(x, true)).join("")
      : '<div class="empty"><b>No tests or exams yet</b><span>Add one and Funi starts counting down.</span></div>';
    $("examList").classList.toggle("list", !!list.length);
  }
  $("examList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-del-exam]"); if (!b) return;
    const x = S.items.find((i) => i.id === b.dataset.delExam);
    if (!(await F.confirm("Delete this " + (x ? x.kind.toLowerCase() : "test") + "?", x ? x.module + " on " + F.niceDate(x.due_date) : "", "Delete"))) return;
    const { error } = await F.sb.from("assessments").delete().eq("id", b.dataset.delExam);
    if (error) return F.toast("Couldn't delete: " + error.message);
    S.items = S.items.filter((i) => i.id !== b.dataset.delExam); F.store(key("items"), S.items);
    renderExams(); F.renderHome(); F.toast("Deleted.");
  });

  function openExamSheet() {
    $("examForm").reset(); $("fTime").value = "09:00"; $("fDate").min = F.todayISO();
    $("moduleCodes").innerHTML = S.modules.map((m) => '<option value="' + esc(m.code) + '">').join("");
    F.showError("examError", ""); $("examSheet").showModal();
  }
  $("addExamBtn").onclick = openExamSheet;
  $("examForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const row = { module: $("fModule").value.trim().toUpperCase(), kind: $("fKind").value, due_date: $("fDate").value,
      start_time: $("fTime").value || null, venue: $("fVenue").value.trim() || null };
    if (!row.module || !row.due_date) return F.showError("examError", "Add the module and the date.");
    $("examSave").disabled = true;
    const { data, error } = await F.sb.from("assessments").insert(row).select().single();
    $("examSave").disabled = false;
    if (error) return F.showError("examError", "Couldn't save: " + error.message);
    S.items.push(data); F.store(key("items"), S.items);
    $("examSheet").close();
    if (!S.modules.some((m) => sameCode(m.code, row.module))) await addModule(row.module, "", true);
    renderExams(); F.renderHome(); renderModules();
    const d = F.daysLeft(data.due_date);
    F.toast(d === 0 ? "Saved. It's today, you've got this!" : "Saved. " + d + (d === 1 ? " day" : " days") + " to go.");
  });

  /* + button */
  $("fab").onclick = () => $("addSheet").showModal();
  $("chooseExam").onclick = () => { $("addSheet").close(); openExamSheet(); };
  $("chooseTask").onclick = () => { $("addSheet").close(); F.go("study:tasks"); setTimeout(() => $("taskTitle").focus(), 150); };

  /* =====================================================================
     MODULES + MARKS ("What matters most?")
     ===================================================================== */
  const prioMode = () => F.read(key("prioMode"), "auto");
  function needFor(m, target) {
    if (m.class_mark == null) return null;
    const cm = +m.class_mark, w = Math.max(0.05, (m.exam_weight == null ? 60 : +m.exam_weight) / 100), sub = m.subminimum == null ? 40 : +m.subminimum;
    return Math.max(0, Math.ceil(Math.max((target - cm * (1 - w)) / w, sub)));
  }
  F.needFor = needFor;
  function moduleScore(m) {
    const pass = needFor(m, 50);
    const needTerm = pass == null ? 1.5 : pass > 100 ? 3.5 : Math.min(4, Math.max(0, (pass - 30) / 60 * 4));
    const exam = F.nextExamFor(m.code), d = exam ? F.daysLeft(exam.due_date) : null;
    const urgency = d == null ? 0 : Math.min(3, 6 / Math.max(d, 1));
    const conf = (5 - (m.confidence || 3)) / 4 * 2;
    return needTerm + urgency + conf;
  }
  F.orderedModules = () => {
    if (prioMode() === "manual") return S.modules.slice().sort((a, b) => (a.priority || 999) - (b.priority || 999));
    return S.modules.slice().sort((a, b) => moduleScore(b) - moduleScore(a));
  };

  async function loadModules() {
    S.modules = F.read(key("mods"), []);
    const { data, error } = await F.sb.from("modules").select("*").order("priority", { ascending: true, nullsFirst: false }).order("created_at");
    if (!error) { S.modules = data || []; F.store(key("mods"), S.modules); }
  }
  // keep partner matching in sync with your modules
  async function syncMatchModules() {
    if (!F.sb || !F.me) return;
    const codes = [...new Set(S.modules.map((m) => m.code.trim().toUpperCase()))];
    if (codes.length) await F.sb.from("study_profile_modules").upsert(codes.map((c) => ({ user_id: F.me.id, module_code: c, updated_at: new Date().toISOString() })), { onConflict: "user_id,module_code" });
    const { data } = await F.sb.from("study_profile_modules").select("module_code").eq("user_id", F.me.id);
    for (const r of data || []) if (!codes.includes(String(r.module_code).toUpperCase())) await F.sb.from("study_profile_modules").delete().eq("user_id", F.me.id).eq("module_code", r.module_code);
  }

  function needBox(m) {
    const pass = needFor(m, 50);
    if (pass == null) return '<div class="need t-sky"><span class="big">?</span><small>Drag your class mark below to see what you need in the exam.</small></div>';
    if (pass > 100) return '<div class="need t-pink"><span class="big">—</span><small>Even 100% won\'t get you to 50%. Ask your lecturer about a supp or deferred exam.</small></div>';
    const cls = pass <= Math.max(50, (m.subminimum == null ? 40 : +m.subminimum)) ? "t-mint" : pass <= 70 ? "t-butter" : "t-peach";
    const f60 = needFor(m, 60), f75 = needFor(m, 75);
    return '<div class="need ' + cls + '"><span class="big">' + pass + '%</span><small>needed in the exam to pass.<br>For 60%: ' +
      (f60 > 100 ? "out of reach" : f60 + "%") + " · For 75%: " + (f75 > 100 ? "out of reach" : f75 + "%") + "</small></div>";
  }
  function sliderRow(id, label, field, value, min, max, step) {
    return '<div class="slider-row"><label class="lbl" for="' + id + '" style="margin:0">' + label + '</label><output for="' + id + '" id="' + id + 'O">' +
      (value == null ? "–" : value + "%") + '</output></div><input type="range" id="' + id + '" data-field="' + field + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + (value == null ? 50 : value) + '">';
  }
  function renderModules() {
    if (!$("modList")) return;
    const mode = prioMode();
    document.querySelectorAll("[data-prio]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.prio === mode)));
    const mods = F.orderedModules();
    const open = F.read(key("modOpen"), {});
    let html = mods.map((m, i) => {
      const exam = F.nextExamFor(m.code), conf = m.confidence || 3;
      let dots = "";
      for (let k = 1; k <= 5; k++) dots += '<button type="button" class="dotb' + (k <= conf ? " on" : "") + '" data-conf="' + k + '" aria-label="Ready ' + k + ' of 5"></button>';
      const sub = (exam ? exam.kind + " in " + F.daysLeft(exam.due_date) + " days" : "No test or exam added") + " · " + READY[conf];
      return '<article class="mod" data-mid="' + esc(m.id) + '">' +
        '<div class="mod-head"><span class="mod-rank">' + (i + 1) + '</span><div class="txt"><b>' + esc(m.code) + (m.name ? " · " + esc(m.name) : "") + "</b><span>" + esc(sub) + "</span></div>" +
        (mode === "manual" ? '<button type="button" class="handle" aria-label="Drag to reorder ' + esc(m.code) + '">' + ico.grip + "</button>" : "") + "</div>" +
        needBox(m) +
        sliderRow("cm-" + m.id, "Class mark so far", "class_mark", m.class_mark == null ? null : +m.class_mark, 0, 100, 1) +
        '<div' + (open[m.id] ? "" : " hidden") + ' class="stack" data-more>' +
        sliderRow("ew-" + m.id, "Exam counts for", "exam_weight", m.exam_weight == null ? 60 : +m.exam_weight, 10, 100, 5) +
        sliderRow("sm-" + m.id, "Exam subminimum", "subminimum", m.subminimum == null ? 40 : +m.subminimum, 0, 60, 5) + "</div>" +
        '<div class="dots"><span class="lbl" style="font-size:13px;font-weight:800;margin-right:4px">How ready?</span>' + dots + "<em>" + READY[conf] + "</em></div>" +
        '<div class="mod-foot"><button type="button" class="details-toggle" data-more-toggle>' + (open[m.id] ? "Hide exam weight" : "Exam weight & subminimum") + '</button>' +
        '<button type="button" class="btn danger small" data-rm>Remove</button></div></article>';
    }).join("");
    if (!mods.length) html = '<div class="empty"><b>No modules yet</b><span>Add your modules below. Funi also adds them from your tests.</span></div>';
    $("modList").innerHTML = html;
  }
  F.renderModules = renderModules;

  document.querySelectorAll("[data-prio]").forEach((b) => b.addEventListener("click", async () => {
    const mode = b.dataset.prio;
    if (mode === "manual" && prioMode() === "auto") {
      // start manual order from Funi's current order
      F.orderedModules().forEach((m, i) => { m.priority = i + 1; });
      savePriorities();
    }
    F.store(key("prioMode"), mode); renderModules();
    F.toast(mode === "auto" ? "Funi orders your modules by the marks you need, your exams and how ready you feel." : "Drag the handles to put your modules in your own order.", { long: true });
  }));

  const saveTimers = {};
  function saveModuleField(m, field, value) {
    m[field] = value; F.store(key("mods"), S.modules);
    clearTimeout(saveTimers[m.id + field]);
    saveTimers[m.id + field] = setTimeout(async () => {
      const patch = {}; patch[field] = value;
      const { error } = await F.sb.from("modules").update(patch).eq("id", m.id);
      if (error) F.toast(/column/i.test(error.message) ? "Run funi-v2-setup.sql in Supabase to save exam weights." : "Couldn't save: " + error.message, { long: true });
    }, 500);
  }
  $("modList").addEventListener("input", (e) => {
    const r = e.target.closest("input[type=range]"); if (!r) return;
    const card = r.closest(".mod"), m = S.modules.find((x) => x.id === card.dataset.mid);
    const v = +r.value; $(r.id + "O").textContent = v + "%";
    m[r.dataset.field] = v;
    const box = card.querySelector(".need"); box.outerHTML = needBox(m);
  });
  $("modList").addEventListener("change", (e) => {
    const r = e.target.closest("input[type=range]"); if (!r) return;
    const m = S.modules.find((x) => x.id === r.closest(".mod").dataset.mid);
    saveModuleField(m, r.dataset.field, +r.value);
    if (prioMode() === "auto") setTimeout(renderModules, 600);
    F.renderHome();
  });
  $("modList").addEventListener("click", async (e) => {
    const card = e.target.closest(".mod"); if (!card) return;
    const m = S.modules.find((x) => x.id === card.dataset.mid);
    const conf = e.target.closest("[data-conf]");
    if (conf) { saveModuleField(m, "confidence", +conf.dataset.conf); renderModules(); return; }
    if (e.target.closest("[data-more-toggle]")) {
      const open = F.read(key("modOpen"), {}); open[m.id] = !open[m.id]; F.store(key("modOpen"), open); renderModules(); return;
    }
    if (e.target.closest("[data-rm]")) {
      if (!(await F.confirm("Remove " + m.code + "?", "Its marks will be removed too. Your tests for it stay.", "Remove"))) return;
      const { error } = await F.sb.from("modules").delete().eq("id", m.id);
      if (error) return F.toast("Couldn't remove: " + error.message);
      S.modules = S.modules.filter((x) => x.id !== m.id); F.store(key("mods"), S.modules);
      renderModules(); syncMatchModules();
    }
  });

  // drag to reorder (manual mode)
  let drag = null;
  $("modList").addEventListener("pointerdown", (e) => {
    const h = e.target.closest(".handle"); if (!h) return;
    e.preventDefault();
    const card = h.closest(".mod");
    drag = { card: card, id: e.pointerId };
    card.classList.add("dragging");
    h.setPointerCapture(e.pointerId);
  });
  $("modList").addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const list = $("modList");
    const others = [...list.querySelectorAll(".mod:not(.dragging)")];
    let before = null;
    for (const o of others) { const r = o.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { before = o; break; } }
    if (before !== drag.card.nextElementSibling) list.insertBefore(drag.card, before);
    if (e.clientY < 90) window.scrollBy(0, -12); else if (e.clientY > window.innerHeight - 160) window.scrollBy(0, 12);
  });
  function endDrag() {
    if (!drag) return;
    drag.card.classList.remove("dragging");
    const ids = [...$("modList").querySelectorAll(".mod")].map((c) => c.dataset.mid);
    ids.forEach((id, i) => { const m = S.modules.find((x) => x.id === id); if (m) m.priority = i + 1; });
    drag = null; renderModules(); savePriorities();
  }
  $("modList").addEventListener("pointerup", endDrag);
  $("modList").addEventListener("pointercancel", endDrag);
  async function savePriorities() {
    F.store(key("mods"), S.modules);
    await Promise.all(S.modules.map((m) => F.sb.from("modules").update({ priority: m.priority }).eq("id", m.id)));
  }

  async function addModule(code, name, quiet) {
    const row = { code: code.trim().toUpperCase(), name: (name || "").trim() || null, priority: S.modules.length + 1, confidence: 3 };
    const { data, error } = await F.sb.from("modules").insert(row).select().single();
    if (error) { if (!quiet) F.showError("modError", "Couldn't add: " + error.message); return false; }
    S.modules.push(data); F.store(key("mods"), S.modules); syncMatchModules(); return true;
  }
  $("modForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $("modCode").value.trim();
    if (!code) return F.showError("modError", "Add the module code.");
    if (S.modules.some((m) => sameCode(m.code, code))) return F.showError("modError", "That module is already in your list.");
    F.showError("modError", "");
    if (await addModule(code, $("modName").value)) { $("modForm").reset(); renderModules(); fillModuleSelects(); F.toast(code.toUpperCase() + " added. Drag its class mark to see what you need."); }
  });
  async function addMissingModules() {
    const missing = [...new Set(S.items.map((x) => x.module.trim().toUpperCase()))].filter((c) => c && !S.modules.some((m) => sameCode(m.code, c)));
    for (const c of missing) await addModule(c, "", true);
  }

  /* =====================================================================
     STUDY PLAN
     ===================================================================== */
  const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };
  const toHM = (n) => { const h = Math.floor(n / 60), m = n % 60; return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m; };
  const planSettings = () => F.read(key("plan"), { hours: 3, rest: 0, from: "08:00", to: "22:00", classes: [] });

  function freeSlots(date, st, isToday) {
    let start = toMin(st.from); const end = toMin(st.to);
    if (isToday) { const now = new Date(); start = Math.max(start, Math.ceil((now.getHours() * 60 + now.getMinutes() + 15) / 30) * 30); }
    const busy = st.classes.filter((c) => +c.day === date.getDay()).map((c) => [toMin(c.start), toMin(c.end)]).sort((a, b) => a[0] - b[0]);
    const slots = []; let cur = start;
    for (const [b0, b1] of busy) { if (b0 > cur) slots.push([cur, Math.min(b0, end)]); cur = Math.max(cur, b1 + 15); }
    if (cur < end) slots.push([cur, end]);
    return slots.filter(([a, b]) => b - a >= 45);
  }
  function subjectsFor(dateISO) {
    const ordered = F.orderedModules(), n = Math.max(ordered.length, 1);
    const map = new Map();
    ordered.forEach((m, i) => map.set(m.code.toUpperCase(), { code: m.code, rank: i, mod: m }));
    F.upcoming().forEach((x) => { const k = x.module.trim().toUpperCase(); if (!map.has(k)) map.set(k, { code: x.module.trim(), rank: n, mod: null }); });
    const out = [];
    map.forEach((s, k) => {
      const exam = F.upcoming().find((x) => x.module.trim().toUpperCase() === k && x.due_date > dateISO);
      if (F.upcoming().some((x) => x.module.trim().toUpperCase() === k && x.due_date === dateISO)) return; // exam day: no extra study
      const daysTo = exam ? Math.round((new Date(exam.due_date + "T00:00:00") - new Date(dateISO + "T00:00:00")) / 86400000) : 60;
      const conf = s.mod ? s.mod.confidence || 3 : 3, pass = s.mod ? needFor(s.mod, 50) : null;
      const needTerm = pass == null ? 1 : pass > 100 ? 3 : Math.max(0, (pass - 30) / 60 * 3);
      const score = 8 / Math.max(daysTo, 1) + 3 * (n - Math.min(s.rank, n) + 1) / (n + 1) + needTerm + (5 - conf) / 2;
      out.push({ code: s.code, conf: conf, pass: pass, daysTo: daysTo, exam: exam, score: score });
    });
    return out;
  }
  function taskFor(s) {
    if (s.exam && s.daysTo <= 3) return "Timed past paper, then mark it with the memo";
    if (s.exam && s.daysTo <= 7) return "Past paper questions on your weakest topics";
    if (s.pass != null && s.pass > 70) return "Big marks needed: redo tutorials and past exam questions";
    if (s.conf <= 2) return "Rework your notes and redo tutorial problems";
    return "Practice questions and a quick summary sheet";
  }
  function buildDay(date, st, isToday) {
    const dateISO = F.isoOf(date);
    if (+st.rest === date.getDay()) return { rest: true, blocks: [] };
    const subs = subjectsFor(dateISO);
    if (!subs.length) return { empty: true, blocks: [] };
    let left = st.hours * 60; const blocks = [];
    for (const [a, b] of freeSlots(date, st, isToday)) {
      let t = a;
      while (left >= 30 && b - t >= 45) {
        const len = Math.min(90, left, b - t);
        subs.sort((x, y) => y.score - x.score);
        const s = subs[0];
        blocks.push({ start: t, end: t + len, code: s.code, task: taskFor(s), daysTo: s.daysTo, exam: s.exam, conf: s.conf, key: dateISO + "|" + t + "|" + s.code });
        s.score *= 0.55; left -= len; t += len + 15;
      }
      if (left < 30) break;
    }
    return { blocks: blocks };
  }
  let planSel = 0;
  function renderPlan() {
    const st = planSettings();
    const base = new Date(); base.setHours(0, 0, 0, 0);
    $("planInfo").textContent = "Next 7 days · " + st.hours + "h of study a day" + (st.classes.length ? " · " + st.classes.length + " classes blocked out" : " · add your classes with the settings button");
    let strip = "";
    for (let i = 0; i < 7; i++) {
      const d = new Date(base); d.setDate(base.getDate() + i);
      strip += '<button type="button" class="day' + (i === planSel ? " sel" : "") + (+st.rest === d.getDay() ? " rest" : "") + '" data-pi="' + i + '"><small>' + (i === 0 ? "Today" : DAY[d.getDay()]) + "</small><b>" + d.getDate() + "</b></button>";
    }
    $("planDays").innerHTML = strip;
    const day = new Date(base); day.setDate(base.getDate() + planSel);
    const plan = buildDay(day, st, planSel === 0);
    const done = F.read(key("done"), {});
    if (plan.rest) { $("planBody").innerHTML = '<div class="empty"><b>Rest day</b><span>No study blocks today. Rest is part of the plan.</span></div>'; return; }
    if (plan.empty) { $("planBody").innerHTML = '<div class="empty"><b>Nothing to plan yet</b><span>Add your tests and modules, then come back.</span><button class="btn primary small" data-go="study:modules">Add modules</button></div>'; return; }
    if (!plan.blocks.length) { $("planBody").innerHTML = '<div class="empty"><b>No free time left today</b><span>Check tomorrow, or change your study hours in settings.</span></div>'; return; }
    const rows = st.classes.filter((c) => +c.day === day.getDay()).map((c) => ({ start: toMin(c.start),
      html: '<div class="tl-row"><span class="tl-time">' + c.start + '</span><div class="cls">Class · ' + esc(c.label || "Class") + " until " + c.end + "</div></div>" }));
    plan.blocks.forEach((b) => {
      const isDone = !!done[b.key], len = b.end - b.start;
      const tag = b.exam ? '<span class="pill ' + (b.daysTo <= 7 ? "peach" : "lav") + '">' + esc(b.exam.kind.toUpperCase()) + " IN " + b.daysTo + " D</span>"
        : b.conf <= 2 ? '<span class="pill lav">SHAKY</span>' : '<span class="pill mint">REVIEW</span>';
      rows.push({ start: b.start, html: '<div class="tl-row"><span class="tl-time">' + toHM(b.start) + '</span><div class="blk' + (b.exam && b.daysTo <= 7 ? " urgent" : "") + (isDone ? " done" : "") + '">' +
        '<div class="between"><b>' + esc(b.code) + " · " + (len >= 60 ? Math.floor(len / 60) + "h" + (len % 60 ? " " + (len % 60) + "m" : "") : len + "m") + "</b>" + tag + "</div>" +
        "<p>" + esc(b.task) + '</p><div class="blk-btns">' +
        (planSel === 0 && !isDone ? '<button type="button" class="btn primary small" data-start-block="' + esc(b.code) + '" data-min="' + Math.min(len, 50) + '">Start</button>' : "") +
        '<button type="button" class="btn ghost small" data-done="' + esc(b.key) + '">' + (isDone ? "Undo" : "Mark done") + "</button></div></div></div>" });
    });
    $("planBody").innerHTML = '<div class="timeline">' + rows.sort((x, y) => x.start - y.start).map((x) => x.html).join("") + "</div>";
  }
  F.renderPlan = renderPlan;
  $("planDays").addEventListener("click", (e) => { const b = e.target.closest("[data-pi]"); if (!b) return; planSel = +b.dataset.pi; renderPlan(); });
  $("planBody").addEventListener("click", (e) => {
    const s = e.target.closest("[data-start-block]");
    if (s) { F.go("study:focus"); $("sesModule").value = s.dataset.startBlock; $("sesMinutes").value = s.dataset.min; return; }
    const d = e.target.closest("[data-done]");
    if (d) { const done = F.read(key("done"), {}); if (done[d.dataset.done]) delete done[d.dataset.done]; else done[d.dataset.done] = 1; F.store(key("done"), done); renderPlan(); }
  });
  let draftClasses = [];
  function drawClasses() {
    $("classList").innerHTML = draftClasses.length ? '<div class="list">' + draftClasses.map((c, i) =>
      '<div class="item"><div class="txt"><b>' + DAY[c.day] + " " + c.start + "–" + c.end + "</b><span>" + esc(c.label || "Class") + '</span></div><button type="button" class="x-btn" data-ci="' + i + '" aria-label="Remove class">×</button></div>').join("") + "</div>"
      : '<p class="hint">No classes added yet.</p>';
  }
  $("planSettingsBtn").onclick = () => {
    const st = planSettings();
    $("psHours").value = String(st.hours); $("psRest").value = String(st.rest); $("psFrom").value = st.from; $("psTo").value = st.to;
    draftClasses = st.classes.slice(); drawClasses(); $("planSheet").showModal();
  };
  $("cAdd").onclick = () => {
    const c = { day: +$("cDay").value, start: $("cStart").value, end: $("cEnd").value, label: $("cLabel").value.trim() };
    if (!c.start || !c.end || toMin(c.end) <= toMin(c.start)) return F.toast("The class must end after it starts.");
    draftClasses.push(c); draftClasses.sort((a, b) => (a.day - b.day) || (toMin(a.start) - toMin(b.start)));
    $("cLabel").value = ""; drawClasses();
  };
  $("classList").addEventListener("click", (e) => { const b = e.target.closest("[data-ci]"); if (!b) return; draftClasses.splice(+b.dataset.ci, 1); drawClasses(); });
  $("psSave").onclick = () => {
    if (toMin($("psTo").value) <= toMin($("psFrom").value)) return F.toast("'Stop studying at' must be after 'Study from'.");
    F.store(key("plan"), { hours: +$("psHours").value, rest: +$("psRest").value, from: $("psFrom").value, to: $("psTo").value, classes: draftClasses });
    $("planSheet").close(); renderPlan(); F.toast("Plan rebuilt.");
  };

  /* =====================================================================
     FOCUS = STUDY SESSION (shared with partners)
     ===================================================================== */
  let sesFeeling = "Happy", tickTimer = null;
  const timerKey = () => key("timer");
  function fillModuleSelects() {
    const codes = [...new Set(F.orderedModules().map((m) => m.code).concat(F.upcoming().map((x) => x.module.trim().toUpperCase())))];
    const opts = codes.map((c) => { const m = S.modules.find((x) => sameCode(x.code, c)); return '<option value="' + esc(c) + '">' + esc(c + (m && m.name ? " · " + m.name : "")) + "</option>"; }).join("");
    const keep = $("sesModule").value;
    $("sesModule").innerHTML = opts + '<option value="General study">General study</option>';
    if (keep) $("sesModule").value = keep;
    const keepT = $("taskModule").value;
    $("taskModule").innerHTML = '<option value="">None</option>' + codes.map((c) => '<option value="' + esc(c) + '">' + esc(c) + "</option>").join("");
    $("taskModule").value = keepT || "";
  }
  F.fillModuleSelects = fillModuleSelects;
  function drawSesFeelings() {
    $("sesFeelings").innerHTML = window.FuniArt.FEELINGS.map((f) => '<button type="button" class="feel" data-sf="' + esc(f) + '" aria-pressed="' + (f === sesFeeling) + '"><span class="face">' + F.face(f) + "</span>" + esc(f) + "</button>").join("");
  }
  $("sesFeelings").addEventListener("click", (e) => { const b = e.target.closest("[data-sf]"); if (!b) return; sesFeeling = b.dataset.sf; drawSesFeelings(); });

  $("sessionForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const focusMin = Math.round(+$("sesMinutes").value), breakMin = Math.round(+$("sesBreak").value);
    if (!(focusMin >= 1 && focusMin <= 240)) return F.showError("sesError", "Choose 1 to 240 minutes.");
    if (!(breakMin >= 1 && breakMin <= 60)) return F.showError("sesError", "Choose a break of 1 to 60 minutes.");
    F.showError("sesError", "");
    const module_code = $("sesModule").value || "General study";
    const activity = (document.querySelector('input[name="act"]:checked') || {}).value || "Practice questions";
    const share = $("sesShare").checked;
    let sessionId = null;
    if (F.sb) {
      await F.sb.from("study_sessions").update({ is_active: false, ended_at: new Date().toISOString() }).eq("user_id", F.me.id).eq("is_active", true);
      const { data, error } = await F.sb.from("study_sessions").insert({ user_id: F.me.id, module_code, feeling: sesFeeling, activity, share_with_partners: share, planned_minutes: focusMin }).select().single();
      if (error && !/planned_minutes/.test(error.message)) F.toast("Your timer started, but partners couldn't be told: " + error.message, { long: true });
      if (data) sessionId = data.id;
      if (F.setMyFeeling) F.setMyFeeling(sesFeeling, true);
    }
    F.store(timerKey(), { sessionId, module: module_code, activity, feeling: sesFeeling, share, focusMin, breakMin, phase: "focus", endAt: Date.now() + focusMin * 60000, pausedLeft: null, rounds: 0, startedAt: Date.now() });
    showSession();
  });

  function showSession() {
    const t = F.read(timerKey(), null);
    $("sessionForm").hidden = !!t; $("sessionLive").hidden = !t;
    clearInterval(tickTimer);
    if (!t) { document.body.classList.remove("bigclock-mode"); return; }
    const p = S.profile || { id: F.me && F.me.id };
    $("sesAva").innerHTML = F.avatar(p, t.feeling);
    $("sesTitle").textContent = t.module; $("sesSub").textContent = t.activity;
    $("sesFace").innerHTML = F.face(t.feeling); $("sesMood").textContent = t.feeling;
    $("sesScene").innerHTML = window.FuniArt.studyScene(p.avatar, t.feeling, p.id);
    $("sesShareNote").hidden = !t.share;
    tick(); tickTimer = setInterval(tick, 1000);
  }
  F.showSession = showSession;
  function tick() {
    const t = F.read(timerKey(), null); if (!t) return;
    let left = t.pausedLeft != null ? t.pausedLeft : Math.round((t.endAt - Date.now()) / 1000);
    if (left <= 0 && t.pausedLeft == null) {
      if (t.phase === "focus") {
        t.rounds++; t.phase = "break"; t.endAt = Date.now() + t.breakMin * 60000;
        F.systemNotify("Focus session done", "Take a " + t.breakMin + " minute break. You earned it."); F.toast("Focus done! Break time.");
        const k = key("focus." + F.todayISO()); F.store(k, F.read(k, 0) + 1);
      } else {
        t.phase = "focus"; t.endAt = Date.now() + t.focusMin * 60000;
        F.systemNotify("Break's over", "Back to " + t.module + " for " + t.focusMin + " minutes."); F.toast("Break's over. Let's go!");
      }
      F.store(timerKey(), t); left = Math.round((t.endAt - Date.now()) / 1000);
    }
    left = Math.max(0, left);
    const m = Math.floor(left / 60), s = left % 60;
    $("sesClock").textContent = (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    $("sesPhase").textContent = (t.pausedLeft != null ? "Paused · " : "") + (t.phase === "focus" ? "Focus time" : "Break time") + (t.rounds ? " · " + t.rounds + " done" : "");
    $("sesCheer").textContent = t.phase === "break" ? "Stretch and drink some water" : t.pausedLeft != null ? "Paused" : "Keep going! You're doing great";
    $("sesPause").textContent = t.pausedLeft != null ? "Resume" : "Pause";
  }
  $("sesPause").onclick = () => {
    const t = F.read(timerKey(), null); if (!t) return;
    if (t.pausedLeft != null) { t.endAt = Date.now() + t.pausedLeft * 1000; t.pausedLeft = null; }
    else t.pausedLeft = Math.max(0, Math.round((t.endAt - Date.now()) / 1000));
    F.store(timerKey(), t); tick();
  };
  $("sesBig").onclick = () => {
    const on = document.body.classList.toggle("bigclock-mode");
    $("sesBig").textContent = on ? "Exit big timer" : "Big timer";
    window.scrollTo(0, 0);
  };
  $("sesEnd").onclick = async () => {
    const t = F.read(timerKey(), null); if (!t) return;
    if (!(await F.confirm("End this study session?", "Your partners will see you've stopped.", "End session"))) return;
    if (t.sessionId && F.sb) await F.sb.from("study_sessions").update({ is_active: false, ended_at: new Date().toISOString() }).eq("id", t.sessionId);
    const mins = Math.max(1, Math.round((Date.now() - t.startedAt) / 60000));
    F.store(timerKey(), null); document.body.classList.remove("bigclock-mode"); $("sesBig").textContent = "Big timer";
    showSession(); F.toast("Nice work! You studied for " + mins + " minute" + (mins === 1 ? "" : "s") + ".");
  };
  $("sesMoodEdit").onclick = () => F.openFeelingSheet && F.openFeelingSheet(async (f) => {
    const t = F.read(timerKey(), null); if (!t) return;
    t.feeling = f; F.store(timerKey(), t);
    if (t.sessionId && F.sb) await F.sb.from("study_sessions").update({ feeling: f }).eq("id", t.sessionId);
    showSession();
  });

  /* =====================================================================
     TASKS & REMINDERS
     ===================================================================== */
  let taskSel = 0;
  const reminderTimers = [];
  async function loadTasks() {
    S.tasks = F.read(key("tasks"), []);
    const { data, error } = await F.sb.from("tasks").select("*").or("due_date.gte." + F.todayISO() + ",done.eq.false").order("due_date").order("due_time", { nullsFirst: false });
    if (error) { S.tasksMissing = /tasks/.test(error.message); return; }
    S.tasks = data || []; F.store(key("tasks"), S.tasks);
  }
  const taskDate = (i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; };
  function tasksOn(iso) {
    const today = F.todayISO();
    return S.tasks.filter((t) => t.due_date === iso || (iso === today && t.due_date < today && !t.done))
      .sort((a, b) => (a.done - b.done) || String(a.due_time || "99").localeCompare(String(b.due_time || "99")));
  }
  function taskRow(t) {
    const overdue = t.due_date < F.todayISO() && !t.done;
    return '<div class="tl-row"><span class="tl-time">' + (t.due_time ? F.niceTime(t.due_time) : "Any") + "</span>" +
      '<div class="task' + (t.done ? " done" : "") + '"><button type="button" class="check' + (t.done ? " on" : "") + '" data-tick="' + esc(t.id) + '" aria-pressed="' + t.done + '" aria-label="' + (t.done ? "Mark not done" : "Mark done") + ": " + esc(t.title) + '">' + ico.check + "</button>" +
      '<div class="txt"><b>' + esc(t.title) + "</b><span>" + [t.module ? esc(t.module) : "", overdue ? "Overdue from " + F.niceDate(t.due_date) : ""].filter(Boolean).join(" · ") + "</span></div>" +
      '<button type="button" class="x-btn" data-del-task="' + esc(t.id) + '" aria-label="Delete task">×</button></div></div>';
  }
  function renderTasks() {
    let strip = "";
    for (let i = 0; i < 7; i++) {
      const d = taskDate(i), iso = F.isoOf(d), has = tasksOn(iso).some((t) => !t.done);
      strip += '<button type="button" class="day' + (i === taskSel ? " sel" : "") + '" data-ti="' + i + '"><small>' + (i === 0 ? "Today" : DAY[d.getDay()]) + "</small><b>" + d.getDate() + "</b>" + (has ? '<span class="pip"></span>' : "") + "</button>";
    }
    $("taskDays").innerHTML = strip;
    $("taskDayName").textContent = taskSel === 0 ? "today" : taskSel === 1 ? "tomorrow" : DAY[taskDate(taskSel).getDay()];
    const list = tasksOn(F.isoOf(taskDate(taskSel)));
    $("taskList").innerHTML = S.tasksMissing ? '<div class="empty"><b>Tasks need one more setup step</b><span>Run funi-v2-setup.sql in Supabase.</span></div>'
      : list.length ? list.map(taskRow).join("") : '<div class="empty"><b>Nothing here yet</b><span>Add a task above. Tick it when it\'s done.</span></div>';
  }
  F.renderTasks = renderTasks;
  $("taskDays").addEventListener("click", (e) => { const b = e.target.closest("[data-ti]"); if (!b) return; taskSel = +b.dataset.ti; renderTasks(); });
  $("taskForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("taskTitle").value.trim();
    if (!title) return F.showError("taskError", "Write what you need to do.");
    F.showError("taskError", "");
    const row = { title, due_date: F.isoOf(taskDate(taskSel)), due_time: $("taskTime").value || null, module: $("taskModule").value || null };
    const { data, error } = await F.sb.from("tasks").insert(row).select().single();
    if (error) return F.showError("taskError", /tasks/.test(error.message) ? "Run funi-v2-setup.sql in Supabase first." : "Couldn't save: " + error.message);
    S.tasks.push(data); F.store(key("tasks"), S.tasks);
    $("taskTitle").value = ""; $("taskTime").value = "";
    renderTasks(); F.renderHome(); scheduleReminders();
    F.toast(row.due_time ? "Added. Funi will remind you at " + row.due_time + " if the app is open." : "Added.");
  });
  async function toggleTask(id) {
    const t = S.tasks.find((x) => x.id === id); if (!t) return;
    t.done = !t.done; t.done_at = t.done ? new Date().toISOString() : null;
    F.store(key("tasks"), S.tasks); renderTasks(); F.renderHome(); scheduleReminders();
    const { error } = await F.sb.from("tasks").update({ done: t.done, done_at: t.done_at }).eq("id", id);
    if (error) F.toast("Couldn't save: " + error.message);
  }
  async function deleteTask(id) {
    const { error } = await F.sb.from("tasks").delete().eq("id", id);
    if (error) return F.toast("Couldn't delete: " + error.message);
    S.tasks = S.tasks.filter((x) => x.id !== id); F.store(key("tasks"), S.tasks); renderTasks(); F.renderHome(); scheduleReminders();
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tick]"); if (t) { toggleTask(t.dataset.tick); return; }
    const d = e.target.closest("[data-del-task]"); if (d) deleteTask(d.dataset.delTask);
  });
  function scheduleReminders() {
    reminderTimers.splice(0).forEach(clearTimeout);
    const today = F.todayISO(), now = Date.now();
    S.tasks.filter((t) => !t.done && t.due_time && t.due_date >= today).forEach((t) => {
      const at = new Date(t.due_date + "T" + String(t.due_time).slice(0, 5) + ":00").getTime() - now;
      if (at > 0 && at < 24 * 3600 * 1000) reminderTimers.push(setTimeout(() => {
        F.systemNotify("Reminder: " + t.title, (t.module ? t.module + " · " : "") + "Tap to open Funi", "task-" + t.id);
        F.toast("Reminder: " + t.title, { long: true, onClick: () => F.go("study:tasks") });
      }, at));
    });
  }

  /* =====================================================================
     HOME
     ===================================================================== */
  F.renderHome = () => {
    if (!F.me) return;
    const p = S.profile || { id: F.me.id, username: F.usernameOf(F.me) };
    $("greetName").textContent = "Hey there, " + F.nameOf(p) + "!";
    const list = F.upcoming();
    if (!list.length) {
      $("homeHero").innerHTML = '<div class="card hero-empty stack"><h2>No tests or exams yet</h2><p>Add one and Funi starts counting down for you.</p><button type="button" class="btn primary" id="heroAdd">Add a test or exam</button></div>';
      $("heroAdd").onclick = openExamSheet;
    } else {
      const n = list[0], d = F.daysLeft(n.due_date);
      $("homeHero").innerHTML = '<div class="hero"><div class="stack" style="gap:6px"><span class="eyebrow">NEXT UP</span>' +
        '<div class="row" style="align-items:flex-end"><span class="num">' + (d === 0 ? "Today" : d) + '</span><span class="what">' + (d === 0 ? "" : d === 1 ? "day left" : "days left") + "</span></div>" +
        '<span class="what">' + esc(n.module) + " · " + esc(n.kind) + '</span><span class="sub">' + F.niceDate(n.due_date) + (n.start_time ? " · " + F.niceTime(n.start_time) : "") + (n.venue ? " · " + esc(n.venue) : "") + "</span></div>" +
        '<div class="art">' + window.FuniArt.avatarSVG(p.avatar, d <= 3 ? "Stressed" : "Feeling great", p.id, {}) + "</div></div>";
    }
    $("homeCircleArt").innerHTML = window.FuniArt.avatarSVG(p.avatar, p.feeling || "Happy", p.id);
    $("statPartners").textContent = S.partners.length;
    $("statLive").textContent = S.partners.filter((x) => S.partnerSessions[x.id]).length;
    const today = tasksOn(F.todayISO()).slice(0, 5);
    $("homeToday").innerHTML = today.length ? '<div class="timeline">' + today.map(taskRow).join("") + "</div>"
      : '<div class="empty"><b>Nothing on today\'s list</b><span>Tap + to add a task or reminder.</span></div>';
    const rest = list.slice(1, 5);
    $("homeComingWrap").hidden = !rest.length;
    $("homeComing").innerHTML = rest.map((x) => examRow(x, false)).join("");
  };

  /* =====================================================================
     STUDY TABS + LOADING
     ===================================================================== */
  const SEGS = { plan: "segPlan", modules: "segModules", focus: "segFocus", tasks: "segTasks", exams: "segExams" };
  const SEG_TITLES = { plan: "Your study plan", modules: "Your modules", focus: "Focus", tasks: "Tasks & reminders", exams: "Tests & exams" };
  F.openSeg = (seg) => {
    if (!SEGS[seg]) seg = "plan";
    S.seg = seg;
    Object.entries(SEGS).forEach(([k, id]) => { $(id).hidden = k !== seg; });
    document.querySelectorAll("#studySeg [data-seg]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.seg === seg)));
    $("studyTitle").textContent = SEG_TITLES[seg];
    $("planSettingsBtn").hidden = seg !== "plan";
    if (seg === "plan") renderPlan();
    if (seg === "modules") renderModules();
    if (seg === "focus") { fillModuleSelects(); drawSesFeelings(); showSession(); }
    if (seg === "tasks") { fillModuleSelects(); renderTasks(); }
    if (seg === "exams") renderExams();
  };
  document.querySelectorAll("#studySeg [data-seg]").forEach((b) => b.addEventListener("click", () => F.openSeg(b.dataset.seg)));
  F.on("view:study", (sub) => F.openSeg(sub || S.seg));
  F.on("view:home", () => F.renderHome());

  F.loadStudy = async () => {
    await Promise.all([loadItems(), loadModules(), loadTasks()]);
    await addMissingModules();
    F.renderHome(); fillModuleSelects(); scheduleReminders();
    if (S.view === "study") F.openSeg(S.seg);
    syncMatchModules();
    if (F.read(timerKey(), null)) F.toast("Your study session is still running.", { onClick: () => F.go("study:focus") });
  };
  F.on("resume", () => { F.loadStudy(); });
  // refresh countdowns at midnight
  setInterval(() => { if (F.me && S.lastDay !== F.todayISO()) { S.lastDay = F.todayISO(); F.renderHome(); } }, 60000);
})();
