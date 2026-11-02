/* Stickers in chats: the Funi pack, your own collection (up to 400), saving a sticker a friend sends,
 * and bringing in all your WhatsApp stickers from an exported chat (.zip) or sticker files. */
(function () {
  "use strict";
  const F = window.Funi, $ = F.$, esc = F.esc, S = F.s;
  const BUCKET = "stickers", MAX = 400, MAX_BYTES = 1024 * 1024;
  const me = () => (F.me ? F.me.id : "");

  /* ---------- the Funi pack (drawn here, so they cost no storage and work offline) ---------- */
  function face(mood, x, y) {
    var e = '<ellipse cx="' + (x - 14) + '" cy="' + y + '" rx="5" ry="6.5" fill="#2B2540"/><ellipse cx="' + (x + 14) + '" cy="' + y + '" rx="5" ry="6.5" fill="#2B2540"/>' +
      '<circle cx="' + (x - 12) + '" cy="' + (y - 2) + '" r="1.8" fill="#fff"/><circle cx="' + (x + 16) + '" cy="' + (y - 2) + '" r="1.8" fill="#fff"/>' +
      '<ellipse cx="' + (x - 24) + '" cy="' + (y + 10) + '" rx="6" ry="4" fill="#FF8FAB" opacity=".7"/><ellipse cx="' + (x + 24) + '" cy="' + (y + 10) + '" rx="6" ry="4" fill="#FF8FAB" opacity=".7"/>';
    var m = { smile: 'M' + (x - 9) + ' ' + (y + 12) + ' Q' + x + ' ' + (y + 22) + ' ' + (x + 9) + ' ' + (y + 12),
      open: 'M' + (x - 8) + ' ' + (y + 12) + ' Q' + x + ' ' + (y + 26) + ' ' + (x + 8) + ' ' + (y + 12) + ' Z',
      flat: 'M' + (x - 7) + ' ' + (y + 15) + ' L' + (x + 7) + ' ' + (y + 15),
      sad: 'M' + (x - 8) + ' ' + (y + 19) + ' Q' + x + ' ' + (y + 11) + ' ' + (x + 8) + ' ' + (y + 19) }[mood];
    return e + '<path d="' + m + '" fill="' + (mood === 'open' ? '#C23B5C' : 'none') + '" stroke="#2B2540" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>';
  }
  var OUT = ' stroke="#fff" stroke-width="9" paint-order="stroke" stroke-linejoin="round"';
  var SHAPES = {
    book: function (c) { return '<rect x="34" y="22" width="92" height="96" rx="12" fill="' + c + '"' + OUT + '/><rect x="34" y="22" width="14" height="96" rx="6" fill="#00000022"/>' + face('smile', 86, 62); },
    egg: function () { return '<path d="M30 70 Q24 30 64 28 Q90 14 116 34 Q140 50 128 84 Q120 116 82 112 Q40 118 30 70Z" fill="#fff" stroke="#E7E0F1" stroke-width="3"/><circle cx="80" cy="70" r="30" fill="#FFC531"' + OUT + '/>' + face('sad', 80, 66) + '<path d="M58 34 q4 -10 0 -18 M80 30 q4 -10 0 -18 M102 34 q4 -10 0 -18" stroke="#B7AECB" stroke-width="3" fill="none" stroke-linecap="round"/>'; },
    cup: function (c) { return '<path d="M112 52 h10 a14 14 0 0 1 0 28 h-10" fill="none" stroke="' + c + '" stroke-width="9"/><path d="M38 38 h76 l-8 78 a10 10 0 0 1 -10 9 h-40 a10 10 0 0 1 -10 -9z" fill="' + c + '"' + OUT + '/><rect x="36" y="30" width="80" height="12" rx="6" fill="#C23B5C"/>' + face('flat', 76, 72); },
    heart: function (c) { return '<path d="M80 122 C24 88 22 40 54 34 C68 32 78 42 80 50 C82 42 92 32 106 34 C138 40 136 88 80 122Z" fill="' + c + '"' + OUT + '/>' + face('smile', 80, 66); },
    brain: function (c) { return '<path d="M44 78 Q26 66 38 48 Q40 28 62 30 Q72 18 88 26 Q108 20 116 38 Q136 46 126 66 Q134 88 112 94 Q104 112 82 106 Q62 114 52 98 Q34 96 44 78Z" fill="' + c + '"' + OUT + '/><path d="M80 30 Q74 60 82 102 M56 50 q10 6 6 18 M104 48 q-10 8 -4 20" stroke="#00000030" stroke-width="3" fill="none" stroke-linecap="round"/>' + face('flat', 80, 66); },
    paper: function (c) { return '<path d="M40 20 h60 l22 22 v76 a6 6 0 0 1 -6 6 h-76 a6 6 0 0 1 -6 -6 v-92 a6 6 0 0 1 6 -6z" fill="' + c + '"' + OUT + '/><path d="M100 20 v22 h22" fill="#00000018"/><path d="M52 44 h34 M52 54 h44" stroke="#9A8FBD" stroke-width="3" stroke-linecap="round"/>' + face('open', 80, 78); },
    star: function (c) { return '<path d="M80 18 L96 54 L134 58 L105 82 L114 120 L80 100 L46 120 L55 82 L26 58 L64 54Z" fill="' + c + '"' + OUT + '/>' + face('smile', 80, 74); },
    blob: function (c) { return '<path d="M30 76 Q30 30 78 28 Q130 26 130 74 Q132 118 80 118 Q30 120 30 76Z" fill="' + c + '"' + OUT + '/><path d="M58 24 L64 10 L72 24 L80 8 L88 24 L96 10 L102 24" fill="#FFC531" stroke="#fff" stroke-width="5" paint-order="stroke" stroke-linejoin="round"/>' + face('open', 80, 66); },
    sleep: function (c) { return '<path d="M30 76 Q30 30 78 28 Q130 26 130 74 Q132 118 80 118 Q30 120 30 76Z" fill="' + c + '"' + OUT + '/><path d="M58 64 q8 6 16 0 M86 64 q8 6 16 0" stroke="#2B2540" stroke-width="3.5" fill="none" stroke-linecap="round"/><ellipse cx="80" cy="86" rx="6" ry="5" fill="#2B2540"/><text x="112" y="40" font-family="Arial Rounded MT Bold, Arial, sans-serif" font-weight="900" font-size="22" fill="#7556DC" stroke="#fff" stroke-width="5" paint-order="stroke">z</text><text x="124" y="24" font-family="Arial Rounded MT Bold, Arial, sans-serif" font-weight="900" font-size="16" fill="#7556DC" stroke="#fff" stroke-width="4" paint-order="stroke">z</text>'; }
  };
  function sticker(shape, color, text) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><defs><filter id="d" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-opacity=".25"/></filter></defs><g filter="url(#d)">' +
      SHAPES[shape](color) + '<text x="80" y="148" text-anchor="middle" font-family="Arial Rounded MT Bold, Arial Black, Arial, sans-serif" font-weight="900" font-size="' + (text.length > 11 ? 17 : 21) + '" fill="#2B2540" stroke="#fff" stroke-width="7" paint-order="stroke" stroke-linejoin="round">' + text + '</text></g></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  const PACK = [["book", "#8F78F0", "Let's study!"], ["cup", "#E9A15B", "Exam mode"], ["heart", "#FF7A9C", "Proud of you"], ["brain", "#FFB3C7", "Brain empty"],
    ["paper", "#FFFFFF", "Send notes pls"], ["star", "#FFC531", "Slay!"], ["blob", "#7FD6B0", "We pass!"], ["sleep", "#B9C7FF", "Nap first"], ["egg", "", "I'm cooked"]]
    .map((s, i) => ({ ref: "funi:" + i, alt: s[2], src: sticker(s[0], s[1], s[2]) }));
  F.STICKER_PACK = PACK;

  /* ---------- showing a sticker (kept on this phone after the first time, so they show offline) ---------- */
  const urls = {};
  const cacheName = () => "funi-files-stk-" + me();
  const cacheKey = (path) => location.origin + "/__stk/" + encodeURIComponent(path);
  F.stickerSrc = async (ref) => {
    if (!ref) return "";
    if (ref.startsWith("funi:")) { const p = PACK[+ref.slice(5)]; return p ? p.src : ""; }
    if (urls[ref]) return urls[ref];
    let blob = null;
    try { const c = await caches.open(cacheName()); const r = await c.match(cacheKey(ref)); if (r) blob = await r.blob(); } catch (e) {}
    if (!blob) {
      const { data, error } = await F.sb.storage.from(BUCKET).download(ref);
      if (error || !data) return "";
      blob = data;
      try { const c = await caches.open(cacheName()); await c.put(cacheKey(ref), new Response(blob, { headers: { "Content-Type": blob.type || "image/webp" } })); } catch (e) {}
    }
    return (urls[ref] = URL.createObjectURL(blob));
  };
  F.fillStickers = (root) => {
    (root || document).querySelectorAll("img[data-stk]:not([src])").forEach(async (img) => {
      const u = await F.stickerSrc(img.dataset.stk);
      if (u) img.src = u; else img.replaceWith(Object.assign(document.createElement("span"), { className: "stk-missing", textContent: "Sticker" }));
    });
  };
  F.stickerHtml = (ref, alt) => ref.startsWith("funi:") ? '<img class="stk" src="' + (PACK[+ref.slice(5)] || {}).src + '" alt="' + esc(alt || "Sticker") + '">' : '<img class="stk" data-stk="' + esc(ref) + '" alt="' + esc(alt || "Sticker") + '">';

  /* ---------- my collection ---------- */
  let mine = null; // [{id, path, hash, mime, size}]
  async function loadMine(force) {
    if (!mine) try { mine = JSON.parse(localStorage.getItem("funi.stk." + me()) || "null"); } catch (e) {}
    if (mine && !force && !loadMine.fresh) { loadMine.fresh = true; loadMine(true); return mine; }
    if (mine && !force) return mine;
    if (F.looksOffline()) return mine || [];
    const { data, error } = await F.sb.from("stickers").select("id,path,hash,mime,size,created_at").order("created_at", { ascending: false }).limit(MAX);
    if (error) { if (/stickers/.test(error.message) && /exist|schema/.test(error.message)) F.toast("Stickers need one setup step: run funi-v13-setup.sql in Supabase.", { long: true }); return mine || []; }
    mine = data || [];
    try { localStorage.setItem("funi.stk." + me(), JSON.stringify(mine)); } catch (e) {}
    return mine;
  }
  const saveMineLocal = () => { try { localStorage.setItem("funi.stk." + me(), JSON.stringify(mine)); } catch (e) {} };
  F.on("login", () => { mine = null; loadMine.fresh = false; try { mine = JSON.parse(localStorage.getItem("funi.stk." + me()) || "null"); } catch (e) {} });

  async function hashOf(blob) {
    const buf = await blob.arrayBuffer();
    if (window.crypto && crypto.subtle) { const h = await crypto.subtle.digest("SHA-256", buf); return [...new Uint8Array(h)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join(""); }
    let h = 2166136261; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619); } return "f" + (h >>> 0).toString(16) + u.length.toString(16);
  }
  // big photos become small stickers (512 px)
  async function toSticker(blob) {
    if (blob.size <= MAX_BYTES && /webp|png|gif/.test(blob.type)) return blob;
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 512 / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    let out = await new Promise((r) => c.toBlob(r, "image/webp", 0.85));
    if (!out || out.type !== "image/webp" || out.size > MAX_BYTES) out = await new Promise((r) => c.toBlob(r, "image/png"));
    if (!out || out.size > MAX_BYTES) out = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    return out;
  }
  // add one sticker to my collection. Returns "added" | "have" | "full" | throws
  async function addOne(blob, hash) {
    await loadMine();
    hash = hash || await hashOf(blob);
    if (mine.some((s) => s.hash === hash)) return "have";
    if (mine.length >= MAX) return "full";
    const mime = /png/.test(blob.type) ? "image/png" : /gif/.test(blob.type) ? "image/gif" : /jpe?g/.test(blob.type) ? "image/jpeg" : "image/webp";
    const path = me() + "/" + hash + "." + mime.split("/")[1].replace("jpeg", "jpg");
    const up = await F.sb.storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: false });
    if (up.error && !/exist|duplicate/i.test(up.error.message)) throw new Error(up.error.message);
    const { data, error } = await F.sb.from("stickers").insert({ user_id: me(), path, hash, mime, size: blob.size }).select("id,path,hash,mime,size,created_at").single();
    if (error) { if (/duplicate|23505/.test(error.message + error.code)) return "have"; if (/400/.test(error.message)) return "full"; throw new Error(error.message); }
    mine.unshift(data); saveMineLocal();
    try { const c = await caches.open(cacheName()); await c.put(cacheKey(path), new Response(blob, { headers: { "Content-Type": mime } })); } catch (e) {}
    return "added";
  }

  /* ---------- saving a sticker a friend sent ---------- */
  F.saveSticker = async (ref) => {
    if (!ref) return;
    if (ref.startsWith("funi:")) return F.toast("That one is in the 😊 Funi pack already.");
    if (F.looksOffline()) return F.toast("You need internet to save a sticker.");
    try {
      const { data, error } = await F.sb.storage.from(BUCKET).download(ref);
      if (error || !data) throw new Error(error ? error.message : "missing");
      const r = await addOne(data);
      F.toast(r === "added" ? "⭐ Saved to My stickers" : r === "have" ? "You have this sticker already." : "You have 400 stickers. Remove some first.");
      if ($("stkTray") && !$("stkTray").hidden) renderTray();
    } catch (e) { F.toast("Couldn't save that sticker: " + e.message, { long: true }); }
  };

  /* ---------- the sticker tray in a chat ---------- */
  let tab = "funi";
  try { tab = localStorage.getItem("funi.stkTab") || "funi"; } catch (e) {}
  const recent = () => { try { return JSON.parse(localStorage.getItem("funi.stkRecent") || "[]"); } catch (e) { return []; } };
  function pushRecent(ref) { const r = [ref].concat(recent().filter((x) => x !== ref)).slice(0, 24); try { localStorage.setItem("funi.stkRecent", JSON.stringify(r)); } catch (e) {} }
  async function renderTray() {
    document.querySelectorAll("#stkTabs [data-stab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.stab === tab)));
    const box = $("stkGrid");
    if (tab === "funi") box.innerHTML = PACK.map((p) => '<button type="button" class="stk-cell" data-stk-send="' + p.ref + '" aria-label="Send sticker: ' + esc(p.alt) + '"><img src="' + p.src + '" alt=""></button>').join("");
    else if (tab === "recent") {
      const r = recent();
      box.innerHTML = r.length ? r.map((ref) => '<button type="button" class="stk-cell" data-stk-send="' + esc(ref) + '" aria-label="Send this sticker again">' + F.stickerHtml(ref, "") + "</button>").join("") : '<p class="stk-empty">Stickers you send show up here.</p>';
    } else {
      const list = await loadMine();
      if (tab !== "mine") return;
      box.innerHTML = '<button type="button" class="stk-cell stk-add" id="stkImportOpen"><span aria-hidden="true">📥</span>From WhatsApp</button>' +
        list.map((s) => '<button type="button" class="stk-cell" data-stk-send="' + esc(s.path) + '" data-stk-id="' + esc(s.id) + '" aria-label="Send sticker. Hold to remove it">' + F.stickerHtml(s.path, "") + "</button>").join("") +
        (list.length ? "" : '<p class="stk-empty">Hold a sticker a friend sends you to save it here, or bring all your WhatsApp stickers in one go.</p>');
      $("stkCount").textContent = list.length + " of " + MAX;
    }
    $("stkCount").hidden = tab !== "mine";
    F.fillStickers(box);
  }
  F.toggleStickers = (show) => {
    const t = $("stkTray"), on = show == null ? t.hidden : show;
    t.hidden = !on; $("stkBtn").setAttribute("aria-pressed", String(on));
    if (on) { document.activeElement && document.activeElement.blur && document.activeElement === $("chatInput") && $("chatInput").blur(); renderTray(); F.scrollTo("end"); }
  };
  $("stkBtn").onclick = () => F.toggleStickers();
  F.on("view", () => { if (!$("stkTray").hidden) F.toggleStickers(false); });
  $("chatInput").addEventListener("focus", () => { if (!$("stkTray").hidden) F.toggleStickers(false); });
  $("stkTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-stab]"); if (!b) return; tab = b.dataset.stab; try { localStorage.setItem("funi.stkTab", tab); } catch (x) {} renderTray(); });
  let pressT = null, pressed = false;
  $("stkGrid").addEventListener("pointerdown", (e) => {
    const b = e.target.closest("[data-stk-id]"); pressed = false; if (!b) return;
    clearTimeout(pressT); pressT = setTimeout(() => { pressed = true; removeSticker(b.dataset.stkId); }, 550);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => $("stkGrid").addEventListener(ev, () => clearTimeout(pressT)));
  $("stkGrid").addEventListener("contextmenu", (e) => { const b = e.target.closest("[data-stk-id]"); if (!b) return; e.preventDefault(); clearTimeout(pressT); pressed = true; removeSticker(b.dataset.stkId); });
  $("stkGrid").addEventListener("click", (e) => {
    if (e.target.closest("#stkImportOpen")) return openImport();
    const b = e.target.closest("[data-stk-send]"); if (!b || pressed) { pressed = false; return; }
    pushRecent(b.dataset.stkSend);
    if (F.sendSticker) F.sendSticker(b.dataset.stkSend);
  });
  async function removeSticker(id) {
    const s = (mine || []).find((x) => x.id === id); if (!s) return;
    if (!(await F.confirm("Remove this sticker?", "It leaves My stickers. Chats where you already sent it still show it.", "Remove"))) return;
    const { error } = await F.sb.from("stickers").delete().eq("id", id);
    if (error) return F.toast("Couldn't remove it: " + error.message, { long: true });
    mine = mine.filter((x) => x.id !== id); saveMineLocal(); renderTray();
  }

  /* ---------- bring your WhatsApp stickers ---------- */
  const STEPS = {
    iphone: ["In WhatsApp, make a group with only you in it (call it “Stickers”). Send it every sticker you want to keep.",
      "Tap the group name at the top, scroll down and tap <b>Export Chat</b>. If it asks you to choose media types, turn everything off except <b>Stickers</b>, then tap <b>Export</b>. (Older WhatsApp: tap <b>Attach Media</b>.)",
      "Choose <b>Save to Files</b> › <b>On My iPhone</b> › <b>Save</b>.",
      "Tap the button below and pick the file that starts with <b>“WhatsApp Chat”</b>. Funi takes out all the stickers.",
      "Shortcut: export a chat with a friend you send lots of stickers to. Funi takes every sticker in it."],
    android: ["Tap the button below, then go to <b>Android › media › com.whatsapp › WhatsApp › Media › WhatsApp Stickers</b> and select all.",
      "Can't see that folder? Make a WhatsApp group with only you, send it your stickers, then tap the group name › <b>Export chat</b> › <b>Include media</b> and save it. Pick that file here."],
    laptop: ["Exported a chat on your phone? Send the file to yourself and pick it here.",
      "Or open WhatsApp Web, right-click a sticker, choose <b>Save image as</b>, and pick the saved stickers here. You can choose lots at once."] };
  let impTab = /android/i.test(navigator.userAgent) ? "android" : /iphone|ipad|ipod/i.test(navigator.userAgent) ? "iphone" : "laptop", busy = false;
  function renderImport() {
    document.querySelectorAll("#stkImpTabs [data-itab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.itab === impTab)));
    $("stkImpSteps").innerHTML = STEPS[impTab].map((t, i) => "<li><b>" + (i + 1) + "</b><span>" + t + "</span></li>").join("");
  }
  function openImport() { if (!busy) { $("stkImpResult").hidden = true; $("stkImpProg").hidden = true; } renderImport(); $("stkImportSheet").showModal(); }
  F.openStickerImport = openImport;
  $("stkImpTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-itab]"); if (b) { impTab = b.dataset.itab; renderImport(); } });
  $("stkImpPick").onclick = () => { if (!busy) $("stkImpInput").click(); };
  $("stkImpInput").onchange = async () => { const files = [...$("stkImpInput").files]; $("stkImpInput").value = ""; if (files.length) importFiles(files); };
  function loadZip() {
    if (window.fflate) return Promise.resolve(window.fflate);
    return new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "/js/vendor/fflate.min.js"; sc.onload = () => res(window.fflate); sc.onerror = () => rej(new Error("Couldn't open the zip reader. Check your internet and try again.")); document.head.appendChild(sc); });
  }
  const isStickerName = (n) => /\.webp$/i.test(n) || (/(sticker|stk-)/i.test(n) && /\.(png|gif)$/i.test(n));
  async function unzipStickers(file, note) {
    if (file.size > 400 * 1024 * 1024) throw new Error("That export is too big for a phone to open (over 400 MB). Export the “Stickers” group instead, or a chat with fewer photos.");
    const fflate = await loadZip();
    const buf = new Uint8Array(await file.arrayBuffer());
    return new Promise((res, rej) => {
      fflate.unzip(buf, { filter: (f) => {
        const base = f.name.split("/").pop();
        if (!base || /^__MACOSX|\/\._/.test(f.name) || base.startsWith("._") || /\.txt$/i.test(base)) return false;
        if (isStickerName(base) && f.originalSize <= MAX_BYTES) return true;
        note.other++; return false;
      } }, (err, out) => {
        if (err) return rej(new Error("That doesn't look like a WhatsApp export. Pick the file that starts with “WhatsApp Chat”."));
        res(Object.keys(out).map((name) => new Blob([out[name]], { type: /\.png$/i.test(name) ? "image/png" : /\.gif$/i.test(name) ? "image/gif" : "image/webp" })));
      });
    });
  }
  async function importFiles(files) {
    if (F.looksOffline()) return F.toast("You need internet to add stickers.");
    busy = true; $("stkImpPick").disabled = true; $("stkImpResult").hidden = true;
    const prog = $("stkImpProg"); prog.hidden = false; prog.textContent = "Opening…";
    const note = { other: 0, big: 0 }; let blobs = [];
    try {
      for (const f of files) {
        if (/\.zip$/i.test(f.name) || /zip/.test(f.type)) { prog.textContent = "Looking for stickers in " + f.name + "…"; blobs = blobs.concat(await unzipStickers(f, note)); }
        else if (/^image\//.test(f.type) || /\.(webp|png|gif|jpe?g|heic)$/i.test(f.name)) blobs.push(f);
        else note.other++;
      }
      await loadMine(true);
      // same sticker twice? keep one
      const seen = new Set(mine.map((s) => s.hash)), todo = [];
      let have = 0;
      for (const b of blobs) { let x = b; try { x = await toSticker(b); } catch (e) { note.other++; continue; } if (!x || x.size > MAX_BYTES) { note.big++; continue; } const h = await hashOf(x); if (seen.has(h)) { have++; continue; } seen.add(h); todo.push([x, h]); }
      const room = Math.max(0, MAX - mine.length), go = todo.slice(0, room);
      let added = 0, failed = 0;
      for (let i = 0; i < go.length; i++) {
        prog.textContent = "Adding sticker " + (i + 1) + " of " + go.length + "…";
        try { const r = await addOne(go[i][0], go[i][1]); if (r === "added") added++; else if (r === "have") have++; } catch (e) { failed++; if (F.looksOffline(e)) break; }
      }
      prog.hidden = true;
      const parts = [];
      if (have) parts.push(have + " you already had");
      if (note.other) parts.push(note.other + " photos, videos or other files skipped");
      if (note.big) parts.push(note.big + " too big");
      if (todo.length > room) parts.push((todo.length - room) + " didn't fit (400 is the limit)");
      if (failed) parts.push(failed + " couldn't upload. Try again later");
      $("stkImpResult").hidden = false;
      $("stkImpResult").className = "stk-result" + (added ? " ok" : "");
      $("stkImpResult").innerHTML = (added ? "✅ Added <b>" + added + "</b> sticker" + (added === 1 ? "" : "s") + " to My stickers." : blobs.length ? "No new stickers to add." : "No stickers found in that file. When exporting, keep <b>Stickers</b> turned on (or choose <b>Attach Media</b>).") + (parts.length ? "<br><span>" + parts.join(" · ") + "</span>" : "");
      tab = "mine"; try { localStorage.setItem("funi.stkTab", tab); } catch (e) {}
      if (!$("stkTray").hidden) renderTray();
    } catch (e) {
      prog.hidden = true; $("stkImpResult").hidden = false; $("stkImpResult").className = "stk-result"; $("stkImpResult").textContent = e.message;
    } finally { busy = false; $("stkImpPick").disabled = false; }
  }
})();
