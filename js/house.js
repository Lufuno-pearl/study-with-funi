/* My House: a private space for your inner circle. Files, notes and exam dates are shared both ways and update live. */
(function () {
  "use strict";
  const F = window.Funi, $ = F.$, esc = F.esc, S = F.s;
  const BUCKET = "house-files", MAX_FILE = 10 * 1024 * 1024;
  const EMOJIS = ["🏠", "🏡", "🏰", "👑", "🦁", "⚽", "📚", "🔥", "💜", "🌙"];
  const profiles = () => F.profiles || {};
  const me = () => (F.me ? F.me.id : "");
  const nameOf = (id) => (id === me() ? "You" : profiles()[id] ? F.nameOf(profiles()[id]) : "Someone");
  const ago = (iso) => (iso ? F.timeAgo(iso) : "");
  const sameCode = (a, b) => String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase();

  S.houses = []; S.houseInvites = [];
  let cur = null, members = [], files = [], notes = [], activity = [], chan = null, missing = false;
  let seg = "files", folder = "All", noteId = null, emoji = "🏠";

  async function needProfiles(ids) {
    const miss = [...new Set(ids)].filter((id) => id && !profiles()[id]);
    if (!miss.length) return;
    const { data } = await F.sb.from("study_profiles").select("*").in("id", miss);
    (data || []).forEach((p) => { profiles()[p.id] = p; });
  }
  async function logActivity(what) {
    if (!cur) return;
    const row = { house_id: cur.id, user_id: me(), what: what.slice(0, 200) };
    const { data } = await F.sb.from("house_activity").insert(row).select().single();
    if (data && !activity.some((a) => a.id === data.id)) { activity.unshift(data); if (seg === "activity") renderActivity(); }
  }

  /* ---------- which houses am I in? ---------- */
  async function loadHouses() {
    if (!F.sb || !F.me) return;
    const { data: mine, error } = await F.sb.from("house_members").select("*").eq("user_id", me());
    missing = !!error && !F.looksOffline(error);
    if (error) { renderCard(); return; }
    const ids = (mine || []).map((m) => m.house_id);
    let houses = [];
    if (ids.length) { const r = await F.sb.from("houses").select("*").in("id", ids); houses = r.data || []; }
    S.houses = houses.filter((h) => (mine || []).some((m) => m.house_id === h.id && m.status === "joined"));
    S.houseInvites = (mine || []).filter((m) => m.status === "invited").map((m) => Object.assign({ house: houses.find((h) => h.id === m.house_id) }, m)).filter((x) => x.house);
    await needProfiles(S.houseInvites.map((x) => x.invited_by));
    renderCard();
    F.emit("houses");
  }
  F.loadHouses = loadHouses;
  function renderCard() {
    const h = S.houses[0], n = S.houseInvites.length;
    $("houseCardName").textContent = h ? h.emoji + " " + h.name : "My House";
    $("houseCardSub").textContent = n ? n + " house invite" + (n === 1 ? "" : "s") + " waiting for you"
      : h ? "Files, notes and exam dates shared with your inner circle" : "Make a house for your inner circle: everything shared both ways";
  }

  /* ---------- the house page ---------- */
  async function openHouse(id) {
    if (!F.sb || !F.me) return;
    await loadHouses();
    if (missing) {
      $("hsStart").hidden = true; $("hsBody").hidden = true; $("hsSettings").hidden = true; $("hsSwitch").hidden = true;
      $("hsInvites").innerHTML = '<div class="empty"><b>Houses aren\'t switched on yet</b><span>Run funi-v12-setup.sql in Supabase, then come back.</span></div>';
      return;
    }
    renderInvites();
    const h = S.houses.find((x) => x.id === id) || (cur && S.houses.find((x) => x.id === cur.id)) || S.houses[0] || null;
    renderSwitch(h);
    if (!h) { stopLive(); cur = null; showStart(); return; }
    if (!cur || cur.id !== h.id) { folder = "All"; noteId = null; }
    cur = h;
    $("hsStart").hidden = true; $("hsBody").hidden = false; $("hsSettings").hidden = false;
    $("hsTitle").textContent = h.emoji + " " + h.name; $("hsSub").textContent = "Your inner circle · everything here is shared";
    await Promise.all([loadMembers(), loadFiles(), loadNotes(), loadActivity()]);
    startLive();
    renderAll();
  }
  function showStart() {
    $("hsTitle").textContent = "My House"; $("hsSub").textContent = "Your inner circle";
    $("hsBody").hidden = true; $("hsSettings").hidden = true; $("hsStart").hidden = false;
    $("hsEmoji").innerHTML = EMOJIS.map((e) => '<button type="button" class="emoji-btn" data-emoji="' + e + '" aria-pressed="' + (e === emoji) + '" aria-label="' + e + '">' + e + "</button>").join("");
  }
  function renderSwitch(h) {
    const many = S.houses.length > 1;
    $("hsSwitch").hidden = !many;
    if (many) $("hsSwitch").innerHTML = S.houses.map((x) => '<button type="button" role="tab" class="chip' + (h && x.id === h.id ? " on" : "") + '" aria-selected="' + !!(h && x.id === h.id) + '" data-house="' + esc(x.id) + '">' + esc(x.emoji + " " + x.name) + "</button>").join("") +
      (S.houses.filter((x) => x.owner_id === me()).length < 3 ? '<button type="button" class="chip" data-house-new>+ New house</button>' : "");
  }
  function renderInvites() {
    $("hsInvites").innerHTML = S.houseInvites.map((i) =>
      '<div class="card hs-invite"><span class="hc-ic">' + esc(i.house.emoji) + '</span><span class="grow"><b>' + esc(nameOf(i.invited_by)) + " invited you to " + esc(i.house.name) + "</b><span>Files, notes and exam dates you add there are shared with everyone in the house.</span></span>" +
      '<span class="person-actions"><button type="button" class="btn primary small" data-hjoin="' + esc(i.house_id) + '">Join</button><button type="button" class="btn ghost small" data-hdecline="' + esc(i.house_id) + '">No thanks</button></span></div>').join("");
  }
  async function loadMembers() {
    const { data } = await F.sb.from("house_members").select("*").eq("house_id", cur.id);
    members = data || [];
    await needProfiles(members.map((m) => m.user_id));
  }
  async function loadFiles() {
    const { data } = await F.sb.from("house_files").select("*").eq("house_id", cur.id).order("updated_at", { ascending: false });
    files = data || [];
    await needProfiles(files.map((f) => f.updated_by || f.added_by));
  }
  async function loadNotes() {
    const { data } = await F.sb.from("house_notes").select("*").eq("house_id", cur.id).order("created_at", { ascending: true });
    notes = data || [];
  }
  async function loadActivity() {
    const { data } = await F.sb.from("house_activity").select("*").eq("house_id", cur.id).order("created_at", { ascending: false }).limit(40);
    activity = data || [];
    await needProfiles(activity.map((a) => a.user_id));
  }
  function renderAll() { renderPeople(); renderSeg(); renderFiles(); renderNotes(); renderActivity(); if (seg === "exams") renderExams(); }
  function renderPeople() {
    const joined = members.filter((m) => m.status === "joined");
    $("hsAvas").innerHTML = joined.slice(0, 5).map((m) => '<span class="ava sm">' + F.avatar(profiles()[m.user_id] || { id: m.user_id }) + "</span>").join("");
    const invited = members.length - joined.length;
    $("hsPeopleTxt").textContent = joined.length + " in the house" + (invited ? " · " + invited + " invited" : "");
  }
  function renderSeg() {
    document.querySelectorAll("#hsSeg [data-hseg]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.hseg === seg)));
    ["files", "notes", "exams", "activity"].forEach((k) => { $("hs" + k[0].toUpperCase() + k.slice(1)).hidden = k !== seg; });
  }

  /* ---------- files ---------- */
  function folderList() {
    const out = [];
    (F.orderedModules ? F.orderedModules() : []).forEach((m) => { const c = m.code.trim().toUpperCase(); if (!out.includes(c)) out.push(c); });
    files.forEach((f) => { if (!out.some((x) => sameCode(x, f.folder))) out.push(f.folder); });
    if (!out.includes("Shared stuff")) out.push("Shared stuff");
    return out;
  }
  function fileRow(f) {
    const [k, cls] = F.fileKind(f);
    const who = nameOf(f.updated_by || f.added_by);
    const isNew = f.added_by !== me() && Date.now() - new Date(f.created_at).getTime() < 2 * 864e5 && f.version === 1;
    const badge = isNew ? '<span class="pill mint">New</span>' : f.version > 1 ? '<span class="pill butter">v' + f.version + "</span>" : "";
    const meta = (folder === "All" ? f.folder + " · " : "") + (f.kind === "link" ? "Link" : F.sizeTxt(+f.size || 0)) + " · " + who + " · " + ago(f.updated_at);
    const inner = '<span class="file-ic ' + cls + '">' + k + '</span><span class="file-txt"><b>' + esc(f.name) + "</b><span>" + esc(meta) + "</span></span>";
    const open = f.kind === "link"
      ? '<a class="file-open" href="' + esc(f.url) + '" target="_blank" rel="noopener">' + inner + "</a>"
      : '<button type="button" class="file-open" data-hopen="' + esc(f.id) + '">' + inner + "</button>";
    return '<div class="file-row">' + open + badge +
      (f.kind === "file" ? '<button type="button" class="icon-btn" data-hreplace="' + esc(f.id) + '" aria-label="Upload a new version of ' + esc(f.name) + '"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/></svg></button>' : "") +
      '<button type="button" class="icon-btn" data-hdel="' + esc(f.id) + '" aria-label="Delete ' + esc(f.name) + '"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg></button></div>';
  }
  function renderFiles() {
    if (!cur) return;
    const fl = folderList();
    if (folder !== "All" && !fl.includes(folder)) folder = "All";
    $("hsFolders").innerHTML = ["All"].concat(fl).map((c) => {
      const n = c === "All" ? files.length : files.filter((f) => sameCode(f.folder, c)).length;
      return '<button type="button" role="tab" class="chip' + (folder === c ? " on" : "") + '" aria-selected="' + (folder === c) + '" data-hfolder="' + esc(c) + '">' + esc(c) + (n ? " · " + n : "") + "</button>";
    }).join("");
    const list = files.filter((f) => folder === "All" || sameCode(f.folder, folder));
    $("hsFileList").innerHTML = list.length ? list.map(fileRow).join("")
      : '<div class="empty"><b>' + (files.length ? "Nothing in " + esc(folder) + " yet" : "Nothing in the house yet") + "</b><span>Add past papers, notes, photos of the board or links. Everyone in the house gets them straight away.</span></div>";
  }

  /* ---------- notes ---------- */
  let saveTimer = null, dirty = false, lastSaved = {}, lastLog = {}, typingAt = 0, remoteWaiting = null;
  const typing = {};
  function curNote() { return notes.find((n) => n.id === noteId) || null; }
  function renderNotes() {
    if (!cur) return;
    if (!curNote()) noteId = notes[0] ? notes[0].id : null;
    $("hsNoteTabs").innerHTML = notes.map((n) => '<button type="button" class="chip' + (n.id === noteId ? " on" : "") + '" data-hnote="' + esc(n.id) + '">📝 ' + esc(n.title) + "</button>").join("") +
      '<button type="button" class="chip" data-hnote-new>+ New note</button>';
    const n = curNote();
    $("hsNoteCard").hidden = !n;
    if (!n) return;
    if (!dirty || document.activeElement !== $("hsNoteBody") && document.activeElement !== $("hsNoteTitle")) {
      $("hsNoteTitle").value = n.title; $("hsNoteBody").value = n.body; dirty = false;
    }
    noteState();
  }
  function noteState() {
    const n = curNote(); if (!n) return;
    const who = Object.keys(typing).filter((id) => id !== me() && Date.now() - typing[id] < 4000);
    $("hsNoteState").textContent = who.length ? who.map(nameOf).join(" and ") + (who.length === 1 ? " is" : " are") + " typing…"
      : remoteWaiting ? nameOf(remoteWaiting.updated_by) + " changed this note. It updates when you pause."
      : dirty ? "Saving…" : "Saved · last change by " + nameOf(n.updated_by) + " " + ago(n.updated_at);
  }
  setInterval(() => { if (S.view === "house" && seg === "notes") noteState(); }, 2000);
  function onNoteInput() {
    dirty = true; noteState();
    if (Date.now() - typingAt > 1500 && chan) { typingAt = Date.now(); chan.send({ type: "broadcast", event: "typing", payload: { id: me(), note: noteId } }); }
    clearTimeout(saveTimer); saveTimer = setTimeout(saveNote, 900);
  }
  async function saveNote() {
    const n = curNote(); if (!n) return;
    const title = $("hsNoteTitle").value.trim().slice(0, 60) || "Notes", body = $("hsNoteBody").value.slice(0, 20000);
    if (lastSaved[n.id] === title + "\u0000" + body) { dirty = false; noteState(); return; }
    const { data, error } = await F.sb.from("house_notes").update({ title, body }).eq("id", n.id).select().single();
    if (error) { $("hsNoteState").textContent = F.looksOffline(error) ? "You're offline. Your text stays here; it saves when you're back online." : "Couldn't save: " + error.message; return; }
    lastSaved[n.id] = title + "\u0000" + body;
    Object.assign(n, data || { title, body, updated_at: new Date().toISOString(), updated_by: me() });
    dirty = false; remoteWaiting = null;
    if (!lastLog[n.id] || Date.now() - lastLog[n.id] > 10 * 60000) { lastLog[n.id] = Date.now(); logActivity("edited " + n.title); }
    $("hsNoteTabs").querySelectorAll("[data-hnote]").forEach((b) => { if (b.dataset.hnote === n.id) b.textContent = "📝 " + n.title; });
    noteState();
  }
  $("hsNoteBody").addEventListener("input", onNoteInput);
  $("hsNoteTitle").addEventListener("input", onNoteInput);
  const flushRemote = () => { if (!dirty && remoteWaiting) { const r = remoteWaiting; remoteWaiting = null; applyNote(r); } };
  $("hsNoteBody").addEventListener("blur", () => setTimeout(flushRemote, 1200));
  function applyNote(row) {
    const i = notes.findIndex((n) => n.id === row.id);
    if (i < 0) notes.push(row); else notes[i] = Object.assign(notes[i], row);
    if (row.id === noteId && dirty) { remoteWaiting = row; noteState(); return; }
    renderNotes();
  }

  /* ---------- exams and activity ---------- */
  async function renderExams() {
    if (!cur) return;
    $("hsExams").innerHTML = '<p class="status-line">Loading…</p>';
    const { data, error } = await F.sb.rpc("funi_house_exams", { h: cur.id });
    if (error) { $("hsExams").innerHTML = '<div class="empty"><b>Couldn\'t load exams</b><span>' + esc(F.looksOffline(error) ? "You're offline." : error.message) + "</span></div>"; return; }
    const rows = data || [];
    await needProfiles(rows.map((r) => r.user_id));
    if (!rows.length) { $("hsExams").innerHTML = '<div class="empty"><b>No upcoming tests or exams</b><span>When anyone in the house adds a test or exam in Funi, it shows here for everyone.</span></div>'; return; }
    const by = {};
    rows.forEach((r) => { const k = r.module + "|" + r.kind + "|" + r.due_date + "|" + (r.start_time || ""); (by[k] = by[k] || Object.assign({ who: [] }, r)).who.push(r.user_id); if (!by[k].venue && r.venue) by[k].venue = r.venue; });
    $("hsExams").innerHTML = '<p class="hint">Everyone\'s upcoming tests and exams. Same exam? You\'re in it together.</p>' + Object.values(by).map((x) => {
      const d = F.daysLeft(x.due_date);
      return '<div class="item"><div class="txt"><b>' + esc(x.module) + " · " + esc(x.kind) + "</b><span>" + F.niceDate(x.due_date) + (x.start_time ? " · " + F.niceTime(x.start_time) : "") + (x.venue ? " · " + esc(x.venue) : "") +
        "</span><span>" + esc(x.who.map(nameOf).join(", ")) + '</span></div><span class="chip-d ' + (d <= 7 ? "soon" : d <= 21 ? "mid" : "far") + '">' + (d === 0 ? "Today" : d + " d") + "</span></div>";
    }).join("");
  }
  function renderActivity() {
    if (!cur) return;
    $("hsActivity").innerHTML = activity.length ? '<div class="card stack">' + activity.map((a) =>
      '<div class="act-row"><span class="ava sm">' + F.avatar(profiles()[a.user_id] || { id: a.user_id }) + '</span><span class="grow"><b>' + esc(nameOf(a.user_id)) + "</b> " + esc(a.what) + '</span><time>' + esc(ago(a.created_at)) + "</time></div>").join("") + "</div>"
      : '<div class="empty"><b>Nothing yet</b><span>When someone adds a file, edits a note or joins, it shows here.</span></div>';
  }

  /* ---------- live: changes from the others ---------- */
  function stopLive() { if (chan) { try { F.sb.removeChannel(chan); } catch (e) {} chan = null; } }
  function startLive() {
    stopLive();
    const id = cur.id, filter = "house_id=eq." + id;
    const upsert = (list, row) => { const i = list.findIndex((x) => x.id === row.id); if (i < 0) list.unshift(row); else list[i] = row; };
    chan = F.sb.channel("house-" + id)
      .on("postgres_changes", { event: "*", schema: "public", table: "house_files", filter }, async (p) => {
        if (p.eventType === "DELETE") files = files.filter((f) => f.id !== (p.old && p.old.id));
        else { await needProfiles([p.new.updated_by, p.new.added_by]); upsert(files, p.new); files.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))); }
        renderFiles();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "house_notes", filter }, (p) => {
        if (p.eventType === "DELETE") { notes = notes.filter((n) => n.id !== (p.old && p.old.id)); renderNotes(); return; }
        delete typing[p.new.updated_by];
        applyNote(p.new);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "house_activity", filter }, async (p) => {
        if (activity.some((a) => a.id === p.new.id)) return;
        await needProfiles([p.new.user_id]); activity.unshift(p.new); renderActivity();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "house_members", filter }, async () => { await loadMembers(); renderPeople(); if ($("hsPeopleSheet").open) renderPeopleSheet(); })
      .on("broadcast", { event: "typing" }, ({ payload }) => { if (payload && payload.id && payload.id !== me()) { typing[payload.id] = Date.now(); if (payload.note === noteId) noteState(); } })
      .subscribe();
  }

  /* ---------- create, join, invite, leave ---------- */
  $("hsEmoji").addEventListener("click", (e) => { const b = e.target.closest("[data-emoji]"); if (!b) return; emoji = b.dataset.emoji; showStart(); });
  $("hsCreateForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("hsName").value.trim().slice(0, 40) || ((F.nameOf(S.profile || {}) || "My") + "'s house");
    F.showError("hsError", ""); $("hsCreate").disabled = true;
    const { data, error } = await F.sb.from("houses").insert({ owner_id: me(), name, emoji }).select().single();
    $("hsCreate").disabled = false;
    if (error) return F.showError("hsError", F.looksOffline(error) ? "You're offline. Making a house needs internet." : /3 houses/.test(error.message) ? "You can have up to 3 houses." : "Couldn't make the house: " + error.message);
    $("hsName").value = "";
    cur = data;
    await openHouse(data.id);
    await logActivity("made the house 🏠");
    openPeopleSheet();
    F.toast("Your house is ready. Invite your people!");
  });
  document.addEventListener("click", async (e) => {
    const t = e.target;
    const j = t.closest("[data-hjoin]");
    if (j) {
      const id = j.dataset.hjoin; j.disabled = true;
      const { error } = await F.sb.from("house_members").update({ status: "joined" }).eq("house_id", id).eq("user_id", me());
      if (error) { j.disabled = false; return F.toast("Couldn't join: " + error.message, { long: true }); }
      cur = { id };
      await openHouse(id); await logActivity("joined the house 🏠");
      F.toast("Welcome to the house! 🏠"); return;
    }
    const d = t.closest("[data-hdecline]");
    if (d) { await F.sb.from("house_members").delete().eq("house_id", d.dataset.hdecline).eq("user_id", me()); await openHouse(cur && cur.id); return; }
    const sw = t.closest("[data-house]");
    if (sw) { openHouse(sw.dataset.house); return; }
    if (t.closest("[data-house-new]")) { stopLive(); cur = null; renderSwitch(null); showStart(); $("hsName").focus(); return; }
    const fo = t.closest("[data-hfolder]");
    if (fo) { folder = fo.dataset.hfolder; renderFiles(); return; }
    const op = t.closest("[data-hopen]");
    if (op) { const f = files.find((x) => x.id === op.dataset.hopen); if (f) F.openFile(Object.assign({ bucket: BUCKET }, f)); return; }
    const rp = t.closest("[data-hreplace]");
    if (rp) { replacing = files.find((x) => x.id === rp.dataset.hreplace); if (replacing) $("hsReplaceInput").click(); return; }
    const dl = t.closest("[data-hdel]");
    if (dl) {
      const f = files.find((x) => x.id === dl.dataset.hdel); if (!f) return;
      if (!(await F.confirm("Delete " + f.name + "?", "It's removed for everyone in the house.", "Delete"))) return;
      if (f.kind === "file") await F.sb.storage.from(BUCKET).remove([f.path]);
      const { error } = await F.sb.from("house_files").delete().eq("id", f.id);
      if (error) return F.toast("Couldn't delete: " + error.message, { long: true });
      files = files.filter((x) => x.id !== f.id); renderFiles(); logActivity("deleted " + f.name); return;
    }
    const nt = t.closest("[data-hnote]");
    if (nt) { if (dirty) await saveNote(); noteId = nt.dataset.hnote; dirty = false; remoteWaiting = null; renderNotes(); return; }
    if (t.closest("[data-hnote-new]")) {
      const { data, error } = await F.sb.from("house_notes").insert({ house_id: cur.id, title: "New note", body: "" }).select().single();
      if (error) return F.toast("Couldn't add a note: " + error.message, { long: true });
      if (!notes.some((n) => n.id === data.id)) notes.push(data);
      noteId = data.id; dirty = false; renderNotes(); $("hsNoteTitle").select(); return;
    }
    const inv = t.closest("[data-hinvite]");
    if (inv) {
      inv.disabled = true;
      const { error } = await F.sb.from("house_members").insert({ house_id: cur.id, user_id: inv.dataset.hinvite, invited_by: me(), role: "member", status: "invited" });
      if (error) { inv.disabled = false; return F.toast(/12 people/.test(error.message) ? "A house can have up to 12 people." : "Couldn't invite: " + error.message, { long: true }); }
      logActivity("invited " + nameOf(inv.dataset.hinvite));
      await loadMembers(); renderPeople(); renderPeopleSheet(); F.toast("Invite sent to " + nameOf(inv.dataset.hinvite) + "."); return;
    }
    const rm = t.closest("[data-hremove]");
    if (rm) {
      const uid = rm.dataset.hremove, m = members.find((x) => x.user_id === uid);
      if (!(await F.confirm(m && m.status === "invited" ? "Cancel the invite to " + nameOf(uid) + "?" : "Remove " + nameOf(uid) + " from the house?", "They won't see the house's files and notes any more.", "Remove"))) return;
      const { error } = await F.sb.from("house_members").delete().eq("house_id", cur.id).eq("user_id", uid);
      if (error) return F.toast("Couldn't remove: " + error.message, { long: true });
      await loadMembers(); renderPeople(); renderPeopleSheet(); return;
    }
  });
  document.querySelectorAll("#hsSeg [data-hseg]").forEach((b) => b.addEventListener("click", () => { seg = b.dataset.hseg; renderSeg(); if (seg === "exams") renderExams(); if (seg === "notes") renderNotes(); if (seg === "activity") renderActivity(); if (seg === "files") renderFiles(); }));
  $("hsNoteDel").onclick = async () => {
    const n = curNote(); if (!n) return;
    if (!(await F.confirm("Delete " + n.title + "?", "It's deleted for everyone in the house.", "Delete"))) return;
    const { error } = await F.sb.from("house_notes").delete().eq("id", n.id);
    if (error) return F.toast("Couldn't delete: " + error.message, { long: true });
    notes = notes.filter((x) => x.id !== n.id); noteId = null; dirty = false; renderNotes();
  };

  /* ---------- people sheet ---------- */
  function openPeopleSheet() { renderPeopleSheet(); $("hsPeopleSheet").showModal(); }
  function renderPeopleSheet() {
    if (!cur) return;
    const owner = cur.owner_id === me();
    $("hsMemberList").innerHTML = members.slice().sort((a, b) => (a.role === "owner" ? -1 : 0) - (b.role === "owner" ? -1 : 0) || (a.status === "joined" ? -1 : 1) - (b.status === "joined" ? -1 : 1)).map((m) =>
      '<div class="pick-row"><span class="ava sm">' + F.avatar(profiles()[m.user_id] || { id: m.user_id }) + '</span><span class="grow"><b>' + esc(nameOf(m.user_id)) + "</b><span>" +
      (m.role === "owner" ? "Made the house" : m.status === "invited" ? "Invited · waiting" : "In the house") + "</span></span>" +
      ((owner && m.user_id !== me()) || (m.status === "invited" && m.invited_by === me()) ? '<button type="button" class="btn ghost small" data-hremove="' + esc(m.user_id) + '">' + (m.status === "invited" ? "Cancel" : "Remove") + "</button>" : "") + "</div>").join("");
    const inIds = new Set(members.map((m) => m.user_id));
    const partners = (S.partners || []).filter((p) => !inIds.has(p.id));
    $("hsInviteList").innerHTML = partners.length ? partners.map((p) =>
      '<div class="pick-row"><span class="ava sm">' + F.avatar(profiles()[p.id] || { id: p.id }) + '</span><span class="grow"><b>' + esc(nameOf(p.id)) + '</b><span>@' + esc((profiles()[p.id] || {}).username || "") + '</span></span><button type="button" class="btn primary small" data-hinvite="' + esc(p.id) + '">Invite</button></div>').join("")
      : '<p class="hint">' + ((S.partners || []).length ? "All your study partners are already here or invited." : "Add study partners first, then invite them here.") + "</p>";
    $("hsOwnerBox").hidden = !owner;
    $("hsLeave").hidden = owner;
    $("hsFcOn").checked = !!cur.fc_on; $("hsFcName").value = cur.fc_name || ""; $("hsFcName").placeholder = "Team name, e.g. " + cur.name;
    $("hsRename").value = cur.name;
  }
  $("hsPeople").onclick = openPeopleSheet;
  $("hsSettings").onclick = openPeopleSheet;
  async function updateHouse(patch, msg) {
    const { data, error } = await F.sb.from("houses").update(patch).eq("id", cur.id).select().single();
    if (error) return F.toast("Couldn't save: " + error.message, { long: true }), false;
    Object.assign(cur, data); const i = S.houses.findIndex((h) => h.id === cur.id); if (i >= 0) S.houses[i] = cur;
    $("hsTitle").textContent = cur.emoji + " " + cur.name; renderCard(); renderSwitch(cur); F.emit("houses");
    if (msg) F.toast(msg);
    return true;
  }
  $("hsRenameSave").onclick = () => { const n = $("hsRename").value.trim().slice(0, 40); if (n) updateHouse({ name: n }, "Renamed."); };
  $("hsFcOn").onchange = () => updateHouse({ fc_on: $("hsFcOn").checked }, $("hsFcOn").checked ? "Your house is in Study FC! ⚽ Matches start on Monday." : "Your house left Study FC.");
  $("hsFcSave").onclick = () => { const n = $("hsFcName").value.trim().slice(0, 30); updateHouse({ fc_name: n || null }, "Team name saved."); };
  $("hsDelete").onclick = async () => {
    if (!(await F.confirm("Delete " + cur.name + "?", "All its files, notes and activity are deleted for everyone. This can't be undone.", "Delete house"))) return;
    const paths = files.filter((f) => f.kind === "file").map((f) => f.path);
    if (paths.length) await F.sb.storage.from(BUCKET).remove(paths);
    const { error } = await F.sb.from("houses").delete().eq("id", cur.id);
    if (error) return F.toast("Couldn't delete: " + error.message, { long: true });
    $("hsPeopleSheet").close(); stopLive(); cur = null; await openHouse(null); F.toast("House deleted.");
  };
  $("hsLeave").onclick = async () => {
    if (!(await F.confirm("Leave " + cur.name + "?", "You won't see its files and notes any more. Files you added stay for the others.", "Leave"))) return;
    const { error } = await F.sb.from("house_members").delete().eq("house_id", cur.id).eq("user_id", me());
    if (error) return F.toast("Couldn't leave: " + error.message, { long: true });
    await logActivity("left the house").catch(() => {});
    $("hsPeopleSheet").close(); stopLive(); cur = null; await openHouse(null);
  };

  /* ---------- add to the house ---------- */
  let addMode = null, picked = null, pickedMine = null, replacing = null;
  const replaceInput = document.createElement("input"); replaceInput.type = "file"; replaceInput.id = "hsReplaceInput"; replaceInput.hidden = true; document.body.appendChild(replaceInput);
  function setAddMode(m) {
    addMode = m;
    document.querySelectorAll("[data-hadd]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hadd === m)));
    $("hsUrlBox").hidden = m !== "link";
    $("hsMineList").hidden = m !== "mine";
    $("hsPicked").hidden = !(m === "upload" && picked) && !(m === "mine" && pickedMine);
    $("hsMetaBox").hidden = !(m === "link" || (m === "upload" && picked) || (m === "mine" && pickedMine));
    if (m === "mine") renderMine();
  }
  function renderMine() {
    const mine = (S.files || []);
    $("hsMineList").innerHTML = mine.length ? mine.slice(0, 40).map((f) => { const [k, cls] = F.fileKind(f);
      return '<button type="button" class="pick-row as-btn' + (pickedMine && pickedMine.id === f.id ? " on" : "") + '" data-hmine="' + esc(f.id) + '"><span class="file-ic ' + cls + '">' + k + '</span><span class="grow"><b>' + esc(f.name) + "</b><span>" + esc(f.module_code + " · " + f.folder) + "</span></span></button>"; }).join("")
      : '<p class="hint">Your own files are empty. Upload a file instead.</p>';
  }
  $("hsMineList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-hmine]"); if (!b) return;
    pickedMine = (S.files || []).find((f) => f.id === b.dataset.hmine); if (!pickedMine) return;
    $("hsFileName").value = pickedMine.name; selectFolder(pickedMine.module_code);
    $("hsPicked").textContent = "Copying " + pickedMine.name + " into the house"; setAddMode("mine");
  });
  function selectFolder(pref) {
    const fl = folderList();
    $("hsFolder").innerHTML = fl.map((c) => '<option value="' + esc(c) + '">' + esc(c) + "</option>").join("");
    const want = pref && fl.find((c) => sameCode(c, pref)) || (folder !== "All" ? folder : "Shared stuff");
    $("hsFolder").value = want;
  }
  $("hsAddBtn").onclick = () => {
    picked = null; pickedMine = null; $("hsUrl").value = ""; $("hsFileName").value = ""; F.showError("hsAddError", "");
    selectFolder(); setAddMode(null); $("hsAddSheet").showModal();
  };
  document.querySelectorAll("[data-hadd]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.hadd === "upload") { $("hsFileInput").click(); return; }
    setAddMode(b.dataset.hadd); if (b.dataset.hadd === "link") $("hsUrl").focus();
  }));
  $("hsFileInput").onchange = () => {
    const f = $("hsFileInput").files[0]; $("hsFileInput").value = ""; if (!f) return;
    const isImg = /^image\//.test(f.type);
    if (f.size > MAX_FILE && !isImg) return F.showError("hsAddError", "That file is bigger than 10 MB. Save it in Google Drive and add the link instead.");
    F.showError("hsAddError", ""); picked = f; pickedMine = null;
    $("hsFileName").value = f.name.replace(/\.[^.]+$/, "").slice(0, 120);
    $("hsPicked").textContent = f.name + " · " + F.sizeTxt(f.size) + (isImg ? " (made smaller)" : "");
    setAddMode("upload");
  };
  async function uploadBlob(blob, name, type) {
    const ext = ((name || "").match(/\.([\w]+)$/) || [])[1] || "";
    const safe = ((name || "file").replace(/\.[^.]+$/, "").replace(/[^\w.\-]+/g, "_").slice(0, 60) || "file") + (ext ? "." + ext.toLowerCase() : "");
    const path = cur.id + "/" + Date.now() + "-" + safe;
    const up = await F.sb.storage.from(BUCKET).upload(path, blob, { contentType: type || blob.type || "application/octet-stream", upsert: false });
    if (up.error) throw new Error(up.error.message);
    if (F.offPutFile) F.offPutFile(path, blob, type);
    return path;
  }
  async function prepared(file) {
    let blob = file, type = file.type || (F.isHtmlName(file.name) ? "text/html" : "application/octet-stream"), name = file.name;
    if (/^image\//.test(type) && F.shrinkImage) { const r = await F.shrinkImage(file); blob = r.blob; if (r.ext) { type = r.type; name = name.replace(/\.[^.]+$/, "") + "." + r.ext; } }
    if (blob.size > MAX_FILE) throw new Error("That file is bigger than 10 MB. Save it in Google Drive and add the link instead.");
    return { blob, type, name };
  }
  $("hsAddForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!cur) return;
    const folderVal = $("hsFolder").value || "Shared stuff", name = $("hsFileName").value.trim().slice(0, 120);
    F.showError("hsAddError", "");
    if (!addMode) return F.showError("hsAddError", "Choose Upload file, From my files or Save a link.");
    $("hsAddSave").disabled = true;
    try {
      let row;
      if (addMode === "link") {
        let url = $("hsUrl").value.trim(); if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
        if (!/^https?:\/\/[^\s.]+\.[^\s]+/i.test(url)) throw new Error("Paste the full link, like https://drive.google.com/...");
        row = { house_id: cur.id, folder: folderVal, name: name || url.replace(/^https?:\/\//, "").slice(0, 60), kind: "link", url };
      } else if (addMode === "upload") {
        if (!picked) throw new Error("Choose a file first.");
        F.toast("Uploading " + picked.name + "…");
        const p = await prepared(picked), path = await uploadBlob(p.blob, p.name, p.type);
        row = { house_id: cur.id, folder: folderVal, name: name || p.name, kind: "file", path, mime: p.type, size: p.blob.size };
      } else {
        if (!pickedMine) throw new Error("Pick one of your files.");
        if (pickedMine.kind === "link") row = { house_id: cur.id, folder: folderVal, name: name || pickedMine.name, kind: "link", url: pickedMine.url };
        else {
          F.toast("Copying " + pickedMine.name + "…");
          const blob = await F.fileBlob(pickedMine);
          const ext = (String(pickedMine.path).match(/\.(\w+)$/) || [])[1];
          const path = await uploadBlob(blob, (pickedMine.name || "file") + (ext ? "." + ext : ""), pickedMine.mime);
          row = { house_id: cur.id, folder: folderVal, name: name || pickedMine.name, kind: "file", path, mime: pickedMine.mime || blob.type, size: blob.size };
        }
      }
      const { data, error } = await F.sb.from("house_files").insert(Object.assign({ added_by: me(), updated_by: me() }, row)).select().single();
      if (error) { if (row.path) await F.sb.storage.from(BUCKET).remove([row.path]); throw new Error(/150 MB/.test(error.message) ? "This house's 150 MB is full. Delete some files or save a link instead." : error.message); }
      if (!files.some((f) => f.id === data.id)) files.unshift(data);
      $("hsAddSheet").close(); renderFiles();
      F.toast("Added. Everyone in the house has it now.");
      logActivity("added " + data.name + " to " + data.folder);
    } catch (err) {
      F.showError("hsAddError", F.looksOffline(err) ? "You're offline. Adding files needs internet." : String(err.message || err));
    } finally { $("hsAddSave").disabled = false; }
  });
  replaceInput.onchange = async () => {
    const file = replaceInput.files[0]; replaceInput.value = ""; const f = replacing; replacing = null;
    if (!file || !f) return;
    try {
      F.toast("Uploading the new version…");
      const p = await prepared(file), path = await uploadBlob(p.blob, p.name, p.type);
      const { data, error } = await F.sb.from("house_files").update({ path, mime: p.type, size: p.blob.size }).eq("id", f.id).select().single();
      if (error) { await F.sb.storage.from(BUCKET).remove([path]); throw new Error(error.message); }
      await F.sb.storage.from(BUCKET).remove([f.path]);
      const i = files.findIndex((x) => x.id === f.id); if (i >= 0) files[i] = data;
      renderFiles(); F.toast("Updated to v" + data.version + ". Everyone has the new one.");
      logActivity("updated " + data.name + " (v" + data.version + ")");
    } catch (err) { F.toast("Couldn't update: " + (err.message || err), { long: true }); }
  };

  /* ---------- hooks ---------- */
  F.on("view:house", (id) => { seg = seg || "files"; openHouse(id || (cur && cur.id)); });
  F.on("view:partners", renderCard);
  F.on("login", loadHouses);
  F.on("resume", () => { if (S.view === "house" && cur) openHouse(cur.id); else loadHouses(); });
  F.on("rt:notification", (n) => { if (n && n.kind === "house") loadHouses(); });
  window.addEventListener("beforeunload", () => { if (dirty) saveNote(); });
  F.openHouse = openHouse;
})();
