/* Getting started: three steps on the dashboard until they're done (or hidden) */
(() => {
  const F = window.Funi, $ = F.$, esc = F.esc, S = F.s;
  const k = (n) => "funi." + n + "." + (F.me ? F.me.id : "x");
  const steps = () => [
    { done: (S.modules || []).length > 0, go: "priorities", t: "Add your modules", s: "The modules you're doing this semester." },
    { done: (S.items || []).length + ((S.pastItems || []).length) > 0, go: "exams", t: "Add your tests and exams", s: "Dates and times, so Funi can count down and plan." },
    { done: !!F.read(k("sawPlan"), false), go: "plan", t: "See your smart study plan", s: "Funi plans your week around your classes and tests." }
  ];
  function render() {
    const box = $("welcomeCard"); if (!box || !F.me) return;
    const st = steps(), left = st.filter((x) => !x.done).length;
    if (!left || F.read(k("welcomeHidden"), false)) { box.hidden = true; return; }
    const n = st.length - left;
    box.hidden = false;
    box.innerHTML = '<div class="wc-head"><div class="grow"><h2 id="wcTitle">Get started with Funi</h2><span class="hint">' + n + " of " + st.length + ' done</span></div><button type="button" class="btn ghost small" data-wc-hide>Hide</button></div>' +
      '<div class="wc-bar" aria-hidden="true"><i style="width:' + Math.round(n / st.length * 100) + '%"></i></div>' +
      '<ol class="wc-steps">' + st.map((x, i) => '<li class="' + (x.done ? "done" : "") + '"><button type="button" data-go="' + x.go + '"' + (x.done ? ' aria-label="Done: ' + esc(x.t) + '"' : "") + '><span class="wc-n">' + (x.done ? "✓" : i + 1) + '</span><span class="grow"><b>' + esc(x.t) + "</b><span>" + esc(x.s) + "</span></span></button></li>").join("") + "</ol>";
  }
  F.renderWelcome = render;
  document.addEventListener("click", (e) => { if (e.target.closest("[data-wc-hide]")) { F.store(k("welcomeHidden"), true); render(); } });
  F.on("view:plan", () => { if (F.me) F.store(k("sawPlan"), true); });
  F.on("data", () => { if (S.view === "dash") render(); });
  F.on("view:dash", render);
  F.on("login", () => setTimeout(render, 800));
})();
