/* Funi in numbers: usage stats that only the app owner can see (funi-v18-setup.sql) */
(() => {
  const F = window.Funi, $ = F.$, esc = F.esc;
  let isAdmin = null, last = null;
  async function check() {
    if (!F.sb || !F.me) return;
    if (isAdmin === null) { const { data, error } = await F.sb.rpc("funi_is_admin"); isAdmin = !error && data === true; }
    $("adminCard").hidden = !isAdmin;
  }
  F.on("view:profile", check);
  F.on("login", () => { isAdmin = null; });
  const n = (v) => Number(v || 0).toLocaleString("en-ZA");
  function tile(big, label) { return '<div class="st-tile"><b>' + esc(big) + "</b><span>" + esc(label) + "</span></div>"; }
  function chart(weeks) {
    const max = Math.max(1, ...weeks.map((w) => +w.hours || 0));
    return '<div class="st-chart" role="img" aria-label="Study hours per week for the last 8 weeks">' + weeks.map((w) => {
      const h = +w.hours || 0, d = new Date(w.week + "T12:00");
      return '<div class="st-col"><span class="st-v">' + (h ? (h < 10 ? h.toFixed(1) : Math.round(h)) : "") + '</span><span class="st-bar"><i style="height:' + Math.max(h ? 4 : 0, Math.round(h / max * 100)) + '%"></i></span><span class="st-d">' + d.getDate() + "/" + (d.getMonth() + 1) + "</span></div>"; }).join("") + "</div>";
  }
  $("adminOpen").onclick = async () => {
    $("stBody").innerHTML = '<p class="status-line">Loading…</p>'; $("statsSheet").showModal();
    const { data, error } = await F.sb.rpc("funi_admin_stats");
    if (error) { $("stBody").innerHTML = '<p class="status-line">' + esc(/funi_admin_stats|schema cache/i.test(error.message) ? "Run funi-v18-setup.sql in Supabase first." : error.message) + "</p>"; return; }
    last = data;
    $("stWhen").textContent = "Live from Funi's database, " + new Date().toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    $("stBody").innerHTML = '<div class="st-grid">' +
      tile(n(data.users), "people signed up") + tile(n(data.active_7d), "studied or chatted this week") +
      tile(n(data.study_hours) + " h", "studied with Funi") + tile(n(data.sessions), "study rounds") +
      tile(n(data.tests), "tests & exams tracked") + tile(n(data.messages), "messages sent") +
      tile(n(data.houses), "houses") + tile(n(data.decks), "flashcard decks") + "</div>" +
      '<span class="label">Study hours per week</span>' + chart(data.weeks || []) +
      '<p class="hint">' + n(data.new_7d) + " new this week · " + n(data.active_30d) + " active in the last 30 days · " + n(data.files) + " files saved · " + n(data.rooms) + " study rooms opened</p>";
  };
  $("stCopy").onclick = async () => {
    if (!last) return;
    const line = "Funi (study-with-funi.vercel.app): " + n(last.users) + " students signed up, " + n(last.study_hours) + " hours of study tracked, " + n(last.sessions) + " study sessions, " + n(last.tests) + " tests and exams tracked.";
    try { await navigator.clipboard.writeText(line); F.toast("Copied: " + line, { long: true }); } catch (e) { F.toast(line, { long: true }); }
  };
})();
