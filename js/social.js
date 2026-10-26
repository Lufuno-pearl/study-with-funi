/* Funi social: profile & avatar, feelings, study partners & invites, live chat with files,
 * notifications page, Hub page. */
(function () {
  "use strict";
  const F = window.Funi, $ = F.$, esc = F.esc, S = F.s, A = window.FuniArt;
  const MAX_FILE = 10 * 1024 * 1024;
  const profiles = (F.profiles = {});
  const lookOf = (p) => (p && !F.isPhoto(p.avatar) ? p.avatar : null);

  /* =====================================================================
     MY PROFILE
     ===================================================================== */
  async function loadMyProfile() {
    const fallback = { id: F.me.id, username: F.usernameOf(F.me).toLowerCase(), feeling: "Okay", display_name: null, avatar: null };
    const { data, error } = await F.sb.from("study_profiles").select("*").eq("id", F.me.id).maybeSingle();
    if (error) { S.profile = fallback; S.socialMissing = true; return; }
    if (!data) { const ins = await F.sb.from("study_profiles").insert({ id: F.me.id, username: fallback.username }).select().single(); S.profile = ins.data || fallback; }
    else S.profile = data;
    profiles[F.me.id] = S.profile;
  }
  F.renderMe = () => {
    const p = S.profile; if (!p) return;
    ["dashAva", "hubAva", "sideAva"].forEach((id) => { $(id).innerHTML = F.avatar(p); });
    $("sideName").textContent = F.nameOf(p);
  };
  F.setMyFeeling = async (f, quiet) => {
    if (!S.profile) return;
    S.profile.feeling = f; F.renderMe(); F.emit("data");
    const { error } = await F.sb.from("study_profiles").update({ feeling: f, updated_at: new Date().toISOString() }).eq("id", F.me.id);
    if (error) return F.toast("Couldn't save your feeling: " + error.message);
    if (!quiet) F.toast(f === "Need help" ? "Saved. Your partners were told you need help." : "Feeling saved. Your partners can see it.");
  };

  /* =====================================================================
     FEELING PAGE
     ===================================================================== */
  let feelPick = "Okay", feelCallback = null;
  function drawFeeling() {
    const p = S.profile || { id: "me" }, cur = p.feeling || "Okay";
    $("feelArt").innerHTML = A.dreamyScene(lookOf(p), feelPick, p.id);
    $("feelNowFace").innerHTML = F.face(cur); $("feelNowName").textContent = cur; $("feelNowNote").textContent = F.FEELING_NOTES[cur] || "";
    $("feelChoices").innerHTML = A.FEELINGS.map((f) => '<button type="button" class="feel" data-fc="' + esc(f) + '" aria-pressed="' + (f === feelPick) + '"><span class="face">' + F.face(f) + "</span>" + esc(f) + "</button>").join("");
  }
  F.openFeeling = (cb) => { feelCallback = cb || null; F.go("feeling"); };
  F.on("view:feeling", () => { feelPick = (S.profile && S.profile.feeling) || "Okay"; drawFeeling(); });
  $("feelChoices").addEventListener("click", (e) => { const b = e.target.closest("[data-fc]"); if (!b) return; feelPick = b.dataset.fc; drawFeeling(); });
  $("saveFeeling").onclick = async () => {
    const cb = feelCallback; feelCallback = null;
    await F.setMyFeeling(feelPick, !!cb);
    if (cb) cb(feelPick); else F.back();
  };

  /* =====================================================================
     PARTNERS & INVITES
     ===================================================================== */
  const otherId = (row) => (row.requester_id === F.me.id ? row.addressee_id : row.requester_id);
  async function loadPartners() {
    const { data, error } = await F.sb.from("study_partners").select("*").or("requester_id.eq." + F.me.id + ",addressee_id.eq." + F.me.id).order("created_at", { ascending: false });
    if (error) { S.socialMissing = true; return; }
    const rows = data || [], ids = [...new Set(rows.map(otherId))];
    if (ids.length) { const { data: ps } = await F.sb.from("study_profiles").select("*").in("id", ids); (ps || []).forEach((p) => { profiles[p.id] = p; }); }
    S.partnerRows = rows;
    S.partners = rows.filter((r) => r.status === "accepted").map((r) => ({ id: otherId(r), rowId: r.id }));
    S.invitesIn = rows.filter((r) => r.status === "pending" && r.addressee_id === F.me.id);
    S.invitesOut = rows.filter((r) => r.status === "pending" && r.requester_id === F.me.id);
    await loadPartnerSessions();
  }
  async function loadPartnerSessions() {
    S.partnerSessions = {};
    const ids = S.partners.map((p) => p.id); if (!ids.length) return;
    const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const { data } = await F.sb.from("study_sessions").select("*").in("user_id", ids).eq("is_active", true).gte("started_at", since).order("started_at", { ascending: false });
    (data || []).forEach((s) => { if (!S.partnerSessions[s.user_id]) S.partnerSessions[s.user_id] = s; });
  }
  function statusOf(id) {
    const s = S.partnerSessions[id];
    if (s) return { live: true, text: "Studying now", line: s.module_code + " · " + s.activity };
    if (S.online.has(id)) return { live: true, text: "Online", line: "" };
    return { live: false, text: "Offline", line: "" };
  }
  F.statusOf = statusOf;
  function personCard(id, extraHtml, clickable) {
    const p = profiles[id] || { id, username: "student", feeling: "Okay" }, st = statusOf(id), session = S.partnerSessions[id];
    const feeling = session ? session.feeling : p.feeling, tag = clickable ? "button" : "div";
    return "<" + tag + (clickable ? ' type="button" data-open-chat="' + esc(id) + '"' : "") + ' class="person">' +
      '<span class="ava-wrap"><span class="ava">' + F.avatar(p, feeling) + "</span>" + (st.live ? '<span class="live"></span>' : "") + "</span>" +
      '<span class="txt"><b>' + esc(F.nameOf(p)) + '</b><span class="st' + (st.live ? " live" : "") + '">' + (st.live ? '<span class="dot-live"></span>' : '<span class="dot-off"></span>') + esc(st.text) + "</span>" +
      '<span class="mod-line">' + esc(st.line || "@" + p.username) + "</span>" + (extraHtml || "") + "</span>" +
      '<span class="mood"><span class="face">' + F.face(feeling) + "</span>" + esc(feeling) + "</span></" + tag + ">";
  }
  function renderPartners() {
    const banner = A.dreamyScene(lookOf(S.profile), "Happy", S.profile && S.profile.id);
    $("partnersBannerArt").innerHTML = banner;
    if (S.socialMissing) {
      const msg = '<div class="empty"><b>Study partners need a quick setup</b><span>Open Supabase › SQL Editor, paste funi-v2-setup.sql from GitHub and press Run.</span></div>';
      $("psCircle").innerHTML = msg; $("psInvites").innerHTML = msg; return;
    }
    const sorted = S.partners.slice().sort((a, b) => {
      const r = (id) => (S.partnerSessions[id] ? 0 : S.online.has(id) ? 1 : 2);
      return r(a.id) - r(b.id) || F.nameOf(profiles[a.id]).localeCompare(F.nameOf(profiles[b.id]));
    });
    $("psCircle").innerHTML = sorted.length ? sorted.map((p) => personCard(p.id, "", true)).join("")
      : '<div class="empty"><b>No study partners yet</b><span>Invite a friend by their Funi username.</span><button type="button" class="btn primary small" data-go="invite">Invite a friend</button></div>';
    let inv = "";
    if (S.invitesIn.length) inv += "<h2>Waiting for you</h2>" + S.invitesIn.map((r) => personCard(r.requester_id,
      '<span class="person-actions"><button type="button" class="btn primary small" data-accept="' + esc(r.id) + '">Accept</button><button type="button" class="btn ghost small" data-decline="' + esc(r.id) + '">Decline</button></span>')).join("");
    if (S.invitesOut.length) inv += "<h2>You invited</h2>" + S.invitesOut.map((r) => personCard(r.addressee_id,
      '<span class="person-actions"><span class="pill butter">Waiting</span><button type="button" class="btn ghost small" data-cancel="' + esc(r.id) + '">Cancel</button></span>')).join("");
    $("psInvites").innerHTML = inv || '<div class="empty"><b>No invitations right now</b><span>When someone invites you, it shows up here.</span></div>';
    const n = S.invitesIn.length;
    $("inviteCount").hidden = !n; $("inviteCount").textContent = n;
    $("partnersBadge").hidden = !n; $("partnersBadge").textContent = n;
  }
  F.renderPartners = renderPartners;
  let pseg = "circle";
  function openPseg(seg) {
    pseg = seg;
    document.querySelectorAll("#partnerSeg [data-pseg]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.pseg === seg)));
    $("psCircle").hidden = seg !== "circle"; $("psInvites").hidden = seg !== "invites";
  }
  document.querySelectorAll("#partnerSeg [data-pseg]").forEach((b) => b.addEventListener("click", () => openPseg(b.dataset.pseg)));
  F.on("view:partners", (sub) => { renderPartners(); openPseg(sub || (S.invitesIn.length ? "invites" : pseg)); });

  // invite page
  F.on("view:invite", () => {
    const p = S.profile || { id: "me" };
    $("inviteArt").innerHTML = A.friendsScene(lookOf(p), null, p.id, "friend-" + p.id);
    loadSuggestions();
  });
  let findTimer = null;
  $("findInput").addEventListener("input", () => {
    clearTimeout(findTimer);
    const q = $("findInput").value.trim().toLowerCase();
    if (q.length < 2) { $("findResults").innerHTML = q ? '<p class="hint">Type at least 2 letters.</p>' : ""; return; }
    findTimer = setTimeout(async () => {
      const { data, error } = await F.sb.rpc("search_study_users", { search_text: q });
      if (error) { $("findResults").innerHTML = '<p class="hint">Search needs funi-v2-setup.sql in Supabase.</p>'; return; }
      $("findResults").innerHTML = (data || []).length ? data.map((u) => { profiles[u.id] = Object.assign(profiles[u.id] || {}, u); return personCard(u.id, inviteButton(u.id)); }).join("")
        : '<div class="empty"><b>No one called "' + esc(q) + '" yet</b><span>Ask your friend for their exact Funi username, or share your link.</span></div>';
    }, 300);
  });
  function inviteButton(id) {
    if (S.partners.some((p) => p.id === id)) return '<span class="person-actions"><span class="pill mint">Study partner</span></span>';
    if (S.invitesOut.some((r) => r.addressee_id === id)) return '<span class="person-actions"><span class="pill butter">Invited</span></span>';
    const inc = S.invitesIn.find((r) => r.requester_id === id);
    if (inc) return '<span class="person-actions"><button type="button" class="btn primary small" data-accept="' + esc(inc.id) + '">Accept their invite</button></span>';
    return '<span class="person-actions"><button type="button" class="btn primary small" data-invite="' + esc(id) + '">Invite</button></span>';
  }
  async function loadSuggestions() {
    const { data, error } = await F.sb.rpc("find_study_matches");
    if (error) { $("suggestions").innerHTML = '<p class="hint">Suggestions need funi-v2-setup.sql in Supabase.</p>'; return; }
    $("suggestions").innerHTML = (data || []).length ? data.map((u) => {
      profiles[u.user_id] = Object.assign(profiles[u.user_id] || {}, { id: u.user_id, username: u.username, display_name: u.display_name, avatar: u.avatar, feeling: u.feeling });
      return personCard(u.user_id, '<span class="tags">' + (u.shared_modules || []).map((m) => '<span class="pill lav">' + esc(m) + "</span>").join("") + "</span>" + inviteButton(u.user_id));
    }).join("") : '<div class="empty"><b>No suggestions yet</b><span>When classmates join Funi with the same modules, they show up here.</span></div>';
  }
  document.addEventListener("click", async (e) => {
    const inv = e.target.closest("[data-invite]");
    if (inv) {
      inv.disabled = true;
      const to = inv.dataset.invite;
      const old = (S.partnerRows || []).find((r) => r.status === "rejected" && otherId(r) === to);
      if (old) await F.sb.from("study_partners").delete().eq("id", old.id);
      const { error } = await F.sb.from("study_partners").insert({ requester_id: F.me.id, addressee_id: to, status: "pending" });
      if (error) { inv.disabled = false; return F.toast(/duplicate|unique/i.test(error.message) ? "You already have an invite with this person. Check Invitations." : "Couldn't invite: " + error.message, { long: true }); }
      inv.outerHTML = '<span class="pill butter">Invited</span>';
      F.toast("Invite sent to " + F.nameOf(profiles[to]) + ".");
      await loadPartners(); renderPartners(); return;
    }
    const acc = e.target.closest("[data-accept]");
    if (acc) {
      acc.disabled = true;
      const { error } = await F.sb.from("study_partners").update({ status: "accepted" }).eq("id", acc.dataset.accept);
      if (error) { acc.disabled = false; return F.toast("Couldn't accept: " + error.message); }
      await loadPartners(); renderPartners(); renderConvos(); F.emit("data");
      F.toast("You're study partners now! Say hi in Messages.", { onClick: () => F.go("messages") }); return;
    }
    const dec = e.target.closest("[data-decline]");
    if (dec) { const { error } = await F.sb.from("study_partners").update({ status: "rejected" }).eq("id", dec.dataset.decline); if (error) return F.toast("Couldn't decline: " + error.message); await loadPartners(); renderPartners(); return; }
    const can = e.target.closest("[data-cancel]");
    if (can) { const { error } = await F.sb.from("study_partners").delete().eq("id", can.dataset.cancel); if (error) return F.toast("Couldn't cancel: " + error.message); await loadPartners(); renderPartners(); return; }
    const oc = e.target.closest("[data-open-chat]");
    if (oc) openChat(oc.dataset.openChat);
  });
  $("shareLink").onclick = async () => {
    const me = S.profile ? S.profile.username : "";
    const data = { title: "Study with Funi", text: "Join me on Funi so we can study together! My username is " + me + ".", url: location.origin };
    try {
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard.writeText(data.text + " " + data.url);
      F.toast("Link copied. Paste it to your friend.");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      F.toast("Send your friend this link: " + location.origin + " and your username: " + me, { long: true });
    }
  };

  /* =====================================================================
     HUB
     ===================================================================== */
  F.renderHub = () => {
    const p = S.profile || { id: F.me && F.me.id };
    $("hubHello").textContent = "Hey there, " + F.nameOf(p) + "!";
    $("hubArt").innerHTML = A.dreamyScene(lookOf(p), p.feeling || "Happy", p.id);
    $("hubBannerArt").innerHTML = A.dreamyScene(lookOf(p), "Feeling great", p.id);
    $("statPartners").textContent = S.partners.length;
    $("statLive").textContent = S.partners.filter((x) => S.partnerSessions[x.id]).length;
  };
  F.on("view:hub", () => F.renderHub());

  /* =====================================================================
     MESSAGES & CHAT
     ===================================================================== */
  async function loadConvos() {
    S.convos = {};
    if (!S.partners.length) return;
    const { data } = await F.sb.from("study_messages").select("id,sender_id,recipient_id,body,file_name,is_help,created_at,read_at")
      .or("sender_id.eq." + F.me.id + ",recipient_id.eq." + F.me.id).order("created_at", { ascending: false }).limit(300);
    (data || []).forEach((m) => {
      const other = m.sender_id === F.me.id ? m.recipient_id : m.sender_id;
      const c = S.convos[other] || (S.convos[other] = { last: null, unread: 0 });
      if (!c.last) c.last = m;
      if (m.recipient_id === F.me.id && !m.read_at) c.unread++;
    });
  }
  const previewOf = (m) => !m ? "Say hi and plan your first study session" : (m.sender_id === F.me.id ? "You: " : "") + (m.is_help ? "Needs help · " : "") + (m.body || (m.file_name ? "Sent " + m.file_name : "Sent a file"));
  function renderConvos() {
    const unreadTotal = Object.values(S.convos).reduce((n, c) => n + c.unread, 0);
    $("msgBadge").hidden = !unreadTotal; $("msgBadge").textContent = unreadTotal;
    if (S.view !== "messages") return;
    if (!S.partners.length) { $("convoList").innerHTML = '<div class="empty"><b>No chats yet</b><span>Add a study partner first, then you can message each other and send files.</span><button type="button" class="btn primary small" data-go="invite">Invite a friend</button></div>'; return; }
    const lastAt = (id) => (S.convos[id] && S.convos[id].last ? S.convos[id].last.created_at : "");
    const rows = S.partners.slice().sort((a, b) => lastAt(b.id).localeCompare(lastAt(a.id)));
    $("convoList").innerHTML = '<div class="list">' + rows.map((p) => {
      const pr = profiles[p.id] || {}, c = S.convos[p.id] || { last: null, unread: 0 }, st = statusOf(p.id);
      return '<button type="button" class="convo" data-open-chat="' + esc(p.id) + '"><span class="ava-wrap"><span class="ava">' + F.avatar(pr) + "</span>" + (st.live ? '<span class="live"></span>' : "") + "</span>" +
        '<span class="txt"><b>' + esc(F.nameOf(pr)) + '</b><span class="prev">' + esc(previewOf(c.last)) + "</span></span>" +
        '<span class="meta">' + (c.last ? esc(F.timeAgo(c.last.created_at)) : "") + (c.unread ? '<span class="unread">' + c.unread + "</span>" : "") + "</span></button>";
    }).join("") + "</div>";
  }
  F.on("view:messages", () => renderConvos());

  let chatMsgs = [], attachFile = null, helpOn = false;
  const signed = {};
  async function openChat(id) {
    F.go("chat"); S.chatWith = id;
    const p = profiles[id] || { id, username: "partner" };
    $("chatAva").innerHTML = F.avatar(p); $("chatName").textContent = F.nameOf(p);
    drawChatStatus();
    $("msgs").innerHTML = '<p class="status-line">Loading messages…</p>';
    clearAttach(); setHelp(false);
    const { data, error } = await F.sb.from("study_messages").select("*")
      .or("and(sender_id.eq." + F.me.id + ",recipient_id.eq." + id + "),and(sender_id.eq." + id + ",recipient_id.eq." + F.me.id + ")")
      .order("created_at", { ascending: false }).limit(200);
    if (S.chatWith !== id) return;
    if (error) { $("msgs").innerHTML = '<p class="status-line">Couldn\'t load messages: ' + esc(error.message) + "</p>"; return; }
    chatMsgs = (data || []).reverse();
    await drawMsgs(); markRead(id);
  }
  F.openChat = openChat;
  function drawChatStatus() {
    const id = S.chatWith; if (!id) return;
    const p = profiles[id] || {}, st = statusOf(id), s = S.partnerSessions[id];
    $("chatStatus").textContent = s ? "Studying " + s.module_code : st.text;
    $("chatStatus").className = st.live ? "live" : "";
    $("chatLive").hidden = !st.live;
    $("chatFace").innerHTML = F.face(s ? s.feeling : p.feeling || "Okay");
  }
  async function signUrl(path) {
    if (signed[path]) return signed[path];
    const { data } = await F.sb.storage.from("chat-files").createSignedUrl(path, 3600);
    signed[path] = data ? data.signedUrl : null;
    return signed[path];
  }
  function bubbleHtml(m, isNew) {
    const mine = m.sender_id === F.me.id;
    let inner = "";
    if (m.is_help) inner += '<span class="help-tag">Help request</span><br>';
    if (m.file_path) {
      const url = signed[m.file_path];
      if (m.file_type && m.file_type.startsWith("image/")) inner += url ? '<img src="' + esc(url) + '" alt="' + esc(m.file_name || "Photo") + '" data-full="' + esc(url) + '" loading="lazy">' : '<span class="file-chip">Loading photo…</span>';
      else inner += '<a class="file-chip" href="' + esc(url || "#") + '" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>' + esc(m.file_name || "File") + "</a>";
    }
    if (m.body) inner += esc(m.body);
    return '<div class="bubble' + (mine ? " me" : "") + (m.is_help ? " help" : "") + (isNew ? " new" : "") + '">' + inner + "<time>" + F.clockOf(m.created_at) + (mine && m.read_at ? " · Seen" : "") + "</time></div>";
  }
  async function drawMsgs(newId) {
    await Promise.all(chatMsgs.filter((m) => m.file_path && !signed[m.file_path]).map((m) => signUrl(m.file_path)));
    if (!chatMsgs.length) { $("msgs").innerHTML = '<div class="empty"><b>Say hi to ' + esc(F.nameOf(profiles[S.chatWith])) + '</b><span>Send a photo of a question, a PDF, or ask for help.</span></div>'; return; }
    let html = "", lastDay = "";
    chatMsgs.forEach((m) => {
      const d = new Date(m.created_at).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
      if (d !== lastDay) { html += '<span class="day-sep">' + (F.isoOf(new Date(m.created_at)) === F.todayISO() ? "Today" : d) + "</span>"; lastDay = d; }
      html += bubbleHtml(m, m.id === newId);
    });
    $("msgs").innerHTML = html;
    window.scrollTo(0, document.body.scrollHeight);
  }
  async function markRead(id) {
    const unread = chatMsgs.filter((m) => m.recipient_id === F.me.id && !m.read_at);
    if (S.convos[id]) S.convos[id].unread = 0; renderConvos();
    if (!unread.length) return;
    const now = new Date().toISOString();
    unread.forEach((m) => { m.read_at = now; });
    await F.sb.from("study_messages").update({ read_at: now }).eq("recipient_id", F.me.id).eq("sender_id", id).is("read_at", null);
    const ids = S.notifs.filter((n) => !n.read_at && n.actor_id === id && (n.kind === "message" || n.kind === "help")).map((n) => n.id);
    if (ids.length) { S.notifs.forEach((n) => { if (ids.includes(n.id)) n.read_at = now; }); renderBell(); await F.sb.from("notifications").update({ read_at: now }).in("id", ids); }
  }
  $("msgs").addEventListener("click", (e) => { const img = e.target.closest("img[data-full]"); if (img) { $("imgFull").src = img.dataset.full; $("imgSheet").showModal(); } });
  $("chatBack").onclick = () => F.go("messages");
  function setHelp(on) { helpOn = on; $("helpToggle").setAttribute("aria-pressed", String(on)); $("helpToggle").textContent = on ? "Help request on" : "Ask for help"; $("chatInput").placeholder = on ? "What do you need help with?" : "Type a message…"; }
  $("helpToggle").onclick = () => setHelp(!helpOn);
  $("attachBtn").onclick = () => $("fileInput").click();
  $("fileInput").onchange = () => {
    const f = $("fileInput").files[0]; if (!f) return;
    if (f.size > MAX_FILE) { F.toast("That file is bigger than 10 MB. Try a smaller photo or PDF."); $("fileInput").value = ""; return; }
    attachFile = f; $("attachName").textContent = f.name + " · " + Math.max(1, Math.round(f.size / 1024)) + " KB"; $("attachPreview").hidden = false;
  };
  function clearAttach() { attachFile = null; $("fileInput").value = ""; $("attachPreview").hidden = true; }
  $("attachClear").onclick = clearAttach;
  $("chatInput").addEventListener("input", () => { const t = $("chatInput"); t.style.height = "auto"; t.style.height = Math.min(120, t.scrollHeight) + "px"; });
  $("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); $("chatForm").requestSubmit(); } });
  $("chatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const to = S.chatWith, body = $("chatInput").value.trim();
    if (!to || (!body && !attachFile)) return;
    $("sendBtn").disabled = true;
    const row = { sender_id: F.me.id, recipient_id: to, body, is_help: helpOn };
    if (attachFile) {
      const safe = attachFile.name.replace(/[^\w.\-]+/g, "_").slice(-60);
      const path = F.me.id + "/" + to + "/" + Date.now() + "-" + safe;
      F.toast("Sending " + attachFile.name + "…");
      const up = await F.sb.storage.from("chat-files").upload(path, attachFile, { contentType: attachFile.type || "application/octet-stream", upsert: false });
      if (up.error) { $("sendBtn").disabled = false; return F.toast("Couldn't send the file: " + up.error.message, { long: true }); }
      Object.assign(row, { file_path: path, file_name: attachFile.name, file_type: attachFile.type || null, file_size: attachFile.size });
    }
    const { data, error } = await F.sb.from("study_messages").insert(row).select().single();
    $("sendBtn").disabled = false;
    if (error) return F.toast("Message wasn't sent: " + error.message, { long: true });
    $("chatInput").value = ""; $("chatInput").style.height = "auto"; clearAttach(); setHelp(false);
    chatMsgs.push(data);
    (S.convos[to] = S.convos[to] || { last: null, unread: 0 }).last = data;
    await drawMsgs(data.id);
  });

  /* =====================================================================
     NOTIFICATIONS PAGE
     ===================================================================== */
  const NIC = {
    invite: ["t-lav", '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>'],
    accepted: ["t-mint", '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 11l2 2 4-4"/>'],
    message: ["t-pink", '<path d="M12 21s-7.5-4.6-9.5-9.2C1 8.2 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 6 3.7 4.5 7.3C19.5 16.4 12 21 12 21z"/>'],
    help: ["t-peach", '<path d="M4 5h16v11H9l-5 4z"/><path d="M12 8v3M12 13.5h.01"/>'],
    studying: ["t-lav", '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/>']
  };
  async function loadNotifs() {
    const { data, error } = await F.sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(50);
    S.notifs = error ? [] : data || [];
    renderBell();
  }
  function renderBell() {
    const n = S.notifs.filter((x) => !x.read_at).length;
    $("bellBadge").hidden = !n; $("bellBadge").textContent = n > 9 ? "9+" : n;
  }
  function renderNotifSetting() {
    const t = $("notifToggle");
    if (!F.canNotify()) {
      t.checked = false; t.disabled = !(F.isIOS && !F.isInstalled);
      $("notifInfo").textContent = F.isIOS && !F.isInstalled ? "On iPhone, add Funi to your home screen first (tap the switch to see how), then turn notifications on here." : "This browser can't show notifications.";
      return;
    }
    const p = Notification.permission;
    t.disabled = p === "denied"; t.checked = p === "granted";
    $("notifInfo").textContent = p === "denied" ? "Notifications are blocked. Turn them on in your phone's Settings › Notifications › Funi."
      : p !== "granted" ? "Turn this on to get reminders, messages and partner updates."
      : F.pushOn ? "On. Funi can buzz your phone even when the app is closed." : F.cfg.pushReady ? "On while Funi is open. Tap the switch off and on again if closed-app alerts don't arrive." : "On while Funi is open. Alerts when Funi is closed need one more setup step by the app owner.";
  }
  $("notifToggle").addEventListener("change", async () => {
    if (!F.canNotify()) { $("notifToggle").checked = false; if (F.isIOS && !F.isInstalled) $("iosSheet").showModal(); return; }
    if ($("notifToggle").checked) await F.enableNotifications();
    else { await F.unsubscribePush(); F.toast("Funi won't buzz this phone when it's closed. To stop all pop-ups, use your phone's Settings › Notifications."); }
    renderNotifSetting();
  });
  function renderNotifs() {
    renderNotifSetting();
    $("notifList").innerHTML = S.notifs.length ? S.notifs.map((n) => {
      const ic = NIC[n.kind] || NIC.message, actor = n.actor_id && profiles[n.actor_id];
      const icon = actor && n.kind === "studying" ? '<span class="ava sm">' + F.avatar(actor) + "</span>" : '<span class="ic ' + ic[0] + '"><svg viewBox="0 0 24 24">' + ic[1] + "</svg></span>";
      return '<button type="button" class="notif' + (n.read_at ? "" : " unread-n") + '" data-notif="' + esc(n.id) + '">' + icon +
        '<span class="grow"><b>' + esc(n.title) + "</b>" + (n.body ? "<span>" + esc(n.body) + "</span>" : "") + "<time>" + esc(F.timeAgo(n.created_at)) + "</time></span></button>";
    }).join("") : '<div class="empty"><b>You\'re all caught up</b><span>Messages, invites, reminders and partners studying show here.</span></div>';
  }
  F.on("view:notifs", async () => {
    renderNotifs();
    const unread = S.notifs.filter((x) => !x.read_at).map((x) => x.id);
    if (unread.length) {
      const now = new Date().toISOString();
      setTimeout(() => { S.notifs.forEach((x) => { if (!x.read_at) x.read_at = now; }); renderBell(); }, 1500);
      await F.sb.from("notifications").update({ read_at: now }).in("id", unread);
    }
  });
  $("notifClear").onclick = async () => { await F.sb.from("notifications").delete().eq("user_id", F.me.id); S.notifs = []; renderNotifs(); renderBell(); };
  function openNotif(n) {
    if ((n.kind === "message" || n.kind === "help" || n.kind === "accepted") && n.actor_id) return openChat(n.actor_id);
    if (n.kind === "invite") return F.go("partners:invites");
    F.go("partners:circle");
  }
  $("notifList").addEventListener("click", (e) => { const b = e.target.closest("[data-notif]"); if (!b) return; const n = S.notifs.find((x) => x.id === b.dataset.notif); if (n) openNotif(n); });

  /* =====================================================================
     LIVE EVENTS
     ===================================================================== */
  async function ensureProfile(id) {
    if (!id || profiles[id]) return;
    const { data } = await F.sb.from("study_profiles").select("*").eq("id", id).maybeSingle();
    if (data) profiles[id] = data;
  }
  F.on("rt:message", async (m) => {
    await ensureProfile(m.sender_id);
    const c = S.convos[m.sender_id] || (S.convos[m.sender_id] = { last: null, unread: 0 });
    c.last = m;
    if (S.view === "chat" && S.chatWith === m.sender_id && document.visibilityState === "visible") { chatMsgs.push(m); await drawMsgs(m.id); markRead(m.sender_id); }
    else { c.unread++; renderConvos(); }
  });
  F.on("rt:messageRead", (m) => { const local = chatMsgs.find((x) => x.id === m.id); if (local && !local.read_at) { local.read_at = m.read_at; if (S.view === "chat") drawMsgs(); } });
  F.on("rt:notification", async (n) => {
    if (n.actor_id) await ensureProfile(n.actor_id);
    const inThatChat = (n.kind === "message" || n.kind === "help") && S.view === "chat" && S.chatWith === n.actor_id && document.visibilityState === "visible";
    if (inThatChat) n.read_at = new Date().toISOString();
    S.notifs.unshift(n); renderBell();
    if (S.view === "notifs") renderNotifs();
    if (inThatChat) { F.sb.from("notifications").update({ read_at: n.read_at }).eq("id", n.id); return; }
    const actor = n.actor_id && profiles[n.actor_id];
    F.toast(n.title + (n.body ? ": " + n.body : ""), { long: true, icon: actor ? F.avatar(actor) : null, onClick: () => openNotif(n) });
    if (document.visibilityState !== "visible" && !F.pushOn) F.systemNotify(n.title, n.body || "", n.kind + "-" + (n.actor_id || ""));
    if (n.kind === "invite" || n.kind === "accepted") { await loadPartners(); renderPartners(); renderConvos(); F.emit("data"); }
  });
  F.on("rt:partners", async () => { await loadPartners(); renderPartners(); renderConvos(); F.emit("data"); });
  F.on("rt:session", (s) => {
    if (!s || !s.user_id || s.user_id === F.me.id) return;
    if (s.is_active) S.partnerSessions[s.user_id] = s; else if (S.partnerSessions[s.user_id] && S.partnerSessions[s.user_id].id === s.id) delete S.partnerSessions[s.user_id];
    if (S.view === "partners") renderPartners();
    if (S.view === "hub") F.renderHub();
    if (S.view === "chat") drawChatStatus();
  });
  F.on("rt:profile", (p) => {
    if (!p || !p.id) return;
    profiles[p.id] = Object.assign(profiles[p.id] || {}, p);
    if (p.id === F.me.id) { S.profile = profiles[p.id]; F.renderMe(); }
    if (S.view === "partners") renderPartners();
    if (S.view === "chat") drawChatStatus();
  });
  F.on("presence", () => { if (S.view === "partners") renderPartners(); if (S.view === "messages") renderConvos(); if (S.view === "chat") drawChatStatus(); });
  F.on("resume", async () => {
    await Promise.all([loadPartners(), loadConvos(), loadNotifs()]);
    renderPartners(); renderConvos(); F.emit("data");
    if (S.view === "chat" && S.chatWith) openChat(S.chatWith);
  });

  /* =====================================================================
     PROFILE: avatar gallery, custom cartoon, photo, name, theme
     ===================================================================== */
  let avTab = "All", draftAvatar = null;
  function renderProfile() {
    const p = S.profile; if (!p) return;
    if (draftAvatar == null) draftAvatar = p.avatar;
    $("profAva").innerHTML = F.avatar({ id: p.id, avatar: draftAvatar, feeling: p.feeling });
    $("profName").textContent = F.nameOf(p); $("profUser").textContent = "@" + p.username;
    document.querySelectorAll("#avaTabs [data-avtab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.avtab === avTab)));
    $("avaGrid").innerHTML = A.PRESETS.map((x, i) => ({ x, i })).filter((o) => avTab === "All" || o.x.kind === avTab).map((o) => {
      const val = JSON.stringify(o.x.look), on = draftAvatar === val;
      return '<button type="button" class="ava-pick" data-preset="' + o.i + '" aria-pressed="' + on + '" aria-label="Avatar ' + (o.i + 1) + '">' + A.avatarSVG(o.x.look, "Happy", "preset" + o.i) + "</button>";
    }).join("");
    if (document.activeElement !== $("profDisplay")) $("profDisplay").value = p.display_name || "";
    renderEmail();
    renderThemes();
  }
  function renderEmail() {
    const u = F.me || {}, real = F.hasRealEmail(u);
    if (document.activeElement !== $("profEmail")) $("profEmail").value = real ? u.email : "";
    $("emailNote").textContent = u.new_email
      ? "Waiting for you to confirm " + u.new_email + ". Tap the link we emailed you."
      : real ? "Used to reset your password. Only you can see it." : "Add your email so you can reset your password yourself. Only you can see it.";
    $("saveEmail").textContent = real ? "Change" : "Add";
  }
  $("saveEmail").onclick = async () => {
    const email = $("profEmail").value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return F.toast("Type your full email, like you@gmail.com.");
    if (F.me && email === F.me.email) return F.toast("That's already your email.");
    $("saveEmail").disabled = true;
    const { data, error } = await F.sb.auth.updateUser({ email }, { emailRedirectTo: location.origin + "/" });
    $("saveEmail").disabled = false;
    if (error) return F.toast(/already|registered|exists/i.test(error.message) ? "That email already has a Funi account." : "Couldn't save: " + error.message, { long: true });
    if (data && data.user) F.me = data.user;
    renderEmail();
    F.toast("Check " + email + " for a link to confirm it.", { long: true });
  };
  F.on("view:profile", () => { draftAvatar = null; renderProfile(); });
  document.querySelectorAll("#avaTabs [data-avtab]").forEach((b) => b.addEventListener("click", () => { avTab = b.dataset.avtab; renderProfile(); }));
  $("avaGrid").addEventListener("click", (e) => { const b = e.target.closest("[data-preset]"); if (!b) return; draftAvatar = JSON.stringify(A.PRESETS[+b.dataset.preset].look); renderProfile(); });
  async function saveAvatarValue(val, msg) {
    const { error } = await F.sb.from("study_profiles").update({ avatar: val }).eq("id", F.me.id);
    if (error) return F.toast(/avatar/.test(error.message) ? "Run funi-v3-setup.sql in Supabase first." : "Couldn't save: " + error.message), false;
    S.profile.avatar = val; profiles[F.me.id] = S.profile; draftAvatar = val;
    F.renderMe(); renderProfile(); F.emit("data"); F.toast(msg || "Looking good!");
    return true;
  }
  $("saveAvatar").onclick = () => saveAvatarValue(draftAvatar);
  // custom cartoon builder
  let draftLook = null;
  function drawLook() {
    $("lookPreview").innerHTML = A.avatarSVG(draftLook, (S.profile && S.profile.feeling) || "Happy", F.me.id);
    $("lookSkin").innerHTML = A.SKIN.map((c, i) => '<button type="button" class="look-opt" style="background:' + c + '" data-look="skin" data-v="' + i + '" aria-pressed="' + (draftLook.skin === i) + '" aria-label="Skin tone ' + (i + 1) + '"></button>').join("");
    const names = { puffs: "Puffs", afro: "Afro", bun: "Bun", long: "Long", braids: "Braids", short: "Short", curly: "Curly" };
    $("lookHair").innerHTML = A.HAIR_STYLES.map((h) => '<button type="button" class="look-txt" data-look="hair" data-v="' + h + '" aria-pressed="' + (draftLook.hair === h) + '">' + names[h] + "</button>").join("");
    $("lookHairColor").innerHTML = A.HAIR_COLORS.map((c, i) => '<button type="button" class="look-opt" style="background:' + c + '" data-look="hairColor" data-v="' + i + '" aria-pressed="' + (draftLook.hairColor === i) + '" aria-label="Hair colour ' + (i + 1) + '"></button>').join("");
    $("lookHoodie").innerHTML = A.HOODIES.map((c, i) => '<button type="button" class="look-opt" style="background:' + c + '" data-look="hoodie" data-v="' + i + '" aria-pressed="' + (draftLook.hoodie === i) + '" aria-label="Hoodie colour ' + (i + 1) + '"></button>').join("");
  }
  $("editLook").onclick = () => { draftLook = A.parseLook(F.isPhoto(draftAvatar) ? null : draftAvatar, F.me.id); drawLook(); $("lookSheet").showModal(); };
  $("lookSheet").addEventListener("click", (e) => { const b = e.target.closest("[data-look]"); if (!b) return; draftLook[b.dataset.look] = b.dataset.look === "hair" ? b.dataset.v : +b.dataset.v; drawLook(); });
  $("saveLook").onclick = () => { draftAvatar = JSON.stringify(draftLook); $("lookSheet").close(); renderProfile(); F.toast("Tap Save avatar to keep it."); };
  // photo upload (made small on the phone before uploading)
  $("uploadPhoto").onclick = () => $("photoInput").click();
  $("photoInput").onchange = async () => {
    const f = $("photoInput").files[0]; $("photoInput").value = ""; if (!f) return;
    try {
      const img = await createImageBitmap(f);
      const size = 360, c = document.createElement("canvas"); c.width = c.height = size;
      const s = Math.min(img.width, img.height), sx = (img.width - s) / 2, sy = (img.height - s) / 2;
      c.getContext("2d").drawImage(img, sx, sy, s, s, 0, 0, size, size);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
      const path = F.me.id + "/" + Date.now() + ".jpg";
      F.toast("Uploading your photo…");
      const up = await F.sb.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (up.error) return F.toast("Couldn't upload: " + up.error.message + ". Run funi-v3-setup.sql in Supabase.", { long: true });
      const url = F.sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      await saveAvatarValue("photo:" + url, "Photo saved. Your partners will see it.");
    } catch (e) { F.toast("That photo couldn't be used. Try a JPG or PNG."); }
  };
  $("saveDisplay").onclick = async () => {
    const v = $("profDisplay").value.trim().slice(0, 30);
    const { error } = await F.sb.from("study_profiles").update({ display_name: v || null }).eq("id", F.me.id);
    if (error) return F.toast(/display_name/.test(error.message) ? "Run funi-v2-setup.sql in Supabase first." : "Couldn't save: " + error.message);
    S.profile.display_name = v || null; F.renderMe(); renderProfile(); F.emit("data"); F.toast("Saved. Partners will see " + F.nameOf(S.profile) + ".");
  };
  function renderThemes() {
    const cur = F.currentTheme();
    $("themePicker").innerHTML = F.THEMES.map((t) => '<button type="button" class="theme-btn" data-theme-pick="' + t.id + '" aria-pressed="' + (t.id === cur) + '">' +
      '<span class="theme-sw"><span style="background:' + t.sw[0] + '"></span><span style="background:' + t.sw[1] + '"></span></span>' + t.name + "</button>").join("");
  }
  $("themePicker").addEventListener("click", (e) => { const b = e.target.closest("[data-theme-pick]"); if (b) { F.applyTheme(b.dataset.themePick); renderThemes(); F.emit("data"); } });
  $("logoutBtn").onclick = async () => { if (await F.confirm("Log out of Funi?", "Your data stays saved in your account.", "Log out")) F.logout(); };

  /* =====================================================================
     LOADING
     ===================================================================== */
  F.loadSocial = async () => {
    await loadMyProfile();
    F.renderMe(); F.emit("data");
    if (S.socialMissing) { renderPartners(); return; }
    await Promise.all([loadPartners(), loadNotifs()]);
    await loadConvos();
    renderPartners(); renderConvos(); F.emit("data");
    F.startLive();
  };
})();
