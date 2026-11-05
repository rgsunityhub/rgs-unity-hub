import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && key);
const authStorage = {
  getItem: (storageKey: string) => sessionStorage.getItem(storageKey) ?? localStorage.getItem(storageKey),
  setItem: (storageKey: string, value: string) => {
    if (sessionStorage.getItem("rgs:remember-session") === "false") {
      localStorage.removeItem(storageKey);
      sessionStorage.setItem(storageKey, value);
    } else {
      sessionStorage.removeItem(storageKey);
      localStorage.setItem(storageKey, value);
    }
  },
  removeItem: (storageKey: string) => {
    localStorage.removeItem(storageKey);
    sessionStorage.removeItem(storageKey);
  },
};

export const supabase = isSupabaseConfigured
  ? createClient(url!, key!, { auth: { storage: authStorage, persistSession: true, autoRefreshToken: true } })
  : null;
