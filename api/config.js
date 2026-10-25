// Gives the browser the public settings: Supabase URL + public key, and the public push key.
// None of these are secret. Data is protected by row level security in Supabase.
const { vapidKeys, SUPABASE_URL, ANON_KEY, SERVICE_KEY } = require("./_shared");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  let vapidPublic = "", pushReady = false;
  if (SERVICE_KEY) {
    try { const k = await vapidKeys(); if (k) { vapidPublic = k.publicKey; pushReady = true; } } catch (e) { console.error("vapid", e.message); }
  }
  res.status(200).json({ url: SUPABASE_URL, anonKey: ANON_KEY, vapidPublic, pushReady });
};
