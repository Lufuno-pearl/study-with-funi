// Helpers shared by the server functions. Files starting with "_" are not public routes on Vercel.
const webpush = require("web-push");

function cleanUrl(raw) {
  const value = String(raw || "").trim().replace(/^["']|["']$/g, "");
  if (!value) return "";
  const dash = value.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dash) return "https://" + dash[1] + ".supabase.co";
  try { return new URL(/^https?:\/\//i.test(value) ? value : "https://" + value).origin; } catch (e) { return ""; }
}
const clean = (v) => String(v || "").trim().replace(/^["']|["']$/g, "");

const SUPABASE_URL = cleanUrl(process.env.SUPABASE_URL);
const ANON_KEY = clean(process.env.SUPABASE_ANON_KEY);
const SERVICE_KEY = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

// Talk to Supabase's REST API with the server key (bypasses row level security; never sent to browsers).
async function db(path, opts) {
  const o = opts || {};
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: o.method || "GET",
    headers: Object.assign({
      apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY, "Content-Type": "application/json",
      Prefer: o.prefer || "return=representation"
    }, o.headers || {}),
    body: o.body ? JSON.stringify(o.body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error("Supabase " + res.status + ": " + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}

// VAPID keys identify Funi to Apple/Google push services. Made once, kept in funi_settings.
let cachedKeys = null;
async function vapidKeys() {
  if (cachedKeys) return cachedKeys;
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const rows = await db("funi_settings?name=in.(vapid_public,vapid_private)&select=name,value");
  const got = {};
  (rows || []).forEach((r) => { got[r.name] = r.value; });
  if (!got.vapid_public || !got.vapid_private) {
    const k = webpush.generateVAPIDKeys();
    await db("funi_settings?on_conflict=name", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal",
      body: [{ name: "vapid_public", value: k.publicKey }, { name: "vapid_private", value: k.privateKey }] });
    // read back, in case another request saved keys at the same moment
    const again = await db("funi_settings?name=in.(vapid_public,vapid_private)&select=name,value");
    (again || []).forEach((r) => { got[r.name] = r.value; });
  }
  cachedKeys = { publicKey: got.vapid_public, privateKey: got.vapid_private };
  return cachedKeys;
}

module.exports = { webpush, db, vapidKeys, SUPABASE_URL, ANON_KEY, SERVICE_KEY };
