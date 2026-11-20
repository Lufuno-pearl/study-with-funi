/* Marks book: everything that counts in a module (tests, tuts, assignments, the exam), each with its weight.
   Funi works out your average so far, what you need on what's left, "best N tuts" rules, DP and the exam subminimum.
   Needs funi-v19-setup.sql. */
(() => {
  const F = window.Funi, $ = F.$, esc = F.esc, S = F.s;
  const TYPES = ["Test", "Exam", "Tutorial test", "Assignment", "Quiz", "Tutorial", "Lab / practical", "Project"];
  const SET = "A set (e.g. tuts, best few count)";
  let items = [], mod = null, missing = false, job = 0, editing = null;
  const r1 = (n) => Math.round(n * 10) / 10;
  const cacheKey = () => "funi.grades." + (F.me ? F.me.id : "x");

  /* ---------- the maths ---------- */
  function calc(all, target) {
    let pts = 0, done = 0, total = 0, cPts = 0, cDone = 0, examW = 0, examLeft = false;
    const top = all.filter((x) => !x.group_id).map((x) => {
      const W = +x.weight || 0; total += W; let avg = null, d = 0, used = 0, n = 0;
      if (x.is_group) {
        const marks = all.filter((k) => k.group_id === x.id && k.mark != null).map((k) => +k.mark).sort((a, b) => b - a);
        n = x.best_n || all.filter((k) => k.group_id === x.id).length || 1;
        const best = marks.slice(0, n); used = best.length;
        if (used) { avg = best.reduce((a, b) => a + b, 0) / used; d = W * Math.min(used, n) / n; }
      } else if (x.mark != null) { avg = +x.mark; d = W; }
      if (avg != null) { pts += avg * d / 100; done += d; if (x.kind !== "Exam") { cPts += avg * d / 100; cDone += d; } }
      if (x.kind === "Exam") { examW += W; if (x.mark == null) examLeft = true; }
      return { x, W, avg, d, used, n };
    });
    const left = total - done, avg = done ? 100 * pts / done : null, classAvg = cDone ? 100 * cPts / cDone : null;
    const need = left > 0.01 ? 100 * (target * total / 100 - pts) / left : null;
    const best = pts + left; // if you got 100% on everything left (in % of the module)
    return { top, pts, done, total, left, avg, classAvg, need, examW, examLeft, best: total ? 100 * best / total : 0, final: total ? 100 * pts / total : 0 };
  }
  F.gradeCalc = calc;
  // what the rest of Funi uses: your average so far and how much of the module that covers
  F.gradeSoFar = (code) => { const c = F.read(cacheKey(), {}); const k = String(code || "").trim().toUpperCase(); return c[k] || null; };
  function remember() {
    if (!mod) return; const c = F.read(cacheKey(), {}), r = calc(items, +mod.target || 50);
    c[mod.code.trim().toUpperCase()] = items.length ? { avg: r.avg == null ? null : r1(r.avg), done: r1(r.done), target: +mod.target || null } : null;
    F.store(cacheKey(), c);
    // keep the rest of Funi in step: the class mark and exam weight drive the planner and the exam calculator
    if (items.length && F.saveModule) {
      const patch = {};
      if (r.classAvg != null && +mod.class_mark !== r1(r.classAvg)) patch.class_mark = r1(r.classAvg);
      if (r.examW > 0 && +mod.exam_weight !== r1(r.examW)) patch.exam_weight = r1(r.examW);
      if (Object.keys(patch).length) F.saveModule(mod, patch);
    }
  }

  /* ---------- loading ---------- */
  const current = () => S.modules.find((m) => m.id === $("mModule").value) || null;
  async function load() {
    mod = current(); const me = ++job;
    if (!mod) { $("mbBox").innerHTML = '<div class="empty"><b>Add a module first</b><span>Your marks book is kept per module.</span><button type="button" class="btn primary small" data-go="priorities">Add modules</button></div>'; return; }
    $("mbBox").innerHTML = '<p class="status-line">Loading your marks…</p>';
    const { data, error } = await F.sb.from("grade_items").select("*").eq("module_code", mod.code).order("position").order("created_at");
    if (me !== job) return;
    missing = !!error;
    if (error) { $("mbBox").innerHTML = '<div class="empty"><b>One setup step first</b><span>' + esc(/grade_items|schema cache|relation/i.test(error.message) ? "Run funi-v19-setup.sql in Supabase to switch on your marks book." : error.message) + "</span></div>"; $("mQuick").open = true; return; }
    items = data || []; $("mQuick").open = false; render(); remember();
  }
  F.on("view:marks", () => setTimeout(load, 0));
  $("mModule").addEventListener("change", () => setTimeout(load, 0));

  /* ---------- drawing ---------- */
  const pct = (v) => (v == null ? "–" : r1(v) + "%");
  function render() {
    const target = +mod.target || 50, r = calc(items, target), sub = mod.subminimum != null ? +mod.subminimum : null, dp = mod.dp_min != null ? +mod.dp_min : null;
    if (!items.length) {
      $("mbBox").innerHTML = '<div class="card stack mb-empty"><b>Put in everything that counts for ' + esc(mod.code) + '</b><span class="hint">Tests, tuts, assignments and the exam, with how much each is worth. Your course outline has the numbers. Funi then works out your average and what you need, by itself.</span>' +
        '<button type="button" class="btn primary" data-mb-template>Start with a typical module</button><button type="button" class="btn ghost" data-mb-add>Add one thing</button>' +
        '<span class="hint">Typical: tuts (best 4 of 10) 10%, two tests 15% each, exam 60%. You can change everything after.</span></div>';
      return;
    }
    let needTxt, needCls = "";
    if (r.left <= 0.01) { needTxt = "Everything is in. Your final mark: <b>" + pct(r.final) + "</b>"; needCls = r.final >= target ? "ok" : "warn"; }
    else if (r.need <= 0) { needTxt = "You've already got enough for " + target + "%, even with 0 on what's left. 🎉"; needCls = "ok"; }
    else if (r.need > 100) { needTxt = target + "% is out of reach now. The most you can get is <b>" + pct(r.best) + "</b>. Aim for a lower target below."; needCls = "warn"; }
    else { needTxt = "You need <b>" + pct(r.need) + "</b> on average on what's left (" + r1(r.left) + "% of the module)"; needCls = r.need > 75 ? "warn" : ""; }
    const subTxt = sub != null && r.examLeft ? '<span class="mb-line">Exam subminimum: you need at least <b>' + sub + "%</b> in the exam itself" + (r.need > sub ? "" : ", even though the maths above needs less") + ".</span>" : "";
    const dpTxt = dp != null && r.classAvg != null ? '<span class="mb-line ' + (r.classAvg >= dp ? "ok" : "warn") + '">' + (r.classAvg >= dp ? "✓ DP: your class mark " + pct(r.classAvg) + " is above " + dp + "%" : "⚠️ DP: your class mark " + pct(r.classAvg) + " is below " + dp + "%. You might not be allowed to write the exam.") + "</span>" : "";
    const wTxt = Math.abs(r.total - 100) > 0.5 ? '<span class="mb-line warn">Your weights add up to ' + r1(r.total) + "%, not 100%. Check your course outline.</span>" : "";
    $("mbBox").innerHTML =
      '<div class="card mb-sum"><div class="mb-avg"><span class="mb-big">' + pct(r.avg) + '</span><span class="hint">average so far<br>from ' + r1(r.done) + "% of the module</span></div>" +
      '<div class="mb-target"><span class="lbl">Final mark I want</span><div class="chips">' + [50, 60, 65, 70, 75].map((t) => '<button type="button" class="chip' + (t === target ? " on" : "") + '" data-mb-target="' + t + '" aria-pressed="' + (t === target) + '">' + t + "%</button>").join("") + "</div></div>" +
      '<span class="mb-need ' + needCls + '">' + needTxt + "</span>" + subTxt + dpTxt + wTxt + "</div>" +
      '<div class="card mb-list">' + r.top.map((t) => rowHtml(t)).join("") + "</div>" +
      '<div class="two"><button type="button" class="btn primary" data-mb-add>Add a test, tut or exam</button><button type="button" class="btn ghost" data-mb-rules>DP and subminimum</button></div>';
  }
  function rowHtml(t) {
    const x = t.x, kids = items.filter((k) => k.group_id === x.id);
    if (x.is_group) {
      return '<div class="mb-row grp"><button type="button" class="mb-name" data-mb-edit="' + esc(x.id) + '"><b>' + esc(x.name) + '</b><span>' + esc((t.n >= kids.length ? "All " + kids.length + " count" : "Best " + t.n + " of " + kids.length) + " · " + r1(t.W) + "% of final") + "</span></button>" +
        '<span class="mb-avg-s">' + (t.avg == null ? "–" : r1(t.avg) + "%") + "</span></div>" +
        '<div class="mb-kids">' + kids.map((k) => '<label class="mb-kid"><span>' + esc(k.name) + '</span><input type="number" inputmode="decimal" min="0" max="100" placeholder="–" value="' + (k.mark == null ? "" : +k.mark) + '" data-mb-mark="' + esc(k.id) + '" aria-label="' + esc(k.name) + ' mark"></label>').join("") + "</div>";
    }
    return '<div class="mb-row"><button type="button" class="mb-name" data-mb-edit="' + esc(x.id) + '"><b>' + esc(x.name) + '</b><span><i class="mb-kind">' + esc(x.kind) + "</i> " + r1(t.W) + "% of final</span></button>" +
      '<label class="mb-in"><input type="number" inputmode="decimal" min="0" max="100" placeholder="–" value="' + (x.mark == null ? "" : +x.mark) + '" data-mb-mark="' + esc(x.id) + '" aria-label="' + esc(x.name) + ' mark"><span>%</span></label></div>';
  }

  /* ---------- changing things ---------- */
  const saveT = {};
  $("mbBox").addEventListener("input", (e) => {
    const inp = e.target.closest("[data-mb-mark]"); if (!inp) return;
    const it = items.find((x) => x.id === inp.dataset.mbMark); if (!it) return;
    const v = inp.value === "" ? null : Math.max(0, Math.min(100, parseFloat(inp.value)));
    if (inp.value !== "" && !isFinite(v)) return;
    it.mark = v;
    clearTimeout(saveT[it.id]);
    saveT[it.id] = setTimeout(async () => {
      const { error } = await F.sb.from("grade_items").update({ mark: v }).eq("id", it.id);
      if (error) return F.toast("Couldn't save that mark: " + error.message, { long: true });
      remember(); const keep = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.mbMark; render();
      if (keep) { const el = document.querySelector('[data-mb-mark="' + keep + '"]'); if (el) { el.focus(); const n = el.value.length; try { el.setSelectionRange(n, n); } catch (er) {} } }
    }, 700);
  });
  $("mbBox").addEventListener("click", async (e) => {
    const t = e.target.closest("[data-mb-target]");
    if (t) { F.saveModule(mod, { target: +t.dataset.mbTarget }); render(); remember(); return; }
    if (e.target.closest("[data-mb-add]")) return openSheet(null);
    const ed = e.target.closest("[data-mb-edit]"); if (ed) return openSheet(items.find((x) => x.id === ed.dataset.mbEdit));
    if (e.target.closest("[data-mb-template]")) return template();
    if (e.target.closest("[data-mb-rules]")) return rules();
  });
  async function insert(rows) {
    const { data, error } = await F.sb.from("grade_items").insert(rows.map((r) => Object.assign({ user_id: F.me.id, module_code: mod.code }, r))).select();
    if (error) { F.toast("Couldn't save: " + error.message, { long: true }); return null; }
    return data || [];
  }
  async function addSet(name, count, best, weight, pos) {
    const g = await insert([{ name, kind: "Tutorial", weight, is_group: true, best_n: best, position: pos }]); if (!g) return;
    const kids = await insert(Array.from({ length: count }, (_, i) => ({ name: name.replace(/s$/i, "") + " " + (i + 1), kind: "Tutorial", group_id: g[0].id, position: i })));
    items.push(...g, ...(kids || []));
  }
  async function template() {
    await addSet("Tuts", 10, 4, 10, 0);
    const rest = await insert([{ name: "Test 1", kind: "Test", weight: 15, position: 1 }, { name: "Test 2", kind: "Test", weight: 15, position: 2 }, { name: "Exam", kind: "Exam", weight: 60, position: 3 }]);
    if (rest) items.push(...rest);
    render(); remember(); F.toast("Added. Change the numbers to match your course outline.", { long: true });
  }
  function rules() { openRules(); }
  function openRules() {
    editing = { rules: true };
    $("mbTitle").textContent = "DP and subminimum · " + mod.code;
    $("mbKind").hidden = true; document.querySelector('label[for="mbKind"]').hidden = true;
    $("mbOne").hidden = false; $("mbSet").hidden = true;
    document.querySelector('label[for="mbName"]').textContent = "DP: class mark needed to write the exam (%)";
    $("mbName").type = "number"; $("mbName").value = mod.dp_min != null ? +mod.dp_min : ""; $("mbName").placeholder = "e.g. 40";
    document.querySelector('label[for="mbWeight"]').textContent = "Exam subminimum (%)"; $("mbWeight").value = mod.subminimum != null ? +mod.subminimum : ""; $("mbWeight").placeholder = "e.g. 40";
    $("mbMark").parentElement.hidden = true; $("mbDelete").hidden = true; $("mbSave").textContent = "Save";
    F.showError("mbError", ""); $("mbSheet").showModal();
  }
  function resetSheet() {
    $("mbKind").hidden = false; document.querySelector('label[for="mbKind"]').hidden = false;
    document.querySelector('label[for="mbName"]').textContent = "Name"; $("mbName").type = "text"; $("mbName").placeholder = "e.g. Test 1";
    document.querySelector('label[for="mbWeight"]').textContent = "Worth (% of final)"; $("mbWeight").placeholder = "e.g. 15";
    $("mbMark").parentElement.hidden = false;
  }
  function openSheet(it) {
    resetSheet(); editing = it || null;
    $("mbKind").innerHTML = TYPES.map((t) => "<option>" + esc(t) + "</option>").join("") + (it ? "" : "<option>" + esc(SET) + "</option>");
    $("mbTitle").textContent = it ? "Edit " + it.name : "Add to " + mod.code;
    $("mbSave").textContent = it ? "Save" : "Add"; $("mbDelete").hidden = !it;
    if (it) {
      $("mbKind").value = TYPES.includes(it.kind) ? it.kind : "Test";
      if (it.is_group) { $("mbOne").hidden = true; $("mbSet").hidden = false; $("mbKind").disabled = true; $("mbSetName").value = it.name; const nk = items.filter((k) => k.group_id === it.id).length; $("mbCount").value = nk; $("mbCount").disabled = false; $("mbBest").value = it.best_n || nk; $("mbAll").checked = !it.best_n || it.best_n >= nk; syncAll(); $("mbSetWeight").value = it.weight ?? ""; }
      else { $("mbOne").hidden = false; $("mbSet").hidden = true; $("mbKind").disabled = false; $("mbName").value = it.name; $("mbWeight").value = it.weight ?? ""; $("mbMark").value = it.mark ?? ""; }
    } else { $("mbForm").reset(); $("mbKind").disabled = false; $("mbCount").disabled = false; $("mbKind").value = "Test"; $("mbOne").hidden = false; $("mbSet").hidden = true; $("mbCount").value = 10; $("mbBest").value = 4; $("mbAll").checked = false; syncAll(); }
    F.showError("mbError", ""); $("mbSheet").showModal();
  }
  $("mbKind").addEventListener("change", () => { const set = $("mbKind").value === SET; $("mbOne").hidden = set; $("mbSet").hidden = !set; if (!set && !$("mbName").value) $("mbName").placeholder = "e.g. " + ($("mbKind").value === "Exam" ? "Exam" : $("mbKind").value + " 1"); });
  const num = (id) => { const v = parseFloat($(id).value); return isFinite(v) ? v : null; };
  // "All of them count": best = how many there are
  function syncAll() { const all = $("mbAll").checked; $("mbBest").disabled = all; if (all) $("mbBest").value = $("mbCount").value; }
  $("mbAll").addEventListener("change", syncAll);
  $("mbCount").addEventListener("input", () => { if ($("mbAll").checked) $("mbBest").value = $("mbCount").value; });
  $("mbForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (editing && editing.rules) {
      const dp = num("mbName"), sub = num("mbWeight");
      if ((dp != null && (dp < 0 || dp > 100)) || (sub != null && (sub < 0 || sub > 100))) return F.showError("mbError", "Use numbers from 0 to 100.");
      F.saveModule(mod, { dp_min: dp, subminimum: sub }); $("mbSheet").close(); render(); return;
    }
    if ($("mbKind").value === SET || (editing && editing.is_group)) {
      const name = $("mbSetName").value.trim() || "Tuts", count = Math.round(num("mbCount") || 0), w = num("mbSetWeight");
      const best = $("mbAll").checked ? count : Math.round(num("mbBest") || 0);
      if (w == null || w < 0 || w > 100) return F.showError("mbError", "Add how much the set is worth together (0 to 100%).");
      if (count < 1 || count > 50) return F.showError("mbError", "How many: 1 to 50.");
      if (best < 1 || best > count) return F.showError("mbError", "Best how many must be between 1 and how many there are (" + count + ").");
      if (editing) {
        // more or fewer tuts than before
        const kids = items.filter((k) => k.group_id === editing.id).sort((a, b) => a.position - b.position);
        if (count < kids.length) {
          const drop = kids.slice(count), marked = drop.filter((k) => k.mark != null).length;
          if (marked && !(await F.confirm("Remove " + drop.length + " from the set?", marked + " of them already " + (marked === 1 ? "has a mark" : "have marks") + ". Those marks are deleted.", "Remove"))) return;
          const { error } = await F.sb.from("grade_items").delete().in("id", drop.map((k) => k.id));
          if (error) return F.showError("mbError", error.message);
          items = items.filter((x) => !drop.includes(x));
        } else if (count > kids.length) {
          const base = name.replace(/s$/i, ""), more = await insert(Array.from({ length: count - kids.length }, (_, i) => ({ name: base + " " + (kids.length + i + 1), kind: editing.kind || "Tutorial", group_id: editing.id, position: kids.length + i })));
          if (more) items.push(...more);
        }
      }
      $("mbSave").disabled = true;
      if (editing) { const { error } = await F.sb.from("grade_items").update({ name, best_n: best, weight: w }).eq("id", editing.id); if (error) { $("mbSave").disabled = false; return F.showError("mbError", error.message); } Object.assign(editing, { name, best_n: best, weight: w }); }
      else await addSet(name, count, best, w, items.length);
      $("mbSave").disabled = false; $("mbSheet").close(); render(); remember(); return;
    }
    const kind = $("mbKind").value, name = $("mbName").value.trim() || (kind === "Exam" ? "Exam" : kind), w = num("mbWeight"), mk = num("mbMark");
    if (w == null || w < 0 || w > 100) return F.showError("mbError", "Add how much it's worth, as a % of your final mark (0 to 100).");
    if (mk != null && (mk < 0 || mk > 100)) return F.showError("mbError", "Marks are 0 to 100%.");
    $("mbSave").disabled = true;
    if (editing) {
      const patch = { kind, name, weight: w, mark: mk };
      const { error } = await F.sb.from("grade_items").update(patch).eq("id", editing.id);
      $("mbSave").disabled = false; if (error) return F.showError("mbError", error.message);
      Object.assign(editing, patch);
    } else {
      const rows = await insert([{ kind, name, weight: w, mark: mk, position: items.length }]); $("mbSave").disabled = false; if (!rows) return;
      items.push(...rows);
    }
    $("mbSheet").close(); render(); remember();
  });
  $("mbDelete").onclick = async () => {
    if (!editing || editing.rules) return;
    const it = editing;
    if (!(await F.confirm("Delete " + it.name + "?", it.is_group ? "All the marks in this set are deleted too." : "Its mark is removed from your average.", "Delete"))) return;
    const { error } = await F.sb.from("grade_items").delete().eq("id", it.id);
    if (error) return F.toast("Couldn't delete: " + error.message);
    items = items.filter((x) => x.id !== it.id && x.group_id !== it.id); $("mbSheet").close(); render(); remember();
  };
})();
