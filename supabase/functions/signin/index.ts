// Sign in with a username instead of an email.
// The app sends { username, password }. This function finds the email that goes with the username (the app itself can never
// look that up, so nobody can use a username to discover someone's email), signs in with it, and hands back the session.
// Wrong username and wrong password give the same answer. Eight misses in 15 minutes for one username, or 40 from one
// address, and it stops answering for a while.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const url = Deno.env.get("SUPABASE_URL")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(url, service, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "nomatch" });
  const body = await req.json().catch(() => ({}));
  const username = String(body.username ?? "").trim().replace(/^@+/, "").toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[a-z0-9][a-z0-9_.]{2,19}$/.test(username) || password.length < 8 || password.length > 200) return json({ error: "nomatch" });
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 60) || null;

  const { data: look, error: lookErr } = await db.rpc("signin_lookup", { u: username, addr: ip });
  if (lookErr) { console.error("lookup", lookErr.message); return json({ error: "down" }); }
  if (look?.wait) return json({ error: "wait" });
  const miss = async () => { await db.rpc("signin_failed", { u: username, addr: ip }); return json({ error: "nomatch" }); };
  if (!look?.email) return miss();

  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: service, "Content-Type": "application/json" }, body: JSON.stringify({ email: look.email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    if (/confirm/i.test(String(j.error_description || j.msg || j.error_code || ""))) return json({ error: "confirm" });
    return miss();
  }
  return json({ access_token: j.access_token, refresh_token: j.refresh_token });
});
