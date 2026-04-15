<script setup lang="ts">
import * as xlsxModule from "xlsx";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import LocalityAutocomplete from "./LocalityAutocomplete.vue";
import {
  detectStorageMode,
  hasSupabaseConfig,
  type StorageModeStatus,
} from "../lib/supabase-client";
import {
  createEmptyEntry,
  createEmptyDay,
  createDefaultPlannerSettings,
  DuplicateReferenceError,
  findDuplicateReferenceConflicts,
  loadAllDays,
  loadDay,
  loadDaysForMonth,
  loadSettings,
  normalizePlannerReference,
  openDesktopBackupFolder,
  replacePlannerDays,
  restoreBackupSnapshot,
  selectDesktopBackup,
  saveDesktopBackup,
  saveDay,
} from "../lib/planner-client";
import { SPANISH_LOCALITIES } from "../lib/spanish-municipalities";
import {
  ensurePlannerAuthInitialized,
  plannerAuthState,
} from "../lib/planner-auth";
import {
  dispatchPlannerSettingsUpdated,
  PLANNER_OPEN_IMPORT_DIALOG_EVENT,
  PLANNER_SETTINGS_UPDATED_EVENT,
} from "../lib/planner-ui-events";
import type {
  DayEntry,
  DayRecord,
  PlannerSettings,
} from "../lib/planner-types";

const AUTO_BACKUP_INTERVAL_MS = 30 * 60 * 1000;
const AUTO_BACKUP_DEBOUNCE_MS = 20 * 1000;
const NEW_ENTRY_SCROLL_TOP_OFFSET = 140;
const MONTH_CARD_PREVIEW_LIMIT = 6;
const IMPORT_TEMPLATE_FILE_NAME = "plantilla-informes.xlsx";

interface ImportPreviewRow {
  rowNumber: number;
  sourceDate: string;
  targetDate: string;
  referencia: string;
  localidad: string;
  observaciones: string;
  status: "ready" | "error";
  errors: string[];
  warnings: string[];
}

