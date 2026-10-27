// Job rules shared by the planner page and the morning email (api/daily-digest.js):
// the price list, the five job steps, settings defaults, and how saved bookings are read back.
// Browser: window.JobRules. Node: require("../appointmentplanner/jobrules.js").
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JobRules = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Fixed prices from Will's card; editable in the planner under Prices → Edit.
  const SERVICES = [
    { k: "repairs", name: "Repairs & Maintenance", short: "Repairs & Maint.", price: 120, unit: "Per job, up to 2 hrs" },
    { k: "building", name: "Small Building Jobs", short: "Small Building", price: 350, unit: "Half day" },
    { k: "fencing", name: "Fencing Repairs", short: "Fencing Repairs", price: 220, unit: "Per job, up to 10 m" },
    { k: "yard", name: "Yard Work & Garden Tidy Ups", short: "Yard & Garden", price: 160, unit: "Standard block" },
    { k: "painting", name: "Small Painting Jobs", short: "Small Painting", price: 280, unit: "One room or fence run" },
    { k: "plumbing", name: "Small Plumbing Jobs", short: "Small Plumbing", price: 140, unit: "Taps, leaks, toilets" },
    { k: "electrical", name: "Electrical Odd Jobs", short: "Electrical Odd Jobs", price: 130, unit: "Lights, fans, fixtures" },
    { k: "farm", name: "Farm Contracting", short: "Farm Contracting", price: 300, unit: "Half day, general help" },
    { k: "sheds", name: "Sheds & Outdoor Projects", short: "Sheds & Outdoor", price: 450, unit: "Half day" },
    { k: "gates", name: "Gate Repairs & Rural Fencing", short: "Gates & Rural Fence", price: 260, unit: "Per gate or 20 m" },
    { k: "trailer", name: "Trailer & Equipment Maintenance", short: "Trailer & Equip.", price: 150, unit: "Service & check" },
    { k: "install", name: "Fix, Replace & Install", short: "Fix & Install", price: 110, unit: "Per item" },
    { k: "trees", name: "Tree & Property Clean Ups", short: "Tree & Clean Ups", price: 240, unit: "Small jobs, green waste incl." },
    { k: "automotive", name: "Automotive Accessories & Maintenance", short: "Automotive", price: 180, unit: "Fit-out or service" },
  ];
  const DEFAULTS = {
    owner: "Will", slots: [7, 9, 11, 13, 15], days: [true, true, true, true, true, false, false], gst: true,
    payHow: "", signoff: "Thanks,\nWill\nMate Next Door · 0459 838 777\nABN 41 957 332 265", prices: SERVICES,
  };
  // Five steps, the same on every job. No deposit: a job is booked straight in and paid once it's done.
  const ORDER = ["booked", "enroute", "onsite", "done", "paid"];
  const LABEL = { booked: "Booked", enroute: "On my way", onsite: "On site", done: "Done · unpaid", paid: "Paid" };

  const pad = (n) => String(n).padStart(2, "0");
  const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const money = (n) => "$" + (Number(n) || 0).toLocaleString("en-AU", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const hourLabel = (h) => `${h % 12 || 12}:00 ${h < 12 ? "AM" : "PM"}`;
  const ref = (b) => `MND-${b.date.slice(2).replace(/-/g, "")}-${pad(b.hour)}`;
  // Finished but not paid, with something to collect.
  const owes = (b) => b.status === "done" && b.price > 0;

  function normBooking(id, v, today) {
    v = v || {};
    return {
      id, k: String(v.k || "repairs"), svc: String(v.svc || "Job"), price: Number(v.price) || 0,
      customer: String(v.customer || ""), phone: String(v.phone || ""), email: String(v.email || ""), address: String(v.address || ""),
      rural: !!v.rural, date: isDate(v.date) ? v.date : today || "", hour: Number.isInteger(v.hour) ? v.hour : 9,
      status: ORDER.includes(v.status) ? v.status : "booked", notes: String(v.notes || ""),
      invoicedAt: String(v.invoicedAt || ""), paidAt: String(v.paidAt || ""), doneAt: String(v.doneAt || ""), createdAt: String(v.createdAt || ""),
      from: String(v.from || ""),
    };
  }
  function normCfg(v) {
    const d = DEFAULTS;
    if (!v || typeof v !== "object") return JSON.parse(JSON.stringify(d));
    return {
      owner: typeof v.owner === "string" && v.owner.trim() ? v.owner : d.owner,
      slots: Array.isArray(v.slots) && v.slots.length && v.slots.every(Number.isInteger) ? [...v.slots].sort((a, b) => a - b) : d.slots,
      days: Array.isArray(v.days) && v.days.length === 7 ? v.days.map(Boolean) : d.days,
      gst: typeof v.gst === "boolean" ? v.gst : d.gst,
      payHow: typeof v.payHow === "string" ? v.payHow : "",
      signoff: typeof v.signoff === "string" && v.signoff.trim() ? v.signoff : d.signoff,
      prices: Array.isArray(v.prices) && v.prices.length
        ? v.prices.filter((p) => p && p.k && p.name).map((p) => ({ k: String(p.k), name: String(p.name), short: String(p.short || p.name), unit: String(p.unit || ""), price: Number(p.price) || 0 }))
        : d.prices,
    };
  }

  return { SERVICES, DEFAULTS, ORDER, LABEL, money, hourLabel, ref, owes, normBooking, normCfg, isDate };
});
