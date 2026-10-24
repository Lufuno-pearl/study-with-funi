// Hands the browser the public Supabase settings stored in Vercel's Environment Variables.
// Both values are safe to expose: data is protected by row level security in Supabase.
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    url: process.env.SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || ""
  });
};
