import type { DayEntry, DayRecord, PlannerSettings } from "./planner-types";
import {
  getSupabaseClient,
  hasSupabaseConfig,
  type StorageModeStatus,
} from "./supabase-client";

const STORAGE_KEY = "mi-calendario-days";
const SETTINGS_KEY = "mi-calendario-settings";
const DEFAULT_ASIGNADO_OPTIONS = ["Bea", "Cris", "Gloria", "Alfredo", "Aída"];
const DEFAULT_COMPANY_NAME = "";
const DEFAULT_COMPANY_SUBTITLE = "";
const DEFAULT_COMPANY_LOGO_DATA_URL = "";
const REMOTE_DAYS_TABLE = "planner_days";
const REMOTE_SETTINGS_TABLE = "planner_settings";
const REMOTE_SHARED_SETTINGS_ID = "shared";

export interface PlannerBackupSnapshot {
  createdAt: string;
  storageMode: StorageModeStatus;
  days: Record<string, DayRecord>;
  settings: PlannerSettings;
}

function normalizeBackupSnapshot(
  snapshot: PlannerBackupSnapshot,
): PlannerBackupSnapshot {
  return {
    createdAt: snapshot.createdAt || new Date().toISOString(),
    storageMode: snapshot.storageMode,
    days: normalizeRecordMap(snapshot.days ?? {}),
    settings: normalizeSettings(snapshot.settings),
  };
}

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
    entregado: false,
  };
}

function normalizeEntry(entry: DayEntry & { pedido?: string }) {
  return {
    ...entry,
    asignado: entry.asignado ?? entry.pedido ?? "",
  };
}

function normalizeRecord(record: DayRecord): DayRecord {
  return {
    ...record,
    entries: record.entries.map((entry) =>
      normalizeEntry(entry as DayEntry & { pedido?: string }),
    ),
    updatedAt: record.updatedAt || new Date().toISOString(),
  };
}

function normalizeRecordMap(days: Record<string, DayRecord>) {
  return Object.fromEntries(
    Object.entries(days).map(([dateKey, record]) => [
      dateKey,
      normalizeRecord(record),
    ]),
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
    left.localeCompare(right, "es", { sensitivity: "base" }),
  );

  return sortedOptions.length > 0
    ? sortedOptions
    : [...DEFAULT_ASIGNADO_OPTIONS].sort((left, right) =>
        left.localeCompare(right, "es", { sensitivity: "base" }),
      );
}

function normalizeTextSetting(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function normalizeLogoDataUrl(value: string | null | undefined) {
  const trimmedValue = String(value ?? "").trim();

  if (!trimmedValue.startsWith("data:image/")) {
    return "";
  }

  return trimmedValue;
}

function normalizeSettings(
  settings?:
    | (Partial<PlannerSettings> & { pedidoOptions?: string[] })
    | null,
): PlannerSettings {
  return {
    asignadoOptions: normalizeAsignadoOptions(
      settings?.asignadoOptions ??
        settings?.pedidoOptions ??
        DEFAULT_ASIGNADO_OPTIONS,
    ),
    companyName: normalizeTextSetting(settings?.companyName ?? DEFAULT_COMPANY_NAME),
    companySubtitle: normalizeTextSetting(
      settings?.companySubtitle ?? DEFAULT_COMPANY_SUBTITLE,
    ),
    companyLogoDataUrl: normalizeLogoDataUrl(
      settings?.companyLogoDataUrl ?? DEFAULT_COMPANY_LOGO_DATA_URL,
    ),
  };
}

export function createDefaultPlannerSettings(): PlannerSettings {
  return normalizeSettings();
}

export function createEmptyDay(dateKey: string): DayRecord {
  return normalizeRecord({
    dateKey,
    notes: "",
    entries: [],
    updatedAt: new Date().toISOString(),
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
    updated_at: record.updatedAt,
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
    updatedAt: row.updated_at ?? new Date().toISOString(),
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

  return Object.fromEntries(
    (data ?? []).map((row) => [row.date_key, normalizeRemoteRecord(row)]),
  );
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

  return Object.fromEntries(
    (data ?? []).map((row) => [row.date_key, normalizeRemoteRecord(row)]),
  );
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
    .select("asignado_options, company_name, company_subtitle, company_logo_data_url")
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
            : [],
          companyName: data.company_name ?? "",
          companySubtitle: data.company_subtitle ?? "",
          companyLogoDataUrl: data.company_logo_data_url ?? "",
        }
      : undefined,
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
        company_name: normalized.companyName,
        company_subtitle: normalized.companySubtitle,
        company_logo_data_url: normalized.companyLogoDataUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    .select("asignado_options, company_name, company_subtitle, company_logo_data_url")
    .single();

  if (error) {
    throw error;
  }

  return normalizeSettings({
    asignadoOptions: Array.isArray(data.asignado_options)
      ? data.asignado_options.map((value) => String(value))
      : [],
    companyName: data.company_name ?? "",
    companySubtitle: data.company_subtitle ?? "",
    companyLogoDataUrl: data.company_logo_data_url ?? "",
  });
}

async function replaceRemoteAllData(snapshot: PlannerBackupSnapshot) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error("Supabase no esta disponible.");
  }

  const normalized = normalizeBackupSnapshot(snapshot);
  const records = Object.values(normalized.days).map((record) =>
    serializeRemoteRecord(record),
  );

  const { error: deleteDaysError } = await supabase
    .from(REMOTE_DAYS_TABLE)
    .delete()
    .gte("date_key", "0000-01-01");

  if (deleteDaysError) {
    throw deleteDaysError;
  }

  if (records.length > 0) {
    const { error: insertDaysError } = await supabase
      .from(REMOTE_DAYS_TABLE)
      .upsert(records, { onConflict: "date_key" });

    if (insertDaysError) {
      throw insertDaysError;
    }
  }

  const { error: settingsError } = await supabase
    .from(REMOTE_SETTINGS_TABLE)
    .upsert(
      {
        id: REMOTE_SHARED_SETTINGS_ID,
        asignado_options: normalized.settings.asignadoOptions,
        company_name: normalized.settings.companyName,
        company_subtitle: normalized.settings.companySubtitle,
        company_logo_data_url: normalized.settings.companyLogoDataUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

  if (settingsError) {
    throw settingsError;
  }
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
    return normalizeSettings(
      JSON.parse(raw) as PlannerSettings & { pedidoOptions?: string[] },
    );
  } catch {
    return normalizeSettings();
  }
}

function writeBrowserSettings(settings: PlannerSettings) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify(normalizeSettings(settings)),
  );
}

