import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-rgs-push-secret",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const FIREBASE_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FIREBASE_TOKEN_URL = "https://oauth2.googleapis.com/token";

type PushNotification = {
  id: string;
  user_id: string;
  source_key: string | null;
  title: string;
  body: string;
};

type FirebaseServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

function base64UrlEncode(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodePrivateKey(value: string) {
  const pem = value.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(pem);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function getFirebaseAccessToken(account: FirebaseServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64UrlEncode(JSON.stringify({
    iss: account.client_email,
    scope: FIREBASE_SCOPE,
    aud: FIREBASE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsignedAssertion = `${header}.${claims}`;
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    decodePrivateKey(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedAssertion),
  );
  const assertion = `${unsignedAssertion}.${base64UrlEncode(new Uint8Array(signature))}`;
  const response = await fetch(FIREBASE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    console.error("Firebase OAuth token request failed:", response.status, await response.text());
    throw new Error("Firebase authentication failed.");
  }
  const token = await response.json() as { access_token?: string };
  if (!token.access_token) throw new Error("Firebase OAuth response did not contain an access token.");
  return token.access_token;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const triggerSecret = Deno.env.get("PUSH_TRIGGER_SECRET");
  if (!triggerSecret || request.headers.get("x-rgs-push-secret") !== triggerSecret) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase push configuration incomplete." }, 500);
  }

  let notification: PushNotification;
  try {
    notification = await request.json() as PushNotification;
  } catch {
    return jsonResponse({ error: "Invalid notification payload." }, 400);
  }
  if (!notification || typeof notification.user_id !== "string" ||
      typeof notification.title !== "string" || typeof notification.body !== "string") {
    return jsonResponse({ error: "Notification payload is missing required fields." }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const [
    { data: subscriptions, error: subscriptionsError },
    { data: nativeTokens, error: nativeTokensError },
  ] = await Promise.all([
    supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", notification.user_id),
    supabase.from("native_push_tokens").select("token").eq("user_id", notification.user_id),
  ]);
  if (subscriptionsError || nativeTokensError) {
    console.error("Failed to load push subscriptions:", subscriptionsError ?? nativeTokensError);
    return jsonResponse({ error: "Failed to load push subscriptions." }, 500);
  }

  const webSubscriptions = subscriptions ?? [];
  const androidTokens = nativeTokens ?? [];
  if (!webSubscriptions.length && !androidTokens.length) return jsonResponse({ webSent: 0, androidSent: 0, failed: 0 });

  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  if (webSubscriptions.length && (!vapidPrivateKey || !vapidPublicKey)) {
    return jsonResponse({ error: "Web Push configuration incomplete." }, 500);
  }

  const firebaseAccountValue = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  let accessToken: string | null = null;
  let firebaseProjectId: string | null = null;
  if (androidTokens.length) {
    if (!firebaseAccountValue) return jsonResponse({ error: "Firebase native push is not configured." }, 500);
    let account: FirebaseServiceAccount;
    try {
      account = JSON.parse(firebaseAccountValue) as FirebaseServiceAccount;
    } catch {
      return jsonResponse({ error: "Firebase service account is not valid JSON." }, 500);
    }
    if (!account.project_id || !account.client_email || !account.private_key) {
      return jsonResponse({ error: "Firebase service account is missing required fields." }, 500);
    }
    try {
      accessToken = await getFirebaseAccessToken(account);
      firebaseProjectId = account.project_id;
    } catch (error) {
      console.error("Failed to authenticate with Firebase:", error);
      return jsonResponse({ error: "Firebase authentication failed." }, 502);
    }
  }

  if (webSubscriptions.length && vapidPrivateKey && vapidPublicKey) {
    webpush.setVapidDetails("mailto:owner@rgsunityhub.github.io", vapidPublicKey, vapidPrivateKey);
  }

  const webPayload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    url: "/?page=notifications",
    tag: notification.source_key || notification.id,
  });
  const expiredWebIds: string[] = [];
  let webSent = 0;
  let failed = 0;
  await Promise.all(webSubscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, webPayload);
      webSent += 1;
    } catch (error) {
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) expiredWebIds.push(subscription.id);
      else {
        failed += 1;
        console.error("Web Push delivery failed:", statusCode || "unknown");
      }
    }
  }));
  if (expiredWebIds.length) {
    const { error } = await supabase.from("push_subscriptions").delete().in("id", expiredWebIds);
    if (error) {
      console.error("Failed to remove expired Web Push subscriptions:", error);
      failed += expiredWebIds.length;
    }
  }

  let androidSent = 0;
  const expiredNativeTokens: string[] = [];
  if (accessToken && firebaseProjectId) {
    await Promise.all(androidTokens.map(async ({ token }) => {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(firebaseProjectId!)}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: notification.title, body: notification.body },
              data: {
                url: "/?page=notifications",
                notification_id: notification.id,
                source_key: notification.source_key || "",
              },
              android: {
                priority: "HIGH",
                notification: {
                  channel_id: "rgs_notifications",
                  tag: notification.source_key || notification.id,
                  visibility: "PRIVATE",
                },
              },
            },
          }),
        },
      );
      if (response.ok) {
        androidSent += 1;
        return;
      }

      const details = await response.json().catch(() => ({})) as {
        error?: { status?: string; message?: string };
      };
      if (details.error?.status === "UNREGISTERED") expiredNativeTokens.push(token);
      else {
        failed += 1;
        console.error("Android Push delivery failed:", response.status, details.error?.status ?? "unknown");
      }
    }));
  }
  if (expiredNativeTokens.length) {
    const { error } = await supabase.from("native_push_tokens").delete().in("token", expiredNativeTokens);
    if (error) {
      console.error("Failed to remove expired Android Push tokens:", error);
      failed += expiredNativeTokens.length;
    }
  }

  if (failed) return jsonResponse({ webSent, androidSent, failed }, 502);
  return jsonResponse({ webSent, androidSent, failed: 0 });
});
