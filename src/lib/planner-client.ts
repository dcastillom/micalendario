import type { DayEntry, DayRecord, PlannerSettings } from "./planner-types";
import { getSupabaseClient, hasSupabaseConfig } from "./supabase-client";

const STORAGE_KEY = "mi-calendario-days";
const SETTINGS_KEY = "mi-calendario-settings";
const DEFAULT_ASIGNADO_OPTIONS = ["Bea", "Cris", "Gloria", "Alfredo", "Yo"];
const REMOTE_DAYS_TABLE = "planner_days";
const REMOTE_SETTINGS_TABLE = "planner_settings";
const REMOTE_SHARED_SETTINGS_ID = "shared";

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createEmptyEntry(): DayEntry {
  return {
    id: createId(),
    asignado: "",
    plano: "",
    referencia: "",
    localidad: "",
    observaciones: "",
    entregado: false
  };
}

function normalizeEntry(entry: DayEntry & { pedido?: string }) {
  return {
    ...entry,
    asignado: entry.asignado ?? entry.pedido ?? ""
  };
}

function normalizeRecord(record: DayRecord): DayRecord {
  return {
    ...record,
    entries: record.entries.map((entry) => normalizeEntry(entry as DayEntry & { pedido?: string })),
    updatedAt: record.updatedAt || new Date().toISOString()
  };
}

function normalizeRecordMap(days: Record<string, DayRecord>) {
  return Object.fromEntries(
    Object.entries(days).map(([dateKey, record]) => [dateKey, normalizeRecord(record)])
  );
}

