// Job rules shared by the planner page and the daily email (api/daily-digest.js):
// money, invoices, the reminder ladder and what each job needs next.
// Browser: window.JobRules. Node: require("../appointmentplanner/jobrules.js").
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JobRules = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Rules from the proposal T&Cs and the follow-up scripts; editable in Settings.
  const DEFAULTS = { gst: true, validDays: 14, depositPct: 30, terms: 7, v1Days: 3, v3Days: 14, payHow: "",
    signoff: "Thanks,\nWill\nMate Next Door · 0459 838 777\nABN 41 957 332 265" };
  const QSTAT = ["Sent", "Pending", "Accepted", "Declined"];
  const JSTAT = ["Not started", "In progress", "Completed", "Cancelled"];

  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const fmtDay = (s) => parse(s).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
  const fmtDate = (s) => (s ? parse(s).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "");
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const num = (v) => { const x = parseFloat(String(v ?? "").replace(/[^\d.\-]/g, "")); return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0; };
  const money = (n) => (Number(n) || 0).toLocaleString("en-AU", { style: "currency", currency: "AUD" });
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const invNo = (j, inv) => `${j.id}-${inv === "D" ? "D" : "B"}`; // deposit / balance invoice, both carry the Job ID

  function normJob(id, v) {
    const d = (k) => (isDate(v[k]) ? v[k] : "");
    const sent = v.sent && typeof v.sent === "object" ? v.sent : {};
    return {
      id, clientId: String(v.clientId || ""), client: String(v.client || ""), title: String(v.title || ""),
      quoteDate: d("quoteDate"), quoted: num(v.quoted), quoteStatus: QSTAT.includes(v.quoteStatus) ? v.quoteStatus : "Sent",
      deposit: num(v.deposit), depositDate: d("depositDate"), depositDue: d("depositDue"), depositPaid: d("depositPaid"),
      startDate: d("startDate"), status: JSTAT.includes(v.status) ? v.status : "Not started", completedDate: d("completedDate"),
      variations: (Array.isArray(v.variations) ? v.variations : []).filter((x) => x && typeof x === "object")
        .map((x) => ({ desc: String(x.desc || ""), amount: num(x.amount), approved: !!x.approved })),
      cancelAmount: num(v.cancelAmount),
      invoiceDate: d("invoiceDate"), dueDate: d("dueDate"), balancePaid: d("balancePaid"),
      reminders: (Array.isArray(v.reminders) ? v.reminders : []).filter((r) => r && (r.inv === "D" || r.inv === "F") && [1, 2, 3].includes(r.level))
        .map((r) => ({ inv: r.inv, level: r.level, day: isDate(r.day) ? r.day : String(r.sentAt || "").slice(0, 10), sentAt: String(r.sentAt || ""), to: String(r.to || "") })),
      sent: { quote: String(sent.quote || ""), D: String(sent.D || ""), F: String(sent.F || "") },
      notes: String(v.notes || ""), createdAt: String(v.createdAt || ""),
    };
  }
  function normCfg(v) {
    const d = DEFAULTS;
    v = v || {};
    const n = (k, lo, hi) => (Number.isInteger(v[k]) && v[k] >= lo && v[k] <= hi ? v[k] : d[k]);
    return { gst: typeof v.gst === "boolean" ? v.gst : d.gst, validDays: n("validDays", 1, 90), depositPct: n("depositPct", 0, 100), terms: n("terms", 0, 90),
      v1Days: n("v1Days", 1, 60), v3Days: n("v3Days", 1, 120),
      payHow: typeof v.payHow === "string" ? v.payHow : "", signoff: typeof v.signoff === "string" && v.signoff.trim() ? v.signoff : d.signoff };
  }

  // env: { cfg: () => settings, today: () => "YYYY-MM-DD" }
  function create(env) {
    const cfg = () => env.cfg();
    const now = () => env.today();
    const gstOf = (inc) => (cfg().gst ? Math.round(inc / 11 * 100) / 100 : 0);
    const incGst = () => (cfg().gst ? " inc. GST" : "");

    // Money: quoted + approved variations = job total; balance = total − deposit invoiced.
    function sums(j) {
      const vars = Math.round(j.variations.filter((x) => x.approved).reduce((s, x) => s + x.amount, 0) * 100) / 100;
      const total = j.status === "Cancelled" ? j.cancelAmount : Math.round((j.quoted + vars) * 100) / 100;
      const deposit = j.depositDate ? j.deposit : 0;
      return { vars, total, deposit, balance: Math.round((total - deposit) * 100) / 100, pendingVars: j.variations.filter((x) => !x.approved).length };
    }
    function invoices(j) {
      const s = sums(j), t = cfg().terms, out = [];
      if (j.depositDate) out.push({ inv: "D", no: invNo(j, "D"), date: j.depositDate, due: j.depositDue || addDays(j.depositDate, t), amount: j.deposit, paid: j.depositPaid });
      if (j.invoiceDate && s.balance > 0) out.push({ inv: "F", no: invNo(j, "F"), date: j.invoiceDate, due: j.dueDate || addDays(j.invoiceDate, t), amount: s.balance, paid: j.balancePaid });
      return out;
    }
    // Paid uses the Log's own words (No / Partially / Yes) and is worked out from the invoices, so it can't contradict them.
    function paidState(j) {
      const inv = invoices(j);
      if (!inv.length) return j.quoteStatus === "Declined" || j.status === "Cancelled" ? "n/a" : "Not invoiced";
      const paid = inv.filter((i) => i.paid).length;
      const finished = j.status === "Cancelled" || (j.status === "Completed" && (j.invoiceDate || sums(j).balance <= 0));
      if (paid === inv.length && finished) return "Yes";
      return paid ? "Partially" : "No";
    }

    // Follow-up ladder: V1 a few days after invoicing, V2 once overdue, V3 at N days overdue. Always in order, 3+ days apart.
    const REMINDERS = [
      { name: "Friendly nudge", when: (c) => `${plural(c.v1Days, "day")} after invoice`,
        subject: (i) => `Quick follow-up on Invoice #${i.no}`,
        body: (j, i) => `Just checking in on invoice #${i.no} for ${j.title} (${money(i.amount)}${incGst()}), sent on ${fmtDate(i.date)} and due ${fmtDate(i.due)}. If it's slipped through the cracks, no worries at all. Let me know if you'd like me to resend it.` },
      { name: "Polite but direct", when: () => "once overdue",
        subject: (i) => `Reminder: Invoice #${i.no} still pending`,
        body: (j, i) => `Invoice #${i.no} for ${j.title} (${money(i.amount)}${incGst()}) was due on ${fmtDate(i.due)} and is still unpaid. Could you let me know when I can expect payment?` },
      { name: "Final reminder", when: (c) => `${plural(c.v3Days, "day")} overdue`,
        subject: (i) => `Final reminder – Invoice #${i.no} overdue`,
        body: (j, i) => `This is a final reminder that invoice #${i.no} for ${j.title} (${money(i.amount)}${incGst()}) is now ${plural(Math.max(0, daysBetween(i.due, now())), "day")} overdue (it was due ${fmtDate(i.due)}). Please arrange payment as soon as possible. Until it's settled, I may need to pause any future work.` },
    ];
    function ladder(j, i) {
      const today = now();
      const sent = j.reminders.filter((r) => r.inv === i.inv).sort((x, y) => x.sentAt.localeCompare(y.sentAt));
      const last = sent[sent.length - 1];
      const lastLevel = sent.reduce((m, r) => Math.max(m, r.level), 0);
      const over = daysBetween(i.due, today);
      if (i.paid) return { sent, lastLevel, next: null, over, early: null };
      const c = cfg();
      const target = over >= c.v3Days ? 3 : over > 0 ? 2 : daysBetween(i.date, today) >= c.v1Days ? 1 : 0;
      const gapOk = !last || !isDate(last.day) || daysBetween(last.day, today) >= 3;
      const next = lastLevel < 3 && target > lastLevel && gapOk ? lastLevel + 1 : null;
      return { sent, lastLevel, next, over, early: !next && lastLevel < 3 ? lastLevel + 1 : null };
    }

    // Status map: what each status should trigger next.
    function nextAction(j) {
      const c = cfg(), s = sums(j), today = now();
      if (j.quoteStatus === "Declined") return j.notes.trim()
        ? { text: "Closed: quote declined. The reason is in Notes.", closed: true }
        : { text: "Quote declined: note the reason (price, timing) so you can quote better next time.", urgent: true };
      if (j.quoteStatus === "Sent" || j.quoteStatus === "Pending") {
        if (!j.quoteDate || !j.quoted) return { text: "Add the quote date and amount, then email the quote.", urgent: true };
        const left = daysBetween(today, addDays(j.quoteDate, c.validDays));
        return left < 0
          ? { text: `Quote expired ${plural(-left, "day")} ago. Follow up or re-quote; don't honour the old price without checking it.`, urgent: true }
          : { text: `Follow up before the quote expires on ${fmtDay(addDays(j.quoteDate, c.validDays))} (${plural(left, "day")} left).`, urgent: left <= 3 };
      }
      if (j.status === "Cancelled") {
        if (!j.notes.trim()) return { text: "Cancelled: note what happens to the deposit, and invoice any work done and materials bought.", urgent: true };
        if (s.balance > 0 && !j.invoiceDate) return { text: `Cancelled: invoice the work done and materials (${money(s.balance)} after the deposit).`, urgent: true };
        if (s.balance < 0) return { text: `Cancelled: the deposit is ${money(-s.balance)} more than the work done. Refund it or agree to keep it, and note which in Notes.`, urgent: false, closed: !invoices(j).some((i) => !i.paid) };
      }
      for (const i of invoices(j)) {
        if (i.paid) continue;
        const l = ladder(j, i);
        if (l.next) return { text: `${i.inv === "D" ? "Deposit" : "Balance"} invoice ${i.no} is unpaid${l.over > 0 ? `, ${plural(l.over, "day")} overdue` : ""}. Send reminder V${l.next}.`, urgent: true, reminder: { inv: i.inv, level: l.next } };
      }
      if (j.status !== "Cancelled") {
        if (!j.depositDate && j.deposit > 0) return { text: `Accepted: send the ${c.depositPct}% deposit invoice (${money(j.deposit)}) before any work starts, then set a start date.`, urgent: true };
        if (j.depositDate && !j.depositPaid) return { text: `Waiting on the deposit, due ${fmtDay(invoices(j)[0].due)}. Don't book the work until it's paid.` };
        if (j.status === "Not started") return j.startDate
          ? { text: `Deposit in. Work starts ${fmtDay(j.startDate)}: book it on the schedule and set the job to In progress.` }
          : { text: "Deposit in. Set a start date and book the work.", urgent: true };
        if (j.status === "In progress") return { text: "Record variations once they're approved in writing. When the client signs off, set the job to Completed (or mark the appointment Client signed off)." };
        if (j.status === "Completed" && !j.invoiceDate && s.balance > 0) return { text: `Completed: issue the balance invoice (${money(s.balance)}) today.`, urgent: true };
      }
      const open = invoices(j).find((i) => !i.paid);
      if (open) {
        const l = ladder(j, open);
        return l.lastLevel >= 3
          ? { text: `All three reminders sent for ${open.no}. Call the client, and pause future work until it's paid.`, urgent: true }
          : { text: `${open.no} is unpaid, due ${fmtDay(open.due)}. ${l.lastLevel ? `V${l.lastLevel} sent; V${l.lastLevel + 1} is due later.` : "The first reminder shows up here, and in the morning email, when it's due."}` };
      }
      if (paidState(j) === "Yes") return { text: "Paid in full. Job closed; no more reminders.", closed: true };
      if (j.status === "Cancelled") return { text: "Cancelled and settled. Job closed.", closed: true };
      return { text: "" };
    }
    const isClosed = (j) => !!nextAction(j).closed;
    function stage(j) {
      if (j.quoteStatus === "Declined") return ["Declined", "dim"];
      if (isClosed(j)) return [j.status === "Cancelled" ? "Cancelled" : "Closed", "ok"];
      if (j.quoteStatus !== "Accepted") return ["1 Quote", ""];
      if (j.status === "Cancelled") return ["Cancelled", "hot"];
      if (j.deposit > 0 && !j.depositPaid) return ["2 Deposit", ""];
      if (j.status === "Not started") return ["3 Schedule", ""];
      if (j.status === "In progress") return ["3–4 Work", ""];
      if (!j.invoiceDate && sums(j).balance > 0) return ["5 Invoice", "hot"];
      return ["6 Chase", ""];
    }
    // Checks that catch rows that don't add up (e.g. Paid while the job is still In progress with no invoice).
    function issues(j) {
      const out = [];
      if (!j.clientId) out.push("No client linked.");
      if (j.quoteStatus === "Accepted" && !j.quoted) out.push("Accepted with no quoted amount.");
      if ((j.status === "In progress" || j.status === "Completed") && j.quoteStatus !== "Accepted") out.push(`Job is ${j.status} but the quote isn't Accepted.`);
      if ((j.status === "In progress" || j.status === "Completed") && j.deposit > 0 && !j.depositPaid) out.push(`Job is ${j.status} but the deposit isn't paid.`);
      if (j.depositPaid && !j.depositDate) out.push("Deposit marked paid but there's no deposit invoice date.");
      if (j.invoiceDate && j.status !== "Completed" && j.status !== "Cancelled") out.push("Balance invoiced before the job was Completed.");
      if (j.balancePaid && !j.invoiceDate) out.push("Balance marked paid but no invoice is logged.");
      if (j.dueDate && j.invoiceDate && j.dueDate < j.invoiceDate) out.push("Due date is before the invoice date.");
      return out;
    }

    return { gstOf, incGst, sums, invoices, paidState, REMINDERS, ladder, nextAction, isClosed, stage, issues };
  }

  return { DEFAULTS, QSTAT, JSTAT, normJob, normCfg, create,
    addDays, fmtDay, fmtDate, daysBetween, isDate, num, money, plural, invNo };
});
