/* Funi files: notes, past papers, photos and links saved under each module.
 * Private to you (module-files storage). 10 MB a file, 50 MB each, so Funi stays free. */
(function () {
  "use strict";
  const F = window.Funi, $ = F.$, esc = F.esc, S = F.s;
  const MAX_FILE = 10 * 1024 * 1024, MAX_SPACE = 50 * 1024 * 1024, BUCKET = "module-files";
  const FOLDERS = ["Notes", "Past papers", "Photos", "Other"];
  const FILTERS = ["All"].concat(FOLDERS, ["Links"]);
  const sameCode = (a, b) => String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase();
  const ICON = {
    folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/></svg>',
    del: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>'
  };
  S.files = [];
  let curCode = null, filter = "All", missing = false;
  const urlCache = {}; // path -> { url, until }

  /* ---------- helpers ---------- */
  const mb = (n) => (n / 1048576 < 10 ? (n / 1048576).toFixed(1) : Math.round(n / 1048576)) + " MB";
  const sizeTxt = (n) => (n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : mb(n));
  const used = () => S.files.reduce((t, f) => t + (f.kind === "file" ? +f.size || 0 : 0), 0);
  function kindOf(f) {
    if (f.kind === "link") return ["LINK", "c-sky"];
    const m = (f.mime || "") + " " + (f.name || "") + " " + (f.path || "");
    if (/image\//.test(m) || /\.(jpe?g|png|gif|webp|heic)\b/i.test(m)) return ["IMG", "c-mint"];
    if (/pdf/i.test(m)) return ["PDF", "c-peach"];
    if (/word|\.docx?\b/i.test(m)) return ["DOC", "c-lav"];
    if (/presentation|powerpoint|\.pptx?\b/i.test(m)) return ["PPT", "c-pink"];
    if (/sheet|excel|\.xlsx?\b|\.csv\b/i.test(m)) return ["XLS", "c-mint"];
    return ["FILE", "c-butter"];
  }
  function when(iso) {
    if (!iso) return "";
    const d = new Date(iso), days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 864e5);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  function modName(code) { const m = (F.orderedModules ? F.orderedModules() : []).find((x) => sameCode(x.code, code)); return m && m.name ? m.name : ""; }
  function moduleCodes() {
    const codes = (F.orderedModules ? F.orderedModules() : []).map((m) => m.code.trim().toUpperCase());
    S.files.forEach((f) => { const c = f.module_code.trim().toUpperCase(); if (!codes.includes(c)) codes.push(c); });
    return codes;
  }
  async function signedUrls(paths) {
    const now = Date.now(), need = [...new Set(paths)].filter((p) => !urlCache[p] || urlCache[p].until < now + 60000);
    if (need.length) {
      const { data } = await F.sb.storage.from(BUCKET).createSignedUrls(need, 3600);
      (data || []).forEach((r) => { if (r.signedUrl) urlCache[r.path] = { url: r.signedUrl, until: now + 3500e3 }; });
    }
  }
  const hrefOf = (f) => (f.kind === "link" ? f.url : urlCache[f.path] ? urlCache[f.path].url : "");

  /* ---------- loading ---------- */
  async function loadFiles() {
    if (!F.sb || !F.me) return;
    const { data, error } = await F.sb.from("module_files").select("*").order("created_at", { ascending: false });
    missing = !!error; S.files = error ? [] : data || [];
    if (S.view === "files") renderFiles();
    if (S.view === "modfiles") renderModFiles();
  }
  F.loadFiles = loadFiles;

  /* ---------- My modules page ---------- */
  function fileRow(f, opts) {
    const [k, cls] = kindOf(f), href = hrefOf(f);
    const meta = opts && opts.recent ? f.module_code + " · opened " + when(f.opened_at) : f.folder + " · " + (f.kind === "link" ? "Link" : sizeTxt(+f.size || 0)) + " · " + when(f.created_at);
    const inner = '<span class="file-ic ' + cls + '">' + k + '</span><span class="file-txt"><b>' + esc(f.name) + "</b><span>" + esc(meta) + "</span></span>";
    const open = k === "IMG" && href
      ? '<button type="button" class="file-open" data-img="' + esc(f.id) + '">' + inner + "</button>"
      : href ? '<a class="file-open" href="' + esc(href) + '" target="_blank" rel="noopener" data-open="' + esc(f.id) + '">' + inner + "</a>"
        : '<span class="file-open">' + inner + "</span>";
    if (opts && opts.recent) return '<div class="file-row">' + open + "</div>";
    return '<div class="file-row">' + open +
      '<button type="button" class="icon-btn" data-send-file="' + esc(f.id) + '" aria-label="Send ' + esc(f.name) + ' to a study partner">' + ICON.send + "</button>" +
      '<button type="button" class="icon-btn" data-del-file="' + esc(f.id) + '" aria-label="Delete ' + esc(f.name) + '">' + ICON.del + "</button></div>";
  }
  async function renderFiles() {
    const u = used(), pct = Math.min(100, Math.round((u / MAX_SPACE) * 100));
    $("spaceUsed").textContent = mb(u) + " of 50 MB";
    $("spaceBar").style.width = Math.max(u ? 2 : 0, pct) + "%";
    $("spaceBar").parentElement.classList.toggle("full", pct >= 90);
    const codes = moduleCodes();
    if (missing) $("modTiles").innerHTML = '<div class="empty" style="grid-column:1/-1"><b>Files aren\'t switched on yet</b><span>Run funi-v5-setup.sql in Supabase, then come back.</span></div>';
    else if (!codes.length) $("modTiles").innerHTML = '<div class="empty" style="grid-column:1/-1"><b>Add your modules first</b><span>Each module gets its own space for notes, past papers and photos.</span><button type="button" class="btn primary small" data-go="priorities">Add modules</button></div>';
    else $("modTiles").innerHTML = codes.map((c) => {
      const n = S.files.filter((f) => sameCode(f.module_code, c)).length, nm = modName(c);
      return '<button type="button" class="mod-tile ' + (F.colorOf ? F.colorOf(c) : "c-lav") + '" data-mod="' + esc(c) + '"><span class="fi">' + ICON.folder + "</span><b>" + esc(c) + "</b>" +
        (nm ? '<span class="nm">' + esc(nm) + "</span>" : "") + '<span class="ct">' + (n ? n + " file" + (n === 1 ? "" : "s") : "No files yet") + "</span></button>";
    }).join("");
    const recent = S.files.filter((f) => f.opened_at).sort((a, b) => b.opened_at.localeCompare(a.opened_at)).slice(0, 3);
    $("recentCard").hidden = !recent.length;
    if (recent.length) {
      await signedUrls(recent.filter((f) => f.kind === "file").map((f) => f.path));
      $("recentList").innerHTML = recent.map((f) => fileRow(f, { recent: true })).join("");
    }
  }
  $("modTiles").addEventListener("click", (e) => { const b = e.target.closest("[data-mod]"); if (b) F.go("modfiles:" + b.dataset.mod); });

  /* ---------- One module ---------- */
  async function renderModFiles() {
    if (!curCode) return;
    const nm = modName(curCode), mine = S.files.filter((f) => sameCode(f.module_code, curCode));
    $("mfTitle").textContent = curCode;
    $("mfHero").className = "mf-hero " + (F.colorOf ? F.colorOf(curCode) : "c-lav");
    $("mfName").textContent = nm || curCode;
    const ex = F.nextExamFor ? F.nextExamFor(curCode) : null, d = ex ? F.daysLeft(ex.due_date) : 0;
    const exTxt = ex ? (ex.kind || "Test") + (d === 0 ? " today" : d === 1 ? " tomorrow" : " in " + d + " days") : "";
    $("mfMeta").textContent = [exTxt, mine.length + " file" + (mine.length === 1 ? "" : "s")].filter(Boolean).join(" · ");
    $("mfChips").innerHTML = FILTERS.map((c) => '<button type="button" role="tab" class="chip' + (filter === c ? " on" : "") + '" aria-selected="' + (filter === c) + '" data-filter="' + esc(c) + '">' + esc(c) + "</button>").join("");
    const list = mine.filter((f) => filter === "All" || (filter === "Links" ? f.kind === "link" : f.folder === filter && f.kind !== "link"));
    if (missing) { $("mfList").innerHTML = '<div class="empty"><b>Files aren\'t switched on yet</b><span>Run funi-v5-setup.sql in Supabase, then come back.</span></div>'; return; }
    if (!list.length) {
      $("mfList").innerHTML = '<div class="empty"><b>' + (mine.length ? "Nothing in " + esc(filter) + " yet" : "No files yet") + '</b><span>Add lecture notes, past papers, photos of the board or a Google Drive link.</span><button type="button" class="btn primary small" data-add-file>Add a file</button></div>';
      return;
    }
    await signedUrls(list.filter((f) => f.kind === "file").map((f) => f.path));
    $("mfList").innerHTML = list.map((f) => fileRow(f)).join("");
  }
  $("mfChips").addEventListener("click", (e) => { const b = e.target.closest("[data-filter]"); if (!b) return; filter = b.dataset.filter; renderModFiles(); });
  $("mfStudy").onclick = () => { F.go("study"); const sel = $("sesModule"); if (sel && [...sel.options].some((o) => o.value === curCode)) sel.value = curCode; };

  // open / send / delete (works on both pages)
  function byId(id) { return S.files.find((f) => f.id === id); }
  function markOpened(f) {
    f.opened_at = new Date().toISOString();
    F.sb.from("module_files").update({ opened_at: f.opened_at }).eq("id", f.id).then(() => {}, () => {});
  }
  document.addEventListener("click", async (e) => {
    const t = e.target;
    const img = t.closest("[data-img]");
    if (img) { const f = byId(img.dataset.img); if (!f) return; $("imgFull").src = hrefOf(f); $("imgSheet").showModal(); markOpened(f); return; }
    const op = t.closest("[data-open]");
    if (op) { const f = byId(op.dataset.open); if (f) markOpened(f); return; }
    const add = t.closest("[data-add-file]");
    if (add) { openSheet(); return; }
    const snd = t.closest("[data-send-file]");
    if (snd) { const f = byId(snd.dataset.sendFile); if (f) openSend(f); return; }
    const del = t.closest("[data-del-file]");
    if (del) {
      const f = byId(del.dataset.delFile); if (!f) return;
      if (!(await F.confirm("Delete " + f.name + "?", f.kind === "link" ? "The link is removed from Funi. The file in your Drive stays." : "This frees up " + sizeTxt(+f.size || 0) + ". It can't be undone.", "Delete"))) return;
      if (f.kind === "file") await F.sb.storage.from(BUCKET).remove([f.path]);
      const { error } = await F.sb.from("module_files").delete().eq("id", f.id);
      if (error) return F.toast("Couldn't delete: " + error.message, { long: true });
      S.files = S.files.filter((x) => x.id !== f.id);
      renderModFiles(); F.toast("Deleted.");
    }
  });

  /* ---------- Add sheet ---------- */
  let mode = null, picked = null, folder = "Notes";
  function drawFolders() {
    $("fsFolders").innerHTML = FOLDERS.map((c) => '<button type="button" class="chip' + (folder === c ? " on" : "") + '" aria-pressed="' + (folder === c) + '" data-folder="' + esc(c) + '">' + esc(c) + "</button>").join("");
  }
  $("fsFolders").addEventListener("click", (e) => { const b = e.target.closest("[data-folder]"); if (!b) return; folder = b.dataset.folder; drawFolders(); });
  function setMode(m) {
    mode = m;
    ["fsUpload", "fsPhoto", "fsLink"].forEach((id) => $(id).setAttribute("aria-pressed", String((id === "fsUpload" && m === "file") || (id === "fsPhoto" && m === "photo") || (id === "fsLink" && m === "link"))));
    $("fsLinkBox").hidden = m !== "link";
    $("fsNameBox").hidden = !(m === "link" || picked);
    $("fsPicked").hidden = !(picked && m !== "link");
  }
  function openSheet() {
    if (missing) return F.toast("Run funi-v5-setup.sql in Supabase first, then you can add files.", { long: true });
    picked = null; $("fsUrl").value = ""; $("fsName").value = ""; F.showError("fsError", "");
    folder = FOLDERS.includes(filter) ? filter : "Notes";
    $("fsTitle").textContent = "Add to " + curCode;
    setMode(null); drawFolders(); $("fileSheet").showModal();
  }
  $("mfAdd").onclick = openSheet;
  $("fsUpload").onclick = () => $("fsFileInput").click();
  $("fsPhoto").onclick = () => $("fsCamInput").click();
  $("fsLink").onclick = () => { picked = null; setMode("link"); $("fsUrl").focus(); };
  function onPick(input, m) {
    const f = input.files[0]; input.value = ""; if (!f) return;
    const isImg = /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name);
    if (f.size > MAX_FILE && !isImg) { F.showError("fsError", "That file is bigger than 10 MB. Save it in Google Drive and add the link instead."); return; }
    F.showError("fsError", "");
    picked = f;
    if (m === "photo" || isImg) { folder = "Photos"; drawFolders(); }
    $("fsName").value = m === "photo" ? "Photo " + new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" }) : f.name.replace(/\.[^.]+$/, "").slice(0, 120);
    $("fsPicked").textContent = f.name + " · " + sizeTxt(f.size) + (isImg ? " (will be made smaller)" : "");
    setMode(m);
  }
  $("fsFileInput").onchange = () => onPick($("fsFileInput"), "file");
  $("fsCamInput").onchange = () => onPick($("fsCamInput"), "photo");

  // photos are shrunk on the phone so they take little space
  function shrink(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        const max = 1800, s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob((b) => resolve(b && b.size < file.size ? { blob: b, type: "image/jpeg", ext: "jpg" } : { blob: file, type: file.type, ext: null }), "image/jpeg", 0.82);
      };
      im.onerror = () => { URL.revokeObjectURL(url); resolve({ blob: file, type: file.type, ext: null }); };
      im.src = url;
    });
  }

  $("fileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("fsName").value.trim().slice(0, 120);
    if (mode === "link") {
      let url = $("fsUrl").value.trim();
      if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
      if (!/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(url)) return F.showError("fsError", "Paste the full link, e.g. https://drive.google.com/...");
      const row = { user_id: F.me.id, module_code: curCode, folder, name: name || url.replace(/^https?:\/\//, "").slice(0, 60), kind: "link", url };
      $("fsSave").disabled = true;
      const { data, error } = await F.sb.from("module_files").insert(row).select().single();
      $("fsSave").disabled = false;
      if (error) return F.showError("fsError", "Couldn't save: " + error.message);
      S.files.unshift(data); $("fileSheet").close(); renderModFiles(); F.toast("Link saved to " + curCode + ".");
      return;
    }
    if (!picked) return F.showError("fsError", "Choose Upload file, Take photo or Save a link.");
    if (!name) return F.showError("fsError", "Give it a name.");
    $("fsSave").disabled = true; F.showError("fsError", "");
    let blob = picked, type = picked.type || "application/octet-stream", ext = (picked.name.match(/\.([\w]+)$/) || [])[1] || "";
    if (/^image\//.test(type) || /\.(jpe?g|png|heic|webp)$/i.test(picked.name)) {
      const r = await shrink(picked); blob = r.blob; if (r.ext) { type = r.type; ext = r.ext; }
    }
    if (blob.size > MAX_FILE) { $("fsSave").disabled = false; return F.showError("fsError", "That file is bigger than 10 MB. Save it in Google Drive and add the link instead."); }
    if (used() + blob.size > MAX_SPACE) { $("fsSave").disabled = false; return F.showError("fsError", "Your 50 MB is full. Delete some files, or save a link instead."); }
    const safe = (name.replace(/[^\w.\-]+/g, "_").slice(0, 60) || "file") + (ext ? "." + ext.toLowerCase() : "");
    const path = F.me.id + "/" + curCode.replace(/[^\w\-]+/g, "_") + "/" + Date.now() + "-" + safe;
    F.toast("Uploading " + name + "…");
    const up = await F.sb.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false });
    if (up.error) { $("fsSave").disabled = false; return F.showError("fsError", "Couldn't upload: " + up.error.message); }
    const { data, error } = await F.sb.from("module_files").insert({ user_id: F.me.id, module_code: curCode, folder, name, kind: "file", path, mime: type, size: blob.size }).select().single();
    $("fsSave").disabled = false;
    if (error) { await F.sb.storage.from(BUCKET).remove([path]); return F.showError("fsError", error.message); }
    S.files.unshift(data); $("fileSheet").close(); renderModFiles(); F.toast("Saved to " + curCode + " › " + folder + ".");
  });

  /* ---------- Send to a study partner ---------- */
  let sending = null;
  function openSend(f) {
    sending = f;
    const partners = S.partners || [];
    $("sendWhat").textContent = f.name;
    $("sendList").innerHTML = partners.length
      ? partners.map((p) => { const pr = (F.profiles || {})[p.id] || { id: p.id }; return '<button type="button" class="send-row" data-send-to="' + esc(p.id) + '"><span class="ava sm">' + F.avatar(pr) + "</span>" + esc(F.nameOf(pr)) + "</button>"; }).join("")
      : '<div class="empty"><b>No study partners yet</b><span>Invite a friend first, then you can send them files.</span><button type="button" class="btn primary small" data-go="invite" data-close="sendSheet">Invite a friend</button></div>';
    $("sendSheet").showModal();
  }
  $("sendList").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-send-to]"); if (!b || !sending) return;
    const to = b.dataset.sendTo, f = sending;
    $("sendList").querySelectorAll("button").forEach((x) => (x.disabled = true));
    const row = { sender_id: F.me.id, recipient_id: to, body: f.kind === "link" ? f.name + "\n" + f.url : "From my " + f.module_code + " files", is_help: false };
    try {
      if (f.kind === "file") {
        F.toast("Sending " + f.name + "…");
        const dl = await F.sb.storage.from(BUCKET).download(f.path);
        if (dl.error) throw dl.error;
        const ext = (f.path.match(/\.(\w+)$/) || [])[1];
        const fname = f.name + (ext && !f.name.toLowerCase().endsWith("." + ext) ? "." + ext : "");
        const cpath = F.me.id + "/" + to + "/" + Date.now() + "-" + fname.replace(/[^\w.\-]+/g, "_").slice(-60);
        const up = await F.sb.storage.from("chat-files").upload(cpath, dl.data, { contentType: f.mime || "application/octet-stream", upsert: false });
        if (up.error) throw up.error;
        Object.assign(row, { file_path: cpath, file_name: fname, file_type: f.mime || null, file_size: f.size });
      }
      const { error } = await F.sb.from("study_messages").insert(row);
      if (error) throw error;
      $("sendSheet").close(); F.toast("Sent!");
      if (F.openChat) F.openChat(to);
    } catch (err) {
      F.toast("Couldn't send: " + (err.message || err), { long: true });
    } finally {
      $("sendList").querySelectorAll("button").forEach((x) => (x.disabled = false));
    }
  });

  /* ---------- hooks ---------- */
  F.on("view:files", renderFiles);
  F.on("view:modfiles", (code) => { if (code) { if (!sameCode(code, curCode)) filter = "All"; curCode = code.toUpperCase(); } renderModFiles(); });
  F.on("login", loadFiles);
  F.on("resume", loadFiles);
})();