function normalizeAsignadoOptions(options: string[]) {
  const uniqueOptions = [];
  const seen = new Set<string>();

  for (const option of options) {
    const trimmed = option.trim();
    const normalized = trimmed.toLocaleLowerCase("es-ES");

    if (!trimmed || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    uniqueOptions.push(trimmed);
  }

  const sortedOptions = uniqueOptions.sort((left, right) =>
    left.localeCompare(right, "es", { sensitivity: "base" })
  );

  return sortedOptions.length > 0 ? sortedOptions : [...DEFAULT_ASIGNADO_OPTIONS].sort((left, right) =>
    left.localeCompare(right, "es", { sensitivity: "base" })
  );
}

function normalizeSettings(
  settings?: (PlannerSettings & { pedidoOptions?: string[] }) | null
): PlannerSettings {
  return {
    asignadoOptions: normalizeAsignadoOptions(
      settings?.asignadoOptions ?? settings?.pedidoOptions ?? DEFAULT_ASIGNADO_OPTIONS
    )
  };
}

export function createEmptyDay(dateKey: string): DayRecord {
  return normalizeRecord({
    dateKey,
    notes: "",
    entries: [],
    updatedAt: new Date().toISOString()
  });
}

function getMonthBounds(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const start = `${monthKey}-01`;
  const nextMonthDate = new Date(year, month, 1);
  const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}-01`;

  return { start, nextMonth };
}

function serializeRemoteRecord(record: DayRecord) {
  return {
    date_key: record.dateKey,
    notes: record.notes,
    entries: record.entries,
    updated_at: record.updatedAt
  };
}

function normalizeRemoteRecord(row: {
  date_key: string;
  notes: string | null;
  entries: DayEntry[] | null;
  updated_at: string | null;
}) {
  return normalizeRecord({
    dateKey: row.date_key,
    notes: row.notes ?? "",
    entries: Array.isArray(row.entries) ? row.entries : [],
    updatedAt: row.updated_at ?? new Date().toISOString()
  });
}

async function loadRemoteDay(dateKey: string) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from(REMOTE_DAYS_TABLE)
    .select("date_key, notes, entries, updated_at")
    .eq("date_key", dateKey)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? normalizeRemoteRecord(data) : null;
}

async function loadRemoteDaysForMonth(monthKey: string) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return null;
  }

  const { start, nextMonth } = getMonthBounds(monthKey);
  const { data, error } = await supabase
    .from(REMOTE_DAYS_TABLE)
    .select("date_key, notes, entries, updated_at")
    .gte("date_key", start)
    .lt("date_key", nextMonth)
    .order("date_key", { ascending: true });

  if (error) {
    throw error;
  }

  return Object.fromEntries((data ?? []).map((row) => [row.date_key, normalizeRemoteRecord(row)]));
}

async function loadRemoteAllDays() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from(REMOTE_DAYS_TABLE)
    .select("date_key, notes, entries, updated_at")
    .order("date_key", { ascending: true });

  if (error) {
    throw error;
  }

  return Object.fromEntries((data ?? []).map((row) => [row.date_key, normalizeRemoteRecord(row)]));
}

async function saveRemoteDay(record: DayRecord) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from(REMOTE_DAYS_TABLE)
    .upsert(serializeRemoteRecord(record), { onConflict: "date_key" })
    .select("date_key, notes, entries, updated_at")
    .single();

  if (error) {
    throw error;
  }

  return normalizeRemoteRecord(data);
}

async function loadRemoteSettings() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from(REMOTE_SETTINGS_TABLE)
    .select("asignado_options")
    .eq("id", REMOTE_SHARED_SETTINGS_ID)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeSettings(
    data
      ? {
          asignadoOptions: Array.isArray(data.asignado_options)
            ? data.asignado_options.map((value) => String(value))
            : []
        }
      : undefined
  );
}

async function saveRemoteSettings(settings: PlannerSettings) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return null;
  }

  const normalized = normalizeSettings(settings);
  const { data, error } = await supabase
    .from(REMOTE_SETTINGS_TABLE)
    .upsert(
      {
        id: REMOTE_SHARED_SETTINGS_ID,
        asignado_options: normalized.asignadoOptions,
        updated_at: new Date().toISOString()
      },
      { onConflict: "id" }
    )
    .select("asignado_options")
    .single();

  if (error) {
    throw error;
  }

  return normalizeSettings({
    asignadoOptions: Array.isArray(data.asignado_options)
      ? data.asignado_options.map((value) => String(value))
      : []
  });
}

function readBrowserStore(): Record<string, DayRecord> {
  if (typeof window === "undefined") {
    return {};
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, DayRecord>;
  } catch {
    return {};
  }
}

function writeBrowserStore(days: Record<string, DayRecord>) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(days));
}

function readBrowserSettings(): PlannerSettings {
  if (typeof window === "undefined") {
    return normalizeSettings();
  }

  const raw = window.localStorage.getItem(SETTINGS_KEY);

  if (!raw) {
    return normalizeSettings();
  }

  try {
    return normalizeSettings(JSON.parse(raw) as PlannerSettings & { pedidoOptions?: string[] });
  } catch {
    return normalizeSettings();
  }
}

function writeBrowserSettings(settings: PlannerSettings) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
}

export async function loadDay(dateKey: string): Promise<DayRecord> {
  if (hasSupabaseConfig()) {
    try {
      const record = await loadRemoteDay(dateKey);
      return normalizeRecord(record ?? createEmptyDay(dateKey));
    } catch (error) {
      console.error("No se pudo cargar el dia desde Supabase.", error);
    }
  }

  if (typeof window !== "undefined" && window.desktopPlanner) {
    const record = await window.desktopPlanner.getDay(dateKey);
    return normalizeRecord(record ?? createEmptyDay(dateKey));
  }

  const days = readBrowserStore();
  return normalizeRecord(days[dateKey] ?? createEmptyDay(dateKey));
}

export async function loadDaysForMonth(monthKey: string): Promise<Record<string, DayRecord>> {
  if (hasSupabaseConfig()) {
    try {
      const days = await loadRemoteDaysForMonth(monthKey);
      return normalizeRecordMap(days ?? {});
    } catch (error) {
      console.error("No se pudieron cargar los dias del mes desde Supabase.", error);
    }
  }

  if (typeof window !== "undefined" && window.desktopPlanner) {
    const days = await window.desktopPlanner.getDaysForMonth(monthKey);
    return normalizeRecordMap(days);
  }

  const days = readBrowserStore();
  return normalizeRecordMap(
    Object.fromEntries(Object.entries(days).filter(([dateKey]) => dateKey.startsWith(`${monthKey}-`)))
  );
}

export async function loadAllDays(): Promise<Record<string, DayRecord>> {
  if (hasSupabaseConfig()) {
    try {
      const days = await loadRemoteAllDays();
      return normalizeRecordMap(days ?? {});
    } catch (error) {
      console.error("No se pudieron cargar todos los dias desde Supabase.", error);
    }
  }

  if (typeof window !== "undefined" && window.desktopPlanner) {
    const days = await window.desktopPlanner.getAllDays();
    return normalizeRecordMap(days);
  }

  const days = readBrowserStore();
  return normalizeRecordMap(days);
}

export async function saveDay(record: DayRecord): Promise<DayRecord> {
  const normalized = normalizeRecord({
    ...record,
    updatedAt: new Date().toISOString()
  });

  if (hasSupabaseConfig()) {
    try {
      const saved = await saveRemoteDay(normalized);

      if (saved) {
        return normalizeRecord(saved);
      }
    } catch (error) {
      console.error("No se pudo guardar el dia en Supabase.", error);
      throw error;
    }
  }

  if (typeof window !== "undefined" && window.desktopPlanner) {
    return normalizeRecord(await window.desktopPlanner.saveDay(normalized));
  }

  const days = readBrowserStore();
  days[record.dateKey] = normalized;
  writeBrowserStore(days);
  return normalized;
}

export async function loadSettings(): Promise<PlannerSettings> {
  if (hasSupabaseConfig()) {
    try {
      return normalizeSettings(await loadRemoteSettings());
    } catch (error) {
      console.error("No se pudo cargar la configuracion desde Supabase.", error);
    }
  }

  if (typeof window !== "undefined" && window.desktopPlanner) {
    return normalizeSettings(await window.desktopPlanner.getSettings());
  }

  return readBrowserSettings();
}

export async function saveSettings(settings: PlannerSettings): Promise<PlannerSettings> {
  const normalized = normalizeSettings(settings);

  if (hasSupabaseConfig()) {
    try {
      const saved = await saveRemoteSettings(normalized);
      return normalizeSettings(saved);
    } catch (error) {
      console.error("No se pudo guardar la configuracion en Supabase.", error);
      throw error;
    }
  }

  if (typeof window !== "undefined" && window.desktopPlanner) {
    return normalizeSettings(await window.desktopPlanner.saveSettings(normalized));
  }

  writeBrowserSettings(normalized);
  return normalized;
}
