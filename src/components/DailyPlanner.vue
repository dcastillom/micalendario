<script setup lang="ts">
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
  type StorageModeStatus,
} from "../lib/supabase-client";
import {
  createEmptyEntry,
  createEmptyDay,
  loadAllDays,
  loadDay,
  loadDaysForMonth,
  loadSettings,
  openDesktopBackupFolder,
  restoreBackupSnapshot,
  selectDesktopBackup,
  saveDesktopBackup,
  saveDay,
  saveSettings,
} from "../lib/planner-client";
import type { DayEntry, DayRecord } from "../lib/planner-types";

const AUTO_BACKUP_INTERVAL_MS = 30 * 60 * 1000;
const AUTO_BACKUP_DEBOUNCE_MS = 20 * 1000;
const NEW_ENTRY_SCROLL_TOP_OFFSET = 140;
const MONTH_CARD_PREVIEW_LIMIT = 6;

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
const suppressAutoSave = ref(false);
const storageModeStatus = ref<StorageModeStatus>("checking");
const monthRecords = ref<Record<string, DayRecord>>({});
const allRecords = ref<Record<string, DayRecord>>({});
const asignadoOptions = ref<string[]>([]);
const asignadoEditorOpen = ref(false);
const newAsignadoOption = ref("");
const asignadoOptionError = ref("");
const referenceFilter = ref("");
const canOpenBackupFolder = ref(false);
const canRestoreBackup = ref(false);
const hasInitialized = ref(false);
const removeDialog = ref<{
  id: string;
  referencia: string;
  localidad: string;
} | null>(null);

let saveTimer: number | undefined;
let backupTimer: number | undefined;
let backupIntervalId: number | undefined;
let dayLoadRequest = 0;
let monthLoadRequest = 0;
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
    const hasTargetEntry = record.entries.some((entry) => entry.id === pendingEntryId);

    if (hasTargetEntry) {
      scrollToEntry(pendingEntryId);
      focusEntryField(pendingEntryId);
    }

    pendingEntryId = "";
  }

  suppressAutoSave.value = false;
}

