// Vercel serverless function: emails quote requests to Will via Resend.
// Required environment variables (set in Vercel → Project → Settings → Environment Variables):
//   RESEND_API_KEY   API key from resend.com (free tier is plenty)
//   QUOTE_TO_EMAIL   where requests go, e.g. will@matenextdoor.com.au
//   QUOTE_FROM_EMAIL sender on a domain verified in Resend, e.g. website@matenextdoor.com.au

const clean = (v, max) => String(v || "").replace(/[<>]/g, "").trim().slice(0, max);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

  // Honeypot: bots fill the hidden "company" field; pretend success.
  if (body.company) return res.status(200).json({ ok: true });

  const q = {
    name: clean(body.name, 100),
    phone: clean(body.phone, 40),
    email: clean(body.email, 120),
    suburb: clean(body.suburb, 100),
    service: clean(body.service, 80),
    details: clean(body.details, 3000)
  };
  if (!q.name || !q.phone || !q.suburb || !q.details) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const { RESEND_API_KEY, QUOTE_TO_EMAIL, QUOTE_FROM_EMAIL } = process.env;
  if (!RESEND_API_KEY || !QUOTE_TO_EMAIL || !QUOTE_FROM_EMAIL) {
    return res.status(501).json({ error: "Email not configured" });
  }

  const text = [
    `New quote request from the website`,
    ``,
    `Name:    ${q.name}`,
    `Phone:   ${q.phone}`,
    `Email:   ${q.email || "-"}`,
    `Suburb:  ${q.suburb}`,
    `Job:     ${q.service}`,
    ``,
    q.details
  ].join("\n");

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `Mate Next Door Website <${QUOTE_FROM_EMAIL}>`,
      to: [QUOTE_TO_EMAIL],
      reply_to: q.email || undefined,
      subject: `Quote request: ${q.service} in ${q.suburb} (${q.name})`,
      text
    })
  });

  if (!r.ok) return res.status(502).json({ error: "Email send failed" });
  return res.status(200).json({ ok: true });
};
