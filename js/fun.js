/* Funi fun with friends: study rooms (shared timer + cheers), leaderboard + streaks, study garden. */
(function () {
  "use strict";
  const F = window.Funi, $ = F.$, esc = F.esc, S = F.s;
  const profiles = () => F.profiles || {};
  const CHEERS = ["You got this!", "Proud of you", "Almost there", "Drink water", "Let's go!"];
  const pad = (n) => (n < 10 ? "0" : "") + n;
  const clock = (sec) => { sec = Math.max(0, Math.round(sec)); return pad(Math.floor(sec / 60)) + ":" + pad(sec % 60); };
  const nameOf = (id) => (id === (F.me && F.me.id) ? "You" : profiles()[id] ? F.nameOf(profiles()[id]) : "A friend");
  async function needProfiles(ids) {
    const miss = [...new Set(ids)].filter((id) => id && !profiles()[id]);
    if (!miss.length) return;
    const { data } = await F.sb.from("study_profiles").select("*").in("id", miss);
    (data || []).forEach((p) => { profiles()[p.id] = p; });
  }

  /* =====================================================================
     STUDY ROOMS
     ===================================================================== */
  let room = null, members = [], chan = null, hb = null, rtick = null, wasRunning = false;
  const lastCheer = {};
  const ACTIVE_MS = 3 * 60000;
  const isActive = (m) => !m.left_at && (m.user_id === F.me.id || Date.now() - new Date(m.last_seen).getTime() < ACTIVE_MS);

  async function listRooms() {
    const since = new Date(Date.now() - 12 * 3600e3).toISOString();
    const { data: rooms, error } = await F.sb.from("study_rooms").select("*").eq("is_open", true).gte("created_at", since).order("created_at", { ascending: false });
    if (error) return { rooms: [], missing: true };
    if (!rooms || !rooms.length) return { rooms: [] };
    const { data: mem } = await F.sb.from("study_room_members").select("*").in("room_id", rooms.map((r) => r.id));
    await needProfiles(rooms.map((r) => r.host_id));
    const out = [];
    for (const r of rooms) {
      const inside = (mem || []).filter((m) => m.room_id === r.id && isActive(m));
      if (!inside.length) { if (r.host_id === F.me.id) F.sb.from("study_rooms").update({ is_open: false }).eq("id", r.id).then(() => {}, () => {}); continue; }
      out.push(Object.assign({}, r, { inside: inside.length, mine: inside.some((m) => m.user_id === F.me.id) }));
    }
    return { rooms: out };
  }
  function roomState(r) {
    const left = r.phase_ends_at ? (new Date(r.phase_ends_at).getTime() - Date.now()) / 1000 : 0;
    if (r.phase === "focus" && left > 0) return "Round " + r.round + " · " + Math.ceil(left / 60) + " min left";
    if (r.phase === "break" && left > 0) return "On a break";
    return r.round ? "Between rounds" : "Waiting to start";
  }
  function roomCard(r) {
    return '<div class="room-card' + (isNight(r) ? " night" : "") + '"><span class="ava sm">' + F.avatar(profiles()[r.host_id] || { id: r.host_id }) + '</span><span class="grow"><b>' + esc(r.name) + "</b><span>" +
      esc(nameOf(r.host_id)) + (r.module_code ? " · " + esc(r.module_code) : "") + " · " + r.inside + " inside · " + esc(roomState(r)) + "</span></span>" +
      '<button type="button" class="btn primary small" data-join="' + esc(r.id) + '">' + (r.mine ? "Open" : "Join") + "</button></div>";
  }
  async function renderRooms() {
    const { rooms, missing } = await listRooms();
    $("roomsList").innerHTML = missing ? '<div class="empty"><b>Rooms aren\'t switched on yet</b><span>Run funi-v7-setup.sql in Supabase.</span></div>'
      : rooms.length ? rooms.map(roomCard).join("") : '<div class="empty"><b>No rooms open right now</b><span>Open one below and your study partners get a notification to join.</span></div>';
    const sel = $("roomModule"), keep = sel.value;
    sel.innerHTML = '<option value="">General study</option>' + F.orderedModules().map((m) => '<option value="' + esc(m.code) + '">' + esc(m.code + (m.name ? " · " + m.name : "")) + "</option>").join("");
    if (keep) sel.value = keep;
  }
  F.renderOpenRooms = async () => {
    if (!F.sb || !F.me) return;
    const { rooms } = await listRooms();
    $("openRoomsBox").hidden = !rooms.length;
    $("openRooms").innerHTML = rooms.map(roomCard).join("");
  };
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-join]"); if (b) F.go("room:" + b.dataset.join); });

  $("roomForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const mod = $("roomModule").value, name = $("roomName").value.trim() || (mod ? mod + " squad" : F.nameOf(S.profile || {}) + "'s room");
    const focus = Math.round(+$("roomFocus").value), brk = Math.round(+$("roomBreak").value);
    if (!(focus >= 1 && focus <= 240)) return F.showError("roomError", "Choose 1 to 240 focus minutes.");
    if (!(brk >= 1 && brk <= 60)) return F.showError("roomError", "Choose a break of 1 to 60 minutes.");
    F.showError("roomError", ""); $("roomCreate").disabled = true;
    const { data, error } = await F.sb.from("study_rooms").insert({ host_id: F.me.id, name: name.slice(0, 40), module_code: mod || null, focus_minutes: focus, break_minutes: brk }).select().single();
    $("roomCreate").disabled = false;
    if (error) return F.showError("roomError", "Couldn't open the room: " + error.message);
    $("roomName").value = "";
    F.go("room:" + data.id);
  });

  const isNight = (r) => /^cross night/i.test((r && r.name) || "");
  $("crossNightBtn").onclick = async () => {
    $("crossNightBtn").disabled = true;
    const mod = $("roomModule").value;
    const { data, error } = await F.sb.from("study_rooms").insert({ host_id: F.me.id, name: "Cross night 🌙", module_code: mod || null, focus_minutes: 50, break_minutes: 10 }).select().single();
    $("crossNightBtn").disabled = false;
    if (error) return F.toast("Couldn't start cross night: " + error.message, { long: true });
    F.go("room:" + data.id);
  };
  async function enterRoom(id) {
    if (!F.sb || !F.me) return;
    if (!room || room.id !== id) { stopRoom(); members = []; }
    const { data: r } = await F.sb.from("study_rooms").select("*").eq("id", id).maybeSingle();
    if (!r || r.is_open === false) { F.toast("That room has closed. Open a new one!"); F.go("rooms", { back: true }); return; }
    room = r;
    const now = new Date().toISOString();
    const { error } = await F.sb.from("study_room_members").upsert({ room_id: id, user_id: F.me.id, left_at: null, last_seen: now }, { onConflict: "room_id,user_id" });
    if (error) { F.toast("Couldn't join: " + error.message, { long: true }); return; }
    await loadMembers();
    const mine = members.find((m) => m.user_id === F.me.id);
    $("rmTask").value = (mine && mine.task) || "";
    if (!chan) {
      chan = F.sb.channel("room-" + id)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "study_rooms", filter: "id=eq." + id }, (p) => { room = p.new; if (!room.is_open) return; syncMine(); renderRoom(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "study_room_members", filter: "room_id=eq." + id }, () => loadMembers().then(renderRoom))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "study_room_cheers", filter: "room_id=eq." + id }, (p) => gotCheer(p.new))
        .subscribe();
      hb = setInterval(() => { if (room) F.sb.from("study_room_members").update({ last_seen: new Date().toISOString() }).eq("room_id", room.id).eq("user_id", F.me.id).then(() => {}, () => {}); }, 60000);
    }
    clearInterval(rtick); rtick = setInterval(tickRoom, 1000);
    syncMine(); renderRoom();
  }
  async function loadMembers() {
    if (!room) return;
    const { data } = await F.sb.from("study_room_members").select("*").eq("room_id", room.id);
    members = (data || []).filter(isActive);
    await needProfiles(members.map((m) => m.user_id));
  }
  function stopRoom() {
    if (chan) { F.sb.removeChannel(chan); chan = null; }
    clearInterval(hb); clearInterval(rtick); hb = rtick = null;
  }
  // when the room is in a round, my own timer follows it (counts for my dashboard, garden and leaderboard)
  function syncMine() {
    if (!room || room.phase !== "focus" || !room.phase_ends_at) return;
    const ends = new Date(room.phase_ends_at).getTime();
    if (ends - Date.now() < 5000) return;
    const t = F.timerState(), key = "funi.roomRound." + room.id;
    if (t && t.roomId === room.id && t.roomRound === room.round) return; // already following (or I stopped this round)
    try { if (+sessionStorage.getItem(key) === room.round) return; sessionStorage.setItem(key, String(room.round)); } catch (e) {}
    const prev = t && t.roomId === room.id ? t : null;
    F.startRound({ module: room.module_code || "General study", activity: "Study room: " + room.name, feeling: (S.profile && S.profile.feeling) || "Happy", share: true,
      focusMin: room.focus_minutes, breakMin: room.break_minutes, endAt: ends, roomId: room.id, roomRound: room.round,
      rounds: prev ? prev.rounds : 0, totalSec: prev ? prev.totalSec : 0 });
  }
  function timerInfo() {
    const left = room.phase_ends_at ? (new Date(room.phase_ends_at).getTime() - Date.now()) / 1000 : 0;
    if (room.phase === "focus" && left > 0) return { run: true, label: "SHARED TIMER · ROUND " + room.round, clock: clock(left), note: "Everyone gets confetti when it ends" };
    if (room.phase === "break" && left > 0) return { run: true, brk: true, label: "BREAK TOGETHER", clock: clock(left), note: "Stretch, drink water, chat a bit" };
    if (room.phase === "focus" && room.round) return { done: true, label: "ROUND " + room.round + " DONE", clock: "00:00", note: "Well done, everyone!" };
    if (room.phase === "break") return { label: "BREAK'S OVER", clock: clock(room.focus_minutes * 60), note: "Ready for the next round?" };
    return { label: "WAITING TO START", clock: clock(room.focus_minutes * 60), note: "Start when everyone's ready" };
  }
  function tickRoom() {
    if (!room || S.view !== "room") return;
    const i = timerInfo();
    $("rmLabel").textContent = i.label; $("rmClock").textContent = i.clock; $("rmNote").textContent = i.note;
    if (wasRunning && !i.run) renderRoom(true);
    else if (!wasRunning && i.run) renderRoom();
    wasRunning = !!i.run;
  }
  function renderRoom(justEnded) {
    if (!room) return;
    $("rmTitle").textContent = room.name;
    $("rmSub").textContent = members.length + " studying together" + (room.module_code ? " · " + room.module_code : "") + " · " + room.focus_minutes + " min rounds";
    const i = timerInfo();
    $("rmLabel").textContent = i.label; $("rmClock").textContent = i.clock; $("rmNote").textContent = i.note;
    $("rmTimer").classList.toggle("is-break", !!i.brk);
    $("rmTimer").classList.toggle("night", isNight(room) && !i.brk);
    if (isNight(room) && !i.run) $("rmNote").textContent = room.round ? "Drink water, stretch, then the next round 🌙" : "Cross night! Start when the squad is here 🌙";
    if (justEnded && room.phase === "focus") {
      $("rmTimer").classList.remove("celebrate"); void $("rmTimer").offsetWidth; $("rmTimer").classList.add("celebrate");
      if (!$("rmTimer").querySelector(".confetti")) $("rmTimer").insertAdjacentHTML("afterbegin", '<div class="confetti" aria-hidden="true">' + "<i></i>".repeat(12) + "</div>");
    }
    $("rmControls").hidden = !!i.run;
    $("rmStart").textContent = "Start round " + (room.round + 1);
    $("rmBreak").hidden = !(i.done);
    $("rmBreak").textContent = "Break together (" + room.break_minutes + " min)";
    const status = i.run ? (i.brk ? "On a break" : "Focusing") : "Ready";
    $("rmSeats").innerHTML = members.map((m) => {
      const p = profiles()[m.user_id] || { id: m.user_id }, c = lastCheer[m.user_id], fresh = c && Date.now() - c.at < 9000;
      return '<div class="seat"><span class="ava">' + F.avatar(p) + "</span><b>" + esc(nameOf(m.user_id)) + "</b><span class=\"seat-task\">" + esc(m.task || "Studying") + '</span><span class="pill ' + (status === "Focusing" ? "lav" : status === "On a break" ? "butter" : "mint") + '">' + status + "</span>" +
        (fresh ? '<span class="seat-cheer">' + esc(c.label) + "</span>" : "") + "</div>";
    }).join("");
    $("rmCheers").innerHTML = CHEERS.map((c) => '<button type="button" class="chip" data-cheer="' + esc(c) + '">' + esc(c) + "</button>").join("");
  }
  $("rmStart").onclick = async () => {
    if (!room) return;
    $("rmStart").disabled = true;
    const ends = new Date(Date.now() + room.focus_minutes * 60000).toISOString();
    const { data, error } = await F.sb.from("study_rooms").update({ phase: "focus", round: room.round + 1, phase_ends_at: ends }).eq("id", room.id).select().single();
    $("rmStart").disabled = false;
    if (error) return F.toast("Couldn't start: " + error.message);
    room = data; syncMine(); renderRoom(); F.go("room:" + room.id);
  };
  $("rmBreak").onclick = async () => {
    if (!room) return;
    const { data, error } = await F.sb.from("study_rooms").update({ phase: "break", phase_ends_at: new Date(Date.now() + room.break_minutes * 60000).toISOString() }).eq("id", room.id).select().single();
    if (error) return F.toast("Couldn't start the break: " + error.message);
    room = data; renderRoom();
  };
  $("rmTaskSave").onclick = async () => {
    if (!room) return;
    const task = $("rmTask").value.trim().slice(0, 60) || null;
    await F.sb.from("study_room_members").update({ task }).eq("room_id", room.id).eq("user_id", F.me.id);
    const m = members.find((x) => x.user_id === F.me.id); if (m) m.task = task;
    renderRoom(); F.toast("Saved. The room can see what you're working on.");
  };
  $("rmCheers").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-cheer]"); if (!b || !room) return;
    b.disabled = true; setTimeout(() => { b.disabled = false; }, 3000);
    const { error } = await F.sb.from("study_room_cheers").insert({ room_id: room.id, from_id: F.me.id, label: b.dataset.cheer });
    if (error) return F.toast("Couldn't send: " + error.message);
    lastCheer[F.me.id] = { label: b.dataset.cheer, at: Date.now() }; renderRoom();
    F.toast('Sent "' + b.dataset.cheer + '" to the room.');
  });
  function gotCheer(c) {
    if (c.from_id === F.me.id) return;
    lastCheer[c.from_id] = { label: c.label, at: Date.now() };
    if (S.view === "room") { renderRoom(); F.toast(nameOf(c.from_id) + ": " + c.label); setTimeout(() => { if (S.view === "room") renderRoom(); }, 9500); }
  }
  $("rmLeave").onclick = async () => {
    if (!room) return;
    const t = F.timerState(), studying = t && t.roomId === room.id && (t.phase === "focus");
    if (!(await F.confirm("Leave " + room.name + "?", studying ? "Your timer for this round stops and your time is saved." : "You can join again while it's open.", "Leave"))) return;
    const id = room.id;
    await F.sb.from("study_room_members").update({ left_at: new Date().toISOString() }).eq("room_id", id).eq("user_id", F.me.id);
    if (studying) F.endMySession("ended");
    const { data } = await F.sb.from("study_room_members").select("user_id,left_at,last_seen").eq("room_id", id);
    if (!(data || []).some((m) => m.user_id !== F.me.id && isActive(m))) await F.sb.from("study_rooms").update({ is_open: false }).eq("id", id);
    stopRoom(); room = null; members = [];
    F.go("rooms", { back: true });
  };
  $("rmInvite").onclick = () => {
    if (!room) return;
    const link = location.origin + "/#room-" + room.id, rm = room;
    F.pickPartner({ title: "Invite to " + rm.name, text: "They get a chat message with a link to join." }, async (ids) => {
      const body = "Come study with me! Join my room \"" + rm.name + "\": " + link;
      const { error } = await F.sb.from("study_messages").insert(ids.map((to) => ({ sender_id: F.me.id, recipient_id: to, body })));
      F.toast(error ? "Couldn't send: " + error.message : "Invite sent!");
    }, { multi: true, ok: "Send invite" });
  };
  F.on("view:rooms", renderRooms);
  F.on("view:room", (id) => { if (id) enterRoom(id); else if (room) { renderRoom(); clearInterval(rtick); rtick = setInterval(tickRoom, 1000); } else F.go("rooms"); });
  F.on("view:partners", () => F.renderOpenRooms());
  F.on("rt:notification", (n) => { if (n && n.kind === "room") { if (S.view === "partners") F.renderOpenRooms(); if (S.view === "rooms") renderRooms(); } });

  /* ---------- pick partners (used by rooms, flashcards and battles) ---------- */
  let pickCb = null, pickMulti = false, picked = new Set();
  F.pickPartner = (opts, cb, more) => {
    pickCb = cb; pickMulti = !!(more && more.multi); picked = new Set();
    $("pickTitle").textContent = opts.title || "Choose a study partner";
    $("pickText").textContent = opts.text || "";
    $("pickOk").hidden = !pickMulti; $("pickOk").textContent = (more && more.ok) || "Share"; $("pickOk").disabled = true;
    const list = (S.partners || []).filter((p) => !(more && more.exclude && more.exclude.includes(p.id)));
    $("pickList").innerHTML = list.length ? list.map((p) => {
      const pr = profiles()[p.id] || { id: p.id };
      return '<button type="button" class="send-row" data-pick="' + esc(p.id) + '" aria-pressed="false"><span class="ava sm">' + F.avatar(pr) + '</span><span class="grow">' + esc(F.nameOf(pr)) + "</span>" + (pickMulti ? '<span class="tickbox" aria-hidden="true"></span>' : "") + "</button>";
    }).join("") : '<div class="empty"><b>No study partners yet</b><span>Invite a friend first.</span><button type="button" class="btn primary small" data-go="invite" data-close="pickSheet">Invite a friend</button></div>';
    $("pickSheet").showModal();
  };
  $("pickList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]"); if (!b) return;
    if (!pickMulti) { $("pickSheet").close(); if (pickCb) pickCb([b.dataset.pick]); return; }
    const id = b.dataset.pick; if (picked.has(id)) picked.delete(id); else picked.add(id);
    b.setAttribute("aria-pressed", String(picked.has(id))); $("pickOk").disabled = !picked.size;
  });
  $("pickOk").onclick = () => { $("pickSheet").close(); if (pickCb && picked.size) pickCb([...picked]); };

  /* =====================================================================
     LEADERBOARD + STREAKS
     ===================================================================== */
  let stats = null, statsAt = 0;
  async function loadStats(force) {
    if (!force && stats && Date.now() - statsAt < 30000) return stats;
    const { data, error } = await F.sb.rpc("funi_circle_stats");
    if (error) { stats = null; return null; }
    stats = data || []; statsAt = Date.now();
    await needProfiles(stats.map((r) => r.user_id));
    return stats;
  }
  const iso = (d) => F.isoOf(d);
  function streakOf(days) {
    const set = new Set(days || []), d = new Date();
    if (!set.has(iso(d))) d.setDate(d.getDate() - 1);
    let n = 0; while (set.has(iso(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  const hm = (sec) => { const m = Math.round(sec / 60), h = Math.floor(m / 60); return h ? h + "h " + pad(m % 60) + "m" : m + " min"; };
  function titleFor(r, rank) {
    if (!r.week_seconds) return "Snooze Button";
    if (rank === 0) return "Library Ghost";
    if (rank === 1) return "Coffee Powered";
    if (rank === 2) return "Night Owl";
    if (r.last_week_seconds && r.week_seconds > r.last_week_seconds) return "Comeback Kid";
    if (r.week_seconds < 7200) return "Warming Up";
    return "Steady Turtle";
  }
  let bseg = "week";
  async function renderBoard() {
    document.querySelectorAll("[data-bseg]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.bseg === bseg)));
    $("boardWeek").hidden = bseg !== "week"; $("boardStreaks").hidden = bseg !== "streaks";
    const rows = await loadStats();
    if (!rows) { $("boardWeek").innerHTML = $("boardStreaks").innerHTML = '<div class="empty"><b>Leaderboard isn\'t switched on yet</b><span>Run funi-v7-setup.sql in Supabase.</span></div>'; return; }
    const sorted = rows.slice().sort((a, b) => b.week_seconds - a.week_seconds);
    const me = F.me.id, myIdx = sorted.findIndex((r) => r.user_id === me);
    if (sorted.length < 2) {
      $("boardWeek").innerHTML = '<div class="empty"><b>It\'s just you so far</b><span>You studied ' + hm((sorted[0] || {}).week_seconds || 0) + ' this week. Invite friends to compete!</span><button type="button" class="btn primary small" data-go="invite">Invite a friend</button></div>';
    } else {
      const top = sorted.slice(0, 3), order = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
      const pod = '<div class="podium">' + order.map((r) => {
        const rank = sorted.indexOf(r), p = profiles()[r.user_id] || { id: r.user_id };
        return '<div class="pod pod-' + (rank + 1) + '"><span class="ava' + (rank === 0 ? " lg" : "") + '">' + F.avatar(p) + "</span><b>" + esc(nameOf(r.user_id)) + '</b><span class="pod-title">' + esc(titleFor(r, rank)) + '</span><div class="pod-block"><span class="pod-place">' + (rank + 1) + "</span><span>" + hm(r.week_seconds) + "</span></div></div>";
      }).join("") + "</div>";
      const rest = sorted.slice(3).map((r, k) => {
        const rank = k + 3, p = profiles()[r.user_id] || { id: r.user_id };
        return '<div class="board-row' + (r.user_id === me ? " me" : "") + '"><span class="board-place">' + (rank + 1) + '</span><span class="ava sm">' + F.avatar(p) + '</span><span class="grow"><b>' + esc(nameOf(r.user_id)) + '</b><span class="pod-title">' + esc(titleFor(r, rank)) + "</span></span><b>" + hm(r.week_seconds) + "</b></div>";
      }).join("");
      let nudge;
      if (myIdx === 0) nudge = sorted[0].week_seconds ? "You're on top this week! Keep it up." : "Nobody has studied yet this week. Be the first!";
      else {
        const ahead = sorted[myIdx - 1], gap = ahead.week_seconds - sorted[myIdx].week_seconds;
        nudge = "You're " + hm(gap) + " behind " + nameOf(ahead.user_id) + "." + (gap <= 50 * 60 ? " One more round and you pass them!" : " You can catch up!");
      }
      $("boardWeek").innerHTML = pod + rest + '<div class="nudge">' + esc(nudge) + "</div>";
    }
    // streaks
    const mine = rows.find((r) => r.user_id === me) || { study_days: [] }, my = streakOf(mine.study_days), today = (mine.study_days || []).includes(iso(new Date()));
    const mySet = new Set(mine.study_days || []);
    const pairs = rows.filter((r) => r.user_id !== me).map((r) => {
      const both = (r.study_days || []).filter((d) => mySet.has(d)), n = streakOf(both);
      const theyToday = (r.study_days || []).includes(iso(new Date()));
      const note = n >= 7 ? "On fire! Keep it going" : theyToday && !today ? nameOf(r.user_id) + " studied today, your turn!" : !theyToday && today ? "You studied today. Nudge " + nameOf(r.user_id) + "!" : n ? "Both study today to keep it" : "Start one today";
      return { r, n, note };
    }).sort((a, b) => b.n - a.n);
    const flame = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-6 1-9.5z" fill="#F08A4B"/><path d="M12 12c.6 2 2.5 2.8 2.5 5a2.5 2.5 0 0 1-5 0c0-1.6 1.4-2.6 2.5-5z" fill="#FDD167"/></svg>';
    $("boardStreaks").innerHTML = '<div class="card flat streak-card">' + flame + '<div><b class="streak-num">' + my + " day streak</b><span class=\"hint\">" +
      (today ? "You studied today. See you tomorrow!" : "Study 15 min today to make it " + (my + 1)) + "</span></div></div>" +
      "<h2>Shared streaks</h2><p class=\"hint\" style=\"margin-top:-6px\">Only grows on days you BOTH study 15+ minutes</p>" +
      (pairs.length ? pairs.map((x) => { const p = profiles()[x.r.user_id] || { id: x.r.user_id }; return '<div class="board-row"><span class="ava sm">' + F.avatar(p) + '</span><span class="grow"><b>You + ' + esc(nameOf(x.r.user_id)) + "</b><span class=\"hint\">" + esc(x.note) + '</span></span><span class="pill ' + (x.n >= 7 ? "peach" : "lav") + '">' + x.n + " day" + (x.n === 1 ? "" : "s") + "</span></div>"; }).join("")
        : '<div class="empty"><b>No study partners yet</b><span>Invite a friend to start a shared streak.</span></div>');
  }
  document.querySelectorAll("[data-bseg]").forEach((b) => b.addEventListener("click", () => { bseg = b.dataset.bseg; renderBoard(); }));
  F.on("view:board", (sub) => { if (sub) bseg = sub; renderBoard(); });
  F.loadCircleStats = loadStats;
  F.streakOf = streakOf;

  /* =====================================================================
     STUDY GARDEN
     ===================================================================== */
  const PETALS = ["#7556DC", "#E25C7E", "#F0A23B", "#3E9C6E", "#4A90C9", "#C0567A", "#8E6AD8", "#2E9DA3"];
  function flowerSvg(color, size, wilt, seed) {
    const stem = 34 + (seed % 4) * 7, w = 40, h = stem + size;
    if (wilt) return '<svg viewBox="0 0 ' + w + " " + (h + 4) + '" width="' + w + '" height="' + (h + 4) + '" aria-hidden="true"><path d="M20 ' + (h + 4) + " Q20 " + (size + 10) + " 30 " + (size + 8) + '" stroke="#A39A6B" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="31" cy="' + (size + 12) + '" r="7" fill="#C9BFA0"/></svg>';
    const cx = 20, cy = size / 2 + 2, r = size / 4;
    let petals = "";
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; petals += '<circle cx="' + (cx + Math.cos(a) * r).toFixed(1) + '" cy="' + (cy + Math.sin(a) * r).toFixed(1) + '" r="' + (r * 0.95).toFixed(1) + '" fill="' + color + '"/>'; }
    return '<svg viewBox="0 0 ' + w + " " + (h + 4) + '" width="' + w + '" height="' + (h + 4) + '" aria-hidden="true"><path d="M20 ' + (h + 4) + " L20 " + cy + '" stroke="#5C9A45" stroke-width="4" stroke-linecap="round"/><path d="M20 ' + (h - 8) + ' q-12 -4 -12 -14 q10 2 12 10z" fill="#6E9F4E"/>' + petals + '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.7).toFixed(1) + '" fill="#FDD167"/></svg>';
  }
  async function renderGarden() {
    const rows = await loadStats(true);
    if (!rows) { $("gdScene").innerHTML = '<div class="empty"><b>The garden isn\'t switched on yet</b><span>Run funi-v7-setup.sql in Supabase.</span></div>'; $("gdLegend").innerHTML = $("gdStats").innerHTML = ""; return; }
    const me = F.me.id, people = rows.slice().sort((a, b) => (a.user_id === me ? -1 : b.user_id === me ? 1 : nameOf(a.user_id).localeCompare(nameOf(b.user_id))));
    const twoDaysAgo = new Date(); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const lanes = people.map((r, i) => {
      const color = PETALS[i % PETALS.length], n = Math.min(r.week_rounds || 0, 12);
      const wilt = r.user_id !== me && (!r.last_study || r.last_study < iso(twoDaysAgo));
      const list = []; for (let k = 0; k < n; k++) list.push({ color, wilt: false });
      if (wilt) list.push({ color, wilt: true });
      return { r, color, list, wilt };
    });
    const plants = []; let more = true, k = 0;
    while (more && plants.length < 36) { more = false; lanes.forEach((l) => { if (l.list[k]) { plants.push(l.list[k]); more = true; } }); k++; }
    const total = people.reduce((t, r) => t + (r.week_rounds || 0), 0);
    const sky = '<svg class="gd-sun" viewBox="0 0 70 70" aria-hidden="true"><circle cx="35" cy="35" r="16" fill="#FDD167"/><g stroke="#FDD167" stroke-width="4" stroke-linecap="round"><path d="M35 6v8M35 56v8M6 35h8M56 35h8M15 15l6 6M49 49l6 6M55 15l-6 6M21 49l-6 6"/></g></svg>' +
      '<svg class="gd-cloud" viewBox="0 0 90 34" aria-hidden="true"><path d="M20 30a14 14 0 0 1 4-27 18 18 0 0 1 32 4 12 12 0 0 1 14 23z" fill="#FFFFFF"/></svg>';
    $("gdScene").innerHTML = sky + '<div class="gd-bed">' + (plants.length ? plants.map((p, i) => '<span class="gd-plant">' + flowerSvg(p.color, 22 + ((i * 7) % 3) * 6, p.wilt, i) + "</span>").join("")
      : '<span class="gd-empty">No flowers yet this week. Finish a 10-minute round to plant the first one!</span>') + '</div><div class="gd-soil"></div>';
    $("gdScene").setAttribute("role", "img");
    $("gdScene").setAttribute("aria-label", "Study garden with " + total + " flowers this week");
    $("gdLegend").innerHTML = lanes.map((l) => '<span class="legend-chip"><i style="background:' + l.color + '"></i>' + esc(nameOf(l.r.user_id)) + " · " + (l.r.week_rounds || 0) + "</span>").join("");
    const wilting = lanes.filter((l) => l.wilt).map((l) => nameOf(l.r.user_id));
    $("gdStats").innerHTML = '<div class="card flat gd-stat"><b class="ok-num">' + total + '</b><span>flower' + (total === 1 ? "" : "s") + " this week</span></div>" +
      '<div class="card flat gd-stat"><b class="warn-num">' + wilting.length + "</b><span>" + (wilting.length ? "wilting: " + esc(wilting.slice(0, 2).join(", ")) + (wilting.length > 2 ? "…" : "") + ", come back!" : "wilting. Everyone's blooming!") + "</span></div>";
  }
  F.on("view:garden", renderGarden);
  // live: when anyone in the circle starts or finishes studying, the open leaderboard / garden updates by itself
  let liveT = null;
  F.on("rt:session", () => {
    if (S.view !== "board" && S.view !== "garden") return;
    clearTimeout(liveT);
    liveT = setTimeout(() => { statsAt = 0; if (S.view === "board") renderBoard(); else if (S.view === "garden") renderGarden(); }, 2500);
  });
})();