async function persistDay() {
  savingState.value = "saving";

  try {
    const savedRecord = await saveDay(dayRecord.value);
    await applyLoadedDayRecord(savedRecord);
    savingState.value = "saved";
    queueDesktopBackup("day-save");
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
    queueDesktopBackup("settings-save");
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

    await applyLoadedDayRecord(record);
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

async function loadAllRecords() {
  try {
    allRecords.value = await loadAllDays();
  } catch (error) {
    console.error(error);
  }
}

async function runDesktopBackup(reason: string) {
  if (typeof window === "undefined" || !window.desktopPlanner?.saveBackup) {
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
  if (!canOpenBackupFolder.value) {
    return;
  }

  try {
    await openDesktopBackupFolder();
  } catch (error) {
    console.error("No se pudo abrir la carpeta de backups.", error);
  }
}

async function restoreBackup() {
  if (!canRestoreBackup.value) {
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
    asignadoOptions.value = settings.asignadoOptions;
  } catch (error) {
    console.error(error);
    asignadoOptionError.value =
      "No se pudieron cargar las opciones de asignado.";
  }
}

async function refreshStorageMode() {
  try {
    storageModeStatus.value = await detectStorageMode();
    console.info("[storage] mode", storageModeStatus.value);
  } catch (error) {
    console.error(error);
    storageModeStatus.value = "error";
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

function openMonthView() {
  viewMode.value = "month";
  referenceFilter.value = "";
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

function applyInitialNavigationState() {
  if (typeof window === "undefined") {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const dateParam = params.get("date")?.trim() ?? "";
  const entryParam = params.get("entry")?.trim() ?? "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    selectedDate.value = dateParam;
    viewMode.value = "day";
  }

  pendingEntryId = entryParam;
}

function openRemoveDialog(entry: DayEntry) {
  removeDialog.value = {
    id: entry.id,
    referencia: entry.referencia.trim() || "Sin referencia",
    localidad: entry.localidad.trim() || "Sin localidad",
  };
}

function closeRemoveDialog() {
  removeDialog.value = null;
}

async function addRow() {
  const entry = createEmptyEntry();
  dayRecord.value.entries.push(entry);
  queueSave();
  await nextTick();
  scrollToEntry(entry.id);
}

function removeRow(id: string) {
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
  queueSave();
}

function confirmRemoveRow() {
  if (!removeDialog.value) {
    return;
  }

  removeRow(removeDialog.value.id);
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && removeDialog.value) {
    closeRemoveDialog();
  }
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

    syncMonthRecord(dayRecord.value);
    syncAllRecordsRecord(dayRecord.value);
    queueSave();
  },
  { deep: true },
);

onMounted(() => {
  window.addEventListener("keydown", handleWindowKeydown);
  canOpenBackupFolder.value = Boolean(
    typeof window !== "undefined" && window.desktopPlanner?.openBackupFolder,
  );
  canRestoreBackup.value = Boolean(
    typeof window !== "undefined" && window.desktopPlanner?.selectBackup,
  );
  applyInitialNavigationState();
  void refreshStorageMode();
  void loadAllRecords();
  void loadAsignadoOptions();
  void loadSelectedDay();
  void loadSelectedMonth();
  hasInitialized.value = true;

  if (typeof window !== "undefined" && window.desktopPlanner?.saveBackup) {
    queueDesktopBackup("startup");
    backupIntervalId = window.setInterval(() => {
      void runDesktopBackup("interval");
    }, AUTO_BACKUP_INTERVAL_MS);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleWindowKeydown);

  if (saveTimer) {
    window.clearTimeout(saveTimer);
  }

  if (backupTimer) {
    window.clearTimeout(backupTimer);
  }

  if (backupIntervalId) {
    window.clearInterval(backupIntervalId);
  }
});
</script>

<template>
  <main class="planner-app">
    <section class="planner-sheet">
      <section
        class="sheet-toolbar"
        :class="{
          'sheet-toolbar--day': viewMode === 'day',
          'sheet-toolbar--month': viewMode === 'month',
        }"
      >
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
            @click="openMonthView"
          >
            Vista mensual
          </button>
        </div>

        <div class="toolbar-group toolbar-group--navigation">
          <button class="ghost-button" type="button" @click="shiftDay(-1)">
            {{ viewMode === "day" ? "Día anterior" : "Mes anterior" }}
          </button>
          <button class="ghost-button" type="button" @click="jumpToToday">
            Hoy
          </button>
          <button class="ghost-button" type="button" @click="shiftDay(1)">
            {{ viewMode === "day" ? "Día siguiente" : "Mes siguiente" }}
          </button>
        </div>

        <div class="toolbar-group toolbar-group--date">
          <label class="date-field">
            <input v-model="selectedDate" type="date" />
          </label>
        </div>

        <div v-if="viewMode === 'month'" class="toolbar-search">
          <label class="field month-summary__search">
            <input
              v-model="referenceFilter"
              type="text"
              placeholder="Busca por referencia"
            />
          </label>
        </div>

        <div class="sheet-actions">
          <a class="ghost-link" href="/filtros">Filtros e impresión</a>
          <!-- <span class="save-pill" :data-state="savingState">
            {{ savingStateLabel }}
          </span> -->
          <button
            v-if="viewMode === 'day'"
            class="soft-button"
            type="button"
            @click="toggleAsignadoEditor"
          >
            {{ asignadoEditorOpen ? "Cerrar asignados" : "Editar asignados" }}
          </button>
          <button
            v-if="viewMode === 'day'"
            class="primary-button"
            type="button"
            @click="addRow"
          >
            Añadir informe
          </button>
        </div>
      </section>

      <section
        v-if="viewMode === 'month' && normalizedReferenceFilter.length === 0"
        class="month-summary"
      >
        <div class="month-summary__heading">
          <h3>{{ formattedMonthTitle }}</h3>
        </div>
      </section>
      <section v-else-if="viewMode === 'day'" class="month-summary">
        <h3>{{ formattedTitle }}</h3>
      </section>

      <section
        v-if="viewMode === 'month' && normalizedReferenceFilter.length"
        class="filter-panel"
      >
        <div v-if="filteredReferenceResults.length" class="filter-results">
          <button
            v-for="result in filteredReferenceResults"
            :key="`${result.dateKey}-${result.id}`"
            class="filter-result"
            type="button"
            @click="openDayFromMonth(result.dateKey)"
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

      <section v-if="asignadoEditorOpen" class="pedido-editor">
        <div class="pedido-editor__header">
          <div>
            <p class="pedido-editor__copy">
              Añade o elimina las opciones que aparecerán en el dropdown de
              asignado.
            </p>
          </div>
        </div>

        <div class="pedido-editor__form">
          <label class="field">
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
            Añadir opción
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
              Eliminar
            </button>
          </article>
        </div>
      </section>

      <div v-if="isCurrentViewLoading" class="loading-state">
        Cargando el dia seleccionado...
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
            Puedes dejarlo vacío o crear una nueva fila cuando la necesites.
          </p>
          <button class="primary-button" type="button" @click="addRow">
            Añadir primer informe
          </button>
        </div>

        <div v-else class="sheet-table">
          <article
            v-for="(entry, index) in dayRecord.entries"
            :key="entry.id"
            :ref="(element) => setEntryRowRef(entry.id, element)"
            class="sheet-grid sheet-grid--row"
          >
            <div class="row-topbar">
              <span class="row-marker">{{ index + 1 }}</span>
              <div class="row-status">
                <strong>{{ entry.referencia || "Sin referencia" }}</strong>
              </div>
              <button
                class="inline-remove"
                type="button"
                @click="openRemoveDialog(entry)"
              >
                Eliminar
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

      <footer class="sheet-footer">
        <small class="storage-caption">
          {{ storageCaption }}
        </small>
        <button
          class="footer-link"
          :disabled="!canOpenBackupFolder"
          type="button"
          @click="openBackupFolder"
        >
          {{ backupLinkLabel }}
        </button>
        <button
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
      v-if="removeDialog"
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
  </main>
</template>
