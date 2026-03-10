<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { loadAllDays, loadSettings } from "../lib/planner-client";
import type { DayEntry } from "../lib/planner-types";

type PlanoFilter = "" | "si" | "no" | "pendiente";
type EntregadoFilter = "" | "si" | "no";

interface ReportListItem {
  id: string;
  dateKey: string;
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

const loading = ref(true);
const loadError = ref("");
const reports = ref<ReportListItem[]>([]);
const asignadoOptions = ref<string[]>([]);
const filters = ref<FiltersState>({ ...DEFAULT_FILTERS });

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
    filters.value.dateFrom > filters.value.dateTo
  ) {
    return "La fecha inicial no puede ser posterior a la final.";
  }

  return "";
});

const filteredReports = computed(() => {
  if (dateRangeError.value) {
    return [];
  }

  return reports.value.filter((report) => {
    if (filters.value.dateFrom && report.dateKey < filters.value.dateFrom) {
      return false;
    }

    if (filters.value.dateTo && report.dateKey > filters.value.dateTo) {
      return false;
    }

    if (
      normalizedFilters.value.referencia &&
      !normalize(report.referencia).includes(normalizedFilters.value.referencia)
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
  });
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

function resetFilters() {
  filters.value = { ...DEFAULT_FILTERS };
}

function printResults() {
  if (typeof window === "undefined" || filteredReports.value.length === 0) {
    return;
  }

  window.print();
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

  window.location.href = getEditUrl(report);
}

function mapEntryToListItem(dateKey: string, entry: DayEntry): ReportListItem {
  return {
    id: entry.id,
    dateKey,
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
    const [days, settings] = await Promise.all([loadAllDays(), loadSettings()]);
    asignadoOptions.value = settings.asignadoOptions;
    reports.value = Object.values(days)
      .flatMap((record) =>
        record.entries.map((entry) =>
          mapEntryToListItem(record.dateKey, entry),
        ),
      )
      .sort((left, right) => {
        const dateDifference = right.dateKey.localeCompare(left.dateKey);

        if (dateDifference !== 0) {
          return dateDifference;
        }

        return left.referencia.localeCompare(right.referencia, "es", {
          sensitivity: "base",
        });
      });
  } catch (error) {
    console.error(error);
    loadError.value = "No se pudieron cargar los informes guardados.";
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadReports();
});
</script>

<template>
  <main class="reports-page">
    <section class="reports-sheet">
      <header class="reports-header no-print">
        <div class="reports-header__copy">
          <h1>Listado de informes</h1>
          <p class="sidebar-copy">
            Filtra por cualquier campo del informe y genera un listado listo
            para imprimir.
          </p>
        </div>

        <div class="reports-header__actions">
          <a class="ghost-link" href="/">Volver a la agenda</a>
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

        <div class="reports-filters__actions">
          <button class="ghost-button" type="button" @click="resetFilters">
            Limpiar filtros
          </button>
        </div>
      </section>

      <p v-if="dateRangeError" class="reports-error no-print">
        {{ dateRangeError }}
      </p>

      <section class="reports-summary">
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

        <div v-if="activeFilterTags.length" class="reports-summary__chips">
          <span v-for="tag in activeFilterTags" :key="tag" class="reports-chip">
            {{ tag }}
          </span>
        </div>
      </section>

      <section class="reports-print-head only-print">
        <p class="eyebrow">Listado filtrado</p>
        <h1>Informes</h1>
        <p>Generado el {{ printTimestampLabel }}</p>
        <p>{{ resultsSummaryLabel }}</p>
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

      <section v-else class="reports-results">
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
      </section>
    </section>
  </main>
</template>
