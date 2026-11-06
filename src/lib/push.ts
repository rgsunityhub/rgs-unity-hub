import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "./supabase";

const VAPID_PUBLIC_KEY = "BLXsNq_aNKMxkaCnZSTEcUCbAaa-hH1VFHfpCkC880JaQNslGqxUyAh-ur6htC-mk6oLQ9EQ-3x9JPHd1nAX0VU";
const NATIVE_TOKEN_KEY = "rgs:native-push-token";
const NATIVE_PUSH_CHANNEL = "rgs_notifications";

type PushStatus = "unsupported" | "enabled" | "disabled" | "denied";
type RegistrationWaiter = { resolve: (token: string) => void; reject: (error: Error) => void };

let nativeListeners: Promise<void> | null = null;
let registrationWaiter: RegistrationWaiter | null = null;

function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

async function saveNativeToken(token: string) {
  if (!supabase) throw new Error("Supabase belum tersedia.");
  const { error } = await supabase.from("native_push_tokens").upsert({ token }, { onConflict: "token" });
  if (error) throw error;
  localStorage.setItem(NATIVE_TOKEN_KEY, token);
}

export async function initializeNativePushListeners() {
  if (!isNativeAndroid()) return;
  if (!nativeListeners) {
    nativeListeners = (async () => {
      await PushNotifications.addListener("registration", ({ value }) => {
        void saveNativeToken(value).then(
          () => registrationWaiter?.resolve(value),
          (error: unknown) => {
            const failure = error instanceof Error ? error : new Error("Gagal menyimpan token push Android.");
            if (registrationWaiter) registrationWaiter.reject(failure);
            else console.error("Gagal memperbarui token push Android:", failure);
          },
        );
      });
      await PushNotifications.addListener("registrationError", ({ error }) => {
        const failure = new Error(error || "Pendaftaran push notification Android gagal.");
        if (registrationWaiter) registrationWaiter.reject(failure);
        else console.error(failure);
      });
      await PushNotifications.createChannel({
        id: NATIVE_PUSH_CHANNEL,
        name: "Notifikasi RGS",
        description: "Pemberitahuan aktivitas RGS Unity Hub.",
        importance: 5,
        visibility: 0,
        vibration: true,
        lights: true,
        lightColor: "#D7D8DE",
      });
    })().catch((error: unknown) => {
      nativeListeners = null;
      throw error;
    });
  }
  await nativeListeners;
}

async function getNativePushStatus(): Promise<PushStatus> {
  const permission = await PushNotifications.checkPermissions();
  if (permission.receive === "denied") return "denied";
  if (!supabase) throw new Error("Supabase belum tersedia.");

  const token = localStorage.getItem(NATIVE_TOKEN_KEY);
  if (!token) return "disabled";
  const { data, error } = await supabase
    .from("native_push_tokens")
    .select("token")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  return data ? "enabled" : "disabled";
}

export async function getPushStatus(): Promise<PushStatus> {
  if (isNativeAndroid()) return getNativePushStatus();
  if (Capacitor.isNativePlatform()) return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  const permission = Notification.permission;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) return "enabled";
  return permission === "denied" ? "denied" : "disabled";
}

async function enableNativePushNotifications() {
  if (!supabase) throw new Error("Supabase belum tersedia.");
  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== "granted") throw new Error("Izin notifikasi belum diberikan.");
  await initializeNativePushListeners();

  let resolveToken!: (token: string) => void;
  let rejectToken!: (error: Error) => void;
  const tokenPromise = new Promise<string>((resolve, reject) => {
    resolveToken = resolve;
    rejectToken = reject;
  });
  const timeout = window.setTimeout(() => {
    registrationWaiter?.reject(new Error("Pendaftaran FCM habis waktu. Pastikan Firebase Android sudah dikonfigurasi lalu coba lagi."));
  }, 30000);
  registrationWaiter = {
    resolve: (token) => { window.clearTimeout(timeout); resolveToken(token); },
    reject: (error) => { window.clearTimeout(timeout); rejectToken(error); },
  };

  try {
    await PushNotifications.register();
    await tokenPromise;
  } finally {
    window.clearTimeout(timeout);
    registrationWaiter = null;
  }
}

export async function enablePushNotifications() {
  if (isNativeAndroid()) return enableNativePushNotifications();
  if (Capacitor.isNativePlatform()) throw new Error("Push notification native hanya dikonfigurasi untuk Android.");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Browser ini tidak mendukung notifikasi push.");
  }
  if (!supabase) throw new Error("Supabase belum tersedia.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Izin notifikasi belum diberikan.");

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  });

  const json = subscription.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert({
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
  }, { onConflict: "endpoint" });
  if (error) throw error;
  return subscription;
}

export async function disablePushNotifications() {
  if (isNativeAndroid()) {
    if (!supabase) throw new Error("Supabase belum tersedia.");
    const token = localStorage.getItem(NATIVE_TOKEN_KEY);
    if (token) {
      const { error } = await supabase.from("native_push_tokens").delete().eq("token", token);
      if (error) throw error;
      localStorage.removeItem(NATIVE_TOKEN_KEY);
    }
    return;
  }
  if (!supabase) throw new Error("Supabase belum tersedia.");
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
    if (error) throw error;
    await subscription.unsubscribe();
  }
}

export async function removeNativePushTokenForCurrentUser() {
  if (!isNativeAndroid()) return;
  const token = localStorage.getItem(NATIVE_TOKEN_KEY);
  if (!token || !supabase) return;
  const { error } = await supabase.from("native_push_tokens").delete().eq("token", token);
  if (error) throw error;
  localStorage.removeItem(NATIVE_TOKEN_KEY);
}
