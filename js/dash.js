/* Funi dashboard: greeting, next exam, progress tiles, study graph, calendar,
 * upcoming reminders, top tasks, exam countdown bars and a cheer card. */
(function () {
  "use strict";
  const F = window.Funi, $ = F.$, esc = F.esc, S = F.s, A = window.FuniArt;
  const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  let calOffset = 0;

  const mondayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const fmtMins = (m) => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? h + "h" + (r ? " " + r + "m" : "") : r + "m"; };

  // minutes of focus per day for this week and last week
  function focusByDay() {
    const thisMon = mondayOf(new Date()), lastMon = new Date(thisMon); lastMon.setDate(lastMon.getDate() - 7);
    const week = [0, 0, 0, 0, 0, 0, 0]; let lastWeek = 0;
    const t = F.timerState && F.timerState();
    S.sessions.forEach((s) => {
      let sec = s.focus_seconds || 0;
      if (t && t.sessionId === s.id) sec = Math.max(sec, t.focusSec || 0);
      const d = new Date(s.started_at);
      if (d >= thisMon) week[(d.getDay() + 6) % 7] += sec / 60;
      else if (d >= lastMon) lastWeek += sec / 60;
    });
    if (t && !t.sessionId) week[(new Date().getDay() + 6) % 7] += (t.focusSec || 0) / 60; // offline session
    return { week, lastWeek, total: week.reduce((a, b) => a + b, 0) };
  }

  function tiles() {
    const today = F.todayISO(), y = new Date(); y.setDate(y.getDate() - 1);
    const yISO = F.isoOf(y), month = today.slice(0, 7);
    const doneOn = (iso) => S.tasks.filter((t) => t.done && t.done_at && F.isoOf(new Date(t.done_at)) === iso).length;
    const doneToday = doneOn(today), diff = doneToday - doneOn(yISO);
    const open = S.tasks.filter((t) => !t.done && t.due_date <= today).length;
    const examsWeek = F.upcoming().filter((x) => F.daysLeft(x.due_date) <= 7).length;
    const doneMonth = S.tasks.filter((t) => t.done && t.done_at && F.isoOf(new Date(t.done_at)).slice(0, 7) === month).length;
    const f = focusByDay(), fd = f.total - f.lastWeek;
    const icon = {
      tasks: '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="3" class="f-w"/><rect x="9" y="2.5" width="6" height="4" rx="1.5" class="f-a"/><path d="M8 11l1.5 1.5L12 10M8 16l1.5 1.5L12 15" class="s-a"/></svg>',
      prog: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="4" class="f-w"/><path d="M3 9.5h18M8 3v4M16 3v4" class="s-a"/></svg>',
      done: '<svg viewBox="0 0 24 24"><path d="M6 3v19" class="s-w"/><path d="M7 4h11l-3 4 3 4H7z" class="f-w"/></svg>',
      focus: '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 16.9 6.3 20l1.2-6.4L2.8 9.2l6.4-.8z" class="f-w"/></svg>'
    };
    const tile = (cls, ic, label, value, sub) => '<div class="stat-tile ' + cls + '"><span class="st-ic">' + ic + '</span><span class="st-txt"><span class="st-l">' + label + '</span><b>' + value + '</b><span class="st-s">' + sub + "</span></span></div>";
    return tile("tl-lav", icon.tasks, "Tasks done", doneToday, diff > 0 ? "+" + diff + " from yesterday" : diff < 0 ? diff + " from yesterday" : "Same as yesterday") +
      tile("tl-pink", icon.prog, "In progress", open, examsWeek ? examsWeek + (examsWeek === 1 ? " exam" : " exams") + " this week" : "No exams this week") +
      tile("tl-mint", icon.done, "Completed", doneMonth, "This month") +
      tile("tl-butter", icon.focus, "Focus time", fmtMins(f.total), (fd >= 0 ? "+" : "−") + fmtMins(Math.abs(fd)) + " from last week");
  }

  function chart() {
    const f = focusByDay(), todayIdx = (new Date().getDay() + 6) % 7;
    const max = Math.max(60, Math.ceil(Math.max(...f.week) / 40) * 40);
    const W = 640, H = 200, L = 46, R = 626, T = 22, B = 160;
    const x = (i) => L + 14 + i * ((R - L - 28) / 6), y = (v) => B - (v / max) * (B - T);
    const pts = f.week.slice(0, todayIdx + 1).map((v, i) => [x(i), y(v), v]);
    let grid = "", labels = "";
    for (let k = 0; k <= 4; k++) {
      const v = (max / 4) * k, yy = y(v);
      grid += '<path d="M' + L + " " + yy + "H" + R + '" class="c-grid"/>';
      labels += '<text x="0" y="' + (yy + 4) + '" class="c-lbl">' + (v === 0 ? "0" : fmtMins(v)) + "</text>";
    }
    let days = "";
    DAY.forEach((d, i) => { days += '<text x="' + x(i) + '" y="' + (B + 24) + '" text-anchor="middle" class="c-lbl' + (i === todayIdx ? " c-today" : "") + '">' + d + "</text>"; });
    let line = "", area = "", dots = "", notes = "";
    if (pts.length) {
      line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
      area = line + "L" + pts[pts.length - 1][0].toFixed(1) + " " + B + "L" + pts[0][0].toFixed(1) + " " + B + "Z";
      const best = f.week.slice(0, todayIdx + 1).reduce((bi, v, i, a) => (v > a[bi] ? i : bi), 0);
      pts.forEach((p, i) => {
        const prev = i ? pts[i - 1][2] : 0;
        const slowed = i > 0 && i < todayIdx && prev >= 30 && p[2] < prev * 0.5;
        dots += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="6" class="' + (slowed ? "c-dot-slow" : "c-dot") + '"/>';
        if (slowed) notes += '<rect x="' + (p[0] - 42) + '" y="' + Math.min(p[1] + 10, B - 20) + '" width="84" height="20" rx="10" class="c-slow-bg"/><text x="' + p[0] + '" y="' + (Math.min(p[1] + 10, B - 20) + 14) + '" text-anchor="middle" class="c-slow">Slowed down</text>';
      });
      if (f.week[best] >= 25) {
        const bx = Math.min(Math.max(pts[best][0], L + 40), R - 40);
        notes += '<rect x="' + (bx - 40) + '" y="' + Math.max(0, pts[best][1] - 30) + '" width="80" height="20" rx="10" class="c-best-bg"/><text x="' + bx + '" y="' + (Math.max(0, pts[best][1] - 30) + 14) + '" text-anchor="middle" class="c-best">Great job!</text>';
      }
    }
    const desc = DAY.map((d, i) => d + " " + Math.round(f.week[i]) + " min").join(", ");
    $("dashChart").innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" class="chart" role="img" aria-label="Minutes studied this week: ' + esc(desc) + '">' +
      grid + labels + '<path d="' + area + '" class="c-area"/><path d="' + line + '" class="c-line"/>' + dots + notes + days + "</svg>";
    // a short, honest summary under the graph
    const slowDay = f.week.findIndex((v, i) => i > 0 && i < todayIdx && f.week[i - 1] >= 30 && v < f.week[i - 1] * 0.5);
    let note;
    if (!f.total) note = "No focus time yet this week. Start a session on the Study tab and your graph fills up.";
    else if (slowDay >= 0 && f.week[todayIdx] >= f.week[slowDay]) note = "You dipped on " + DAY[slowDay] + ", then bounced back. Keep this streak going!";
    else if (slowDay >= 0) note = "You slowed down on " + DAY[slowDay] + ". One 25-minute session today gets you moving again.";
    else if (f.total >= f.lastWeek) note = "You're ahead of last week. Great consistency!";
    else note = fmtMins(f.lastWeek - f.total) + " behind last week. A short session today helps.";
    $("dashChartNote").textContent = note;
    return f;
  }

  function calendar() {
    const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + calOffset);
    const yr = base.getFullYear(), mo = base.getMonth();
    const start = mondayOf(new Date(yr, mo, 1)), today = F.todayISO();
    const exams = new Set(F.upcoming().map((x) => x.due_date));
    const rem = new Set(S.tasks.filter((t) => !t.done).map((t) => t.due_date));
    let cells = DAY.map((d, i) => '<span class="cal-h' + (i >= 5 ? " we" : "") + '">' + d + "</span>").join("");
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      if (i >= 35 && d.getMonth() !== mo) break;
      const iso = F.isoOf(d), cls = ["cal-d"];
      if (d.getMonth() !== mo) cls.push("other");
      if ((d.getDay() + 6) % 7 >= 5) cls.push("we");
      if (iso === today) cls.push("today"); else if (exams.has(iso)) cls.push("exam");
      cells += '<span class="' + cls.join(" ") + '"' + (exams.has(iso) ? ' title="Test or exam"' : "") + "><i>" + d.getDate() + "</i>" + (rem.has(iso) && iso !== today ? '<em class="cal-pip"></em>' : "") + "</span>";
    }
    $("dashCal").innerHTML = '<div class="cal-top"><button type="button" class="cal-nav" data-cal="-1" aria-label="Previous month">‹</button><b>' +
      base.toLocaleDateString("en-ZA", { month: "long", year: "numeric" }) + '</b><button type="button" class="cal-nav" data-cal="1" aria-label="Next month">›</button></div>' +
      '<div class="cal-grid">' + cells + '</div><div class="cal-key"><span><i class="k-today"></i>Today</span><span><i class="k-exam"></i>Test or exam</span><span><i class="k-rem"></i>Reminder</span></div>';
  }
  $("dashCal").addEventListener("click", (e) => { const b = e.target.closest("[data-cal]"); if (!b) return; calOffset += +b.dataset.cal; calendar(); });

  function reminders() {
    const now = new Date(), today = F.todayISO();
    const list = S.tasks.filter((t) => !t.done && (t.due_date > today || (t.due_date === today && (!t.due_time || new Date(today + "T" + String(t.due_time).slice(0, 5)) >= now))))
      .sort((a, b) => (a.due_date + (a.due_time || "99")).localeCompare(b.due_date + (b.due_time || "99"))).slice(0, 3);
    const colors = ["r-pink", "r-sky", "r-butter"];
    $("dashRems").innerHTML = list.length ? list.map((t, i) => {
      const day = t.due_date === today ? "Today" : F.daysLeft(t.due_date) === 1 ? "Tomorrow" : F.niceDate(t.due_date);
      return '<div class="rem-row"><span class="rem-ic ' + colors[i] + '"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg></span><span><b>' + esc(t.title) + "</b><span>" + day + (t.due_time ? ", " + F.niceTime(t.due_time) : "") + (t.remind_offset != null && t.due_time ? " · " + esc(F.offsetLabel(t.remind_offset).toLowerCase()) : "") + "</span></span></div>";
    }).join("") : '<p class="hint">No reminders coming up. Tap + to add one.</p>';
  }
  $("dashAddRem").onclick = () => F.openReminderSheet(F.todayISO());

  function topTasks() {
    const order = { High: 0, Medium: 1, Low: 2 };
    const list = F.tasksOn(F.todayISO()).slice().sort((a, b) => (a.done - b.done) || (order[a.priority || "Medium"] - order[b.priority || "Medium"])).slice(0, 5);
    const pill = { High: "peach", Medium: "butter", Low: "sky" };
    $("dashTasks").innerHTML = list.length ? list.map((t) =>
      '<div class="tt-row' + (t.done ? " done" : "") + '"><button type="button" class="check sm' + (t.done ? " on" : "") + '" data-tick="' + esc(t.id) + '" aria-pressed="' + !!t.done + '" aria-label="' + (t.done ? "Mark not done" : "Mark done") + ": " + esc(t.title) + '"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>' +
      '<span class="grow">' + esc(t.title) + '</span><span class="pill ' + pill[t.priority || "Medium"] + '">' + esc(t.priority || "Medium") + "</span></div>").join("")
      : '<p class="hint">Nothing on today\'s list. Add a reminder to get started.</p>';
  }

  function examBars() {
    const list = F.upcoming().slice(0, 4), bars = ["b-lav", "b-pink", "b-mint", "b-butter"];
    $("dashExams").innerHTML = list.length ? list.map((x, i) => {
      const m = F.s.modules.find((mm) => F.sameCode(mm.code, x.module)), ready = F.readinessOf(m), d = F.daysLeft(x.due_date), need = m ? F.needFor(m, 50) : null;
      return '<div class="ex-row"><span class="ex-sq ' + bars[i] + '"></span><div class="grow"><div class="between"><b>' + esc(x.module) + " · " + esc(x.kind) + '</b><span class="ex-d' + (d <= 7 ? " soon-t" : "") + '">' + (d === 0 ? "Today" : d + (d === 1 ? " day" : " days")) + "</span></div>" +
        '<div class="bar"><i class="' + bars[i] + '" style="width:' + ready + '%"></i></div><span class="hint">' + ready + "% ready" + (need != null ? " · needs " + (need > 100 ? "more than 100%" : need + "%") + " in the exam" : "") + "</span></div></div>";
    }).join("") : '<div class="empty"><b>No tests or exams yet</b><span>Add them under Hub › Tests &amp; exams.</span></div>';
  }

  function next() {
    const n = F.upcoming()[0];
    if (!n) { $("dashNext").innerHTML = '<button type="button" class="next-card empty-next" data-go="exams"><span class="next-num"><b>+</b></span><span class="grow"><span class="eyebrow">NO EXAMS YET</span><b>Add your first test or exam</b><span>Funi starts counting down for you</span></span></button>'; return; }
    const d = F.daysLeft(n.due_date), m = S.modules.find((mm) => F.sameCode(mm.code, n.module));
    $("dashNext").innerHTML = '<button type="button" class="next-card" data-go="plan"><span class="next-num"><b>' + (d === 0 ? "!" : d) + "</b><span>" + (d === 0 ? "today" : d === 1 ? "day" : "days") + '</span></span><span class="grow"><span class="eyebrow">NEXT EXAM</span><b>' +
      esc(n.module) + " · " + esc(n.kind) + "</b><span>" + F.niceDate(n.due_date) + (n.start_time ? " · " + F.niceTime(n.start_time) : "") + " · You're " + F.readinessOf(m) + '% ready</span></span><svg viewBox="0 0 24 24" class="chev"><path d="M9 6l6 6-6 6"/></svg></button>';
  }

  function cheer(f) {
    const p = S.profile || { id: F.me && F.me.id }, name = F.nameOf(p);
    const good = f.total > 0 && f.total >= f.lastWeek;
    $("dashCheer").innerHTML = '<span class="cheer-txt"><b>' + (good ? "You're doing amazing, " + esc(name) + "!" : f.total ? "Small steps count, " + esc(name) + "!" : "You've got this, " + esc(name) + "!") + "</b><span>" +
      (good ? "Keep up the good work and don't forget to take care of yourself." : "Try one 25-minute session today. Funi will cheer you on.") + ' ♥</span></span><span class="cheer-art">' +
      A.dreamyScene(F.isPhoto(p.avatar) ? null : p.avatar, good ? "Feeling great" : "Happy", p.id) + "</span>";
  }

  F.renderDash = () => {
    if (!F.me) return;
    const h = new Date().getHours(), p = S.profile || { username: F.usernameOf(F.me) };
    $("dashGreeting").textContent = (h < 12 ? "Good morning, " : h < 17 ? "Good afternoon, " : "Good evening, ") + F.nameOf(p) + "!";
    next();
    $("dashStats").innerHTML = tiles();
    const f = chart();
    calendar(); reminders(); topTasks(); examBars(); cheer(f);
  };
  F.on("view:dash", () => F.renderDash());
  F.on("data", () => { if (S.view === "dash") F.renderDash(); if (S.view === "hub" && F.renderHub) F.renderHub(); if (S.view === "reminders") F.renderTasks(); });
  F.on("theme", () => { if (S.view === "dash") F.renderDash(); });
  // keep the dashboard fresh (focus minutes, countdowns after midnight)
  setInterval(() => { if (F.me && S.view === "dash" && document.visibilityState === "visible") F.renderDash(); }, 60000);
})();
