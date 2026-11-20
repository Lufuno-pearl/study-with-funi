/* Privacy: how Funi uses your data, download my data, delete my account (funi-v19-setup.sql) */
(() => {
  const F = window.Funi, $ = F.$;
  document.addEventListener("click", (e) => { if (e.target.closest("[data-open-privacy]")) $("privacySheet").showModal(); });

  // everything Funi keeps about you, as one file
  $("exportBtn").onclick = async () => {
    if (!F.sb || !F.me) return;
    $("exportBtn").disabled = true; F.toast("Collecting your data…");
    const me = F.me.id, out = { exported_at: new Date().toISOString(), app: "Study with Funi", account: { id: me, email: F.me.email || null, username: (F.me.user_metadata || {}).username || null }, data: {} };
    const grab = async (name, q) => { try { const { data, error } = await q; out.data[name] = error ? { not_available: error.message } : data || []; } catch (err) { out.data[name] = { not_available: String(err.message || err) }; } };
    const sb = F.sb;
    await Promise.all([
      grab("profile", sb.from("study_profiles").select("*").eq("id", me)),
      grab("modules", sb.from("modules").select("*")),
      grab("tests_and_exams", sb.from("assessments").select("*")),
      grab("marks_book", sb.from("grade_items").select("*").eq("user_id", me)),
      grab("tasks_and_reminders", sb.from("tasks").select("*").eq("user_id", me)),
      grab("study_sessions", sb.from("study_sessions").select("*").eq("user_id", me)),
      grab("files", sb.from("module_files").select("*").eq("user_id", me)),
      grab("messages", sb.from("study_messages").select("*").or("sender_id.eq." + me + ",recipient_id.eq." + me)),
      grab("study_partners", sb.from("study_partners").select("*").or("requester_id.eq." + me + ",addressee_id.eq." + me)),
      grab("notifications", sb.from("notifications").select("*").eq("user_id", me)),
      grab("flashcard_decks", sb.from("flash_decks").select("*").eq("owner_id", me)),
      grab("houses", sb.from("house_members").select("*").eq("user_id", me)),
      grab("stickers", sb.from("stickers").select("*").eq("user_id", me))
    ]);
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    $("exportBtn").disabled = false;
    if (F.saveBlob) F.saveBlob(blob, "funi-my-data-" + new Date().toISOString().slice(0, 10) + ".json", "application/json");
    F.toast("Your data is downloaded as a file.");
  };

  // delete my account: files first (storage), then everything else in one go
  $("deleteMeBtn").onclick = async () => {
    if (!F.sb || !F.me) return;
    if (!(await F.confirm("Delete your account?", "Your account, marks, tests, notes, files, messages you sent and study history are deleted for good. Houses you own pass to another member. This can't be undone. Download your data first if you want a copy.", "Continue"))) return;
    if (!(await F.confirm("Are you completely sure?", "Last check. Tapping Delete removes everything right now.", "Delete my account"))) return;
    F.toast("Deleting your account…", { long: true });
    const me = F.me.id, sb = F.sb;
    const remove = async (bucket, paths) => { const list = paths.filter(Boolean); for (let i = 0; i < list.length; i += 100) { try { await sb.storage.from(bucket).remove(list.slice(i, i + 100)); } catch (e) {} } };
    try {
      const [mf, st, cm] = await Promise.all([
        sb.from("module_files").select("path").eq("user_id", me),
        sb.from("stickers").select("path").eq("user_id", me),
        sb.from("study_messages").select("file_path,file_type").eq("sender_id", me).not("file_path", "is", null)
      ]);
      await remove("module-files", (mf.data || []).map((x) => x.path));
      await remove("stickers", (st.data || []).map((x) => x.path));
      await remove("chat-files", (cm.data || []).filter((x) => x.file_type !== "funi/sticker").map((x) => x.file_path));
    } catch (e) {}
    const { error } = await sb.rpc("funi_delete_me");
    if (error) return F.toast(/funi_delete_me|schema cache/i.test(error.message) ? "Deleting accounts needs one setup step: run funi-v19-setup.sql in Supabase." : "Couldn't delete your account: " + error.message, { long: true });
    try { await Promise.race([F.unsubscribePush(), new Promise((r) => setTimeout(r, 3000))]); } catch (e) {}
    try { await sb.auth.signOut({ scope: "local" }); } catch (e) {}
    try { Object.keys(localStorage).filter((k) => k.indexOf(me) >= 0).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
    F.me = null; F.showAuth(); F.toast("Your account is deleted. Thank you for using Funi. 💜", { long: true });
  };
})();
