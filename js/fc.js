/* Study FC: houses play each other every week. Finished study sessions are goals (20 min = 1, 1 hour+ = 2).
 * Your player card is worked out from your own studying over the last 14 days. */
(function () {
  "use strict";
  const F = window.Funi, $ = F.$, esc = F.esc, S = F.s;
  const profiles = () => F.profiles || {};
  const me = () => (F.me ? F.me.id : "");
  const nameOf = (id) => (id === me() ? "You" : profiles()[id] ? F.nameOf(profiles()[id]) : "A teammate");
  const clamp = (v) => Math.max(40, Math.min(99, Math.round(v)));
  const BOT = { house_id: "bot", name: "Funi Bots", badge: "🤖" };
  let seg = "card", team = null, weeks = [], scorers = [], mySessions = [];

  function hash(str) { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  // who plays who in a week: everyone in a fixed but shuffled order, paired up; an odd team out plays the Funi Bots
  function pairings(rows) {
    const teams = rows.slice().sort((a, b) => hash(a.week_start + a.house_id) - hash(b.week_start + b.house_id));
    const out = [];
    for (let i = 0; i < teams.length; i += 2) out.push([teams[i], teams[i + 1] || Object.assign({ goals: 3, week_start: teams[i].week_start }, BOT)]);
    return out;
  }
  function weekRows() {
    const by = {};
    weeks.forEach((r) => { (by[r.week_start] = by[r.week_start] || []).push(r); });
    return Object.keys(by).sort().map((k) => ({ start: k, rows: by[k] }));
  }

  /* ---------- player card (from your own sessions) ---------- */
  async function loadMine() {
    const from = new Date(Date.now() - 14 * 864e5).toISOString();
    let r = await F.sb.from("study_sessions").select("started_at,focus_seconds,module_code,room_id,is_active").eq("user_id", me()).gte("started_at", from);
    if (r.error) r = await F.sb.from("study_sessions").select("started_at,focus_seconds,module_code,is_active").eq("user_id", me()).gte("started_at", from);
    mySessions = (r.data || []).filter((x) => !x.is_active && (x.focus_seconds || 0) >= 300);
  }
  function stats() {
    const ss = mySessions, n = ss.length;
    const mins = ss.map((x) => (x.focus_seconds || 0) / 60);
    const avg = n ? mins.reduce((a, b) => a + b, 0) / n : 0;
    const days = new Set(ss.map((x) => new Date(x.started_at).toDateString())).size;
    const soon = (S.items || []).filter((x) => F.daysLeft(x.due_date) <= 21).map((x) => String(x.module).toUpperCase());
    const prepMin = ss.filter((x) => soon.includes(String(x.module_code || "").toUpperCase())).reduce((a, x) => a + (x.focus_seconds || 0) / 60, 0);
    const totalMin = mins.reduce((a, b) => a + b, 0);
    const night = ss.filter((x) => { const h = new Date(x.started_at).getHours(); return h >= 19 || h < 4; }).length;
    const team = ss.filter((x) => x.room_id).length;
    const since = Date.now() - 14 * 864e5;
    const due = (S.tasks || []).filter((t) => !t.ghost && t.due_date && new Date(t.due_date + "T12:00:00").getTime() >= since && new Date(t.due_date + "T00:00:00").getTime() <= Date.now());
    const done = due.filter((t) => t.done).length;
    const st = {
      FOC: n ? clamp(40 + avg * 1.0) : 40,
      CON: clamp(40 + days * 4.3),
      PRE: soon.length ? clamp(40 + (totalMin ? prepMin / totalMin : 0) * 59) : clamp(45 + n * 3),
      NIT: clamp(40 + night * 8),
      TEA: clamp(40 + team * 10),
      FIN: due.length ? clamp(40 + (done / due.length) * 59) : clamp(55 + n)
    };
    const rating = n ? clamp((st.FOC * 2 + st.CON * 2 + st.PRE + st.FIN + st.TEA + st.NIT) / 8) : 40;
    const best = Object.entries(st).sort((a, b) => b[1] - a[1])[0][0];
    const pos = { FOC: "ST", CON: "CB", PRE: "CM", NIT: "GK", TEA: "CAM", FIN: "RW" }[best];
    const tier = rating >= 85 ? "Legend" : rating >= 75 ? "Gold" : rating >= 65 ? "Silver" : "Bronze";
    const next = tier === "Legend" ? null : tier === "Gold" ? 85 : tier === "Silver" ? 75 : 65;
    return { st, rating, pos, tier, next, n };
  }
  function renderCard() {
    const s = stats(), p = S.profile || { id: me() };
    const name = (F.nameOf(p) || "You").toUpperCase().slice(0, 14);
    const pct = s.next ? Math.round(((s.rating - (s.next - 10)) / 10) * 100) : 100;
    $("fcCard").innerHTML =
      '<div class="fc-card tier-' + s.tier.toLowerCase() + '" role="img" aria-label="' + esc(s.tier + " card, rating " + s.rating) + '">' +
        '<div class="fc-rate"><b>' + s.rating + "</b><span>" + s.pos + '</span><span aria-hidden="true">🎓</span></div>' +
        '<span class="fc-tier">' + esc(s.tier.toUpperCase()) + "</span>" +
        '<span class="fc-ava">' + F.avatar(p) + "</span>" +
        '<b class="fc-name">' + esc(name) + "</b>" +
        '<div class="fc-stats">' + Object.entries(s.st).map(([k, v]) => "<span><b>" + v + "</b> " + k + "</span>").join("") + "</div>" +
      "</div>" +
      '<div class="card stack fc-explain">' +
        '<div class="between"><b>' + esc(s.tier) + " card</b><span class=\"hint\">" + (s.next ? s.next + " for " + (s.tier === "Gold" ? "Legend" : s.tier === "Silver" ? "Gold" : "Silver") : "Top level!") + "</span></div>" +
        '<div class="fc-bar"><i style="width:' + Math.max(4, Math.min(100, pct)) + '%"></i></div>' +
        '<p class="hint">' + (s.n ? "From your last 14 days: " : "Finish a study session to get your first ratings. ") +
        "FOC = how long you focus · CON = days you studied · PRE = studying for your next exams · NIT = night sessions · TEA = studying in rooms with the squad · FIN = finishing your tasks.</p>" +
        '<button type="button" class="btn primary block" data-go="study">⚽ Train now (start a session)</button>' +
      "</div>";
  }

  /* ---------- this week's match ---------- */
  function myMatch(rows) {
    const p = pairings(rows).find((m) => m[0].house_id === team.id || m[1].house_id === team.id);
    if (!p) return null;
    return p[0].house_id === team.id ? { us: p[0], them: p[1] } : { us: p[1], them: p[0] };
  }
  function renderMatch() {
    const wr = weekRows(), cur = wr[wr.length - 1];
    if (!cur) { $("fcMatch").innerHTML = '<div class="empty"><b>No matches yet</b><span>Matches start when your house switches on Study FC.</span></div>'; return; }
    const m = myMatch(cur.rows);
    if (!m) { $("fcMatch").innerHTML = '<div class="empty"><b>No match this week</b></div>'; return; }
    const end = new Date(cur.start + "T00:00:00"); end.setDate(end.getDate() + 7);
    const hrs = Math.max(0, Math.round((end - Date.now()) / 3600e3));
    const lead = m.us.goals - m.them.goals;
    const mood = lead > 0 ? "You're winning! Keep it up 🔥" : lead < 0 ? "You're behind by " + -lead + ". One long session is 2 goals!" : "It's a draw. Score the winner!";
    const sc = scorers.filter((x) => x.goals > 0).sort((a, b) => b.goals - a.goals);
    const past = wr.slice(0, -1).reverse().slice(0, 5).map((w) => { const x = myMatch(w.rows); if (!x) return ""; const r = x.us.goals > x.them.goals ? "W" : x.us.goals < x.them.goals ? "L" : "D";
      return '<div class="fc-res"><span class="fc-wdl ' + r + '">' + r + "</span><span class=\"grow\">vs " + esc(x.them.badge + " " + x.them.name) + "</span><b>" + x.us.goals + " – " + x.them.goals + "</b></div>"; }).join("");
    $("fcMatch").innerHTML =
      '<section class="fc-pitch">' +
        '<span class="fc-live">THIS WEEK · ENDS SUNDAY NIGHT · ' + (hrs > 48 ? Math.round(hrs / 24) + " DAYS LEFT" : hrs + " HOURS LEFT") + "</span>" +
        '<div class="fc-score"><div><span class="fc-badge">' + esc(m.us.badge) + "</span><b>" + esc(m.us.name) + '</b></div><b class="fc-big">' + m.us.goals + " – " + m.them.goals + '</b><div><span class="fc-badge">' + esc(m.them.badge) + "</span><b>" + esc(m.them.name) + "</b></div></div>" +
        "<p>" + esc(mood) + "</p>" +
      "</section>" +
      '<div class="card stack"><b>Your team\'s goals</b>' + (sc.length ? sc.map((x) => '<div class="fc-res"><span aria-hidden="true">⚽</span><span class="grow">' + esc(nameOf(x.user_id)) + " · " + x.minutes + " min</span><b>" + x.goals + "</b></div>").join("") : '<p class="hint">No goals yet this week. 20 minutes of focus = 1 goal, 1 hour = 2.</p>') + "</div>" +
      (past ? '<div class="card stack"><b>Last results</b>' + past + "</div>" : "") +
      '<button type="button" class="btn primary block" data-go="study">⚽ Train now (start a session)</button>';
  }

  /* ---------- league ---------- */
  function renderLeague() {
    const tab = {};
    const add = (t) => (tab[t.house_id] = tab[t.house_id] || { id: t.house_id, name: t.name, badge: t.badge, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 });
    const wr = weekRows();
    wr.slice(0, -1).forEach((w) => pairings(w.rows).forEach(([a, b]) => {
      [[a, b], [b, a]].forEach(([x, y]) => {
        if (x.house_id === "bot") return;
        const r = add(x); r.p++; r.gf += x.goals; r.ga += y.goals;
        if (x.goals > y.goals) { r.w++; r.pts += 3; } else if (x.goals === y.goals) { r.d++; r.pts += 1; } else r.l++;
      });
    }));
    (wr[wr.length - 1] ? wr[wr.length - 1].rows : []).forEach(add);
    const rows = Object.values(tab).sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.name.localeCompare(b.name));
    $("fcLeague").innerHTML = '<div class="card fc-table" role="table" aria-label="League table">' +
      '<div class="fc-tr fc-th" role="row"><span>#</span><span>Team</span><span>P</span><span>W</span><span>D</span><span>L</span><span>GD</span><span>Pts</span></div>' +
      rows.map((r, i) => '<div class="fc-tr' + (r.id === team.id ? " me" : "") + '" role="row"><span>' + (i + 1) + '</span><span class="fc-tn">' + esc(r.badge + " " + r.name) + (r.id === team.id ? " (you)" : "") + "</span><span>" + r.p + "</span><span>" + r.w + "</span><span>" + r.d + "</span><span>" + r.l + "</span><span>" + (r.gf - r.ga) + "</span><b>" + r.pts + "</b></div>").join("") +
      "</div><p class=\"hint\" style=\"text-align:center\">Last 6 weeks. Win = 3 points, draw = 1. This week's match counts when it ends on Sunday.</p>";
  }

  /* ---------- page ---------- */
  function renderSeg() {
    document.querySelectorAll("#fcSeg [data-fseg]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.fseg === seg)));
    $("fcCard").hidden = seg !== "card"; $("fcMatch").hidden = seg !== "match"; $("fcLeague").hidden = seg !== "league";
    if (seg === "card") renderCard(); else if (seg === "match") renderMatch(); else renderLeague();
  }
  document.querySelectorAll("#fcSeg [data-fseg]").forEach((b) => b.addEventListener("click", () => { seg = b.dataset.fseg; renderSeg(); }));
  async function openFc(sub) {
    if (!F.sb || !F.me) return;
    if (F.loadHouses) await F.loadHouses();
    const fcHouses = (S.houses || []).filter((h) => h.fc_on);
    $("fcSwitch").hidden = fcHouses.length < 2;
    if (!fcHouses.length) {
      team = null; $("fcBody").hidden = true; $("fcStart").hidden = false;
      const own = (S.houses || []).find((h) => h.owner_id === me());
      $("fcStart").innerHTML = '<section class="fc-pitch"><span class="fc-badge" style="font-size:44px">⚽</span><b class="fc-big" style="font-size:24px">Your house is your team</b><p>Every week your house plays another house. Every finished study session is a goal: 20 min = 1 goal, 1 hour = 2.</p></section>' +
        (own ? '<button type="button" class="btn primary block" id="fcJoin">Enter ' + esc(own.emoji + " " + own.name) + " into Study FC</button>"
          : (S.houses || []).length ? '<p class="hint" style="text-align:center">Ask the person who made your house to switch on Study FC in the house settings.</p>'
          : '<button type="button" class="btn primary block" data-go="house">Make a house for your squad</button>');
      const j = $("fcJoin");
      if (j) j.onclick = async () => {
        j.disabled = true;
        const { error } = await F.sb.from("houses").update({ fc_on: true }).eq("id", own.id);
        if (error) { j.disabled = false; return F.toast("Couldn't enter: " + error.message, { long: true }); }
        F.toast("You're in! ⚽ Your first match is this week."); openFc();
      };
      renderCardOnly();
      return;
    }
    team = fcHouses.find((h) => h.id === sub) || (team && fcHouses.find((h) => h.id === team.id)) || fcHouses[0];
    $("fcSwitch").innerHTML = fcHouses.map((h) => '<button type="button" class="chip' + (h.id === team.id ? " on" : "") + '" data-fcteam="' + esc(h.id) + '">' + esc(h.fc_badge + " " + (h.fc_name || h.name)) + "</button>").join("");
    $("fcSub").textContent = (team.fc_badge || "⚽") + " " + (team.fc_name || team.name) + " · every finished session is a goal";
    $("fcStart").hidden = true; $("fcBody").hidden = false;
    const [w, sc] = await Promise.all([F.sb.rpc("funi_fc_weeks", { weeks: 6 }), F.sb.rpc("funi_fc_scorers", { h: team.id }), loadMine()]);
    if (w.error) { $("fcBody").hidden = true; $("fcStart").hidden = false; $("fcStart").innerHTML = '<div class="empty"><b>' + (F.looksOffline(w.error) ? "You're offline" : "Study FC isn't switched on yet") + "</b><span>" + (F.looksOffline(w.error) ? "Matches need internet." : "Run funi-v12-setup.sql in Supabase, then come back.") + "</span></div>"; return; }
    weeks = w.data || []; scorers = sc.data || [];
    const ids = scorers.map((x) => x.user_id).filter((id) => !profiles()[id]);
    if (ids.length) { const { data } = await F.sb.from("study_profiles").select("*").in("id", ids); (data || []).forEach((p) => { profiles()[p.id] = p; }); }
    renderSeg();
  }
  async function renderCardOnly() { await loadMine(); $("fcStart").insertAdjacentHTML("beforeend", '<div id="fcCardSolo"></div>'); const keep = $("fcCard"); keep.hidden = false; renderCard(); $("fcCardSolo").appendChild(keep); }
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-fcteam]"); if (b) openFc(b.dataset.fcteam); });
  F.on("view:fc", (sub) => {
    // put the card back in its place if the "no team yet" page borrowed it
    if ($("fcCard").parentElement.id === "fcCardSolo") $("fcSeg").after($("fcCard"));
    openFc(sub);
  });
})();
