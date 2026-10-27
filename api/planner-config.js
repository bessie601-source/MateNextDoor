// Vercel serverless function: hands the appointment planner (/appointmentplanner/) its Supabase settings.
// Both values are safe to expose; row-level security in supabase/planner.sql is what protects the data.
// Required environment variables (set in Vercel → Project → Settings → Environment Variables):
//   SUPABASE_URL       project URL, e.g. https://abcdefgh.supabase.co
//   SUPABASE_ANON_KEY  Supabase → Project Settings → API Keys → Legacy API Keys → anon (never the service_role key)

const env = require("../lib/supabase-env.js");

module.exports = function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const url = env.url(), anonKey = env.anonKey();
  const missing = [!url && "SUPABASE_URL", !anonKey && "SUPABASE_ANON_KEY"].filter(Boolean);
  if (missing.length) {
    return res.status(501).json({ error: `Storage isn't set up yet: ${missing.join(" and ")} ${missing.length > 1 ? "aren't" : "isn't"} set in Vercel (see the README).` });
  }
  return res.status(200).json({ url, anonKey });
};
