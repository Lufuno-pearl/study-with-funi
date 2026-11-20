/* Report a problem: anyone can send one (with a screenshot); the owner sees them all (funi-v19-setup.sql) */
(() => {
  const F = window.Funi, $ = F.$, esc = F.esc;
  const device = () => { const ua = navigator.userAgent; return (/iphone|ipad/i.test(ua) ? "iPhone/iPad" : /android/i.test(ua) ? "Android" : /windows/i.test(ua) ? "Windows" : /mac/i.test(ua) ? "Mac" : "Other") +
    " · " + (/edg\//i.test(ua) ? "Edge" : /chrome|crios/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : /firefox/i.test(ua) ? "Firefox" : "browser") +
    " · " + innerWidth + "×" + innerHeight + (window.matchMedia("(display-mode: standalone)").matches ? " · installed app" : ""); };
  let fromView = "";
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-report]")) return;
    fromView = (F.s && F.s.view) || ""; $("reportForm").reset(); F.showError("rpError", "");
    $("rpInfo").textContent = "Funi adds: the page you were on and your device (" + device() + ").";
    $("reportSheet").showModal(); setTimeout(() => $("rpBody").focus(), 50);
  });
  $("reportForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = $("rpBody").value.trim(); if (!body) return F.showError("rpError", "Write a few words about what went wrong.");
    $("rpSend").disabled = true; F.showError("rpError", "");
    let shot = null; const f = $("rpShot").files[0];
    if (f) {
      try {
        const small = F.shrinkImage ? await F.shrinkImage(f) : { blob: f, type: f.type, ext: null };
        const path = F.me.id + "/" + Date.now() + "." + (small.ext || (f.name.split(".").pop() || "png").toLowerCase());
        const up = await F.sb.storage.from("reports").upload(path, small.blob, { contentType: small.type || f.type || "image/png" });
        if (!up.error) shot = path;
      } catch (err) {}
    }
    const { error } = await F.sb.from("funi_reports").insert({ user_id: F.me.id, body, page: fromView, device: device(), shot_path: shot });
    $("rpSend").disabled = false;
    if (error) return F.showError("rpError", /funi_reports|schema cache/i.test(error.message) ? "Reports need one setup step: run funi-v19-setup.sql in Supabase." : "Couldn't send: " + error.message);
    $("reportSheet").close(); F.toast("Sent. Thank you, this helps make Funi better! 💜", { long: true });
  });

  // the owner's list of reports
  F.openReports = async () => {
    $("rlBody").innerHTML = '<p class="status-line">Loading…</p>'; $("reportsSheet").showModal();
    const { data, error } = await F.sb.from("funi_reports").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) { $("rlBody").innerHTML = '<p class="status-line">' + esc(error.message) + "</p>"; return; }
    if (!data.length) { $("rlBody").innerHTML = '<div class="empty"><b>No reports yet</b><span>When someone taps Report a problem, it shows up here and you get a notification.</span></div>'; return; }
    const ids = [...new Set(data.map((r) => r.user_id).filter(Boolean))]; let names = {};
    if (ids.length) { const pr = await F.sb.from("study_profiles").select("id,username,display_name").in("id", ids); (pr.data || []).forEach((p) => { names[p.id] = p.display_name || p.username || "Someone"; }); }
    const shots = {};
    await Promise.all(data.filter((r) => r.shot_path).map(async (r) => { const s = await F.sb.storage.from("reports").createSignedUrl(r.shot_path, 3600); if (s.data) shots[r.id] = s.data.signedUrl; }));
    $("rlBody").innerHTML = '<div class="rl-list">' + data.map((r) => '<div class="rl-item' + (r.status === "fixed" ? " fixed" : "") + '"><div class="rl-top"><b>' + esc(names[r.user_id] || "Someone") + "</b><span>" + esc(new Date(r.created_at).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) + "</span></div>" +
      "<p>" + esc(r.body) + '</p><span class="hint">' + esc([r.page && "Page: " + r.page, r.device].filter(Boolean).join(" · ")) + "</span>" +
      (shots[r.id] ? '<img src="' + esc(shots[r.id]) + '" alt="Screenshot from the report" data-full="' + esc(shots[r.id]) + '">' : "") +
      '<div class="chips">' + ["new", "seen", "fixed"].map((s) => '<button type="button" class="chip' + (r.status === s ? " on" : "") + '" data-rs="' + esc(r.id) + '" data-st="' + s + '" aria-pressed="' + (r.status === s) + '">' + { new: "New", seen: "Seen", fixed: "Fixed ✓" }[s] + "</button>").join("") + "</div></div>").join("") + "</div>";
  };
  $("rlBody").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-rs]");
    if (b) { const { error } = await F.sb.from("funi_reports").update({ status: b.dataset.st }).eq("id", b.dataset.rs); if (error) return F.toast(error.message); b.parentElement.querySelectorAll(".chip").forEach((c) => { c.classList.toggle("on", c === b); c.setAttribute("aria-pressed", String(c === b)); }); b.closest(".rl-item").classList.toggle("fixed", b.dataset.st === "fixed"); return; }
    const img = e.target.closest("img[data-full]"); if (img) { $("imgFull").src = img.dataset.full; $("imgSheet").showModal(); }
  });
  $("reportsOpen").onclick = () => F.openReports();
})();
