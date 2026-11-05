import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) return json({ error: "Authentication service is not configured" }, 500);

  let payload: { nickname?: unknown; password?: unknown };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }
  const nickname = typeof payload.nickname === "string" ? payload.nickname.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!/^[\p{L}\p{N}_. -]{3,24}$/u.test(nickname) || password.length < 1 || password.length > 256) {
    return json({ error: "Nickname atau password salah." }, 401);
  }

  const ip = request.headers.get("x-real-ip") ?? request.headers.get("cf-connecting-ip") ?? "unknown";
  const rateKey = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}:${nickname.toLocaleLowerCase()}`));
  const rateHash = Array.from(new Uint8Array(rateKey), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: allowed, error: rateError } = await admin.rpc("check_login_rate", { p_key_hash: rateHash });
  if (rateError) return json({ error: "Login sementara tidak tersedia. Coba lagi nanti." }, 503);
  if (!allowed) return json({ error: "Terlalu banyak percobaan. Coba lagi dalam 15 menit." }, 429);

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .ilike("nickname", nickname.replace(/[\\%_]/g, "\\$&"))
    .maybeSingle();
  if (profileError || !profile) return json({ error: "Nickname atau password salah." }, 401);

  const { data: userResult, error: userError } = await admin.auth.admin.getUserById(profile.id);
  const email = userResult.user?.email;
  if (userError || !email || userResult.user?.banned_until) return json({ error: "Nickname atau password salah." }, 401);

  const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signIn, error: signInError } = await auth.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) return json({ error: "Nickname atau password salah." }, 401);
  return json({ session: signIn.session });
});
