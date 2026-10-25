/* Funi study features: tests & exams, modules & priorities, "What do I need?", study timetable,
 * focus / study sessions (with focus time for the dashboard), and tasks & reminders. */
(function () {
  "use strict";
  const F = window.Funi, $ = F.$, esc = F.esc, S = F.s;
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const READY = ["", "Lost", "Shaky", "Okay", "Good", "Ready"];
  const grip = '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>';
  const bell = '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/></svg>';
  const tickSvg = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const key = (k) => "funi." + k + "." + (F.me ? F.me.id : "x");
  const sameCode = (a, b) => String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase();
  F.sameCode = sameCode;

  /* =====================================================================
     TESTS & EXAMS
     ===================================================================== */
  F.upcoming = () => {
    const today = F.todayISO();
    return S.items.filter((x) => x.due_date >= today).sort((a, b) =>
      (a.due_date + (a.start_time || "")).localeCompare(b.due_date + (b.start_time || "")));
  };
  F.nextExamFor = (code) => F.upcoming().find((x) => sameCode(x.module, code));
  const chipClass = (n) => (n <= 7 ? "soon" : n <= 21 ? "mid" : "far");

  async function loadItems() {
    S.items = F.read(key("items"), []);
    const { data, error } = await F.sb.from("assessments").select("*").gte("due_date", F.todayISO()).order("due_date");
    if (error) { F.status("homeStatus", "Showing your saved copy. Couldn't reach Funi's server."); return; }
    F.status("homeStatus", "");
    S.items = data || []; F.store(key("items"), S.items);
  }
  F.examRow = (x, withDelete) => {
    const d = F.daysLeft(x.due_date);
    return '<div class="item"><div class="txt"><b>' + esc(x.module) + " · " + esc(x.kind) + "</b><span>" +
      F.niceDate(x.due_date) + (x.start_time ? " · " + F.niceTime(x.start_time) : "") + (x.venue ? " · " + esc(x.venue) : "") +
      '</span></div><span class="chip-d ' + chipClass(d) + '">' + (d === 0 ? "Today" : d + " d") + "</span>" +
      (withDelete ? '<button class="x-btn" data-del-exam="' + esc(x.id) + '" aria-label="Delete ' + esc(x.module) + " " + esc(x.kind) + '">×</button>' : "") + "</div>";
  };
  function renderExams() {
    const list = F.upcoming();
    $("examList").innerHTML = list.length ? '<div class="list">' + list.map((x) => F.examRow(x, true)).join("") + "</div>"
      : '<div class="empty"><b>No tests or exams yet</b><span>Add one and Funi starts counting down.</span></div>';
  }
  $("examList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-del-exam]"); if (!b) return;
    const x = S.items.find((i) => i.id === b.dataset.delExam);
    if (!(await F.confirm("Delete this " + (x ? x.kind.toLowerCase() : "test") + "?", x ? x.module + " on " + F.niceDate(x.due_date) : "", "Delete"))) return;
    const { error } = await F.sb.from("assessments").delete().eq("id", b.dataset.delExam);
    if (error) return F.toast("Couldn't delete: " + error.message);
    S.items = S.items.filter((i) => i.id !== b.dataset.delExam); F.store(key("items"), S.items);
    renderExams(); F.emit("data");
  });
  F.openExamSheet = () => {
    $("examForm").reset(); $("fTime").value = "09:00"; $("fDate").min = F.todayISO();
    $("moduleCodes").innerHTML = S.modules.map((m) => '<option value="' + esc(m.code) + '">').join("");
    F.showError("examError", ""); $("examSheet").showModal();
  };
  $("addExamBtn").onclick = F.openExamSheet;
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
    renderExams(); F.emit("data");
    const d = F.daysLeft(data.due_date);
    F.toast(d === 0 ? "Saved. It's today, you've got this!" : "Saved. " + d + (d === 1 ? " day" : " days") + " to go.");
  });

  /* =====================================================================
     MODULES & PRIORITIES
     ===================================================================== */
  const prioMode = () => F.read(key("prioMode"), "auto");
  function needFor(m, target) {
    if (!m || m.class_mark == null) return null;
    const cm = +m.class_mark, w = Math.max(0.05, (m.exam_weight == null ? 60 : +m.exam_weight) / 100), sub = m.subminimum == null ? 40 : +m.subminimum;
    return Math.max(0, Math.ceil(Math.max((target - cm * (1 - w)) / w, sub)));
  }
  F.needFor = needFor;
  function moduleScore(m) {
    const pass = needFor(m, 50);
    const needTerm = pass == null ? 1.5 : pass > 100 ? 3.5 : Math.min(4, Math.max(0, (pass - 30) / 60 * 4));
    const exam = F.nextExamFor(m.code), d = exam ? F.daysLeft(exam.due_date) : null;
    const urgency = d == null ? 0 : Math.min(3, 6 / Math.max(d, 1));
    return needTerm + urgency + (5 - (m.confidence || 3)) / 4 * 2;
  }
  F.orderedModules = () => {
    if (prioMode() === "manual") return S.modules.slice().sort((a, b) => (a.priority || 999) - (b.priority || 999));
    return S.modules.slice().sort((a, b) => moduleScore(b) - moduleScore(a));
  };
  F.levelOf = (m) => {
    const list = F.orderedModules(), i = list.findIndex((x) => x.id === m.id), n = list.length;
    if (prioMode() === "manual") return i < Math.ceil(n / 3) ? "High" : i < Math.ceil(2 * n / 3) ? "Medium" : "Low";
    const sc = moduleScore(m); return sc >= 4.5 ? "High" : sc >= 2.5 ? "Medium" : "Low";
  };
  F.readinessOf = (m) => (m ? (m.confidence || 3) * 20 : 40);
  function whyOf(m) {
    const exam = F.nextExamFor(m.code), pass = needFor(m, 50), bits = [];
    if (pass != null) bits.push(pass > 100 ? "Needs more than 100%" : "Needs " + pass + "%");
    if (exam) bits.push(exam.kind.toLowerCase() + " in " + F.daysLeft(exam.due_date) + " days");
    if (pass == null) bits.push("class mark not added");
    const s = bits.join(" · "); return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const PILL = { High: "peach", Medium: "butter", Low: "mint" };

  async function loadModules() {
    S.modules = F.read(key("mods"), []);
    const { data, error } = await F.sb.from("modules").select("*").order("priority", { ascending: true, nullsFirst: false }).order("created_at");
    if (!error) { S.modules = data || []; F.store(key("mods"), S.modules); }
  }
  async function syncMatchModules() {
    if (!F.sb || !F.me) return;
    const codes = [...new Set(S.modules.map((m) => m.code.trim().toUpperCase()))];
    if (codes.length) await F.sb.from("study_profile_modules").upsert(codes.map((c) => ({ user_id: F.me.id, module_code: c, updated_at: new Date().toISOString() })), { onConflict: "user_id,module_code" });
    const { data } = await F.sb.from("study_profile_modules").select("module_code").eq("user_id", F.me.id);
    for (const r of data || []) if (!codes.includes(String(r.module_code).toUpperCase())) await F.sb.from("study_profile_modules").delete().eq("user_id", F.me.id).eq("module_code", r.module_code);
  }

  function renderPriorities() {
    const mode = prioMode();
    document.querySelectorAll("[data-prio]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.prio === mode)));
    $("prioNote").textContent = mode === "manual" ? "Drag the handles to put your modules in your own order." : "Ordered by the marks you need, how soon the exam is and how ready you feel.";
    const mods = F.orderedModules();
    $("modList").innerHTML = mods.length ? mods.map((m, i) => {
      const conf = m.confidence || 3, lvl = F.levelOf(m);
      let dots = "";
      for (let k = 1; k <= 5; k++) dots += '<button type="button" class="dotb' + (k <= conf ? " on" : "") + '" data-conf="' + k + '" aria-label="Ready ' + k + ' of 5"></button>';
      return '<article class="mod" data-mid="' + esc(m.id) + '">' +
        '<div class="mod-head"><span class="mod-rank">' + (i + 1) + '</span><div class="txt"><b>' + esc(m.code) + (m.name ? " · " + esc(m.name) : "") + "</b><span>" + esc(whyOf(m)) + "</span></div>" +
        '<span class="pill ' + PILL[lvl] + '">' + lvl + "</span>" +
        (mode === "manual" ? '<button type="button" class="handle" aria-label="Drag to reorder ' + esc(m.code) + '">' + grip + "</button>" : "") + "</div>" +
        '<div class="dots"><span class="lbl">How ready?</span>' + dots + "<em>" + READY[conf] + "</em></div>" +
        '<div class="mod-foot"><button type="button" class="link" data-marks="' + esc(m.id) + '">' + (m.class_mark == null ? "Add my marks" : "Marks: class " + m.class_mark + "%") + "</button>" +
        '<button type="button" class="x-btn" data-rm aria-label="Remove ' + esc(m.code) + '">×</button></div></article>';
    }).join("") : '<div class="empty"><b>No modules yet</b><span>Add your modules below. Funi also adds them from your tests.</span></div>';
  }
  F.renderPriorities = renderPriorities;
  document.querySelectorAll("[data-prio]").forEach((b) => b.addEventListener("click", () => {
    const mode = b.dataset.prio;
    if (mode === "manual" && prioMode() === "auto") { F.orderedModules().forEach((m, i) => { m.priority = i + 1; }); savePriorities(); }
    F.store(key("prioMode"), mode); renderPriorities(); F.emit("data");
  }));

  const saveTimers = {};
  function saveModule(m, patch) {
    Object.assign(m, patch); F.store(key("mods"), S.modules);
    const k = m.id + Object.keys(patch).join();
    clearTimeout(saveTimers[k]);
    saveTimers[k] = setTimeout(async () => {
      const { error } = await F.sb.from("modules").update(patch).eq("id", m.id);
      if (error) F.toast(/column/i.test(error.message) ? "Run funi-v2-setup.sql in Supabase to save exam weights." : "Couldn't save: " + error.message, { long: true });
    }, 400);
  }
  $("modList").addEventListener("click", async (e) => {
    const card = e.target.closest(".mod"); if (!card) return;
    const m = S.modules.find((x) => x.id === card.dataset.mid);
    const conf = e.target.closest("[data-conf]");
    if (conf) { saveModule(m, { confidence: +conf.dataset.conf }); renderPriorities(); F.emit("data"); return; }
    const mk = e.target.closest("[data-marks]");
    if (mk) { F.marksModule = m.id; F.go("marks"); return; }
    if (e.target.closest("[data-rm]")) {
      if (!(await F.confirm("Remove " + m.code + "?", "Its marks are removed too. Your tests for it stay.", "Remove"))) return;
      const { error } = await F.sb.from("modules").delete().eq("id", m.id);
      if (error) return F.toast("Couldn't remove: " + error.message);
      S.modules = S.modules.filter((x) => x.id !== m.id); F.store(key("mods"), S.modules);
      renderPriorities(); syncMatchModules(); F.emit("data");
    }
  });
  // drag to reorder (I'll choose)
  let drag = null;
  $("modList").addEventListener("pointerdown", (e) => {
    const h = e.target.closest(".handle"); if (!h) return;
    e.preventDefault();
    drag = { card: h.closest(".mod"), id: e.pointerId };
    drag.card.classList.add("dragging");
    h.setPointerCapture(e.pointerId);
  });
  $("modList").addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const list = $("modList");
    let before = null;
    for (const o of list.querySelectorAll(".mod:not(.dragging)")) { const r = o.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { before = o; break; } }
    if (before !== drag.card.nextElementSibling) list.insertBefore(drag.card, before);
    if (e.clientY < 90) window.scrollBy(0, -12); else if (e.clientY > window.innerHeight - 160) window.scrollBy(0, 12);
  });
  function endDrag() {
    if (!drag) return;
    drag.card.classList.remove("dragging");
    [...$("modList").querySelectorAll(".mod")].forEach((c, i) => { const m = S.modules.find((x) => x.id === c.dataset.mid); if (m) m.priority = i + 1; });
    drag = null; renderPriorities(); savePriorities(); F.emit("data");
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
    if (await addModule(code, $("modName").value)) { $("modForm").reset(); renderPriorities(); F.emit("data"); F.toast(code.toUpperCase() + " added. Tap “Add my marks” to see what you need."); }
  });
  async function addMissingModules() {
    const missing = [...new Set(S.items.map((x) => x.module.trim().toUpperCase()))].filter((c) => c && !S.modules.some((m) => sameCode(m.code, c)));
    for (const c of missing) await addModule(c, "", true);
  }

  /* =====================================================================
     WHAT DO I NEED? (standalone)
     ===================================================================== */
  function fillMarks() {
    const mods = F.orderedModules();
    $("mModule").innerHTML = mods.map((m) => '<option value="' + esc(m.id) + '">' + esc(m.code + (m.name ? " · " + m.name : "")) + "</option>").join("") +
      '<option value="">Just checking (don\'t save)</option>';
    const id = F.marksModule && mods.some((m) => m.id === F.marksModule) ? F.marksModule : mods.length ? mods[0].id : "";
    $("mModule").value = id; loadMarksFrom(id);
  }
  function loadMarksFrom(id) {
    const m = S.modules.find((x) => x.id === id);
    $("mClass").value = m && m.class_mark != null ? m.class_mark : 50;
    $("mWeight").value = m && m.exam_weight != null ? m.exam_weight : 60;
    $("mSub").value = m && m.subminimum != null ? m.subminimum : 40;
    $("mSave").textContent = m ? "Save and update my priorities" : "Add a module to save marks";
    $("mSave").disabled = !m;
    calcMarks();
  }
  function calcMarks() {
    const m = { class_mark: +$("mClass").value, exam_weight: +$("mWeight").value, subminimum: +$("mSub").value };
    $("mClassV").textContent = m.class_mark + "%"; $("mWeightV").textContent = m.exam_weight + "% of my final mark"; $("mSubV").textContent = m.subminimum + "%";
    $("mClassW").textContent = "So class work counts " + (100 - m.exam_weight) + "%.";
    const p = needFor(m, 50), fmt = (n) => (n > 100 ? "Out of reach" : n + "%");
    $("mPass").textContent = p > 100 ? "Out of reach" : p + "% in the exam";
    $("mNote").textContent = p > 100 ? "This exam alone can't get you there. Ask your lecturer about a supp." : p <= m.subminimum ? "Your class mark carries you. Just clear the subminimum." : "That's " + Math.max(0, p - m.class_mark) + " points above your class mark.";
    $("m60").textContent = fmt(needFor(m, 60)); $("m75").textContent = fmt(needFor(m, 75));
  }
  ["mClass", "mWeight", "mSub"].forEach((id) => $(id).addEventListener("input", calcMarks));
  $("mModule").addEventListener("change", () => { F.marksModule = $("mModule").value; loadMarksFrom($("mModule").value); });
  $("mSave").onclick = () => {
    const m = S.modules.find((x) => x.id === $("mModule").value); if (!m) return;
    saveModule(m, { class_mark: +$("mClass").value, exam_weight: +$("mWeight").value, subminimum: +$("mSub").value });
    F.toast("Saved. " + m.code + " is updated in your priorities."); F.emit("data"); F.go("priorities");
  };

  /* =====================================================================
     STUDY TIMETABLE
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
    const ordered = F.orderedModules(), n = Math.max(ordered.length, 1), map = new Map();
    ordered.forEach((m, i) => map.set(m.code.toUpperCase(), { code: m.code, rank: i, mod: m }));
    F.upcoming().forEach((x) => { const k = x.module.trim().toUpperCase(); if (!map.has(k)) map.set(k, { code: x.module.trim(), rank: n, mod: null }); });
    const out = [];
    map.forEach((s, k) => {
      const exam = F.upcoming().find((x) => x.module.trim().toUpperCase() === k && x.due_date > dateISO);
      if (F.upcoming().some((x) => x.module.trim().toUpperCase() === k && x.due_date === dateISO)) return;
      const daysTo = exam ? Math.round((new Date(exam.due_date + "T00:00:00") - new Date(dateISO + "T00:00:00")) / 86400000) : 60;
      const conf = s.mod ? s.mod.confidence || 3 : 3, pass = s.mod ? needFor(s.mod, 50) : null;
      const needTerm = pass == null ? 1 : pass > 100 ? 3 : Math.max(0, (pass - 30) / 60 * 3);
      out.push({ code: s.code, conf, pass, daysTo, exam, score: 8 / Math.max(daysTo, 1) + 3 * (n - Math.min(s.rank, n) + 1) / (n + 1) + needTerm + (5 - conf) / 2 });
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
        blocks.push({ start: t, end: t + len, code: s.code, task: taskFor(s), daysTo: s.daysTo, exam: s.exam, conf: s.conf, pass: s.pass, key: dateISO + "|" + t + "|" + s.code });
        s.score *= 0.55; left -= len; t += len + 15;
      }
      if (left < 30) break;
    }
    return { blocks };
  }
  const COLORS = ["c-peach", "c-lav", "c-mint", "c-butter", "c-pink", "c-sky"];
  function colorOf(code) { const i = F.orderedModules().findIndex((m) => sameCode(m.code, code)); return COLORS[(i < 0 ? 5 : i) % COLORS.length]; }
  let planSel = 0;
  function renderPlan() {
    const st = planSettings(), base = new Date(); base.setHours(0, 0, 0, 0);
    $("planInfo").textContent = "Made from your priorities · " + st.hours + "h a day" + (st.classes.length ? " · " + st.classes.length + " classes blocked out" : "");
    let strip = "";
    for (let i = 0; i < 7; i++) {
      const d = new Date(base); d.setDate(base.getDate() + i);
      strip += '<button type="button" class="day' + (i === planSel ? " sel" : "") + (+st.rest === d.getDay() ? " rest" : "") + '" data-pi="' + i + '"><small>' + (i === 0 ? "Today" : DAY[d.getDay()]) + "</small><b>" + d.getDate() + "</b></button>";
    }
    $("planDays").innerHTML = strip;
    const day = new Date(base); day.setDate(base.getDate() + planSel);
    const plan = buildDay(day, st, planSel === 0), done = F.read(key("done"), {});
    if (plan.rest) { $("planBody").innerHTML = '<div class="empty"><b>Rest day</b><span>No study blocks. Rest is part of the plan.</span></div>'; return; }
    if (plan.empty) { $("planBody").innerHTML = '<div class="empty"><b>Nothing to plan yet</b><span>Add your tests and modules, then come back.</span><button class="btn primary small" data-go="priorities">Add modules</button></div>'; return; }
    if (!plan.blocks.length) { $("planBody").innerHTML = '<div class="empty"><b>No free time left today</b><span>Check tomorrow, or change your study hours in settings.</span></div>'; return; }
    const rows = st.classes.filter((c) => +c.day === day.getDay()).map((c) => ({ start: toMin(c.start),
      html: '<div class="tl-row"><span class="tl-time">' + c.start + '</span><div class="cls"><b>Class · ' + esc(c.label || "Class") + "</b><span>Until " + c.end + "</span></div></div>" }));
    plan.blocks.forEach((b) => {
      const isDone = !!done[b.key], len = b.end - b.start;
      const sub = b.exam ? b.task + " · " + b.exam.kind.toLowerCase() + " in " + b.daysTo + " days" : b.task;
      rows.push({ start: b.start, html: '<div class="tl-row"><span class="tl-time">' + toHM(b.start) + '</span><div class="blk ' + colorOf(b.code) + (isDone ? " done" : "") + '">' +
        "<b>" + esc(b.code) + " · " + (len >= 60 ? Math.floor(len / 60) + "h" + (len % 60 ? " " + (len % 60) + "m" : "") : len + "m") + "</b><span>" + esc(sub) + '</span><div class="blk-btns">' +
        (planSel === 0 && !isDone ? '<button type="button" class="btn primary small" data-start-block="' + esc(b.code) + '" data-min="' + Math.min(len, 50) + '">Start</button>' : "") +
        '<button type="button" class="btn ghost small" data-done="' + esc(b.key) + '">' + (isDone ? "Undo" : "Mark done") + "</button></div></div></div>" });
    });
    $("planBody").innerHTML = '<div class="timeline">' + rows.sort((x, y) => x.start - y.start).map((x) => x.html).join("") + "</div>";
  }
  F.renderPlan = renderPlan;
  $("planDays").addEventListener("click", (e) => { const b = e.target.closest("[data-pi]"); if (!b) return; planSel = +b.dataset.pi; renderPlan(); });
  $("planBody").addEventListener("click", (e) => {
    const s = e.target.closest("[data-start-block]");
    if (s) { F.go("study"); $("sesModule").value = s.dataset.startBlock; $("sesMinutes").value = s.dataset.min; return; }
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
    $("planSheet").close(); renderPlan(); F.toast("Timetable rebuilt.");
  };

  /* =====================================================================
     STUDY SESSION (Study tab) — focus time is tracked for the dashboard
     ===================================================================== */
  let sesFeeling = "Happy", tickTimer = null, lastSync = 0;
  const timerKey = () => key("timer");
  F.timerState = () => F.read(timerKey(), null);
  F.fillModuleSelects = () => {
    const codes = [...new Set(F.orderedModules().map((m) => m.code).concat(F.upcoming().map((x) => x.module.trim().toUpperCase())))];
    const keep = $("sesModule").value;
    $("sesModule").innerHTML = codes.map((c) => { const m = S.modules.find((x) => sameCode(x.code, c)); return '<option value="' + esc(c) + '">' + esc(c + (m && m.name ? " · " + m.name : "")) + "</option>"; }).join("") + '<option value="General study">General study</option>';
    if (keep) $("sesModule").value = keep;
    const keepT = $("taskModule").value;
    $("taskModule").innerHTML = '<option value="">None</option>' + codes.map((c) => '<option value="' + esc(c) + '">' + esc(c) + "</option>").join("");
    $("taskModule").value = keepT || "";
  };
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
      const row = { user_id: F.me.id, module_code, feeling: sesFeeling, activity, share_with_partners: share, planned_minutes: focusMin };
      let { data, error } = await F.sb.from("study_sessions").insert(Object.assign({ break_minutes: breakMin, phase: "focus", phase_ends_at: new Date(Date.now() + focusMin * 60000).toISOString() }, row)).select().single();
      if (error && /column/i.test(error.message)) ({ data, error } = await F.sb.from("study_sessions").insert(row).select().single());
      if (error) F.toast("Your timer started, but partners couldn't be told: " + error.message, { long: true });
      if (data) { sessionId = data.id; S.sessions.push(data); }
      if (F.setMyFeeling) F.setMyFeeling(sesFeeling, true);
    }
    const now = Date.now();
    F.store(timerKey(), { sessionId, module: module_code, activity, feeling: sesFeeling, share, focusMin, breakMin, phase: "focus", endAt: now + focusMin * 60000, pausedLeft: null, rounds: 0, startedAt: now, lastTick: now, focusSec: 0 });
    showSession();
  });

  function showSession() {
    const t = F.timerState();
    $("sessionForm").hidden = !!t; $("sessionLive").hidden = !t;
    clearInterval(tickTimer);
    if (!t) { document.body.classList.remove("bigclock-mode"); return; }
    const p = S.profile || { id: F.me && F.me.id };
    $("sesAva").innerHTML = F.avatar(p, t.feeling);
    $("sesTitle").textContent = t.module; $("sesSub").textContent = t.activity;
    $("sesFace").innerHTML = F.face(t.feeling); $("sesMood").textContent = t.feeling; $("sesMoodNote").textContent = F.FEELING_NOTES[t.feeling] || "";
    $("sesScene").innerHTML = window.FuniArt.studyScene(F.isPhoto(p.avatar) ? null : p.avatar, t.feeling, p.id);
    $("sesShareNote").hidden = !t.share;
    tick(); tickTimer = setInterval(tick, 1000);
  }
  F.showSession = showSession;
  async function syncFocus(t, force) {
    if (!t || !t.sessionId || !F.sb) return;
    if (!force && Date.now() - lastSync < 60000) return;
    lastSync = Date.now();
    const sec = Math.round(t.focusSec);
    const row = S.sessions.find((s) => s.id === t.sessionId); if (row) row.focus_seconds = sec;
    await F.sb.from("study_sessions").update({ focus_seconds: sec }).eq("id", t.sessionId);
  }
  const CHEERS = [
    "You did great! Take a {b} minute break, you earned it.",
    "Round done! That's {m} minutes of real work. Breathe, stretch, drink water.",
    "Proud of you! {m} minutes closer to passing {mod}. Break time.",
    "Yes! Another round finished. Small steps add up to big marks.",
    "Well done! Rest for {b} minutes, then let's keep the streak going."
  ];
  const cheer = (t) => CHEERS[Math.floor(Math.random() * CHEERS.length)].replace("{b}", t.breakMin).replace("{m}", t.focusMin).replace("{mod}", t.module);
  // tell the server when this phase ends, so it can buzz the phone even if Funi is closed
  function syncPhase(t) {
    if (!t || !t.sessionId || !F.sb) return;
    const ends = t.pausedLeft != null ? null : new Date(t.endAt).toISOString();
    F.sb.from("study_sessions").update({ phase: t.phase, phase_ends_at: ends }).eq("id", t.sessionId).then(() => {}, () => {});
  }
  F.syncPhase = syncPhase;
  function tick() {
    const t = F.timerState(); if (!t) return;
    const now = Date.now();
    // count real focus time (also catches up after the app was closed)
    if (t.pausedLeft == null && t.phase === "focus") t.focusSec += Math.max(0, (Math.min(now, t.endAt) - t.lastTick) / 1000);
    t.lastTick = now;
    let left = t.pausedLeft != null ? t.pausedLeft : Math.round((t.endAt - now) / 1000);
    let changed = false;
    while (left <= 0 && t.pausedLeft == null) {
      const late = now - t.endAt > 15000; // it ended while Funi was closed: the phone was already buzzed
      changed = true;
      if (t.phase === "focus") {
        t.rounds++; t.phase = "break"; t.endAt = t.endAt + t.breakMin * 60000;
        const msg = cheer(t);
        if (!late) F.systemNotify("Focus session done", msg, "session"); 
        F.toast(late ? "While you were away you finished a round. Well done!" : msg, { long: true });
        syncFocus(t, true);
        left = Math.round((t.endAt - now) / 1000);
      } else {
        // break over: wait for them to tap play for the next round
        t.phase = "focus"; t.pausedLeft = t.focusMin * 60; t.lastTick = now;
        if (!late) F.systemNotify("Break's over", "Ready for round " + (t.rounds + 1) + "? Tap play when you are.", "session");
        F.toast("Break's over. Tap play for the next round.");
        left = t.pausedLeft;
      }
    }
    if (changed) syncPhase(t);
    F.store(timerKey(), t);
    left = Math.max(0, left);
    const m = Math.floor(left / 60), s = left % 60;
    $("sesClock").textContent = (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    const paused = t.pausedLeft != null;
    $("sesCheer").textContent = paused ? "Paused" : t.phase === "break" ? "Break time" : "Keep going!";
    $("sesPhase").textContent = paused ? "Tap play when you're ready" : t.phase === "break" ? "Stretch and drink some water" : "You're doing great!" + (t.rounds ? " · " + t.rounds + " done" : "");
    $("sesPause").innerHTML = paused ? '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>' : '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
    $("sesPause").setAttribute("aria-label", paused ? "Resume" : "Pause");
    syncFocus(t, false);
  }
  $("sesPause").onclick = () => {
    const t = F.timerState(); if (!t) return;
    tick();
    const t2 = F.timerState();
    if (t2.pausedLeft != null) { t2.endAt = Date.now() + t2.pausedLeft * 1000; t2.pausedLeft = null; t2.lastTick = Date.now(); }
    else { t2.pausedLeft = Math.max(0, Math.round((t2.endAt - Date.now()) / 1000)); syncFocus(t2, true); }
    F.store(timerKey(), t2); tick(); syncPhase(t2);
  };
  $("sesBig").onclick = () => {
    const on = document.body.classList.toggle("bigclock-mode");
    $("sesBig").textContent = on ? "Exit big timer" : "Big timer";
    window.scrollTo(0, 0);
  };
  $("sesEnd").onclick = async () => {
    if (!F.timerState()) return;
    if (!(await F.confirm("End this study session?", "Your partners will see you've stopped.", "End session"))) return;
    tick();
    const t = F.timerState();
    if (t.sessionId && F.sb) {
      F.sb.from("study_sessions").update({ phase_ends_at: null }).eq("id", t.sessionId).then(() => {}, () => {});
      await F.sb.from("study_sessions").update({ is_active: false, ended_at: new Date().toISOString(), focus_seconds: Math.round(t.focusSec) }).eq("id", t.sessionId);
      const row = S.sessions.find((s) => s.id === t.sessionId); if (row) row.focus_seconds = Math.round(t.focusSec);
    }
    const mins = Math.max(1, Math.round(t.focusSec / 60));
    F.store(timerKey(), null); document.body.classList.remove("bigclock-mode"); $("sesBig").textContent = "Big timer";
    showSession(); F.emit("data");
    F.toast("Nice work! You focused for " + mins + " minute" + (mins === 1 ? "" : "s") + ".");
  };
  $("sesMoodEdit").onclick = () => F.openFeeling(async (f) => {
    const t = F.timerState(); if (!t) return;
    t.feeling = f; F.store(timerKey(), t);
    if (t.sessionId && F.sb) await F.sb.from("study_sessions").update({ feeling: f }).eq("id", t.sessionId);
    F.go("study");
  });
  async function loadMySessions() {
    const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - ((from.getDay() + 6) % 7) - 7); // Monday last week
    const { data, error } = await F.sb.from("study_sessions").select("id,started_at,focus_seconds,module_code").eq("user_id", F.me.id).gte("started_at", from.toISOString());
    S.sessions = error ? [] : data || [];
  }

  /* =====================================================================
     TASKS & REMINDERS
     ===================================================================== */
  const OFFSETS = [[null, "No alert"], [0, "At the time"], [10, "10 min before"], [30, "30 min before"], [60, "1 hour before"], [1440, "1 day before"]];
  F.offsetLabel = (o) => { const f = OFFSETS.find((x) => x[0] === o); return f ? f[1] : "No alert"; };
  let taskSel = 0, notifyPick = 30;
  const reminderTimers = [];
  async function loadTasks() {
    S.tasks = F.read(key("tasks"), []);
    const first = new Date(); first.setDate(1);
    const { data, error } = await F.sb.from("tasks").select("*").or("due_date.gte." + F.isoOf(first) + ",done.eq.false").order("due_date").order("due_time", { nullsFirst: false });
    if (error) { S.tasksMissing = /tasks/.test(error.message); return; }
    S.tasks = data || []; F.store(key("tasks"), S.tasks);
  }
  const taskDate = (i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; };
  F.tasksOn = (iso) => {
    const today = F.todayISO();
    return S.tasks.filter((t) => t.due_date === iso || (iso === today && t.due_date < today && !t.done))
      .sort((a, b) => (a.done - b.done) || String(a.due_time || "99").localeCompare(String(b.due_time || "99")));
  };
  const BARS = { High: "bar-high", Medium: "bar-med", Low: "bar-low" };
  function taskRow(t) {
    const overdue = t.due_date < F.todayISO() && !t.done;
    const alert = overdue ? "Overdue from " + F.niceDate(t.due_date) : t.due_time && t.remind_offset != null ? F.offsetLabel(t.remind_offset) : t.module || (t.priority || "Medium") + " priority";
    return '<div class="tl-row"><span class="tl-time">' + (t.due_time ? F.niceTime(t.due_time) : "Any") + "</span>" +
      '<div class="task ' + BARS[t.priority || "Medium"] + (t.done ? " done" : "") + '"><div class="txt"><b>' + esc(t.title) + '</b><span class="alert">' + (t.remind_offset != null && t.due_time && !overdue ? bell : "") + esc(alert) + (t.module && alert !== t.module ? " · " + esc(t.module) : "") + "</span></div>" +
      '<button type="button" class="check' + (t.done ? " on" : "") + '" data-tick="' + esc(t.id) + '" aria-pressed="' + !!t.done + '" aria-label="' + (t.done ? "Mark not done" : "Mark done") + ": " + esc(t.title) + '">' + tickSvg + "</button>" +
      '<button type="button" class="x-btn" data-del-task="' + esc(t.id) + '" aria-label="Delete ' + esc(t.title) + '">×</button></div></div>';
  }
  F.taskRow = taskRow;
  function renderTasks() {
    const d0 = taskDate(taskSel);
    $("remMonth").textContent = d0.toLocaleDateString("en-ZA", { month: "long" }).toUpperCase();
    let strip = "";
    for (let i = 0; i < 7; i++) {
      const d = taskDate(i), has = F.tasksOn(F.isoOf(d)).some((t) => !t.done);
      strip += '<button type="button" class="day' + (i === taskSel ? " sel" : "") + '" data-ti="' + i + '"><small>' + DAY[d.getDay()] + "</small><b>" + d.getDate() + "</b>" + (has ? '<span class="pip"></span>' : "") + "</button>";
    }
    $("taskDays").innerHTML = strip;
    $("remDayTitle").textContent = taskSel === 0 ? "TODAY" : taskSel === 1 ? "TOMORROW" : DAY[d0.getDay()].toUpperCase() + " " + d0.getDate();
    const list = F.tasksOn(F.isoOf(d0));
    $("taskList").innerHTML = S.tasksMissing ? '<div class="empty"><b>Reminders need one more setup step</b><span>Run funi-v2-setup.sql in Supabase.</span></div>'
      : list.length ? list.map(taskRow).join("") : '<div class="empty"><b>Nothing here yet</b><span>Tap + to add a reminder. Tick it when it\'s done.</span></div>';
  }
  F.renderTasks = renderTasks;
  $("taskDays").addEventListener("click", (e) => { const b = e.target.closest("[data-ti]"); if (!b) return; taskSel = +b.dataset.ti; renderTasks(); });

  function drawNotify() {
    const hasTime = !!$("taskTime").value;
    $("notifyChips").innerHTML = OFFSETS.map((o) => '<button type="button" class="chip' + (o[0] === notifyPick ? " on" : "") + '" data-off="' + (o[0] == null ? "" : o[0]) + '"' + (!hasTime && o[0] != null ? " disabled" : "") + ">" + o[1] + "</button>").join("");
    if (!hasTime) { $("notifyPreview").textContent = "Add a time to get an alert."; return; }
    if (notifyPick == null) { $("notifyPreview").textContent = "No alert for this one."; return; }
    const at = remindAt($("taskDate").value, $("taskTime").value, notifyPick);
    $("notifyPreview").textContent = "Funi will buzz your phone " + (at ? at.toLocaleString("en-ZA", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "") + ".";
  }
  function remindAt(date, time, off) {
    if (!date || !time || off == null) return null;
    return new Date(new Date(date + "T" + time.slice(0, 5) + ":00").getTime() - off * 60000);
  }
  F.openReminderSheet = (dateISO) => {
    $("taskForm").reset();
    $("taskDate").value = dateISO || F.isoOf(taskDate(taskSel)); $("taskDate").min = F.todayISO();
    $("taskPriority").value = "Medium"; notifyPick = 30;
    F.fillModuleSelects(); F.showError("taskError", ""); drawNotify(); $("remSheet").showModal();
  };
  $("remAddBtn").onclick = () => F.openReminderSheet();
  $("taskTime").addEventListener("input", drawNotify);
  $("taskDate").addEventListener("input", drawNotify);
  $("notifyChips").addEventListener("click", (e) => { const b = e.target.closest("[data-off]"); if (!b || b.disabled) return; notifyPick = b.dataset.off === "" ? null : +b.dataset.off; drawNotify(); });
  $("taskForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("taskTitle").value.trim();
    if (!title) return F.showError("taskError", "Write what you need to remember.");
    if (!$("taskDate").value) return F.showError("taskError", "Choose a date.");
    F.showError("taskError", "");
    const time = $("taskTime").value || null, off = time ? notifyPick : null, at = remindAt($("taskDate").value, time, off);
    const row = { title, due_date: $("taskDate").value, due_time: time, module: $("taskModule").value || null, priority: $("taskPriority").value,
      remind_offset: off, remind_at: at ? at.toISOString() : null };
    let { data, error } = await F.sb.from("tasks").insert(row).select().single();
    if (error && /priority|remind/.test(error.message)) { // v3 setup not run yet: save without the new fields
      ({ data, error } = await F.sb.from("tasks").insert({ title: row.title, due_date: row.due_date, due_time: row.due_time, module: row.module }).select().single());
      if (!error) F.toast("Saved. Run funi-v3-setup.sql in Supabase to get alerts before reminders.", { long: true });
    }
    if (error) return F.showError("taskError", /tasks/.test(error.message) ? "Run funi-v2-setup.sql in Supabase first." : "Couldn't save: " + error.message);
    S.tasks.push(data); F.store(key("tasks"), S.tasks);
    $("remSheet").close(); renderTasks(); scheduleReminders(); F.emit("data");
    if (at) F.toast("Saved. Funi will buzz you " + F.offsetLabel(off).toLowerCase() + (F.pushOn ? "." : ", while Funi is open. Turn on notifications to get it when Funi is closed."), { long: true });
    else F.toast("Saved.");
  });
  async function toggleTask(id) {
    const t = S.tasks.find((x) => x.id === id); if (!t) return;
    t.done = !t.done; t.done_at = t.done ? new Date().toISOString() : null;
    F.store(key("tasks"), S.tasks); renderTasks(); scheduleReminders(); F.emit("data");
    const { error } = await F.sb.from("tasks").update({ done: t.done, done_at: t.done_at }).eq("id", id);
    if (error) F.toast("Couldn't save: " + error.message);
  }
  async function deleteTask(id) {
    const { error } = await F.sb.from("tasks").delete().eq("id", id);
    if (error) return F.toast("Couldn't delete: " + error.message);
    S.tasks = S.tasks.filter((x) => x.id !== id); F.store(key("tasks"), S.tasks); renderTasks(); scheduleReminders(); F.emit("data");
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tick]"); if (t) { toggleTask(t.dataset.tick); return; }
    const d = e.target.closest("[data-del-task]"); if (d) deleteTask(d.dataset.delTask);
  });
  // while Funi is open, also pop the reminder on screen
  function scheduleReminders() {
    reminderTimers.splice(0).forEach(clearTimeout);
    const now = Date.now();
    S.tasks.filter((t) => !t.done && t.remind_at && !t.reminded_at).forEach((t) => {
      const ms = new Date(t.remind_at).getTime() - now;
      if (ms > 0 && ms < 24 * 3600 * 1000) reminderTimers.push(setTimeout(() => {
        if (!F.pushOn) F.systemNotify("Reminder: " + t.title, F.offsetLabel(t.remind_offset) + (t.due_time ? " · " + F.niceTime(t.due_time) : ""), "task-" + t.id);
        F.toast("Reminder: " + t.title + (t.due_time ? " at " + F.niceTime(t.due_time) : ""), { long: true, onClick: () => F.go("reminders") });
      }, ms));
    });
  }

  /* =====================================================================
     VIEW HOOKS + LOADING
     ===================================================================== */
  F.on("view:exams", renderExams);
  F.on("view:priorities", renderPriorities);
  F.on("view:marks", fillMarks);
  F.on("view:plan", renderPlan);
  F.on("view:reminders", () => { F.fillModuleSelects(); renderTasks(); });
  F.on("view:study", () => { F.fillModuleSelects(); drawSesFeelings(); showSession(); });

  F.loadStudy = async () => {
    await Promise.all([loadItems(), loadModules(), loadTasks(), loadMySessions()]);
    await addMissingModules();
    F.fillModuleSelects(); scheduleReminders();
    F.emit("data");
    syncMatchModules();
    if (F.timerState()) {
      showSession(); // catch up on time that passed while Funi was closed
      const t = F.timerState();
      if (t) F.toast(t.pausedLeft != null ? "Your study session is paused." : "Your study session is still running.", { onClick: () => F.go("study") });
    }
  };
  F.on("resume", () => { if (F.timerState()) tick(); F.loadStudy(); });
})();
