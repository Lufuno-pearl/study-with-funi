// Hands the browser the public Supabase settings stored in Vercel's Environment Variables.
// Both values are safe to expose: data is protected by row level security in Supabase.

// Accepts a messy SUPABASE_URL (with /rest/v1/, a trailing slash, or even a dashboard link)
// and returns just https://<project>.supabase.co
function cleanUrl(raw) {
  const value = String(raw || "").trim().replace(/^["']|["']$/g, "");
  if (!value) return "";
  const dash = value.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dash) return "https://" + dash[1] + ".supabase.co";
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : "https://" + value).origin;
  } catch (e) {
    return "";
  }
}

module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    url: cleanUrl(process.env.SUPABASE_URL),
    anonKey: String(process.env.SUPABASE_ANON_KEY || "").trim().replace(/^["']|["']$/g, "")
  });
};
