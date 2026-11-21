/* Funi's sounds: a short chime when something new comes in while Funi is open (phones use their own sound for pop-up notifications) */
(() => {
  const F = window.Funi, $ = F.$;
  const on = () => { try { return localStorage.getItem("funi.sound") !== "0"; } catch (e) { return true; } };
  let ctx = null;
  // browsers only allow sound after you've tapped something, so get ready on the first tap
  const unlock = () => { try { const A = window.AudioContext || window.webkitAudioContext; if (!A) return; ctx = ctx || new A(); if (ctx.state === "suspended") ctx.resume(); } catch (e) {} };
  document.addEventListener("pointerdown", unlock, { passive: true });
  document.addEventListener("keydown", unlock);
  const TUNES = {
    birthday: [[523.25, 0], [659.25, .12], [783.99, .24], [1046.5, .36]], // a happy little arpeggio
    message: [[659.25, 0], [880, .11]],
    other: [[783.99, 0]]
  };
  F.chime = (kind, force) => {
    if (!force && !on()) return;
    try {
      unlock(); if (!ctx) return;
      const t = ctx.currentTime + .02;
      (TUNES[kind] || TUNES.other).forEach(([f, d]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(.16, t + d + .02); g.gain.exponentialRampToValueAtTime(.001, t + d + .5);
        o.connect(g); g.connect(ctx.destination); o.start(t + d); o.stop(t + d + .55);
      });
    } catch (e) {}
  };
  // something new came in while Funi is open on the screen
  F.on("rt:notification", (n) => {
    if (!n || document.visibilityState !== "visible") return;
    F.chime(n.kind === "birthday" ? "birthday" : n.kind === "message" || n.kind === "help" ? "message" : "other");
  });
  // Profile › Sounds
  const box = $("soundOn");
  if (box) {
    box.checked = on();
    box.addEventListener("change", () => { try { localStorage.setItem("funi.sound", box.checked ? "1" : "0"); } catch (e) {} if (box.checked) F.chime("message", true); });
    $("soundTest").onclick = () => F.chime("birthday", true);
  }
})();
