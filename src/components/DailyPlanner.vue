<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import LocalityAutocomplete from "./LocalityAutocomplete.vue";
import {
  createEmptyEntry,
  createEmptyDay,
  loadDay,
  loadDaysForMonth,
  loadSettings,
  saveDay,
  saveSettings,
} from "../lib/planner-client";
import type { DayRecord } from "../lib/planner-types";

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

const selectedDate = ref(todayKey());
const viewMode = ref<"day" | "month">("month");
const dayRecord = ref<DayRecord>(createEmptyDay(selectedDate.value));
const loading = ref(true);
const monthLoading = ref(true);
const savingState = ref<"idle" | "saving" | "saved" | "error">("idle");
const hydrating = ref(false);
const monthRecords = ref<Record<string, DayRecord>>({});
const asignadoOptions = ref<string[]>([]);
const asignadoEditorOpen = ref(false);
const newAsignadoOption = ref("");
const asignadoOptionError = ref("");

let saveTimer: number | undefined;
let dayLoadRequest = 0;
let monthLoadRequest = 0;

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

function normalizeAsignadoOption(value: string) {
  return value.trim().toLocaleLowerCase("es-ES");
}

function getAsignadoSelectOptions(currentValue: string) {
  if (!currentValue || asignadoOptions.value.includes(currentValue)) {
    return asignadoOptions.value;
  }

  return [currentValue, ...asignadoOptions.value];
}

