<script setup lang="ts">
import { navigate } from "astro:transitions/client";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as xlsxModule from "xlsx";
import CompanyHeader from "./CompanyHeader.vue";
import {
  createDefaultPlannerSettings,
  loadAllDays,
  loadSettings,
} from "../lib/planner-client";
import { PLANNER_SETTINGS_UPDATED_EVENT } from "../lib/planner-ui-events";
import type { DayEntry, PlannerSettings } from "../lib/planner-types";

type PlanoFilter = "" | "si" | "no" | "pendiente";
type EntregadoFilter = "" | "si" | "no";
type SortField =
  | "dateKey"
  | "referencia"
  | "asignado"
  | "plano"
  | "localidad"
  | "observaciones"
  | "entregado";
type SortDirection = "asc" | "desc";

interface ReportListItem {
  id: string;
  dateKey: string;
  dateSortValue: number;
  referencia: string;
  asignado: string;
  plano: DayEntry["plano"];
  localidad: string;
  observaciones: string;
  entregado: boolean;
}

interface FiltersState {
  dateFrom: string;
  dateTo: string;
  referencia: string;
  asignado: string;
  plano: PlanoFilter;
  localidad: string;
  observaciones: string;
  entregado: EntregadoFilter;
}

const DEFAULT_FILTERS: FiltersState = {
  dateFrom: "",
  dateTo: "",
  referencia: "",
  asignado: "",
  plano: "",
  localidad: "",
  observaciones: "",
  entregado: "",
};

const DEFAULT_SORT_FIELD: SortField = "dateKey";
const DEFAULT_SORT_DIRECTION: SortDirection = "asc";

const SORT_FIELD_OPTIONS: Array<{ value: SortField; label: string }> = [
  { value: "dateKey", label: "Fecha" },
  { value: "referencia", label: "Referencia" },
  { value: "asignado", label: "Asignado" },
  { value: "plano", label: "Planos" },
  { value: "localidad", label: "Localidad" },
  { value: "observaciones", label: "Observaciones" },
  { value: "entregado", label: "Entregado" },
];

const loading = ref(true);
const loadError = ref("");
const exportError = ref("");
const exporting = ref(false);
const reports = ref<ReportListItem[]>([]);
const plannerSettings = ref<PlannerSettings>(createDefaultPlannerSettings());
const plannerSettingsReady = ref(false);
const asignadoOptions = ref<string[]>([]);
const filters = ref<FiltersState>({ ...DEFAULT_FILTERS });
const sortField = ref<SortField>(DEFAULT_SORT_FIELD);
const sortDirection = ref<SortDirection>(DEFAULT_SORT_DIRECTION);
const currentPage = ref(1);

const REPORTS_PER_PAGE = 25;
const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-ES")
    .trim();
}

function formatDate(dateKey: string) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${dateKey}T12:00:00`));
}

function formatDateLong(dateKey: string) {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${dateKey}T12:00:00`));
}

