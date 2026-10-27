// Vercel cron (schedule in vercel.json): emails Will a morning rundown from the appointment planner:
// today's run, jobs from earlier days still open, and finished jobs waiting on payment.
// It only reads the planner and emails Will; nothing goes to customers. No email on days with nothing to report.
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

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const fmtDay = (d) => { const [y, m, day] = d.split("-").map(Number); return new Date(y, m - 1, day).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }); };

async function loadDocs(url, key) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/planner_docs?select=collection,id,data&collection=in.(bookings,config)&order=collection,id`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}`, "Range-Unit": "items" },
    });
    if (!r.ok) throw new Error(`Supabase responded ${r.status}`);
    const page = await r.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

// Same groups the planner shows: Today's run, and the Unpaid list.
function buildDigest(rows, today) {
  const { normBooking, owes, LABEL, money, hourLabel } = JobRules;
  const all = rows.filter((r) => r.collection === "bookings").map((r) => normBooking(r.id, r.data, today))
    .sort((a, b) => (a.date + String(a.hour).padStart(2, "0")).localeCompare(b.date + String(b.hour).padStart(2, "0")));
  const line = (b) => ({ head: `${hourLabel(b.hour)} · ${b.svc} · ${money(b.price)}`, text: `${b.customer || "No name"}${b.address ? ", " + b.address : ""}` });
  const todays = all.filter((b) => b.date === today && b.status !== "paid").map(line);
  const open = all.filter((b) => b.date < today && ["booked", "enroute", "onsite"].includes(b.status))
    .map((b) => ({ head: `${fmtDay(b.date)} · ${b.svc}`, text: `${b.customer || "No name"} · still marked ${LABEL[b.status]}. Mark it done, or move it.` }));
  const unpaid = all.filter(owes);
  const owing = unpaid.map((b) => ({ head: `${b.customer || "No name"} · ${money(b.price)}`, text: `${b.svc}, ${fmtDay(b.date)} · ${b.invoicedAt ? "invoice sent " + fmtDay(b.invoicedAt) : "no invoice sent yet"}` }));
  const owed = unpaid.reduce((t, b) => t + b.price, 0);
  return { todays, open, owing, owed, count: todays.length + open.length + owing.length };
}

function renderEmail(d, today) {
  const { money } = JobRules;
  const sections = [
    ["Today's run", d.todays, ""],
    ["Not finished from earlier days", d.open, ""],
    ["Waiting on payment", d.owing, "Open the job and tap Send invoice, or Mark as paid once the money's in."],
  ].filter(([, items]) => items.length);
  const subject = `Planner: ${d.todays.length ? plural(d.todays.length, "job") + " today" : "nothing booked today"}` + (d.owing.length ? ` · ${money(d.owed)} owed` : "");
  const text = [`Morning Will, here's the planner for ${fmtDay(today)}.`, "",
    ...sections.flatMap(([title, items, hint]) => [title.toUpperCase(), ...(hint ? [hint] : []), ...items.map((x) => `- ${x.head}\n  ${x.text}`), ""]),
    `Open the planner: ${PLANNER_URL}`].join("\n");
  const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,sans-serif;color:#111;max-width:640px">
<p>Morning Will, here's the planner for <strong>${esc(fmtDay(today))}</strong>.</p>
${sections.map(([title, items, hint]) => `<h3 style="margin:20px 0 4px;font-size:16px;text-transform:uppercase;letter-spacing:.06em">${esc(title)}</h3>${hint ? `<p style="margin:0 0 6px;color:#5f5f5f">${esc(hint)}</p>` : ""}
<ul style="margin:0;padding-left:18px">${items.map((x) => `<li style="margin:0 0 8px"><strong>${esc(x.head)}</strong><br>${esc(x.text)}</li>`).join("")}</ul>`).join("\n")}
<p><a href="${PLANNER_URL}" style="display:inline-block;background:#E3161B;color:#fff;padding:12px 18px;border-radius:12px;letter-spacing:.1em;text-transform:uppercase;font-size:13px;text-decoration:none;font-weight:700">Open the planner</a></p>
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
