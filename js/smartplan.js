/* Funi smart planner
   A model of forgetting + an optimiser. Each module has a memory level R (0 to 1) that decays
   over time, R(t) = R0 · e^(−t/S), where S is how stable the memory is (in days). A study hour
   closes part of the gap to 100% and makes the memory more stable, more so if you had forgotten
   more (the spacing effect); two hours of the same module back to back count for less.
   The planner picks which module goes in each free hour of the next 7 days to make the weighted
   memory on each test day as high as possible, while keeping your rules: only free hours, your
   daily limit, a break after 3 hours, nothing for a module after its test.
   It starts from a greedy plan and improves it with simulated annealing. */
(() => {
  const F = window.Funi = window.Funi || {};
  const DAYS = 7, HRS = DAYS * 24;
  const G = 0.32, C = 1.1, MASSED = 0.7; // how much one hour teaches, how much more stable it makes the memory, and how much a 2nd hour in a row counts

  // the same "random" numbers all day, so the plan doesn't jump around each time you open it
  function rng(seed) {
    let s = 0; for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // P = { free: [7][24] booleans, cap: [7] hours, mods: [{ R0, S0, w, testH }] }   A = [7][24] module index or -1
  function simulate(P, A, trace) {
    const n = P.mods.length, R = P.mods.map((m) => m.R0), S = P.mods.map((m) => m.S0), atTest = P.mods.map(() => null);
    const curve = trace ? P.mods.map(() => []) : null;
    let prev = -1;
    for (let g = 0; g < HRS; g++) {
      for (let i = 0; i < n; i++) if (atTest[i] === null && g >= P.mods[i].testH) atTest[i] = R[i];
      const m = A[Math.floor(g / 24)][g % 24];
      if (m >= 0) { const massed = prev === m, rb = R[m]; R[m] = rb + (massed ? G * MASSED : G) * (1 - rb); S[m] += (massed ? C * MASSED : C) * (1 - rb); }
      prev = m;
      for (let i = 0; i < n; i++) { R[i] *= Math.exp(-(1 / 24) / S[i]); if (trace) curve[i].push(R[i]); }
    }
    for (let i = 0; i < n; i++) if (atTest[i] === null) atTest[i] = R[i] * Math.exp(-((P.mods[i].testH - HRS) / 24) / S[i]);
    return { atTest, curve };
  }
  function evaluate(P, A) {
    const sim = simulate(P, A, false); let wsum = 0, val = 0, ws = 0, vs = 0;
    P.mods.forEach((m, i) => { wsum += m.w; val += m.w * sim.atTest[i]; if (m.testH <= HRS + 24) { ws += m.w; vs += m.w * sim.atTest[i]; } });
    const pen = { over: 0, after: 0, nobreak: 0 };
    for (let d = 0; d < DAYS; d++) { let used = 0, run = 0;
      for (let h = 0; h < 24; h++) { const m = A[d][h];
        if (m >= 0) { used++; run++; if (run > 3) pen.nobreak++; if (d * 24 + h >= P.mods[m].testH) pen.after++; } else run = 0; }
      if (used > P.cap[d]) pen.over += used - P.cap[d]; }
    const ready = wsum ? 100 * val / wsum : 0, readySoon = ws ? 100 * vs / ws : null;
    return { ready, readySoon, pen, broken: pen.over + pen.after + pen.nobreak, J: ready - 4 * pen.over - 6 * pen.after - 2 * pen.nobreak, atTest: sim.atTest };
  }
  const blank = () => Array.from({ length: DAYS }, () => new Array(24).fill(-1));

  // a quick first plan: each free hour goes to the module losing the most, weighted by how close its test is
  function greedy(P) {
    const A = blank(), R = P.mods.map((m) => m.R0), S = P.mods.map((m) => m.S0); let prev = -1;
    for (let d = 0; d < DAYS; d++) { let used = 0, run = 0;
      for (let h = 0; h < 24; h++) { const g = d * 24 + h; let m = -1;
        if (P.free[d][h] && used < P.cap[d] && run < 3) {
          let best = 0;
          P.mods.forEach((x, i) => { const left = x.testH - g; if (left <= 0) return;
            if (h >= 2 && A[d][h - 1] === i && A[d][h - 2] === i) return;
            const v = x.w * (1 - R[i]) * (1 + 24 / (left + 12)) * (prev === i ? 0.85 : 1);
            if (v > best) { best = v; m = i; } });
          if (m >= 0) { A[d][h] = m; used++; }
        }
        run = m >= 0 ? run + 1 : 0;
        if (m >= 0) { const massed = prev === m, rb = R[m]; R[m] = rb + (massed ? G * MASSED : G) * (1 - rb); S[m] += (massed ? C * MASSED : C) * (1 - rb); }
        prev = m;
        for (let i = 0; i < R.length; i++) R[i] *= Math.exp(-(1 / 24) / S[i]);
      } }
    return A;
  }
  // simulated annealing: small random changes; keep better ones, and some worse ones early on (probability e^(−Δ/T))
  function anneal(P, from, N, seed) {
    const rnd = rng(seed), free = [];
    for (let d = 0; d < DAYS; d++) for (let h = 0; h < 24; h++) if (P.free[d][h]) free.push([d, h]);
    let A = from.map((r) => r.slice()), cur = evaluate(P, A).J, best = A.map((r) => r.slice()), bestJ = cur;
    if (!free.length || !P.mods.length) return best;
    const T0 = 3, T1 = 0.01;
    for (let it = 0; it < N; it++) {
      const temp = T0 * Math.pow(T1 / T0, it / N), [d, h] = free[Math.floor(rnd() * free.length)], old = A[d][h];
      let undo;
      if (rnd() < 0.6) { A[d][h] = Math.floor(rnd() * (P.mods.length + 1)) - 1; undo = () => { A[d][h] = old; }; }
      else { const [d2, h2] = free[Math.floor(rnd() * free.length)], o2 = A[d2][h2]; A[d][h] = o2; A[d2][h2] = old; undo = () => { A[d][h] = old; A[d2][h2] = o2; }; }
      const nx = evaluate(P, A).J, drop = cur - nx;
      if (drop <= 0 || rnd() < Math.exp(-drop / temp)) { cur = nx; if (cur > bestJ) { bestJ = cur; best = A.map((r) => r.slice()); } } else undo();
    }
    return best;
  }

  F.smartPlanCore = { simulate, evaluate, greedy, anneal, blank, DAYS, HRS };
  F.planWeekSmart = (P, seed) => {
    const g = greedy(P), A = anneal(P, g, P.mods.length > 6 ? 2500 : 4000, seed);
    const a = evaluate(P, A), b = evaluate(P, g);
    return a.J >= b.J ? { A, ev: a } : { A: g, ev: b };
  };
})();
