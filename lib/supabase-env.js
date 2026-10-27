// Reads the Supabase settings from Vercel's environment variables, forgiving common paste mistakes:
// surrounding quotes or spaces, a trailing slash or /rest/v1, or the dashboard link instead of the Project URL.

const clean = (v) => String(v || "").trim().replace(/^["']+|["']+$/g, "").trim();

function supabaseUrl(raw) {
  let u = clean(raw);
  if (!u) return "";
  const dash = u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dash) return `https://${dash[1].toLowerCase()}.supabase.co`;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u.replace(/\/(rest|auth)\/v1\b.*$/i, "").replace(/\/+$/, "");
}

module.exports = {
  url: () => supabaseUrl(process.env.SUPABASE_URL),
  anonKey: () => clean(process.env.SUPABASE_ANON_KEY),
  serviceKey: () => clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  supabaseUrl,
};