function cloneRecord(record: DayRecord): DayRecord {
  return {
    ...record,
    entries: record.entries.map((entry) => ({ ...entry })),
  };
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

async function persistDay() {
  savingState.value = "saving";

  try {
    dayRecord.value = await saveDay(dayRecord.value);
    syncMonthRecord(dayRecord.value);
    savingState.value = "saved";
  } catch (error) {
    console.error(error);
    savingState.value = "error";
  }
}

async function persistAsignadoOptions(nextOptions: string[]) {
  savingState.value = "saving";

  try {
    const settings = await saveSettings({ asignadoOptions: nextOptions });
    asignadoOptions.value = settings.asignadoOptions;
    savingState.value = "saved";
  } catch (error) {
    console.error(error);
    savingState.value = "error";
  }
}

function queueSave() {
  if (hydrating.value) {
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
    const record = await loadDay(dateKey);

    if (requestId !== dayLoadRequest) {
      return;
    }

    dayRecord.value = record;
    syncMonthRecord(record);
    savingState.value = "idle";
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
    const records = await loadDaysForMonth(targetMonthKey);

    if (requestId !== monthLoadRequest) {
      return;
    }

    monthRecords.value = records;
    savingState.value = "idle";
  } finally {
    if (requestId === monthLoadRequest) {
      monthLoading.value = false;
    }
  }
}

async function loadAsignadoOptions() {
  try {
    const settings = await loadSettings();
    asignadoOptions.value = settings.asignadoOptions;
  } catch (error) {
    console.error(error);
    asignadoOptionError.value =
      "No se pudieron cargar las opciones de asignado.";
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

function openDayFromMonth(dateKey: string) {
  asignadoEditorOpen.value = false;
  viewMode.value = "day";

  if (selectedDate.value === dateKey) {
    void loadSelectedDay(dateKey);
    return;
  }

  selectedDate.value = dateKey;
}

function summarizeDay(record: DayRecord | null) {
  if (!record || record.entries.length === 0) {
    return {
      countLabel: "Sin actividad",
      preview: [],
      extraCount: 0,
    };
  }

  const preview = record.entries.slice(0, 3).map((entry) => ({
    id: entry.id,
    referencia: entry.referencia.trim() || "Sin referencia",
    localidad: entry.localidad.trim() || "Sin localidad",
    plano:
      entry.plano === "si"
        ? "Con planos"
        : entry.plano === "no"
          ? "Sin planos"
          : "Sin planos",
  }));

  return {
    countLabel: `${record.entries.length} ${
      record.entries.length === 1 ? "informe" : "informes"
    }`,
    preview,
    extraCount: Math.max(0, record.entries.length - preview.length),
  };
}

function addRow() {
  dayRecord.value.entries.push(createEmptyEntry());
  queueSave();
}

function removeRow(id: string) {
  dayRecord.value.entries = dayRecord.value.entries.filter(
    (entry) => entry.id !== id,
  );
  queueSave();
}

function toggleAsignadoEditor() {
  asignadoEditorOpen.value = !asignadoEditorOpen.value;
  asignadoOptionError.value = "";
}

async function addAsignadoOption() {
  const nextOption = newAsignadoOption.value.trim();
  const normalized = normalizeAsignadoOption(nextOption);

  if (!nextOption) {
    asignadoOptionError.value = "Escribe un nombre para la opcion.";
    return;
  }

  if (
    asignadoOptions.value.some(
      (option) => normalizeAsignadoOption(option) === normalized,
    )
  ) {
    asignadoOptionError.value = "Esa opcion ya existe.";
    return;
  }

  asignadoOptionError.value = "";
  newAsignadoOption.value = "";
  await persistAsignadoOptions([...asignadoOptions.value, nextOption]);
}

async function removeAsignadoOption(optionToRemove: string) {
  const nextOptions = asignadoOptions.value.filter(
    (option) => option !== optionToRemove,
  );

  if (nextOptions.length === 0) {
    asignadoOptionError.value = "Debe quedar al menos una opcion disponible.";
    return;
  }

  asignadoOptionError.value = "";
  await persistAsignadoOptions(nextOptions);
}

watch(selectedDate, (nextDate, previousDate) => {
  void loadSelectedDay(nextDate);

  if (nextDate.slice(0, 7) !== previousDate.slice(0, 7)) {
    void loadSelectedMonth(nextDate.slice(0, 7));
  }
});

watch(
  dayRecord,
  () => {
    syncMonthRecord(dayRecord.value);
    queueSave();
  },
  { deep: true },
);

onMounted(() => {
  void loadAsignadoOptions();
  void loadSelectedDay();
  void loadSelectedMonth();
});
</script>

<template>
  <main class="planner-app">
    <section class="planner-sheet">
      <section class="sheet-toolbar">
        <div class="view-switch">
          <button
            class="ghost-button"
            :class="{ 'is-active': viewMode === 'day' }"
            type="button"
            @click="viewMode = 'day'"
          >
            Vista diaria
          </button>
          <button
            class="ghost-button"
            :class="{ 'is-active': viewMode === 'month' }"
            type="button"
            @click="viewMode = 'month'"
          >
            Vista mensual
          </button>
        </div>

        <div class="toolbar-group toolbar-group--navigation">
          <button class="ghost-button" type="button" @click="shiftDay(-1)">
            {{ viewMode === "day" ? "Dia anterior" : "Mes anterior" }}
          </button>
          <button class="ghost-button" type="button" @click="jumpToToday">
            Hoy
          </button>
          <button class="ghost-button" type="button" @click="shiftDay(1)">
            {{ viewMode === "day" ? "Dia siguiente" : "Mes siguiente" }}
          </button>
        </div>

        <div class="toolbar-group toolbar-group--date">
          <label class="date-field">
            <input v-model="selectedDate" type="date" />
          </label>
        </div>

        <div class="sheet-actions">
          <span class="save-pill" :data-state="savingState">
            {{
              savingState === "saving"
                ? "Guardando..."
                : savingState === "saved"
                  ? "Guardado"
                  : savingState === "error"
                    ? "Error al guardar"
                    : "Listo"
            }}
          </span>
          <button
            class="soft-button"
            type="button"
            @click="toggleAsignadoEditor"
          >
            {{ asignadoEditorOpen ? "Cerrar asignados" : "Editar asignados" }}
          </button>
          <button class="primary-button" type="button" @click="addRow">
            Anadir fila
          </button>
        </div>
      </section>

      <section v-if="viewMode === 'month'" class="month-summary">
        <h3>{{ formattedMonthTitle }}</h3>
      </section>
      <section v-else class="month-summary">
        <h3>{{ formattedTitle }}</h3>
      </section>

      <section v-if="asignadoEditorOpen" class="pedido-editor">
        <div class="pedido-editor__header">
          <div>
            <p class="eyebrow">Opciones de asignado</p>
            <p class="pedido-editor__copy">
              Anade o elimina las opciones que apareceran en el dropdown de
              asignado.
            </p>
          </div>
        </div>

        <div class="pedido-editor__form">
          <label class="field">
            <span class="field-label">Nueva opcion</span>
            <input
              v-model="newAsignadoOption"
              type="text"
              placeholder="Nombre de la opcion"
              @keydown.enter.prevent="addAsignadoOption"
            />
          </label>

          <button
            class="primary-button"
            type="button"
            @click="addAsignadoOption"
          >
            Anadir opcion
          </button>
        </div>

        <p v-if="asignadoOptionError" class="pedido-editor__error">
          {{ asignadoOptionError }}
        </p>

        <div class="pedido-editor__list">
          <article
            v-for="asignadoOption in asignadoOptions"
            :key="asignadoOption"
            class="pedido-chip"
          >
            <span>{{ asignadoOption }}</span>
            <button
              class="pedido-chip__remove"
              type="button"
              @click="removeAsignadoOption(asignadoOption)"
            >
              Quitar
            </button>
          </article>
        </div>
      </section>

      <div v-if="isCurrentViewLoading" class="loading-state">
        Cargando el dia seleccionado...
      </div>

      <section v-else-if="viewMode === 'month'" class="month-calendar">
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
            :class="{ 'is-empty': !cell, 'is-today': cell?.isToday }"
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
                    <em>Ref. {{ item.referencia }}</em>
                    <span>{{ item.localidad }}</span>
                    <em>{{ item.plano }}</em>
                  </li>
                </ul>
                <span
                  v-if="summarizeDay(cell.record).extraCount > 0"
                  class="month-card__more"
                >
                  +{{ summarizeDay(cell.record).extraCount }} mas
                </span>
              </button>
            </template>
          </article>
        </div>
      </section>

      <div v-else class="sheet-table-wrap">
        <div v-if="dayRecord.entries.length === 0" class="empty-day">
          <p class="empty-day__title">Este día no tiene informes.</p>
          <p class="empty-day__copy">
            Puedes dejarlo vacio o crear una nueva fila cuando la necesites.
          </p>
          <button class="primary-button" type="button" @click="addRow">
            Anadir primera fila
          </button>
        </div>

        <div v-else class="sheet-table">
          <article
            v-for="(entry, index) in dayRecord.entries"
            :key="entry.id"
            class="sheet-grid sheet-grid--row"
          >
            <div class="row-topbar">
              <span class="row-marker">{{ index + 1 }}</span>
              <div class="row-status">
                <strong>Ref. {{ entry.referencia || "Sin referencia" }}</strong>
              </div>
              <button
                class="inline-remove"
                type="button"
                @click="removeRow(entry.id)"
              >
                Quitar
              </button>
            </div>

            <div class="sheet-grid sheet-grid--body">
              <label class="field">
                <span class="field-label">Referencia:</span>
                <input v-model="entry.referencia" type="text" />
              </label>

              <label class="field">
                <span class="field-label">Asignado:</span>
                <select v-model="entry.asignado">
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
                <select v-model="entry.plano">
                  <option value="si">Si</option>
                  <option value="no">No</option>
                </select>
              </label>

              <label class="field">
                <span class="field-label">Localidad:</span>
                <LocalityAutocomplete v-model="entry.localidad" />
              </label>

              <label class="field">
                <span class="field-label">Observaciones:</span>
                <textarea
                  v-model="entry.observaciones"
                  rows="3"
                  placeholder="Notas de montaje, materiales, seguimiento..."
                />
              </label>

              <label class="field field--checkbox">
                <span class="field-label">Entregado</span>
                <input v-model="entry.entregado" type="checkbox" />
              </label>
            </div>
          </article>
        </div>
      </div>
    </section>
  </main>
</template>
