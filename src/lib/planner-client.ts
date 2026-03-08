import type { DayEntry, DayRecord, PlannerSettings } from "./planner-types";

const STORAGE_KEY = "mi-calendario-days";
const SETTINGS_KEY = "mi-calendario-settings";
const DEFAULT_ASIGNADO_OPTIONS = ["Bea", "Cris", "Gloria", "Alfredo", "Yo"];

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
  if (typeof window !== "undefined" && window.desktopPlanner) {
    const record = await window.desktopPlanner.getDay(dateKey);
    return normalizeRecord(record ?? createEmptyDay(dateKey));
  }

  const days = readBrowserStore();
  return normalizeRecord(days[dateKey] ?? createEmptyDay(dateKey));
}

export async function loadDaysForMonth(monthKey: string): Promise<Record<string, DayRecord>> {
  if (typeof window !== "undefined" && window.desktopPlanner) {
    const days = await window.desktopPlanner.getDaysForMonth(monthKey);
    return Object.fromEntries(
      Object.entries(days).map(([dateKey, record]) => [dateKey, normalizeRecord(record)])
    );
  }

  const days = readBrowserStore();
  return Object.fromEntries(
    Object.entries(days)
      .filter(([dateKey]) => dateKey.startsWith(`${monthKey}-`))
      .map(([dateKey, record]) => [dateKey, normalizeRecord(record)])
  );
}

export async function loadAllDays(): Promise<Record<string, DayRecord>> {
  if (typeof window !== "undefined" && window.desktopPlanner) {
    const days = await window.desktopPlanner.getAllDays();
    return Object.fromEntries(
      Object.entries(days).map(([dateKey, record]) => [dateKey, normalizeRecord(record)])
    );
  }

  const days = readBrowserStore();
  return Object.fromEntries(
    Object.entries(days).map(([dateKey, record]) => [dateKey, normalizeRecord(record)])
  );
}

export async function saveDay(record: DayRecord): Promise<DayRecord> {
  const normalized = normalizeRecord({
    ...record,
    updatedAt: new Date().toISOString()
  });

  if (typeof window !== "undefined" && window.desktopPlanner) {
    return normalizeRecord(await window.desktopPlanner.saveDay(normalized));
  }

  const days = readBrowserStore();
  days[record.dateKey] = normalized;
  writeBrowserStore(days);
  return normalized;
}

export async function loadSettings(): Promise<PlannerSettings> {
  if (typeof window !== "undefined" && window.desktopPlanner) {
    return normalizeSettings(await window.desktopPlanner.getSettings());
  }

  return readBrowserSettings();
}

export async function saveSettings(settings: PlannerSettings): Promise<PlannerSettings> {
  const normalized = normalizeSettings(settings);

  if (typeof window !== "undefined" && window.desktopPlanner) {
    return normalizeSettings(await window.desktopPlanner.saveSettings(normalized));
  }

  writeBrowserSettings(normalized);
  return normalized;
}
