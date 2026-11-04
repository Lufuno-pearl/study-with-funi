/* My House for exam season: the daily House Quiz (with a crown), weekly results and dares with fair turns,
 * morning goals, the exam war room ("All the best"), past paper sprints with scanned answers,
 * explain it back (voice answers up to 3 minutes) and the mistake bank. Needs funi-v14-setup.sql. */
(function () {
  "use strict";
  const F = window.Funi, $ = F.$, esc = F.esc, S = F.s;
  const BUCKET = "house-files";
  const me = () => (F.me ? F.me.id : "");
  const ctx = () => (F.houseCtx ? F.houseCtx() : { cur: null, members: [] });
  const profiles = () => F.profiles || {};
  const nameOf = (id) => (id === me() ? "You" : profiles()[id] ? F.nameOf(profiles()[id]) : "Someone");
  const firstName = (id) => (id === me() ? "you" : nameOf(id));
  const ava = (id, cls) => '<span class="ava ' + (cls || "sm") + '">' + F.avatar(profiles()[id] || { id }) + "</span>";
  const DAY = 864e5;
  const pad = (n) => String(n).padStart(2, "0");
  function left(ms) { ms = Math.max(0, ms); const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? h + ":" + pad(m) + ":" + pad(s % 60) : m + ":" + pad(s % 60); }
  function inWords(ms) { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + (m % 60 ? (m % 60) + " min" : ""); }
  const jhbToday = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  const dayLabel = (iso) => (iso === jhbToday() ? "tonight" : "tomorrow");

  let H = null, missing = false, loadJob = 0;
  let quiz = null, dares = [], reacts = [], goals = [], exams = [], wishes = [], moods = [], sprints = [], spPeople = [], spPages = [], spVotes = [];
  let exQ = [], exA = [], exRate = [], mistakes = [], mSaves = [];
  let myQs = [], qDraft = null, editQ = null; // your own quiz questions, the one you're writing, and the one you're editing
  let sheet = null; // { kind, ...view state }
  let chan = null;

  /* ---------- loading ---------- */
  async function load() {
    const c = ctx(); if (!c.cur) return;
    const h = c.cur.id, job = ++loadJob;
    if (!H || H.id !== h) { quiz = null; dares = []; }
    H = c.cur;
    // closes last week (and picks who chooses the dare) the first time anyone opens the house after Sunday's quiz hour
    const cw = await F.sb.rpc("funi_house_close_week", { h });
    if (cw.error && /funi_house_close_week|function|schema cache/i.test(cw.error.message)) { missing = true; render(); return; }
    missing = false;
    const today = jhbToday(), since = new Date(Date.now() - 21 * DAY).toISOString();
    const ids = c.members.map((m) => m.user_id);
    const [q, d, g, ex, w, mo, sp, eq, mi, mq] = await Promise.all([
      F.sb.rpc("funi_quiz_state", { h }),
      F.sb.from("house_dares").select("*").eq("house_id", h).neq("status", "none").order("week_start", { ascending: false }).limit(3),
      ids.length ? F.sb.from("member_goals").select("*").eq("day", today).in("user_id", ids) : Promise.resolve({ data: [] }),
      F.sb.rpc("funi_house_exams", { h }),
      F.sb.from("house_wishes").select("*").eq("house_id", h).gte("exam_date", addDays(today, -2)).order("created_at", { ascending: false }),
      F.sb.from("house_moods").select("*").eq("house_id", h).gte("exam_date", addDays(today, -3)),
      F.sb.from("house_sprints").select("*").eq("house_id", h).gte("starts_at", since).order("starts_at", { ascending: false }).limit(10),
      F.sb.from("house_explain_q").select("*").eq("house_id", h).order("created_at", { ascending: false }).limit(40),
      F.sb.from("house_mistakes").select("*").eq("house_id", h).order("created_at", { ascending: false }).limit(100),
      F.sb.from("house_quiz_q").select("*").eq("house_id", h).eq("author", me()).gte("day", today).order("created_at")
    ]);
    if (job !== loadJob) return;
    quiz = q.data || null; dares = d.data || []; goals = g.data || []; exams = ex.data || []; wishes = w.data || []; moods = mo.data || [];
    sprints = sp.data || []; exQ = eq.data || []; mistakes = mi.data || []; myQs = mq.data || [];
    const sIds = sprints.map((s) => s.id), dIds = dares.map((x) => x.id), qIds = exQ.map((x) => x.id), mIds = mistakes.map((x) => x.id);
    const [sp2, sp3, sp4, dr, ea, ms] = await Promise.all([
      sIds.length ? F.sb.from("house_sprint_people").select("*").in("sprint_id", sIds) : Promise.resolve({ data: [] }),
      sIds.length ? F.sb.from("house_sprint_pages").select("*").in("sprint_id", sIds).order("page_no") : Promise.resolve({ data: [] }),
      sIds.length ? F.sb.from("house_sprint_votes").select("*").in("sprint_id", sIds) : Promise.resolve({ data: [] }),
      dIds.length ? F.sb.from("house_dare_reacts").select("*").in("dare_id", dIds) : Promise.resolve({ data: [] }),
      qIds.length ? F.sb.from("house_explain_a").select("*").in("q_id", qIds).order("created_at") : Promise.resolve({ data: [] }),
      mIds.length ? F.sb.from("house_mistake_saves").select("*").in("m_id", mIds) : Promise.resolve({ data: [] })
    ]);
    if (job !== loadJob) return;
    spPeople = sp2.data || []; spPages = sp3.data || []; spVotes = sp4.data || []; reacts = dr.data || []; mSaves = ms.data || [];
    exA = await cleanExpired(ea.data || []);
    const aIds = exA.map((a) => a.id);
    exRate = aIds.length ? ((await F.sb.from("house_explain_rate").select("*").in("a_id", aIds)).data || []) : [];
    if (job !== loadJob) return;
    const people = [].concat(dares.map((x) => [x.loser, x.picker]), exams.map((x) => x.user_id), wishes.map((x) => [x.from_user, x.to_user]), spPeople.map((x) => x.user_id), exQ.map((x) => x.author), exA.map((x) => x.author), mistakes.map((x) => x.author)).flat();
    if (c.needProfiles) await c.needProfiles(people.filter(Boolean));
    render();
    if (F.F_renderPeople) F.F_renderPeople();
    loadCrowns();
  }
  function addDays(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  // voice answers clear themselves after 7 days unless someone taps ⭐ Keep
  async function cleanExpired(list) {
    const old = list.filter((a) => !a.keep && Date.now() - new Date(a.created_at).getTime() > 7 * DAY);
    const mine = old.filter((a) => a.author === me());
    if (mine.length) {
      F.sb.storage.from(BUCKET).remove(mine.map((a) => a.path)).then(() => {}, () => {});
      F.sb.from("house_explain_a").delete().in("id", mine.map((a) => a.id)).then(() => {}, () => {});
    }
    return list.filter((a) => !old.includes(a));
  }
  let reloadT = 0;
  const reload = () => { clearTimeout(reloadT); reloadT = setTimeout(load, 400); };

  /* ---------- crowns and chicken badges (shown on pictures) ---------- */
  S.crowns = S.crowns || {};
  async function loadCrowns() {
    const { data, error } = await F.sb.rpc("funi_my_crowns");
    if (error) return;
    S.crowns = {}; (data || []).forEach((r) => { if (r.user_id) S.crowns[r.user_id] = true; });
    F.emit("crowns");
  }
  F.isCrowned = (id) => !!(S.crowns && S.crowns[id]);
  F.withCrown = (id, html) => html + (F.isCrowned(id) ? '<span class="crown-mini" aria-label="Won the house quiz">👑</span>' : "");
  function chickenOf(id) {
    return dares.some((d) => d.loser === id && d.status === "active" && d.due_at && Date.now() > new Date(d.due_at).getTime() && Date.now() < new Date(d.due_at).getTime() + 7 * DAY);
  }
  F.houseBadge = (id) => (quiz && quiz.crown === id ? '<span class="hf-badge" aria-label="Crown">👑</span>' : chickenOf(id) ? '<span class="hf-badge" aria-label="Chicken badge">🐔</span>' : "");
  F.on("login", () => { setTimeout(loadCrowns, 1500); });

  /* ---------- the Today tab ---------- */
  function render() {
    const box = $("hsToday"); if (!box) return;
    if (missing) { box.innerHTML = '<div class="empty"><b>One setup step first</b><span>Run funi-v14-setup.sql in Supabase to switch on the House Quiz, dares, goals, sprints and more.</span></div>'; return; }
    if (!quiz) { box.innerHTML = '<p class="status-line">Loading…</p>'; return; }
    box.innerHTML = rulesCard() + dareBanner() + goalsCard() + quizCard() + warCard() + sprintCard() + learnCard();
    tick();
    if (sheet) renderSheet();
  }

  const removeRule = (d) => quiz && quiz.dare_miss === "remove" && d && d.loser !== (quiz.owner || (H && H.owner_id));
  function dueText(iso) { return new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }); }
  function dareNow() {
    // the newest dare that still matters: being chosen, waiting for proof (or late), or done in the last 3 days
    return dares.find((d) => d.status === "choosing" || d.status === "active" || (d.status === "done" && Date.now() - new Date(d.proof_at).getTime() < 3 * DAY) || (d.status === "removed" && Date.now() - new Date(d.due_at).getTime() < 3 * DAY)) || null;
  }
  function dareBanner() {
    const d = dareNow(); if (!d) return "";
    let txt = "", btn = "", cls = "";
    if (d.status === "choosing") {
      if (d.picker === me()) { txt = "🎲 Funi picked you to choose " + nameOf(d.loser) + "'s dare"; btn = "Choose the dare"; cls = "go"; }
      else if (d.loser === me()) txt = "😬 You came last this week. " + nameOf(d.picker) + " is choosing your dare…";
      else txt = "⏳ " + nameOf(d.loser) + " came last this week · " + nameOf(d.picker) + " is choosing the dare";
    } else if (d.status === "active") {
      const late = Date.now() > new Date(d.due_at).getTime();
      if (d.loser === me()) { txt = late ? "🐔 Your dare time ran out. Do it late to lose the chicken badge" : "😅 You have a dare from " + nameOf(d.picker); btn = "Post my proof"; cls = "go"; }
      else txt = late ? "🐔 " + nameOf(d.loser) + " didn't do the dare in time" : "⏳ " + nameOf(d.loser) + " has a dare from " + nameOf(d.picker);
    } else if (d.status === "removed") { txt = "🚪 " + nameOf(d.loser) + " was removed from the house: the dare wasn't done in time"; }
    else { txt = "✅ " + nameOf(d.loser) + " did the dare!"; btn = "See it"; }
    const due = d.status === "active" && Date.now() < new Date(d.due_at).getTime() ? '<span class="hf-count" data-until="' + esc(d.due_at) + '"></span> left' + (d.loser === me() && removeRule(d) ? " · ⚠️ post it in time or you'll be removed" : "") : "";
    return '<button type="button" class="card hf-dare ' + cls + '" data-hf="dare"><span class="grow"><b>' + esc(txt) + "</b>" + (d.body ? "<span>“" + esc(d.body) + "”</span>" : "") + (due ? "<span>" + due + "</span>" : "") + "</span>" + (btn ? '<span class="pill lav">' + esc(btn) + "</span>" : "") + "</button>";
  }

  function rulesCard() {
    const q = quiz, owner = H && H.owner_id === me();
    if (!q || (!q.rules_text && !owner)) return "";
    return '<button type="button" class="card hf-rules" data-hf="rules"><span aria-hidden="true">📜</span><span class="grow"><b>House rules</b><span>' + (q.rules_text ? esc(q.rules_text.split("\n")[0].slice(0, 80)) : "Set your house's rules") + " · dares " + (q.dares_on ? (q.dare_miss === "remove" ? "on, missed = removed" : "on, missed = 🐔") : "off") + "</span></span>" + (owner ? '<span class="pill lav">Edit</span>' : "") + "</button>";
  }
  function renderRules() {
    const q = quiz, owner = H && H.owner_id === me();
    if (!owner) return ["📜 House rules", '<div class="card hf-rules-text">' + (q.rules_text ? esc(q.rules_text) : "No written rules yet.") + "</div>" +
      '<div class="card stack"><b>Dares</b><span>' + (q.dares_on ? "On. Every Sunday the player with the lowest quiz average gets a dare." : "Off in this house.") + "</span>" +
      (q.dares_on ? "<span>" + (q.dare_miss === "remove" ? "⚠️ If the dare isn't done within 1 day, that person is removed from the house automatically (the owner gets the 🐔 instead)." : "🐔 If the dare isn't done within 1 day, that person gets the chicken badge for a week.") + "</span>" : "") +
      "<span>Quiz every day at " + esc(q.quiz_time) + " · up to 10 questions each.</span></div>"];
    sheet.noRerender = true;
    const r = sheet.rules || (sheet.rules = { on: q.dares_on, miss: q.dare_miss, time: q.quiz_time, text: q.rules_text || "" });
    return ["📜 House rules", '<p class="hint">Only you (the owner) can change these. Everyone in the house can read them, and new people must agree before joining.</p>' +
      '<div class="card stack"><div class="hf-row"><span class="grow"><b>Weekly dares</b><span class="hint">Off = just the quiz and the crown</span></span><button type="button" class="hf-switch' + (r.on ? " on" : "") + '" data-hr-dares aria-pressed="' + r.on + '" aria-label="Weekly dares"><i></i></button></div>' +
      '<b>If the dare isn\'t done in time</b>' + [["remove", "🚪 Removed from the house automatically"], ["chicken", "🐔 Chicken badge for a week"]].map((x) => '<button type="button" class="hf-pick' + (r.miss === x[0] ? " on" : "") + '" data-hr-miss="' + x[0] + '" aria-pressed="' + (r.miss === x[0]) + '">' + x[1] + "</button>").join("") +
      '<label for="hrTime">Quiz time</label><select id="hrTime">' + ["17:00", "18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30"].map((t) => "<option" + (t === r.time ? " selected" : "") + ">" + t + "</option>").join("") + "</select>" +
      '<label for="hrText">Written rules (everyone sees these)</label><textarea id="hrText" rows="5" maxlength="600" placeholder="e.g. 1. Play the quiz every night you can.\n2. No phones during sprints.\n3. Do your dare in time, or you\'re out!">' + esc(r.text) + "</textarea>" +
      '<button type="button" class="btn primary block" data-hr-save>Save the rules</button></div>'];
  }
  async function saveRules() {
    const r = sheet.rules; r.text = $("hrText").value.trim(); r.time = $("hrTime").value;
    const { error } = await F.sb.from("houses").update({ dares_on: r.on, dare_miss: r.miss, quiz_time: r.time, rules_text: r.text || null }).eq("id", H.id);
    if (error) return F.toast(/dares_on|dare_miss|rules_text|schema/i.test(error.message) ? "House rules need one setup step: run funi-v15-setup.sql in Supabase." : error.message, { long: true });
    Object.assign(H, { dares_on: r.on, dare_miss: r.miss, rules_text: r.text || null });
    F.toast("Rules saved. Everyone in the house can see them."); sheet.rules = null; closeSheet(); load();
  }
  function myGoals() { return goals.find((g) => g.user_id === me() && g.day === jhbToday()) || null; }
  let goalEdit = false;
  function goalsCard() {
    const g = myGoals(), c = ctx();
    const others = c.members.filter((m) => m.user_id !== me()).map((m) => {
      const x = goals.find((y) => y.user_id === m.user_id);
      const n = x ? (x.done || []).filter(Boolean).length : 0, t = x ? (x.items || []).length : 0;
      return '<span class="hf-chip">' + ava(m.user_id, "xs") + esc(nameOf(m.user_id)) + " · " + (t ? n + " of " + t + (n === t ? " 🔥" : "") : "not set yet") + "</span>";
    }).join("");
    let mine;
    if (!g || goalEdit) {
      const it = g ? g.items : [];
      mine = '<form class="stack hf-goal-form" data-hf-goals>' + [0, 1, 2].map((i) => '<label class="sr-only" for="hfGoal' + i + '">Goal ' + (i + 1) + '</label><input id="hfGoal' + i + '" maxlength="120" placeholder="' + ["e.g. Finish Tut 6 Q1 to Q4", "e.g. Past paper 2022, Section A", "e.g. 10 flashcards for Stats Ch 3"][i] + '" value="' + esc(it[i] || "") + '">').join("") +
        '<button type="submit" class="btn primary small">Save my goals</button></form>';
    } else {
      mine = g.items.map((t, i) => '<button type="button" class="hf-goal' + (g.done[i] ? " done" : "") + '" data-hf-tick="' + i + '" aria-pressed="' + !!g.done[i] + '"><span class="box">' + (g.done[i] ? "✓" : "") + "</span>" + esc(t) + "</button>").join("") +
        '<button type="button" class="link-btn" data-hf="goals-edit">Change my goals</button>';
    }
    const n = g ? g.done.filter(Boolean).length : 0;
    return '<section class="card stack hf-card"><div class="hf-row"><h3>☀️ Today I will…</h3><span class="hint">' + (g ? n + " of " + g.items.length + " done" : "Set 3 goals") + "</span></div>" + mine + (others ? '<div class="hf-chips">' + others + "</div>" : "") + "</section>";
  }

  function quizCard() {
    const q = quiz, now = Date.now(), st = new Date(q.start).getTime(), en = new Date(q.end).getTime();
    const open = now >= st && now < en;
    const mine = (q.questions || []).filter((x) => !x.mine), todo = mine.filter((x) => !x.answered).length;
    let line, btn;
    if (!open && now < st) { line = 'Opens in <span class="hf-count" data-until="' + esc(q.start) + '"></span> · ' + q.drops_total + " question" + (q.drops_total === 1 ? "" : "s") + " so far"; btn = "✍️ Add my questions (" + q.my_drops + "/" + (q.max_drops || 3) + ")"; }
    else if (open && todo) { line = todo + " question" + (todo === 1 ? "" : "s") + " waiting for you · play by midnight"; btn = "▶ Play now"; }
    else if (open && mine.length) { const me1 = (q.tonight || []).find((r) => r.user_id === me()); line = "You scored " + (me1 ? me1.points : 0) + " tonight · add questions for tomorrow"; btn = "See tonight's results"; }
    else { line = open ? "No questions tonight. Add some for tomorrow!" : "Closed for today · next quiz tomorrow at " + q.quiz_time; btn = "✍️ Add my questions (" + q.my_drops + "/" + (q.max_drops || 3) + ")"; }
    const crown = q.crown ? '<span class="pill butter">👑 ' + esc(nameOf(q.crown)) + "</span>" : "";
    return '<button type="button" class="card hf-quiz" data-hf="quiz"><span class="hf-row"><b>🧠 House Quiz · ' + esc(q.quiz_time) + "</b>" + crown + '</span><span class="hf-sub">' + line + '</span><span class="hf-btn">' + esc(btn) + "</span></button>";
  }

  function upcomingExams() {
    const today = jhbToday(), lim = addDays(today, 14), by = {};
    exams.filter((x) => x.due_date >= today && x.due_date <= lim).forEach((x) => { const k = x.user_id + "|" + x.module + "|" + x.due_date; if (!by[k]) by[k] = x; });
    return Object.values(by).sort((a, b) => (a.due_date + (a.start_time || "")).localeCompare(b.due_date + (b.start_time || "")));
  }
  const wishesFor = (x) => wishes.filter((w) => w.to_user === x.user_id && w.module === x.module && w.exam_date === x.due_date);
  function warCard() {
    const list = upcomingExams(), mineSoon = list.find((x) => x.user_id === me() && F.daysLeft(x.due_date) <= 2), other = list.find((x) => x.user_id !== me());
    let body;
    if (mineSoon) { const n = wishesFor(mineSoon).length; body = ava(me()) + '<span class="grow"><b>Your ' + esc(mineSoon.module) + " is " + whenWord(mineSoon.due_date) + "</b><span>" + (n ? "💜 " + n + " " + (n === 1 ? "person" : "people") + " sent you All the best" : "Your house will send you All the best") + "</span></span>"; }
    else if (other) { const n = wishesFor(other).length; body = ava(other.user_id) + '<span class="grow"><b>' + esc(nameOf(other.user_id)) + " writes " + esc(other.module) + " " + whenWord(other.due_date) + "</b><span>" + (n ? n + " sent All the best 💜" : "Be the first to send All the best 💜") + '</span></span><span class="pill lav">Send yours</span>'; }
    else body = '<span class="grow"><b>No tests in the next 2 weeks</b><span>When anyone adds a test or exam, it shows here.</span></span>';
    return '<button type="button" class="card hf-war" data-hf="war"><b>📅 Exam war room</b><span class="hf-row">' + body + "</span></button>";
  }
  function whenWord(iso) { const d = F.daysLeft(iso); return d <= 0 ? "today" : d === 1 ? "tomorrow" : "in " + d + " days"; }

  function sprintNow() {
    const now = Date.now();
    return sprints.filter((s) => new Date(s.starts_at).getTime() + s.minutes * 60000 + DAY > now).sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))[0] || null;
  }
  function sprintCard() {
    const s = sprintNow();
    if (!s) return '<button type="button" class="card hf-sprint" data-hf="sprint"><span class="grow"><b>⚔️ Past paper sprint</b><span>Same paper, same time, same timer. Then compare answers.</span></span><span class="pill lav">Set one up</span></button>';
    const st = new Date(s.starts_at).getTime(), en = st + s.minutes * 60000, now = Date.now(), n = spPeople.filter((p) => p.sprint_id === s.id && p.status === "in").length;
    const when = now < st ? 'Starts in <span class="hf-count" data-until="' + esc(s.starts_at) + '"></span>' : now < en ? '⏱ <span class="hf-count" data-until="' + new Date(en).toISOString() + '"></span> left' : "Time's up · scan and compare";
    return '<button type="button" class="card hf-sprint live" data-hf="sprint" data-sprint="' + esc(s.id) + '"><span class="grow"><b>⚔️ ' + esc(s.title) + "</b><span>" + when + " · " + s.minutes + " min · " + n + " in</span></span></button>";
  }
  function learnCard() {
    const open = exQ.filter((q) => !exA.some((a) => a.q_id === q.id && a.author === me()) && q.author !== me()).length;
    return '<div class="hf-grid"><button type="button" class="card hf-tile" data-hf="explain"><span aria-hidden="true">🎙️</span><b>Explain it back</b><span>' + (open ? open + " question" + (open === 1 ? "" : "s") + " for you" : "Ask the house to explain") + "</span></button>" +
      '<button type="button" class="card hf-tile" data-hf="mistakes"><span aria-hidden="true">❌</span><b>Mistake bank</b><span>' + mistakes.length + " mistake" + (mistakes.length === 1 ? "" : "s") + " saved</span></button></div>";
  }

  // live countdowns
  function tick() {
    document.querySelectorAll("[data-until]").forEach((el) => { el.textContent = left(new Date(el.dataset.until).getTime() - Date.now()); });
  }
  setInterval(() => { if (S.view === "house" || (sheet && $("hfSheet").open)) tick(); }, 1000);

  /* ---------- goals ---------- */
  async function saveGoals(items) {
    const old = myGoals(), done = items.map((t, i) => !!(old && old.items[i] === t && old.done[i]));
    const row = { user_id: me(), day: jhbToday(), items, done, updated_at: new Date().toISOString() };
    const { data, error } = await F.sb.from("member_goals").upsert(row).select().single();
    if (error) return F.toast("Couldn't save your goals: " + error.message, { long: true });
    goals = goals.filter((g) => !(g.user_id === me() && g.day === row.day)).concat([data || row]); goalEdit = false; render();
  }

  /* ---------- the sheet (one dialog for every feature) ---------- */
  function openSheet(kind, extra) { sheet = Object.assign({ kind }, extra || {}); renderSheet(); if (!$("hfSheet").open) $("hfSheet").showModal(); }
  function closeSheet() { sheet = null; stopRec(); if ($("hfSheet").open) $("hfSheet").close(); }
  $("hfSheet").addEventListener("close", () => { sheet = null; stopRec(); });
  function renderSheet() {
    if (!sheet) return;
    const R = { rules: renderRules, quiz: renderQuiz, dare: renderDare, war: renderWar, sprint: renderSprint, explain: renderExplain, mistakes: renderMistakes }[sheet.kind];
    if (!R) return;
    const keep = document.activeElement && document.activeElement.closest && document.activeElement.closest("#hfBody") && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (keep && sheet.noRerender) return; // don't wipe what you're typing when someone else's change comes in
    const [title, html] = R();
    $("hfTitle").textContent = title; $("hfBody").innerHTML = html; tick();
  }

  /* ===== House Quiz ===== */
  const QUIZ_SECS = 20;
  function renderQuiz() {
    const q = quiz, tab = sheet.tab || (Date.now() >= new Date(q.start).getTime() ? "play" : "add");
    sheet.tab = tab; sheet.noRerender = tab === "add";
    const tabs = '<div class="seg hf-seg" role="tablist">' + [["play", "Play"], ["add", "Add questions"], ["tonight", "Tonight"], ["week", "Week"]].map((t) => '<button type="button" role="tab" data-hq-tab="' + t[0] + '" aria-selected="' + (t[0] === tab) + '">' + t[1] + "</button>").join("") + "</div>";
    let body = "";
    const now = Date.now(), st = new Date(q.start).getTime(), en = new Date(q.end).getTime();
    if (tab === "play") {
      if (now < st) body = '<div class="empty"><b>Tonight\'s quiz opens at ' + esc(q.quiz_time) + '</b><span>In <span data-until="' + esc(q.start) + '"></span>. Add your questions before then.</span><button type="button" class="btn primary small" data-hq-tab="add">✍️ Add my questions</button></div>';
      else if (now >= en) body = '<div class="empty"><b>Today\'s quiz has closed</b><span>The next one is tomorrow at ' + esc(q.quiz_time) + ".</span></div>";
      else {
        const list = (q.questions || []).filter((x) => !x.mine), todo = list.filter((x) => !x.answered);
        if (sheet.result) {
          const r = sheet.result, qq = r.q;
          body = '<div class="card stack hf-q"><span class="hf-by">' + ava(qq.author, "xs") + esc(nameOf(qq.author)) + "'s question" + (qq.module ? " · " + esc(qq.module) : "") + "</span><b class=\"hf-qtext\">" + esc(qq.question) + "</b>" +
            qq.options.map((o, i) => '<div class="hf-opt' + (i === r.right ? " right" : i === r.pick ? " wrong" : "") + '">' + esc(o) + (i === r.right ? " ✓" : "") + "</div>").join("") +
            '<p class="hf-fb ' + (r.correct ? "ok" : "bad") + '">' + (r.correct ? "✅ +" + r.points + " points" + (r.points > 130 ? " (fast!)" : "") : "❌ Not this time.") + (r.tip ? " " + esc(nameOf(qq.author)) + "'s tip: " + esc(r.tip) : "") + "</p></div>" +
            '<button type="button" class="btn primary block" data-hq-next>' + (todo.length ? "Next question →" : "See tonight's results") + "</button>";
        } else if (todo.length) {
          const qq = todo[0]; sheet.shownAt = sheet.shownFor === qq.id ? sheet.shownAt : Date.now(); sheet.shownFor = qq.id;
          body = '<p class="hint">Question ' + (list.length - todo.length + 1) + " of " + list.length + " · faster right answers score more" + (q.skipped ? " · " + q.skipped + " skipped (not your modules)" : "") + '</p><div class="hf-timer"><i data-hq-bar style="width:100%"></i></div>' +
            '<div class="card stack hf-q"><span class="hf-by">' + ava(qq.author, "xs") + esc(nameOf(qq.author)) + "'s question" + (qq.module ? " · " + esc(qq.module) : "") + '</span><b class="hf-qtext">' + esc(qq.question) + "</b>" +
            qq.options.map((o, i) => '<button type="button" class="hf-opt" data-hq-pick="' + i + '">' + esc(o) + "</button>").join("") + "</div>";
          startQuizTimer();
        } else if (list.length) body = '<div class="empty"><b>All done for tonight! 🎉</b><span>You scored ' + (((q.tonight || []).find((r) => r.user_id === me()) || {}).points || 0) + ' points.</span><button type="button" class="btn primary small" data-hq-tab="tonight">See tonight\'s results</button></div>';
        else body = '<div class="empty"><b>No questions tonight</b><span>Only your own questions are in, or nobody added any. Add some for tomorrow!</span><button type="button" class="btn primary small" data-hq-tab="add">✍️ Add questions</button></div>';
      }
    } else if (tab === "add") {
      const dd = q.drop_day, mineNext = myQs.filter((x) => x.day === dd), max = q.max_drops || 3;
      const canAdd = editQ || mineNext.length < max, d0 = qDraft || {};
      const v = (k) => esc(d0[k] || ""), opt = (i) => esc((d0.opts || [])[i] || ""), right = d0.c == null ? 0 : d0.c;
      body = '<p class="hint">' + (editQ ? "✏️ You're editing a question for " + (editQ.day === jhbToday() ? "tonight's" : "tomorrow's") + " quiz." : "Your questions go into <b>" + (dd === jhbToday() ? "tonight's" : "tomorrow's") + "</b> quiz (" + esc(q.quiz_time) + "). Up to " + max + " each. Writing a question is revision too!") + "</p>" + (editQ ? "" : myQuestionsList()) +
        (canAdd ? '<form class="stack" id="hqForm" novalidate>' +
          '<label for="hqMod">Module (optional)</label><input id="hqMod" maxlength="30" list="hqMods" placeholder="e.g. APPM2023A" value="' + v("mod") + '"><datalist id="hqMods">' + (S.modules || []).map((m) => '<option value="' + esc(m.code || m.module_code || m) + '">').join("") + "</datalist>" +
          '<label for="hqQ">Question</label><textarea id="hqQ" rows="3" maxlength="300" placeholder="e.g. A rod of mass m and length L spins about one end. What is its moment of inertia?">' + v("q") + "</textarea>" +
          '<span class="label">Answers (tap the circle next to the right one)</span>' +
          [0, 1, 2, 3].map((i) => '<div class="hf-ans"><input type="radio" name="hqC" id="hqC' + i + '" value="' + i + '"' + (i === right ? " checked" : "") + ' aria-label="Answer ' + (i + 1) + ' is right"><input id="hqO' + i + '" maxlength="120" placeholder="' + (i < 2 ? "Answer " + (i + 1) : "Answer " + (i + 1) + " (optional)") + '" value="' + opt(i) + '"></div>').join("") +
          '<label for="hqTip">Tip for people who get it wrong (optional)</label><input id="hqTip" maxlength="300" placeholder="e.g. Use I = ∫ r² dm from 0 to L" value="' + v("tip") + '">' +
          '<p class="form-error" id="hqErr" hidden></p>' +
          (editQ ? '<div class="two"><button type="button" class="btn ghost" data-hq-cancel>Cancel</button><button type="submit" class="btn primary">Save changes</button></div>'
            : '<button type="submit" class="btn primary block">Add my question (' + (mineNext.length + 1) + "/" + max + ")</button>") + "</form>"
          : '<div class="empty"><b>You\'ve added ' + max + " questions ✓</b><span>That's the most for one quiz. You can still edit or delete them above.</span></div>") +
        '<p class="hint">' + q.drops_total + " question" + (q.drops_total === 1 ? "" : "s") + " in so far from the house.</p>";
    } else if (tab === "tonight") {
      const crownAt = new Date(q.crown_until).getTime(), rows = (q.tonight || []).slice().sort((a, b) => (b.avg || 0) - (a.avg || 0) || b.answered - a.answered);
      const head = q.crown ? '<div class="card hf-crowncard">' + ava(q.crown, "lg") + '<span class="crown-big" aria-hidden="true">👑</span><b>' + esc(nameOf(q.crown)) + (Date.now() >= crownAt ? " won tonight!" : " has the crown") + "</b><span>The crown stays on " + (q.crown === me() ? "your" : esc(nameOf(q.crown)) + "'s") + " picture until the next quiz's first hour is over.</span></div>"
        : '<p class="hint">The 👑 goes to the top score in the first hour (until ' + new Date(crownAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + "). Playing later still counts for the week.</p>";
      body = head + '<div class="card stack">' + rows.map((r, i) => '<div class="hf-rank">' + "<b>" + (i + 1) + "</b>" + ava(r.user_id) + '<span class="grow">' + esc(nameOf(r.user_id)) + (r.answered ? ' <span class="hint">· ' + r.answered + " question" + (r.answered === 1 ? "" : "s") + "</span>" : ' <span class="hint">· not played</span>') + "</span><b>" + (r.answered ? (r.avg || 0) + " avg" : "–") + "</b></div>").join("") + "</div>" +
        '<p class="hint">Ranked by average points per question, so people with fewer modules (and fewer questions) aren\'t left behind.</p>';
    } else {
      const players = (q.week || []).filter((r) => r.answered).sort((a, b) => (b.avg || 0) - (a.avg || 0) || b.answered - a.answered), out = (q.week || []).filter((r) => !r.answered);
      body = '<p class="hint">This week (Monday to Sunday), ranked by average points per question. ' + (q.dares_on ? "After Sunday's quiz hour, the <b>player</b> with the lowest average gets a dare, and Funi picks someone at random to choose it." : "Dares are switched off in this house.") + "</p>" +
        '<div class="card stack">' + players.map((r, i) => '<div class="hf-rank' + (q.dares_on && i === players.length - 1 && players.length > 1 ? " last" : "") + '"><b>' + (i + 1) + "</b>" + ava(r.user_id) + '<span class="grow">' + esc(nameOf(r.user_id)) + ' <span class="hint">· ' + r.played + " night" + (r.played === 1 ? "" : "s") + " · " + r.answered + " q</span></span><b>" + (r.avg || 0) + " avg</b></div>").join("") +
        out.map((r) => '<div class="hf-rank out"><b>–</b>' + ava(r.user_id) + '<span class="grow">' + esc(nameOf(r.user_id)) + ' <span class="hint">· didn\'t play' + (q.dares_on ? " · not in the dare draw" : "") + "</span></span><b>–</b></div>").join("") +
        (players.length ? "" : '<p class="hint">Nobody has played yet this week.</p>') + "</div>" +
        '<p class="hint">You\'re a player for the week once you answer at least one quiz. Not playing means no crown, but also no dare.</p>';
    }
    return ["🧠 House Quiz", tabs + body];
  }
  let qTimer = 0;
  function startQuizTimer() {
    clearInterval(qTimer);
    qTimer = setInterval(() => {
      const bar = document.querySelector("[data-hq-bar]"); if (!bar || !sheet || sheet.kind !== "quiz") return clearInterval(qTimer);
      const p = Math.max(0, 1 - (Date.now() - sheet.shownAt) / (QUIZ_SECS * 1000)); bar.style.width = (p * 100) + "%";
    }, 200);
  }
  async function quizPick(i) {
    const qq = (quiz.questions || []).find((x) => x.id === sheet.shownFor); if (!qq || sheet.busy) return;
    sheet.busy = true;
    const took = Date.now() - sheet.shownAt;
    const { data, error } = await F.sb.rpc("funi_quiz_answer", { q: qq.id, pick: i, took });
    sheet.busy = false; clearInterval(qTimer);
    if (error) { F.toast(error.message, { long: true }); return reload(); }
    Object.assign(qq, { answered: true, choice: i, points: data.points, right: data.right, tip: data.tip });
    sheet.result = { q: qq, pick: i, correct: data.correct, points: data.points, right: data.right, tip: data.tip };
    renderSheet();
  }
  // your questions: edit or delete them until that quiz starts
  function myQuestionsList() {
    if (!myQs.length) return "";
    const byDay = {}; myQs.forEach((x) => { (byDay[x.day] = byDay[x.day] || []).push(x); });
    return Object.keys(byDay).sort().map((day) => {
      const started = Date.now() >= quizStartFor(day);
      return '<div class="card stack hf-myqs"><b>Your questions for ' + (day === jhbToday() ? "tonight" : day === addDays(jhbToday(), 1) ? "tomorrow" : F.niceDate(day)) + (started ? " · 🔒 locked, the quiz has started" : "") + "</b>" +
        byDay[day].map((x) => '<div class="hf-myq' + (editQ && editQ.id === x.id ? " editing" : "") + '"><span class="hf-qtext">' + esc(x.question) + "</span>" + (x.module ? '<span class="hint">' + esc(x.module) + "</span>" : "") +
          '<ul class="hf-myopts">' + x.options.map((o, i) => '<li class="' + (i === x.correct ? "right" : "") + '">' + (i === x.correct ? "✓ " : "") + esc(o) + "</li>").join("") + "</ul>" + (x.tip ? '<span class="hint">Tip: ' + esc(x.tip) + "</span>" : "") +
          (started ? "" : '<div class="hf-row"><button type="button" class="btn ghost small" data-hq-edit="' + esc(x.id) + '">✏️ Edit</button><button type="button" class="btn ghost small danger-text" data-hq-del="' + esc(x.id) + '">🗑 Delete</button></div>') + "</div>").join("") + "</div>";
    }).join("");
  }
  function quizStartFor(day) {
    // the quiz time (Johannesburg, UTC+2) on that day
    const t = (quiz && quiz.quiz_time) || "19:00";
    return new Date(day + "T" + t + ":00+02:00").getTime();
  }
  function readDraft() {
    if (!$("hqForm")) return qDraft;
    const c = document.querySelector('input[name="hqC"]:checked');
    qDraft = { mod: $("hqMod").value, q: $("hqQ").value, opts: [0, 1, 2, 3].map((i) => $("hqO" + i).value), c: c ? +c.value : 0, tip: $("hqTip").value };
    return qDraft;
  }
  async function refreshQuiz() {
    const [st, mq] = await Promise.all([F.sb.rpc("funi_quiz_state", { h: H.id }), F.sb.from("house_quiz_q").select("*").eq("house_id", H.id).eq("author", me()).gte("day", jhbToday()).order("created_at")]);
    if (st.data) quiz = st.data; myQs = mq.data || [];
  }
  async function addQuestion() {
    const opts = [0, 1, 2, 3].map((i) => $("hqO" + i).value.trim());
    const pick = +((document.querySelector('input[name="hqC"]:checked') || {}).value || 0);
    const qText = $("hqQ").value.trim(), err = (t) => { $("hqErr").textContent = t; $("hqErr").hidden = false; };
    if (qText.length < 3) return err("Write the question first.");
    const filled = opts.map((o, i) => [o, i]).filter((x) => x[0]);
    if (filled.length < 2) return err("Add at least 2 answers.");
    if (!opts[pick]) return err("Tap the circle next to the right answer.");
    const options = filled.map((x) => x[0]), correct = filled.findIndex((x) => x[1] === pick);
    const row = { house_id: H.id, author: me(), day: editQ ? editQ.day : quiz.drop_day, module: $("hqMod").value.trim().toUpperCase() || null, question: qText, options, correct, tip: $("hqTip").value.trim() || null };
    if (editQ) {
      // saving an edit: the new version replaces the old one (only before that quiz starts)
      const old = editQ;
      const del = await F.sb.from("house_quiz_q").delete().eq("id", old.id);
      if (del.error) return err(del.error.message);
      const { error } = await F.sb.from("house_quiz_q").insert(row);
      if (error) { const o = Object.assign({}, old); delete o.id; await F.sb.from("house_quiz_q").insert(o); return err(error.message); }
      F.toast("Changes saved ✓");
    } else {
      const { error } = await F.sb.from("house_quiz_q").insert(row);
      if (error) return err(error.message);
      F.toast("Question added ✓");
    }
    qDraft = null; editQ = null;
    await refreshQuiz();
    sheet.noRerender = false; render();
  }

  /* ===== Dares ===== */
  const DARES = [["voice", "Sing the chorus of any song as a voice note"], ["photo", "Make a funny face and use it as your Funi profile picture for a whole day"],
    ["voice", "Say “red lorry, yellow lorry” 5 times fast as a voice note"], ["photo", "Selfie with something silly on your head"],
    ["video", "Do 10 star jumps while saying the alphabet backwards"], ["voice", "Explain your module in 30 seconds like a sports commentator"]];
  const PROOF = { photo: "📸 Photo", voice: "🎤 Voice note", video: "🎥 Short video" };
  function renderDare() {
    const d = dares.find((x) => x.id === sheet.id) || dareNow();
    if (!d) return ["🎲 The dare", '<div class="empty"><b>No dare right now</b><span>Every Sunday after the quiz hour, whoever has the fewest points for the week gets one.</span></div>'];
    sheet.id = d.id;
    const head = '<div class="hf-dare-head">' + ava(d.loser) + '<span class="grow"><b>' + esc(nameOf(d.loser)) + " came last in the week of " + F.niceDate(d.week_start) + "</b><span>Dare chosen by " + esc(nameOf(d.picker)) + " · picked at random by Funi (fair turns)</span></span></div>";
    let body = "";
    if (d.status === "choosing") {
      sheet.noRerender = true;
      const canPick = d.picker === me() || (Date.now() - new Date(d.created_at).getTime() > DAY && d.loser !== me());
      if (!canPick) body = '<div class="empty"><b>' + esc(nameOf(d.picker)) + " is choosing the dare</b><span>" + (d.loser === me() ? "You'll get a ping when it's ready. Then you have 1 day." : "Everyone gets a ping when it's set.") + "</span></div>";
      else {
        const txt = sheet.text != null ? sheet.text : DARES[1][1], kind = sheet.proof || "photo";
        sheet.text = txt; sheet.proof = kind;
        body = '<p class="hint">Pick a dare for ' + esc(nameOf(d.loser)) + ", then change it however you like. It must be something the house can <b>see in Funi</b>.</p>" +
          '<div class="stack">' + DARES.map((x, i) => '<button type="button" class="hf-pick' + (x[1] === txt ? " on" : "") + '" data-hd-sug="' + i + '">' + esc(x[1]) + "</button>").join("") + "</div>" +
          '<label for="hdText">' + esc(nameOf(d.loser)) + '\'s dare (you can edit it)</label><textarea id="hdText" rows="2" maxlength="200">' + esc(txt) + "</textarea>" +
          '<span class="label">How they show the proof</span><div class="seg hf-seg">' + Object.keys(PROOF).map((k) => '<button type="button" data-hd-proof="' + k + '" aria-selected="' + (k === kind) + '">' + PROOF[k] + "</button>").join("") + "</div>" +
          (removeRule(d) ? '<p class="hint">⚠️ House rule: if ' + esc(nameOf(d.loser)) + " doesn't do it within 1 day, they're removed from the house.</p>" : "") +
          '<button type="button" class="btn primary block" data-hd-set>Give ' + esc(nameOf(d.loser)) + " this dare</button>";
      }
    } else if (d.status === "active") {
      sheet.noRerender = false;
      const late = Date.now() > new Date(d.due_at).getTime();
      body = '<div class="card hf-dare-box"><b>“' + esc(d.body) + "”</b><span>Proof: " + PROOF[d.proof_kind || "photo"] + "</span></div>" +
        (!late && removeRule(d) ? '<div class="card hf-warn"><span aria-hidden="true">⚠️</span><span>House rule: if ' + (d.loser === me() ? "you don't" : esc(nameOf(d.loser)) + " doesn't") + " post the proof by <b>" + esc(dueText(d.due_at)) + "</b>, " + (d.loser === me() ? "you'll" : "they'll") + " be removed from the house automatically.</span></div>" : "") +
        (late ? '<div class="card hf-chicken"><span aria-hidden="true">🐔</span><span>Time ran out, so ' + (d.loser === me() ? "you get" : esc(nameOf(d.loser)) + " gets") + " the <b>chicken badge</b> for a week. Doing the dare late takes it off.</span></div>"
          : '<div class="hf-big"><span>' + (d.loser === me() ? "You have" : "Time left") + '</span><b data-until="' + esc(d.due_at) + '"></b></div>') +
        (d.loser === me() ? proofControls(d) : '<p class="hint">Everyone gets a ping when the proof is up.</p>');
    } else if (d.status === "removed") {
      sheet.noRerender = false;
      body = '<div class="card hf-dare-box"><b>“' + esc(d.body || "") + '”</b><span>🚪 Not done in time · ' + esc(nameOf(d.loser)) + " was removed from the house (house rule)</span></div><p class=\"hint\">Anyone in the house can invite them again.</p>";
    } else {
      sheet.noRerender = false;
      body = '<div class="card hf-dare-box"><b>“' + esc(d.body) + "”</b><span>✅ Done " + esc(F.timeAgo(d.proof_at)) + "</span></div>" + '<div class="hf-proof" id="hdProof"><p class="status-line">Loading the proof…</p></div>' +
        '<div class="hf-reacts">' + ["😂", "💀", "🔥", "👏"].map((e) => { const n = reacts.filter((r) => r.dare_id === d.id && r.emoji === e).length, mine = reacts.some((r) => r.dare_id === d.id && r.emoji === e && r.user_id === me()); return '<button type="button" class="hf-react' + (mine ? " on" : "") + '" data-hd-react="' + e + '" aria-pressed="' + mine + '">' + e + " " + n + "</button>"; }).join("") + "</div>";
      setTimeout(() => showProof(d), 0);
    }
    return ["🎲 The dare", head + body];
  }
  function proofControls(d) {
    const k = d.proof_kind || "photo";
    if (k === "voice") return '<div class="hf-rec" id="hdRec">' + recUi("hd", 60) + "</div>";
    return '<label class="btn primary block hf-file">' + (k === "video" ? "🎥 Record or pick a short video" : "📸 Take or pick a photo") + '<input type="file" id="hdFile" accept="' + (k === "video" ? "video/*" : "image/*") + '" capture="user" hidden></label><p class="hint">Up to 10 MB. It goes in the house for everyone to see.</p>';
  }
  async function showProof(d) {
    const box = $("hdProof"); if (!box || !d.proof_path) return;
    const { data } = await F.sb.storage.from(BUCKET).createSignedUrl(d.proof_path, 3600);
    if (!$("hdProof")) return;
    const u = data && data.signedUrl, m = d.proof_mime || "";
    box.innerHTML = !u ? '<p class="hint">Couldn\'t load the proof.</p>' : /^image/.test(m) ? '<img src="' + esc(u) + '" alt="' + esc(nameOf(d.loser)) + '\'s proof">' : /^video/.test(m) ? '<video src="' + esc(u) + '" controls playsinline></video>' : '<audio src="' + esc(u) + '" controls></audio>';
  }
  async function postProof(blob, mime) {
    const d = dares.find((x) => x.id === sheet.id); if (!d) return;
    if (blob.size > 10 * 1024 * 1024) return F.toast("That's bigger than 10 MB. Try a shorter video.");
    let b = blob, type = mime || blob.type || "application/octet-stream";
    if (/^image\//.test(type) && F.shrinkImage) { try { const r = await F.shrinkImage(blob); b = r.blob; if (r.ext) type = r.type; } catch (e) {} }
    const ext = /png/.test(type) ? "png" : /jpe?g/.test(type) ? "jpg" : /webp/.test(type) ? "webp" : /mp4/.test(type) ? "mp4" : /quicktime/.test(type) ? "mov" : /webm/.test(type) ? "webm" : /ogg/.test(type) ? "ogg" : "bin";
    const path = H.id + "/dares/" + d.id + "/" + Date.now() + "." + ext;
    F.toast("Posting your proof…");
    const up = await F.sb.storage.from(BUCKET).upload(path, b, { contentType: type, upsert: false });
    if (up.error) return F.toast("Couldn't upload: " + up.error.message, { long: true });
    const { error } = await F.sb.rpc("funi_dare_proof", { d: d.id, p: path, mime: type });
    if (error) return F.toast(error.message, { long: true });
    F.toast("✅ Dare done! The house can see it now."); load();
  }

  /* ===== voice recording (dares and explain it back) ===== */
  let rec = null;
  function recUi(prefix, max) {
    const r = rec && rec.prefix === prefix ? rec : null, secs = r ? r.secs : 0;
    return '<div class="hf-rec-row"><button type="button" class="hf-recbtn' + (r && r.on ? " on" : "") + '" data-rec="' + prefix + '" data-max="' + max + '" aria-label="' + (r && r.on ? "Stop recording" : "Record") + '"><i></i></button><span class="grow"><b data-rec-state>' + (r && r.on ? "⏺ Recording…" : r && r.blob ? "Recorded " + left(secs * 1000) : "Tap to record") + '</b><span class="hf-recbar"><i data-rec-bar style="width:' + Math.round(secs / max * 100) + '%"></i></span></span><span class="hint" data-rec-clock>' + left(secs * 1000) + " / " + left(max * 1000) + "</span></div>" +
      (r && r.blob && !r.on ? '<div class="two"><button type="button" class="btn ghost small" data-rec-redo="' + prefix + '">Record again</button><button type="button" class="btn primary small" data-rec-send="' + prefix + '">Send</button></div>' : "");
  }
  function pickMime() { if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return ""; return ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m)) || ""; }
  async function startRec(prefix, max) {
    stopRec();
    if (!navigator.mediaDevices || !window.MediaRecorder) return F.toast("This phone can't record here. Try Chrome or Safari.");
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { return F.toast("Allow the microphone for Funi to record."); }
    const mime = pickMime(), mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 }), chunks = [];
    rec = { prefix, max, on: true, secs: 0, mr, stream, mime: mime || "audio/webm", blob: null, started: Date.now() };
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); if (rec && rec.mr === mr) { rec.on = false; rec.blob = new Blob(chunks, { type: rec.mime.split(";")[0] }); paintRec(); } };
    mr.start(500);
    rec.t = setInterval(() => { if (!rec) return; rec.secs = Math.round((Date.now() - rec.started) / 1000); if (rec.secs >= max) { rec.secs = max; try { mr.stop(); } catch (e) {} clearInterval(rec.t); } paintRec(); }, 250);
    paintRec();
  }
  function stopRec(keep) { if (!rec) return; clearInterval(rec.t); if (rec.on) { try { rec.mr.stop(); } catch (e) {} } if (!keep) { try { rec.stream.getTracks().forEach((t) => t.stop()); } catch (e) {} rec = null; } }
  function paintRec() {
    if (!rec) return;
    const box = document.querySelector('[data-rec="' + rec.prefix + '"]'); if (!box) return;
    const wrap = box.closest(".hf-rec"); if (wrap) wrap.innerHTML = recUi(rec.prefix, rec.max);
  }

  /* ===== Exam war room ===== */
  const IDEAS = [["🔥 You got this", "All the best! You put in the work, now go show that paper who's boss 🔥"], ["😮‍💨 Breathe", "All the best! Breathe, read every question twice, and trust what you know 💪"],
    ["✨ Proud", "All the best! So proud of how hard you worked for this ✨"], ["😤 Eat it up", "All the best! Go eat that paper up 😤📝"]];
  const MOODS = [["😄", "Nailed it"], ["🙂", "Okay"], ["😐", "Hmm"], ["😭", "Rough"]];
  function renderWar() {
    const list = upcomingExams();
    if (sheet.to) {
      sheet.noRerender = true;
      const x = list.find((e) => e.user_id === sheet.to.user && e.module === sheet.to.module && e.due_date === sheet.to.date) || sheet.to.row;
      const txt = sheet.text != null ? sheet.text : "";
      return ["💜 All the best", '<button type="button" class="link-btn" data-hw-back>← All exams</button><div class="hf-row">' + ava(x.user_id) + '<span class="grow"><b>' + esc(nameOf(x.user_id)) + " · " + esc(x.module) + "</b><span class=\"hint\">" + F.niceDate(x.due_date) + (x.start_time ? " · " + F.niceTime(x.start_time) : "") + (x.venue ? " · " + esc(x.venue) : "") + "</span></span></div>" +
        '<label for="hwText">Write your message to ' + esc(nameOf(x.user_id)) + '</label><textarea id="hwText" rows="4" maxlength="280" placeholder="All the best! …">' + esc(txt) + "</textarea>" +
        '<span class="label">Need an idea? Tap one, then change it however you like</span><div class="hf-chips">' + IDEAS.map((i, n) => '<button type="button" class="chip" data-hw-idea="' + n + '">' + esc(i[0]) + "</button>").join("") + "</div>" +
        '<button type="button" class="btn primary block" data-hw-send>Send to ' + esc(nameOf(x.user_id)) + " 💜</button>"];
    }
    sheet.noRerender = false;
    const today = jhbToday();
    const mineToday = exams.filter((x) => x.user_id === me() && x.due_date === today);
    const moodBox = mineToday.map((x) => { const my = moods.find((m) => m.user_id === me() && m.module === x.module && m.exam_date === x.due_date);
      return '<div class="card stack"><b>After your ' + esc(x.module) + ": how did it go?</b><div class=\"hf-moods\">" + MOODS.map((m, i) => '<button type="button" class="hf-mood' + (my && my.mood === i + 1 ? " on" : "") + '" data-hw-mood="' + esc(x.module + "|" + x.due_date) + '" data-mood="' + (i + 1) + '">' + m[0] + " " + m[1] + "</button>").join("") + "</div></div>"; }).join("");
    const rows = list.map((x) => {
      const ws = wishesFor(x), mine = x.user_id === me(), sent = ws.some((w) => w.from_user === me()), d = F.daysLeft(x.due_date);
      const mood = moods.filter((m) => m.user_id === x.user_id && m.module === x.module && m.exam_date === x.due_date)[0];
      return '<div class="card hf-exam"><div class="hf-row">' + ava(x.user_id) + '<span class="grow"><b>' + esc(nameOf(x.user_id)) + " · " + esc(x.module) + " " + esc(x.kind || "") + '</b><span class="hint">' + F.niceDate(x.due_date) + (x.start_time ? " · " + F.niceTime(x.start_time) : "") + (x.venue ? " · " + esc(x.venue) : "") + (ws.length ? " · 💜 " + ws.length : "") + (mood ? " · " + MOODS[mood.mood - 1][0] + " " + MOODS[mood.mood - 1][1] : "") + "</span></span>" +
        '<span class="chip-d ' + (d <= 1 ? "soon" : d <= 7 ? "mid" : "far") + '">' + (d <= 0 ? "Today" : d === 1 ? "Tomorrow" : d + " d") + "</span></div>" +
        (mine ? (ws.length ? '<div class="hf-wishes">' + ws.map((w) => '<div class="hf-wish">' + ava(w.from_user, "xs") + '<span><b>' + esc(nameOf(w.from_user)) + "</b> " + esc(w.body) + "</span></div>").join("") + "</div>" : '<p class="hint">Your house can send you All the best here.</p>')
          : '<button type="button" class="btn ' + (sent ? "ghost" : "primary") + ' small" data-hw-to="' + esc(x.user_id + "|" + x.module + "|" + x.due_date) + '">' + (sent ? "Sent ✓ · send another" : "Send All the best 💜") + "</button>") + "</div>";
    }).join("");
    return ["📅 Exam war room", moodBox + (rows || '<div class="empty"><b>No tests in the next 2 weeks</b><span>When anyone in the house adds a test or exam in Funi, it shows here.</span></div>')];
  }

  /* ===== Past paper sprints ===== */
  function renderSprint() {
    if (sheet.view === "new") return renderSprintNew();
    const s = sprints.find((x) => x.id === sheet.id) || (sheet.view !== "list" && sprintNow());
    if (!s || sheet.view === "list") {
      sheet.noRerender = false;
      const list = sprints.map((x) => { const st = new Date(x.starts_at).getTime(), en = st + x.minutes * 60000, now = Date.now();
        return '<button type="button" class="card hf-row hf-sp" data-sp-open="' + esc(x.id) + '"><span class="grow"><b>' + esc(x.title) + '</b><span class="hint">' + new Date(x.starts_at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " · " + x.minutes + " min · by " + esc(nameOf(x.created_by)) + "</span></span><span class=\"pill " + (now < st ? "lav" : now < en ? "butter" : "") + '">' + (now < st ? "Soon" : now < en ? "Live" : "Done") + "</span></button>"; }).join("");
      return ["⚔️ Past paper sprints", '<button type="button" class="btn primary block" data-sp-new>+ Set up a sprint</button>' + (list || '<div class="empty"><b>No sprints yet</b><span>Pick a past paper and a time. Everyone writes it at the same time, then you compare answers.</span></div>')];
    }
    sheet.id = s.id; sheet.noRerender = false;
    if (sheet.q) return renderCompare(s);
    const st = new Date(s.starts_at).getTime(), en = st + s.minutes * 60000, now = Date.now();
    const ppl = spPeople.filter((p) => p.sprint_id === s.id), mine = ppl.find((p) => p.user_id === me());
    const pagesBy = {}; spPages.filter((p) => p.sprint_id === s.id).forEach((p) => { (pagesBy[p.user_id] = pagesBy[p.user_id] || []).push(p); });
    const file = s.file_id && (window.Funi.houseFiles ? window.Funi.houseFiles().find((f) => f.id === s.file_id) : null);
    const stateBox = now < st ? '<div class="hf-big"><span>Starts in</span><b data-until="' + esc(s.starts_at) + '"></b></div>'
      : now < en ? '<div class="hf-big live"><span>Time left · phones down</span><b data-until="' + new Date(en).toISOString() + '"></b></div>'
      : '<div class="card hf-done"><b>⏰ Time\'s up!</b><span>Scan your answers, then compare question by question.</span></div>';
    const people = '<div class="card stack"><b>Who\'s writing</b>' + ctx().members.map((m) => { const p = ppl.find((x) => x.user_id === m.user_id), pg = (pagesBy[m.user_id] || []).length;
      return '<div class="hf-row">' + ava(m.user_id) + '<span class="grow">' + esc(nameOf(m.user_id)) + "</span><span class=\"pill " + (pg ? "mint" : p && p.status === "in" ? "lav" : "") + '">' + (pg ? pg + " page" + (pg === 1 ? "" : "s") + " ✓" : p ? (p.status === "in" ? "I'm in" : p.status === "maybe" ? "Maybe" : "Out") : "—") + "</span></div>"; }).join("") + "</div>";
    const joinBtns = now < en ? '<div class="two"><button type="button" class="btn ' + (mine && mine.status === "in" ? "primary" : "ghost") + ' small" data-sp-join="in">I\'m in</button><button type="button" class="btn ' + (mine && mine.status === "maybe" ? "primary" : "ghost") + ' small" data-sp-join="maybe">Maybe</button></div>' : "";
    const paper = file ? '<button type="button" class="btn ghost block" data-sp-paper="' + esc(file.id) + '">📄 Open the paper</button>' : "";
    const scan = now >= st ? '<button type="button" class="btn primary block" data-sp-scan>📷 Scan my answers' + ((pagesBy[me()] || []).length ? " (add pages)" : "") + "</button>" : "";
    const compare = Object.keys(pagesBy).length ? '<span class="label">Compare answers</span><div class="hf-qchips">' + Array.from({ length: s.questions }, (_, i) => '<button type="button" class="chip" data-sp-q="' + (i + 1) + '">Q' + (i + 1) + "</button>").join("") + "</div>" : "";
    return ["⚔️ " + s.title, '<button type="button" class="link-btn" data-sp-list>← All sprints</button><p class="hint">' + new Date(s.starts_at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " · " + s.minutes + " min · " + s.questions + " questions · set up by " + esc(nameOf(s.created_by)) + "</p>" +
      stateBox + paper + scan + joinBtns + compare + people + (s.created_by === me() ? '<button type="button" class="link-btn danger" data-sp-del>Delete this sprint</button>' : "")];
  }
  function renderSprintNew() {
    sheet.noRerender = true;
    const files = (window.Funi.houseFiles ? window.Funi.houseFiles() : []).filter((f) => f.kind === "file" && /pdf|image/.test(f.mime || ""));
    const d = new Date(Date.now() + 3600e3); d.setMinutes(0, 0, 0);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    return ["⚔️ New sprint", '<button type="button" class="link-btn" data-sp-list>← All sprints</button><form class="stack" id="spForm" novalidate>' +
      '<label for="spTitle">Name</label><input id="spTitle" maxlength="80" placeholder="e.g. APPM2023A Nov 2023 exam">' +
      '<label for="spFile">The paper (from the house files)</label><select id="spFile"><option value="">No file (everyone has their own copy)</option>' + files.map((f) => '<option value="' + esc(f.id) + '">' + esc(f.name) + "</option>").join("") + "</select>" +
      '<label for="spStart">Starts</label><input id="spStart" type="datetime-local" value="' + local + '">' +
      '<div class="two"><span><label for="spMin">Minutes</label><input id="spMin" type="number" min="10" max="300" value="180"></span><span><label for="spQs">Questions</label><input id="spQs" type="number" min="1" max="30" value="6"></span></div>' +
      '<p class="form-error" id="spErr" hidden></p><button type="submit" class="btn primary block">Set it up and tell the house</button></form>'];
  }
  function renderCompare(s) {
    const q = sheet.q, pages = spPages.filter((p) => p.sprint_id === s.id && (p.questions || []).includes(q));
    const by = {}; pages.forEach((p) => { (by[p.user_id] = by[p.user_id] || []).push(p); });
    const rows = Object.keys(by).map((u) => ({ u, pages: by[u], votes: spVotes.filter((v) => v.sprint_id === s.id && v.q === q && v.author === u) })).sort((a, b) => b.votes.length - a.votes.length);
    const chips = '<div class="hf-qchips">' + Array.from({ length: s.questions }, (_, i) => '<button type="button" class="chip' + (i + 1 === q ? " on" : "") + '" data-sp-q="' + (i + 1) + '" aria-pressed="' + (i + 1 === q) + '">Q' + (i + 1) + "</button>").join("") + "</div>";
    const html = rows.map((r) => { const mineV = r.votes.some((v) => v.voter === me());
      return '<div class="card stack hf-cmp"><div class="hf-row">' + ava(r.u) + '<b class="grow">' + esc(nameOf(r.u)) + '</b><span class="hint">page ' + r.pages.map((p) => p.page_no).join(", ") + "</span></div>" +
        r.pages.map((p) => '<img data-sp-img="' + esc(p.path) + '" alt="' + esc(nameOf(r.u)) + "'s answer, page " + p.page_no + '" loading="lazy">').join("") +
        '<button type="button" class="hf-vote' + (mineV ? " on" : "") + '" data-sp-vote="' + esc(r.u) + '" aria-pressed="' + mineV + '">✓ I think this is right' + (r.votes.length ? " · " + r.votes.length : "") + "</button></div>"; }).join("");
    setTimeout(fillImgs, 0);
    return ["⚔️ Compare Q" + q, '<button type="button" class="link-btn" data-sp-back>← ' + esc(s.title) + "</button>" + chips + (html || '<div class="empty"><b>Nobody tagged Q' + q + ' yet</b><span>When you scan a page, tap which questions are on it.</span></div>') + '<p class="hint">Tap “I think this is right” on the answer you trust. The one with the most ticks shows first.</p>'];
  }
  const signedCache = {};
  async function fillImgs() {
    for (const img of document.querySelectorAll("img[data-sp-img]:not([src])")) {
      const p = img.dataset.spImg;
      if (!signedCache[p]) { const { data } = await F.sb.storage.from(BUCKET).createSignedUrl(p, 3600); signedCache[p] = data ? data.signedUrl : ""; }
      if (signedCache[p]) { img.src = signedCache[p]; img.addEventListener("click", () => { $("imgFull").src = img.src; $("imgSheet").showModal(); }); }
    }
  }

  /* ----- the scanner: straighten the page and make it clear black and white, all on the phone ----- */
  let scan = null; // { sprint, pages: [{blob, qs, url}], img, corners, step }
  function openScanner(s) {
    scan = { sprint: s, pages: [], step: "pick", corners: null, img: null, qs: [] };
    renderScan(); $("scanSheet").showModal();
  }
  function renderScan() {
    const s = scan; if (!s) return;
    const n = s.pages.length + 1;
    let html = "";
    if (s.step === "pick") html = '<div class="sc-pick"><p>Page ' + n + ': put it on a table in good light, then take the photo from straight above.</p><label class="btn primary block hf-file">📷 Take a photo of page ' + n + '<input type="file" id="scInput" accept="image/*" capture="environment" hidden></label>' +
      (s.pages.length ? '<button type="button" class="btn ghost block" data-sc-done>Done: send ' + s.pages.length + " page" + (s.pages.length === 1 ? "" : "s") + "</button>" : "") + "</div>";
    else if (s.step === "adjust") html = '<p class="hint">Drag the 4 dots to the corners of your page.</p><div class="sc-stage"><canvas id="scCanvas"></canvas></div><div class="two"><button type="button" class="btn ghost" data-sc-retake>Retake</button><button type="button" class="btn primary" data-sc-clean>Looks good</button></div>';
    else if (s.step === "tag") html = '<div class="sc-preview"><img id="scClean" alt="Your cleaned page"></div><b>Which questions are on this page?</b><div class="hf-qchips">' + Array.from({ length: s.sprint.questions }, (_, i) => '<button type="button" class="chip' + (s.qs.includes(i + 1) ? " on" : "") + '" data-sc-q="' + (i + 1) + '" aria-pressed="' + s.qs.includes(i + 1) + '">Q' + (i + 1) + "</button>").join("") + "</div>" +
      '<div class="two"><button type="button" class="btn ghost" data-sc-next>+ Next page</button><button type="button" class="btn primary" data-sc-finish>Done, send</button></div>';
    else html = '<p class="status-line" id="scProg">Sending…</p>';
    $("scBody").innerHTML = html;
    if (s.step === "adjust") drawAdjust();
    if (s.step === "tag" && s.cleanUrl) $("scClean").src = s.cleanUrl;
  }
  async function scanLoad(file) {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      // keep it light: at most 1600 px on the long side
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      scan.src = c; const W = c.width, Hh = c.height, m = 0.06;
      scan.corners = guessCorners(c) || [[W * m, Hh * m], [W * (1 - m), Hh * m], [W * (1 - m), Hh * (1 - m)], [W * m, Hh * (1 - m)]];
      scan.step = "adjust"; renderScan();
    };
    img.onerror = () => F.toast("Couldn't open that photo.");
    img.src = url;
  }
  // a simple guess at where the paper is: the bright area against a darker table
  function guessCorners(c) {
    try {
      const w = 80, h = Math.round(80 * c.height / c.width), t = document.createElement("canvas"); t.width = w; t.height = h;
      const x = t.getContext("2d"); x.drawImage(c, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data;
      const lum = (i, j) => { const k = (j * w + i) * 4; return d[k] * 0.3 + d[k + 1] * 0.59 + d[k + 2] * 0.11; };
      let sum = 0; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) sum += lum(i, j); const avg = sum / (w * h);
      const pts = []; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (lum(i, j) > avg + 18) pts.push([i, j]);
      if (pts.length < w * h * 0.15 || pts.length > w * h * 0.97) return null;
      const best = (f) => pts.reduce((a, p) => (f(p) > f(a) ? p : a), pts[0]);
      const tl = best((p) => -p[0] - p[1]), tr = best((p) => p[0] - p[1]), br = best((p) => p[0] + p[1]), bl = best((p) => -p[0] + p[1]);
      const k = c.width / w; return [tl, tr, br, bl].map((p) => [p[0] * k, p[1] * k]);
    } catch (e) { return null; }
  }
  function drawAdjust() {
    const cv = $("scCanvas"), src = scan.src, box = cv.parentElement;
    const maxW = Math.min(box.clientWidth || 340, 900), k = Math.min(maxW / src.width, (window.innerHeight * 0.55) / src.height);
    cv.width = Math.round(src.width * k); cv.height = Math.round(src.height * k); scan.k = k;
    const x = cv.getContext("2d"); x.drawImage(src, 0, 0, cv.width, cv.height);
    const P = scan.corners.map((p) => [p[0] * k, p[1] * k]);
    x.fillStyle = "rgba(117,86,220,0.15)"; x.strokeStyle = "#8F78F0"; x.lineWidth = 3;
    x.beginPath(); P.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); x.fill(); x.stroke();
    P.forEach((p) => { x.beginPath(); x.arc(p[0], p[1], 13, 0, 7); x.fillStyle = "#7556DC"; x.fill(); x.lineWidth = 3; x.strokeStyle = "#FFFFFF"; x.stroke(); });
  }
  let drag = -1;
  document.addEventListener("pointerdown", (e) => {
    if (!scan || scan.step !== "adjust" || e.target.id !== "scCanvas") return;
    const r = e.target.getBoundingClientRect(), px = (e.clientX - r.left) * (e.target.width / r.width) / scan.k, py = (e.clientY - r.top) * (e.target.height / r.height) / scan.k;
    let bi = -1, bd = 1e9; scan.corners.forEach((p, i) => { const dd = Math.hypot(p[0] - px, p[1] - py); if (dd < bd) { bd = dd; bi = i; } });
    if (bd * scan.k < 60) { drag = bi; e.target.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  document.addEventListener("pointermove", (e) => {
    if (drag < 0 || !scan || e.target.id !== "scCanvas") return;
    const r = e.target.getBoundingClientRect();
    scan.corners[drag] = [Math.max(0, Math.min(scan.src.width, (e.clientX - r.left) * (e.target.width / r.width) / scan.k)), Math.max(0, Math.min(scan.src.height, (e.clientY - r.top) * (e.target.height / r.height) / scan.k))];
    drawAdjust();
  });
  document.addEventListener("pointerup", () => { drag = -1; });
  // straighten (perspective) and clean (black ink on white)
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = dst[i], [u, v] = src[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    for (let c = 0; c < 8; c++) { let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = 0; r < 8; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; } }
    return b.map((v, i) => v / A[i][i]);
  }
  function cleanPage() {
    const W = 1000, Hh = 1414, src = scan.src, sx = src.getContext("2d").getImageData(0, 0, src.width, src.height), sd = sx.data, sw = src.width, sh = src.height;
    const h = homography(scan.corners, [[0, 0], [W, 0], [W, Hh], [0, Hh]]);
    const out = document.createElement("canvas"); out.width = W; out.height = Hh;
    const ox = out.getContext("2d"), od = ox.createImageData(W, Hh), g = new Float32Array(W * Hh);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const z = h[6] * x + h[7] * y + 1, u = Math.round((h[0] * x + h[1] * y + h[2]) / z), v = Math.round((h[3] * x + h[4] * y + h[5]) / z);
      const i = (Math.min(sh - 1, Math.max(0, v)) * sw + Math.min(sw - 1, Math.max(0, u))) * 4;
      g[y * W + x] = sd[i] * 0.3 + sd[i + 1] * 0.59 + sd[i + 2] * 0.11;
    }
    // even out shadows: compare each pixel to the local brightness of the paper around it
    const bs = 40, gw = Math.ceil(W / bs), gh = Math.ceil(Hh / bs), bg = new Float32Array(gw * gh);
    for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
      const vals = []; for (let y = by * bs; y < Math.min(Hh, by * bs + bs); y += 4) for (let x = bx * bs; x < Math.min(W, bx * bs + bs); x += 4) vals.push(g[y * W + x]);
      vals.sort((a, c) => a - c); bg[by * gw + bx] = vals[Math.floor(vals.length * 0.9)] || 255;
    }
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const fx = Math.min(gw - 1.001, Math.max(0, x / bs - 0.5)), fy = Math.min(gh - 1.001, Math.max(0, y / bs - 0.5)), x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      const b0 = bg[y0 * gw + x0] * (1 - ax) + bg[y0 * gw + Math.min(gw - 1, x0 + 1)] * ax, b1 = bg[Math.min(gh - 1, y0 + 1) * gw + x0] * (1 - ax) + bg[Math.min(gh - 1, y0 + 1) * gw + Math.min(gw - 1, x0 + 1)] * ax;
      const back = Math.max(60, b0 * (1 - ay) + b1 * ay), r = g[y * W + x] / back;
      const val = r > 0.9 ? 255 : r < 0.55 ? 0 : Math.round((r - 0.55) / 0.35 * 255);
      const k = (y * W + x) * 4; od.data[k] = od.data[k + 1] = od.data[k + 2] = val; od.data[k + 3] = 255;
    }
    ox.putImageData(od, 0, 0);
    return new Promise((res) => out.toBlob((b) => res(b), "image/jpeg", 0.6));
  }
  async function uploadScan() {
    const s = scan, sp = s.sprint; s.step = "send"; renderScan();
    const already = spPages.filter((p) => p.sprint_id === sp.id && p.user_id === me()).length;
    for (let i = 0; i < s.pages.length; i++) {
      if ($("scProg")) $("scProg").textContent = "Sending page " + (i + 1) + " of " + s.pages.length + "…";
      const pg = s.pages[i], no = already + i + 1, path = H.id + "/sprints/" + sp.id + "/" + me() + "/" + no + "-" + Date.now() + ".jpg";
      const up = await F.sb.storage.from(BUCKET).upload(path, pg.blob, { contentType: "image/jpeg", upsert: false });
      if (up.error) { F.toast("Couldn't send page " + (i + 1) + ": " + up.error.message, { long: true }); s.step = "pick"; renderScan(); return; }
      const { error } = await F.sb.from("house_sprint_pages").insert({ sprint_id: sp.id, house_id: H.id, user_id: me(), page_no: no, path, questions: pg.qs, size: pg.blob.size });
      if (error) { F.toast("Couldn't save page " + (i + 1) + ": " + error.message, { long: true }); s.step = "pick"; renderScan(); return; }
    }
    await F.sb.from("house_sprint_people").upsert({ sprint_id: sp.id, house_id: H.id, user_id: me(), status: "in", submitted_at: new Date().toISOString() });
    const kb = Math.round(s.pages.reduce((a, p) => a + p.blob.size, 0) / 1024);
    s.pages.forEach((p) => URL.revokeObjectURL(p.url));
    scan = null; $("scanSheet").close();
    F.toast("✅ Sent " + (no(kb)) + " to the house");
    function no(k) { return k + " KB"; }
    if (ctx().logActivity) ctx().logActivity("sent their answers for " + sp.title);
    load();
  }
  $("scanSheet").addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-sc-close]")) { if (scan && scan.pages.length && !(await F.confirm("Stop scanning?", "The pages you scanned won't be sent.", "Stop"))) return; scan = null; $("scanSheet").close(); return; }
    if (!scan) return;
    if (t.closest("[data-sc-retake]")) { scan.step = "pick"; renderScan(); return; }
    if (t.closest("[data-sc-clean]")) {
      t.closest("button").disabled = true; t.closest("button").textContent = "Cleaning…";
      await new Promise((r) => setTimeout(r, 30));
      const blob = await cleanPage(); scan.cleanBlob = blob; scan.cleanUrl = URL.createObjectURL(blob); scan.qs = scan.qs.length ? scan.qs : [];
      scan.step = "tag"; renderScan(); return;
    }
    const qb = t.closest("[data-sc-q]"); if (qb) { const n = +qb.dataset.scQ, i = scan.qs.indexOf(n); if (i >= 0) scan.qs.splice(i, 1); else scan.qs.push(n); scan.qs.sort((a, b) => a - b); renderScan(); return; }
    const keepPage = () => { scan.pages.push({ blob: scan.cleanBlob, url: scan.cleanUrl, qs: scan.qs.slice() }); scan.cleanBlob = null; scan.cleanUrl = null; scan.qs = []; };
    if (t.closest("[data-sc-next]")) { keepPage(); scan.step = "pick"; renderScan(); return; }
    if (t.closest("[data-sc-finish]")) { keepPage(); uploadScan(); return; }
    if (t.closest("[data-sc-done]")) { uploadScan(); }
  });
  $("scanSheet").addEventListener("change", (e) => { if (e.target.id === "scInput" && e.target.files[0]) scanLoad(e.target.files[0]); });
  $("scanSheet").addEventListener("cancel", (e) => { if (scan && scan.pages.length) { e.preventDefault(); } });

  /* ===== Explain it back ===== */
  function renderExplain() {
    sheet.noRerender = !!sheet.asking;
    const ask = sheet.asking ? '<form class="card stack" id="exForm" novalidate><label for="exMod">Module (optional)</label><input id="exMod" maxlength="30" placeholder="e.g. COMS2015A"><label for="exText">What should someone explain?</label><textarea id="exText" rows="3" maxlength="300" placeholder="e.g. Explain the Master Theorem like I\'m in first year"></textarea><div class="two"><button type="button" class="btn ghost small" data-ex-cancel>Cancel</button><button type="submit" class="btn primary small">Ask the house</button></div></form>'
      : '<button type="button" class="btn primary block" data-ex-ask>+ Ask the house to explain something</button>';
    const list = exQ.map((q) => {
      const as = exA.filter((a) => a.q_id === q.id), answering = rec && rec.prefix === "ex-" + q.id || sheet.answer === q.id;
      return '<div class="card stack hf-ex"><span class="hf-by">' + ava(q.author, "xs") + esc(nameOf(q.author)) + " asks" + (q.module ? " · " + esc(q.module) : "") + " · " + esc(F.timeAgo(q.created_at)) + '</span><b class="hf-qtext">“' + esc(q.body) + "”</b>" +
        as.map((a) => { const rs = exRate.filter((r) => r.a_id === a.id), mine = rs.find((r) => r.user_id === me()), avg = rs.length ? (rs.reduce((s, r) => s + r.stars, 0) / rs.length).toFixed(1) : "";
          return '<div class="hf-ans-box"><span class="hf-by">' + ava(a.author, "xs") + esc(nameOf(a.author)) + " explained · " + left(a.secs * 1000) + (avg ? " · ★ " + avg : "") + (a.keep ? " · ⭐ kept" : "") + '</span><audio controls preload="none" data-ex-audio="' + esc(a.path) + '"></audio>' +
            (a.author !== me() ? '<div class="hf-stars" role="group" aria-label="How clear was it?">' + [1, 2, 3, 4, 5].map((n) => '<button type="button" class="hf-star' + (mine && n <= mine.stars ? " on" : "") + '" data-ex-rate="' + esc(a.id) + '" data-stars="' + n + '" aria-label="' + n + ' stars">★</button>').join("") + "</div>" : "") +
            (a.keep ? "" : '<button type="button" class="link-btn" data-ex-keep="' + esc(a.id) + '">⭐ Keep (otherwise it clears after 7 days)</button>') + "</div>"; }).join("") +
        (q.author === me() ? "" : answering ? '<div class="hf-rec">' + recUi("ex-" + q.id, 180) + "</div>" : '<button type="button" class="btn ghost small" data-ex-answer="' + esc(q.id) + '">🎙️ Explain it (up to 3 minutes)</button>') +
        (q.author === me() ? '<button type="button" class="link-btn danger" data-ex-del="' + esc(q.id) + '">Remove my question</button>' : "") + "</div>";
    }).join("");
    setTimeout(fillAudio, 0);
    return ["🎙️ Explain it back", ask + (list || '<div class="empty"><b>No questions yet</b><span>Ask the house to explain something you\'re stuck on. They answer with a voice note.</span></div>') + '<p class="hint">Voice answers are small (3 minutes is about 0.5 MB) and clear themselves after 7 days unless someone taps ⭐ Keep.</p>'];
  }
  async function fillAudio() {
    for (const au of document.querySelectorAll("audio[data-ex-audio]:not([src])")) {
      const p = au.dataset.exAudio;
      if (!signedCache[p]) { const { data } = await F.sb.storage.from(BUCKET).createSignedUrl(p, 3600); signedCache[p] = data ? data.signedUrl : ""; }
      if (signedCache[p]) au.src = signedCache[p];
    }
  }
  async function sendExplain(qId) {
    if (!rec || !rec.blob) return;
    const blob = rec.blob, secs = rec.secs, type = blob.type || "audio/webm", ext = /mp4/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : "webm";
    const path = H.id + "/explain/" + qId + "/" + me() + "-" + Date.now() + "." + ext;
    F.toast("Sending your explanation…");
    const up = await F.sb.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false });
    if (up.error) return F.toast("Couldn't send: " + up.error.message, { long: true });
    const { error } = await F.sb.from("house_explain_a").insert({ q_id: qId, house_id: H.id, author: me(), path, mime: type, secs: Math.min(185, secs) });
    if (error) { F.sb.storage.from(BUCKET).remove([path]); return F.toast("Couldn't send: " + error.message, { long: true }); }
    stopRec(); sheet.answer = null; F.toast("✅ Sent to the house"); load();
  }

  /* ===== Mistake bank ===== */
  function renderMistakes() {
    sheet.noRerender = !!sheet.adding;
    const mods = [...new Set(mistakes.map((m) => m.module).filter(Boolean))], f = sheet.mod || "All";
    const add = sheet.adding ? '<form class="card stack" id="miForm" novalidate><label for="miMod">Module</label><input id="miMod" maxlength="30" placeholder="e.g. APPM2023A"><label for="miSrc">Where (optional)</label><input id="miSrc" maxlength="60" placeholder="e.g. Test 2, Tut 5"><label for="miBad">❌ The mistake</label><textarea id="miBad" rows="2" maxlength="300" placeholder="e.g. Used ½ m L² for a rod about its end"></textarea><label for="miFix">✅ How to get it right</label><textarea id="miFix" rows="2" maxlength="300" placeholder="e.g. Rod about its end is ⅓ m L². ½ m r² is a disc"></textarea><p class="form-error" id="miErr" hidden></p><div class="two"><button type="button" class="btn ghost small" data-mi-cancel>Cancel</button><button type="submit" class="btn primary small">Save to the bank</button></div></form>'
      : '<button type="button" class="btn primary block" data-mi-add>+ Add a mistake I made</button>';
    const chips = mods.length ? '<div class="hf-chips">' + ["All"].concat(mods).map((m) => '<button type="button" class="chip' + (m === f ? " on" : "") + '" data-mi-mod="' + esc(m) + '" aria-pressed="' + (m === f) + '">' + esc(m) + "</button>").join("") + "</div>" : "";
    const list = mistakes.filter((m) => f === "All" || m.module === f).map((m) => { const saves = mSaves.filter((s) => s.m_id === m.id), mine = saves.some((s) => s.user_id === me());
      return '<div class="card stack hf-mi"><span class="hf-by">' + ava(m.author, "xs") + esc(nameOf(m.author)) + (m.module ? " · " + esc(m.module) : "") + (m.source ? " · " + esc(m.source) : "") + '</span><span class="hf-bad">❌ ' + esc(m.mistake) + '</span><span class="hf-fix">✅ ' + esc(m.fix) + "</span>" +
        '<div class="hf-row"><button type="button" class="hf-vote' + (mine ? " on" : "") + '" data-mi-save="' + esc(m.id) + '" aria-pressed="' + mine + '">' + (mine ? "✓ Saved to my revision" : "🙋 I make this mistake too") + (saves.length ? " · " + saves.length : "") + "</button>" + (m.author === me() ? '<button type="button" class="link-btn danger" data-mi-del="' + esc(m.id) + '">Remove</button>' : "") + "</div></div>"; }).join("");
    return ["❌ Mistake bank", add + chips + (list || '<div class="empty"><b>No mistakes saved yet</b><span>Share a mistake you made in a tut or test and how to avoid it, so nobody in the house makes it again.</span></div>')];
  }

  /* ---------- clicks ---------- */
  $("hsToday").addEventListener("click", async (e) => {
    const t = e.target;
    const tick = t.closest("[data-hf-tick]");
    if (tick) { const g = myGoals(); if (!g) return; const i = +tick.dataset.hfTick, done = g.done.slice(); done[i] = !done[i]; g.done = done; render();
      const { error } = await F.sb.from("member_goals").update({ done, updated_at: new Date().toISOString() }).eq("user_id", me()).eq("day", g.day);
      if (error) F.toast("Couldn't save: " + error.message); return; }
    const b = t.closest("[data-hf]"); if (!b) return;
    const k = b.dataset.hf;
    if (k === "goals-edit") { goalEdit = true; render(); return; }
    if (k === "quiz") return openSheet("quiz");
    if (k === "rules") return openSheet("rules");
    if (k === "dare") return openSheet("dare", { id: (dareNow() || {}).id });
    if (k === "war") return openSheet("war");
    if (k === "sprint") return openSheet("sprint", b.dataset.sprint ? { id: b.dataset.sprint } : { view: "list" });
    if (k === "explain") return openSheet("explain");
    if (k === "mistakes") return openSheet("mistakes");
  });
  $("hsToday").addEventListener("submit", (e) => {
    if (!e.target.matches("[data-hf-goals]")) return; e.preventDefault();
    const items = [0, 1, 2].map((i) => $("hfGoal" + i).value.trim()).filter(Boolean);
    if (!items.length) return F.toast("Write at least one goal.");
    saveGoals(items);
  });
  $("hfSheet").addEventListener("submit", (e) => {
    e.preventDefault();
    if (e.target.id === "hqForm") return addQuestion();
    if (e.target.id === "spForm") return createSprint();
    if (e.target.id === "exForm") return askExplain();
    if (e.target.id === "miForm") return addMistake();
  });
  $("hfSheet").addEventListener("input", (e) => { if (!sheet) return; if (e.target.id === "hdText" || e.target.id === "hwText") sheet.text = e.target.value; if (e.target.closest("#hqForm")) readDraft(); });
  $("hfSheet").addEventListener("change", (e) => { if (e.target.closest && e.target.closest("#hqForm")) readDraft(); });
  $("hfSheet").addEventListener("change", async (e) => {
    if (e.target.id === "hqTime") { const v = e.target.value; const { error } = await F.sb.from("houses").update({ quiz_time: v }).eq("id", H.id); if (error) return F.toast(error.message); F.toast("The quiz is now at " + v + " for everyone."); load(); }
    if (e.target.id === "hdFile" && e.target.files[0]) postProof(e.target.files[0], e.target.files[0].type);
  });
  $("hfSheet").addEventListener("click", async (e) => {
    const t = e.target, at = (sel) => t.closest(sel);
    if (at("[data-hf-close]")) return closeSheet();
    if (!sheet) return;
    let b;
    // rules
    if (at("[data-hr-dares]")) { sheet.rules.text = $("hrText").value; sheet.rules.time = $("hrTime").value; sheet.rules.on = !sheet.rules.on; sheet.noRerender = false; renderSheet(); return; }
    if ((b = at("[data-hr-miss]"))) { sheet.rules.text = $("hrText").value; sheet.rules.time = $("hrTime").value; sheet.rules.miss = b.dataset.hrMiss; sheet.noRerender = false; renderSheet(); return; }
    if (at("[data-hr-save]")) return saveRules();
    // quiz
    if ((b = at("[data-hq-tab]"))) { readDraft(); sheet.tab = b.dataset.hqTab; sheet.result = null; sheet.noRerender = false; renderSheet(); return; }
    if ((b = at("[data-hq-edit]"))) { const x = myQs.find((y) => y.id === b.dataset.hqEdit); if (!x) return;
      editQ = x; qDraft = { mod: x.module || "", q: x.question, opts: [0, 1, 2, 3].map((i) => x.options[i] || ""), c: x.correct, tip: x.tip || "" };
      sheet.noRerender = false; renderSheet(); $("hfBody").scrollIntoView({ block: "start" }); const f = $("hqQ"); if (f) f.focus(); return; }
    if (at("[data-hq-cancel]")) { editQ = null; qDraft = null; sheet.noRerender = false; renderSheet(); return; }
    if ((b = at("[data-hq-del]"))) { const x = myQs.find((y) => y.id === b.dataset.hqDel); if (!x) return;
      if (!(await F.confirm("Delete this question?", "“" + x.question.slice(0, 80) + "”", "Delete"))) return;
      readDraft();
      const { error } = await F.sb.from("house_quiz_q").delete().eq("id", x.id);
      if (error) return F.toast(error.message, { long: true });
      if (editQ && editQ.id === x.id) { editQ = null; qDraft = null; }
      await refreshQuiz(); F.toast("Question deleted"); sheet.noRerender = false; renderSheet(); render(); return; }
    if ((b = at("[data-hq-pick]"))) return quizPick(+b.dataset.hqPick);
    if (at("[data-hq-next]")) { const todo = (quiz.questions || []).filter((x) => !x.mine && !x.answered); sheet.result = null; if (!todo.length) { sheet.tab = "tonight"; const { data } = await F.sb.rpc("funi_quiz_state", { h: H.id }); if (data) quiz = data; } renderSheet(); return; }
    // dare
    if ((b = at("[data-hd-sug]"))) { const x = DARES[+b.dataset.hdSug]; sheet.text = x[1]; sheet.proof = x[0]; sheet.noRerender = false; renderSheet(); return; }
    if ((b = at("[data-hd-proof]"))) { sheet.proof = b.dataset.hdProof; sheet.text = $("hdText") ? $("hdText").value : sheet.text; sheet.noRerender = false; renderSheet(); return; }
    if (at("[data-hd-set]")) { const txt = ($("hdText").value || "").trim(); if (txt.length < 3) return F.toast("Write the dare first.");
      const { error } = await F.sb.rpc("funi_dare_set", { d: sheet.id, txt, kind: sheet.proof || "photo" }); if (error) return F.toast(error.message, { long: true });
      F.toast("Dare sent! They have 1 day."); sheet.text = null; load(); return; }
    if ((b = at("[data-hd-react]"))) { const d = sheet.id, em = b.dataset.hdReact, mine = reacts.find((r) => r.dare_id === d && r.emoji === em && r.user_id === me());
      if (mine) { reacts = reacts.filter((r) => r !== mine); await F.sb.from("house_dare_reacts").delete().eq("dare_id", d).eq("user_id", me()).eq("emoji", em); }
      else { reacts.push({ dare_id: d, user_id: me(), emoji: em }); await F.sb.from("house_dare_reacts").insert({ dare_id: d, house_id: H.id, user_id: me(), emoji: em }); }
      renderSheet(); return; }
    // recording
    if ((b = at("[data-rec]"))) { if (rec && rec.prefix === b.dataset.rec && rec.on) { stopRec(true); } else startRec(b.dataset.rec, +b.dataset.max); return; }
    if ((b = at("[data-rec-redo]"))) { const p = b.dataset.recRedo, mx = p === "hd" ? 60 : 180; stopRec(); startRec(p, mx); return; }
    if ((b = at("[data-rec-send]"))) { const p = b.dataset.recSend; if (p === "hd") { if (rec && rec.blob) { const bl = rec.blob; stopRec(); postProof(bl, bl.type); } } else sendExplain(p.slice(3)); return; }
    // war room
    if ((b = at("[data-hw-to]"))) { const [user, module, date] = b.dataset.hwTo.split("|"); sheet.to = { user, module, date, row: upcomingExams().find((x) => x.user_id === user && x.module === module && x.due_date === date) }; sheet.text = ""; renderSheet(); setTimeout(() => $("hwText") && $("hwText").focus(), 50); return; }
    if (at("[data-hw-back]")) { sheet.to = null; sheet.noRerender = false; renderSheet(); return; }
    if ((b = at("[data-hw-idea]"))) { sheet.text = IDEAS[+b.dataset.hwIdea][1]; $("hwText").value = sheet.text; $("hwText").focus(); return; }
    if (at("[data-hw-send]")) { const body = ($("hwText").value || "").trim(); if (!body) return F.toast("Write your message first.");
      const to = sheet.to; const { error } = await F.sb.from("house_wishes").insert({ house_id: H.id, from_user: me(), to_user: to.user, module: to.module, exam_date: to.date, body: body.slice(0, 280) });
      if (error) return F.toast("Couldn't send: " + error.message, { long: true });
      F.toast("💜 Sent to " + nameOf(to.user)); sheet.to = null; sheet.text = null; sheet.noRerender = false; load(); return; }
    if ((b = at("[data-hw-mood]"))) { const [module, date] = b.dataset.hwMood.split("|"), mood = +b.dataset.mood;
      const { error } = await F.sb.from("house_moods").upsert({ house_id: H.id, user_id: me(), module, exam_date: date, mood }); if (error) return F.toast(error.message);
      moods = moods.filter((m) => !(m.user_id === me() && m.module === module && m.exam_date === date)).concat([{ house_id: H.id, user_id: me(), module, exam_date: date, mood }]); renderSheet(); return; }
    // sprints
    if (at("[data-sp-new]")) { sheet.view = "new"; renderSheet(); return; }
    if (at("[data-sp-list]")) { sheet.view = "list"; sheet.id = null; sheet.q = null; renderSheet(); return; }
    if ((b = at("[data-sp-open]"))) { sheet.view = null; sheet.id = b.dataset.spOpen; renderSheet(); return; }
    if ((b = at("[data-sp-join]"))) { const { error } = await F.sb.from("house_sprint_people").upsert({ sprint_id: sheet.id, house_id: H.id, user_id: me(), status: b.dataset.spJoin }); if (error) return F.toast(error.message); load(); return; }
    if ((b = at("[data-sp-paper]"))) { const f = (F.houseFiles ? F.houseFiles() : []).find((x) => x.id === b.dataset.spPaper); if (f) F.openFile(Object.assign({ bucket: BUCKET }, f)); return; }
    if (at("[data-sp-scan]")) { const s = sprints.find((x) => x.id === sheet.id); if (s) openScanner(s); return; }
    if ((b = at("[data-sp-q]"))) { sheet.q = +b.dataset.spQ; renderSheet(); return; }
    if (at("[data-sp-back]")) { sheet.q = null; renderSheet(); return; }
    if ((b = at("[data-sp-vote]"))) { const author = b.dataset.spVote, q = sheet.q, s = sheet.id, mine = spVotes.find((v) => v.sprint_id === s && v.q === q && v.author === author && v.voter === me());
      if (mine) { spVotes = spVotes.filter((v) => v !== mine); await F.sb.from("house_sprint_votes").delete().eq("sprint_id", s).eq("q", q).eq("author", author).eq("voter", me()); }
      else { spVotes.push({ sprint_id: s, q, author, voter: me() }); await F.sb.from("house_sprint_votes").insert({ sprint_id: s, house_id: H.id, q, author, voter: me() }); }
      renderSheet(); return; }
    if (at("[data-sp-del]")) { if (!(await F.confirm("Delete this sprint?", "Everyone's scanned answers for it are removed too.", "Delete"))) return;
      const paths = spPages.filter((p) => p.sprint_id === sheet.id).map((p) => p.path);
      const { error } = await F.sb.from("house_sprints").delete().eq("id", sheet.id); if (error) return F.toast(error.message);
      if (paths.length) F.sb.storage.from(BUCKET).remove(paths).then(() => {}, () => {});
      sheet.view = "list"; sheet.id = null; load(); return; }
    // explain
    if (at("[data-ex-ask]")) { sheet.asking = true; renderSheet(); setTimeout(() => $("exText") && $("exText").focus(), 50); return; }
    if (at("[data-ex-cancel]")) { sheet.asking = false; sheet.noRerender = false; renderSheet(); return; }
    if ((b = at("[data-ex-answer]"))) { sheet.answer = b.dataset.exAnswer; renderSheet(); return; }
    if ((b = at("[data-ex-rate]"))) { const a = b.dataset.exRate, stars = +b.dataset.stars;
      const { error } = await F.sb.from("house_explain_rate").upsert({ a_id: a, house_id: H.id, user_id: me(), stars }); if (error) return F.toast(error.message);
      exRate = exRate.filter((r) => !(r.a_id === a && r.user_id === me())).concat([{ a_id: a, user_id: me(), stars }]); renderSheet(); return; }
    if ((b = at("[data-ex-keep]"))) { const { error } = await F.sb.rpc("funi_explain_keep", { a: b.dataset.exKeep, k: true }); if (error) return F.toast(error.message); const a = exA.find((x) => x.id === b.dataset.exKeep); if (a) a.keep = true; renderSheet(); return; }
    if ((b = at("[data-ex-del]"))) { if (!(await F.confirm("Remove your question?", "The voice answers to it are removed too.", "Remove"))) return;
      const paths = exA.filter((a) => a.q_id === b.dataset.exDel).map((a) => a.path);
      const { error } = await F.sb.from("house_explain_q").delete().eq("id", b.dataset.exDel); if (error) return F.toast(error.message);
      if (paths.length) F.sb.storage.from(BUCKET).remove(paths).then(() => {}, () => {}); load(); return; }
    // mistakes
    if (at("[data-mi-add]")) { sheet.adding = true; renderSheet(); setTimeout(() => $("miMod") && $("miMod").focus(), 50); return; }
    if (at("[data-mi-cancel]")) { sheet.adding = false; sheet.noRerender = false; renderSheet(); return; }
    if ((b = at("[data-mi-mod]"))) { sheet.mod = b.dataset.miMod; renderSheet(); return; }
    if ((b = at("[data-mi-save]"))) { const m = b.dataset.miSave, mine = mSaves.find((s) => s.m_id === m && s.user_id === me());
      if (mine) { mSaves = mSaves.filter((s) => s !== mine); await F.sb.from("house_mistake_saves").delete().eq("m_id", m).eq("user_id", me()); }
      else { mSaves.push({ m_id: m, user_id: me() }); await F.sb.from("house_mistake_saves").insert({ m_id: m, house_id: H.id, user_id: me() }); }
      renderSheet(); return; }
    if ((b = at("[data-mi-del]"))) { const { error } = await F.sb.from("house_mistakes").delete().eq("id", b.dataset.miDel); if (error) return F.toast(error.message); mistakes = mistakes.filter((m) => m.id !== b.dataset.miDel); renderSheet(); render(); }
  });

  async function createSprint() {
    const err = (t) => { $("spErr").textContent = t; $("spErr").hidden = false; };
    const title = $("spTitle").value.trim(), start = $("spStart").value, minutes = +$("spMin").value, questions = +$("spQs").value;
    if (!title) return err("Give the sprint a name, like the paper's name.");
    if (!start) return err("Pick when it starts.");
    if (!(minutes >= 10 && minutes <= 300)) return err("Minutes must be between 10 and 300.");
    if (!(questions >= 1 && questions <= 30)) return err("Questions must be between 1 and 30.");
    const startsAt = new Date(start);
    if (isNaN(startsAt)) return err("That start time doesn't look right.");
    const { data, error } = await F.sb.from("house_sprints").insert({ house_id: H.id, created_by: me(), title, file_id: $("spFile").value || null, starts_at: startsAt.toISOString(), minutes, questions }).select().single();
    if (error) return err(error.message);
    await F.sb.from("house_sprint_people").upsert({ sprint_id: data.id, house_id: H.id, user_id: me(), status: "in" });
    F.toast("⚔️ Sprint set up. The house got a ping.");
    sheet.view = null; sheet.id = data.id; sheet.noRerender = false; load();
  }
  async function askExplain() {
    const body = $("exText").value.trim(); if (body.length < 3) return F.toast("Write what you'd like explained.");
    const { error } = await F.sb.from("house_explain_q").insert({ house_id: H.id, author: me(), module: $("exMod").value.trim() || null, body });
    if (error) return F.toast(error.message, { long: true });
    F.toast("Asked. The house got a ping."); sheet.asking = false; sheet.noRerender = false; load();
  }
  async function addMistake() {
    const err = (t) => { $("miErr").textContent = t; $("miErr").hidden = false; };
    const mistake = $("miBad").value.trim(), fix = $("miFix").value.trim();
    if (mistake.length < 3) return err("Write the mistake.");
    if (fix.length < 3) return err("Write how to get it right.");
    const { error } = await F.sb.from("house_mistakes").insert({ house_id: H.id, author: me(), module: $("miMod").value.trim().toUpperCase() || null, source: $("miSrc").value.trim() || null, mistake, fix });
    if (error) return err(error.message);
    F.toast("Saved to the mistake bank ✓"); sheet.adding = false; sheet.noRerender = false; load();
  }

  /* ---------- live updates and hooks ---------- */
  function startLive(h) {
    if (chan) { try { F.sb.removeChannel(chan); } catch (e) {} chan = null; }
    const filter = "house_id=eq." + h;
    chan = F.sb.channel("hf-" + h);
    ["house_quiz_a", "house_dares", "house_dare_reacts", "house_wishes", "house_sprint_people", "house_sprint_pages", "house_explain_q", "house_explain_a", "house_mistakes"].forEach((t) => {
      chan.on("postgres_changes", { event: "*", schema: "public", table: t, filter }, () => reload());
    });
    chan.subscribe();
  }
  F.on("house:open", (h) => { if (!h) return; if (!H || H.id !== h.id) startLive(h.id); load(); });
  F.on("house:today", () => { render(); load(); });
  F.on("view", (v) => { if (v !== "house" && $("hfSheet").open) closeSheet(); });
})();
