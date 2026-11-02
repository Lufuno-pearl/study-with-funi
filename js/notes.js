/* Handwritten notes: notebooks you write in with a pen, finger or mouse (lined, grid, dotted or blank paper),
 * or on top of a PDF or photo. A notebook is saved as a small file in the module's files (Notes folder),
 * so it counts in your 50 MB, opens offline and can be sent like any file. */
(function () {
  "use strict";
  const F = window.Funi, $ = F.$, esc = F.esc, S = F.s;
  const BUCKET = "module-files", MIME = "application/vnd.funi.note+json", A4 = 1.4142;
  const TOOLS = [["pen", "✒️", "Pen"], ["pencil", "✏️", "Pencil"], ["mark", "🖍️", "Highlight"], ["erase", "🧽", "Eraser"], ["text", "🔤", "Type"]];
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
    mode = m;
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
    $("ntInk").style.cursor = !tool ? "default" : tool === "text" ? "text" : "crosshair";
    $("ntHint").textContent = tool ? "Tap " + TOOLS.find((t) => t[0] === tool)[2] + " again to put it down" : "✋ Pen down: nothing draws. Tap a tool to write.";
    $("ntHint").classList.toggle("down", !tool);
  }
  $("ntTools").addEventListener("click", (e) => {
    const t = e.target.closest("[data-ntool]"); if (t) { tool = tool === t.dataset.ntool ? null : t.dataset.ntool; renderTools(); return; }
    const c = e.target.closest("[data-ncolor]"); if (c) { color = c.dataset.ncolor; if (!tool || tool === "erase") tool = "pen"; renderTools(); return; }
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
    pageIdx = Math.max(0, Math.min(note.pages.length - 1, i));
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
      x.textBaseline = "top"; String(s.text).split("\n").forEach((ln, i) => x.fillText(ln, s.p[0][0] * k, s.p[0][1] * k + i * px * 1.2)); x.restore(); return;
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
    if (tool === "text") { const hit = textAt(p); openText(hit ? hit.p[0] : p, hit); return; }
    try { $("ntInk").setPointerCapture(e.pointerId); } catch (x) {}
    if (tool === "erase") { drawing = { erase: true }; eraseAt(p); return; }
    drawing = { s: { t: tool, c: color, w: tool === "mark" ? size * 6 + 8 : tool === "pencil" ? Math.max(1.2, size * 0.75) : size, p: [p] } };
    drawInk();
  });
  $("ntInk").addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs) {
      const p = pt(ev);
      if (drawing.erase) { eraseAt(p); continue; }
      const last = drawing.s.p[drawing.s.p.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.0015) drawing.s.p.push(p);
    }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawInk(); });
  });
  const endDraw = () => {
    if (!drawing) return;
    if (drawing.s && drawing.s.p.length) { page().strokes.push(drawing.s); undo.push({ page: pageIdx, add: drawing.s }); redo = []; changed(); }
    drawing = null; drawInk();
  };
  $("ntInk").addEventListener("pointerup", endDraw); $("ntInk").addEventListener("pointercancel", endDraw);
  let textPos = null, textEditing = null;
  // which typed or neat text is under the finger (so you can fix a word)
  function textAt(p) {
    const list = page().strokes.filter((s) => s.t === "text");
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i], fs = s.fs || s.w * 9 / 1000, w = String(s.text).length * fs * 0.5;
      if (p[0] >= s.p[0][0] - 0.01 && p[0] <= s.p[0][0] + w + 0.01 && p[1] >= s.p[0][1] - 0.01 && p[1] <= s.p[0][1] + fs * 1.2) return s;
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
    const a = undo.pop(); if (!a) return;
    if (a.page !== pageIdx) showPage(a.page);
    const p = note.pages[a.page];
    const add = list(a.add), del = list(a.del);
    p.strokes = p.strokes.filter((s) => !add.includes(s)).concat(del);
    redo.push(a); drawInk(); changed();
  }
  function doRedo() {
    const a = redo.pop(); if (!a) return;
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
  $("ntNeat").onclick = async () => {
    if (!note) return;
    if (F.looksOffline()) return F.toast("Neat handwriting needs internet. Your notes still save.");
    const ink = page().strokes.filter((s) => s.t === "pen" || s.t === "pencil");
    if (!ink.length) return F.toast("Write something with the pen first, then tap Neat handwriting.");
    $("ntNeat").disabled = true; setState("Reading your writing…");
    try {
      const groups = F.groupInk(ink.map((s) => s.p));
      const added = [], removed = [];
      for (const g of groups) {
        const strokes = g.idx.map((i) => ink[i]);
        const text = await F.recognizeInk(strokes.map((s) => s.p.map((q) => [q[0] * 1000, q[1] * 1000])), 1000, 1000 * (page().ar || A4));
        if (!text) continue;
        removed.push(...strokes);
        added.push({ t: "text", font: "neat", c: strokes[0].c, w: 3, fs: Math.max(0.025, (g.box[3] - g.box[1]) / 0.8), p: [[g.box[0], g.box[1] - (g.box[3] - g.box[1]) * 0.12]], text: text.slice(0, 200) });
      }
      if (!added.length) { setState(dirty ? "Saving…" : "Saved"); return F.toast("Funi couldn't read that. Try writing a bit bigger."); }
      if (document.fonts && document.fonts.load) await document.fonts.load('40px "Patrick Hand"').catch(() => {});
      page().strokes = page().strokes.filter((s) => !removed.includes(s)).concat(added);
      undo.push({ page: pageIdx, del: removed, add: added }); redo = []; drawInk(); changed();
      F.toast("✨ Neat! Use the Type tool to tap a word and fix it, or Undo to get your writing back.", { long: true });
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
