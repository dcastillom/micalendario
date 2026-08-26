<script setup lang="ts">
import * as xlsxModule from "xlsx";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  createDefaultPlannerSettings,
  createEmptyDay,
  createEmptyEntry,
  createEmptyVacation,
  deleteVacation,
  DuplicateReferenceError,
  loadAllDays,
  loadSettings,
  loadVacations,
  normalizePlannerReference,
  saveDay,
  saveSettings,
  saveVacation,
} from "../lib/planner-client";
import {
  ensurePlannerAuthInitialized,
  plannerAuthState,
} from "../lib/planner-auth";
import {
  dispatchPlannerDataUpdated,
  dispatchPlannerSettingsUpdated,
  PLANNER_OPEN_IMPORT_DIALOG_EVENT,
  PLANNER_OPEN_VACATIONS_DIALOG_EVENT,
} from "../lib/planner-ui-events";
import { SPANISH_LOCALITIES } from "../lib/spanish-municipalities";
import type {
  DayRecord,
  PlannerSettings,
  PlannerVacation,
} from "../lib/planner-types";

interface ImportPreviewRow {
  rowNumber: number;
  sourceDate: string;
  targetDate: string;
  fechaCampo: string;
  laborante: string;
  plano: "" | "si" | "no";
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

const IMPORT_TEMPLATE_FILE_NAME = "plantilla-informes.xlsx";
const ABSENCE_TYPES = [
  "Vacaciones",
  "Enfermedad",
  "Permiso retribuido",
  "Permiso no retribuido",
  "Asuntos propios",
  "Otro",
];

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function isValidDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function createVacationDraftForDate(dateKey: string) {
  return {
    ...createEmptyVacation(),
    startDate: dateKey,
    endDate: dateKey,
  };
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
  if (!token) return [];
  const variants = new Set<string>([token]);
  const parts = token.split(" ").filter(Boolean);

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
  if (!trimmedValue) return [];

  const match = trimmedValue.match(/^(.*?)\s*(?:\(([^()]*)\))?$/);
  const municipalityRaw = (match?.[1] ?? trimmedValue).trim();
  const provinceRaw = (match?.[2] ?? "").trim();
  const municipalityToken = normalizeLocalityToken(municipalityRaw);
  const provinceToken = normalizeLocalityToken(provinceRaw);
  const variants = new Set<string>();

  buildLocalityTokenVariants(municipalityToken).forEach((variant) => {
    variants.add(variant);
    if (provinceToken) {
      variants.add(`${variant} ${provinceToken}`.trim());
    }
  });

  if (provinceToken && municipalityToken) {
    variants.add(`${provinceToken} ${municipalityToken}`.trim());
  }

  return [...variants].filter(Boolean);
}

const LOCALITY_CATALOG: LocalityCatalogEntry[] = SPANISH_LOCALITIES.map(
  (locality) => {
    const fullToken = normalizeLocalityToken(locality);
    const municipalityMatch = locality.match(/^(.*?)\s*(?:\(([^()]*)\))?$/);
    const municipalityToken = normalizeLocalityToken(
      (municipalityMatch?.[1] ?? locality).trim(),
    );

    return {
      locality,
      fullToken,
      municipalityToken,
      fullCompactToken: compactLocalityToken(fullToken),
      municipalityCompactToken: compactLocalityToken(municipalityToken),
    };
  },
);

const LOCALITY_BY_FULL_TOKEN = new Map<string, string[]>();
const LOCALITY_BY_MUNICIPALITY_TOKEN = new Map<string, string[]>();
const LOCALITY_BY_FULL_COMPACT_TOKEN = new Map<string, string[]>();
const LOCALITY_BY_MUNICIPALITY_COMPACT_TOKEN = new Map<string, string[]>();

for (const locality of LOCALITY_CATALOG) {
  const add = (target: Map<string, string[]>, key: string) => {
    if (!key) return;
    target.set(key, [...(target.get(key) ?? []), locality.locality]);
  };

  add(LOCALITY_BY_FULL_TOKEN, locality.fullToken);
  add(LOCALITY_BY_MUNICIPALITY_TOKEN, locality.municipalityToken);
  add(LOCALITY_BY_FULL_COMPACT_TOKEN, locality.fullCompactToken);
  add(
    LOCALITY_BY_MUNICIPALITY_COMPACT_TOKEN,
    locality.municipalityCompactToken,
  );
}

function getUniqueLocalityMatch(target: Map<string, string[]>, key: string) {
  const matches = target.get(key) ?? [];
  return matches.length === 1 ? matches[0] : "";
}

function levenshteinDistanceWithinMax(
  left: string,
  right: string,
  maxDistance: number,
) {
  const leftLength = left.length;
  const rightLength = right.length;

  if (Math.abs(leftLength - rightLength) > maxDistance) return null;

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
      if (distance < rowMin) rowMin = distance;
    }

