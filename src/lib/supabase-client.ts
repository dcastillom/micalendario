import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let supabaseClient: SupabaseClient | null | undefined;

export type StorageModeStatus =
  | "checking"
  | "supabase"
  | "local"
  | "missing-config"
  | "error";

function getSupabaseUrl() {
  return import.meta.env.PUBLIC_SUPABASE_URL?.trim() || "";
}

function getSupabaseAnonKey() {
  return import.meta.env.PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
}

export function hasSupabaseConfig() {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

export function getSupabaseClient() {
  if (supabaseClient !== undefined) {
    return supabaseClient;
  }

  if (!hasSupabaseConfig()) {
    supabaseClient = null;
    return supabaseClient;
  }

  supabaseClient = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  return supabaseClient;
}

export async function detectStorageMode(): Promise<StorageModeStatus> {
  if (!hasSupabaseConfig()) {
    return "missing-config";
  }

  const supabase = getSupabaseClient();

  if (!supabase) {
    return "missing-config";
  }

  const { error } = await supabase
    .from("planner_settings")
    .select("id")
    .eq("id", "shared")
    .limit(1);

  return error ? "error" : "supabase";
}
