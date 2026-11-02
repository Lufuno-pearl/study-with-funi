/* Handwritten notes: notebooks you write in with a pen, finger or mouse (lined, grid, dotted or blank paper),
 * or on top of a PDF or photo. A notebook is saved as a small file in the module's files (Notes folder),
 * so it counts in your 50 MB, opens offline and can be sent like any file. */
(function () {
  "use strict";
  const F = window.Funi, $ = F.$, esc = F.esc, S = F.s;
  const BUCKET = "module-files", MIME = "application/vnd.funi.note+json", A4 = 1.4142;
  const TOOLS = [["pen", "✒️", "Pen"], ["pencil", "✏️", "Pencil"], ["mark", "🖍️", "Highlight"], ["erase", "🧽", "Eraser"], ["text", "🔤", "Type"], ["select", "⬚", "Select"]];
  const COLORS = [["#1F1B2E", "Black"], ["#3550D4", "Blue"], ["#C23B5C", "Red"], ["#1E7A4E", "Green"], ["#7556DC", "Purple"], ["#E08A00", "Orange"]];
  const SIZES = [[1.6, "Thin"], [2.6, "Medium"], [4.5, "Thick"]];
  const me = () => (F.me ? F.me.id : "");
  const today = () => new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" });

  let note = null, row = null, code = null, pageIdx = 0, tool = "pen", color = COLORS[0][0], size = SIZES[1][0];
  let undo = [], redo = [], dirty = false, saveTimer = null, saving = false, bgDoc = null, bgImg = null;
  let penSeen = false; try { penSeen = localStorage.getItem("funi.penSeen") === "1"; } catch (e) {}

  /* ---------- starting a notebook ---------- */
  function newNote(opts) {
    return { v: 1, title: (opts.title || "Notes " + today()).slice(0, 80), paper: opts.paper || "lined", bg: opts.bg || null, pages: opts.pages || [{ ar: A4, strokes: [] }] };
  }
  function openNewSheet() {
    code = F.curModule ? F.curModule() : null;
    const files = (S.files || []).filter((f) => f.kind === "file" && String(f.module_code).toUpperCase() === String(code || "").toUpperCase() && /PDF|IMG/.test(F.fileKind(f)[0]));
    $("ntFromFiles").innerHTML = files.length ? files.slice(0, 30).map((f) => { const [k, cls] = F.fileKind(f);
      return '<button type="button" class="pick-row as-btn" data-note-on="' + esc(f.id) + '"><span class="file-ic ' + cls + '">' + k + '</span><span class="grow"><b>' + esc(f.name) + "</b><span>" + esc(f.folder) + "</span></span></button>"; }).join("")
      : '<p class="hint">No PDFs or photos in ' + esc(code || "this module") + " yet. Upload one below.</p>";
    $("ntNewSheet").showModal();
  }
  $("mfNotes").onclick = openNewSheet;
  $("ntPapers").addEventListener("click", (e) => { const b = e.target.closest("[data-paper]"); if (!b) return; $("ntNewSheet").close(); start(newNote({ paper: b.dataset.paper }), null); });
  $("ntFromFiles").addEventListener("click", (e) => { const b = e.target.closest("[data-note-on]"); if (!b) return; const f = (S.files || []).find((x) => x.id === b.dataset.noteOn); if (f) { $("ntNewSheet").close(); writeOn(f); } });
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-write-on]"); if (!b) return; const f = (S.files || []).find((x) => x.id === b.dataset.writeOn); if (f) { code = f.module_code; writeOn(f); } });
  $("ntUpload").onclick = () => $("ntUploadInput").click();
  $("ntUploadInput").onchange = async () => {
    const file = $("ntUploadInput").files[0]; $("ntUploadInput").value = ""; if (!file) return;
    if (file.size > 10 * 1024 * 1024) return F.toast("That file is bigger than 10 MB.");
    $("ntNewSheet").close(); F.toast("Uploading " + file.name + "…");
    let blob = file, type = file.type || "application/pdf";
    if (/^image\//.test(type) && F.shrinkImage) { const r = await F.shrinkImage(file); blob = r.blob; if (r.ext) type = r.type; }
    const ext = /pdf/.test(type) ? "pdf" : /png/.test(type) ? "png" : "jpg";
    const path = me() + "/" + String(code).replace(/[^\w\-]+/g, "_") + "/" + Date.now() + "-" + (file.name.replace(/\.[^.]+$/, "").replace(/[^\w.\-]+/g, "_").slice(0, 50) || "file") + "." + ext;
    const up = await F.sb.storage.from(BUCKET).upload(path, blob, { contentType: type, upsert: false });
    if (up.error) return F.toast("Couldn't upload: " + up.error.message, { long: true });
    const { data, error } = await F.sb.from("module_files").insert({ user_id: me(), module_code: code, folder: /pdf/.test(type) ? "Past papers" : "Photos", name: file.name.replace(/\.[^.]+$/, "").slice(0, 120), kind: "file", path, mime: type, size: blob.size }).select().single();
    if (error) { await F.sb.storage.from(BUCKET).remove([path]); return F.toast(/50 MB/.test(error.message) ? "Your 50 MB is full. Delete some files first." : "Couldn't upload: " + error.message, { long: true }); }
    if (F.offPutFile) F.offPutFile(path, blob, type);
    S.files.unshift(data); writeOn(data);
  };
  async function writeOn(f) {
    const isPdf = F.fileKind(f)[0] === "PDF";
    const bg = { path: f.path, mime: f.mime, size: f.size, name: f.name, kind: isPdf ? "pdf" : "img" };
    let pages = [{ ar: A4, strokes: [] }];
    try {
      if (isPdf) { const d = await loadPdf(bg); pages = []; for (let i = 1; i <= d.numPages; i++) { const v = (await d.getPage(i)).getViewport({ scale: 1 }); pages.push({ ar: v.height / v.width, strokes: [], bgPage: i }); } }
      else { const im = await loadImg(bg); pages = [{ ar: im.naturalHeight / im.naturalWidth, strokes: [], bgPage: 1 }]; }
    } catch (e) { return F.toast(F.looksOffline(e) ? "This file isn't saved on this phone yet. Open it once with internet." : "Couldn't open that file.", { long: true }); }
    start(newNote({ title: f.name + " (my notes)", paper: "blank", bg, pages }), null);
  }

  /* ---------- opening a saved notebook ---------- */
  F.openNote = async (f, edit) => {
    code = f.module_code;
    try {
      const blob = await F.fileBlob(f);
      let n = JSON.parse(await blob.text());
      // a version saved on this phone while offline wins if it's newer
      try { const d = JSON.parse(localStorage.getItem("funi.noteDraft." + f.id) || "null"); if (d && d.savedAt > (n.savedAt || 0)) n = d; } catch (e) {}
      if (!n || !Array.isArray(n.pages)) throw new Error("not a note");
      start(n, f, !edit);
    } catch (e) { F.toast(F.looksOffline(e) ? "This notebook isn't saved on this phone yet. Open it once with internet." : "Couldn't open these notes.", { long: true }); }
  };
  async function loadPdf(bg) { const blob = await F.fileBlob(bg); const lib = await F.loadPdfJs(); return lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise; }
  async function loadImg(bg) { const blob = await F.fileBlob(bg); const url = URL.createObjectURL(blob); return new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = url; }); }

  async function start(n, f, read) {
    note = n; row = f; pageIdx = 0; undo = []; redo = []; dirty = !f; bgDoc = null; bgImg = null;
    if (!code) code = (F.curModule && F.curModule()) || "Notes";
    $("ntTitle").value = note.title;
    $("ntPaperSeg").hidden = !!note.bg;
    $("noteSheet").showModal();
    if (note.bg) { try { if (note.bg.kind === "pdf") bgDoc = await loadPdf(note.bg); else bgImg = await loadImg(note.bg); } catch (e) { F.toast("The PDF or photo underneath couldn't load. Your writing is still here."); } }
    renderTools(); renderPaperSeg(); setState(f ? "Saved" : "Not saved yet");
    setMode(read ? "read" : "edit");
    if (!f) scheduleSave();
  }
  /* ---------- reading (scroll through pages) or editing ---------- */
  let mode = "edit";
  function setMode(m) {
    mode = m; clearSel();
    $("noteSheet").classList.toggle("reading", m === "read");
    $("ntTitle").readOnly = m === "read";
    if (m === "read") renderRead(); else { $("ntRead").innerHTML = ""; showPage(pageIdx); }
  }
  let readJob = 0;
  async function renderRead() {
    const job = ++readJob, box = $("ntRead");
    const w = Math.min(box.clientWidth - 24, 820), dpr = Math.min(window.devicePixelRatio || 1, 2);
    box.innerHTML = note.pages.map((p, i) => '<div class="nt-rpage" data-rp="' + i + '"><canvas width="' + Math.floor(w * dpr) + '" height="' + Math.floor(w * (p.ar || A4) * dpr) + '" style="width:' + w + "px;height:" + Math.floor(w * (p.ar || A4)) + 'px"></canvas><span>Page ' + (i + 1) + "</span></div>").join("");
    if (document.fonts && document.fonts.load) await document.fonts.load('40px "Patrick Hand"').catch(() => {});
    for (let i = 0; i < note.pages.length; i++) {
      if (job !== readJob || mode !== "read") return;
      const cv = box.querySelector('[data-rp="' + i + '"] canvas'); if (!cv) continue;
      await paintBg(cv, note.pages[i]);
      const x = cv.getContext("2d"); note.pages[i].strokes.forEach((st) => strokeOn(x, st, cv.width));
    }
  }
  function visiblePage() {
    const box = $("ntRead"), top = box.scrollTop + 40;
    let best = 0; box.querySelectorAll("[data-rp]").forEach((el) => { if (el.offsetTop <= top) best = +el.dataset.rp; });
    return best;
  }
  $("ntEditBtn").onclick = () => { pageIdx = visiblePage(); setMode("edit"); };
  $("ntDone").onclick = async () => { commitText(); if (dirty) { setState("Saving…"); await save(); } setMode("read"); };
  $("ntSaveBtn").onclick = async () => { commitText(); dirty = true; setState("Saving…"); await save(); if (!dirty) F.toast("Saved to " + code + " › Notes."); };

  /* ---------- tools ---------- */
  function renderTools() {
    $("ntToolBtns").innerHTML = TOOLS.map((t) => '<button type="button" class="nt-btn' + (tool === t[0] ? " on" : "") + '" data-ntool="' + t[0] + '" aria-pressed="' + (tool === t[0]) + '"><span aria-hidden="true">' + t[1] + "</span><b>" + t[2] + "</b></button>").join("");
    $("ntColors").innerHTML = COLORS.map((c) => '<button type="button" class="swatch' + (color === c[0] ? " on" : "") + '" data-ncolor="' + c[0] + '" aria-label="' + c[1] + '" aria-pressed="' + (color === c[0]) + '" style="background:' + c[0] + '"></button>').join("");
    $("ntSizes").innerHTML = SIZES.map((z) => '<button type="button" class="nt-size' + (size === z[0] ? " on" : "") + '" data-nsize="' + z[0] + '" aria-label="' + z[1] + '" aria-pressed="' + (size === z[0]) + '"><i style="width:' + (z[0] * 3 + 3) + "px;height:" + (z[0] * 3 + 3) + 'px"></i></button>').join("");
    $("ntInk").style.cursor = !tool ? "default" : tool === "text" ? "text" : tool === "select" ? "pointer" : "crosshair";
    $("ntHint").textContent = !tool ? "✋ Pen down: nothing draws. Tap a tool to write."
      : tool === "select" ? "Circle things to pick them. Drag to move, pull the ◢ corner to resize."
      : /pen|pencil|mark/.test(tool) ? "Hold still at the end of a line or shape to make it neat. Tap " + TOOLS.find((t) => t[0] === tool)[2] + " again to put it down."
      : "Tap " + TOOLS.find((t) => t[0] === tool)[2] + " again to put it down";
    if (tool !== "select") clearSel();
    $("ntHint").classList.toggle("down", !tool);
  }
  $("ntTools").addEventListener("click", (e) => {
    const t = e.target.closest("[data-ntool]"); if (t) { tool = tool === t.dataset.ntool ? null : t.dataset.ntool; renderTools(); return; }
    const c = e.target.closest("[data-ncolor]"); if (c) { color = c.dataset.ncolor; if (sel) { recolorSel(color); renderTools(); return; } if (!tool || tool === "erase") tool = "pen"; renderTools(); return; }
    const z = e.target.closest("[data-nsize]"); if (z) { size = +z.dataset.nsize; renderTools(); }
  });
  function renderPaperSeg() { document.querySelectorAll("#ntPaperSeg [data-npaper]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.npaper === note.paper))); }
  $("ntPaperSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-npaper]"); if (!b || !note) return; note.paper = b.dataset.npaper; renderPaperSeg(); drawBg(); changed(); });

  /* ---------- pages ---------- */
  const page = () => note.pages[pageIdx];
  let W = 0, H = 0;
  function layout() {
    const st = $("ntStage"), ar = page().ar || A4;
    const aw = st.clientWidth - 16, ah = st.clientHeight - 16;
    let w = aw, h = aw * ar; if (h > ah) { h = ah; w = ah / ar; }
    W = Math.max(50, Math.floor(w)); H = Math.max(50, Math.floor(h));
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    $("ntPage").style.width = W + "px"; $("ntPage").style.height = H + "px";
    ["ntBg", "ntInk"].forEach((id) => { const c = $(id); c.width = Math.floor(W * dpr); c.height = Math.floor(H * dpr); c.style.width = W + "px"; c.style.height = H + "px"; });
  }
  let bgJob = 0;
  function drawBg() { const job = ++bgJob; return paintBg($("ntBg"), page(), () => job !== bgJob); }
  async function paintBg(c, p, stale) {
    const x = c.getContext("2d"), cw = c.width, ch = c.height;
    x.fillStyle = "#FFFFFF"; x.fillRect(0, 0, cw, ch);
    if (p.bgPage && bgDoc && p.bgPage <= bgDoc.numPages) {
      const pg = await bgDoc.getPage(p.bgPage); if (stale && stale()) return;
      const v1 = pg.getViewport({ scale: 1 });
      await pg.render({ canvasContext: x, viewport: pg.getViewport({ scale: cw / v1.width }) }).promise;
      return;
    }
    if (p.bgPage && bgImg) { x.drawImage(bgImg, 0, 0, cw, ch); return; }
    const paper = note.paper, u = cw / 1000;
    x.save();
    if (paper === "lined") {
      x.strokeStyle = "#D6CCE8"; x.lineWidth = Math.max(1, u * 1.2);
      for (let y = 60 * u; y < ch; y += 34 * u) { x.beginPath(); x.moveTo(0, y); x.lineTo(cw, y); x.stroke(); }
      x.strokeStyle = "#F2A6B8"; x.beginPath(); x.moveTo(90 * u, 0); x.lineTo(90 * u, ch); x.stroke();
    } else if (paper === "grid") {
      x.strokeStyle = "#E4DDF0"; x.lineWidth = Math.max(1, u);
      for (let y = 0; y < ch; y += 30 * u) { x.beginPath(); x.moveTo(0, y); x.lineTo(cw, y); x.stroke(); }
      for (let xx = 0; xx < cw; xx += 30 * u) { x.beginPath(); x.moveTo(xx, 0); x.lineTo(xx, ch); x.stroke(); }
    } else if (paper === "dots") {
      x.fillStyle = "#CFC4E3";
      for (let y = 30 * u; y < ch; y += 30 * u) for (let xx = 30 * u; xx < cw; xx += 30 * u) { x.beginPath(); x.arc(xx, y, 1.8 * u, 0, 7); x.fill(); }
    }
    x.restore();
  }
  function showPage(i) {
    pageIdx = Math.max(0, Math.min(note.pages.length - 1, i)); clearSel();
    layout(); drawBg(); drawInk(); renderPageList();
    $("ntPageNo").textContent = "Page " + (pageIdx + 1) + " of " + note.pages.length;
    $("ntPrev").disabled = pageIdx === 0; $("ntNext").disabled = pageIdx >= note.pages.length - 1;
    $("ntDelPage").hidden = note.pages.length < 2 || !!page().bgPage;
  }
  function renderPageList() {
    $("ntPageList").innerHTML = note.pages.map((p, i) => '<button type="button" class="nt-thumb' + (i === pageIdx ? " on" : "") + '" data-npage="' + i + '" aria-label="Page ' + (i + 1) + '"><span style="aspect-ratio:1/' + (p.ar || A4).toFixed(3) + '"></span>' + (i + 1) + "</button>").join("") +
      '<button type="button" class="nt-thumb add" data-npage-add>+ Page</button>';
  }
  $("ntPageList").addEventListener("click", (e) => { const b = e.target.closest("[data-npage]"); if (b) { showPage(+b.dataset.npage); return; } if (e.target.closest("[data-npage-add]")) addPage(); });
  $("ntPrev").onclick = () => showPage(pageIdx - 1);
  $("ntNext").onclick = () => showPage(pageIdx + 1);
  function addPage() { note.pages.splice(pageIdx + 1, 0, { ar: A4, strokes: [] }); showPage(pageIdx + 1); changed(); }
  $("ntAddPage").onclick = addPage;
  $("ntDelPage").onclick = async () => {
    if (note.pages.length < 2) return;
    if (!(await F.confirm("Delete page " + (pageIdx + 1) + "?", "Everything written on it is removed.", "Delete"))) return;
    note.pages.splice(pageIdx, 1); undo = []; redo = []; showPage(pageIdx); changed();
  };
  window.addEventListener("resize", () => { if (!$("noteSheet").open) return; if (mode === "read") renderRead(); else { layout(); drawBg(); drawInk(); } });

  /* ---------- drawing ---------- */
  function strokeOn(x, s, cw) {
    const k = cw; // points are stored as fractions of the page width
    x.save(); x.lineCap = "round"; x.lineJoin = "round"; x.strokeStyle = s.c; x.fillStyle = s.c;
    if (s.t === "text") {
      const px = s.fs ? s.fs * k : s.w * k / 1000 * 9;
      x.font = (s.font === "neat" ? "400 " + Math.round(px) + 'px "Patrick Hand", "Segoe Print", cursive' : "600 " + Math.round(px) + "px Nunito, system-ui, sans-serif");
      x.textBaseline = s.bl ? "alphabetic" : "top"; String(s.text).split("\n").forEach((ln, i) => x.fillText(ln, s.p[0][0] * k, s.p[0][1] * k + i * px * 1.2)); x.restore(); return;
    }
    const P = s.p;
    if (s.t === "mark" || s.t === "pencil" || P.length < 3) {
      x.globalAlpha = s.t === "mark" ? 0.33 : s.t === "pencil" ? 0.8 : 1;
      x.lineWidth = s.w * k / 1000 * (s.t === "mark" ? 1 : 1);
      x.beginPath(); x.moveTo(P[0][0] * k, P[0][1] * k);
      if (P.length === 1) x.lineTo(P[0][0] * k + 0.1, P[0][1] * k + 0.1);
      for (let i = 1; i < P.length; i++) { const m = [(P[i - 1][0] + P[i][0]) / 2 * k, (P[i - 1][1] + P[i][1]) / 2 * k]; x.quadraticCurveTo(P[i - 1][0] * k, P[i - 1][1] * k, m[0], m[1]); }
      x.lineTo(P[P.length - 1][0] * k, P[P.length - 1][1] * k); x.stroke(); x.restore(); return;
    }
    // pen: the line gets thicker where you press harder
    for (let i = 1; i < P.length; i++) {
      const a = i > 1 ? [(P[i - 2][0] + P[i - 1][0]) / 2, (P[i - 2][1] + P[i - 1][1]) / 2] : P[0];
      const b = [(P[i - 1][0] + P[i][0]) / 2, (P[i - 1][1] + P[i][1]) / 2];
      x.lineWidth = s.w * k / 1000 * (0.55 + (P[i][2] == null ? 0.5 : P[i][2]) * 0.9);
      x.beginPath(); x.moveTo(a[0] * k, a[1] * k); x.quadraticCurveTo(P[i - 1][0] * k, P[i - 1][1] * k, b[0] * k, b[1] * k); x.stroke();
    }
    x.restore();
  }
  function drawInk() {
    const c = $("ntInk"), x = c.getContext("2d");
    x.clearRect(0, 0, c.width, c.height);
    page().strokes.forEach((s) => strokeOn(x, s, c.width));
    if (drawing && drawing.s) strokeOn(x, drawing.s, c.width);
    drawSel(x, c.width);
  }
  let drawing = null, raf = 0;
  const pt = (e) => { const r = $("ntInk").getBoundingClientRect(); return [+( (e.clientX - r.left) / r.width).toFixed(4), +((e.clientY - r.top) / r.width).toFixed(4), e.pointerType === "pen" ? +(e.pressure || 0.5).toFixed(2) : 0.5]; };
  function eraseAt(p) {
    const hit = page().strokes.filter((s) => s.p.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.018 + (s.t === "mark" ? s.w / 2000 : 0)) || (s.t === "text" && Math.abs(s.p[0][1] - p[1]) < 0.03 && p[0] >= s.p[0][0] - 0.01 && p[0] <= s.p[0][0] + 0.4));
    if (!hit.length) return;
    page().strokes = page().strokes.filter((s) => !hit.includes(s));
    undo.push({ page: pageIdx, del: hit }); redo = []; drawInk(); changed();
  }
  $("ntInk").addEventListener("pointerdown", (e) => {
    if (e.pointerType === "pen" && !penSeen) { penSeen = true; try { localStorage.setItem("funi.penSeen", "1"); } catch (x) {} }
    if (penSeen && e.pointerType === "touch") return; // your palm or finger while using a pen
    if (!tool || mode !== "edit") return; // pen is down: just looking
    e.preventDefault();
    const p = pt(e);
    if (tool === "text") { const hit = textAt(p); openText(hit ? (hit.bl ? [hit.p[0][0], hit.p[0][1] - (hit.fs || 0.03) * 0.85] : hit.p[0]) : p, hit); return; }
    try { $("ntInk").setPointerCapture(e.pointerId); } catch (x) {}
    if (tool === "select") { selDown(p); return; }
    if (tool === "erase") { drawing = { erase: true }; eraseAt(p); return; }
    drawing = { s: { t: tool, c: color, w: tool === "mark" ? size * 6 + 8 : tool === "pencil" ? Math.max(1.2, size * 0.75) : size, p: [p] } };
    holdFrom(p); drawInk();
  });
  $("ntInk").addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs) {
      const p = pt(ev);
      if (drawing.erase) { eraseAt(p); continue; }
      if (drawing.sel) { selMove(p); continue; }
      if (drawing.snapped) { if (drawing.snapped === "line") drawing.s.p[1] = [p[0], p[1], 0.5]; continue; }
      const last = drawing.s.p[drawing.s.p.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.0015) drawing.s.p.push(p);
      if (Math.hypot(p[0] - holdAt[0], p[1] - holdAt[1]) > 0.004) holdFrom(p);
    }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawInk(); });
  });
  const endDraw = () => {
    clearTimeout(holdT);
    if (!drawing) return;
    if (drawing.sel) { selUp(); drawing = null; drawInk(); return; }
    if (drawing.s && drawing.s.p.length) { page().strokes.push(drawing.s); undo.push({ page: pageIdx, add: drawing.s }); redo = []; changed(); }
    drawing = null; drawInk();
  };
  $("ntInk").addEventListener("pointerup", endDraw); $("ntInk").addEventListener("pointercancel", endDraw);
  /* ---------- hold still to snap a line or shape ---------- */
  let holdT = 0, holdAt = [0, 0];
  function holdFrom(p) {
    clearTimeout(holdT); holdAt = p;
    holdT = setTimeout(() => {
      if (!drawing || !drawing.s || drawing.snapped || drawing.s.p.length < 4) return;
      const r = F.snapShape(drawing.s.p);
      if (!r || (r.kind !== "line" && Math.hypot(...[0, 1].map((k) => Math.max(...drawing.s.p.map((q) => q[k])) - Math.min(...drawing.s.p.map((q) => q[k])))) < 0.05)) return;
      drawing.snapped = r.kind; drawing.s.p = r.pts.map((q) => [+q[0].toFixed(4), +q[1].toFixed(4), 0.5]);
      drawInk(); F.toast(F.SHAPE_NAMES[r.kind] + (r.kind === "line" ? ": keep holding and move to aim it" : ""));
    }, 650);
  }

  /* ---------- ⬚ Select: circle things, then move, resize, recolour, copy or delete them ---------- */
  let sel = null;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function itemBox(s) {
    if (s.t === "text") {
      const fs = s.fs || s.w * 9 / 1000, top = s.bl ? s.p[0][1] - fs * 0.85 : s.p[0][1], lines = String(s.text).split("\n");
      return [s.p[0][0], top, s.p[0][0] + Math.max(...lines.map((l) => l.length)) * fs * 0.48, top + fs * 1.2 * lines.length];
    }
    const pad = (s.w || 2) / 2000; let b = [Infinity, Infinity, -Infinity, -Infinity];
    s.p.forEach((q) => { b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[0]), Math.max(b[3], q[1])]; });
    return [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
  }
  function selBox() { let b = [Infinity, Infinity, -Infinity, -Infinity]; sel.items.forEach((s) => { const q = itemBox(s); b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]; }); return [b[0] - 0.008, b[1] - 0.008, b[2] + 0.008, b[3] + 0.008]; }
  function clearSel() { if (!sel) return; sel = null; $("ntSelBar").hidden = true; if (note && mode === "edit") drawInk(); }
  function setSel(items) {
    sel = items.length ? { items } : null;
    const bar = $("ntSelBar"); bar.hidden = !sel; drawInk();
    if (!sel) return;
    const b = selBox(), ar = page().ar || A4;
    bar.style.left = Math.max(0, Math.min(b[0], 0.55)) * 100 + "%";
    const below = b[1] < 0.07; bar.classList.toggle("below", below);
    bar.style.top = Math.max(0, (below ? b[3] : b[1]) / ar * 100) + "%";
    $("ntSelCount").textContent = items.length === 1 ? "1 thing" : items.length + " things";
  }
  function drawSel(x, k) {
    if (drawing && drawing.lasso) {
      x.save(); x.setLineDash([6, 5]); x.strokeStyle = "#7556DC"; x.lineWidth = 1.5; x.fillStyle = "rgba(117,86,220,0.06)";
      x.beginPath(); drawing.lasso.forEach((q, i) => (i ? x.lineTo(q[0] * k, q[1] * k) : x.moveTo(q[0] * k, q[1] * k))); x.closePath(); x.fill(); x.stroke(); x.restore();
    }
    if (!sel) return;
    const b = selBox();
    x.save(); x.setLineDash([7, 5]); x.strokeStyle = "#7556DC"; x.lineWidth = 2; x.fillStyle = "rgba(117,86,220,0.05)";
    x.fillRect(b[0] * k, b[1] * k, (b[2] - b[0]) * k, (b[3] - b[1]) * k); x.strokeRect(b[0] * k, b[1] * k, (b[2] - b[0]) * k, (b[3] - b[1]) * k);
    x.setLineDash([]); x.fillStyle = "#7556DC"; x.strokeStyle = "#FFFFFF"; x.lineWidth = 2;
    x.beginPath(); x.arc(b[2] * k, b[3] * k, Math.max(9, 0.016 * k), 0, 7); x.fill(); x.stroke();
    x.fillStyle = "#FFFFFF"; x.font = "800 " + Math.round(Math.max(10, 0.016 * k)) + "px Nunito, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("⤡", b[2] * k, b[3] * k + 1);
    x.restore();
  }
  const inPoly = (q, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > q[1]) !== (P[j][1] > q[1]) && q[0] < (P[j][0] - P[i][0]) * (q[1] - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
  function hitAt(p) {
    const t = textAt(p); if (t) return t;
    const ss = page().strokes;
    for (let i = ss.length - 1; i >= 0; i--) { const s = ss[i]; if (s.t !== "text" && s.p.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.014 + (s.w || 2) / 2000)) return s; }
    return null;
  }
  function selDown(p) {
    if (sel) {
      const b = selBox(), hr = Math.max(0.03, 18 / ($("ntInk").getBoundingClientRect().width || 600));
      const handle = Math.hypot(p[0] - b[2], p[1] - b[3]) < hr, inside = p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
      if (handle || inside) {
        const orig = sel.items, copies = orig.map(clone), ss = page().strokes;
        orig.forEach((o, i) => { const at = ss.indexOf(o); if (at >= 0) ss[at] = copies[i]; });
        sel.items = copies;
        drawing = { sel: handle ? "resize" : "move", start: p, orig, copies, anchor: [b[0], b[1]], moved: false };
        $("ntSelBar").hidden = true; return;
      }
    }
    sel = null; $("ntSelBar").hidden = true;
    drawing = { sel: "lasso", lasso: [p] }; drawInk();
  }
  function placeCopies(fn, kf) {
    drawing.copies.forEach((c, i) => {
      const o = drawing.orig[i];
      c.p = o.p.map((q) => { const r = fn(q); return q.length > 2 ? [+r[0].toFixed(4), +r[1].toFixed(4), q[2]] : [+r[0].toFixed(4), +r[1].toFixed(4)]; });
      if (kf) { if (o.t === "text") { if (o.fs) c.fs = o.fs * kf; else c.w = o.w * kf; } else c.w = Math.max(0.6, Math.min(40, o.w * kf)); }
    });
  }
  function selMove(p) {
    const d = drawing;
    if (d.sel === "lasso") { const l = d.lasso[d.lasso.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.003) d.lasso.push(p); }
    else if (d.sel === "move") { const dx = p[0] - d.start[0], dy = p[1] - d.start[1]; d.moved = d.moved || Math.hypot(dx, dy) > 0.002; placeCopies((q) => [q[0] + dx, q[1] + dy]); }
    else { const [ax, ay] = d.anchor, k = Math.max(0.15, Math.min(8, ((p[0] - ax) + (p[1] - ay)) / Math.max(0.01, (d.start[0] - ax) + (d.start[1] - ay)))); d.moved = d.moved || Math.abs(k - 1) > 0.01; placeCopies((q) => [ax + (q[0] - ax) * k, ay + (q[1] - ay) * k], k); }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawInk(); });
  }
  function selUp() {
    const d = drawing;
    if (d.sel === "lasso") {
      const L = d.lasso; let b = [Infinity, Infinity, -Infinity, -Infinity]; L.forEach((q) => { b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[0]), Math.max(b[3], q[1])]; });
      if (b[2] - b[0] < 0.015 && b[3] - b[1] < 0.015) { const h = hitAt(L[0]); setSel(h ? [h] : []); return; }
      const got = page().strokes.filter((s) => {
        if (s.t === "text") { const q = itemBox(s); return inPoly([(q[0] + q[2]) / 2, (q[1] + q[3]) / 2], L) || inPoly([q[0] + 0.005, (q[1] + q[3]) / 2], L); }
        return s.p.filter((q) => inPoly(q, L)).length >= Math.max(1, s.p.length * 0.6);
      });
      setSel(got); if (!got.length) F.toast("Nothing inside. Draw a loop around what you want to move.");
      return;
    }
    if (d.moved) { undo.push({ page: pageIdx, del: d.orig, add: d.copies }); redo = []; changed(); }
    else { const ss = page().strokes; d.copies.forEach((c, i) => { const at = ss.indexOf(c); if (at >= 0) ss[at] = d.orig[i]; }); sel.items = d.orig; }
    setSel(sel.items);
  }
  function recolorSel(c) {
    const orig = sel.items, copies = orig.map((o) => Object.assign(clone(o), { c })), ss = page().strokes;
    orig.forEach((o, i) => { const at = ss.indexOf(o); if (at >= 0) ss[at] = copies[i]; });
    undo.push({ page: pageIdx, del: orig, add: copies }); redo = []; changed(); setSel(copies);
  }
  $("ntSelDel").onclick = () => { if (!sel) return; const del = sel.items; page().strokes = page().strokes.filter((s) => !del.includes(s)); undo.push({ page: pageIdx, del }); redo = []; changed(); clearSel(); };
  $("ntSelCopy").onclick = () => {
    if (!sel) return;
    const copies = sel.items.map((o) => { const c = clone(o); c.p = c.p.map((q) => { const r = q.slice(); r[0] += 0.03; r[1] += 0.03; return r; }); return c; });
    page().strokes.push(...copies); undo.push({ page: pageIdx, add: copies }); redo = []; changed(); setSel(copies);
  };
  $("ntSelDone").onclick = () => clearSel();

  let textPos = null, textEditing = null;
  // which typed or neat text is under the finger (so you can fix a word)
  function textAt(p) {
    const list = page().strokes.filter((s) => s.t === "text");
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i], fs = s.fs || s.w * 9 / 1000, w = String(s.text).length * fs * 0.5;
      const top = s.bl ? s.p[0][1] - fs * 0.85 : s.p[0][1];
      if (p[0] >= s.p[0][0] - 0.01 && p[0] <= s.p[0][0] + w + 0.01 && p[1] >= top - 0.01 && p[1] <= top + fs * 1.2) return s;
    }
    return null;
  }
  function openText(p, existing) {
    textPos = p; textEditing = existing || null; const inp = $("ntText");
    inp.style.left = (p[0] * 100) + "%"; inp.style.top = (p[1] / (page().ar || A4) * 100) + "%"; inp.style.color = existing ? existing.c : color;
    inp.value = existing ? existing.text : ""; inp.hidden = false; inp.focus(); requestAnimationFrame(() => inp.focus());
  }
  function commitText() {
    const inp = $("ntText"); if (inp.hidden) return;
    const t = inp.value.trim(); inp.hidden = true;
    const old = textEditing; textEditing = null;
    if (!textPos) return;
    if (old) {
      if (t === old.text) { textPos = null; return; }
      const s = t ? Object.assign({}, old, { text: t.slice(0, 200) }) : null;
      page().strokes = page().strokes.filter((x) => x !== old).concat(s ? [s] : []);
      undo.push({ page: pageIdx, del: [old], add: s ? [s] : [] }); redo = []; textPos = null; drawInk(); changed(); return;
    }
    if (!t) { textPos = null; return; }
    const s = { t: "text", c: color, w: size * 1.2 + 1.6, p: [textPos], text: t.slice(0, 200) };
    page().strokes.push(s); undo.push({ page: pageIdx, add: s }); redo = []; textPos = null; drawInk(); changed();
  }
  $("ntText").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commitText(); } if (e.key === "Escape") { $("ntText").hidden = true; textPos = null; textEditing = null; } });
  $("ntText").addEventListener("blur", commitText);
  const list = (v) => (v ? (Array.isArray(v) ? v : [v]) : []);
  function doUndo() {
    const a = undo.pop(); if (!a) return; clearSel();
    if (a.page !== pageIdx) showPage(a.page);
    const p = note.pages[a.page];
    const add = list(a.add), del = list(a.del);
    p.strokes = p.strokes.filter((s) => !add.includes(s)).concat(del);
    redo.push(a); drawInk(); changed();
  }
  function doRedo() {
    const a = redo.pop(); if (!a) return; clearSel();
    if (a.page !== pageIdx) showPage(a.page);
    const p = note.pages[a.page];
    const add = list(a.add), del = list(a.del);
    p.strokes = p.strokes.filter((s) => !del.includes(s)).concat(add);
    undo.push(a); drawInk(); changed();
  }
  $("ntUndo").onclick = doUndo; $("ntRedo").onclick = doRedo;
  document.addEventListener("keydown", (e) => {
    if (!$("noteSheet").open || document.activeElement === $("ntText") || document.activeElement === $("ntTitle")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); doRedo(); }
  });
  $("ntTitle").addEventListener("input", () => { note.title = $("ntTitle").value.slice(0, 80) || "Notes"; changed(); });

  /* ---------- neat handwriting: read your writing and redraw it neatly ---------- */
  // where lines go on this paper (page units = fractions of the page width)
  function paperLines() {
    const pg = page(), paper = pg.bgPage ? "photo" : note.paper;
    if (paper === "lined") return { gap: 0.034, minX: 0.1, snap: (y) => 0.06 + Math.max(0, Math.round((y - 0.06) / 0.034)) * 0.034 };
    if (paper === "grid") return { gap: 0.03, minX: 0.02, snap: (y) => Math.max(1, Math.round(y / 0.03)) * 0.03 };
    if (paper === "dots") return { gap: 0.03, minX: 0.02, snap: (y) => 0.03 + Math.max(0, Math.round((y - 0.03) / 0.03)) * 0.03 };
    return { gap: 0.034, minX: 0.02, snap: null };
  }
  $("ntNeat").onclick = async () => {
    if (!note || mode !== "edit") return;
    if (F.looksOffline()) return F.toast("Neat handwriting needs internet. Your notes still save.");
    const pg = page(), ink = pg.strokes.filter((s) => (s.t === "pen" || s.t === "pencil") && !s.tidy);
    if (!ink.length) return F.toast("Write something with the pen first, then tap Neat handwriting.");
    $("ntNeat").disabled = true; setState("Reading your writing…");
    try {
      const lines = F.groupInk(ink.map((s) => s.p), { lines: true });
      const items = [];
      for (const g of lines) {
        const ss = g.idx.map((i) => ink[i]);
        let text = "";
        try { text = await F.recognizeInk(ss.map((s) => s.p.map((q) => [q[0] * 1000, q[1] * 1000])), 1000, 1000 * (pg.ar || A4)); } catch (e) { if (F.looksOffline(e)) throw e; }
        items.push({ text, mathy: F.isMathy(text), strokes: ss.map((s) => s.p), color: ss[0].c });
      }
      setState(dirty ? "Saving…" : "Saved");
      const pick = await F.neatReview(items);
      if (!pick) return;
      const P = paperLines(), K = pick.k, place = F.neatLayout(lines, Object.assign({}, P, { step: P.gap * (K > 1.5 ? 2 : 1), inkH: P.gap * K * 0.9 })), removed = [], added = [];
      if (document.fonts && document.fonts.load) await document.fonts.load('40px "Patrick Hand"').catch(() => {});
      lines.forEach((g, i) => {
        const ss = g.idx.map((k) => ink[k]), L = place[i];
        removed.push(...ss);
        if (pick.lines[i].mode === "neat") {
          let fs = P.gap * K * 0.85; const maxW = 0.97 - L.x, est = pick.lines[i].text.length * fs * 0.42;
          if (est > maxW) fs = Math.max(0.012, fs * maxW / est);
          added.push({ t: "text", font: "neat", bl: 1, c: ss[0].c, w: 3, fs, p: [[L.x, L.base]], text: pick.lines[i].text.slice(0, 200) });
        } else ss.forEach((st) => added.push(Object.assign({}, st, { tidy: 1, p: F.moveInk(st.p, L) })));
      });
      pg.strokes = pg.strokes.filter((s) => !removed.includes(s)).concat(added);
      undo.push({ page: pageIdx, del: removed, add: added }); redo = []; drawInk(); changed();
      F.toast("✨ Neat! Undo brings your writing back. Tap a word with Type to fix it.", { long: true });
    } catch (err) {
      setState(dirty ? "Saving…" : "Saved");
      F.toast(F.looksOffline(err) ? "Neat handwriting needs internet." : "Couldn't read your writing right now. Try again in a moment.", { long: true });
    } finally { $("ntNeat").disabled = false; }
  };

  /* ---------- saving (as you write) ---------- */
  function setState(t) { $("ntState").textContent = t; }
  function changed() { dirty = true; setState("Saving…"); scheduleSave(); }
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 2500); }
  async function save() {
    clearTimeout(saveTimer);
    if (!note || saving || !dirty) return;
    saving = true;
    note.savedAt = Date.now();
    const json = JSON.stringify(note), blob = new Blob([json], { type: MIME });
    try {
      if (blob.size > 10 * 1024 * 1024) throw new Error("These notes are too big to save (10 MB). Start a new notebook.");
      const slug = (note.title || "notes").replace(/[^\w\-]+/g, "_").slice(0, 40) || "notes";
      const path = me() + "/" + String(code).replace(/[^\w\-]+/g, "_") + "/" + Date.now() + "-" + slug + ".funinote";
      const up = await F.sb.storage.from(BUCKET).upload(path, blob, { contentType: MIME, upsert: false });
      if (up.error) throw new Error(up.error.message);
      let res;
      if (!row) res = await F.sb.from("module_files").insert({ user_id: me(), module_code: code, folder: "Notes", name: note.title.slice(0, 120), kind: "file", path, mime: MIME, size: blob.size }).select().single();
      else res = await F.sb.from("module_files").update({ path, size: blob.size, name: note.title.slice(0, 120), mime: MIME }).eq("id", row.id).select().single();
      if (res.error) { await F.sb.storage.from(BUCKET).remove([path]); throw new Error(res.error.message); }
      const old = row && row.path;
      if (!row) { row = res.data; S.files.unshift(row); }
      else Object.assign(row, res.data || { path, size: blob.size, name: note.title });
      if (old && old !== path) F.sb.storage.from(BUCKET).remove([old]).then(() => {}, () => {});
      if (F.offPutFile) F.offPutFile(path, blob, MIME);
      try { localStorage.removeItem("funi.noteDraft." + row.id); } catch (e) {}
      dirty = false; setState("Saved");
    } catch (err) {
      // no internet: keep it on this phone and save later
      try { if (row) localStorage.setItem("funi.noteDraft." + row.id, json); } catch (e) {}
      setState(F.looksOffline(err) ? "Offline · saved on this phone" : /50 MB/.test(err.message) ? "Your 50 MB is full" : "Couldn't save");
      if (!F.looksOffline(err)) F.toast("Couldn't save your notes: " + err.message, { long: true });
    } finally { saving = false; }
  }
  async function closeNotes() {
    commitText();
    if (dirty) { setState("Saving…"); await save(); }
    $("noteSheet").close();
    if (F.renderModFiles) F.renderModFiles();
    if (dirty && !row) F.toast("Your notes couldn't be saved. Connect to the internet and make them again.", { long: true });
    else if (row) F.toast("Saved to " + code + " › Notes.");
  }
  $("ntClose").onclick = closeNotes;
  $("noteSheet").addEventListener("cancel", (e) => { e.preventDefault(); closeNotes(); });
  window.addEventListener("online", () => { if ($("noteSheet").open && dirty) save(); });
  window.addEventListener("beforeunload", () => { if (dirty && note && row) { try { localStorage.setItem("funi.noteDraft." + row.id, JSON.stringify(note)); } catch (e) {} } });

  /* ---------- covers on the module page ---------- */
  F.renderNoteCovers = (box, books) => {
    box.innerHTML = books.map((f) => '<button type="button" class="note-cover" data-fopen="' + esc(f.id) + '"><canvas width="180" height="240" data-cover="' + esc(f.id) + '"></canvas><b>' + esc(f.name) + "</b><span>" + esc(F.whenShort ? F.whenShort(f.created_at) : "") + "</span></button>").join("");
    books.forEach(async (f) => {
      try {
        const n = JSON.parse(await (await F.fileBlob(f)).text()), cv = box.querySelector('[data-cover="' + f.id + '"]'); if (!cv) return;
        const x = cv.getContext("2d"), p = n.pages[0] || { strokes: [] };
        x.fillStyle = "#FFFFFF"; x.fillRect(0, 0, cv.width, cv.height);
        if (n.paper === "lined" && !n.bg) { x.strokeStyle = "#E2DAEE"; for (let y = 11; y < cv.height; y += 6) { x.beginPath(); x.moveTo(0, y); x.lineTo(cv.width, y); x.stroke(); } }
        if (n.bg) { x.fillStyle = "#F4EFFC"; x.fillRect(0, 0, cv.width, 26); x.fillStyle = "#4C34A6"; x.font = "800 12px Nunito, sans-serif"; x.fillText(n.bg.kind === "pdf" ? "📄 PDF" : "🖼️ Photo", 8, 18); }
        p.strokes.forEach((s) => strokeOn(x, s, cv.width));
      } catch (e) { /* cover stays blank */ }
    });
  };
})();