    if (rowMin > maxDistance) return null;

    for (let index = 0; index <= rightLength; index += 1) {
      previous[index] = current[index];
    }
  }

  const finalDistance = previous[rightLength];
  return finalDistance <= maxDistance ? finalDistance : null;
}

function findFuzzyLocalityMatch(localityCompactToken: string) {
  if (localityCompactToken.length < 4) return "";
  const maxDistance = 2;
  const firstCharacter = localityCompactToken[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestLocality = "";
  let isAmbiguous = false;

  for (const locality of LOCALITY_CATALOG) {
    const candidateToken = locality.municipalityCompactToken;
    if (!candidateToken || candidateToken[0] !== firstCharacter) continue;
    const distance = levenshteinDistanceWithinMax(
      localityCompactToken,
      candidateToken,
      maxDistance,
    );
    if (distance === null) continue;
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
      .find(Boolean) ||
    localityTokenVariants
      .map((variant) =>
        getUniqueLocalityMatch(LOCALITY_BY_MUNICIPALITY_TOKEN, variant),
      )
      .find(Boolean) ||
    localityCompactTokenVariants
      .map((variant) =>
        getUniqueLocalityMatch(LOCALITY_BY_FULL_COMPACT_TOKEN, variant),
      )
      .find(Boolean) ||
    localityCompactTokenVariants
      .map((variant) =>
        getUniqueLocalityMatch(LOCALITY_BY_MUNICIPALITY_COMPACT_TOKEN, variant),
      )
      .find(Boolean);

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
    .find(Boolean);
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
    error: `La localidad "${originalValue}" no existe en el catálogo oficial.`,
  };
}

function normalizeHeaderLabel(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/º/g, "o")
    .trim()
    .toLocaleLowerCase("es-ES")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function formatDateKeyFromParts(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseStrictDateKey(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month - 1, day, 12, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  )
    return null;
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
    const parsed = xlsxModule.SSF.parse_date_code(value);
    if (parsed) return formatDateKeyFromParts(parsed.y, parsed.m, parsed.d);
  }

  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const isoParts = parseStrictDateKey(trimmed);
  if (isoParts)
    return formatDateKeyFromParts(isoParts.year, isoParts.month, isoParts.day);
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

function addWeeks(dateKey: string, weeksToAdd: number) {
  const parts = parseStrictDateKey(dateKey);
  if (!parts) return "";
  const targetDate = new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0);
  targetDate.setDate(targetDate.getDate() + weeksToAdd * 7);
  return formatDateKeyFromParts(
    targetDate.getFullYear(),
    targetDate.getMonth() + 1,
    targetDate.getDate(),
  );
}

function normalizeImportedPlano(value: unknown): "" | "si" | "no" {
  const normalizedValue = String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("es-ES");

  if (["si", "s", "1", "true", "x"].includes(normalizedValue)) return "si";
  return "no";
}

function getImportedFirstName(value: unknown) {
  return String(value ?? "").trim().split(/\s+/)[0] ?? "";
}

function triggerBrowserDownload(fileName: string, blob: Blob) {
  if (typeof window === "undefined") return;
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
}

