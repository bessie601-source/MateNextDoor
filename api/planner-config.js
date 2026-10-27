// Vercel serverless function: hands the appointment planner (/appointmentplanner/) its Supabase settings.
// Both values are safe to expose; row-level security in supabase/planner.sql is what protects the data.
// Required environment variables (set in Vercel → Project → Settings → Environment Variables):
//   SUPABASE_URL       project URL, e.g. https://abcdefgh.supabase.co
//   SUPABASE_ANON_KEY  Supabase → Project Settings → API keys → anon / publishable key (never the service_role key)

module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(501).json({ error: "Planner storage not configured" });
  }
  return res.status(200).json({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
};
