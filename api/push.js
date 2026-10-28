// Called every minute by Supabase (pg_cron). Sends phone notifications that are due:
//  - reminders whose "notify me" time has come (repeating ones roll on to their next day)
//  - new notifications (messages, invites, help requests, partners studying)
//  - study sessions whose time ran out while Funi was closed (with a cheer)
//  - once an hour, voice notes older than 7 days are deleted
// Each one is marked as sent first, so nothing is sent twice.
const { webpush, db, vapidKeys, SERVICE_KEY, SUPABASE_URL } = require("./_shared");

// first date on or after fromIso that falls on one of the repeat weekdays (0 = Sunday)
function nextRepeat(fromIso, days) {
  const d = new Date(fromIso + "T12:00:00Z");
  for (let i = 0; i < 8; i++) { if (days.includes(d.getUTCDay())) return d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() + 1); }
  return fromIso;
}

// Deletes voice notes older than 7 days through the Storage API (so the space really frees up),
// then marks the messages as expired. Returns how many were removed.
async function cleanVoiceNotes(now) {
  const before = new Date(now - 7 * 864e5).toISOString();
  const old = await db("study_messages?select=id,file_path&file_type=like.audio%2F*&file_path=not.is.null&created_at=lt." + before + "&limit=200");
  if (!old.length) return 0;
  const r = await fetch(SUPABASE_URL + "/storage/v1/object/chat-files", {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: old.map((m) => m.file_path) })
  });
  if (!r.ok) throw new Error("storage " + r.status + " " + (await r.text()).slice(0, 200));
  await db("study_messages?id=in.(" + old.map((m) => m.id).join(",") + ")", { method: "PATCH", body: { file_path: null, file_size: null, body: "Voice note (deleted after 7 days)" }, prefer: "return=minimal" });
  return old.length;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!SERVICE_KEY) return res.status(200).json({ ok: false, reason: "Add SUPABASE_SERVICE_ROLE_KEY in Vercel to turn on phone notifications." });
  try {
    const keys = await vapidKeys();
    webpush.setVapidDetails("https://study-with-funi.vercel.app", keys.publicKey, keys.privateKey);
    const now = new Date(), nowIso = now.toISOString();
    const twoHoursAgo = new Date(now - 2 * 3600e3).toISOString(), tenMinAgo = new Date(now - 10 * 60e3).toISOString();

    // 0. repeating reminders whose day has passed move on to their next day (South Africa time)
    const todaySA = new Date(now.getTime() + 2 * 3600e3).toISOString().slice(0, 10);
    let reps = [];
    try { reps = await db("tasks?select=id,due_date,due_time,remind_offset,repeat_days&repeat_days=not.is.null&due_date=lt." + todaySA + "&limit=500"); } catch (e) { reps = []; } // funi-v9-setup.sql not run yet
    for (const t of reps) {
      const next = nextRepeat(todaySA, t.repeat_days || []);
      const remind = t.due_time && t.remind_offset != null ? new Date(new Date(next + "T" + String(t.due_time).slice(0, 5) + ":00+02:00").getTime() - t.remind_offset * 60000).toISOString() : null;
      await db("tasks?id=eq." + t.id, { method: "PATCH", body: { due_date: next, done: false, reminded_at: null, remind_at: remind }, prefer: "return=minimal" });
    }

    // 1. due reminders (mark first so a slow run can't send them twice)
    const dueTasks = await db("tasks?select=id,user_id,title,module,due_time,remind_offset&done=eq.false&reminded_at=is.null&and=(remind_at.lte." + nowIso + ",remind_at.gte." + twoHoursAgo + ")&limit=200");
    if (dueTasks.length) await db("tasks?id=in.(" + dueTasks.map((t) => t.id).join(",") + ")", { method: "PATCH", body: { reminded_at: nowIso }, prefer: "return=minimal" });

    // 2. new notifications
    const notes = await db("notifications?select=id,user_id,kind,title,body,actor_id,ref_id&pushed_at=is.null&created_at=gte." + tenMinAgo + "&limit=300");
    if (notes.length) await db("notifications?id=in.(" + notes.map((n) => n.id).join(",") + ")", { method: "PATCH", body: { pushed_at: nowIso }, prefer: "return=minimal" });

    // 3. study timers whose focus or break ended (Funi may be closed)
    let timers = [];
    try {
      timers = await db("study_sessions?select=id,user_id,module_code,phase,phase_ends_at,planned_minutes,break_minutes&is_active=eq.true&and=(phase_ends_at.lte." + nowIso + ",phase_ends_at.gte." + twoHoursAgo + ")&limit=200");
    } catch (e) { timers = []; } // funi-v4-setup.sql not run yet
    for (const s of timers) {
      // the round is over: end it first, so the phone is only buzzed once
      const body = s.phase === "focus"
        ? { phase: "done", phase_ends_at: null, is_active: false, ended_at: s.phase_ends_at }
        : { phase_ends_at: null };
      await db("study_sessions?id=eq." + s.id + "&phase_ends_at=eq." + encodeURIComponent(s.phase_ends_at), { method: "PATCH", body, prefer: "return=minimal" });
    }
    timers = timers.filter((s) => s.phase === "focus");

    const messages = [];
    const CHEERS = [
      "Proud of you! That's {m} focused minutes closer to acing {mod}.",
      "That's how it's done. Small steps add up to big marks.",
      "You showed up and did the work. Take a second to feel good about that.",
      "Brain: trained. Future you says thank you!",
      "Look at you go! Drink some water, you earned it."
    ];
    const TITLES = ["Session complete! 🎉", "You did it! 🎉", "Round finished! 🎉"];
    timers.forEach((s) => {
      const body = CHEERS[Math.floor(Math.random() * CHEERS.length)].replace("{m}", s.planned_minutes || "").replace("{mod}", s.module_code);
      messages.push({ user: s.user_id, payload: { title: TITLES[Math.floor(Math.random() * TITLES.length)], body, url: "/#study", tag: "session" } });
    });
    dueTasks.forEach((t) => {
      const when = t.remind_offset ? (t.remind_offset >= 1440 ? "Tomorrow" : "In " + (t.remind_offset >= 60 ? t.remind_offset / 60 + " hour" + (t.remind_offset >= 120 ? "s" : "") : t.remind_offset + " min")) : "Now";
      messages.push({ user: t.user_id, payload: { title: "Reminder: " + t.title, body: when + (t.due_time ? " · " + String(t.due_time).slice(0, 5) : "") + (t.module ? " · " + t.module : ""), url: "/#reminders", tag: "task-" + t.id } });
    });
    notes.forEach((n) => {
      const url = n.kind === "message" || n.kind === "help" ? "/#chat-" + n.actor_id : n.kind === "invite" ? "/#invites"
        : n.kind === "room" && n.ref_id ? "/#room-" + n.ref_id : n.kind === "battle" && n.ref_id ? "/#battle-" + n.ref_id
        : n.kind === "deck" && n.ref_id ? "/#deck-" + n.ref_id : n.kind === "share" && n.ref_id ? "/#share-" + n.ref_id : n.kind === "house" && n.ref_id ? "/#house-" + n.ref_id : "/#partners";
      messages.push({ user: n.user_id, payload: { title: n.title, body: n.body || "", url, tag: n.kind + "-" + (n.actor_id || n.id) } });
    });

    // 4. once an hour: voice notes older than 7 days are deleted to free up space
    let cleaned = 0;
    if (now.getUTCMinutes() === 7) { try { cleaned = await cleanVoiceNotes(now); } catch (e) { console.error("voice cleanup", e.message); } }

    if (!messages.length) return res.status(200).json({ ok: true, sent: 0, cleaned });

    const users = [...new Set(messages.map((m) => m.user))];
    const subs = await db("push_subscriptions?select=id,user_id,endpoint,p256dh,auth&user_id=in.(" + users.join(",") + ")");
    let sent = 0; const dead = [];
    await Promise.all(messages.flatMap((m) => subs.filter((s) => s.user_id === m.user).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(m.payload), { TTL: 3600, urgency: "high" });
        sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) dead.push(s.id); else console.error("push failed", e.statusCode, e.body);
      }
    })));
    if (dead.length) await db("push_subscriptions?id=in.(" + [...new Set(dead)].join(",") + ")", { method: "DELETE", prefer: "return=minimal" });
    res.status(200).json({ ok: true, sent, removed: dead.length, cleaned });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