export async function loadDay(dateKey: string): Promise<DayRecord> {
  if (hasSupabaseConfig()) {
    const record = await loadRemoteDay(dateKey);
    return normalizeRecord(record ?? createEmptyDay(dateKey));
  }

  if (typeof window !== "undefined" && window.desktopPlanner) {
    const record = await window.desktopPlanner.getDay(dateKey);
    return normalizeRecord(record ?? createEmptyDay(dateKey));
  }

  const days = readBrowserStore();
  return normalizeRecord(days[dateKey] ?? createEmptyDay(dateKey));
}

export async function loadDaysForMonth(
  monthKey: string,
): Promise<Record<string, DayRecord>> {
  if (hasSupabaseConfig()) {
    const days = await loadRemoteDaysForMonth(monthKey);
    return normalizeRecordMap(days ?? {});
  }

  if (typeof window !== "undefined" && window.desktopPlanner) {
    const days = await window.desktopPlanner.getDaysForMonth(monthKey);
    return normalizeRecordMap(days);
  }

  const days = readBrowserStore();
  return normalizeRecordMap(
    Object.fromEntries(
      Object.entries(days).filter(([dateKey]) =>
        dateKey.startsWith(`${monthKey}-`),
      ),
    ),
  );
}

export async function loadAllDays(): Promise<Record<string, DayRecord>> {
  if (hasSupabaseConfig()) {
    const days = await loadRemoteAllDays();
    return normalizeRecordMap(days ?? {});
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
    updatedAt: new Date().toISOString(),
  });

  if (hasSupabaseConfig()) {
    const saved = await saveRemoteDay(normalized);

    if (saved) {
      return normalizeRecord(saved);
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
    return normalizeSettings(await loadRemoteSettings());
  }

  if (typeof window !== "undefined" && window.desktopPlanner) {
    return normalizeSettings(await window.desktopPlanner.getSettings());
  }

  return readBrowserSettings();
}

export async function saveSettings(
  settings: PlannerSettings,
): Promise<PlannerSettings> {
  const normalized = normalizeSettings(settings);

  if (hasSupabaseConfig()) {
    const saved = await saveRemoteSettings(normalized);
    return normalizeSettings(saved);
  }

  if (typeof window !== "undefined" && window.desktopPlanner) {
    return normalizeSettings(
      await window.desktopPlanner.saveSettings(normalized),
    );
  }

  writeBrowserSettings(normalized);
  return normalized;
}

export async function saveDesktopBackup(
  snapshot: PlannerBackupSnapshot,
): Promise<boolean> {
  if (typeof window === "undefined" || !window.desktopPlanner?.saveBackup) {
    return false;
  }

  await window.desktopPlanner.saveBackup(snapshot);
  return true;
}

export async function openDesktopBackupFolder(): Promise<boolean> {
  if (
    typeof window === "undefined" ||
    !window.desktopPlanner?.openBackupFolder
  ) {
    return false;
  }

  await window.desktopPlanner.openBackupFolder();
  return true;
}

export async function selectDesktopBackup(): Promise<PlannerBackupSnapshot | null> {
  if (typeof window === "undefined" || !window.desktopPlanner?.selectBackup) {
    return null;
  }

  const snapshot = await window.desktopPlanner.selectBackup();
  return snapshot ? normalizeBackupSnapshot(snapshot) : null;
}

export async function restoreBackupSnapshot(
  snapshot: PlannerBackupSnapshot,
): Promise<void> {
  const normalized = normalizeBackupSnapshot(snapshot);

  if (hasSupabaseConfig()) {
    await replaceRemoteAllData(normalized);
    return;
  }

  if (typeof window !== "undefined" && window.desktopPlanner?.replaceData) {
    await window.desktopPlanner.replaceData(normalized);
    return;
  }

  writeBrowserStore(normalized.days);
  writeBrowserSettings(normalized.settings);
}
