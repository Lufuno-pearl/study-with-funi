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

  /* ---------- helpers ---------- */
  const mb = (n) => (n / 1048576 < 10 ? (n / 1048576).toFixed(1) : Math.round(n / 1048576)) + " MB";
  const sizeTxt = (n) => (n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : mb(n));
  const used = () => S.files.reduce((t, f) => t + (f.kind === "file" ? +f.size || 0 : 0), 0);
  function kindOf(f) {
    if (f.kind === "link") return ["LINK", "c-sky"];
    const m = (f.mime || "") + " " + (f.name || "") + " " + (f.path || "");
    if (/text\/html|\.html?\b/i.test(m)) return ["HTML", "c-sky"];
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
  /* ---------- Offline copies: files are kept on this phone so they open with no internet ---------- */
  const offKey = () => "funi.offFiles." + (F.me ? F.me.id : "");
  const offOn = () => F.read(offKey(), true);
  const cacheName = () => "funi-files-" + (F.me ? F.me.id : "x");
  const offUrl = (path) => location.origin + "/__offline/" + encodeURIComponent(path);
  let offSet = new Set(), syncing = false, syncLeft = 0;
  async function offIndex() {
    try { const c = await caches.open(cacheName()); offSet = new Set((await c.keys()).map((r) => decodeURIComponent(r.url.split("/__offline/")[1] || ""))); } catch (e) { offSet = new Set(); }
  }
  async function offGet(path) {
    try { const c = await caches.open(cacheName()); const r = await c.match(offUrl(path)); return r ? await r.blob() : null; } catch (e) { return null; }
  }
  async function offPut(path, blob, type) {
    if (!offOn() || !window.caches) return;
    try { const c = await caches.open(cacheName()); await c.put(offUrl(path), new Response(blob, { headers: { "Content-Type": type || blob.type || "application/octet-stream" } })); offSet.add(path); } catch (e) {}
  }
  F.offPutFile = offPut;
  function offStatus() {
    const files = S.files.filter((f) => f.kind === "file"), have = files.filter((f) => offSet.has(f.path)).length;
    $("offToggle").checked = offOn();
    $("offStatus").textContent = !window.caches ? "This browser can't keep files offline."
      : !offOn() ? "Off. Files only open when you have internet."
      : !files.length ? "Your files will open even with no Wi-Fi, data or electricity."
      : syncing && syncLeft ? "Saving to this phone… " + have + " of " + files.length + " done."
      : have === files.length ? "All " + files.length + " file" + (files.length === 1 ? " is" : "s are") + " on this phone. They open with no Wi-Fi, data or electricity."
      : have + " of " + files.length + " on this phone. The rest save next time you're online.";
  }
  async function syncOffline() {
    if (syncing || !window.caches || !F.me || missing) return;
    syncing = true;
    try {
      await offIndex();
      const c = await caches.open(cacheName());
      const want = new Set(S.files.filter((f) => f.kind === "file").map((f) => f.path));
      for (const p of [...offSet]) if (!want.has(p) || !offOn()) { await c.delete(offUrl(p)); offSet.delete(p); }
      if (!offOn() || !navigator.onLine || (navigator.connection && navigator.connection.saveData)) return;
      // re-save copies that don't match the real file (e.g. a download that was cut off)
      for (const f of S.files) if (f.kind === "file" && offSet.has(f.path) && !goodCopy(await offGet(f.path), f)) { await c.delete(offUrl(f.path)); offSet.delete(f.path); }
      const todo = S.files.filter((f) => f.kind === "file" && !offSet.has(f.path));
      if (todo.length && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      syncLeft = todo.length; offStatus();
      for (const f of todo) {
        if (!navigator.onLine || !offOn()) break;
        const { data } = await F.sb.storage.from(BUCKET).download(f.path).catch(() => ({}));
        if (data && goodCopy(data, f)) await offPut(f.path, data, f.mime);
        syncLeft--; offStatus();
      }
    } catch (e) {} finally {
      syncing = false; syncLeft = 0; offStatus();
      if (S.view === "files") renderFiles(); if (S.view === "modfiles") renderModFiles();
    }
  }
  $("offToggle").addEventListener("change", async () => {
    F.store(offKey(), $("offToggle").checked);
    if ($("offToggle").checked) F.toast("Saving your files to this phone…"); else F.toast("Offline copies removed from this phone.");
    await syncOffline();
  });
  // a saved copy first (no data used), else download it (and keep a copy)
  // a saved copy must match the real file, otherwise get it again
  const goodCopy = (blob, f) => blob && blob.size > 0 && (!(+f.size) || blob.size === +f.size);
  async function fileBlob(f, fresh) {
    let blob = fresh ? null : await offGet(f.path);
    if (goodCopy(blob, f)) return blob;
    if (blob && F.looksOffline()) return blob; // offline: the saved copy is all we have
    if (F.looksOffline()) throw new Error("offline");
    const { data, error } = await F.sb.storage.from(BUCKET).download(f.path);
    if (error || !data) throw new Error(error ? error.message : "download failed");
    if (goodCopy(data, f)) offPut(f.path, data, f.mime);
    return data;
  }

  /* ---------- loading ---------- */
  async function loadFiles() {
    if (!F.sb || !F.me) return;
    const listKey = "funi.files." + F.me.id;
    const { data, error } = await F.sb.from("module_files").select("*").order("created_at", { ascending: false });
    if (error && F.looksOffline(error)) { missing = false; S.files = F.read(listKey, []); }
    else { missing = !!error; S.files = error ? [] : data || []; if (!error) F.store(listKey, S.files); }
    await offIndex();
    if (S.view === "files") renderFiles();
    if (S.view === "modfiles") renderModFiles();
    syncOffline();
  }
  F.loadFiles = loadFiles;

  /* ---------- My modules page ---------- */
  function fileRow(f, opts) {
    const [k, cls] = kindOf(f);
    const meta = opts && opts.recent ? f.module_code + " · opened " + when(f.opened_at) : f.folder + " · " + (f.kind === "link" ? "Link" : sizeTxt(+f.size || 0)) + " · " + when(f.created_at);
    const tick = f.kind === "file" && offSet.has(f.path) ? '<span class="off-ok" title="Opens without internet"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>Offline</span>' : "";
    const inner = '<span class="file-ic ' + cls + '">' + k + '</span><span class="file-txt"><b>' + esc(f.name) + "</b><span>" + esc(meta) + tick + "</span></span>";
    const open = f.kind === "link"
      ? '<a class="file-open" href="' + esc(f.url) + '" target="_blank" rel="noopener" data-open="' + esc(f.id) + '">' + inner + "</a>"
      : '<button type="button" class="file-open" data-fopen="' + esc(f.id) + '">' + inner + "</button>";
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
    offStatus();
    if (recent.length) {
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
    const fo = t.closest("[data-fopen]");
    if (fo) { const f = byId(fo.dataset.fopen); if (f) openFile(f); return; }
    const op = t.closest("[data-open]");
    if (op) {
      if (F.looksOffline()) { e.preventDefault(); F.toast("Links open on the internet, so they need Wi-Fi or data. Your saved files still open."); return; }
      const f = byId(op.dataset.open); if (f) markOpened(f); return;
    }
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

  async function openFile(f) {
    const [k] = kindOf(f);
    if (!F.looksOffline()) markOpened(f);
    if (k === "HTML") return F.openHtml({ bucket: BUCKET, path: f.path, title: f.name, file: f });
    if (k === "PDF") return openPdf(f);
    F.toast("Opening " + f.name + "…");
    let blob;
    try { blob = await fileBlob(f); } catch (err) {
      return F.toast(err.message === "offline" ? "This file isn't saved on this phone yet. Open it once with internet." : "Couldn't open: " + err.message, { long: true });
    }
    if (k === "IMG") { const u = URL.createObjectURL(blob); $("imgFull").src = u; $("imgSheet").showModal(); $("imgSheet").addEventListener("close", () => URL.revokeObjectURL(u), { once: true }); $("toast").hidden = true; return; }
    saveBlob(blob, f.name, f.mime); // Word, PowerPoint, Excel…: opens in your phone's own app
    $("toast").hidden = true;
  }
  function saveBlob(blob, name, type) {
    const u = URL.createObjectURL(type && !blob.type ? new Blob([blob], { type }) : blob), a = document.createElement("a");
    a.href = u; a.download = name || "file"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  }

  /* ---------- PDFs open inside Funi (also offline) ---------- */
  let pdfDoc = null, pdfZoom = 1, pdfFile = null, pdfBlob = null, pdfJob = 0;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise((res, rej) => {
      const sc = document.createElement("script"); sc.src = "/js/vendor/pdf.min.js";
      sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/js/vendor/pdf.worker.min.js"; res(window.pdfjsLib); };
      sc.onerror = () => rej(new Error("The PDF reader didn't load. Open Funi once with internet."));
      document.head.appendChild(sc);
    });
  }
  async function drawPdf() {
    const job = ++pdfJob, box = $("pvPages");
    box.innerHTML = "";
    const width = Math.min(box.clientWidth - 24, 900) * pdfZoom, dpr = Math.min(window.devicePixelRatio || 1, 2);
    $("pvInfo").textContent = pdfDoc.numPages + " page" + (pdfDoc.numPages === 1 ? "" : "s") + " · " + Math.round(pdfZoom * 100) + "%";
    for (let n = 1; n <= pdfDoc.numPages; n++) {
      if (job !== pdfJob || !$("pdfSheet").open) return;
      const page = await pdfDoc.getPage(n), v1 = page.getViewport({ scale: 1 }), scale = width / v1.width, vp = page.getViewport({ scale: scale * dpr });
      const cv = document.createElement("canvas");
      cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
      cv.style.width = Math.floor(vp.width / dpr) + "px"; cv.style.height = Math.floor(vp.height / dpr) + "px";
      cv.setAttribute("role", "img"); cv.setAttribute("aria-label", "Page " + n);
      box.appendChild(cv);
      await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
    }
  }
  async function openPdf(f) {
    pdfFile = f; pdfZoom = 1; pdfDoc = null; pdfBlob = null;
    $("pvTitle").textContent = f.name; $("pvInfo").textContent = "Opening…";
    $("pvPages").innerHTML = '<p class="pdf-msg">Opening…</p>';
    $("pdfSheet").showModal();
    try {
      const [lib, blob] = await Promise.all([loadPdfJs(), fileBlob(f)]);
      pdfBlob = blob;
      pdfDoc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      await drawPdf();
    } catch (err) {
      $("pvInfo").textContent = "";
      $("pvPages").innerHTML = '<p class="pdf-msg">' + esc(err.message === "offline" ? "This PDF isn't saved on this phone yet. Open it once with internet." : "Couldn't open this PDF. " + (err.message || "")) + "</p>";
    }
  }
  $("pvIn").onclick = () => { if (pdfDoc && pdfZoom < 3) { pdfZoom = Math.round((pdfZoom + 0.25) * 100) / 100; drawPdf(); } };
  $("pvOut").onclick = () => { if (pdfDoc && pdfZoom > 0.5) { pdfZoom = Math.round((pdfZoom - 0.25) * 100) / 100; drawPdf(); } };
  $("pvSave").onclick = () => { if (pdfBlob && pdfFile) saveBlob(pdfBlob, pdfFile.name, "application/pdf"); };
  $("pdfSheet").addEventListener("close", () => { pdfJob++; $("pvPages").innerHTML = ""; if (pdfDoc) pdfDoc.destroy(); pdfDoc = null; pdfBlob = null; });

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
      offPut(path, blob, type);
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
    offPut(path, blob, type);
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
        Object.assign(row, { file_path: cpath, file_name: fname, file_type: f.mime || (/\.html?$/i.test(fname) ? "text/html" : null), file_size: f.size });
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

  /* ---------- "Save to my files" for files friends send in chat ---------- */
  let saving = null, svFolder = "Notes";
  function drawSvFolders() {
    $("svFolders").innerHTML = FOLDERS.map((c) => '<button type="button" class="chip' + (svFolder === c ? " on" : "") + '" aria-pressed="' + (svFolder === c) + '" data-svf="' + esc(c) + '">' + esc(c) + "</button>").join("");
  }
  $("svFolders").addEventListener("click", (e) => { const b = e.target.closest("[data-svf]"); if (!b) return; svFolder = b.dataset.svf; drawSvFolders(); });
  F.saveChatFile = (msg) => {
    if (missing) return F.toast("Run funi-v5-setup.sql in Supabase first, then you can save files.", { long: true });
    saving = msg;
    const codes = moduleCodes();
    $("svModule").innerHTML = codes.map((c) => '<option value="' + esc(c) + '">' + esc(c + (modName(c) ? " · " + modName(c) : "")) + "</option>").join("") + '<option value="GENERAL">General</option>';
    $("svName").value = String(msg.file_name || "File").replace(/\.[^.]+$/, "").slice(0, 120);
    const isImg = /^image\//.test(msg.file_type || ""), isAudio = /^audio\//.test(msg.file_type || "");
    svFolder = isImg ? "Photos" : "Notes";
    $("svWhat").textContent = (msg.file_name || "File") + (msg.file_size ? " · " + sizeTxt(+msg.file_size) : "");
    F.showError("svError", ""); drawSvFolders();
    $("saveSheet").showModal();
  };
  $("saveForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!saving) return;
    const code = $("svModule").value || "GENERAL", name = $("svName").value.trim() || "File";
    const size = +saving.file_size || 0;
    if (size > MAX_FILE) return F.showError("svError", "That file is bigger than 10 MB, so it can't go in My files.");
    if (used() + size > MAX_SPACE) return F.showError("svError", "Your 50 MB is full. Delete some files first.");
    $("svSave").disabled = true; F.showError("svError", "");
    try {
      const dl = await F.sb.storage.from("chat-files").download(saving.file_path);
      if (dl.error || !dl.data) throw new Error(dl.error ? dl.error.message : "download failed");
      const extM = String(saving.file_name || saving.file_path).match(/\.(\w+)$/), ext = extM ? "." + extM[1].toLowerCase() : "";
      const path = F.me.id + "/" + code.replace(/[^\w\-]+/g, "_") + "/" + Date.now() + "-" + (name.replace(/[^\w.\-]+/g, "_").slice(0, 60) || "file") + ext;
      const type = saving.file_type || dl.data.type || "application/octet-stream";
      const up = await F.sb.storage.from(BUCKET).upload(path, dl.data, { contentType: type, upsert: false });
      if (up.error) throw new Error(up.error.message);
      const { data, error } = await F.sb.from("module_files").insert({ user_id: F.me.id, module_code: code, folder: svFolder, name, kind: "file", path, mime: type, size: dl.data.size }).select().single();
      if (error) { await F.sb.storage.from(BUCKET).remove([path]); throw new Error(error.message); }
      offPut(path, dl.data, type);
      S.files.unshift(data);
      $("saveSheet").close();
      F.toast("Saved to " + code + " › " + svFolder + ".", { onClick: () => F.go("modfiles:" + code) });
    } catch (err) {
      F.showError("svError", "Couldn't save: " + (err.message || err));
    } finally { $("svSave").disabled = false; }
  });

  /* ---------- HTML files open as real pages (Supabase shows them as plain text for safety) ---------- */
  F.isHtmlName = (name, mime) => /text\/html/i.test(mime || "") || /\.html?$/i.test(name || "");
  // Things a page may use that the locked box blocks: give it safe stand-ins that only live while the page is open
  const HTML_SHIM = "<script>(function(){" +
    "function M(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}" +
    "['localStorage','sessionStorage'].forEach(function(n){try{window[n].length}catch(e){try{Object.defineProperty(window,n,{value:M(),configurable:true})}catch(e2){}}});" +
    "try{document.cookie}catch(e){var ck='';try{Object.defineProperty(document,'cookie',{get:function(){return ck},set:function(v){ck=String(v).split(';')[0]},configurable:true})}catch(e2){}}" +
    // pages made with Claude can save with window.storage
    "if(!window.storage){var S={};window.storage={get:function(k){return Promise.resolve(Object.prototype.hasOwnProperty.call(S,k)?{key:k,value:S[k]}:null)},set:function(k,v){S[k]=v;return Promise.resolve({key:k,value:v})},delete:function(k){var h=Object.prototype.hasOwnProperty.call(S,k);delete S[k];return Promise.resolve({key:k,deleted:h})},list:function(p){return Promise.resolve({keys:Object.keys(S).filter(function(k){return !p||k.indexOf(p)===0})})}}}" +
    // pages that change the address (#topic) or use in-page links: keep them inside the page
    "['pushState','replaceState'].forEach(function(n){var o=history[n];history[n]=function(st,t,u){try{return o.call(history,st,t,u)}catch(e){try{if(u&&String(u).indexOf('#')>-1){location.hash=String(u).split('#')[1]}return o.call(history,st,t)}catch(e2){}}}});" +
    "document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href^=\"#\"]');if(!a||e.defaultPrevented)return;var id=decodeURIComponent(a.getAttribute('href').slice(1));e.preventDefault();var el=id?document.getElementById(id)||document.getElementsByName(id)[0]:document.body;if(el)el.scrollIntoView({behavior:'smooth'});try{location.hash=id}catch(e2){}});" +
    // tell Funi if part of the page breaks, so you see why instead of a white screen
    "function R(m){try{parent.postMessage({funiHtmlError:String(m).slice(0,200)},'*')}catch(e){}}" +
    "window.addEventListener('error',function(e){R(e.message||(e.target&&e.target.src?'Could not load '+e.target.src:'error'))},true);" +
    "window.addEventListener('unhandledrejection',function(e){R(e.reason&&e.reason.message||e.reason)});" +
    // tell Funi the page is running (and whether it shows anything)
    "function A(f){try{parent.postMessage({funiHtmlAlive:1,final:f?1:0,text:(document.body&&document.body.innerText||'').trim().length,els:document.body?document.body.getElementsByTagName('*').length:0},'*')}catch(e){}}" +
    "if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){A(0)});else A(0);window.addEventListener('load',function(){setTimeout(function(){A(1)},1200)});" +
    "})();<\/script>";
  async function readHtml(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    // Notepad "Unicode" files are UTF-16
    if (buf[0] === 0xFF && buf[1] === 0xFE) return new TextDecoder("utf-16le").decode(buf);
    if (buf[0] === 0xFE && buf[1] === 0xFF) return new TextDecoder("utf-16be").decode(buf);
    return new TextDecoder("utf-8").decode(buf);
  }
  function prepareHtml(html) {
    let head = HTML_SHIM;
    if (!/<meta[^>]+charset/i.test(html)) head = '<meta charset="utf-8">' + head;
    if (!/<meta[^>]+viewport/i.test(html)) head = '<meta name="viewport" content="width=device-width, initial-scale=1">' + head;
    // keep <!DOCTYPE html> first, otherwise the browser draws the page in old "quirks" mode
    const m = html.match(/<head[^>]*>/i) || html.match(/<html[^>]*>/i) || html.match(/<!doctype[^>]*>/i);
    return m ? html.slice(0, m.index + m[0].length) + head + html.slice(m.index + m[0].length) : head + html;
  }
  let hvBlob = null, hvName = "page.html", hvArgs = null;
  F.openHtml = async (args) => {
    const { bucket, path, title, file, fresh } = args; hvArgs = args;
    $("hvTitle").textContent = title || "Page";
    $("hvNote").hidden = true; hvBlob = null; hvName = (title || "page").replace(/\.html?$/i, "") + ".html";
    const frame = $("hvFrame");
    frame.srcdoc = '<p style="font:600 16px system-ui;padding:24px;color:#555">Opening…</p>';
    if (!$("htmlSheet").open) $("htmlSheet").showModal();
    let data = null, error = null;
    if (file) { try { data = await fileBlob(file, fresh); } catch (err) { error = err; } }
    else ({ data, error } = await F.sb.storage.from(bucket).download(path));
    if (error || !data) { frame.srcdoc = '<p style="font:600 16px system-ui;padding:24px;color:#B42318">' + (error && error.message === "offline" ? "This page isn\'t saved on this phone yet. Open it once with internet." : "Couldn\'t open this file. Check your internet and try again.") + "</p>"; return; }
    hvBlob = data;
    const html = await readHtml(data);
    if (!html.trim()) { frame.srcdoc = '<p style="font:600 16px system-ui;padding:24px;color:#B42318">This file is empty. Try uploading it again.</p>'; return; }
    showHtml(prepareHtml(html));
  };
  // Show the page. Some computers block pages drawn straight into Funi; if the page doesn't start, try another way.
  let hvTry = 0, hvAlive = false, hvUrl = null;
  function showHtml(doc) {
    const frame = $("hvFrame"), my = ++hvTry;
    hvAlive = false;
    if (hvUrl) { URL.revokeObjectURL(hvUrl); hvUrl = null; }
    frame.removeAttribute("src");
    frame.srcdoc = doc;
    setTimeout(() => {
      if (my !== hvTry || hvAlive || !$("htmlSheet").open) return;
      hvUrl = URL.createObjectURL(new Blob([doc], { type: "text/html" }));
      frame.removeAttribute("srcdoc"); frame.src = hvUrl;
      setTimeout(() => {
        if (my !== hvTry || hvAlive || !$("htmlSheet").open) return;
        note("This computer's browser stopped the page from running inside Funi. Tap Open in browser, or open Funi in Chrome.");
      }, 3500);
    }, 3000);
  }
  function note(t) { $("hvNoteTxt").textContent = t; $("hvNote").hidden = false; }
  F.prepareHtml = prepareHtml;
  window.addEventListener("message", (e) => {
    if (!$("htmlSheet").open || e.source !== $("hvFrame").contentWindow || !e.data) return;
    if (e.data.funiHtmlAlive) {
      hvAlive = true;
      if (e.data.final && !e.data.text && e.data.els < 3 && $("hvNote").hidden) note("The page opened but has nothing to show. Tap Reload. If it's still empty, the file may be damaged: upload it again.");
      else if (e.data.text && /has nothing to show/.test($("hvNoteTxt").textContent)) $("hvNote").hidden = true;
      return;
    }
    if (!e.data.funiHtmlError) return;
    if (!$("hvNote").hidden) return; // show the first problem only
    $("hvNoteTxt").textContent = "Part of this page didn't work in Funi's safe viewer (" + e.data.funiHtmlError + "). If it looks wrong, tap Reload or Open in browser.";
    $("hvNote").hidden = false;
  });
  // the page opens as a normal file in your own browser (outside Funi)
  $("hvReload").onclick = () => { if (hvArgs && !F.looksOffline()) F.openHtml(Object.assign({}, hvArgs, { fresh: true })); else if (hvArgs) F.toast("Reload needs internet."); };
  $("hvOpen").onclick = () => { if (hvBlob) saveBlob(new Blob([hvBlob], { type: "text/html" }), hvName, "text/html"); };
  $("htmlSheet").addEventListener("close", () => { hvTry++; $("hvFrame").removeAttribute("src"); $("hvFrame").srcdoc = ""; hvBlob = null; if (hvUrl) { URL.revokeObjectURL(hvUrl); hvUrl = null; } });

  /* ---------- hooks ---------- */
  F.on("view:files", renderFiles);
  F.on("view:modfiles", (code) => { if (code) { if (!sameCode(code, curCode)) filter = "All"; curCode = code.toUpperCase(); } renderModFiles(); });
  F.on("login", loadFiles);
  F.on("resume", loadFiles);
})();