function downloadImportTemplate() {
  const workbook = xlsxModule.utils.book_new();
  const worksheet = xlsxModule.utils.aoa_to_sheet([
    [
      "Laborante",
      "F.Muestreo",
      "NºObra",
      "Obra",
      "Material",
      "Población",
      "Descripción",
      "Cantidad",
      "Planos",
    ],
    [
      "César Pérez Agudo",
      "08/07/2026",
      "37583",
      "VIVIENDA UNIFAMILIAR, C/ TENIS 4, FUENSALIDA (TOLEDO)",
      "ENSAYO DE PENETRACIÓN DPSH",
      "FUENSALIDA (TOLEDO)",
      "P-1, P-2, P-3",
      "",
      "",
    ],
    [
      "César Pérez Agudo",
      "08/07/2026",
      "37511",
      "VIVIENDA UNIFAMILIAR, C/ ATENAS 9, LA PUEBLA DE MONTALBAN (TOLEDO)",
      "ENSAYO DE PENETRACIÓN DPSH",
      "LA PUEBLA DE MONTALBAN (TOLEDO)",
      "P-1, P-2, P-3",
      "",
      "",
    ],
  ]);
  worksheet["!cols"] = [
    { wch: 24 },
    { wch: 14 },
    { wch: 12 },
    { wch: 56 },
    { wch: 32 },
    { wch: 34 },
    { wch: 24 },
    { wch: 12 },
    { wch: 12 },
  ];
  xlsxModule.utils.book_append_sheet(workbook, worksheet, "Listado");
  const workbookData = xlsxModule.write(workbook, {
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

const allDays = ref<Record<string, DayRecord>>({});
const vacations = ref<PlannerVacation[]>([]);
const plannerSettings = ref<PlannerSettings>(createDefaultPlannerSettings());

const importDialogOpen = ref(false);
const importRows = ref<ImportPreviewRow[]>([]);
const importFileName = ref("");
const importError = ref("");
const importSummary = ref("");
const importBusy = ref(false);

const vacationDialogOpen = ref(false);
const vacationDraft = ref<PlannerVacation>(
  createVacationDraftForDate(todayKey()),
);
const vacationBusy = ref(false);
const vacationError = ref("");
const vacationPersonFilter = ref("");
const vacationStatusFilter = ref<"all" | "active" | "future" | "past">("all");
const vacationMonthFilter = ref("");
const vacationSort = ref<"start-asc" | "start-desc" | "person-asc">(
  "start-desc",
);

const canEditReports = computed(() => plannerAuthState.canEditReports.value);
const asignadoOptions = computed(() => plannerSettings.value.asignadoOptions);
const readyImportRows = computed(() =>
  importRows.value.filter((row) => row.status === "ready"),
);
const isEditingVacation = computed(() =>
  vacations.value.some((vacation) => vacation.id === vacationDraft.value.id),
);
const vacationPersonFilterOptions = computed(() => {
  const options = new Set<string>();
  asignadoOptions.value.forEach(
    (option) => option.trim() && options.add(option.trim()),
  );
  vacations.value.forEach(
    (vacation) => vacation.person.trim() && options.add(vacation.person.trim()),
  );
  return [...options].sort((left, right) =>
    left.localeCompare(right, "es", { sensitivity: "base" }),
  );
});
const filteredVacations = computed(() => {
  const normalizedPersonFilter = vacationPersonFilter.value
    .trim()
    .toLocaleLowerCase("es-ES");
  const today = todayKey();
  const filtered = vacations.value.filter((vacation) => {
    if (
      normalizedPersonFilter &&
      !vacation.person
        .toLocaleLowerCase("es-ES")
        .includes(normalizedPersonFilter)
    )
      return false;
    if (
      vacationMonthFilter.value &&
      !(
        vacation.startDate.slice(0, 7) <= vacationMonthFilter.value &&
        vacation.endDate.slice(0, 7) >= vacationMonthFilter.value
      )
    )
      return false;
    if (vacationStatusFilter.value === "active")
      return vacation.startDate <= today && vacation.endDate >= today;
    if (vacationStatusFilter.value === "future")
      return vacation.startDate > today;
    if (vacationStatusFilter.value === "past") return vacation.endDate < today;
    return true;
  });

  return [...filtered].sort((left, right) => {
    if (vacationSort.value === "start-desc")
      return right.startDate.localeCompare(left.startDate);
    if (vacationSort.value === "person-asc") {
      const personComparison = left.person.localeCompare(right.person, "es", {
        sensitivity: "base",
      });
      return personComparison !== 0
        ? personComparison
        : left.startDate.localeCompare(right.startDate);
    }
    return left.startDate.localeCompare(right.startDate);
  });
});

function resetVacationDraft() {
  vacationDraft.value = createVacationDraftForDate(todayKey());
}

function startVacationEdit(vacation: PlannerVacation) {
  vacationDraft.value = { ...vacation };
  vacationError.value = "";
}

async function refreshSharedData() {
  const [days, loadedVacations, settings] = await Promise.all([
    loadAllDays(),
    loadVacations(),
    loadSettings(),
  ]);
  allDays.value = days;
  vacations.value = loadedVacations;
  plannerSettings.value = settings;
}

function cloneDayRecord(record: DayRecord): DayRecord {
  return {
    ...record,
    entries: record.entries.map((entry) => ({ ...entry })),
  };
}

function openImportDialog() {
  if (!canEditReports.value) return;
  importDialogOpen.value = true;
  importRows.value = [];
  importFileName.value = "";
  importError.value = "";
  importSummary.value = "";
}

function closeImportDialog() {
  if (importBusy.value) return;
  importDialogOpen.value = false;
  importRows.value = [];
  importFileName.value = "";
  importError.value = "";
  importSummary.value = "";
}

function openVacationsDialog() {
  if (!canEditReports.value) return;
  resetVacationDraft();
  vacationPersonFilter.value = "";
  vacationStatusFilter.value = "all";
  vacationMonthFilter.value = "";
  vacationSort.value = "start-desc";
  vacationError.value = "";
  vacationDialogOpen.value = true;
}

function closeVacationsDialog() {
  if (vacationBusy.value) return;
  vacationDialogOpen.value = false;
  resetVacationDraft();
  vacationError.value = "";
}

async function handleOpenImportDialog() {
  await ensurePlannerAuthInitialized();
  await refreshSharedData();
  openImportDialog();
}

async function handleOpenVacationsDialog() {
  await ensurePlannerAuthInitialized();
  await refreshSharedData();
  openVacationsDialog();
}

async function handleImportFileSelection(event: Event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const [file] = Array.from(input.files ?? []);
  input.value = "";
  if (!file) return;

  importBusy.value = true;
  importError.value = "";
  importSummary.value = "";
  importRows.value = [];
  importFileName.value = file.name;

  try {
    const workbook = xlsxModule.read(await file.arrayBuffer(), {
      type: "array",
      cellDates: true,
    });
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = firstSheetName
      ? workbook.Sheets[firstSheetName]
      : undefined;
    if (!firstSheet) throw new Error("El Excel no contiene ninguna hoja.");

    const sheetRows = xlsxModule.utils.sheet_to_json<unknown[]>(firstSheet, {
      header: 1,
      raw: true,
      defval: "",
    });
    const [rawHeaders, ...rawDataRows] = sheetRows;
    if (!Array.isArray(rawHeaders) || rawHeaders.length === 0) {
      throw new Error("La primera fila del Excel debe contener las cabeceras.");
    }

    const headerIndex = new Map<string, number>();
    rawHeaders.forEach((headerValue, index) => {
      const normalizedHeader = normalizeHeaderLabel(headerValue);
      if (normalizedHeader) headerIndex.set(normalizedHeader, index);
    });

    const requiredHeaders = [
      "laborante",
      "fmuestreo",
      "noobra",
      "obra",
      "material",
      "poblacion",
      "descripcion",
      "planos",
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
      { dateKey: string; reference: string }
    >();
    Object.values(allDays.value).forEach((record) => {
      record.entries.forEach((entry) => {
        const normalizedReference = normalizePlannerReference(entry.referencia);
        if (!normalizedReference) return;
        existingReferenceMap.set(normalizedReference, {
          dateKey: record.dateKey,
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
        const rawLaborante = Array.isArray(row)
          ? row[headerIndex.get("laborante") ?? -1]
          : "";
        const rawFechaCampo = Array.isArray(row)
          ? row[headerIndex.get("fmuestreo") ?? -1]
          : "";
        const rawReference = Array.isArray(row)
          ? row[headerIndex.get("noobra") ?? -1]
          : "";
        const rawWork = Array.isArray(row)
          ? row[headerIndex.get("obra") ?? -1]
          : "";
        const rawMaterial = Array.isArray(row)
          ? row[headerIndex.get("material") ?? -1]
          : "";
        const rawLocality = Array.isArray(row)
          ? row[headerIndex.get("poblacion") ?? -1]
          : "";
        const rawDescription = Array.isArray(row)
          ? row[headerIndex.get("descripcion") ?? -1]
          : "";
        const rawPlanos = Array.isArray(row)
          ? row[headerIndex.get("planos") ?? -1]
          : "";
        const sourceDate = parseImportDateValue(rawFechaCampo);
        const targetDate = addWeeks(sourceDate, 5);
        const fechaCampo = parseImportDateValue(rawFechaCampo);
        const laborante = getImportedFirstName(rawLaborante);
        const referencia = String(rawReference ?? "").trim();
        const normalizedReference = normalizePlannerReference(referencia);
        const localityResolution = resolveImportedLocality(rawLocality);
        let localidad = localityResolution.locality;
        let observaciones = [rawMaterial, rawWork, rawDescription]
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
          .join("\n");
        const plano = normalizeImportedPlano(rawPlanos);
        const errors: string[] = [];
        const blockingErrors: string[] = [];
        const warnings: string[] = [];

        if (!sourceDate) {
          errors.push("Falta la fecha.");
          blockingErrors.push("Falta la fecha.");
        } else if (!parseStrictDateKey(sourceDate)) {
          errors.push("Fecha invalida. Usa YYYY-MM-DD.");
          blockingErrors.push("Fecha invalida. Usa YYYY-MM-DD.");
        }

        if (!fechaCampo) {
          errors.push("Falta la fecha de campo.");
          blockingErrors.push("Falta la fecha de campo.");
        } else if (!parseStrictDateKey(fechaCampo)) {
          errors.push("Fecha de campo invalida. Usa YYYY-MM-DD.");
          blockingErrors.push("Fecha de campo invalida. Usa YYYY-MM-DD.");
        }

        if (!referencia) {
          errors.push("Falta la referencia.");
          blockingErrors.push("Falta la referencia.");
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
          fechaCampo,
          laborante,
          plano,
          referencia,
          localidad,
          observaciones,
          status: blockingErrors.length > 0 ? "error" : "ready",
          errors,
          warnings,
        };
      });

    if (previewRows.length === 0)
      throw new Error("El Excel no contiene filas con datos.");
    importRows.value = previewRows;
    importSummary.value = `${previewRows.filter((row) => row.status === "ready").length} filas listas y ${previewRows.filter((row) => row.status === "error").length} con error.`;
  } catch (error) {
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
  )
    return;
  importBusy.value = true;
  importError.value = "";

  try {
    const existingLaborantes = new Set(
      plannerSettings.value.asignadoOptions.map((option) =>
        option.trim().toLocaleLowerCase("es-ES"),
      ),
    );
    const newLaborantes = readyImportRows.value
      .map((row) => row.laborante)
      .filter((laborante) => {
        const normalizedLaborante = laborante.toLocaleLowerCase("es-ES");
        if (!normalizedLaborante || existingLaborantes.has(normalizedLaborante))
          return false;
        existingLaborantes.add(normalizedLaborante);
        return true;
      });

    if (newLaborantes.length > 0) {
      await saveSettings({
        ...plannerSettings.value,
        asignadoOptions: [
          ...plannerSettings.value.asignadoOptions,
          ...newLaborantes,
        ],
      });
      const settings = await loadSettings();
      plannerSettings.value = settings;
      dispatchPlannerSettingsUpdated(settings);
    }

    const recordsToSave = new Map<string, DayRecord>();
    for (const row of readyImportRows.value) {
      const existingRecord =
        recordsToSave.get(row.targetDate) ??
        cloneDayRecord(
          allDays.value[row.targetDate] ?? createEmptyDay(row.targetDate),
        );
      const nextEntry = createEmptyEntry();
      nextEntry.laborante = row.laborante;
      nextEntry.plano = row.plano;
      nextEntry.referencia = row.referencia;
      nextEntry.localidad = row.localidad;
      nextEntry.fechaCampo = row.fechaCampo;
      nextEntry.observaciones = row.observaciones;
      existingRecord.entries.push(nextEntry);
      recordsToSave.set(row.targetDate, existingRecord);
    }

    for (const record of recordsToSave.values()) {
      await saveDay(record);
    }

    await refreshSharedData();
    dispatchPlannerDataUpdated();
    window.alert(
      `Se han importado ${readyImportRows.value.length} informes desde ${importFileName.value}.`,
    );
    closeImportDialog();
  } catch (error) {
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

async function submitVacation() {
  if (!canEditReports.value || vacationBusy.value) return;
  const normalizedPerson = vacationDraft.value.person.trim();
  const absenceType = vacationDraft.value.absenceType.trim();
  const startDate = vacationDraft.value.startDate.trim();
  const endDate = vacationDraft.value.endDate.trim();
  if (!normalizedPerson) {
    vacationError.value =
      "Selecciona una persona para registrar las vacaciones.";
    return;
  }
  if (!absenceType) {
    vacationError.value = "Selecciona el tipo de ausencia.";
    return;
  }
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
    vacationError.value = "Selecciona un rango de fechas válido.";
    return;
  }
  if (startDate > endDate) {
    vacationError.value =
      "La fecha de inicio no puede ser posterior a la final.";
    return;
  }

  vacationBusy.value = true;
  vacationError.value = "";
  try {
    await saveVacation({
      ...vacationDraft.value,
      person: normalizedPerson,
      absenceType,
      startDate,
      endDate,
    });
    await refreshSharedData();
    dispatchPlannerDataUpdated();
    vacationMonthFilter.value = "";
    vacationStatusFilter.value = "all";
    vacationSort.value = "start-desc";
    resetVacationDraft();
  } catch (error) {
    vacationError.value =
      error instanceof Error
        ? error.message
        : "No se pudieron guardar las vacaciones.";
  } finally {
    vacationBusy.value = false;
  }
}

async function removeVacationRecord(vacationId: string) {
  if (!canEditReports.value || vacationBusy.value) return;
  const confirmed = window.confirm(
    "Se eliminará este periodo de ausencia. ¿Quieres continuar?",
  );
  if (!confirmed) return;
  vacationBusy.value = true;
  vacationError.value = "";
  try {
    await deleteVacation(vacationId);
    await refreshSharedData();
    dispatchPlannerDataUpdated();
  } catch (error) {
    vacationError.value =
      error instanceof Error
        ? error.message
        : "No se pudieron eliminar las vacaciones.";
  } finally {
    vacationBusy.value = false;
  }
}

onMounted(() => {
  window.addEventListener(
    PLANNER_OPEN_IMPORT_DIALOG_EVENT,
    handleOpenImportDialog,
  );
  window.addEventListener(
    PLANNER_OPEN_VACATIONS_DIALOG_EVENT,
    handleOpenVacationsDialog,
  );
});

onBeforeUnmount(() => {
  window.removeEventListener(
    PLANNER_OPEN_IMPORT_DIALOG_EVENT,
    handleOpenImportDialog,
  );
  window.removeEventListener(
    PLANNER_OPEN_VACATIONS_DIALOG_EVENT,
    handleOpenVacationsDialog,
  );
});
</script>

<template>
  <div
    v-if="canEditReports && vacationDialogOpen"
    class="confirm-overlay"
    @click.self="closeVacationsDialog"
  >
    <section
      class="confirm-dialog confirm-dialog--import vacation-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vacation-dialog-title"
    >
      <div class="confirm-dialog__header">
        <h2 id="vacation-dialog-title">Gestionar ausencias</h2>
        <button
          class="confirm-dialog__close"
          type="button"
          aria-label="Cerrar"
          @click="closeVacationsDialog"
        >
          X
        </button>
      </div>
      <p class="pedido-editor__copy">
        Registra vacaciones o ausencias por persona y rango de fechas. Sólo está
        disponible para usuarios con permiso de edición.
      </p>

      <div class="vacation-manager">
        <section class="vacation-panel">
          <div class="vacation-panel__header">
            <div>
              <h4>
                {{
                  isEditingVacation
                    ? "Editar ausencia"
                    : "Registrar nueva ausencia"
                }}
              </h4>
              <p class="vacation-panel__copy">
                {{
                  isEditingVacation
                    ? "Actualiza el periodo seleccionado."
                    : "Añade un nuevo periodo de ausencia."
                }}
              </p>
            </div>
          </div>

          <form class="vacation-form" @submit.prevent="submitVacation">
            <label class="field">
              <span class="field-label">Persona:</span>
              <select v-model="vacationDraft.person" :disabled="vacationBusy">
                <option value="">Selecciona una persona</option>
                <option
                  v-for="personOption in asignadoOptions"
                  :key="personOption"
                  :value="personOption"
                >
                  {{ personOption }}
                </option>
              </select>
            </label>

            <label class="field">
              <span class="field-label">Desde:</span>
              <input
                v-model="vacationDraft.startDate"
                :disabled="vacationBusy"
                type="date"
              />
            </label>

            <label class="field">
              <span class="field-label">Hasta:</span>
              <input
                v-model="vacationDraft.endDate"
                :disabled="vacationBusy"
                type="date"
              />
            </label>

            <fieldset class="absence-type-field" :disabled="vacationBusy">
              <legend class="field-label">Tipo de ausencia:</legend>
              <div class="absence-type-options">
                <label
                  v-for="absenceType in ABSENCE_TYPES"
                  :key="absenceType"
                  class="absence-type-option"
                >
                  <input
                    v-model="vacationDraft.absenceType"
                    type="radio"
                    name="absence-type-global"
                    :value="absenceType"
                    required
                  />
                  <span>{{ absenceType }}</span>
                </label>
              </div>
            </fieldset>

            <label class="field field--notes vacation-form__notes">
              <span class="field-label">Notas:</span>
              <textarea
                v-model="vacationDraft.notes"
                :disabled="vacationBusy"
                rows="2"
                placeholder="Opcional: verano, puente, media jornada..."
              />
            </label>

            <div class="vacation-form__actions">
              <button
                class="ghost-button"
                type="button"
                :disabled="vacationBusy"
                @click="resetVacationDraft"
              >
                {{ isEditingVacation ? "Cancelar edición" : "Limpiar" }}
              </button>
              <button
                class="primary-button"
                type="submit"
                :disabled="vacationBusy"
              >
                {{
                  vacationBusy
                    ? "Guardando..."
                    : isEditingVacation
                      ? "Guardar cambios"
                      : "Guardar ausencia"
                }}
              </button>
            </div>
          </form>
        </section>

        <section class="vacation-panel vacation-panel--filters">
          <div class="vacation-panel__header">
            <div>
              <h4>Listado global</h4>
              <p class="vacation-panel__copy">
                Consulta, filtra y edita todas las ausencias registradas.
              </p>
            </div>
          </div>

          <div class="vacation-filters">
            <label class="field">
              <span class="field-label">Persona:</span>
              <select v-model="vacationPersonFilter">
                <option value="">Todas las personas</option>
                <option
                  v-for="personOption in vacationPersonFilterOptions"
                  :key="personOption"
                  :value="personOption"
                >
                  {{ personOption }}
                </option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">Mes:</span>
              <input v-model="vacationMonthFilter" type="month" />
            </label>
            <label class="field">
              <span class="field-label">Estado:</span>
              <select v-model="vacationStatusFilter">
                <option value="all">Todas</option>
                <option value="active">Activas hoy</option>
                <option value="future">Futuras</option>
                <option value="past">Pasadas</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">Ordenar por:</span>
              <select v-model="vacationSort">
                <option value="start-asc">Inicio ascendente</option>
                <option value="start-desc">Inicio descendente</option>
                <option value="person-asc">Persona A-Z</option>
              </select>
            </label>
          </div>

          <div v-if="filteredVacations.length" class="vacation-table">
            <article
              v-for="vacation in filteredVacations"
              :key="vacation.id"
              class="vacation-table__row"
            >
              <div class="vacation-table__main">
                <strong>{{ vacation.person }}</strong>
                <span>{{
                  vacation.absenceType || "Tipo sin especificar"
                }}</span>
                <span
                  >{{ formatShortDate(vacation.startDate) }} -
                  {{ formatShortDate(vacation.endDate) }}</span
                >
                <span v-if="vacation.notes">{{ vacation.notes }}</span>
              </div>
              <div class="vacation-table__actions">
                <button
                  class="ghost-button"
                  type="button"
                  :disabled="vacationBusy"
                  @click="startVacationEdit(vacation)"
                >
                  Editar
                </button>
                <button
                  class="inline-remove"
                  type="button"
                  :disabled="vacationBusy"
                  @click="removeVacationRecord(vacation.id)"
                >
                  Eliminar
                </button>
              </div>
            </article>
          </div>
          <p v-else class="vacation-panel__copy">
            No hay ausencias que coincidan con los filtros.
          </p>
          <p v-if="vacationError" class="pedido-editor__error">
            {{ vacationError }}
          </p>
        </section>
      </div>

      <div class="confirm-dialog__actions">
        <button
          class="ghost-button"
          type="button"
          :disabled="vacationBusy"
          @click="closeVacationsDialog"
        >
          Cerrar
        </button>
      </div>
    </section>
  </div>

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
      <div class="confirm-dialog__header">
        <h2 id="import-dialog-title">Importar informes desde Excel</h2>
        <button
          class="confirm-dialog__close"
          type="button"
          aria-label="Cerrar"
          @click="closeImportDialog"
        >
          X
        </button>
      </div>
      <p class="pedido-editor__copy">
        La plantilla debe incluir las columnas <strong>Laborante</strong>,
        <strong>F.Muestreo</strong>, <strong>NºObra</strong>,
        <strong>Obra</strong>, <strong>Material</strong>,
        <strong>Población</strong>, <strong>Descripción</strong> y
        <strong>Planos</strong>.<br />La fecha de registro se calculará sumando
        cinco semanas a la fecha de muestreo.
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
      <p v-if="importError" class="pedido-editor__error">{{ importError }}</p>

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
              <span>{{ row.status === "ready" ? "Lista" : "Revisar" }}</span>
            </div>
            <div class="import-preview__grid">
              <div>
                <span>Fecha registro</span
                ><strong>{{ row.targetDate || "Sin calcular" }}</strong>
              </div>
              <div>
                <span>Fecha de campo</span
                ><strong>{{ row.fechaCampo || "Sin fecha" }}</strong>
              </div>
              <div>
                <span>Laborante</span
                ><strong>{{ row.laborante || "Sin laborante" }}</strong>
              </div>
              <div>
                <span>Referencia</span
                ><strong>{{ row.referencia || "Sin referencia" }}</strong>
              </div>
              <div>
                <span>Planos</span
                ><strong>{{
                  row.plano === "si"
                    ? "Sí"
                    : row.plano === "no"
                      ? "No"
                      : "Sin indicar"
                }}</strong>
              </div>
              <div>
                <span>Localidad</span
                ><strong>{{ row.localidad || "Sin localidad" }}</strong>
              </div>
            </div>
            <div class="import-preview__observaciones">
              <span>Observaciones</span>
              <p>{{ row.observaciones || "Sin observaciones" }}</p>
            </div>
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
</template>

<style scoped>
.vacation-dialog {
  width: min(960px, calc(100vw - 2rem));
}

.vacation-manager {
  display: grid;
  gap: 1rem;
}

.vacation-panel {
  display: grid;
  gap: 1rem;
  margin-bottom: 1.5rem;
  padding: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 1rem;
  background: rgba(248, 250, 252, 0.9);
}

.vacation-panel__header h4 {
  margin: 0;
}
.vacation-panel__copy {
  margin: 0.35rem 0 0;
  color: #475569;
}
.vacation-form {
  display: grid;
  gap: 0.85rem;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}
.vacation-form__notes {
  grid-column: 1 / -1;
}
.absence-type-field {
  grid-column: 1 / -1;
  margin: 0;
  padding: 0;
  border: 0;
}
.absence-type-options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  margin-top: 0.55rem;
}
.absence-type-option {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  cursor: pointer;
}
.vacation-form__actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  grid-column: 1 / -1;
}
.vacation-filters {
  display: grid;
  gap: 0.85rem;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}
.vacation-table {
  display: grid;
  gap: 0.85rem;
}
.vacation-table__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 1rem;
  background: rgba(255, 255, 255, 0.72);
}
.vacation-table__main {
  display: grid;
  gap: 0.3rem;
}
.vacation-table__main span {
  color: #475569;
}
.vacation-table__actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}
</style>
