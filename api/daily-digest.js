// Vercel cron (schedule in vercel.json): emails Will a morning list of what the appointment planner
// says needs doing today: reminders due, quotes to follow up, invoices to send, and jobs that don't add up.
// It only reads the planner and emails Will; nothing goes to clients. No email on days with nothing to do.
// Uses the quote form's RESEND_API_KEY and QUOTE_FROM_EMAIL, plus (Vercel → Settings → Environment Variables):
//   SUPABASE_URL               same as for /api/planner-config
//   SUPABASE_SERVICE_ROLE_KEY  Supabase → Project Settings → API keys → service_role (secret, server only)
//   CRON_SECRET                any long random string; Vercel sends it with each cron call
// Optional:
//   DIGEST_TO_EMAIL            who gets it (default: QUOTE_TO_EMAIL)
//   PLANNER_TIMEZONE           decides what "today" is (default: Australia/Sydney)

const JobRules = require("../appointmentplanner/jobrules.js");
const env = require("../lib/supabase-env.js");

const PLANNER_URL = "https://matenextdoor.com/appointmentplanner/";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// "YYYY-MM-DD" in the given time zone (en-CA formats dates that way).
const todayIn = (tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function loadDocs(url, key) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/planner_docs?select=collection,id,data&collection=in.(jobs,clients,config)&order=collection,id`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}`, "Range-Unit": "items" },
    });
    if (!r.ok) throw new Error(`Supabase responded ${r.status}`);
    const page = await r.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

// Same rules as the planner's "Needs action" list.
function buildDigest(rows, today) {
  const clients = {}, jobs = [];
  let cfgRaw = null;
  for (const r of rows) {
    if (r.collection === "clients") clients[r.id] = r.data || {};
    else if (r.collection === "jobs") jobs.push(JobRules.normJob(r.id, r.data || {}));
    else if (r.collection === "config" && r.id === "jobs") cfgRaw = r.data;
  }
  const cfg = JobRules.normCfg(cfgRaw);
  const R = JobRules.create({ cfg: () => cfg, today: () => today });
  const name = (j) => (clients[j.clientId] && clients[j.clientId].name) || j.client || "No client";
  const reminders = [], todo = [], checks = [];
  let owed = 0, overdue = 0;
  for (const j of jobs.sort((x, y) => x.id.localeCompare(y.id))) {
    for (const i of R.invoices(j)) {
      if (i.paid) continue;
      owed += i.amount;
      if (JobRules.daysBetween(i.due, today) > 0) overdue += i.amount;
    }
    const a = R.nextAction(j), head = `${j.id} · ${name(j)} · ${j.title}`;
    if (a.reminder) reminders.push({ head, text: a.text });
    else if (a.urgent) todo.push({ head, text: a.text });
    for (const x of R.issues(j)) checks.push({ head, text: x });
  }
  return { reminders, todo, checks, owed, overdue, count: reminders.length + todo.length + checks.length };
}

function renderEmail(d, today) {
  const { plural, money, fmtDay } = JobRules;
  const sections = [
    ["Reminders to send", d.reminders, "Open the job in the planner and tap Send. The email is written for you."],
    ["Other things to do", d.todo, ""],
    ["Jobs that don't add up", d.checks, "Open the job and correct it."],
  ].filter(([, items]) => items.length);
  const subject = `Planner: ${plural(d.count, "thing")} to do today` + (d.reminders.length ? ` (${plural(d.reminders.length, "reminder")} due)` : "");
  const money_line = `Owed to you: ${money(d.owed)}${d.overdue ? ` (${money(d.overdue)} overdue)` : ""}`;
  const text = [`Morning Will, here's what the planner says needs doing on ${fmtDay(today)}.`, "",
    ...sections.flatMap(([title, items, hint]) => [title.toUpperCase(), ...(hint ? [hint] : []), ...items.map((x) => `- ${x.head}\n  ${x.text}`), ""]),
    money_line, "", `Open the planner: ${PLANNER_URL}`].join("\n");
  const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,sans-serif;color:#111;max-width:640px">
<p>Morning Will, here's what the planner says needs doing on <strong>${esc(fmtDay(today))}</strong>.</p>
${sections.map(([title, items, hint]) => `<h3 style="margin:20px 0 4px;font-size:16px">${esc(title)}</h3>${hint ? `<p style="margin:0 0 6px;color:#5f5f5f">${esc(hint)}</p>` : ""}
<ul style="margin:0;padding-left:18px">${items.map((x) => `<li style="margin:0 0 8px"><strong>${esc(x.head)}</strong><br>${esc(x.text)}</li>`).join("")}</ul>`).join("\n")}
<p style="margin-top:20px">${esc(money_line)}</p>
<p><a href="${PLANNER_URL}" style="display:inline-block;background:#b00020;color:#fff;padding:12px 18px;border-radius:2px;letter-spacing:.12em;text-transform:uppercase;font-size:12px;text-decoration:none;font-weight:600">Open the planner</a></p>
</div>`;
  return { subject, text, html };
}

async function handler(req, res) {
  const { CRON_SECRET, RESEND_API_KEY, QUOTE_FROM_EMAIL } = process.env;
  const supabaseUrl = env.url(), serviceKey = env.serviceKey();
  const to = process.env.DIGEST_TO_EMAIL || process.env.QUOTE_TO_EMAIL;
  if (!CRON_SECRET || req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!supabaseUrl || !serviceKey || !RESEND_API_KEY || !QUOTE_FROM_EMAIL || !to) {
    return res.status(501).json({ error: "Daily email not configured" });
  }

  const today = todayIn(process.env.PLANNER_TIMEZONE || "Australia/Sydney");
  let rows;
  try {
    rows = await loadDocs(supabaseUrl, serviceKey);
  } catch (e) {
    console.error("daily-digest: planner read failed", e);
    return res.status(502).json({ error: "Couldn't read the planner" });
  }
  const d = buildDigest(rows, today);
  if (!d.count) return res.status(200).json({ ok: true, sent: false, today });

  const mail = renderEmail(d, today);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `Mate Next Door Planner <${QUOTE_FROM_EMAIL}>`, to: [to], ...mail }),
  });
  if (!r.ok) return res.status(502).json({ error: "Email send failed" });
  return res.status(200).json({ ok: true, sent: true, today, items: d.count });
}

module.exports = handler;
module.exports.buildDigest = buildDigest;
module.exports.renderEmail = renderEmail;