interface LocalityCatalogEntry {
  locality: string;
  fullToken: string;
  municipalityToken: string;
  fullCompactToken: string;
  municipalityCompactToken: string;
}

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatHeader(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`);
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getXlsxModule() {
  return xlsxModule;
}

const selectedDate = ref(todayKey());
const viewMode = ref<"day" | "month">("month");
const dayRecord = ref<DayRecord>(createEmptyDay(selectedDate.value));
const loading = ref(true);
const monthLoading = ref(true);
const savingState = ref<"idle" | "saving" | "saved" | "error">("idle");
const hydrating = ref(false);
const suppressAutoSave = ref(false);
const storageModeStatus = ref<StorageModeStatus>("checking");
const monthRecords = ref<Record<string, DayRecord>>({});
const allRecords = ref<Record<string, DayRecord>>({});
const persistedAllRecords = ref<Record<string, DayRecord>>({});
const plannerSettings = ref<PlannerSettings>(createDefaultPlannerSettings());
const asignadoOptions = ref<string[]>([]);
const referenceFilter = ref("");
const canOpenBackupFolder = ref(false);
const canRestoreBackup = ref(false);
const hasInitialized = ref(false);
const plannerLoadError = ref("");
const plannerDataLoadedForSession = ref(false);
const removeDialog = ref<{
  id: string;
  referencia: string;
  localidad: string;
} | null>(null);
const moveDialog = ref<{
  id: string;
  referencia: string;
  localidad: string;
  targetDate: string;
} | null>(null);
const moveDialogError = ref("");
const movingEntry = ref(false);
const importDialogOpen = ref(false);
const importRows = ref<ImportPreviewRow[]>([]);
const importFileName = ref("");
const importError = ref("");
const importSummary = ref("");
const importBusy = ref(false);
const unsavedDayDrafts = ref<Record<string, DayRecord>>({});
const isEditingTextField = ref(false);

let saveTimer: number | undefined;
let backupTimer: number | undefined;
let backupIntervalId: number | undefined;
let dayLoadRequest = 0;
let monthLoadRequest = 0;
let persistQueue = Promise.resolve();
let backupInFlight = false;
let backupQueued = false;
let pendingEntryId = "";
const entryRowElements = new Map<string, HTMLElement>();

const formattedTitle = computed(() => formatHeader(selectedDate.value));
const monthKey = computed(() => selectedDate.value.slice(0, 7));
const formattedMonthTitle = computed(() =>
  new Intl.DateTimeFormat("es-ES", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${monthKey.value}-01T12:00:00`)),
);
const monthActiveDays = computed(
  () =>
    Object.values(monthRecords.value).filter(
      (record) => record.entries.length > 0,
    ).length,
);
const monthEntryCount = computed(() =>
  Object.values(monthRecords.value).reduce(
    (total, record) => total + record.entries.length,
    0,
  ),
);
const monthDeliveredCount = computed(() =>
  Object.values(monthRecords.value).reduce(
    (total, record) =>
      total + record.entries.filter((entry) => entry.entregado).length,
    0,
  ),
);
const monthLastSavedLabel = computed(() => {
  const latest = Object.values(monthRecords.value)
    .map((record) => record.updatedAt)
    .sort()
    .at(-1);

  return latest ? formatTimestamp(latest) : "Sin cambios";
});
const isCurrentViewLoading = computed(() =>
  viewMode.value === "day" ? loading.value : monthLoading.value,
);
const monthCalendarCells = computed(() => {
  const [year, month] = monthKey.value.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1, 12, 0, 0);
  const totalDays = new Date(year, month, 0).getDate();
  const leadingEmptyCells = (firstDay.getDay() + 6) % 7;
  const cells: Array<null | {
    dateKey: string;
    day: number;
    isToday: boolean;
    record: DayRecord | null;
  }> = [];

  for (let index = 0; index < leadingEmptyCells; index += 1) {
    cells.push(null);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const dateKey = `${monthKey.value}-${String(day).padStart(2, "0")}`;
    cells.push({
      dateKey,
      day,
      isToday: dateKey === todayKey(),
      record: monthRecords.value[dateKey] ?? null,
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
});
const deliveredCount = computed(
  () => dayRecord.value.entries.filter((entry) => entry.entregado).length,
);
const planPendingCount = computed(
  () => dayRecord.value.entries.filter((entry) => entry.plano === "").length,
);
const occupiedRows = computed(
  () =>
    dayRecord.value.entries.filter((entry) => entry.asignado.trim().length > 0)
      .length,
);
const lastSavedLabel = computed(() =>
  formatTimestamp(dayRecord.value.updatedAt),
);
const isTodaySelected = computed(() => selectedDate.value === todayKey());
const canEditReports = computed(() => plannerAuthState.canEditReports.value);
const canManageApp = computed(() => plannerAuthState.canManageSettings.value);
const persistedReferenceConflicts = computed(() =>
  findDuplicateReferenceConflicts(persistedAllRecords.value),
);
const persistedDuplicateReferenceLabels = computed(() => {
  const labelsByNormalizedReference = new Map<string, string>();

  for (const conflict of persistedReferenceConflicts.value) {
    const referenceLabel =
      conflict.first.reference.trim() ||
      conflict.second.reference.trim() ||
      "Sin referencia";

    if (!labelsByNormalizedReference.has(conflict.normalizedReference)) {
      labelsByNormalizedReference.set(
        conflict.normalizedReference,
        referenceLabel,
      );
    }
  }

  return [...labelsByNormalizedReference.values()].sort((left, right) =>
    left.localeCompare(right, "es", { sensitivity: "base" }),
  );
});
const persistedDuplicateReferencesText = computed(() => {
  const duplicateReferences = persistedDuplicateReferenceLabels.value;

  if (duplicateReferences.length === 0) {
    return "";
  }

  if (duplicateReferences.length === 1) {
    return `Referencia duplicada: ${duplicateReferences[0]}.`;
  }

  return `Referencias duplicadas: ${duplicateReferences.join(", ")}.`;
});
const mergedRecordsForValidation = computed(() => ({
  ...allRecords.value,
  [dayRecord.value.dateKey]: cloneRecord(dayRecord.value),
}));
const activeReferenceConflicts = computed(() =>
  findDuplicateReferenceConflicts(allRecords.value),
);
const activeReferenceAlertMessages = computed(() => {
  const groupedConflicts = new Map<
    string,
    { reference: string; dates: Set<string> }
  >();

  for (const conflict of activeReferenceConflicts.value) {
    const currentGroup = groupedConflicts.get(conflict.normalizedReference) ?? {
      reference: conflict.first.reference || conflict.second.reference,
      dates: new Set<string>(),
    };

    currentGroup.dates.add(conflict.first.dateKey);
    currentGroup.dates.add(conflict.second.dateKey);
    groupedConflicts.set(conflict.normalizedReference, currentGroup);
  }

  return [...groupedConflicts.values()].map(({ reference, dates }) => {
    const sortedDates = [...dates].sort((left, right) =>
      left.localeCompare(right),
    );

    if (sortedDates.length === 1) {
      return `La referencia ${reference} está repetida en el día ${sortedDates[0]}.`;
    }

    return `La referencia ${reference} está duplicada en los días ${sortedDates.join(", ")}.`;
  });
});
const activeReferenceConflictSummary = computed(() => {
  const conflictCount = activeReferenceAlertMessages.value.length;

  if (conflictCount === 0) {
    return "";
  }

  if (conflictCount === 1) {
    return activeReferenceAlertMessages.value[0] ?? "";
  }

  return `Hay ${conflictCount} referencias duplicadas activas.`;
});
const hasActiveReferenceConflictAlerts = computed(
  () => activeReferenceAlertMessages.value.length > 0,
);
const currentDayReferenceErrors = computed(() => {
  const errors = new Map<string, string>();
  const conflicts = activeReferenceConflicts.value;

  for (const conflict of conflicts) {
    if (conflict.first.dateKey === dayRecord.value.dateKey) {
      errors.set(
        conflict.first.entryId,
        conflict.second.dateKey === dayRecord.value.dateKey
          ? `La referencia ${conflict.first.reference} ya está repetida en este día.`
          : `La referencia ${conflict.first.reference} ya existe el día ${conflict.second.dateKey}.`,
      );
    }

    if (conflict.second.dateKey === dayRecord.value.dateKey) {
      errors.set(
        conflict.second.entryId,
        conflict.first.dateKey === dayRecord.value.dateKey
          ? `La referencia ${conflict.second.reference} ya está repetida en este día.`
          : `La referencia ${conflict.second.reference} ya existe el día ${conflict.first.dateKey}.`,
      );
    }
  }

  return errors;
});
const currentDayReferenceAlertMessages = computed(() => [
  ...new Set(currentDayReferenceErrors.value.values()),
]);
const hasDayReferenceConflicts = computed(
  () => currentDayReferenceErrors.value.size > 0,
);
const visiblePlannerLoadError = computed(() => {
  const nextMessage = plannerLoadError.value.trim();

  if (!nextMessage) {
    return "";
  }

  if (
    currentDayReferenceAlertMessages.value.includes(nextMessage) ||
    activeReferenceAlertMessages.value.includes(nextMessage)
  ) {
    return "";
  }

  return nextMessage;
});
const readyImportRows = computed(() =>
  importRows.value.filter((row) => row.status === "ready"),
);
const canCleanPersistedDuplicates = computed(
  () => canEditReports.value && persistedReferenceConflicts.value.length > 0,
);
const savingStateLabel = computed(() => {
  if (savingState.value === "saving") {
    return "Guardando...";
  }

  if (savingState.value === "saved") {
    return "Guardado";
  }

  if (savingState.value === "error") {
    return "Error al guardar";
  }

  return "Listo";
});
const storageModeLabel = computed(() => {
  if (storageModeStatus.value === "supabase") {
    return "Supabase";
  }

  if (storageModeStatus.value === "missing-config") {
    return "Sin configurar";
  }

  if (storageModeStatus.value === "error") {
    return "Error de conexion";
  }

  if (storageModeStatus.value === "checking") {
    return "Comprobando conexion";
  }

  return "Local";
});
const storageCaption = computed(() => {
  if (storageModeStatus.value === "supabase") {
    return "Datos sincronizados con Supabase";
  }

  if (storageModeStatus.value === "missing-config") {
    return "Esta build no incluye la configuracion de Supabase. Los datos se guardan solo en este dispositivo.";
  }

  if (storageModeStatus.value === "error") {
    return "No se pudo conectar con Supabase. Revisa la configuracion.";
  }

  if (storageModeStatus.value === "checking") {
    return "Comprobando el estado de la conexion...";
  }

  return "Datos guardados solo en este dispositivo";
});
const normalizedReferenceFilter = computed(() =>
  referenceFilter.value.trim().toLocaleLowerCase("es-ES"),
);
const hasReferenceSearch = computed(
  () => normalizedReferenceFilter.value.length > 0,
);
const filteredReferenceResults = computed(() => {
  if (!normalizedReferenceFilter.value) {
    return [];
  }

  return Object.values(allRecords.value)
    .flatMap((record) =>
      record.entries
        .filter((entry) =>
          entry.referencia
            .trim()
            .toLocaleLowerCase("es-ES")
            .includes(normalizedReferenceFilter.value),
        )
        .map((entry) => ({
          id: entry.id,
          dateKey: record.dateKey,
          referencia: entry.referencia.trim() || "Sin referencia",
          asignado: entry.asignado.trim() || "Sin asignar",
          plano:
            entry.plano === "si"
              ? "Si"
              : entry.plano === "no"
                ? "No"
                : "Pendiente",
          localidad: entry.localidad.trim() || "Sin localidad",
          entregado: entry.entregado ? "Si" : "No",
        })),
    )
    .sort((left, right) => right.dateKey.localeCompare(left.dateKey));
});

function getAsignadoSelectOptions(currentValue: string) {
  if (!currentValue || asignadoOptions.value.includes(currentValue)) {
    return asignadoOptions.value;
  }

  return [currentValue, ...asignadoOptions.value];
}

function getEntryReferenceError(entryId: string) {
  return currentDayReferenceErrors.value.get(entryId) ?? "";
}

function normalizeLocalityToken(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-ES")
    .replace(/["'`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactLocalityToken(value: string) {
  return value.replace(/\s+/g, "");
}

const LOCALITY_LEADING_ARTICLES = new Set(["el", "la", "los", "las", "l"]);

function buildLocalityTokenVariants(token: string) {
  if (!token) {
    return [];
  }

  const variants = new Set<string>([token]);
  const parts = token.split(" ").filter((value) => value.length > 0);

  if (parts.length > 1) {
    const firstWord = parts[0];
    const lastWord = parts[parts.length - 1];

    if (LOCALITY_LEADING_ARTICLES.has(firstWord)) {
      variants.add([...parts.slice(1), firstWord].join(" "));
    }

    if (LOCALITY_LEADING_ARTICLES.has(lastWord)) {
      variants.add([lastWord, ...parts.slice(0, -1)].join(" "));
    }
  }

  return [...variants];
}

function buildLocalityTokenVariantsFromRawValue(rawValue: string) {
  const trimmedValue = String(rawValue ?? "").trim();

  if (!trimmedValue) {
    return [];
  }

  const match = trimmedValue.match(/^(.*?)\s*(?:\(([^()]*)\))?$/);
  const municipalityRaw = (match?.[1] ?? trimmedValue).trim();
  const provinceRaw = (match?.[2] ?? "").trim();
  const municipalityToken = normalizeLocalityToken(municipalityRaw);
  const provinceToken = normalizeLocalityToken(provinceRaw);
  const variants = new Set<string>();

  if (!municipalityToken && provinceToken) {
    variants.add(provinceToken);
  }

  for (const municipalityVariant of buildLocalityTokenVariants(
    municipalityToken,
  )) {
    if (!provinceToken) {
      variants.add(municipalityVariant);
      continue;
    }

    variants.add(`${municipalityVariant} ${provinceToken}`.trim());
  }

  variants.add(normalizeLocalityToken(trimmedValue));

  return [...variants].filter((value) => value.length > 0);
}

function setUniqueLocalityLookup(
  lookup: Map<string, string>,
  token: string,
  locality: string,
) {
  if (!token) {
    return;
  }

  const existing = lookup.get(token);

  if (!existing) {
    lookup.set(token, locality);
    return;
  }

  if (existing !== locality) {
    lookup.set(token, "");
  }
}

const LOCALITY_CATALOG: LocalityCatalogEntry[] = SPANISH_LOCALITIES.map(
  (locality) => {
    const municipalityName = locality.replace(/\s+\([^()]+\)\s*$/, "");
    const fullToken = normalizeLocalityToken(locality);
    const municipalityToken = normalizeLocalityToken(municipalityName);

    return {
      locality,
      fullToken,
      municipalityToken,
      fullCompactToken: compactLocalityToken(fullToken),
      municipalityCompactToken: compactLocalityToken(municipalityToken),
    };
  },
);

const LOCALITY_BY_FULL_TOKEN = new Map<string, string>();
const LOCALITY_BY_MUNICIPALITY_TOKEN = new Map<string, string>();
const LOCALITY_BY_FULL_COMPACT_TOKEN = new Map<string, string>();
const LOCALITY_BY_MUNICIPALITY_COMPACT_TOKEN = new Map<string, string>();

for (const locality of LOCALITY_CATALOG) {
  const hasProvinceSuffix = /\([^()]+\)\s*$/.test(locality.locality);

  for (const fullTokenVariant of buildLocalityTokenVariantsFromRawValue(
    locality.locality,
  )) {
    setUniqueLocalityLookup(
      LOCALITY_BY_FULL_TOKEN,
      fullTokenVariant,
      locality.locality,
    );
    setUniqueLocalityLookup(
      LOCALITY_BY_FULL_COMPACT_TOKEN,
      compactLocalityToken(fullTokenVariant),
      locality.locality,
    );
  }

  if (!hasProvinceSuffix) {
    continue;
  }

  const municipalityName = locality.locality.replace(/\s+\([^()]+\)\s*$/, "");

  for (const municipalityTokenVariant of buildLocalityTokenVariantsFromRawValue(
    municipalityName,
  )) {
    setUniqueLocalityLookup(
      LOCALITY_BY_MUNICIPALITY_TOKEN,
      municipalityTokenVariant,
      locality.locality,
    );
    setUniqueLocalityLookup(
      LOCALITY_BY_MUNICIPALITY_COMPACT_TOKEN,
      compactLocalityToken(municipalityTokenVariant),
      locality.locality,
    );
  }
}

function getUniqueLocalityMatch(lookup: Map<string, string>, token: string) {
  const match = lookup.get(token);
  return match && match.length > 0 ? match : "";
}

function levenshteinDistanceWithinMax(
  left: string,
  right: string,
  maxDistance: number,
) {
  const leftLength = left.length;
  const rightLength = right.length;

  if (Math.abs(leftLength - rightLength) > maxDistance) {
    return null;
  }

  const previous = Array.from({ length: rightLength + 1 }, (_, index) => index);
  const current = new Array<number>(rightLength + 1);

  for (let leftIndex = 1; leftIndex <= leftLength; leftIndex += 1) {
    current[0] = leftIndex;
    let rowMin = current[0];

    for (let rightIndex = 1; rightIndex <= rightLength; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const insertion = current[rightIndex - 1] + 1;
      const deletion = previous[rightIndex] + 1;
      const substitution = previous[rightIndex - 1] + substitutionCost;
      const distance = Math.min(insertion, deletion, substitution);

      current[rightIndex] = distance;

      if (distance < rowMin) {
        rowMin = distance;
      }
    }

    if (rowMin > maxDistance) {
      return null;
    }

    for (let index = 0; index <= rightLength; index += 1) {
      previous[index] = current[index];
    }
  }

  const finalDistance = previous[rightLength];
  return finalDistance <= maxDistance ? finalDistance : null;
}

function findFuzzyLocalityMatch(localityCompactToken: string) {
  if (localityCompactToken.length < 4) {
    return "";
  }

  const maxDistance = 2;
  const firstCharacter = localityCompactToken[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestLocality = "";
  let isAmbiguous = false;

  for (const locality of LOCALITY_CATALOG) {
    const candidateToken = locality.municipalityCompactToken;

    if (!candidateToken || candidateToken[0] !== firstCharacter) {
      continue;
    }

    const distance = levenshteinDistanceWithinMax(
      localityCompactToken,
      candidateToken,
      maxDistance,
    );

    if (distance === null) {
      continue;
    }

    if (distance < bestDistance) {
      bestDistance = distance;
      bestLocality = locality.locality;
      isAmbiguous = false;
      continue;
    }

    if (distance === bestDistance && locality.locality !== bestLocality) {
      isAmbiguous = true;
    }
  }

  return bestDistance <= maxDistance && !isAmbiguous ? bestLocality : "";
}

function resolveImportedLocality(rawValue: unknown) {
  const originalValue = String(rawValue ?? "").trim();

  if (!originalValue) {
    return {
      locality: "",
      originalValue,
      wasCorrected: false,
      error: "Falta la localidad.",
    };
  }

  const localityTokenVariants =
    buildLocalityTokenVariantsFromRawValue(originalValue);
  const localityCompactTokenVariants = [
    ...new Set(
      localityTokenVariants.map((variant) => compactLocalityToken(variant)),
    ),
  ];

  const directMatch =
    localityTokenVariants
      .map((variant) => getUniqueLocalityMatch(LOCALITY_BY_FULL_TOKEN, variant))
      .find((match) => match.length > 0) ||
    localityTokenVariants
      .map((variant) =>
        getUniqueLocalityMatch(LOCALITY_BY_MUNICIPALITY_TOKEN, variant),
      )
      .find((match) => match.length > 0) ||
    localityCompactTokenVariants
      .map((variant) =>
        getUniqueLocalityMatch(LOCALITY_BY_FULL_COMPACT_TOKEN, variant),
      )
      .find((match) => match.length > 0) ||
    localityCompactTokenVariants
      .map((variant) =>
        getUniqueLocalityMatch(LOCALITY_BY_MUNICIPALITY_COMPACT_TOKEN, variant),
      )
      .find((match) => match.length > 0);

  if (directMatch) {
    return {
      locality: directMatch,
      originalValue,
      wasCorrected:
        normalizeLocalityToken(directMatch) !==
        normalizeLocalityToken(originalValue),
      error: "",
    };
  }

  const fuzzyMatch = localityCompactTokenVariants
    .map((variant) => findFuzzyLocalityMatch(variant))
    .find((match) => match.length > 0);

  if (fuzzyMatch) {
    return {
      locality: fuzzyMatch,
      originalValue,
      wasCorrected: true,
      error: "",
    };
  }

  return {
    locality: originalValue,
    originalValue,
    wasCorrected: false,
    error: `La localidad \"${originalValue}\" no existe en el catálogo oficial.`,
  };
}

function normalizeHeaderLabel(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("es-ES")
    .replace(/\s+/g, "");
}

function formatDateKeyFromParts(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseStrictDateKey(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month - 1, day, 12, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function parseImportDateValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateKeyFromParts(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate(),
    );
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = getXlsxModule().SSF.parse_date_code(value);

    if (parsed) {
      return formatDateKeyFromParts(parsed.y, parsed.m, parsed.d);
    }
  }

  const trimmed = String(value ?? "").trim();

  if (!trimmed) {
    return "";
  }

  const isoParts = parseStrictDateKey(trimmed);

  if (isoParts) {
    return formatDateKeyFromParts(isoParts.year, isoParts.month, isoParts.day);
  }

  const europeanMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (europeanMatch) {
    return formatDateKeyFromParts(
      Number.parseInt(europeanMatch[3], 10),
      Number.parseInt(europeanMatch[2], 10),
      Number.parseInt(europeanMatch[1], 10),
    );
  }

  return trimmed;
}

function addMonthsClamped(dateKey: string, monthsToAdd: number) {
  const parts = parseStrictDateKey(dateKey);

  if (!parts) {
    return "";
  }

  const targetMonthIndex = parts.month - 1 + monthsToAdd;
  const targetYear = parts.year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(
    targetYear,
    normalizedMonthIndex + 1,
    0,
    12,
    0,
    0,
  ).getDate();
  const targetDay = Math.min(parts.day, lastDayOfTargetMonth);

  return formatDateKeyFromParts(
    targetYear,
    normalizedMonthIndex + 1,
    targetDay,
  );
}

function triggerBrowserDownload(fileName: string, blob: Blob) {
  if (typeof window === "undefined") {
    return;
  }

  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
  }, 1000);
}

function downloadImportTemplate() {
  const workbook = getXlsxModule().utils.book_new();
  const worksheet = getXlsxModule().utils.aoa_to_sheet([
    ["fecha", "referencia", "localidad", "observaciones"],
    ["2026-04-15", "INF-001", "Madrid", "Visita inicial"],
    ["2026-04-20", "INF-002", "Toledo", "Pendiente de revisar acceso"],
    ["2026-05-03", "INF-003", "Segovia", "Comprobar documentacion"],
  ]);

  getXlsxModule().utils.book_append_sheet(workbook, worksheet, "Informes");

  const workbookData = getXlsxModule().write(workbook, {
    bookType: "xlsx",
    type: "array",
  });

  triggerBrowserDownload(
    IMPORT_TEMPLATE_FILE_NAME,
    new Blob([workbookData], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
}

function openImportDialog() {
  if (!canEditReports.value) {
    return;
  }

  importDialogOpen.value = true;
  importRows.value = [];
  importFileName.value = "";
  importError.value = "";
  importSummary.value = "";
}

function handleOpenImportDialog() {
  openImportDialog();
}

function closeImportDialog() {
  if (importBusy.value) {
    return;
  }

  importDialogOpen.value = false;
  importRows.value = [];
  importFileName.value = "";
  importError.value = "";
  importSummary.value = "";
}

async function handleImportFileSelection(event: Event) {
  const input = event.target;

  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const [file] = Array.from(input.files ?? []);
  input.value = "";

  if (!file) {
    return;
  }

  importBusy.value = true;
  importError.value = "";
  importSummary.value = "";
  importRows.value = [];
  importFileName.value = file.name;

  try {
    const workbook = getXlsxModule().read(await file.arrayBuffer(), {
      type: "array",
      cellDates: true,
    });
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = firstSheetName
      ? workbook.Sheets[firstSheetName]
      : undefined;

    if (!firstSheet) {
      throw new Error("El Excel no contiene ninguna hoja.");
    }

    const sheetRows = getXlsxModule().utils.sheet_to_json<unknown[]>(
      firstSheet,
      {
        header: 1,
        raw: true,
        defval: "",
      },
    );
    const [rawHeaders, ...rawDataRows] = sheetRows;

    if (!Array.isArray(rawHeaders) || rawHeaders.length === 0) {
      throw new Error("La primera fila del Excel debe contener las cabeceras.");
    }

    const headerIndex = new Map<string, number>();

    rawHeaders.forEach((headerValue, index) => {
      const normalizedHeader = normalizeHeaderLabel(headerValue);

      if (normalizedHeader) {
        headerIndex.set(normalizedHeader, index);
      }
    });

    const requiredHeaders = [
      "fecha",
      "referencia",
      "localidad",
      "observaciones",
    ];
    const missingHeaders = requiredHeaders.filter(
      (header) => !headerIndex.has(header),
    );

    if (missingHeaders.length > 0) {
      throw new Error(
        `Faltan columnas obligatorias: ${missingHeaders.join(", ")}.`,
      );
    }

    const existingReferenceMap = new Map<
      string,
      { dateKey: string; entryId: string; reference: string }
    >();

    Object.values(mergedRecordsForValidation.value).forEach((record) => {
      record.entries.forEach((entry) => {
        const normalizedReference = normalizePlannerReference(entry.referencia);

        if (!normalizedReference) {
          return;
        }

        existingReferenceMap.set(normalizedReference, {
          dateKey: record.dateKey,
          entryId: entry.id,
          reference: entry.referencia.trim(),
        });
      });
    });

    const importedReferenceMap = new Map<string, number>();
    const previewRows: ImportPreviewRow[] = rawDataRows
      .map((row, index) => ({ row, rowNumber: index + 2 }))
      .filter(({ row }) =>
        Array.isArray(row)
          ? row.some((cell) => String(cell ?? "").trim().length > 0)
          : false,
      )
      .map(({ row, rowNumber }) => {
        const rawSourceDate = Array.isArray(row)
          ? row[headerIndex.get("fecha") ?? -1]
          : "";
        const rawReference = Array.isArray(row)
          ? row[headerIndex.get("referencia") ?? -1]
          : "";
        const rawLocality = Array.isArray(row)
          ? row[headerIndex.get("localidad") ?? -1]
          : "";
        const rawObservations = Array.isArray(row)
          ? row[headerIndex.get("observaciones") ?? -1]
          : "";
        const sourceDate = parseImportDateValue(rawSourceDate);
        const targetDate = addMonthsClamped(sourceDate, 2);
        const referencia = String(rawReference ?? "").trim();
        const normalizedReference = normalizePlannerReference(referencia);
        const localityResolution = resolveImportedLocality(rawLocality);
        let localidad = localityResolution.locality;
        let observaciones = String(rawObservations ?? "").trim();
        const errors: string[] = [];
        const blockingErrors: string[] = [];
        const warnings: string[] = [];

        if (!sourceDate) {
          const message = "Falta la fecha.";
          errors.push(message);
          blockingErrors.push(message);
        } else if (!parseStrictDateKey(sourceDate)) {
          const message = "Fecha invalida. Usa YYYY-MM-DD.";
          errors.push(message);
          blockingErrors.push(message);
        }

        if (!referencia) {
          const message = "Falta la referencia.";
          errors.push(message);
          blockingErrors.push(message);
        }

        if (normalizedReference) {
          const existingReference =
            existingReferenceMap.get(normalizedReference);

          if (existingReference) {
            const message = `La referencia ya existe el día ${existingReference.dateKey}.`;
            errors.push(message);
            blockingErrors.push(message);
          }

          const importedRowNumber =
            importedReferenceMap.get(normalizedReference);

          if (typeof importedRowNumber === "number") {
            const message = `La referencia ya aparece en la fila ${importedRowNumber}.`;
            errors.push(message);
            blockingErrors.push(message);
          } else {
            importedReferenceMap.set(normalizedReference, rowNumber);
          }
        }

        if (localityResolution.error) {
          const localityError = `${localityResolution.error}.`;
          errors.push(localityError);
          localidad = "";
          observaciones = [observaciones, localityError]
            .filter((value) => value.trim().length > 0)
            .join(" | ");
        } else if (localityResolution.wasCorrected) {
          warnings.push(
            `Localidad corregida automaticamente: ${localityResolution.originalValue} -> ${localidad}.`,
          );
        }

        return {
          rowNumber,
          sourceDate,
          targetDate,
          referencia,
          localidad,
          observaciones,
          status: blockingErrors.length > 0 ? "error" : "ready",
          errors,
          warnings,
        };
      });

    if (previewRows.length === 0) {
      throw new Error("El Excel no contiene filas con datos.");
    }

    importRows.value = previewRows;
    importSummary.value = `${previewRows.filter((row) => row.status === "ready").length} filas listas y ${previewRows.filter((row) => row.status === "error").length} con error.`;
  } catch (error) {
    console.error("No se pudo preparar la importacion.", error);
    importError.value =
      error instanceof Error
        ? error.message
        : "No se pudo leer el archivo seleccionado.";
  } finally {
    importBusy.value = false;
  }
}

async function confirmExcelImport() {
  if (
    !canEditReports.value ||
    importBusy.value ||
    readyImportRows.value.length === 0
  ) {
    return;
  }

  importBusy.value = true;
  importError.value = "";

  try {
    await flushPendingDaySave();

    const recordsToSave = new Map<string, DayRecord>();

    for (const row of readyImportRows.value) {
      const existingRecord =
        recordsToSave.get(row.targetDate) ??
        cloneRecord(
          allRecords.value[row.targetDate] ?? createEmptyDay(row.targetDate),
        );
      const nextEntry = createEmptyEntry();

      nextEntry.referencia = row.referencia;
      nextEntry.localidad = row.localidad;
      nextEntry.observaciones = row.observaciones;

      existingRecord.entries.push(nextEntry);
      recordsToSave.set(row.targetDate, existingRecord);
    }

    for (const record of recordsToSave.values()) {
      await saveDay(record);
    }

    await Promise.all([
      loadAllRecords(),
      loadSelectedMonth(),
      loadSelectedDay(),
    ]);
    savingState.value = "saved";
    queueDesktopBackup("excel-import");
    window.alert(
      `Se han importado ${readyImportRows.value.length} informes desde ${importFileName.value}.`,
    );
    closeImportDialog();
  } catch (error) {
    console.error("No se pudo completar la importacion.", error);
    savingState.value = "error";
    importError.value =
      error instanceof DuplicateReferenceError
        ? error.message
        : error instanceof Error
          ? error.message
          : "No se pudo completar la importacion.";
  } finally {
    importBusy.value = false;
  }
}

async function cleanPersistedDuplicateReferences() {
  if (!canCleanPersistedDuplicates.value) {
    return;
  }

  const confirmed = window.confirm(
    `Se eliminaran ${persistedReferenceConflicts.value.length} duplicados ya guardados, conservando la aparicion mas reciente por fecha. ¿Quieres continuar?`,
  );

  if (!confirmed) {
    return;
  }

  savingState.value = "saving";
  plannerLoadError.value = "";

  try {
    const refreshedDays = await loadAllDays();
    const cleanedDays = Object.fromEntries(
      Object.entries(refreshedDays).map(([dateKey, record]) => [
        dateKey,
        cloneRecord(record),
      ]),
    );
    const entriesByReference = new Map<
      string,
      Array<{
        dateKey: string;
        entryId: string;
        entryIndex: number;
        updatedAt: string;
      }>
    >();

    for (const [dateKey, record] of Object.entries(cleanedDays)) {
      for (const [entryIndex, entry] of record.entries.entries()) {
        const normalizedReference = normalizePlannerReference(entry.referencia);

        if (!normalizedReference) {
          continue;
        }

        const currentEntries =
          entriesByReference.get(normalizedReference) ?? [];
        currentEntries.push({
          dateKey,
          entryId: entry.id,
          entryIndex,
          updatedAt: record.updatedAt,
        });
        entriesByReference.set(normalizedReference, currentEntries);
      }
    }

    const entriesToRemoveByDate = new Map<string, Set<string>>();

    for (const entries of entriesByReference.values()) {
      if (entries.length < 2) {
        continue;
      }

      const sortedEntries = [...entries].sort((left, right) => {
        const dateComparison = left.dateKey.localeCompare(right.dateKey);

        if (dateComparison !== 0) {
          return dateComparison;
        }

        const updatedAtComparison = left.updatedAt.localeCompare(
          right.updatedAt,
        );

        if (updatedAtComparison !== 0) {
          return updatedAtComparison;
        }

        return left.entryIndex - right.entryIndex;
      });

      for (const duplicatedEntry of sortedEntries.slice(0, -1)) {
        const entrySet =
          entriesToRemoveByDate.get(duplicatedEntry.dateKey) ??
          new Set<string>();
        entrySet.add(duplicatedEntry.entryId);
        entriesToRemoveByDate.set(duplicatedEntry.dateKey, entrySet);
      }
    }

    let removedDuplicatesCount = 0;

    for (const [dateKey, entryIds] of entriesToRemoveByDate.entries()) {
      const affectedRecord = cleanedDays[dateKey];

      if (!affectedRecord) {
        continue;
      }

      const previousLength = affectedRecord.entries.length;
      affectedRecord.entries = affectedRecord.entries.filter(
        (entry) => !entryIds.has(entry.id),
      );
      removedDuplicatesCount += previousLength - affectedRecord.entries.length;
    }

    await replacePlannerDays(cleanedDays);
    unsavedDayDrafts.value = {};

    await Promise.all([
      loadAllRecords(),
      loadSelectedMonth(),
      loadSelectedDay(),
    ]);
    savingState.value = "saved";
    queueDesktopBackup("duplicate-cleanup");
    window.alert(
      `Se han eliminado ${removedDuplicatesCount} duplicados guardados en la agenda.`,
    );
    window.location.reload();
  } catch (error) {
    console.error("No se pudieron limpiar los duplicados guardados.", error);
    savingState.value = "error";
    plannerLoadError.value =
      error instanceof Error
        ? error.message
        : "No se pudieron limpiar los duplicados guardados.";
  }
}

function applyPlannerSettings(settings: PlannerSettings) {
  plannerSettings.value = settings;
  asignadoOptions.value = settings.asignadoOptions;
  dispatchPlannerSettingsUpdated(settings);
}

function cloneRecord(record: DayRecord): DayRecord {
  return {
    ...record,
    entries: record.entries.map((entry) => ({ ...entry })),
  };
}

function overlayUnsavedDrafts(days: Record<string, DayRecord>) {
  return {
    ...days,
    ...Object.fromEntries(
      Object.entries(unsavedDayDrafts.value).map(([dateKey, record]) => [
        dateKey,
        cloneRecord(record),
      ]),
    ),
  };
}

function setUnsavedDayDraft(record: DayRecord) {
  unsavedDayDrafts.value = {
    ...unsavedDayDrafts.value,
    [record.dateKey]: cloneRecord(record),
  };
}

function clearUnsavedDayDraft(dateKey: string) {
  if (!(dateKey in unsavedDayDrafts.value)) {
    return;
  }

  const nextDrafts = { ...unsavedDayDrafts.value };
  delete nextDrafts[dateKey];
  unsavedDayDrafts.value = nextDrafts;
}

function handleTextFieldFocus() {
  isEditingTextField.value = true;
}

function handleTextFieldBlur() {
  isEditingTextField.value = false;
  queueSave();
}

function syncMonthRecord(record: DayRecord) {
  if (!record.dateKey.startsWith(`${monthKey.value}-`)) {
    return;
  }

  monthRecords.value = {
    ...monthRecords.value,
    [record.dateKey]: cloneRecord(record),
  };
}

function syncAllRecordsRecord(record: DayRecord) {
  allRecords.value = {
    ...allRecords.value,
    [record.dateKey]: cloneRecord(record),
  };
}

async function applyLoadedDayRecord(record: DayRecord) {
  suppressAutoSave.value = true;
  dayRecord.value = record;
  syncMonthRecord(record);
  syncAllRecordsRecord(record);
  await nextTick();

  if (pendingEntryId) {
    const hasTargetEntry = record.entries.some(
      (entry) => entry.id === pendingEntryId,
    );

    if (hasTargetEntry) {
      scrollToEntry(pendingEntryId);
      focusEntryField(pendingEntryId);
    }

    pendingEntryId = "";
  }

  suppressAutoSave.value = false;
}

async function persistDay() {
  const snapshotToSave = cloneRecord(dayRecord.value);
  savingState.value = "saving";

  const runPersist = async () => {
    const savedRecord = await saveDay(snapshotToSave);
    const refreshedAllDays = await loadAllDays();

    persistedAllRecords.value = refreshedAllDays;
    clearUnsavedDayDraft(snapshotToSave.dateKey);
    allRecords.value = overlayUnsavedDrafts(refreshedAllDays);

    if (dayRecord.value.dateKey !== snapshotToSave.dateKey) {
      syncAllRecordsRecord(savedRecord);
      syncMonthRecord(savedRecord);
      return;
    }

    await applyLoadedDayRecord(savedRecord);
    savingState.value = "saved";
    plannerLoadError.value = "";
    queueDesktopBackup("day-save");
  };

  persistQueue = persistQueue
    .catch(() => {
      // Keep the queue alive after a previous failed save.
    })
    .then(runPersist);

  try {
    await persistQueue;
  } catch (error) {
    console.error(error);
    setUnsavedDayDraft(snapshotToSave);
    savingState.value = "error";
    plannerLoadError.value =
      error instanceof DuplicateReferenceError
        ? error.message
        : "No se pudo guardar el día seleccionado.";
  }
}

function queueSave() {
  if (hydrating.value) {
    return;
  }

  setUnsavedDayDraft(dayRecord.value);

  if (isEditingTextField.value) {
    return;
  }

  if (saveTimer) {
    window.clearTimeout(saveTimer);
  }

  saveTimer = window.setTimeout(() => {
    void persistDay();
  }, 350);
}

async function loadSelectedDay(dateKey = selectedDate.value) {
  const requestId = ++dayLoadRequest;
  loading.value = true;
  hydrating.value = true;

  try {
    const record = unsavedDayDrafts.value[dateKey] ?? (await loadDay(dateKey));

    if (requestId !== dayLoadRequest) {
      return;
    }

    await applyLoadedDayRecord(record);
    savingState.value = "idle";
    plannerLoadError.value = "";
  } catch (error) {
    if (requestId === dayLoadRequest) {
      console.error("No se pudo cargar el día seleccionado.", error);
      plannerLoadError.value = "No se pudo cargar el día seleccionado.";
    }
  } finally {
    if (requestId === dayLoadRequest) {
      hydrating.value = false;
      loading.value = false;
    }
  }
}

async function loadSelectedMonth(targetMonthKey = monthKey.value) {
  const requestId = ++monthLoadRequest;
  monthLoading.value = true;

  try {
    const records = overlayUnsavedDrafts(
      await loadDaysForMonth(targetMonthKey),
    );

    if (requestId !== monthLoadRequest) {
      return;
    }

    monthRecords.value = records;
    savingState.value = "idle";
    plannerLoadError.value = "";
  } catch (error) {
    if (requestId === monthLoadRequest) {
      console.error("No se pudo cargar la vista mensual.", error);
      plannerLoadError.value = "No se pudo cargar la vista mensual.";
    }
  } finally {
    if (requestId === monthLoadRequest) {
      monthLoading.value = false;
    }
  }
}

async function loadAllRecords() {
  try {
    const days = await loadAllDays();
    persistedAllRecords.value = days;
    allRecords.value = overlayUnsavedDrafts(days);
    plannerLoadError.value = "";
  } catch (error) {
    console.error(error);
    plannerLoadError.value = "No se pudieron cargar los informes guardados.";
    throw error;
  }
}

async function runDesktopBackup(reason: string) {
  if (
    !canManageApp.value ||
    typeof window === "undefined" ||
    !window.desktopPlanner?.saveBackup
  ) {
    return;
  }

  if (backupInFlight) {
    backupQueued = true;
    return;
  }

  backupInFlight = true;

  try {
    const [days, settings] = await Promise.all([loadAllDays(), loadSettings()]);
    await saveDesktopBackup({
      createdAt: new Date().toISOString(),
      storageMode: storageModeStatus.value,
      days,
      settings,
    });
    console.info("[backup] completed", reason);
  } catch (error) {
    console.error("No se pudo generar el backup automatico.", error);
  } finally {
    backupInFlight = false;

    if (backupQueued) {
      backupQueued = false;
      void runDesktopBackup("queued");
    }
  }
}

function queueDesktopBackup(reason: string) {
  if (typeof window === "undefined" || !window.desktopPlanner?.saveBackup) {
    return;
  }

  if (backupTimer) {
    window.clearTimeout(backupTimer);
  }

  backupTimer = window.setTimeout(() => {
    backupTimer = undefined;
    void runDesktopBackup(reason);
  }, AUTO_BACKUP_DEBOUNCE_MS);
}

const backupLinkLabel = computed(() =>
  canOpenBackupFolder.value
    ? "Abrir carpeta de backups"
    : "Backups: sólo en la app de escritorio",
);

const restoreLinkLabel = computed(() =>
  canRestoreBackup.value
    ? "Restaurar copia de seguridad"
    : "Restaurar: sólo en la app de escritorio",
);

async function openBackupFolder() {
  if (!canManageApp.value || !canOpenBackupFolder.value) {
    return;
  }

  try {
    await openDesktopBackupFolder();
  } catch (error) {
    console.error("No se pudo abrir la carpeta de backups.", error);
  }
}

async function restoreBackup() {
  if (!canManageApp.value || !canRestoreBackup.value) {
    return;
  }

  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
  }

  if (backupTimer) {
    window.clearTimeout(backupTimer);
    backupTimer = undefined;
  }

  const confirmed = window.confirm(
    "Se reemplazaran los datos actuales por la copia seleccionada. Antes de continuar se guardara un backup del estado actual. Quieres seguir?",
  );

  if (!confirmed) {
    return;
  }

  savingState.value = "saving";

  try {
    await runDesktopBackup("pre-restore");
    const snapshot = await selectDesktopBackup();

    if (!snapshot) {
      savingState.value = "idle";
      return;
    }

    await restoreBackupSnapshot(snapshot);
    await Promise.all([
      refreshStorageMode(),
      loadAllRecords(),
      loadAsignadoOptions(),
      loadSelectedMonth(),
      loadSelectedDay(),
    ]);
    savingState.value = "saved";
    queueDesktopBackup("post-restore");
    window.alert("La copia de seguridad se ha restaurado correctamente.");
  } catch (error) {
    console.error("No se pudo restaurar la copia de seguridad.", error);
    savingState.value = "error";
    window.alert("No se pudo restaurar la copia de seguridad.");
  }
}

async function loadAsignadoOptions() {
  try {
    const settings = await loadSettings();
    applyPlannerSettings(settings);
    plannerLoadError.value = "";
  } catch (error) {
    console.error(error);
    plannerLoadError.value =
      "No se pudo cargar la configuración compartida de la agenda.";
    throw error;
  }
}

function handlePlannerSettingsUpdated(event: Event) {
  if (!(event instanceof CustomEvent)) {
    return;
  }

  const settings = event.detail as PlannerSettings;
  plannerSettings.value = settings;
  asignadoOptions.value = settings.asignadoOptions;
}

async function refreshStorageMode() {
  try {
    storageModeStatus.value = await detectStorageMode();
    console.info("[storage] mode", storageModeStatus.value);
  } catch (error) {
    console.error(error);
    storageModeStatus.value = "error";
    throw error;
  }
}

function stopBackupSchedule() {
  if (backupTimer) {
    window.clearTimeout(backupTimer);
    backupTimer = undefined;
  }

  if (backupIntervalId) {
    window.clearInterval(backupIntervalId);
    backupIntervalId = undefined;
  }
}

function startBackupScheduleIfAllowed() {
  if (
    !canManageApp.value ||
    typeof window === "undefined" ||
    !window.desktopPlanner?.saveBackup
  ) {
    return;
  }

  queueDesktopBackup("startup");
  backupIntervalId = window.setInterval(() => {
    void runDesktopBackup("interval");
  }, AUTO_BACKUP_INTERVAL_MS);
}

function resetPlannerDataState() {
  stopBackupSchedule();
  hasInitialized.value = false;
  plannerDataLoadedForSession.value = false;
  plannerLoadError.value = "";
  loading.value = false;
  monthLoading.value = false;
  savingState.value = "idle";
  hydrating.value = false;
  suppressAutoSave.value = false;
  applyDefaultNavigationState();
  dayRecord.value = createEmptyDay(selectedDate.value);
  monthRecords.value = {};
  allRecords.value = {};
  persistedAllRecords.value = {};
  plannerSettings.value = createDefaultPlannerSettings();
  asignadoOptions.value = [];
  removeDialog.value = null;
  moveDialog.value = null;
  moveDialogError.value = "";
  movingEntry.value = false;
  importDialogOpen.value = false;
  importRows.value = [];
  importFileName.value = "";
  importError.value = "";
  importSummary.value = "";
  importBusy.value = false;
  unsavedDayDrafts.value = {};
}

async function initializePlannerDataForSession() {
  if (plannerDataLoadedForSession.value) {
    return;
  }

  plannerLoadError.value = "";

  try {
    await refreshStorageMode();
    await loadAllRecords();
    await loadAsignadoOptions();
    await Promise.all([loadSelectedDay(), loadSelectedMonth()]);
    plannerDataLoadedForSession.value = true;
    hasInitialized.value = true;
    startBackupScheduleIfAllowed();
  } catch (error) {
    console.error("No se pudo inicializar la agenda.", error);
    plannerLoadError.value =
      hasSupabaseConfig() && !plannerAuthState.isAuthenticated.value
        ? "No se pudo cargar la agenda en modo solo lectura. Si usas Supabase, aplica el SQL actualizado para permitir lectura pública de planner_days y planner_settings."
        : "No se pudo cargar la agenda para el usuario actual.";
  }
}

function shiftDay(offset: number) {
  const base = new Date(`${selectedDate.value}T12:00:00`);
  if (viewMode.value === "month") {
    base.setMonth(base.getMonth() + offset);
    base.setDate(1);
  } else {
    base.setDate(base.getDate() + offset);
  }
  const year = base.getFullYear();
  const month = `${base.getMonth() + 1}`.padStart(2, "0");
  const day = `${base.getDate()}`.padStart(2, "0");
  selectedDate.value = `${year}-${month}-${day}`;
}

function jumpToToday() {
  selectedDate.value = todayKey();
}

function openDayView() {
  referenceFilter.value = "";
  viewMode.value = "day";
}

function openMonthView() {
  viewMode.value = "month";
  referenceFilter.value = "";
}

function openDayFromMonth(dateKey: string) {
  viewMode.value = "day";

  if (selectedDate.value === dateKey) {
    void loadSelectedDay(dateKey);
    return;
  }

  selectedDate.value = dateKey;
}

function openDayFromReferenceResult(dateKey: string) {
  referenceFilter.value = "";
  openDayFromMonth(dateKey);
}

function summarizeDay(record: DayRecord | null) {
  if (!record || record.entries.length === 0) {
    return {
      countLabel: "Sin actividad",
      preview: [],
      extraCount: 0,
    };
  }

  const preview = record.entries
    .slice(0, MONTH_CARD_PREVIEW_LIMIT)
    .map((entry) => ({
      id: entry.id,
      isOk: entry.plano === "si" && entry.entregado,
      referencia: entry.referencia.trim() || "Sin referencia",
      asignado: entry.asignado.trim() || "Sin asignar",
      hasPlanos: entry.plano === "si",
      plano:
        entry.plano === "si"
          ? "Con planos"
          : entry.plano === "no"
            ? "Sin planos"
            : "Sin planos",
      localidad: entry.localidad.trim(),
      isEntregado: entry.entregado,
      entregado: entry.entregado ? "Entregado" : "No entregado",
    }));

  return {
    countLabel: `${record.entries.length} ${
      record.entries.length === 1 ? "informe" : "informes"
    }`,
    preview,
    extraCount: Math.max(0, record.entries.length - preview.length),
  };
}

function setEntryRowRef(id: string, element: Element | null) {
  if (element instanceof HTMLElement) {
    entryRowElements.set(id, element);
    return;
  }

  entryRowElements.delete(id);
}

function scrollToEntry(id: string) {
  const element = entryRowElements.get(id);

  if (!element) {
    return;
  }

  const targetTop =
    window.scrollY +
    element.getBoundingClientRect().top -
    NEW_ENTRY_SCROLL_TOP_OFFSET;

  window.scrollTo({
    top: Math.max(0, targetTop),
    behavior: "smooth",
  });
}

function focusEntryField(id: string) {
  const element = entryRowElements.get(id);
  const target = element?.querySelector("input, select, textarea");

  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  ) {
    target.focus({ preventScroll: true });
  }
}

function applyDefaultNavigationState() {
  selectedDate.value = todayKey();
  viewMode.value = "month";
  referenceFilter.value = "";
  pendingEntryId = "";
}

function clearInitialNavigationParams() {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  const hadNavigationParams =
    url.searchParams.has("date") || url.searchParams.has("entry");

  if (!hadNavigationParams) {
    return;
  }

  url.searchParams.delete("date");
  url.searchParams.delete("entry");

  const nextSearch = url.searchParams.toString();
  const nextUrl = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`;

  window.history.replaceState(window.history.state, "", nextUrl);
}

function applyInitialNavigationState() {
  if (typeof window === "undefined") {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  const dateParam = params.get("date")?.trim() ?? "";
  const entryParam = params.get("entry")?.trim() ?? "";

  applyDefaultNavigationState();

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    selectedDate.value = dateParam;
    viewMode.value = "day";
  }

  pendingEntryId = entryParam;
  clearInitialNavigationParams();
  return viewMode.value === "day";
}

async function flushPendingDaySave() {
  if (!canEditReports.value) {
    return;
  }

  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
  }

  try {
    await persistDay();
  } catch (error) {
    console.error("No se pudo guardar antes de cambiar de vista.", error);
  }
}

function openRemoveDialog(entry: DayEntry) {
  if (!canEditReports.value) {
    return;
  }

  removeDialog.value = {
    id: entry.id,
    referencia: entry.referencia.trim() || "Sin referencia",
    localidad: entry.localidad.trim() || "Sin localidad",
  };
}

function closeRemoveDialog() {
  removeDialog.value = null;
}

function openMoveDialog(entry: DayEntry) {
  if (!canEditReports.value) {
    return;
  }

  moveDialog.value = {
    id: entry.id,
    referencia: entry.referencia.trim() || "Sin referencia",
    localidad: entry.localidad.trim() || "Sin localidad",
    targetDate: selectedDate.value,
  };
  moveDialogError.value = "";
}

function closeMoveDialog(force = false) {
  if (movingEntry.value && !force) {
    return;
  }

  moveDialog.value = null;
  moveDialogError.value = "";
}

async function addRow() {
  if (!canEditReports.value) {
    return;
  }

  const entry = createEmptyEntry();
  dayRecord.value.entries.push(entry);
  queueSave();
  await nextTick();
  scrollToEntry(entry.id);
}

async function removeRow(id: string) {
  if (!canEditReports.value) {
    return;
  }

  const entryToRemove = dayRecord.value.entries.find(
    (entry) => entry.id === id,
  );

  if (!entryToRemove) {
    return;
  }

  dayRecord.value.entries = dayRecord.value.entries.filter(
    (entry) => entry.id !== id,
  );
  closeRemoveDialog();

  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
  }

  await persistDay();
  await Promise.all([loadAllRecords(), loadSelectedMonth(), loadSelectedDay()]);
}

function confirmRemoveRow() {
  if (!removeDialog.value) {
    return;
  }

  void removeRow(removeDialog.value.id);
}

async function confirmMoveEntry() {
  if (!moveDialog.value || movingEntry.value || !canEditReports.value) {
    return;
  }

  const targetDate = moveDialog.value.targetDate.trim();
  const sourceDate = dayRecord.value.dateKey;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    moveDialogError.value = "Selecciona una fecha válida.";
    return;
  }

  if (targetDate === sourceDate) {
    moveDialogError.value = "Elige un día distinto para mover el informe.";
    return;
  }

  const entryToMove = dayRecord.value.entries.find(
    (entry) => entry.id === moveDialog.value?.id,
  );

  if (!entryToMove) {
    moveDialogError.value = "No se encontró el informe que quieres mover.";
    return;
  }

  if (saveTimer) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
  }

  movingEntry.value = true;
  moveDialogError.value = "";
  savingState.value = "saving";

  const sourceRecordWithoutEntry = cloneRecord(dayRecord.value);
  sourceRecordWithoutEntry.entries = sourceRecordWithoutEntry.entries.filter(
    (entry) => entry.id !== entryToMove.id,
  );

  try {
    const targetOriginalRecord = cloneRecord(await loadDay(targetDate));
    const targetRecordWithEntry = cloneRecord(targetOriginalRecord);
    targetRecordWithEntry.entries.push({ ...entryToMove });

    const savedTargetRecord = await saveDay(targetRecordWithEntry);

    try {
      const savedSourceRecord = await saveDay(sourceRecordWithoutEntry);

      syncMonthRecord(savedTargetRecord);
      syncAllRecordsRecord(savedTargetRecord);
      await applyLoadedDayRecord(savedSourceRecord);
      closeMoveDialog(true);
      savingState.value = "saved";
      queueDesktopBackup("entry-move");
    } catch (error) {
      console.error("No se pudo guardar el día de origen tras mover.", error);

      try {
        const restoredTargetRecord = await saveDay(targetOriginalRecord);
        syncMonthRecord(restoredTargetRecord);
        syncAllRecordsRecord(restoredTargetRecord);
      } catch (rollbackError) {
        console.error(
          "No se pudo revertir el día de destino tras un error al mover.",
          rollbackError,
        );
      }

      throw error;
    }
  } catch (error) {
    console.error("No se pudo mover el informe.", error);
    savingState.value = "error";
    moveDialogError.value =
      error instanceof DuplicateReferenceError
        ? error.message
        : "No se pudo mover el informe al día seleccionado.";
  } finally {
    movingEntry.value = false;
  }
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && moveDialog.value) {
    closeMoveDialog();
    return;
  }

  if (event.key === "Escape" && removeDialog.value) {
    closeRemoveDialog();
  }
}

watch(selectedDate, (nextDate, previousDate) => {
  if (!hasInitialized.value) {
    return;
  }

  void loadSelectedDay(nextDate);

  if (nextDate.slice(0, 7) !== previousDate.slice(0, 7)) {
    void loadSelectedMonth(nextDate.slice(0, 7));
  }
});

watch(
  dayRecord,
  () => {
    if (suppressAutoSave.value) {
      return;
    }

    setUnsavedDayDraft(dayRecord.value);
    syncMonthRecord(dayRecord.value);
    syncAllRecordsRecord(dayRecord.value);
    queueSave();
  },
  { deep: true },
);

watch(activeReferenceConflictSummary, (nextMessage) => {
  if (!hasInitialized.value || hydrating.value) {
    return;
  }

  if (nextMessage) {
    savingState.value = "error";
    plannerLoadError.value = nextMessage;
    return;
  }

  if (plannerLoadError.value.includes("referencia") && !nextMessage) {
    plannerLoadError.value = "";
  }
});

watch(
  [plannerAuthState.authReady, plannerAuthState.isAuthenticated],
  ([authReady]) => {
    if (!authReady) {
      return;
    }

    if (plannerDataLoadedForSession.value) {
      return;
    }

    void initializePlannerDataForSession();
  },
);

watch(canManageApp, (nextCanManageApp) => {
  if (!hasInitialized.value) {
    return;
  }

  if (nextCanManageApp) {
    startBackupScheduleIfAllowed();
    return;
  }

  stopBackupSchedule();
});

onMounted(() => {
  window.addEventListener("keydown", handleWindowKeydown);
  window.addEventListener(
    PLANNER_OPEN_IMPORT_DIALOG_EVENT,
    handleOpenImportDialog,
  );
  window.addEventListener(
    PLANNER_SETTINGS_UPDATED_EVENT,
    handlePlannerSettingsUpdated,
  );
  canOpenBackupFolder.value = Boolean(
    typeof window !== "undefined" && window.desktopPlanner?.openBackupFolder,
  );
  canRestoreBackup.value = Boolean(
    typeof window !== "undefined" && window.desktopPlanner?.selectBackup,
  );
  applyInitialNavigationState();
  void ensurePlannerAuthInitialized().then(() => {
    void initializePlannerDataForSession();
  });
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleWindowKeydown);
  window.removeEventListener(
    PLANNER_OPEN_IMPORT_DIALOG_EVENT,
    handleOpenImportDialog,
  );
  window.removeEventListener(
    PLANNER_SETTINGS_UPDATED_EVENT,
    handlePlannerSettingsUpdated,
  );

  if (saveTimer) {
    void flushPendingDaySave();
  }

  if (backupTimer) {
    window.clearTimeout(backupTimer);
  }

  stopBackupSchedule();
});
</script>

<template>
  <main class="planner-app">
    <section v-if="plannerAuthState.authReady.value" class="planner-sheet">
      <div
        v-if="hasActiveReferenceConflictAlerts"
        class="sheet-alert sheet-alert--error"
      >
        <p class="sheet-alert__title">
          {{ activeReferenceConflictSummary }}
        </p>
        <ul
          v-if="activeReferenceAlertMessages.length > 1"
          class="sheet-alert__list"
        >
          <li v-for="message in activeReferenceAlertMessages" :key="message">
            {{ message }}
          </li>
        </ul>
      </div>
      <p v-if="visiblePlannerLoadError" class="sheet-alert sheet-alert--error">
        {{ visiblePlannerLoadError }}
      </p>
      <div
        v-if="canCleanPersistedDuplicates"
        class="sheet-alert sheet-alert--warn sheet-alert--action"
      >
        <span>
          Hay {{ persistedReferenceConflicts.length }}
          {{
            persistedReferenceConflicts.length === 1
              ? "informe duplicado."
              : "informes duplicados."
          }}

          <p>
            La app puede limpiar las apariciones repetidas, conservando la más
            reciente.
          </p>
          <p>{{ persistedDuplicateReferencesText }}</p>
        </span>
        <button
          class="soft-button"
          type="button"
          @click="cleanPersistedDuplicateReferences"
        >
          Limpiar duplicados
        </button>
      </div>

      <section
        class="sheet-toolbar"
        :class="{
          'sheet-toolbar--day': viewMode === 'day',
          'sheet-toolbar--month': viewMode === 'month',
          'sheet-toolbar--search-active': hasReferenceSearch,
        }"
      >
        <div class="view-switch">
          <button
            class="ghost-button"
            :class="{ 'is-active': viewMode === 'day' }"
            type="button"
            @click="openDayView"
          >
            Vista diaria
          </button>
          <button
            class="ghost-button"
            :class="{ 'is-active': viewMode === 'month' }"
            type="button"
            @click="openMonthView"
          >
            Vista mensual
          </button>
        </div>

        <div class="toolbar-group toolbar-group--navigation">
          <button
            class="ghost-button"
            :disabled="hasReferenceSearch"
            type="button"
            @click="shiftDay(-1)"
          >
            {{ viewMode === "day" ? "Día anterior" : "Mes anterior" }}
          </button>
          <button
            class="ghost-button"
            :class="{ 'is-today': isTodaySelected }"
            :disabled="hasReferenceSearch"
            type="button"
            @click="jumpToToday"
          >
            Hoy
          </button>
          <button
            class="ghost-button"
            :disabled="hasReferenceSearch"
            type="button"
            @click="shiftDay(1)"
          >
            {{ viewMode === "day" ? "Día siguiente" : "Mes siguiente" }}
          </button>
        </div>

        <div class="toolbar-group toolbar-group--search">
          <label class="field toolbar-search">
            <input
              v-model="referenceFilter"
              type="text"
              placeholder="Busca por referencia"
            />
          </label>
        </div>

        <div class="toolbar-group toolbar-group--date">
          <label class="date-field">
            <input
              v-model="selectedDate"
              :disabled="hasReferenceSearch"
              type="date"
            />
          </label>
        </div>
      </section>

      <section
        v-if="viewMode === 'month' && normalizedReferenceFilter.length === 0"
        class="month-summary month-summary--month"
      >
        <div class="month-summary__header">
          <h3>{{ formattedMonthTitle }}</h3>
        </div>
      </section>
      <section
        v-else-if="viewMode === 'day' && normalizedReferenceFilter.length === 0"
        class="month-summary month-summary--day"
      >
        <div class="month-summary__header">
          <h3>{{ formattedTitle }}</h3>
          <div
            v-if="canEditReports"
            class="month-summary__tools month-summary__tools--day"
          >
            <button
              class="primary-button month-summary__action"
              type="button"
              @click="addRow"
            >
              Añadir informe
            </button>
          </div>
        </div>
      </section>

      <section v-if="normalizedReferenceFilter.length" class="filter-panel">
        <div v-if="filteredReferenceResults.length" class="filter-results">
          <button
            v-for="result in filteredReferenceResults"
            :key="`${result.dateKey}-${result.id}`"
            class="filter-result"
            type="button"
            @click="openDayFromReferenceResult(result.dateKey)"
          >
            <div class="filter-result__topbar">
              <strong>{{ formatHeader(result.dateKey) }}</strong>
            </div>

            <div class="filter-result__grid">
              <div>
                <span>Referencia:</span>
                <span>{{ result.referencia }}</span>
              </div>
              <div>
                <span>Planos:</span>
                <span>{{ result.plano }}</span>
              </div>
              <div>
                <span>Localidad:</span>
                <span>{{ result.localidad }}</span>
              </div>
              <div>
                <span>Entregado:</span>
                <span>{{ result.entregado }}</span>
              </div>
            </div>
          </button>
        </div>
        <p v-else class="filter-panel__empty">
          No hay informes que coincidan con esa referencia.
        </p>
      </section>

      <div v-if="isCurrentViewLoading" class="loading-state">
        Cargando el día seleccionado...
      </div>

      <section
        v-else-if="
          viewMode === 'month' && normalizedReferenceFilter.length === 0
        "
        class="month-calendar"
      >
        <div class="month-calendar__weekdays">
          <span>Lun</span>
          <span>Mar</span>
          <span>Mie</span>
          <span>Jue</span>
          <span>Vie</span>
          <span>Sab</span>
          <span>Dom</span>
        </div>

        <div class="month-calendar__grid">
          <article
            v-for="(cell, index) in monthCalendarCells"
            :key="cell ? cell.dateKey : `empty-${index}`"
            class="month-card"
            :class="{
              'is-empty': !cell,
              'is-selected': cell?.dateKey === selectedDate,
              'is-today': cell?.isToday,
            }"
          >
            <template v-if="cell">
              <button
                class="month-card__button"
                type="button"
                @click="openDayFromMonth(cell.dateKey)"
              >
                <span class="month-card__day">{{ cell.day }}</span>
                <span class="month-card__count">{{
                  summarizeDay(cell.record).countLabel
                }}</span>
                <ul
                  v-if="summarizeDay(cell.record).preview.length > 0"
                  class="month-card__list"
                >
                  <li
                    v-for="item in summarizeDay(cell.record).preview"
                    :key="item.id"
                  >
                    <div class="month-card__entry-top">
                      <em>{{ item.referencia }}</em>
                      <span
                        class="month-card__status"
                        :class="
                          item.isOk
                            ? 'month-card__status--ok'
                            : 'month-card__status--issue'
                        "
                      >
                      </span>
                    </div>
                    <span v-if="item.localidad" class="month-card__meta">{{
                      item.localidad
                    }}</span>
                    <div class="month-card__tags">
                      <span
                        v-if="item.asignado !== 'Sin asignar'"
                        class="month-card__tag month-card__tag--asignado"
                      >
                        {{ item.asignado }}
                      </span>
                      <span
                        v-if="!item.hasPlanos"
                        class="month-card__tag month-card__tag--planos-missing"
                      >
                        {{ item.plano }}
                      </span>
                      <span
                        v-if="!item.isEntregado"
                        class="month-card__tag month-card__tag--pending"
                      >
                        {{ item.entregado }}
                      </span>
                    </div>
                  </li>
                </ul>
                <span
                  v-if="summarizeDay(cell.record).extraCount > 0"
                  class="month-card__more"
                >
                  +{{ summarizeDay(cell.record).extraCount }} más
                </span>
              </button>
            </template>
          </article>
        </div>
      </section>

      <div v-else-if="viewMode === 'day'" class="sheet-table-wrap">
        <div v-if="dayRecord.entries.length === 0" class="empty-day">
          <p class="empty-day__title">Este día no tiene informes.</p>
          <p class="empty-day__copy">
            {{
              canEditReports
                ? "Puedes dejarlo vacío o crear una nueva fila cuando la necesites."
                : "Tu usuario tiene acceso de solo consulta para esta vista."
            }}
          </p>
          <button
            v-if="canEditReports"
            class="primary-button"
            type="button"
            @click="addRow"
          >
            Añadir primer informe
          </button>
        </div>

        <div
          v-else-if="normalizedReferenceFilter.length === 0"
          class="sheet-table"
        >
          <article
            v-for="(entry, index) in dayRecord.entries"
            :key="entry.id"
            :ref="(element) => setEntryRowRef(entry.id, element)"
            class="sheet-grid sheet-grid--row"
            :class="{ 'sheet-grid--readonly': !canEditReports }"
          >
            <div class="row-topbar">
              <span class="row-marker">{{ index + 1 }}</span>
              <div class="row-status">
                <strong>{{ entry.referencia || "Sin referencia" }}</strong>
              </div>
              <div v-if="canEditReports" class="row-topbar__actions">
                <button
                  class="soft-button row-topbar__action"
                  type="button"
                  @click="openMoveDialog(entry)"
                >
                  Mover
                </button>
                <button
                  class="inline-remove"
                  type="button"
                  @click="openRemoveDialog(entry)"
                >
                  Eliminar
                </button>
              </div>
            </div>

            <div class="sheet-grid sheet-grid--body">
              <label class="field">
                <span class="field-label">Referencia:</span>
                <input
                  v-model="entry.referencia"
                  :class="{
                    'field-control--error': Boolean(
                      getEntryReferenceError(entry.id),
                    ),
                  }"
                  :readonly="!canEditReports"
                  type="text"
                  @blur="handleTextFieldBlur"
                  @focus="handleTextFieldFocus"
                />
                <p v-if="getEntryReferenceError(entry.id)" class="field-error">
                  {{ getEntryReferenceError(entry.id) }}
                </p>
              </label>

              <label class="field">
                <span class="field-label">Asignado:</span>
                <select v-model="entry.asignado" :disabled="!canEditReports">
                  <option value="">Selecciona un asignado</option>
                  <option
                    v-for="asignadoOption in getAsignadoSelectOptions(
                      entry.asignado,
                    )"
                    :key="asignadoOption"
                    :value="asignadoOption"
                  >
                    {{
                      asignadoOptions.includes(asignadoOption)
                        ? asignadoOption
                        : `${asignadoOption} (ya no disponible)`
                    }}
                  </option>
                </select>
              </label>

              <label class="field">
                <span class="field-label">Planos:</span>
                <select v-model="entry.plano" :disabled="!canEditReports">
                  <option value="si">Si</option>
                  <option value="no">No</option>
                </select>
              </label>

              <label class="field">
                <span class="field-label">Localidad:</span>
                <LocalityAutocomplete
                  v-model="entry.localidad"
                  :disabled="!canEditReports"
                />
              </label>

              <label class="field">
                <span class="field-label">Observaciones:</span>
                <textarea
                  v-model="entry.observaciones"
                  :readonly="!canEditReports"
                  @blur="handleTextFieldBlur"
                  @focus="handleTextFieldFocus"
                  rows="3"
                  placeholder="Notas de montaje, materiales, seguimiento..."
                />
              </label>

              <label class="field field--checkbox">
                <span class="field-label">Entregado</span>
                <input
                  v-model="entry.entregado"
                  :disabled="!canEditReports"
                  type="checkbox"
                />
              </label>
            </div>
          </article>
        </div>
      </div>

      <footer class="sheet-footer">
        <small class="storage-caption">
          {{ storageCaption }}
        </small>
        <button
          v-if="canManageApp"
          class="footer-link"
          :disabled="!canOpenBackupFolder"
          type="button"
          @click="openBackupFolder"
        >
          {{ backupLinkLabel }}
        </button>
        <button
          v-if="canManageApp"
          class="footer-link"
          :disabled="!canRestoreBackup"
          type="button"
          @click="restoreBackup"
        >
          {{ restoreLinkLabel }}
        </button>
      </footer>
    </section>

    <div
      v-if="canEditReports && importDialogOpen"
      class="confirm-overlay"
      @click.self="closeImportDialog"
    >
      <section
        class="confirm-dialog confirm-dialog--import"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
      >
        <h2 id="import-dialog-title">Importar informes desde Excel</h2>
        <p class="pedido-editor__copy">
          La plantilla debe incluir las columnas <strong>fecha</strong>,
          <strong>referencia</strong>, <strong>localidad</strong> y
          <strong>observaciones</strong>. La fecha de registro se calculara
          sumando dos meses.
        </p>

        <label class="field">
          <span class="field-label">Archivo Excel:</span>
          <input
            :disabled="importBusy"
            accept=".xlsx,.xls"
            type="file"
            @change="handleImportFileSelection"
          />
        </label>

        <p v-if="importFileName" class="import-dialog__meta">
          Archivo seleccionado: {{ importFileName }}
        </p>
        <p v-if="importSummary" class="import-dialog__meta">
          {{ importSummary }}
        </p>
        <p v-if="importError" class="pedido-editor__error">
          {{ importError }}
        </p>

        <div v-if="importRows.length" class="import-preview">
          <div class="import-preview__header">
            <strong>Previsualizacion</strong>
            <span>{{ readyImportRows.length }} listas para importar</span>
          </div>

          <div class="import-preview__list">
            <article
              v-for="row in importRows"
              :key="row.rowNumber"
              class="import-preview__row"
              :class="{
                'is-error': row.status === 'error',
                'is-ready': row.status === 'ready',
              }"
            >
              <div class="import-preview__row-top">
                <strong>Fila {{ row.rowNumber }}</strong>
                <span>
                  {{ row.status === "ready" ? "Lista" : "Revisar" }}
                </span>
              </div>
              <div class="import-preview__grid">
                <div>
                  <span>Fecha origen</span>
                  <strong>{{ row.sourceDate || "Sin fecha" }}</strong>
                </div>
                <div>
                  <span>Fecha registro</span>
                  <strong>{{ row.targetDate || "Sin calcular" }}</strong>
                </div>
                <div>
                  <span>Referencia</span>
                  <strong>{{ row.referencia || "Sin referencia" }}</strong>
                </div>
                <div>
                  <span>Localidad</span>
                  <strong>{{ row.localidad || "Sin localidad" }}</strong>
                </div>
              </div>
              <!-- <p v-if="row.observaciones" class="import-preview__observaciones">
                {{ row.observaciones }}
              </p> -->
              <ul v-if="row.errors.length" class="import-preview__errors">
                <li v-for="errorItem in row.errors" :key="errorItem">
                  {{ errorItem }}
                </li>
              </ul>
              <ul v-if="row.warnings.length" class="import-preview__warnings">
                <li v-for="warningItem in row.warnings" :key="warningItem">
                  {{ warningItem }}
                </li>
              </ul>
            </article>
          </div>
        </div>

        <div class="confirm-dialog__actions">
          <button
            class="ghost-button"
            type="button"
            :disabled="importBusy"
            @click="downloadImportTemplate"
          >
            Descargar plantilla
          </button>
          <button
            class="ghost-button"
            type="button"
            :disabled="importBusy"
            @click="closeImportDialog"
          >
            Cancelar
          </button>
          <button
            class="primary-button"
            type="button"
            :disabled="importBusy || readyImportRows.length === 0"
            @click="confirmExcelImport"
          >
            {{
              importBusy
                ? "Importando..."
                : `Importar ${readyImportRows.length} informes`
            }}
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="canEditReports && removeDialog"
      class="confirm-overlay"
      @click.self="closeRemoveDialog"
    >
      <section
        class="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-dialog-title"
      >
        <h2 id="remove-dialog-title">¿Quieres eliminar este informe?</h2>
        <dl class="confirm-dialog__details">
          <div>
            <dt>Referencia:</dt>
            <dd>{{ removeDialog.referencia }}</dd>
          </div>
          <div>
            <dt>Localidad:</dt>
            <dd>{{ removeDialog.localidad }}</dd>
          </div>
        </dl>
        <div class="confirm-dialog__actions">
          <button class="ghost-button" type="button" @click="closeRemoveDialog">
            Cancelar
          </button>
          <button class="inline-remove" type="button" @click="confirmRemoveRow">
            Eliminar
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="canEditReports && moveDialog"
      class="confirm-overlay"
      @click.self="closeMoveDialog"
    >
      <section
        class="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-dialog-title"
      >
        <h2 id="move-dialog-title">Mover informe a otro día</h2>
        <dl class="confirm-dialog__details">
          <div>
            <dt>Referencia:</dt>
            <dd>{{ moveDialog.referencia }}</dd>
          </div>
          <div>
            <dt>Localidad:</dt>
            <dd>{{ moveDialog.localidad }}</dd>
          </div>
          <div>
            <dt>Día actual:</dt>
            <dd>{{ formatHeader(selectedDate) }}</dd>
          </div>
        </dl>

        <label class="field">
          <span class="field-label">Nuevo día:</span>
          <input v-model="moveDialog.targetDate" type="date" />
        </label>

        <p v-if="moveDialogError" class="pedido-editor__error">
          {{ moveDialogError }}
        </p>

        <div class="confirm-dialog__actions">
          <button
            class="ghost-button"
            type="button"
            :disabled="movingEntry"
            @click="closeMoveDialog"
          >
            Cancelar
          </button>
          <button
            class="soft-button"
            type="button"
            :disabled="movingEntry"
            @click="confirmMoveEntry"
          >
            {{ movingEntry ? "Moviendo..." : "Mover informe" }}
          </button>
        </div>
      </section>
    </div>

    <section v-if="!plannerAuthState.authReady.value" class="planner-sheet">
      <p class="sidebar-copy">Comprobando acceso…</p>
    </section>
  </main>
</template>