function formatPrintTimestamp(value: Date) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatExportTimestamp(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}_${hours}-${minutes}`;
}

function getXlsxModule() {
  return xlsxModule;
}

function downloadExcelFile(fileName: string, workbookData: ArrayBuffer) {
  if (typeof window === "undefined") {
    return;
  }

  const blob = new Blob([workbookData], { type: XLSX_MIME_TYPE });
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

function compareText(left: string, right: string) {
  return left.localeCompare(right, "es", {
    sensitivity: "base",
    numeric: true,
  });
}

function parseDateParts(value: string) {
  const trimmedValue = value.trim();
  const dateMatch = trimmedValue.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);

  if (dateMatch) {
    const year = Number.parseInt(dateMatch[1], 10);
    const month = Number.parseInt(dateMatch[2], 10);
    const day = Number.parseInt(dateMatch[3], 10);

    return { year, month, day };
  }

  const parsedDate = new Date(trimmedValue);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return {
    year: parsedDate.getFullYear(),
    month: parsedDate.getMonth() + 1,
    day: parsedDate.getDate(),
  };
}

function normalizeDateKey(dateKey: string) {
  const parts = parseDateParts(dateKey);

  if (!parts) {
    return dateKey.trim();
  }

  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getDateSortValue(dateKey: string) {
  const parts = parseDateParts(dateKey);

  if (!parts) {
    return 0;
  }

  return parts.year * 10000 + parts.month * 100 + parts.day;
}

function compareDateKeys(left: string, right: string) {
  return getDateSortValue(left) - getDateSortValue(right);
}

function applySortDirection(
  comparison: number,
  direction: SortDirection = sortDirection.value,
) {
  return direction === "asc" ? comparison : -comparison;
}

function getPlanoLabel(value: DayEntry["plano"]) {
  if (value === "si") {
    return "Si";
  }

  if (value === "no") {
    return "No";
  }

  return "Pendiente";
}

function getEntregadoLabel(value: boolean) {
  return value ? "Si" : "No";
}

function getSortFieldLabel(field: SortField) {
  return (
    SORT_FIELD_OPTIONS.find((option) => option.value === field)?.label ??
    "Fecha"
  );
}

function getSortDirectionLabel(field: SortField, direction: SortDirection) {
  if (field === "dateKey") {
    return direction === "asc"
      ? "de más antigua a más reciente"
      : "de más reciente a más antigua";
  }

  return direction === "asc" ? "ascendente" : "descendente";
}

function getDefaultSortDirection(field: SortField): SortDirection {
  return "asc";
}

function getReportFieldValue(report: ReportListItem, field: SortField) {
  switch (field) {
    case "dateKey":
      return report.dateKey;
    case "referencia":
      return report.referencia || "Sin referencia";
    case "asignado":
      return report.asignado || "Sin asignar";
    case "plano":
      return getPlanoLabel(report.plano);
    case "localidad":
      return report.localidad || "Sin localidad";
    case "observaciones":
      return report.observaciones || "Sin observaciones";
    case "entregado":
      return getEntregadoLabel(report.entregado);
  }
}

function compareReports(left: ReportListItem, right: ReportListItem) {
  if (sortField.value === "dateKey") {
    const dateComparison = left.dateSortValue - right.dateSortValue;

    if (dateComparison !== 0) {
      return applySortDirection(dateComparison);
    }

    const referenceComparison = compareText(
      left.referencia || "Sin referencia",
      right.referencia || "Sin referencia",
    );

    if (referenceComparison !== 0) {
      return applySortDirection(referenceComparison);
    }

    return applySortDirection(compareText(left.id, right.id));
  }

  const primaryComparison = compareText(
    getReportFieldValue(left, sortField.value),
    getReportFieldValue(right, sortField.value),
  );

  if (primaryComparison !== 0) {
    return applySortDirection(primaryComparison);
  }

  const dateFallback = left.dateSortValue - right.dateSortValue;

  if (dateFallback !== 0) {
    return applySortDirection(dateFallback, "desc");
  }

  const referenceFallback = compareText(
    left.referencia || "Sin referencia",
    right.referencia || "Sin referencia",
  );

  if (referenceFallback !== 0) {
    return referenceFallback;
  }

  return compareText(left.id, right.id);
}

function setSortField(field: SortField) {
  if (sortField.value === field) {
    sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
    return;
  }

  sortField.value = field;
  sortDirection.value = getDefaultSortDirection(field);
}

function getSortIndicator(field: SortField) {
  if (sortField.value !== field) {
    return "↕";
  }

  return sortDirection.value === "asc" ? "↑" : "↓";
}

function getAriaSort(field: SortField) {
  if (sortField.value !== field) {
    return "none";
  }

  return sortDirection.value === "asc" ? "ascending" : "descending";
}

const normalizedFilters = computed(() => ({
  referencia: normalize(filters.value.referencia),
  asignado: normalize(filters.value.asignado),
  localidad: normalize(filters.value.localidad),
  observaciones: normalize(filters.value.observaciones),
}));

const hasActiveFilters = computed(() =>
  Object.values(filters.value).some((value) => String(value).trim().length > 0),
);

const dateRangeError = computed(() => {
  if (
    filters.value.dateFrom &&
    filters.value.dateTo &&
    compareDateKeys(filters.value.dateFrom, filters.value.dateTo) > 0
  ) {
    return "La fecha inicial no puede ser posterior a la final.";
  }

  return "";
});

const filteredReports = computed(() => {
  if (dateRangeError.value) {
    return [];
  }

  return reports.value
    .filter((report) => {
      if (
        filters.value.dateFrom &&
        compareDateKeys(report.dateKey, filters.value.dateFrom) < 0
      ) {
        return false;
      }

      if (
        filters.value.dateTo &&
        compareDateKeys(report.dateKey, filters.value.dateTo) > 0
      ) {
        return false;
      }

      if (
        normalizedFilters.value.referencia &&
        !normalize(report.referencia).includes(
          normalizedFilters.value.referencia,
        )
      ) {
        return false;
      }

      if (
        normalizedFilters.value.asignado &&
        !normalize(report.asignado).includes(normalizedFilters.value.asignado)
      ) {
        return false;
      }

      if (filters.value.plano === "pendiente" && report.plano !== "") {
        return false;
      }

      if (
        filters.value.plano &&
        filters.value.plano !== "pendiente" &&
        report.plano !== filters.value.plano
      ) {
        return false;
      }

      if (
        normalizedFilters.value.localidad &&
        !normalize(report.localidad).includes(normalizedFilters.value.localidad)
      ) {
        return false;
      }

      if (
        normalizedFilters.value.observaciones &&
        !normalize(report.observaciones).includes(
          normalizedFilters.value.observaciones,
        )
      ) {
        return false;
      }

      if (filters.value.entregado === "si" && !report.entregado) {
        return false;
      }

      if (filters.value.entregado === "no" && report.entregado) {
        return false;
      }

      return true;
    })
    .sort(compareReports);
});

const totalPages = computed(() =>
  Math.max(1, Math.ceil(filteredReports.value.length / REPORTS_PER_PAGE)),
);

const paginatedReports = computed(() => {
  const start = (currentPage.value - 1) * REPORTS_PER_PAGE;
  return filteredReports.value.slice(start, start + REPORTS_PER_PAGE);
});

const paginationSummaryLabel = computed(() => {
  if (filteredReports.value.length === 0) {
    return "";
  }

  const start = (currentPage.value - 1) * REPORTS_PER_PAGE + 1;
  const end = Math.min(
    currentPage.value * REPORTS_PER_PAGE,
    filteredReports.value.length,
  );

  return `Mostrando ${start}-${end} de ${filteredReports.value.length}`;
});

const activeFilterTags = computed(() => {
  const tags: string[] = [];

  if (filters.value.dateFrom) {
    tags.push(`Desde ${formatDate(filters.value.dateFrom)}`);
  }

  if (filters.value.dateTo) {
    tags.push(`Hasta ${formatDate(filters.value.dateTo)}`);
  }

  if (filters.value.referencia.trim()) {
    tags.push(`Referencia: ${filters.value.referencia.trim()}`);
  }

  if (filters.value.asignado.trim()) {
    tags.push(`Asignado: ${filters.value.asignado.trim()}`);
  }

  if (filters.value.plano) {
    tags.push(
      `Planos: ${
        filters.value.plano === "pendiente"
          ? "Pendiente"
          : getPlanoLabel(filters.value.plano)
      }`,
    );
  }

  if (filters.value.localidad.trim()) {
    tags.push(`Localidad: ${filters.value.localidad.trim()}`);
  }

  if (filters.value.observaciones.trim()) {
    tags.push(`Observaciones: ${filters.value.observaciones.trim()}`);
  }

  if (filters.value.entregado) {
    tags.push(`Entregado: ${filters.value.entregado === "si" ? "Si" : "No"}`);
  }

  return tags;
});

const printTimestampLabel = computed(() => formatPrintTimestamp(new Date()));
const resultsSummaryLabel = computed(() => {
  const count = filteredReports.value.length;
  return `${count} ${count === 1 ? "informe" : "informes"} listados`;
});
const sortDirectionOptions = computed(() => [
  {
    value: "asc" as const,
    label: sortField.value === "dateKey" ? "Más antigua primero" : "Ascendente",
  },
  {
    value: "desc" as const,
    label:
      sortField.value === "dateKey" ? "Más reciente primero" : "Descendente",
  },
]);
const sortSummaryLabel = computed(
  () =>
    `Ordenado por ${getSortFieldLabel(sortField.value)} ${getSortDirectionLabel(
      sortField.value,
      sortDirection.value,
    )}.`,
);

function resetFilters() {
  filters.value = { ...DEFAULT_FILTERS };
}

function goToPreviousPage() {
  currentPage.value = Math.max(1, currentPage.value - 1);
}

function goToNextPage() {
  currentPage.value = Math.min(totalPages.value, currentPage.value + 1);
}

function goToFirstPage() {
  currentPage.value = 1;
}

function goToLastPage() {
  currentPage.value = totalPages.value;
}

async function printResults() {
  if (typeof window === "undefined" || filteredReports.value.length === 0) {
    return;
  }

  if (window.desktopPlanner?.printCurrentWindow) {
    try {
      await window.desktopPlanner.printCurrentWindow();
      return;
    } catch (error) {
      console.error("No se pudo abrir la impresion nativa.", error);
    }
  }

  window.print();
}

function buildExportRows() {
  return filteredReports.value.map((report) => ({
    Fecha: formatDate(report.dateKey),
    Referencia: report.referencia || "",
    Asignado: report.asignado || "",
    Planos: getPlanoLabel(report.plano),
    Localidad: report.localidad || "",
    Observaciones: report.observaciones || "",
    Entregado: getEntregadoLabel(report.entregado),
  }));
}

async function exportResults() {
  if (
    typeof window === "undefined" ||
    filteredReports.value.length === 0 ||
    exporting.value
  ) {
    return;
  }

  exporting.value = true;
  exportError.value = "";

  try {
    const xlsx = getXlsxModule();
    const exportedAt = new Date();
    const workbook = xlsx.utils.book_new();

    const summarySheet = xlsx.utils.aoa_to_sheet([
      ["Generado el", formatPrintTimestamp(exportedAt)],
      ["Resultados", filteredReports.value.length],
      ["Orden", sortSummaryLabel.value],
      [
        "Filtros activos",
        activeFilterTags.value.length > 0
          ? activeFilterTags.value.join(" | ")
          : "Sin filtros",
      ],
    ]);
    summarySheet["!cols"] = [{ wch: 18 }, { wch: 80 }];

    const dataSheet = xlsx.utils.json_to_sheet(buildExportRows());
    dataSheet["!cols"] = [
      { wch: 14 },
      { wch: 20 },
      { wch: 20 },
      { wch: 12 },
      { wch: 20 },
      { wch: 48 },
      { wch: 12 },
    ];

    if (dataSheet["!ref"]) {
      dataSheet["!autofilter"] = { ref: dataSheet["!ref"] };
    }

    xlsx.utils.book_append_sheet(workbook, summarySheet, "Resumen");
    xlsx.utils.book_append_sheet(workbook, dataSheet, "Informes");

    const workbookData = xlsx.write(workbook, {
      bookType: "xlsx",
      type: "array",
      compression: true,
    });

    downloadExcelFile(
      `informes-${formatExportTimestamp(exportedAt)}.xlsx`,
      workbookData,
    );
  } catch (error) {
    console.error(error);
    exportError.value = "No se pudo exportar el listado a Excel.";
  } finally {
    exporting.value = false;
  }
}

function getEditUrl(report: ReportListItem) {
  const params = new URLSearchParams({
    date: report.dateKey,
    entry: report.id,
  });

  return `/?${params.toString()}`;
}

function openReport(report: ReportListItem) {
  if (typeof window === "undefined") {
    return;
  }

  void navigate(getEditUrl(report));
}

function mapEntryToListItem(dateKey: string, entry: DayEntry): ReportListItem {
  const normalizedDateKey = normalizeDateKey(dateKey);

  return {
    id: entry.id,
    dateKey: normalizedDateKey,
    dateSortValue: getDateSortValue(normalizedDateKey),
    referencia: entry.referencia.trim(),
    asignado: entry.asignado.trim(),
    plano: entry.plano,
    localidad: entry.localidad.trim(),
    observaciones: entry.observaciones.trim(),
    entregado: entry.entregado,
  };
}

async function loadReports() {
  loading.value = true;
  loadError.value = "";

  try {
    const daysPromise = loadAllDays();
    const settings = await loadSettings();
    plannerSettings.value = settings;
    plannerSettingsReady.value = true;
    asignadoOptions.value = settings.asignadoOptions;
    const days = await daysPromise;
    reports.value = Object.values(days).flatMap((record) =>
      record.entries.map((entry) => mapEntryToListItem(record.dateKey, entry)),
    );
  } catch (error) {
    console.error(error);
    loadError.value = "No se pudieron cargar los informes guardados.";
    plannerSettingsReady.value = true;
  } finally {
    loading.value = false;
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

onMounted(() => {
  window.addEventListener(
    PLANNER_SETTINGS_UPDATED_EVENT,
    handlePlannerSettingsUpdated,
  );
  void loadReports();
});

onBeforeUnmount(() => {
  window.removeEventListener(
    PLANNER_SETTINGS_UPDATED_EVENT,
    handlePlannerSettingsUpdated,
  );
});

watch(filteredReports, () => {
  currentPage.value = 1;
  exportError.value = "";
});
</script>

<template>
  <main class="reports-page">
    <section class="reports-sheet">
      <header class="reports-header no-print">
        <p class="sidebar-copy reports-header__intro">
          Filtra por cualquier campo del informe y genera un listado listo para
          imprimir o exportar a Excel.
        </p>

        <div class="reports-header__actions">
          <a class="ghost-link" href="/">Volver a la agenda</a>
          <button
            class="ghost-button"
            type="button"
            :disabled="filteredReports.length === 0 || exporting"
            @click="exportResults"
          >
            {{ exporting ? "Exportando..." : "Exportar Excel" }}
          </button>
          <button
            class="primary-button"
            type="button"
            :disabled="filteredReports.length === 0"
            @click="printResults"
          >
            Imprimir listado
          </button>
        </div>
      </header>

      <p v-if="exportError" class="reports-error no-print" aria-live="polite">
        {{ exportError }}
      </p>

      <section class="reports-filters no-print">
        <label class="field">
          <span class="field-label">Fecha desde:</span>
          <input v-model="filters.dateFrom" type="date" />
        </label>

        <label class="field">
          <span class="field-label">Fecha hasta:</span>
          <input v-model="filters.dateTo" type="date" />
        </label>

        <label class="field">
          <span class="field-label">Referencia:</span>
          <input
            v-model="filters.referencia"
            type="text"
            placeholder="Ej. 2548-A"
          />
        </label>

        <label class="field">
          <span class="field-label">Asignado:</span>
          <select v-model="filters.asignado">
            <option value="">Todos</option>
            <option
              v-for="asignadoOption in asignadoOptions"
              :key="asignadoOption"
              :value="asignadoOption"
            >
              {{ asignadoOption }}
            </option>
          </select>
        </label>

        <label class="field">
          <span class="field-label">Planos:</span>
          <select v-model="filters.plano">
            <option value="">Todos</option>
            <option value="si">Si</option>
            <option value="no">No</option>
            <option value="pendiente">Pendiente</option>
          </select>
        </label>

        <label class="field">
          <span class="field-label">Localidad:</span>
          <input
            v-model="filters.localidad"
            type="text"
            placeholder="Ej. Madrid"
          />
        </label>

        <label class="field field--wide">
          <span class="field-label">Observaciones:</span>
          <input
            v-model="filters.observaciones"
            type="text"
            placeholder="Texto contenido en observaciones"
          />
        </label>

        <label class="field">
          <span class="field-label">Entregado:</span>
          <select v-model="filters.entregado">
            <option value="">Todos</option>
            <option value="si">Si</option>
            <option value="no">No</option>
          </select>
        </label>

        <label class="field">
          <span class="field-label">Ordenar por:</span>
          <select v-model="sortField">
            <option
              v-for="sortFieldOption in SORT_FIELD_OPTIONS"
              :key="sortFieldOption.value"
              :value="sortFieldOption.value"
            >
              {{ sortFieldOption.label }}
            </option>
          </select>
        </label>

        <label class="field">
          <span class="field-label">Sentido:</span>
          <select v-model="sortDirection">
            <option
              v-for="directionOption in sortDirectionOptions"
              :key="directionOption.value"
              :value="directionOption.value"
            >
              {{ directionOption.label }}
            </option>
          </select>
        </label>

        <div class="reports-filters__actions">
          <button class="ghost-button" type="button" @click="resetFilters">
            Limpiar filtros
          </button>
        </div>
      </section>

      <p v-if="dateRangeError" class="reports-error no-print">
        {{ dateRangeError }}
      </p>

      <section class="reports-summary no-print">
        <div class="reports-summary__copy">
          <strong>{{ resultsSummaryLabel }}</strong>
          <span>
            {{
              hasActiveFilters
                ? "Filtros activos aplicados"
                : "Sin filtros activos"
            }}
          </span>
        </div>

        <p
          v-if="filteredReports.length > 0"
          class="reports-summary__pagination no-print"
        >
          {{ paginationSummaryLabel }}
        </p>

        <p class="reports-summary__sort no-print">
          {{ sortSummaryLabel }}
        </p>

        <div v-if="activeFilterTags.length" class="reports-summary__chips">
          <span v-for="tag in activeFilterTags" :key="tag" class="reports-chip">
            {{ tag }}
          </span>
        </div>
      </section>

      <section
        v-if="plannerSettingsReady"
        class="reports-print-head only-print"
      >
        <CompanyHeader
          :settings="plannerSettings"
          fallback-name=""
          fallback-subtitle=""
          compact
        />
        <p>Generado el {{ printTimestampLabel }}</p>
        <p>{{ resultsSummaryLabel }}</p>
        <p>{{ sortSummaryLabel }}</p>
        <p v-if="activeFilterTags.length">
          {{ activeFilterTags.join(" · ") }}
        </p>
      </section>

      <div v-if="loading" class="loading-state">Cargando informes...</div>

      <p v-else-if="loadError" class="reports-error">
        {{ loadError }}
      </p>

      <section v-else-if="reports.length === 0" class="empty-day">
        <p class="empty-day__title">No hay informes guardados.</p>
        <p class="empty-day__copy">
          Cuando empieces a registrar informes en la agenda aparecerán aquí.
        </p>
      </section>

      <section v-else-if="filteredReports.length === 0" class="empty-day">
        <p class="empty-day__title">Ningún informe coincide con el filtro.</p>
        <p class="empty-day__copy">
          Ajusta los criterios o limpia el formulario para ver más resultados.
        </p>
      </section>

      <section v-else class="reports-results no-print">
        <div
          v-if="totalPages > 1"
          class="reports-pagination no-print"
          aria-label="Paginación del listado de informes"
        >
          <button
            class="ghost-button"
            type="button"
            :disabled="currentPage === 1"
            @click="goToFirstPage"
          >
            Primera
          </button>

          <button
            class="ghost-button"
            type="button"
            :disabled="currentPage === 1"
            @click="goToPreviousPage"
          >
            Anterior
          </button>

          <span class="reports-pagination__status">
            Página {{ currentPage }} de {{ totalPages }}
          </span>

          <button
            class="ghost-button"
            type="button"
            :disabled="currentPage === totalPages"
            @click="goToNextPage"
          >
            Siguiente
          </button>

          <button
            class="ghost-button"
            type="button"
            :disabled="currentPage === totalPages"
            @click="goToLastPage"
          >
            Última
          </button>
        </div>

        <div class="reports-table-wrap">
          <table class="reports-table">
            <thead>
              <tr>
                <th :aria-sort="getAriaSort('dateKey')">
                  <button
                    class="reports-sort-button"
                    type="button"
                    @click="setSortField('dateKey')"
                  >
                    <span>Fecha</span>
                    <span
                      class="reports-sort-button__icon"
                      :class="{
                        'is-active': sortField === 'dateKey',
                      }"
                      aria-hidden="true"
                    >
                      {{ getSortIndicator("dateKey") }}
                    </span>
                  </button>
                </th>
                <th :aria-sort="getAriaSort('referencia')">
                  <button
                    class="reports-sort-button"
                    type="button"
                    @click="setSortField('referencia')"
                  >
                    <span>Referencia</span>
                    <span
                      class="reports-sort-button__icon"
                      :class="{
                        'is-active': sortField === 'referencia',
                      }"
                      aria-hidden="true"
                    >
                      {{ getSortIndicator("referencia") }}
                    </span>
                  </button>
                </th>
                <th :aria-sort="getAriaSort('asignado')">
                  <button
                    class="reports-sort-button"
                    type="button"
                    @click="setSortField('asignado')"
                  >
                    <span>Asignado</span>
                    <span
                      class="reports-sort-button__icon"
                      :class="{
                        'is-active': sortField === 'asignado',
                      }"
                      aria-hidden="true"
                    >
                      {{ getSortIndicator("asignado") }}
                    </span>
                  </button>
                </th>
                <th :aria-sort="getAriaSort('plano')">
                  <button
                    class="reports-sort-button"
                    type="button"
                    @click="setSortField('plano')"
                  >
                    <span>Planos</span>
                    <span
                      class="reports-sort-button__icon"
                      :class="{
                        'is-active': sortField === 'plano',
                      }"
                      aria-hidden="true"
                    >
                      {{ getSortIndicator("plano") }}
                    </span>
                  </button>
                </th>
                <th :aria-sort="getAriaSort('localidad')">
                  <button
                    class="reports-sort-button"
                    type="button"
                    @click="setSortField('localidad')"
                  >
                    <span>Localidad</span>
                    <span
                      class="reports-sort-button__icon"
                      :class="{
                        'is-active': sortField === 'localidad',
                      }"
                      aria-hidden="true"
                    >
                      {{ getSortIndicator("localidad") }}
                    </span>
                  </button>
                </th>
                <th
                  class="reports-table__notes"
                  :aria-sort="getAriaSort('observaciones')"
                >
                  <button
                    class="reports-sort-button"
                    type="button"
                    @click="setSortField('observaciones')"
                  >
                    <span>Observaciones</span>
                    <span
                      class="reports-sort-button__icon"
                      :class="{
                        'is-active': sortField === 'observaciones',
                      }"
                      aria-hidden="true"
                    >
                      {{ getSortIndicator("observaciones") }}
                    </span>
                  </button>
                </th>
                <th :aria-sort="getAriaSort('entregado')">
                  <button
                    class="reports-sort-button"
                    type="button"
                    @click="setSortField('entregado')"
                  >
                    <span>Entregado</span>
                    <span
                      class="reports-sort-button__icon"
                      :class="{
                        'is-active': sortField === 'entregado',
                      }"
                      aria-hidden="true"
                    >
                      {{ getSortIndicator("entregado") }}
                    </span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="report in paginatedReports"
                :key="`${report.dateKey}-${report.id}`"
                class="reports-table__row"
                tabindex="0"
                role="link"
                :aria-label="`Editar informe ${report.referencia || 'sin referencia'} del ${formatDate(report.dateKey)}`"
                @click="openReport(report)"
                @keydown.enter.prevent="openReport(report)"
                @keydown.space.prevent="openReport(report)"
              >
                <td>
                  <strong>{{ formatDate(report.dateKey) }}</strong>
                  <span>{{ formatDateLong(report.dateKey) }}</span>
                </td>
                <td>{{ report.referencia || "Sin referencia" }}</td>
                <td>{{ report.asignado || "Sin asignar" }}</td>
                <td>{{ getPlanoLabel(report.plano) }}</td>
                <td>{{ report.localidad || "Sin localidad" }}</td>
                <td class="reports-table__notes">
                  {{ report.observaciones || "Sin observaciones" }}
                </td>
                <td>{{ getEntregadoLabel(report.entregado) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          v-if="totalPages > 1"
          class="reports-pagination reports-pagination--bottom no-print"
          aria-label="Paginación inferior del listado de informes"
        >
          <button
            class="ghost-button"
            type="button"
            :disabled="currentPage === 1"
            @click="goToFirstPage"
          >
            Primera
          </button>

          <button
            class="ghost-button"
            type="button"
            :disabled="currentPage === 1"
            @click="goToPreviousPage"
          >
            Anterior
          </button>

          <span class="reports-pagination__status">
            Página {{ currentPage }} de {{ totalPages }}
          </span>

          <button
            class="ghost-button"
            type="button"
            :disabled="currentPage === totalPages"
            @click="goToNextPage"
          >
            Siguiente
          </button>

          <button
            class="ghost-button"
            type="button"
            :disabled="currentPage === totalPages"
            @click="goToLastPage"
          >
            Última
          </button>
        </div>
      </section>

      <section
        v-if="
          !loading &&
          !loadError &&
          reports.length > 0 &&
          filteredReports.length > 0
        "
        class="reports-results only-print"
      >
        <div class="reports-table-wrap">
          <table class="reports-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Referencia</th>
                <th>Asignado</th>
                <th>Planos</th>
                <th>Localidad</th>
                <th class="reports-table__notes">Observaciones</th>
                <th>Entregado</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="report in filteredReports"
                :key="`print-${report.dateKey}-${report.id}`"
                class="reports-table__row"
              >
                <td>
                  <strong>{{ formatDate(report.dateKey) }}</strong>
                  <span>{{ formatDateLong(report.dateKey) }}</span>
                </td>
                <td>{{ report.referencia || "Sin referencia" }}</td>
                <td>{{ report.asignado || "Sin asignar" }}</td>
                <td>{{ getPlanoLabel(report.plano) }}</td>
                <td>{{ report.localidad || "Sin localidad" }}</td>
                <td class="reports-table__notes">
                  {{ report.observaciones || "Sin observaciones" }}
                </td>
                <td>{{ getEntregadoLabel(report.entregado) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  </main>
</template>
