/* Birthdays: your day (party dashboard, birthday card, rest day) and your circle's (banner, 🎂 tag, sign the card). Needs funi-v20-setup.sql. */
(() => {
  const F = window.Funi, $ = F.$, esc = F.esc, S = F.s;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const STK = ["🥳", "🎂", "💜", "🎈", "👑", "🎉", "🌸", "🔥"];
  let mine = null, circle = [], wishes = [], signed = new Set(), ready = false, missing = false;
  const pad = (n) => String(n).padStart(2, "0");
  const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  // this year's date for a birthday (29 Feb becomes 28 Feb in other years)
  F.bdayDate = (b, y) => { let d = +b.day; const m = +b.month; if (m === 2 && d === 29 && !leap(y)) d = 28; d = Math.min(d, new Date(y, m, 0).getDate()); return y + "-" + pad(m) + "-" + pad(d); };
  const year = () => +F.todayISO().slice(0, 4);
  const isToday = (b) => !!b && F.bdayDate(b, year()) === F.todayISO();
  F.isMyBirthdayOn = (date) => !!(mine && mine.rest && F.bdayDate(mine, date.getFullYear()) === F.isoOf(date));
  const thankedKey = () => "funi.bdThanked." + (F.me ? F.me.id : "x") + "." + year();
  const nameOf = (id) => (F.profiles && F.profiles[id] ? F.nameOf(F.profiles[id]) : "Your friend");
  const avaOf = (id) => (F.profiles && F.profiles[id] ? F.avatar(F.profiles[id], "Feeling great") : "🎂");
  const hat = '<svg class="bd-hat" viewBox="0 0 40 44" aria-hidden="true"><path d="M8 42L20 4L32 42Z" fill="#FF8FB1"/><path d="M13 30L27 30M16 20L24 20" stroke="#FFC857" stroke-width="3"/><circle cx="20" cy="5" r="5" fill="#FFC857"/></svg>';
  const confetti = () => '<div class="bd-confetti" aria-hidden="true">' + Array.from({ length: 18 }, (_, i) => '<i style="left:' + ((i * 37) % 100) + "%;background:" + ["#FF8FB1", "#FFC857", "#6FD3A2", "#8FB5FF", "#B9A3F7"][i % 5] + ";animation-delay:" + ((i * .29) % 3).toFixed(2) + "s;animation-duration:" + (2.6 + (i % 4) * .4).toFixed(1) + 's"></i>').join("") + "</div>";
  const balloons = () => [["#FF8FB1", 4, 10, 0], ["#FFC857", 86, 8, 1.2], ["#8FB5FF", 92, 70, 2], ["#6FD3A2", 2, 74, .6]].map(([c, x, y, d]) => '<span class="bd-balloon" aria-hidden="true" style="background:' + c + ";left:" + x + "%;top:" + y + "px;animation-delay:" + d + 's"></span>').join("");

  /* ---------- loading ---------- */
  async function load() {
    if (!F.sb || !F.me) return;
    const { data, error } = await F.sb.from("birthdays").select("*");
    if (error) { missing = /birthdays|schema cache|relation/i.test(error.message); ready = true; render(); return; }
    missing = false;
    mine = data.find((b) => b.user_id === F.me.id) || null;
    circle = data.filter((b) => b.user_id !== F.me.id);
    const today = circle.filter(isToday).map((b) => b.user_id);
    const [w, s] = await Promise.all([
      mine && isToday(mine) ? F.sb.from("birthday_wishes").select("*").eq("to_user", F.me.id).eq("year", year()).order("created_at") : Promise.resolve({ data: [] }),
      today.length ? F.sb.from("birthday_wishes").select("to_user").eq("from_user", F.me.id).eq("year", year()).in("to_user", today) : Promise.resolve({ data: [] })
    ]);
    wishes = w.data || []; signed = new Set((s.data || []).map((x) => x.to_user));
    // names and avatars for people who aren't study partners (e.g. house members)
    const need = [...new Set(today.concat(wishes.map((x) => x.from_user)))].filter((id) => !F.profiles[id]);
    if (need.length) { const pr = await F.sb.from("study_profiles").select("*").in("id", need); (pr.data || []).forEach((p) => { F.profiles[p.id] = p; }); }
    ready = true; render();
    if (S.view === "plan" && F.renderPlan) F.renderPlan();
  }
  F.loadBirthdays = load;
  F.on("login", () => setTimeout(load, 900));
  F.on("resume", load);
  F.on("rt:notification", (n) => { if (n && n.kind === "birthday") load(); });

  /* ---------- the dashboard ---------- */
  function render() {
    const party = $("bdayParty"), fr = $("bdayFriends"); if (!party || !F.me) return;
    if (mine && isToday(mine)) {
      const me = S.profile || F.profiles[F.me.id] || { id: F.me.id };
      party.hidden = false;
      party.innerHTML = confetti() + balloons() + '<span class="bd-me"><span class="ava">' + F.avatar(me, "Feeling great") + "</span>" + hat + "</span>" +
        "<h2>Happy birthday, " + esc(F.nameOf(me)) + "! 🎂</h2><p>Funi is celebrating with you today" + (mine.rest ? " · no study blocks, enjoy your day 💆🏾‍♀️" : "") + "</p>" +
        '<button type="button" class="btn primary" data-bd-card>Open my birthday card 💌' + (wishes.length ? " (" + wishes.length + ")" : "") + "</button>";
    } else party.hidden = true;
    const today = circle.filter(isToday);
    fr.hidden = !today.length;
    fr.innerHTML = today.map((b) => { const done = signed.has(b.user_id);
      return '<div class="bd-friend">' + confetti() + '<span class="bd-me sm"><span class="ava">' + avaOf(b.user_id) + "</span>" + hat + '</span><div class="grow"><b>It\'s ' + esc(nameOf(b.user_id)) + "'s birthday today 🎂</b><span>" + (done ? "You signed the card 💜" : "Send a wish and make their day") + "</span></div>" +
        '<button type="button" class="btn ' + (done ? "ghost" : "primary") + ' small" data-bd-sign="' + esc(b.user_id) + '">' + (done ? "Edit my wish" : "Sign the card 💌") + "</button></div>"; }).join("");
  }
  F.on("view:dash", () => { render(); if (!ready) load(); });
  F.on("data", () => { if (S.view === "dash") render(); });
  // 🎂 next to a name in your partners list
  F.birthdayTag = (id) => (circle.some((b) => b.user_id === id && isToday(b)) ? ' <span class="bd-tag">🎂 Birthday</span>' : "");

  /* ---------- your birthday card ---------- */
  function openCard() {
    $("bdcBody").innerHTML = wishes.length ? wishes.map((w) => '<div class="bd-wish"><div class="bd-who"><span class="ava">' + avaOf(w.from_user) + "</span><b>" + esc(nameOf(w.from_user)) + "</b></div><p>" + esc(w.body) + "</p>" + (w.sticker ? '<span class="bd-stk-big" aria-hidden="true">' + esc(w.sticker) + "</span>" : "") + "</div>").join("")
      : '<div class="empty"><b>No wishes yet</b><span>As your partners and house sign your card, their wishes appear here.</span></div>';
    let thanked = false; try { thanked = localStorage.getItem(thankedKey()) === "1"; } catch (e) {}
    $("bdThank").hidden = !wishes.length; $("bdThank").disabled = thanked; $("bdThank").textContent = thanked ? "✓ You thanked everyone" : "Thank everyone";
    $("bdCardSheet").showModal();
  }
  $("bdThank").onclick = async () => {
    $("bdThank").disabled = true;
    const { data, error } = await F.sb.rpc("funi_birthday_thanks", { y: year() });
    if (error) { $("bdThank").disabled = false; return F.toast("Couldn't send: " + error.message, { long: true }); }
    try { localStorage.setItem(thankedKey(), "1"); } catch (e) {}
    $("bdThank").textContent = "✓ You thanked everyone"; F.toast("Sent a thank-you to " + (data || 0) + (data === 1 ? " person" : " people") + " 💜");
  };

  /* ---------- sign someone's card ---------- */
  let signFor = null, stk = STK[0];
  async function openSign(id) {
    signFor = id; stk = STK[0];
    $("bdsTitle").textContent = "Sign " + nameOf(id) + "'s card 💌";
    $("bdsText").value = ""; F.showError("bdsError", "");
    if (signed.has(id)) { const { data } = await F.sb.from("birthday_wishes").select("*").eq("to_user", id).eq("from_user", F.me.id).eq("year", year()).maybeSingle(); if (data) { $("bdsText").value = data.body; stk = data.sticker || STK[0]; } }
    $("bdsStk").innerHTML = STK.map((e) => '<button type="button" data-bds="' + e + '" aria-pressed="' + (e === stk) + '" aria-label="Sticker ' + e + '">' + e + "</button>").join("");
    $("bdSignSheet").showModal(); setTimeout(() => $("bdsText").focus(), 50);
  }
  $("bdsStk").addEventListener("click", (e) => { const b = e.target.closest("[data-bds]"); if (!b) return; stk = b.dataset.bds; $("bdsStk").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); });
  $("bdSignForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = $("bdsText").value.trim(); if (!body) return F.showError("bdsError", "Write a short wish first.");
    $("bdsSend").disabled = true;
    const { error } = await F.sb.from("birthday_wishes").upsert({ to_user: signFor, from_user: F.me.id, year: year(), body, sticker: stk }, { onConflict: "to_user,from_user,year" });
    $("bdsSend").disabled = false;
    if (error) return F.showError("bdsError", /row-level|policy/i.test(error.message) ? "The card is only open on their birthday (and the day after)." : "Couldn't sign: " + error.message);
    signed.add(signFor); $("bdSignSheet").close(); render(); F.chime && F.chime("birthday"); F.toast("You signed " + nameOf(signFor) + "'s card 💜");
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-bd-card]")) return openCard();
    const s = e.target.closest("[data-bd-sign]"); if (s) return openSign(s.dataset.bdSign);
  });
  // from a notification
  F.openBirthday = async (id) => { if (!ready) await load(); if (id === F.me.id) openCard(); else if (circle.some((b) => b.user_id === id && isToday(b))) openSign(id); else F.toast("That birthday card is closed now."); };

  /* ---------- Profile › My birthday ---------- */
  let who = true;
  function fillProfile() {
    const d = $("bdDay"), m = $("bdMonth"); if (!d) return;
    if (!d.options.length) { d.innerHTML = '<option value="">Day</option>' + Array.from({ length: 31 }, (_, i) => "<option>" + (i + 1) + "</option>").join(""); m.innerHTML = '<option value="">Month</option>' + MONTHS.map((x, i) => '<option value="' + (i + 1) + '">' + x + "</option>").join(""); }
    d.value = mine ? String(mine.day) : ""; m.value = mine ? String(mine.month) : "";
    who = mine ? mine.visible !== false : true; $("bdRest").checked = mine ? mine.rest !== false : true;
    document.querySelectorAll("[data-bd-who]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.bdWho === "1") === who)));
    $("bdSave").textContent = mine ? "Save changes" : "Save my birthday";
    // once it's saved, just show it with an Edit button
    const done = !!mine && !editing;
    $("bdDone").hidden = !done; $("bdForm").hidden = done; $("bdCancel").hidden = !mine;
    if (mine) {
      $("bdDoneText").textContent = mine.day + " " + MONTHS[mine.month - 1];
      $("bdDoneMore").textContent = (mine.visible !== false ? "Your partners and houses can see it." : "Nobody else can see it. 🤫") + (mine.rest !== false ? " Rest day on your birthday." : "");
    }
  }
  let editing = false;
  $("bdEdit").onclick = () => { editing = true; fillProfile(); };
  $("bdCancel").onclick = () => { editing = false; fillProfile(); };
  F.on("view:profile", async () => { if (!ready) await load(); editing = false; fillProfile(); });
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-bd-who]"); if (!b) return; who = b.dataset.bdWho === "1"; document.querySelectorAll("[data-bd-who]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); });
  $("bdSave").onclick = async () => {
    const day = +$("bdDay").value, month = +$("bdMonth").value;
    if (!day || !month) return F.toast("Choose the day and the month.");
    if (day > new Date(2024, month, 0).getDate()) return F.toast(MONTHS[month - 1] + " doesn't have " + day + " days.");
    $("bdSave").disabled = true;
    const { data, error } = await F.sb.from("birthdays").upsert({ user_id: F.me.id, day, month, visible: who, rest: $("bdRest").checked, updated_at: new Date().toISOString() }, { onConflict: "user_id" }).select().single();
    $("bdSave").disabled = false;
    if (error) return F.toast(/birthdays|schema cache/i.test(error.message) ? "Birthdays need one setup step: run funi-v20-setup.sql in Supabase." : "Couldn't save: " + error.message, { long: true });
    mine = data; editing = false; fillProfile(); render();
    F.toast("Saved: " + day + " " + MONTHS[month - 1] + (who ? ". Your partners and houses will be reminded." : ". Only you'll know. 🤫"));
  };
})();
