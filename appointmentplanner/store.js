// Storage and sign-in for the appointment planner, backed by Supabase.
// Gives the planner the small doc/collection API it was written against:
//   db.doc("jobs/MND-2026-001").set(obj) / .delete() / .onSnapshot(fn)
//   db.collection("jobs").onSnapshot(fn)
// Every document is one row in public.planner_docs (see supabase/planner.sql).
(function () {
  "use strict";
  const TABLE = "planner_docs";
  const REFRESH_MS = 60000;
  const $ = (s) => document.querySelector(s);
  const UNSAVED = " Showing example data; changes won't be saved.";

  // Returns { cfg } or { problem } (a sentence saying what to fix).
  async function loadConfig() {
    let r;
    try {
      r = await fetch("/api/planner-config", { headers: { Accept: "application/json" }, cache: "no-store" });
    } catch {
      return { problem: "Couldn't reach matenextdoor.com. Check your internet connection and reload." };
    }
    const c = await r.json().catch(() => ({}));
    if (r.ok && c.url && c.anonKey) return { cfg: c };
    if (r.status === 501) return { problem: c.error || "Storage isn't set up yet (see the README)." };
    return { problem: `The planner's settings didn't load (error ${r.status}). Reload the page.` };
  }

  // Test the Supabase address and key before asking for a password, so a setup mistake is named.
  async function checkSetup(cfg) {
    let host = cfg.url;
    try { host = new URL(cfg.url).host; } catch {}
    let r;
    try {
      r = await fetch(cfg.url + "/auth/v1/settings", { headers: { apikey: cfg.anonKey }, cache: "no-store" });
    } catch {
      return navigator.onLine === false
        ? "You're offline. Reconnect and reload."
        : `Couldn't reach Supabase at ${host}. In Vercel, check SUPABASE_URL is the Project URL (https://<id>.supabase.co), then redeploy.`;
    }
    if (r.status === 401 || r.status === 403)
      return "Supabase didn't accept the planner's key. In Vercel, set SUPABASE_ANON_KEY to the anon key from Supabase → Project Settings → API Keys → Legacy API Keys, then redeploy.";
    if (!r.ok) return `Supabase at ${host} answered with error ${r.status}. Check SUPABASE_URL in Vercel, then redeploy.`;
    return null;
  }

  function signInError(error) {
    const msg = String((error && error.message) || "");
    if (/not confirmed/i.test(msg))
      return "This login hasn't been confirmed. In Supabase → Authentication → Users, delete it and add it again with Auto Confirm User ticked.";
    if (error.status === 400 || /invalid login credentials/i.test(msg)) return "That email and password don't match.";
    if (error.status === 429) return "Too many attempts. Wait a minute, then try again.";
    if (error.status === 401 || error.status === 403 || /api key/i.test(msg))
      return "Supabase didn't accept the planner's key. In Vercel, set SUPABASE_ANON_KEY to the legacy anon key, then redeploy.";
    if (!error.status) return "Couldn't reach Supabase. Check your internet connection; if that's fine, check SUPABASE_URL in Vercel.";
    return `Couldn't sign in (Supabase said: ${msg || "error " + error.status}).`;
  }

  /* ---------- sign-in screen ---------- */
  function gate(mode, msg) {
    $("#loverlay").hidden = !mode;
    $("#lwait").hidden = mode !== "wait";
    $("#lform").hidden = mode !== "signin";
    $("#pform").hidden = mode !== "newpass";
    $("#l-err").textContent = mode === "signin" ? msg || "" : "";
    $("#p-err").textContent = mode === "newpass" ? msg || "" : "";
    if (mode === "signin") $("#l-email").focus();
    if (mode === "newpass") $("#p-pass").focus();
  }

  function waitForSignIn(sb, msg) {
    return new Promise((resolve) => {
      gate("signin", msg);
      $("#lform").onsubmit = async (e) => {
        e.preventDefault();
        const email = $("#l-email").value.trim(), password = $("#l-pass").value;
        if (!email || !password) { $("#l-err").textContent = "Enter your email and password."; return; }
        const btn = $("#lform button[type=submit]");
        btn.disabled = true; $("#l-err").textContent = "";
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        btn.disabled = false;
        if (error) { $("#l-err").textContent = signInError(error); return; }
        $("#l-pass").value = "";
        gate(null);
        resolve(data.session);
      };
      $("#l-reset").onclick = async () => {
        const email = $("#l-email").value.trim();
        if (!email) { $("#l-err").textContent = "Enter your email first, then tap Forgot password."; return; }
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        $("#l-err").textContent = error ? "Couldn't send the reset email. Try again shortly." : "If that email has access, a reset link is on its way.";
      };
    });
  }

  function askNewPassword(sb) {
    gate("newpass");
    $("#pform").onsubmit = async (e) => {
      e.preventDefault();
      const password = $("#p-pass").value;
      if (password.length < 8) { $("#p-err").textContent = "Use at least 8 characters."; return; }
      const { error } = await sb.auth.updateUser({ password });
      if (error) { $("#p-err").textContent = "Couldn't save the new password. Try again."; return; }
      $("#p-pass").value = "";
      history.replaceState(null, "", location.pathname);
      gate(null);
    };
  }

  async function isMember(sb) {
    // RLS only returns the signed-in user's own row, and only if they're on the list.
    const { data, error } = await sb.from("planner_members").select("email").limit(1);
    if (error) throw error;
    return data.length > 0;
  }

  /* ---------- documents ---------- */
  function makeDb(sb) {
    const rows = new Map(); // collection -> Map(id -> data)
    const subs = new Set();
    let ready = false, pending = 0;
    const split = (path) => { const k = path.indexOf("/"); return [path.slice(0, k), path.slice(k + 1)]; };
    const coll = (c) => rows.get(c) || new Map();

    function deliver(s) {
      if (!ready) return;
      try {
        if (s.id === undefined) s.next({ docs: [...coll(s.coll)].map(([id, v]) => ({ id, data: () => v })) });
        else { const v = coll(s.coll).get(s.id); s.next({ exists: v !== undefined, data: () => v }); }
      } catch (e) { console.error(e); }
    }
    function changed(c, id) {
      for (const s of subs) if (s.coll === c && (s.id === undefined || s.id === id)) deliver(s);
    }
    function put(c, id, v) {
      if (!rows.has(c)) rows.set(c, new Map());
      if (v === undefined) rows.get(c).delete(id); else rows.get(c).set(id, v);
    }

    async function load() {
      const next = new Map(), page = 1000;
      for (let from = 0; ; from += page) {
        const { data, error } = await sb.from(TABLE).select("collection,id,data").order("collection").order("id").range(from, from + page - 1);
        if (error) throw error;
        for (const r of data) { if (!next.has(r.collection)) next.set(r.collection, new Map()); next.get(r.collection).set(r.id, r.data); }
        if (data.length < page) break;
      }
      if (pending) return; // a write is in flight; the next refresh picks it up
      const touched = new Set([...rows.keys(), ...next.keys()]);
      const before = new Map([...touched].map((c) => [c, JSON.stringify([...coll(c)])]));
      rows.clear();
      for (const [c, m] of next) rows.set(c, m);
      const first = !ready;
      ready = true;
      for (const c of touched) if (first || before.get(c) !== JSON.stringify([...coll(c)])) for (const s of subs) if (s.coll === c) deliver(s);
    }

    async function write(c, id, v) {
      const prev = coll(c).get(id);
      put(c, id, v); changed(c, id);
      pending++;
      try {
        const { error } = v === undefined
          ? await sb.from(TABLE).delete().match({ collection: c, id })
          : await sb.from(TABLE).upsert({ collection: c, id, data: v, updated_at: new Date().toISOString() });
        if (error) {
          put(c, id, prev); changed(c, id);
          const e = new Error(error.message || "Write failed");
          e.code = error.code === "42501" ? "invalid_argument" : "unavailable";
          throw e;
        }
      } finally { pending--; }
    }

    // Pick up changes made on another device.
    const refresh = () => { if (document.visibilityState === "visible") load().catch((e) => console.warn("Planner refresh failed", e)); };
    setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);

    function sub(s) {
      subs.add(s);
      deliver(s);
      return () => subs.delete(s);
    }
    return {
      load,
      doc(path) {
        const [c, id] = split(path);
        return {
          set: (v) => write(c, id, JSON.parse(JSON.stringify(v))),
          delete: () => write(c, id, undefined),
          onSnapshot: (next, err) => sub({ coll: c, id, next, err }),
        };
      },
      collection(c) { return { onSnapshot: (next, err) => sub({ coll: c, next, err }) }; },
    };
  }

  /* ---------- connect ---------- */
  async function connect() {
    gate("wait");
    try {
      return await signInAndLoad();
    } finally {
      if (!$("#lwait").hidden) gate(null);
    }
  }

  function tablesProblem(e) {
    return e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message || ""))
      ? "The planner's tables aren't in Supabase yet. Run supabase/planner.sql in Supabase → SQL Editor, then reload."
      : "Couldn't reach the planner's storage. Check your connection and reload.";
  }

  async function signInAndLoad() {
    if (!window.supabase || !window.supabase.createClient) return { db: null, reason: "Couldn't load the storage library. Reload the page." + UNSAVED };
    const { cfg, problem } = await loadConfig();
    if (!cfg) return { db: null, reason: problem + UNSAVED };
    const setup = await checkSetup(cfg);
    if (setup) return { db: null, reason: setup + UNSAVED };
    let recovering = /type=recovery/.test(location.hash);
    const sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    sb.auth.onAuthStateChange((event) => { if (event === "PASSWORD_RECOVERY") recovering = true; });

    let { data: { session } } = await sb.auth.getSession();
    let msg = "";
    for (;;) {
      if (!session) session = await waitForSignIn(sb, msg);
      let ok;
      try { ok = await isMember(sb); } catch (e) { return { db: null, reason: tablesProblem(e) + UNSAVED }; }
      if (ok) break;
      await sb.auth.signOut();
      session = null;
      msg = "This account doesn't have access to the planner.";
    }

    const out = $("#signout");
    out.hidden = false;
    out.title = session.user && session.user.email ? "Signed in as " + session.user.email : "";
    out.onclick = () => sb.auth.signOut().finally(() => location.reload());

    gate("wait");
    const db = makeDb(sb);
    try { await db.load(); } catch (e) { return { db: null, reason: tablesProblem(e) + UNSAVED }; }
    gate(null);
    if (recovering) askNewPassword(sb);
    return { db };
  }

  window.PlannerStore = { connect };
})();
