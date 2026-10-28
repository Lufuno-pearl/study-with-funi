/* Funi calls: video calls for up to 4 people, a shared whiteboard, presenting a file (PDF or photo) that everyone
 * can write on, and screen sharing from laptops. Video goes straight between the phones (WebRTC); Supabase only
 * passes small "hello, here's how to reach me" messages, so calls use no Supabase space. */
(function () {
  "use strict";
  const F = window.Funi, $ = F.$, esc = F.esc, S = F.s;
  const MAX_PEOPLE = 4;
  const ICE = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  const COLORS = [["#2B2540", "Black"], ["#7556DC", "Purple"], ["#C23B5C", "Red"], ["#1E7A4E", "Green"], ["#3550D4", "Blue"], ["#E08A00", "Orange"]];
  const TOOLS = [["pen", "✏️", "Pen"], ["mark", "🖍️", "Highlight"], ["text", "🔤", "Type"], ["arrow", "↗️", "Arrow"], ["box", "⬜", "Box"], ["laser", "🔴", "Pointer"], ["erase", "🧽", "Erase"]];
  const profiles = () => F.profiles || {};
  const me = () => (F.me ? F.me.id : "");
  const nameOf = (id) => (id === me() ? "You" : profiles()[id] ? F.nameOf(profiles()[id]) : "A friend");
  const canShareScreen = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);

  let room = null, chan = null, joined = false, local = null, camTrack = null, micOn = true, camOn = true, hand = false;
  let screenStream = null, hb = null, sweep = null;
  const peers = {};           // uid -> { pc, polite, makingOffer, ignoreOffer, stream, state, restarted }
  const present = new Set();  // uids in the call (from presence)
  let stage = { mode: "faces", by: null, file: null, page: 1 };
  let strokes = [];           // { id, by, layer, tool, color, w, pts:[[x,y]], text }
  let tool = "pen", color = COLORS[1][0];
  const lasers = {};          // uid -> { x, y, at }

  async function needProfiles(ids) {
    const miss = [...new Set(ids)].filter((id) => id && !profiles()[id]);
    if (!miss.length) return;
    const { data } = await F.sb.from("study_profiles").select("*").in("id", miss);
    (data || []).forEach((p) => { profiles()[p.id] = p; });
  }
  const send = (payload) => { if (chan) chan.send({ type: "broadcast", event: "m", payload: Object.assign({ from: me() }, payload) }); };

  /* =====================================================================
     OPEN THE CALL PAGE (pre-join: check your camera first)
     ===================================================================== */
  async function openCall(id) {
    if (!F.sb || !F.me) return;
    if (joined && room && room.id === id) { showMain(); return; }
    if (joined && room && room.id !== id) await leave(true);
    const { data: r, error } = await F.sb.from("study_rooms").select("*").eq("id", id).maybeSingle();
    if (error || !r || r.is_open === false) { F.toast(error && F.looksOffline(error) ? "Calls need internet." : "That call has ended. Start a new one!"); F.go("rooms", { back: true }); return; }
    room = r;
    await needProfiles([r.host_id]);
    $("clTitle").textContent = (r.kind === "teach" ? "✏️ " : "🎥 ") + r.name;
    $("clSub").textContent = nameOf(r.host_id) + (r.module_code ? " · " + r.module_code : "") + (r.kind === "teach" ? " · teach session" : " · video call");
    $("clMeet").hidden = !r.meet_url;
    if (r.meet_url) { $("clMeet").href = r.meet_url; $("clMeet").textContent = "Join on " + meetName(r.meet_url); }
    $("clPre").hidden = false; $("clMain").hidden = true; $("clControls").hidden = true;
    F.showError("clPreError", "");
    await startPreview();
  }
  const meetName = (u) => /zoom\./i.test(u) ? "Zoom" : /meet\.google/i.test(u) ? "Meet" : /teams\./i.test(u) ? "Teams" : "the meeting";
  async function startPreview() {
    if (local) { showPreview(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { F.showError("clPreError", "This browser can't do video calls. Try Chrome or Safari." + (room && room.meet_url ? " Or use the meeting link above." : "")); return; }
    try {
      local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 20 }, facingMode: "user" } });
    } catch (e) {
      try { local = await navigator.mediaDevices.getUserMedia({ audio: true }); camOn = false; F.showError("clPreError", "Funi can't use your camera, so you'll join with sound only."); }
      catch (e2) { local = new MediaStream(); micOn = false; camOn = false; F.showError("clPreError", "Funi can't use your camera or mic. You can still watch, listen and use the whiteboard. To fix it, allow camera and microphone for Funi in your browser settings."); }
    }
    camTrack = local.getVideoTracks()[0] || null;
    if (!camTrack) camOn = false;
    applyTracks(); showPreview();
  }
  function showPreview() {
    $("clPreVideo").srcObject = local;
    $("clPreOff").hidden = camOn && !!camTrack;
    $("clPreMic").textContent = micOn ? "🎙️ Mic on" : "🔇 Mic off"; $("clPreMic").setAttribute("aria-pressed", String(micOn));
    $("clPreCam").textContent = camOn ? "📷 Camera on" : "🚫 Camera off"; $("clPreCam").setAttribute("aria-pressed", String(camOn));
    $("clPreMic").disabled = !local || !local.getAudioTracks().length; $("clPreCam").disabled = !camTrack;
  }
  function applyTracks() {
    if (!local) return;
    local.getAudioTracks().forEach((t) => { t.enabled = micOn; });
    if (camTrack) camTrack.enabled = camOn;
  }
  $("clPreMic").onclick = () => { micOn = !micOn; applyTracks(); showPreview(); };
  $("clPreCam").onclick = () => { camOn = !camOn; applyTracks(); showPreview(); };
  $("clJoin").onclick = () => join();

  /* =====================================================================
     JOIN: presence + signalling over Supabase Realtime
     ===================================================================== */
  async function join() {
    if (!room || joined) return;
    $("clJoin").disabled = true;
    const now = new Date().toISOString();
    await F.sb.from("study_room_members").upsert({ room_id: room.id, user_id: me(), left_at: null, last_seen: now }, { onConflict: "room_id,user_id" }).then(() => {}, () => {});
    chan = F.sb.channel("call-" + room.id, { config: { presence: { key: me() }, broadcast: { self: false } } });
    chan.on("presence", { event: "sync" }, onPresence)
      .on("broadcast", { event: "m" }, ({ payload }) => onMessage(payload))
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return;
        const state = chan.presenceState ? chan.presenceState() : {};
        const others = Object.keys(state).filter((k) => k !== me());
        if (others.length >= MAX_PEOPLE) {
          $("clJoin").disabled = false;
          F.showError("clPreError", "This call is full (" + MAX_PEOPLE + " people). " + (room.meet_url ? "Use the " + meetName(room.meet_url) + " link above." : "Ask them to add a Meet or Zoom link for bigger groups."));
          try { F.sb.removeChannel(chan); } catch (e) {} chan = null; return;
        }
        await chan.track({ at: Date.now() });
        joined = true; $("clJoin").disabled = false;
        send({ t: "hello" }); sendState();
        showMain();
      });
    hb = setInterval(() => { if (room) F.sb.from("study_room_members").update({ last_seen: new Date().toISOString() }).eq("room_id", room.id).eq("user_id", me()).then(() => {}, () => {}); }, 60000);
    sweep = setInterval(() => { renderLasers(); }, 120);
  }
  function onPresence() {
    const state = chan.presenceState ? chan.presenceState() : {};
    const ids = Object.keys(state);
    present.clear(); ids.forEach((id) => present.add(id));
    needProfiles(ids).then(renderTiles);
    ids.forEach((id) => { if (id !== me() && !peers[id]) makePeer(id); });
    Object.keys(peers).forEach((id) => { if (!present.has(id)) dropPeer(id); });
    renderTiles();
  }

  /* ---------- WebRTC with "perfect negotiation" (both sides can start, collisions sort themselves out) ---------- */
  function makePeer(uid) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const peer = peers[uid] = { pc, polite: me() > uid, makingOffer: false, ignoreOffer: false, stream: new MediaStream(), state: {}, restarted: false };
    const tracks = local ? local.getTracks() : [];
    tracks.forEach((t) => pc.addTrack(t, local));
    if (!local || !local.getAudioTracks().length) pc.addTransceiver("audio", { direction: "recvonly" });
    if (!camTrack) pc.addTransceiver("video", { direction: "recvonly" });
    pc.ontrack = (e) => { if (!peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track); e.track.onunmute = () => renderTiles(); renderTiles(); };
    pc.onicecandidate = ({ candidate }) => { if (candidate) send({ t: "ice", to: uid, c: candidate.toJSON ? candidate.toJSON() : candidate }); };
    pc.onnegotiationneeded = async () => {
      try { peer.makingOffer = true; await pc.setLocalDescription(); send({ t: "sdp", to: uid, d: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); }
      catch (e) { /* the other side will try */ } finally { peer.makingOffer = false; }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" && !peer.restarted) { peer.restarted = true; try { pc.restartIce(); } catch (e) {} }
      renderTiles();
    };
    return peer;
  }
  function dropPeer(uid) { const p = peers[uid]; if (!p) return; try { p.pc.close(); } catch (e) {} delete peers[uid]; delete lasers[uid]; delete otherStates[uid]; if (stage.by === uid && stage.mode === "screen") setStage({ mode: "faces" }, true); }
  async function onSdp(from, d) {
    const peer = peers[from] || makePeer(from), pc = peer.pc;
    const collision = d.type === "offer" && (peer.makingOffer || pc.signalingState !== "stable");
    peer.ignoreOffer = !peer.polite && collision;
    if (peer.ignoreOffer) return;
    try {
      await pc.setRemoteDescription(d);
      if (d.type === "offer") { await pc.setLocalDescription(); send({ t: "sdp", to: from, d: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }); }
    } catch (e) { /* ignore a broken offer; the next one fixes it */ }
  }
  async function onIce(from, c) { const p = peers[from]; if (!p) return; try { await p.pc.addIceCandidate(c); } catch (e) { if (!p.ignoreOffer) { /* late candidate */ } } }

  /* ---------- messages ---------- */
  function onMessage(m) {
    if (!m || !m.from || m.from === me()) return;
    if (m.to && m.to !== me()) return;
    switch (m.t) {
      case "sdp": onSdp(m.from, m.d); break;
      case "ice": onIce(m.from, m.c); break;
      case "hello": // someone joined: tell them what's on the stage and what's on the board
        sendState();
        if (iAmSyncer()) { send({ t: "stage", to: m.from, s: stage }); for (let i = 0; i < strokes.length; i += 40) send({ t: "wb-all", to: m.from, strokes: strokes.slice(i, i + 40) }); }
        break;
      case "state": otherStates[m.from] = m.s; if (peers[m.from]) peers[m.from].state = m.s; renderTiles(); break;
      case "stage": setStage(m.s, true); break;
      case "page": if (stage.file) { stage.page = m.page; drawDoc(); } break;
      case "wb-add": if (!strokes.some((s) => s.id === m.s.id)) strokes.push(m.s); dirty(); break;
      case "wb-pts": { const s = strokes.find((x) => x.id === m.id); if (s) { s.pts = s.pts.concat(m.pts); dirty(); } break; }
      case "wb-del": strokes = strokes.filter((s) => !m.ids.includes(s.id)); dirty(); break;
      case "wb-clear": strokes = strokes.filter((s) => s.layer !== m.layer); dirty(); break;
      case "wb-all": m.strokes.forEach((s) => { if (!strokes.some((x) => x.id === s.id)) strokes.push(s); }); dirty(); break;
      case "laser": lasers[m.from] = { x: m.x, y: m.y, at: Date.now() }; dirty(); break;
    }
  }
  const otherStates = {};
  // the person who has been in the call longest answers newcomers (others stay quiet)
  function iAmSyncer() {
    const state = chan && chan.presenceState ? chan.presenceState() : {};
    const at = (id) => { const x = state[id] && state[id][0]; return x && x.at ? x.at : Infinity; };
    const ids = Object.keys(state);
    if (!ids.length) return true;
    return ids.sort((a, b) => at(a) - at(b) || a.localeCompare(b))[0] === me();
  }
  function sendState() { send({ t: "state", s: { mic: micOn, cam: camOn && !!camTrack, hand } }); }

  /* =====================================================================
     SCREEN: faces, whiteboard, a file, or someone's screen
     ===================================================================== */
  function showMain() {
    $("clPre").hidden = true; $("clMain").hidden = false; $("clControls").hidden = false;
    $("ccScreen").hidden = !canShareScreen;
    renderControls(); renderTools(); setStage(stage, true); renderTiles();
  }
  function setStage(s, fromOthers) {
    const prevFile = stage.file && stage.file.url;
    stage = Object.assign({ mode: "faces", by: null, file: null, page: 1 }, s);
    if (!fromOthers) send({ t: "stage", s: stage });
    const m = stage.mode;
    $("clMain").className = "call-main mode-" + m;
    $("clSheet").hidden = !(m === "board" || m === "file");
    $("clScreen").hidden = m !== "screen";
    $("clTools").hidden = !(m === "board" || m === "file");
    $("clDocBar").hidden = m !== "file";
    $("clStageWho").textContent = m === "board" ? "Whiteboard · everyone can write" : m === "file" ? nameOf(stage.by) + (stage.by === me() ? " are" : " is") + " presenting · everyone can write on it" : m === "screen" ? (stage.by === me() ? "You're sharing your screen" : nameOf(stage.by) + " is sharing their screen") : "";
    if (m === "screen") {
      const v = $("clScreen");
      if (stage.by === me()) { v.srcObject = screenStream; v.muted = true; }
      else { const p = peers[stage.by]; v.srcObject = p ? p.stream : null; v.muted = true; }
    }
    if (m === "file" && stage.file) { if (stage.file.url !== prevFile) loadDoc(); else drawDoc(); }
    if (m === "board") { docImage = null; layout(); }
    renderControls(); renderTiles(); dirty();
  }
  function renderControls() {
    const set = (id, on, label) => { $(id).setAttribute("aria-pressed", String(on)); if (label) $(id).querySelector("b").textContent = label; };
    set("ccMic", !micOn, micOn ? "Mute" : "Unmute"); $("ccMic").querySelector("span").textContent = micOn ? "🎙️" : "🔇";
    set("ccCam", !camOn, camOn ? "Camera off" : "Camera on"); $("ccCam").querySelector("span").textContent = camOn ? "📷" : "🚫";
    $("ccMic").disabled = !local || !local.getAudioTracks().length; $("ccCam").disabled = !camTrack;
    set("ccFaces", stage.mode === "faces"); set("ccBoard", stage.mode === "board"); set("ccFile", stage.mode === "file");
    set("ccScreen", stage.mode === "screen" && stage.by === me(), stage.mode === "screen" && stage.by === me() ? "Stop sharing" : "Share screen");
    set("ccHand", hand, hand ? "Hand up" : "Hand");
  }
  function tileHtml(uid) {
    const isMe = uid === me(), p = peers[uid], st = isMe ? { mic: micOn, cam: camOn && !!camTrack, hand } : (p && p.state) || otherStates[uid] || {};
    const conn = isMe ? "connected" : p ? p.pc.connectionState : "new";
    const status = conn === "failed" ? '<span class="tile-msg">Couldn\'t connect' + (room && room.meet_url ? ". Try the " + esc(meetName(room.meet_url)) + " link" : ". Some Wi-Fi blocks calls") + "</span>"
      : conn !== "connected" && !isMe ? '<span class="tile-msg">Connecting…</span>' : "";
    return '<div class="tile' + (st.cam === false ? " cam-off" : "") + (stage.by === uid && stage.mode !== "faces" ? " presenting" : "") + '" data-tile="' + esc(uid) + '">' +
      '<video autoplay playsinline' + (isMe ? " muted" : "") + "></video>" +
      '<span class="tile-ava">' + F.avatar(profiles()[uid] || { id: uid }) + "</span>" + status +
      '<span class="tile-name">' + esc(nameOf(uid)) + (st.mic === false ? " 🔇" : "") + (st.hand ? " ✋" : "") + "</span></div>";
  }
  function renderTiles() {
    if (!joined) return;
    const ids = [me()].concat([...present].filter((id) => id !== me()));
    const box = $("clTiles");
    // keep existing <video> elements so playback doesn't restart
    const have = {}; box.querySelectorAll("[data-tile]").forEach((el) => { have[el.dataset.tile] = el; });
    ids.forEach((uid, i) => {
      const tmp = document.createElement("div"); tmp.innerHTML = tileHtml(uid); const fresh = tmp.firstChild;
      let el = have[uid];
      if (!el) { el = fresh; box.appendChild(el); }
      else { el.className = fresh.className; ["tile-msg", "tile-name"].forEach((c) => { const a = el.querySelector("." + c), b = fresh.querySelector("." + c); if (a && b) a.outerHTML = b.outerHTML; else if (a) a.remove(); else if (b) el.appendChild(b); }); }
      if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
      const v = el.querySelector("video"), src = uid === me() ? local : peers[uid] && peers[uid].stream;
      if (src && v.srcObject !== src) { v.srcObject = src; v.play().catch(() => {}); }
      delete have[uid];
    });
    Object.values(have).forEach((el) => el.remove());
    box.dataset.count = String(ids.length);
    $("clSub").textContent = ids.length + (ids.length === 1 ? " person" : " people") + " in the call" + (room && room.module_code ? " · " + room.module_code : "");
  }

  /* ---------- controls ---------- */
  $("ccMic").onclick = () => { micOn = !micOn; applyTracks(); sendState(); renderControls(); renderTiles(); };
  $("ccCam").onclick = () => { camOn = !camOn; applyTracks(); sendState(); renderControls(); renderTiles(); };
  $("ccHand").onclick = () => { hand = !hand; sendState(); renderControls(); renderTiles(); if (hand) F.toast("Your hand is up ✋"); };
  $("ccFaces").onclick = () => { if (stage.mode === "screen" && stage.by === me()) stopScreen(); setStage({ mode: "faces" }); };
  $("ccBoard").onclick = () => { if (stage.mode === "screen" && stage.by === me()) stopScreen(); setStage({ mode: "board", by: me() }); };
  $("ccFile").onclick = () => openFilePicker();
  $("ccScreen").onclick = () => (stage.mode === "screen" && stage.by === me() ? stopScreen(true) : startScreen());
  $("ccLeave").onclick = () => leave();
  $("clBack").onclick = () => { if (joined) { F.go("rooms", { back: true }); F.toast("You're still in the call. Open it from Study rooms, or tap Leave."); } else { stopPreview(); F.back(); } };

  async function startScreen() {
    if (!canShareScreen) return F.toast("Sharing your screen works on laptops and computers.");
    try { screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 8, max: 15 } }, audio: false }); }
    catch (e) { return; }
    const track = screenStream.getVideoTracks()[0];
    track.onended = () => stopScreen(true);
    Object.values(peers).forEach(({ pc }) => {
      const s = pc.getSenders().find((x) => x.track && x.track.kind === "video");
      if (s) s.replaceTrack(track); else pc.addTrack(track, screenStream);
    });
    setStage({ mode: "screen", by: me() });
  }
  function stopScreen(backToFaces) {
    if (!screenStream) return;
    const track = screenStream.getVideoTracks()[0];
    screenStream.getTracks().forEach((t) => t.stop()); screenStream = null;
    Object.values(peers).forEach(({ pc }) => {
      const s = pc.getSenders().find((x) => x.track === track);
      if (s) { if (camTrack) s.replaceTrack(camTrack); else pc.removeTrack(s); }
    });
    if (backToFaces) setStage({ mode: "faces" });
  }

  async function leave(silent) {
    if (!silent && joined && !(await F.confirm("Leave the call?", "You can join again while it's open.", "Leave"))) return;
    const id = room && room.id;
    if (screenStream) stopScreen(false);
    Object.keys(peers).forEach(dropPeer);
    if (chan) { try { await chan.untrack(); } catch (e) {} try { F.sb.removeChannel(chan); } catch (e) {} chan = null; }
    clearInterval(hb); clearInterval(sweep); hb = sweep = null;
    stopPreview();
    joined = false; present.clear(); strokes = []; stage = { mode: "faces", by: null, file: null, page: 1 }; docPdf = null; docImage = null;
    $("clTiles").innerHTML = "";
    if (id) {
      await F.sb.from("study_room_members").update({ left_at: new Date().toISOString() }).eq("room_id", id).eq("user_id", me()).then(() => {}, () => {});
      const { data } = await F.sb.from("study_room_members").select("user_id,left_at,last_seen").eq("room_id", id);
      const others = (data || []).some((m) => m.user_id !== me() && !m.left_at && Date.now() - new Date(m.last_seen).getTime() < 3 * 60000);
      if (!others) await F.sb.from("study_rooms").update({ is_open: false }).eq("id", id).then(() => {}, () => {});
    }
    room = null;
    if (!silent) F.go("rooms", { back: true });
  }
  function stopPreview() {
    if (joined) return;
    if (local) { local.getTracks().forEach((t) => t.stop()); local = null; camTrack = null; }
    micOn = true; camOn = true; hand = false;
  }
  window.addEventListener("pagehide", () => { if (joined && chan) { try { chan.untrack(); } catch (e) {} } });

  /* =====================================================================
     WHITEBOARD + FILE: drawing everyone shares
     ===================================================================== */
  const ink = $("clInk"), docCanvas = $("clDocCanvas"), paper = $("clPaper");
  let docPdf = null, docImage = null, docAspect = 1.6, needDraw = false, drawing = null, shapeStart = null, lastSend = 0, pending = [];
  const layerNow = () => (stage.mode === "file" && stage.file ? "file:" + stage.file.url.split("?")[0].slice(-40) + ":" + stage.page : "board");
  function renderTools() {
    $("clToolBtns").innerHTML = TOOLS.map((t) => '<button type="button" class="tool' + (tool === t[0] ? " on" : "") + '" data-tool="' + t[0] + '" aria-pressed="' + (tool === t[0]) + '" aria-label="' + t[2] + '"><span aria-hidden="true">' + t[1] + "</span>" + t[2] + "</button>").join("");
    $("clColors").innerHTML = COLORS.map((c) => '<button type="button" class="swatch' + (color === c[0] ? " on" : "") + '" data-color="' + c[0] + '" aria-label="' + c[1] + '" aria-pressed="' + (color === c[0]) + '" style="background:' + c[0] + '"></button>').join("");
    paper.style.cursor = tool === "text" ? "text" : tool === "laser" ? "pointer" : "crosshair";
  }
  $("clToolBtns").addEventListener("click", (e) => { const b = e.target.closest("[data-tool]"); if (b) { tool = b.dataset.tool; renderTools(); } });
  $("clColors").addEventListener("click", (e) => { const b = e.target.closest("[data-color]"); if (b) { color = b.dataset.color; if (tool === "erase" || tool === "laser") tool = "pen"; renderTools(); } });
  $("clUndo").onclick = () => { const mine = strokes.filter((s) => s.by === me() && s.layer === layerNow()); const last = mine[mine.length - 1]; if (!last) return; strokes = strokes.filter((s) => s !== last); send({ t: "wb-del", ids: [last.id] }); dirty(); };
  $("clClear").onclick = async () => { if (!(await F.confirm("Clear the board for everyone?", "Everything written on this page is removed.", "Clear"))) return; const L = layerNow(); strokes = strokes.filter((s) => s.layer !== L); send({ t: "wb-clear", layer: L }); dirty(); };

  // size the paper to fit the stage, keeping the same shape on every screen so drawings line up
  function layout(skipPaint) {
    const area = $("clArea"), W = area.clientWidth - 8, H = area.clientHeight - 8;
    if (W <= 0 || H <= 0) return;
    const aspect = stage.mode === "file" ? docAspect : 1.6;
    let w = W, h = W / aspect; if (h > H) { h = H; w = H * aspect; }
    paper.style.width = Math.floor(w) + "px"; paper.style.height = Math.floor(h) + "px";
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    [ink, docCanvas].forEach((c) => { c.width = Math.floor(w * dpr); c.height = Math.floor(h * dpr); c.style.width = Math.floor(w) + "px"; c.style.height = Math.floor(h) + "px"; });
    if (!skipPaint) paintDoc();
    dirty();
  }
  window.addEventListener("resize", () => { if (joined && (stage.mode === "board" || stage.mode === "file")) layout(); });
  function dirty() { if (!needDraw) { needDraw = true; requestAnimationFrame(draw); } }
  function draw() {
    needDraw = false;
    const c = ink.getContext("2d"), W = ink.width, H = ink.height;
    c.clearRect(0, 0, W, H);
    const L = layerNow(), unit = W / 1000;
    strokes.filter((s) => s.layer === L).concat(drawing && drawing.preview ? [drawing.preview] : []).forEach((s) => {
      c.save();
      c.strokeStyle = s.color; c.fillStyle = s.color; c.lineCap = "round"; c.lineJoin = "round";
      c.globalAlpha = s.tool === "mark" ? 0.35 : 1;
      c.lineWidth = (s.w || 3) * unit;
      const P = s.pts.map(([x, y]) => [x * W, y * H]);
      if (s.tool === "text") { c.font = "700 " + Math.round(22 * unit) + "px Nunito, system-ui, sans-serif"; c.textBaseline = "top"; c.fillText(s.text || "", P[0][0], P[0][1]); }
      else if (s.tool === "box" && P.length > 1) c.strokeRect(P[0][0], P[0][1], P[1][0] - P[0][0], P[1][1] - P[0][1]);
      else if (s.tool === "arrow" && P.length > 1) {
        const [a, b] = [P[0], P[P.length - 1]], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hl = 14 * unit;
        c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
        c.moveTo(b[0], b[1]); c.lineTo(b[0] - hl * Math.cos(ang - 0.5), b[1] - hl * Math.sin(ang - 0.5));
        c.moveTo(b[0], b[1]); c.lineTo(b[0] - hl * Math.cos(ang + 0.5), b[1] - hl * Math.sin(ang + 0.5)); c.stroke();
      } else if (P.length) {
        c.beginPath(); c.moveTo(P[0][0], P[0][1]);
        if (P.length === 1) c.lineTo(P[0][0] + 0.1, P[0][1] + 0.1);
        for (let i = 1; i < P.length; i++) { const m = [(P[i - 1][0] + P[i][0]) / 2, (P[i - 1][1] + P[i][1]) / 2]; c.quadraticCurveTo(P[i - 1][0], P[i - 1][1], m[0], m[1]); }
        c.lineTo(P[P.length - 1][0], P[P.length - 1][1]); c.stroke();
      }
      c.restore();
    });
    // laser pointers fade after a second
    Object.entries(lasers).forEach(([uid, l]) => {
      const age = Date.now() - l.at; if (age > 1200) return;
      c.save(); c.globalAlpha = 1 - age / 1200; c.fillStyle = "#FF3B5C";
      c.beginPath(); c.arc(l.x * W, l.y * H, 7 * unit * 1.4, 0, 7); c.fill();
      c.globalAlpha = (1 - age / 1200) * 0.25; c.beginPath(); c.arc(l.x * W, l.y * H, 16 * unit * 1.4, 0, 7); c.fill();
      c.font = "800 " + Math.round(12 * unit * 1.2) + "px Nunito, sans-serif"; c.globalAlpha = 1 - age / 1200; c.fillText(nameOf(uid), l.x * W + 12 * unit, l.y * H - 10 * unit);
      c.restore();
    });
  }
  function renderLasers() { if (Object.values(lasers).some((l) => Date.now() - l.at < 1300)) dirty(); }
  const at = (e) => { const r = ink.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
  const newId = () => me().slice(0, 8) + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function eraseAt(p) {
    const L = layerNow(), hit = strokes.filter((s) => s.layer === L && s.pts.some(([x, y]) => Math.hypot(x - p[0], (y - p[1]) / 1.6) < 0.02));
    if (!hit.length) return;
    const ids = hit.map((s) => s.id); strokes = strokes.filter((s) => !ids.includes(s.id)); send({ t: "wb-del", ids }); dirty();
  }
  ink.addEventListener("pointerdown", (e) => {
    if (!joined) return;
    e.preventDefault();
    const p = at(e);
    if (tool === "text") { openText(p); return; }
    try { ink.setPointerCapture(e.pointerId); } catch (x) {}
    if (tool === "erase") { drawing = { erase: true }; eraseAt(p); return; }
    if (tool === "laser") { drawing = { laser: true }; lasers[me()] = { x: p[0], y: p[1], at: Date.now() }; send({ t: "laser", x: p[0], y: p[1] }); dirty(); return; }
    if (tool === "arrow" || tool === "box") { shapeStart = p; drawing = { preview: { id: "preview", by: me(), layer: layerNow(), tool, color, w: 3, pts: [p, p] } }; dirty(); return; }
    const pen = e.pointerType === "pen" && e.pressure ? 1.5 + e.pressure * 3 : 3;
    const s = { id: newId(), by: me(), layer: layerNow(), tool, color, w: tool === "mark" ? 16 : pen, pts: [p] };
    strokes.push(s); drawing = { stroke: s }; pending = []; send({ t: "wb-add", s }); dirty();
  });
  ink.addEventListener("pointermove", (e) => {
    if (!drawing) { if (tool === "laser" && e.pointerType === "mouse" && joined && Date.now() - lastSend > 80) { const p = at(e); lastSend = Date.now(); lasers[me()] = { x: p[0], y: p[1], at: Date.now() }; send({ t: "laser", x: p[0], y: p[1] }); dirty(); } return; }
    const p = at(e);
    if (drawing.erase) { eraseAt(p); return; }
    if (drawing.laser) { lasers[me()] = { x: p[0], y: p[1], at: Date.now() }; if (Date.now() - lastSend > 70) { lastSend = Date.now(); send({ t: "laser", x: p[0], y: p[1] }); } dirty(); return; }
    if (drawing.preview) { drawing.preview.pts = [shapeStart, p]; dirty(); return; }
    const s = drawing.stroke, last = s.pts[s.pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.002) return;
    s.pts.push(p); pending.push(p); dirty();
    if (Date.now() - lastSend > 60) { lastSend = Date.now(); send({ t: "wb-pts", id: s.id, pts: pending }); pending = []; }
  });
  const endStroke = () => {
    if (!drawing) return;
    if (drawing.stroke && pending.length) send({ t: "wb-pts", id: drawing.stroke.id, pts: pending });
    if (drawing.preview) { const pv = drawing.preview; if (Math.hypot(pv.pts[1][0] - pv.pts[0][0], pv.pts[1][1] - pv.pts[0][1]) > 0.01) { const s = Object.assign({}, pv, { id: newId() }); strokes.push(s); send({ t: "wb-add", s }); } }
    drawing = null; pending = []; shapeStart = null; dirty();
  };
  ink.addEventListener("pointerup", endStroke); ink.addEventListener("pointercancel", endStroke);
  // typing on the board (works with any computer, no pen needed)
  let textAt = null;
  function openText(p) {
    textAt = p; const inp = $("clTextInput");
    inp.style.left = (p[0] * 100) + "%"; inp.style.top = (p[1] * 100) + "%"; inp.style.color = color;
    inp.value = ""; inp.hidden = false; inp.focus(); requestAnimationFrame(() => inp.focus());
  }
  function commitText() {
    const inp = $("clTextInput"), txt = inp.value.trim(); inp.hidden = true;
    if (!txt || !textAt) return;
    const s = { id: newId(), by: me(), layer: layerNow(), tool: "text", color, w: 3, pts: [textAt], text: txt.slice(0, 120) };
    strokes.push(s); send({ t: "wb-add", s }); textAt = null; dirty();
  }
  $("clTextInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commitText(); } if (e.key === "Escape") { $("clTextInput").hidden = true; textAt = null; } });
  $("clTextInput").addEventListener("blur", commitText);

  // save the board (or the page you wrote on) as a picture in My files
  $("clSaveBoard").onclick = async () => {
    const c = document.createElement("canvas"); c.width = ink.width; c.height = ink.height;
    const x = c.getContext("2d"); x.fillStyle = "#FFFFFF"; x.fillRect(0, 0, c.width, c.height);
    if (stage.mode === "file") x.drawImage(docCanvas, 0, 0); x.drawImage(ink, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    if (!blob) return;
    const code = (room && room.module_code) || "Calls", path = me() + "/" + code.replace(/[^\w\-]+/g, "_") + "/" + Date.now() + "-whiteboard.png";
    const name = (stage.mode === "file" && stage.file ? stage.file.name + " p" + stage.page : "Whiteboard") + " · " + new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" });
    const up = await F.sb.storage.from("module-files").upload(path, blob, { contentType: "image/png", upsert: false });
    if (up.error) return F.toast("Couldn't save: " + up.error.message, { long: true });
    const { data, error } = await F.sb.from("module_files").insert({ user_id: me(), module_code: code, folder: "Notes", name: name.slice(0, 120), kind: "file", path, mime: "image/png", size: blob.size }).select().single();
    if (error) { await F.sb.storage.from("module-files").remove([path]); return F.toast("Couldn't save: " + error.message, { long: true }); }
    if (S.files && data) S.files.unshift(data);
    F.toast("Saved to My files › " + code + " › Notes.");
  };

  /* ---------- presenting a file ---------- */
  function openFilePicker() {
    const mine = (S.files || []).filter((f) => f.kind === "file" && /pdf|image\//i.test((f.mime || "") + " " + f.path) || (f.kind === "file" && /\.(pdf|jpe?g|png|webp)$/i.test(f.path || "")));
    $("clMyFiles").innerHTML = mine.length ? '<span class="label" style="margin:6px 0 0">From my files</span>' + mine.slice(0, 40).map((f) => { const [k, cls] = F.fileKind(f);
      return '<button type="button" class="pick-row as-btn" data-present="' + esc(f.id) + '"><span class="file-ic ' + cls + '">' + k + '</span><span class="grow"><b>' + esc(f.name) + "</b><span>" + esc(f.module_code + " · " + f.folder) + "</span></span></button>"; }).join("")
      : '<p class="hint">No PDFs or photos in My files yet. Upload one from this device.</p>';
    $("clFileSheet").showModal();
  }
  $("clMyFiles").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-present]"); if (!b) return;
    const f = (S.files || []).find((x) => x.id === b.dataset.present); if (!f) return;
    $("clFileSheet").close(); presentStored(f.path, f.name, f.mime);
  });
  $("clUpload").onclick = () => $("clUploadInput").click();
  $("clUploadInput").onchange = async () => {
    const file = $("clUploadInput").files[0]; $("clUploadInput").value = ""; if (!file) return;
    if (file.size > 10 * 1024 * 1024) return F.toast("That file is bigger than 10 MB.");
    $("clFileSheet").close(); F.toast("Uploading " + file.name + "…");
    let blob = file, type = file.type || "application/pdf";
    if (/^image\//.test(type) && F.shrinkImage) { const r = await F.shrinkImage(file); blob = r.blob; if (r.ext) type = r.type; }
    // it's kept in your files too, so you have it after the call
    const code = (room && room.module_code) || "Calls", ext = /pdf/.test(type) ? "pdf" : /png/.test(type) ? "png" : "jpg";
    const path = me() + "/" + code.replace(/[^\w\-]+/g, "_") + "/" + Date.now() + "-" + (file.name.replace(/\.[^.]+$/, "").replace(/[^\w.\-]+/g, "_").slice(0, 50) || "file") + "." + ext;
    const up = await F.sb.storage.from("module-files").upload(path, blob, { contentType: type, upsert: false });
    if (up.error) return F.toast("Couldn't upload: " + up.error.message, { long: true });
    const { data, error } = await F.sb.from("module_files").insert({ user_id: me(), module_code: code, folder: /pdf/.test(type) ? "Past papers" : "Photos", name: file.name.replace(/\.[^.]+$/, "").slice(0, 120), kind: "file", path, mime: type, size: blob.size }).select().single();
    if (error) { await F.sb.storage.from("module-files").remove([path]); return F.toast(/50 MB/.test(error.message) ? "Your 50 MB is full. Delete some files first." : "Couldn't upload: " + error.message, { long: true }); }
    if (S.files && data) S.files.unshift(data);
    presentStored(path, data.name, type);
  };
  async function presentStored(path, name, mime) {
    const { data, error } = await F.sb.storage.from("module-files").createSignedUrl(path, 4 * 3600);
    if (error || !data) return F.toast("Couldn't share the file: " + (error ? error.message : ""), { long: true });
    if (stage.mode === "screen" && stage.by === me()) stopScreen(false);
    setStage({ mode: "file", by: me(), page: 1, file: { url: data.signedUrl, name, kind: /pdf/i.test((mime || "") + path) ? "pdf" : "img" } });
  }
  async function loadDoc() {
    docPdf = null; docImage = null;
    const f = stage.file; if (!f) return;
    $("clDocName").textContent = "📄 " + f.name; $("clPageNo").textContent = "Opening…";
    try {
      const res = await fetch(f.url); if (!res.ok) throw new Error("download failed");
      const buf = await res.arrayBuffer();
      if (stage.file !== f) return;
      if (f.kind === "pdf") {
        const lib = await F.loadPdfJs();
        docPdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
      } else {
        const url = URL.createObjectURL(new Blob([buf]));
        docImage = await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = url; });
      }
      drawDoc();
    } catch (e) { $("clPageNo").textContent = "Couldn't open it"; }
  }
  let docJob = 0;
  async function drawDoc() {
    const f = stage.file; if (!f) return;
    const job = ++docJob;
    if (docPdf) {
      stage.page = Math.max(1, Math.min(docPdf.numPages, stage.page));
      const page = await docPdf.getPage(stage.page); if (job !== docJob) return;
      const v1 = page.getViewport({ scale: 1 }); docAspect = v1.width / v1.height;
      $("clPageNo").textContent = stage.page + " / " + docPdf.numPages;
      layout(true);
      const vp = page.getViewport({ scale: docCanvas.width / v1.width });
      const c = docCanvas.getContext("2d"); c.fillStyle = "#FFFFFF"; c.fillRect(0, 0, docCanvas.width, docCanvas.height);
      await page.render({ canvasContext: c, viewport: vp }).promise;
    } else if (docImage) {
      docAspect = docImage.naturalWidth / docImage.naturalHeight; $("clPageNo").textContent = "Photo";
      layout();
    }
    const mine = stage.by === me();
    $("clPrev").hidden = !mine || !docPdf; $("clNext").hidden = !mine || !docPdf;
    dirty();
  }
  function paintDoc() {
    const c = docCanvas.getContext("2d");
    c.fillStyle = "#FFFFFF"; c.fillRect(0, 0, docCanvas.width, docCanvas.height);
    if (stage.mode === "file" && docImage) c.drawImage(docImage, 0, 0, docCanvas.width, docCanvas.height);
    if (stage.mode === "file" && docPdf) { const j = docJob; setTimeout(() => { if (j === docJob) drawDoc(); }, 0); }
  }
  $("clPrev").onclick = () => { if (!docPdf || stage.page <= 1) return; stage.page--; send({ t: "page", page: stage.page }); drawDoc(); };
  $("clNext").onclick = () => { if (!docPdf || stage.page >= docPdf.numPages) return; stage.page++; send({ t: "page", page: stage.page }); drawDoc(); };

  /* ---------- hooks ---------- */
  F.on("view:call", (id) => { if (id) openCall(id); else if (room) openCall(room.id); else F.go("rooms"); });
  F.on("view:rooms", () => {
    if (joined && room) {
      const box = $("roomsList");
      setTimeout(() => { if (!document.getElementById("backToCall")) box.insertAdjacentHTML("beforebegin", '<button type="button" class="btn primary block" id="backToCall" data-go="call:' + esc(room.id) + '">📞 Back to your call</button>'); }, 0);
    } else { const b = document.getElementById("backToCall"); if (b) b.remove(); }
  });
  // leaving the call page while not joined stops the camera preview
  F.on("view", (v) => { if (v !== "call" && !joined) stopPreview(); });
  F.callDebug = () => ({ joined, peers: Object.fromEntries(Object.entries(peers).map(([k, p]) => [k, { conn: p.pc.connectionState, tracks: p.stream.getTracks().map((t) => t.kind + ":" + t.readyState) }])), stage, strokes: strokes.length, kinds: strokes.map((s) => s.tool + (s.text ? ":" + s.text : "") + "@" + s.pts[0].map((v) => v.toFixed(2)).join(",")) });
})();
