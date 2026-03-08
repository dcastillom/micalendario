<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import LocalityAutocomplete from "./LocalityAutocomplete.vue";
import {
  createEmptyEntry,
  createEmptyDay,
  loadDay,
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
const dayRecord = ref<DayRecord>(createEmptyDay(selectedDate.value));
const loading = ref(true);
const savingState = ref<"idle" | "saving" | "saved" | "error">("idle");
const hydrating = ref(false);
const asignadoOptions = ref<string[]>([]);
const asignadoEditorOpen = ref(false);
const newAsignadoOption = ref("");
const asignadoOptionError = ref("");

let saveTimer: number | undefined;

const formattedTitle = computed(() => formatHeader(selectedDate.value));
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

async function persistDay() {
  savingState.value = "saving";

  try {
    dayRecord.value = await saveDay(dayRecord.value);
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

async function loadSelectedDay() {
  loading.value = true;
  hydrating.value = true;

  try {
    dayRecord.value = await loadDay(selectedDate.value);
    savingState.value = "idle";
  } finally {
    hydrating.value = false;
    loading.value = false;
  }
}

async function loadAsignadoOptions() {
  try {
    const settings = await loadSettings();
    asignadoOptions.value = settings.asignadoOptions;
  } catch (error) {
    console.error(error);
    asignadoOptionError.value = "No se pudieron cargar las opciones de asignado.";
  }
}

function shiftDay(offset: number) {
  const base = new Date(`${selectedDate.value}T12:00:00`);
  base.setDate(base.getDate() + offset);
  const year = base.getFullYear();
  const month = `${base.getMonth() + 1}`.padStart(2, "0");
  const day = `${base.getDate()}`.padStart(2, "0");
  selectedDate.value = `${year}-${month}-${day}`;
}

function jumpToToday() {
  selectedDate.value = todayKey();
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

watch(selectedDate, () => {
  void loadSelectedDay();
});

watch(
  dayRecord,
  () => {
    queueSave();
  },
  { deep: true },
);

onMounted(() => {
  void loadAsignadoOptions();
  void loadSelectedDay();
});
</script>

<template>
  <main class="planner-app">
    <aside class="planner-sidebar">
      <div class="sidebar-card sidebar-card--focus">
        <div class="focus-list">
          <div class="focus-item">
            <span>Total de asignados</span>
            <strong>{{ occupiedRows }}</strong>
          </div>
          <div class="focus-item">
            <span>Entregados</span>
            <strong>{{ deliveredCount }}</strong>
          </div>
          <div class="focus-item">
            <span>Sin plano definido</span>
            <strong>{{ planPendingCount }}</strong>
          </div>
          <div class="focus-item">
            <span>Guardado</span>
            <strong>{{ lastSavedLabel }}</strong>
          </div>
        </div>
      </div>
    </aside>

    <section class="planner-sheet">
      <section class="sheet-toolbar">
        <div class="toolbar-group toolbar-group--navigation">
          <button class="ghost-button" type="button" @click="shiftDay(-1)">
            Dia anterior
          </button>
          <button class="ghost-button" type="button" @click="jumpToToday">
            Hoy
          </button>
          <button class="ghost-button" type="button" @click="shiftDay(1)">
            Dia siguiente
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
          <button class="soft-button" type="button" @click="toggleAsignadoEditor">
            {{ asignadoEditorOpen ? "Cerrar asignados" : "Editar asignados" }}
          </button>
          <button class="primary-button" type="button" @click="addRow">
            Anadir fila
          </button>
        </div>
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

          <button class="primary-button" type="button" @click="addAsignadoOption">
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

      <div v-if="loading" class="loading-state">
        Cargando el dia seleccionado...
      </div>

      <div v-else class="sheet-table-wrap">
        <div v-if="dayRecord.entries.length === 0" class="empty-day">
          <p class="empty-day__title">Este dia no tiene filas.</p>
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
                <strong>{{ entry.asignado || "Sin titulo" }}</strong>
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
                <span class="field-label">Asignado</span>
                <select v-model="entry.asignado">
                  <option value="">Selecciona un asignado</option>
                  <option
                    v-for="asignadoOption in getAsignadoSelectOptions(entry.asignado)"
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
                <span class="field-label">Plano</span>
                <select v-model="entry.plano">
                  <option value="">Pendiente</option>
                  <option value="si">Si</option>
                  <option value="no">No</option>
                </select>
              </label>

              <label class="field">
                <span class="field-label">Referencia</span>
                <textarea
                  v-model="entry.referencia"
                  rows="3"
                  placeholder="Descripcion del trabajo o referencia"
                />
              </label>

              <label class="field">
                <span class="field-label">Localidad</span>
                <LocalityAutocomplete v-model="entry.localidad" />
              </label>

              <label class="field">
                <span class="field-label">Observaciones</span>
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
