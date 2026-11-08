// Sends Coulee web-push notifications. Called only by the database (shared secret), never by the app.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
let cfg: Record<string, string> | null = null;
async function config() {
  if (cfg) return cfg;
  const { data, error } = await db.rpc("push_config");
  if (error || !data) throw new Error("config unavailable");
  cfg = data as Record<string, string>;
  webpush.setVapidDetails("https://adamhut32.github.io/Wisconsin-Fly-Log/", cfg.coulee_vapid_public, cfg.coulee_vapid_private);
  return cfg;
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let c;
  try { c = await config(); } catch { return json({ error: "config" }, 500); }
  if (req.headers.get("x-coulee-secret") !== c.coulee_push_secret) return json({ error: "forbidden" }, 403);
  const { user_id, kind, title, body, url } = await req.json().catch(() => ({}));
  if (!user_id || !title) return json({ error: "bad request" }, 400);
  const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", user_id);
  const payload = JSON.stringify({ title, body: body || "", url: url || "", tag: kind || "coulee" });
  let sent = 0, removed = 0, failed = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 24, urgency: kind === "message" ? "high" : "normal" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { await db.from("push_subscriptions").delete().eq("id", s.id); removed++; }
      else { failed++; console.error("push failed", code, String((e as Error).message || e).slice(0, 200)); }
    }
  }
  return json({ sent, removed, failed });
});
