// Called every minute by Supabase (pg_cron). Sends phone notifications that are due:
//  - reminders whose "notify me" time has come
//  - new notifications (messages, invites, help requests, partners studying)
//  - study sessions whose time ran out while Funi was closed (with a cheer)
// Each one is marked as sent first, so nothing is sent twice.
const { webpush, db, vapidKeys, SERVICE_KEY } = require("./_shared");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!SERVICE_KEY) return res.status(200).json({ ok: false, reason: "Add SUPABASE_SERVICE_ROLE_KEY in Vercel to turn on phone notifications." });
  try {
    const keys = await vapidKeys();
    webpush.setVapidDetails("https://study-with-funi.vercel.app", keys.publicKey, keys.privateKey);
    const now = new Date(), nowIso = now.toISOString();
    const twoHoursAgo = new Date(now - 2 * 3600e3).toISOString(), tenMinAgo = new Date(now - 10 * 60e3).toISOString();

    // 1. due reminders (mark first so a slow run can't send them twice)
    const dueTasks = await db("tasks?select=id,user_id,title,module,due_time,remind_offset&done=eq.false&reminded_at=is.null&and=(remind_at.lte." + nowIso + ",remind_at.gte." + twoHoursAgo + ")&limit=200");
    if (dueTasks.length) await db("tasks?id=in.(" + dueTasks.map((t) => t.id).join(",") + ")", { method: "PATCH", body: { reminded_at: nowIso }, prefer: "return=minimal" });

    // 2. new notifications
    const notes = await db("notifications?select=id,user_id,kind,title,body,actor_id&pushed_at=is.null&created_at=gte." + tenMinAgo + "&limit=300");
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
    if (!messages.length) return res.status(200).json({ ok: true, sent: 0 });

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
    res.status(200).json({ ok: true, sent, removed: dead.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
};
