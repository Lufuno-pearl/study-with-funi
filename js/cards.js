/* Funi flashcards (make decks, share them, flip to study) and quiz battles (you vs a friend). */
(function () {
  "use strict";
  const F = window.Funi, $ = F.$, esc = F.esc, S = F.s;
  const profiles = () => F.profiles || {};
  const nameOf = (id) => (id === (F.me && F.me.id) ? "You" : profiles()[id] ? F.nameOf(profiles()[id]) : "Your friend");
  const sameCode = (a, b) => String(a || "").trim().toUpperCase() === String(b || "").trim().toUpperCase();
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  let decks = [], cardsBy = {}, known = new Set(), sharesBy = {}, battles = [], answersBy = {}, missing = false;
  let dseg = "mine", curDeck = null;

  /* ---------- loading ---------- */
  async function loadDecks() {
    if (!F.sb || !F.me) return;
    const { data, error } = await F.sb.from("flash_decks").select("*").order("updated_at", { ascending: false });
    missing = !!error; decks = error ? [] : data || [];
    cardsBy = {}; sharesBy = {};
    if (decks.length) {
      const ids = decks.map((d) => d.id);
      const [c, p, sh] = await Promise.all([
        F.sb.from("flash_cards").select("*").in("deck_id", ids).order("position").order("created_at"),
        F.sb.from("flash_progress").select("card_id,known").eq("user_id", F.me.id),
        F.sb.from("flash_shares").select("*").in("deck_id", ids)
      ]);
      (c.data || []).forEach((x) => { (cardsBy[x.deck_id] = cardsBy[x.deck_id] || []).push(x); });
      known = new Set((p.data || []).filter((x) => x.known).map((x) => x.card_id));
      (sh.data || []).forEach((x) => { (sharesBy[x.deck_id] = sharesBy[x.deck_id] || []).push(x); });
    }
    const owners = decks.filter((d) => d.owner_id !== F.me.id).map((d) => d.owner_id);
    if (owners.length) await needProfiles(owners);
  }
  async function loadBattles() {
    if (!F.sb || !F.me) return;
    const { data, error } = await F.sb.from("quiz_battles").select("*").order("created_at", { ascending: false }).limit(40);
    battles = error ? [] : data || [];
    answersBy = {};
    if (battles.length) {
      const { data: ans } = await F.sb.from("quiz_answers").select("*").in("battle_id", battles.map((b) => b.id));
      (ans || []).forEach((a) => { (answersBy[a.battle_id] = answersBy[a.battle_id] || []).push(a); });
    }
    await needProfiles(battles.map((b) => (b.challenger_id === F.me.id ? b.opponent_id : b.challenger_id)));
  }
  async function needProfiles(ids) {
    const miss = [...new Set(ids)].filter((id) => id && !profiles()[id]);
    if (!miss.length) return;
    const { data } = await F.sb.from("study_profiles").select("*").in("id", miss);
    (data || []).forEach((p) => { profiles()[p.id] = p; });
  }
  const deckOf = (id) => decks.find((d) => d.id === id);
  const isMine = (d) => d && d.owner_id === F.me.id;
  function deckTone(d) { return F.colorOf && d.module_code ? F.colorOf(d.module_code) : "c-lav"; }

  /* ---------- battle maths ---------- */
  function battleScore(b, uid) {
    const a = (answersBy[b.id] || []).filter((x) => x.user_id === uid);
    return { done: a.length >= b.questions.length, n: a.length, right: a.filter((x) => x.correct).length, ms: a.reduce((t, x) => t + x.ms, 0) };
  }
  function battleStatus(b) {
    const me = F.me.id, other = b.challenger_id === me ? b.opponent_id : b.challenger_id;
    const a = battleScore(b, me), o = battleScore(b, other);
    if (!a.done) return { key: "turn", text: a.n ? "Your turn · question " + (a.n + 1) : "Your turn", a, o, other };
    if (!o.done) return { key: "wait", text: "Waiting for " + nameOf(other), a, o, other };
    const win = a.right > o.right || (a.right === o.right && a.ms < o.ms), tie = a.right === o.right && a.ms === o.ms;
    return { key: tie ? "tie" : win ? "won" : "lost", text: tie ? "It's a tie " + a.right + "–" + o.right : (win ? "You won " : nameOf(other) + " won ") + Math.max(a.right, o.right) + "–" + Math.min(a.right, o.right), a, o, other, win };
  }

  /* ---------- the decks page ---------- */
  async function renderDecks() {
    document.querySelectorAll("[data-dseg]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.dseg === dseg)));
    $("deckList").innerHTML = '<p class="hint">Loading…</p>';
    await Promise.all([loadDecks(), loadBattles()]);
    const shared = decks.filter((d) => !isMine(d)), turns = battles.filter((b) => battleStatus(b).key === "turn").length;
    $("sharedCount").hidden = !shared.length; $("sharedCount").textContent = shared.length;
    $("battleCount").hidden = !turns; $("battleCount").textContent = turns;
    if (missing) { $("deckList").innerHTML = '<div class="empty"><b>Flashcards aren\'t switched on yet</b><span>Run funi-v7-setup.sql in Supabase.</span></div>'; return; }
    if (dseg === "battles") return drawBattles();
    const list = dseg === "mine" ? decks.filter(isMine) : shared;
    if (!list.length) {
      $("deckList").innerHTML = dseg === "mine"
        ? '<div class="empty"><b>No decks yet</b><span>Make a deck of questions and answers for a module, then flip through them to revise.</span><button type="button" class="btn primary small" data-new-deck>Make a deck</button></div>'
        : '<div class="empty"><b>Nothing shared with you yet</b><span>When a study partner shares a deck, it shows up here.</span></div>';
      return;
    }
    $("deckList").innerHTML = list.map((d) => {
      const cards = cardsBy[d.id] || [], k = cards.filter((c) => known.has(c.id)).length, pct = cards.length ? Math.round((k / cards.length) * 100) : 0;
      const meta = isMine(d) ? k + " known · " + ((sharesBy[d.id] || []).length ? "shared with " + (sharesBy[d.id] || []).length : "only you") : "From " + nameOf(d.owner_id);
      return '<button type="button" class="deck-card ' + deckTone(d) + '" data-deck="' + esc(d.id) + '"><span class="between"><span><span class="dk-mod">' + esc(d.module_code || "General") + '</span><b>' + esc(d.title) + '</b></span><span class="dk-count">' + cards.length + " card" + (cards.length === 1 ? "" : "s") + '</span></span><span class="dk-bar"><i style="width:' + pct + '%"></i></span><span class="dk-meta">' + esc(meta) + "</span></button>";
    }).join("");
  }
  function drawBattles() {
    if (!battles.length) {
      $("deckList").innerHTML = '<div class="empty"><b>No quiz battles yet</b><span>Open a deck with 4 or more cards and tap Quiz battle to challenge a friend.</span></div>';
      return;
    }
    $("deckList").innerHTML = battles.map((b) => {
      const st = battleStatus(b), p = profiles()[st.other] || { id: st.other };
      const pill = st.key === "turn" ? "peach" : st.key === "wait" ? "lav" : st.key === "won" ? "mint" : "butter";
      return '<button type="button" class="battle-row" data-battle="' + esc(b.id) + '"><span class="ava sm">' + F.avatar(p) + '</span><span class="grow"><b>You vs ' + esc(nameOf(st.other)) + "</b><span>" + esc(b.deck_title) + " · " + b.questions.length + ' questions</span></span><span class="pill ' + pill + '">' + esc(st.text) + "</span></button>";
    }).join("");
  }
  document.querySelectorAll("[data-dseg]").forEach((b) => b.addEventListener("click", () => { dseg = b.dataset.dseg; renderDecks(); }));
  document.addEventListener("click", (e) => {
    const d = e.target.closest("[data-deck]"); if (d) { F.go("deck:" + d.dataset.deck); return; }
    const bt = e.target.closest("[data-battle]"); if (bt) { F.go("battle:" + bt.dataset.battle); return; }
    if (e.target.closest("[data-new-deck]")) openNewDeck();
  });

  /* ---------- new deck ---------- */
  function openNewDeck(code) {
    if (missing) return F.toast("Run funi-v7-setup.sql in Supabase first.", { long: true });
    $("dfTitle").value = ""; F.showError("dfError", "");
    $("dfModule").innerHTML = '<option value="">General</option>' + F.orderedModules().map((m) => '<option value="' + esc(m.code) + '">' + esc(m.code + (m.name ? " · " + m.name : "")) + "</option>").join("");
    if (code) $("dfModule").value = code;
    $("deckSheet").showModal(); $("dfTitle").focus();
  }
  F.openNewDeck = openNewDeck;
  $("deckNew").onclick = () => openNewDeck();
  $("deckForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("dfTitle").value.trim();
    if (!title) return F.showError("dfError", "Give your deck a name.");
    const { data, error } = await F.sb.from("flash_decks").insert({ owner_id: F.me.id, title: title.slice(0, 60), module_code: $("dfModule").value || null }).select().single();
    if (error) return F.showError("dfError", "Couldn't make the deck: " + error.message);
    decks.unshift(data); cardsBy[data.id] = [];
    $("deckSheet").close(); F.go("deck:" + data.id);
  });

  /* ---------- one deck ---------- */
  async function renderDeck() {
    if (!deckOf(curDeck)) await loadDecks();
    const d = deckOf(curDeck);
    if (!d) { F.toast("That deck isn't available any more."); F.go("decks"); return; }
    const cards = cardsBy[d.id] || [], mine = isMine(d), k = cards.filter((c) => known.has(c.id)).length;
    $("dkTitle").textContent = d.title;
    $("dkSub").textContent = (d.module_code || "General") + " · " + cards.length + " card" + (cards.length === 1 ? "" : "s") + " · " + k + " known" + (mine ? "" : " · from " + nameOf(d.owner_id));
    $("dkStudy").disabled = !cards.length;
    $("dkBattle").disabled = cards.length < 4; $("dkBattle").title = cards.length < 4 ? "Needs 4 or more cards" : "";
    $("dkShare").hidden = !mine;
    $("cardForm").hidden = !mine;
    $("dkDelete").textContent = mine ? "Delete deck" : "Remove from my shared decks";
    $("dkCards").innerHTML = cards.length ? cards.map((c, i) => '<div class="card-row"><span class="cr-num">' + (i + 1) + '</span><span class="grow"><b>' + esc(c.front) + "</b><span>" + esc(c.back) + "</span></span>" +
      (known.has(c.id) ? '<span class="pill mint">Known</span>' : "") + (mine ? '<button type="button" class="x-btn" data-del-card="' + esc(c.id) + '" aria-label="Delete card ' + (i + 1) + '">×</button>' : "") + "</div>").join("")
      : '<div class="empty"><b>No cards yet</b><span>Add a question and its answer above. Short answers work best.</span></div>';
    if (cards.length < 4 && cards.length) $("dkSub").textContent += " · add " + (4 - cards.length) + " more for quiz battles";
  }
  $("cardForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const front = $("cfFront").value.trim(), back = $("cfBack").value.trim();
    if (!front || !back) return F.showError("cfError", "Fill in both the question and the answer.");
    F.showError("cfError", "");
    const pos = (cardsBy[curDeck] || []).length;
    const { data, error } = await F.sb.from("flash_cards").insert({ deck_id: curDeck, front: front.slice(0, 300), back: back.slice(0, 300), position: pos }).select().single();
    if (error) return F.showError("cfError", error.message);
    (cardsBy[curDeck] = cardsBy[curDeck] || []).push(data);
    F.sb.from("flash_decks").update({ updated_at: new Date().toISOString() }).eq("id", curDeck).then(() => {}, () => {});
    $("cfFront").value = ""; $("cfBack").value = ""; $("cfFront").focus();
    renderDeck(); F.toast("Card added.");
  });
  $("dkCards").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-del-card]"); if (!b) return;
    const { error } = await F.sb.from("flash_cards").delete().eq("id", b.dataset.delCard);
    if (error) return F.toast("Couldn't delete: " + error.message);
    cardsBy[curDeck] = (cardsBy[curDeck] || []).filter((c) => c.id !== b.dataset.delCard); renderDeck();
  });
  $("dkDelete").onclick = async () => {
    const d = deckOf(curDeck); if (!d) return;
    if (isMine(d)) {
      if (!(await F.confirm("Delete " + d.title + "?", "All its cards go too, also for friends you shared it with.", "Delete"))) return;
      const { error } = await F.sb.from("flash_decks").delete().eq("id", d.id);
      if (error) return F.toast("Couldn't delete: " + error.message);
    } else {
      if (!(await F.confirm("Remove " + d.title + "?", "It disappears from your shared decks. " + nameOf(d.owner_id) + " keeps it.", "Remove"))) return;
      await F.sb.from("flash_shares").delete().eq("deck_id", d.id).eq("user_id", F.me.id);
    }
    decks = decks.filter((x) => x.id !== d.id); F.go("decks", { back: true });
  };
  $("dkShare").onclick = () => {
    const d = deckOf(curDeck); if (!d) return;
    const already = (sharesBy[d.id] || []).map((x) => x.user_id);
    F.pickPartner({ title: "Share " + d.title, text: "They can study it and use it for quiz battles. Only you can change it." }, async (ids) => {
      const { error } = await F.sb.from("flash_shares").upsert(ids.map((u) => ({ deck_id: d.id, user_id: u })), { onConflict: "deck_id,user_id", ignoreDuplicates: true });
      if (error) return F.toast("Couldn't share: " + error.message, { long: true });
      (sharesBy[d.id] = sharesBy[d.id] || []).push(...ids.map((u) => ({ deck_id: d.id, user_id: u })));
      F.toast("Shared with " + ids.map(nameOf).join(", ") + ".");
    }, { multi: true, ok: "Share", exclude: already });
  };
  $("dkStudy").onclick = () => F.go("flash:" + curDeck);
  $("dkBattle").onclick = () => {
    const d = deckOf(curDeck), cards = cardsBy[curDeck] || [];
    if (!d || cards.length < 4) return F.toast("Add at least 4 cards to start a quiz battle.");
    F.pickPartner({ title: "Challenge a friend", text: "You both answer the same " + Math.min(5, cards.length) + " questions. Most right wins; faster breaks a tie." }, (ids) => startBattle(d, cards, ids[0]));
  };

  /* ---------- flip to study ---------- */
  let queue = [], qi = 0, flipped = false, sessKnown = 0;
  function startFlash() {
    const cards = cardsBy[curDeck] || [];
    if (!cards.length) { F.go("deck:" + curDeck); return; }
    queue = shuffle(cards.filter((c) => !known.has(c.id))).concat(shuffle(cards.filter((c) => known.has(c.id))));
    qi = 0; flipped = false; sessKnown = 0;
    $("flPlay").hidden = false; $("flDone").hidden = true;
    drawFlash();
  }
  function drawFlash() {
    const d = deckOf(curDeck), c = queue[qi];
    $("flTitle").textContent = d ? d.title : "Study";
    $("flSub").textContent = "Card " + (qi + 1) + " of " + queue.length;
    $("flBar").style.width = Math.round((qi / queue.length) * 100) + "%";
    $("flCard").classList.toggle("back", flipped);
    $("flSide").textContent = flipped ? "ANSWER" : "QUESTION";
    $("flText").textContent = flipped ? c.back : c.front;
    $("flHint").textContent = flipped ? "Did you get it?" : "Tap to flip";
    $("flCard").setAttribute("aria-label", flipped ? "Show the question again" : "Flip to see the answer");
    $("flRate").hidden = !flipped; $("flThink").hidden = flipped;
  }
  $("flCard").onclick = () => { flipped = !flipped; drawFlash(); };
  async function rate(isKnown) {
    const c = queue[qi];
    if (isKnown) { known.add(c.id); sessKnown++; } else known.delete(c.id);
    F.sb.from("flash_progress").upsert({ user_id: F.me.id, card_id: c.id, known: isKnown, updated_at: new Date().toISOString() }, { onConflict: "user_id,card_id" }).then(() => {}, () => {});
    qi++; flipped = false;
    if (qi >= queue.length) return finishFlash();
    drawFlash();
  }
  $("flYes").onclick = () => rate(true);
  $("flNo").onclick = () => rate(false);
  function finishFlash() {
    const cards = cardsBy[curDeck] || [], k = cards.filter((c) => known.has(c.id)).length;
    $("flBar").style.width = "100%";
    $("flPlay").hidden = true; $("flDone").hidden = false;
    $("flDone").classList.remove("celebrate"); void $("flDone").offsetWidth; $("flDone").classList.add("celebrate");
    $("flDoneTitle").textContent = k === cards.length ? "You know them all!" : "Deck done!";
    $("flDoneMsg").textContent = "You know " + k + " of " + cards.length + " cards." + (k < cards.length ? " Go again and the tricky ones come first." : " Time for a quiz battle?");
  }
  $("flAgain").onclick = startFlash;

  /* ---------- quiz battles ---------- */
  async function startBattle(d, cards, opponent) {
    const picks = shuffle(cards).slice(0, Math.min(5, cards.length));
    const questions = picks.map((c) => {
      const wrong = shuffle([...new Set(cards.filter((x) => x.id !== c.id && x.back !== c.back).map((x) => x.back))]).slice(0, 3);
      while (wrong.length < 3) wrong.push(["None of these", "Not sure", "Can't tell"][wrong.length]);
      const o = shuffle([c.back].concat(wrong));
      return { q: c.front, o, a: o.indexOf(c.back) };
    });
    const { data, error } = await F.sb.from("quiz_battles").insert({ deck_id: d.id, deck_title: d.title, challenger_id: F.me.id, opponent_id: opponent, questions }).select().single();
    if (error) return F.toast("Couldn't start the battle: " + error.message, { long: true });
    battles.unshift(data); answersBy[data.id] = [];
    F.go("battle:" + data.id);
  }
  let battle = null, bq = 0, qStart = 0, timer = null, chan = null, answered = false;
  const QTIME = 20000;
  async function openBattle(id) {
    if (!battles.find((b) => b.id === id)) await loadBattles();
    battle = battles.find((b) => b.id === id);
    if (!battle) { F.toast("That battle isn't available."); F.go("decks:battles"); return; }
    if (chan) F.sb.removeChannel(chan);
    chan = F.sb.channel("battle-" + id).on("postgres_changes", { event: "INSERT", schema: "public", table: "quiz_answers", filter: "battle_id=eq." + id }, (p) => {
      const list = (answersBy[id] = answersBy[id] || []);
      if (!list.some((a) => a.user_id === p.new.user_id && a.q === p.new.q)) list.push(p.new);
      if (S.view === "battle" && battle && battle.id === id) { drawVs(); if (battleScore(battle, F.me.id).done) drawResult(); }
    }).subscribe();
    const mine = battleScore(battle, F.me.id);
    drawVs();
    if (mine.done) return drawResult();
    bq = mine.n; showQuestion();
  }
  function drawVs() {
    const st = battleStatus(battle), me = S.profile || { id: F.me.id }, p = profiles()[st.other] || { id: st.other };
    $("btSub").textContent = battle.deck_title + " · " + battle.questions.length + " questions";
    $("btVs").innerHTML = '<div class="vs-side"><span class="ava sm">' + F.avatar(me) + "</span><span><b>You</b><span class=\"vs-score\">" + st.a.right + '</span></span></div><span class="vs-mid">VS</span>' +
      '<div class="vs-side right"><span><b>' + esc(nameOf(st.other)) + '</b><span class="vs-score them">' + (st.o.done || st.a.done ? st.o.right : st.o.n ? "…" : "0") + '</span></span><span class="ava sm">' + F.avatar(p) + "</span></div>";
  }
  function showQuestion() {
    const q = battle.questions[bq];
    answered = false; qStart = Date.now();
    $("btPlay").hidden = false; $("btDone").hidden = true; $("btAfter").hidden = true;
    $("btBy").textContent = "QUESTION " + (bq + 1) + " OF " + battle.questions.length;
    $("btQ").textContent = q.q;
    $("btOptions").innerHTML = q.o.map((t, i) => '<button type="button" class="opt" data-opt="' + i + '"><span class="opt-l">' + "ABCD"[i] + "</span>" + esc(t) + "</button>").join("");
    clearInterval(timer);
    timer = setInterval(() => {
      const left = 1 - (Date.now() - qStart) / QTIME;
      $("btTime").style.width = Math.max(0, left * 100) + "%";
      $("btTime").classList.toggle("low", left < 0.3);
      if (left <= 0) answer(-1);
    }, 100);
  }
  async function answer(choice) {
    if (answered) return; answered = true; clearInterval(timer);
    const q = battle.questions[bq], ms = Math.min(QTIME, Date.now() - qStart), correct = choice === q.a;
    document.querySelectorAll("#btOptions .opt").forEach((b, i) => {
      b.disabled = true;
      if (i === q.a) b.classList.add("right"); else if (i === choice) b.classList.add("wrong");
    });
    const row = { battle_id: battle.id, user_id: F.me.id, q: bq, choice, correct, ms };
    (answersBy[battle.id] = answersBy[battle.id] || []).push(row);
    const { error } = await F.sb.from("quiz_answers").insert(row);
    if (error && !/duplicate/i.test(error.message)) F.toast("Your answer didn't save: " + error.message);
    const other = battleStatus(battle).other, theirs = (answersBy[battle.id] || []).find((a) => a.user_id === other && a.q === bq);
    $("btResult").textContent = (choice < 0 ? "Time's up! " : correct ? "Correct! +1 point. " : "Not this time. ") + (theirs ? nameOf(other) + (theirs.correct ? " got it in " + (theirs.ms / 1000).toFixed(1) + "s." : " missed it too.") : "");
    $("btResult").className = "bt-result " + (correct ? "good" : "bad");
    $("btNext").textContent = bq + 1 >= battle.questions.length ? "See results" : "Next";
    $("btAfter").hidden = false; drawVs();
  }
  $("btOptions").addEventListener("click", (e) => { const b = e.target.closest("[data-opt]"); if (b) answer(+b.dataset.opt); });
  $("btNext").onclick = () => { bq++; if (bq >= battle.questions.length) drawResult(); else showQuestion(); };
  function drawResult() {
    clearInterval(timer);
    const st = battleStatus(battle);
    $("btPlay").hidden = true; $("btDone").hidden = false;
    const card = $("btDone"); card.classList.remove("celebrate");
    if (st.key === "won" || st.key === "tie") { void card.offsetWidth; card.classList.add("celebrate"); }
    $("btDoneTitle").textContent = st.key === "wait" ? "You scored " + st.a.right + "/" + battle.questions.length : st.key === "won" ? "You won!" : st.key === "tie" ? "It's a tie!" : nameOf(st.other) + " won this one";
    $("btDoneMsg").textContent = st.key === "wait" ? "Waiting for " + nameOf(st.other) + " to play. You'll see the result here as soon as they finish."
      : "You " + st.a.right + " – " + st.o.right + " " + nameOf(st.other) + (st.key === "lost" ? ". Rematch?" : st.key === "won" ? ". Big brain energy!" : ". Rematch to settle it!");
    $("btRematch").hidden = st.key === "wait" || !battle.deck_id;
    drawVs();
  }
  $("btRematch").onclick = async () => {
    if (!battle || !battle.deck_id) return;
    await loadDecks();
    const d = deckOf(battle.deck_id), cards = cardsBy[battle.deck_id] || [];
    if (!d || cards.length < 4) return F.toast("That deck isn't available for a rematch.");
    startBattle(d, cards, battleStatus(battle).other);
  };

  /* ---------- hooks ---------- */
  F.on("view:decks", (sub) => { if (sub) dseg = sub; renderDecks(); });
  F.on("view:deck", (id) => { if (id) curDeck = id; renderDeck(); });
  F.on("view:flash", (id) => { if (id) curDeck = id; startFlash(); });
  F.on("view:battle", (id) => { if (id) openBattle(id); });
  F.on("rt:notification", (n) => { if (n && (n.kind === "deck" || n.kind === "battle") && S.view === "decks") renderDecks(); });
})();
