<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  createDefaultPlannerSettings,
  loadSettings,
  saveSettings,
} from "../lib/planner-client";
import {
  dispatchPlannerSettingsUpdated,
  PLANNER_SETTINGS_UPDATED_EVENT,
} from "../lib/planner-ui-events";
import type { PlannerSettings } from "../lib/planner-types";
import CompanyHeader from "./CompanyHeader.vue";

interface Props {
  initialPathname?: string;
}

const props = withDefaults(defineProps<Props>(), {
  initialPathname: "/",
});
const MAX_LOGO_FILE_SIZE_BYTES = 1024 * 1024;

function normalizePathname(pathname: string) {
  const withoutIndex = pathname.replace(/\/index\.html$/, "/");
  const normalized = withoutIndex.replace(/\/+$/, "");

  return normalized || "/";
}

const plannerSettings = ref<PlannerSettings>(createDefaultPlannerSettings());
const currentPathname = ref(normalizePathname(props.initialPathname));
const brandEditorOpen = ref(false);
const asignadoEditorOpen = ref(false);
const brandForm = ref({
  companyName: "",
  companySubtitle: "",
  companyLogoDataUrl: "",
});
const asignadoOptionsDraft = ref<string[]>([]);
const newAsignadoOption = ref("");
const brandEditorError = ref("");
const asignadoOptionError = ref("");
const savingBrandSettings = ref(false);
const savingAsignadoSettings = ref(false);

const isAgendaRoute = computed(() => currentPathname.value === "/");
const isReportsRoute = computed(() => currentPathname.value === "/filtros");
const canEditBranding = computed(
  () => isAgendaRoute.value || isReportsRoute.value,
);
const displayedSettings = computed<PlannerSettings>(() =>
  brandEditorOpen.value
    ? {
        ...plannerSettings.value,
        companyName: brandForm.value.companyName,
        companySubtitle: brandForm.value.companySubtitle,
        companyLogoDataUrl: brandForm.value.companyLogoDataUrl,
      }
    : plannerSettings.value,
);
const brandButtonLabel = computed(() =>
  brandEditorOpen.value ? "Cerrar editor" : "Editar cabecera",
);
const asignadoButtonLabel = computed(() =>
  asignadoEditorOpen.value ? "Cerrar asignados" : "Editar asignados",
);
const headerClassName = computed(() => ({
  "app-shell-header--reports": isReportsRoute.value,
}));

function syncBrandForm(settings: PlannerSettings) {
  brandForm.value = {
    companyName: settings.companyName,
    companySubtitle: settings.companySubtitle,
    companyLogoDataUrl: settings.companyLogoDataUrl,
  };
}

function syncAsignadoDraft(settings: PlannerSettings) {
  asignadoOptionsDraft.value = [...settings.asignadoOptions];
}

function syncCurrentPathname() {
  if (typeof window === "undefined") {
    return;
  }

  currentPathname.value = normalizePathname(window.location.pathname);
}

async function refreshPlannerSettings() {
  try {
    const settings = await loadSettings();
    plannerSettings.value = settings;

    if (!brandEditorOpen.value) {
      syncBrandForm(settings);
    }

    if (!asignadoEditorOpen.value) {
      syncAsignadoDraft(settings);
    }
  } catch (error) {
    console.error("No se pudo cargar la cabecera persistente.", error);
  }
}

function handlePlannerSettingsUpdated(event: Event) {
  if (!(event instanceof CustomEvent)) {
    return;
  }

  const settings = event.detail as PlannerSettings;
  plannerSettings.value = settings;

  if (!brandEditorOpen.value) {
    syncBrandForm(settings);
  }

  if (!asignadoEditorOpen.value) {
    syncAsignadoDraft(settings);
  }
}

function handleAstroAfterSwap() {
  syncCurrentPathname();
}

function handleAstroPageLoad() {
  syncCurrentPathname();
  void refreshPlannerSettings();
}

function handleBrandButtonClick() {
  brandEditorOpen.value = !brandEditorOpen.value;
  asignadoEditorOpen.value = false;
  brandEditorError.value = "";

  if (brandEditorOpen.value) {
    syncBrandForm(plannerSettings.value);
  }
}

function handleAsignadoButtonClick() {
  asignadoEditorOpen.value = !asignadoEditorOpen.value;
  brandEditorOpen.value = false;
  asignadoOptionError.value = "";

  if (asignadoEditorOpen.value) {
    syncAsignadoDraft(plannerSettings.value);
    newAsignadoOption.value = "";
  }
}

function removeBrandLogo() {
  brandForm.value = {
    ...brandForm.value,
    companyLogoDataUrl: "",
  };
  brandEditorError.value = "";
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

async function handleBrandLogoChange(event: Event) {
  const input = event.target;

  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const file = input.files?.[0];
  input.value = "";

  if (!file) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    brandEditorError.value = "Selecciona un archivo de imagen válido.";
    return;
  }

  if (file.size > MAX_LOGO_FILE_SIZE_BYTES) {
    brandEditorError.value = "El logotipo no puede superar 1 MB.";
    return;
  }

  try {
    brandForm.value = {
      ...brandForm.value,
      companyLogoDataUrl: await readFileAsDataUrl(file),
    };
    brandEditorError.value = "";
  } catch (error) {
    console.error("No se pudo leer el logotipo.", error);
    brandEditorError.value = "No se pudo cargar el logotipo seleccionado.";
  }
}

async function saveBranding() {
  savingBrandSettings.value = true;
  brandEditorError.value = "";

  try {
    const settings = await saveSettings({
      ...plannerSettings.value,
      companyName: brandForm.value.companyName.trim(),
      companySubtitle: brandForm.value.companySubtitle.trim(),
      companyLogoDataUrl: brandForm.value.companyLogoDataUrl.trim(),
    });
    plannerSettings.value = settings;
    syncBrandForm(settings);
    dispatchPlannerSettingsUpdated(settings);
    brandEditorOpen.value = false;
  } catch (error) {
    console.error("No se pudo guardar la cabecera personalizada.", error);
    brandEditorError.value = "No se pudo guardar la cabecera personalizada.";
  } finally {
    savingBrandSettings.value = false;
  }
}

function normalizeAsignadoOption(value: string) {
  return value.trim().toLocaleLowerCase("es-ES");
}

function addAsignadoOption() {
  const nextOption = newAsignadoOption.value.trim();

  if (!nextOption) {
    asignadoOptionError.value = "Escribe un nombre para la opción.";
    return;
  }

  const optionExists = asignadoOptionsDraft.value.some(
    (option) =>
      normalizeAsignadoOption(option) === normalizeAsignadoOption(nextOption),
  );

  if (optionExists) {
    asignadoOptionError.value = "Esa opción ya existe.";
    return;
  }

  asignadoOptionsDraft.value = [...asignadoOptionsDraft.value, nextOption];
  newAsignadoOption.value = "";
  asignadoOptionError.value = "";
}

function removeAsignadoOption(optionToRemove: string) {
  const nextOptions = asignadoOptionsDraft.value.filter(
    (option) => option !== optionToRemove,
  );

  if (nextOptions.length === 0) {
    asignadoOptionError.value = "Debe quedar al menos una opción disponible.";
    return;
  }

  asignadoOptionsDraft.value = nextOptions;
  asignadoOptionError.value = "";
}

async function saveAsignadoOptions() {
  if (asignadoOptionsDraft.value.length === 0) {
    asignadoOptionError.value = "Debe quedar al menos una opción disponible.";
    return;
  }

  savingAsignadoSettings.value = true;
  asignadoOptionError.value = "";

  try {
    const settings = await saveSettings({
      ...plannerSettings.value,
      asignadoOptions: asignadoOptionsDraft.value,
    });
    plannerSettings.value = settings;
    syncAsignadoDraft(settings);
    dispatchPlannerSettingsUpdated(settings);
    asignadoEditorOpen.value = false;
  } catch (error) {
    console.error("No se pudieron guardar las opciones de asignado.", error);
    asignadoOptionError.value =
      "No se pudieron guardar las opciones de asignado.";
  } finally {
    savingAsignadoSettings.value = false;
  }
}

onMounted(() => {
  syncCurrentPathname();
  syncBrandForm(plannerSettings.value);
  syncAsignadoDraft(plannerSettings.value);
  void refreshPlannerSettings();
  document.addEventListener("astro:after-swap", handleAstroAfterSwap);
  document.addEventListener("astro:page-load", handleAstroPageLoad);
  window.addEventListener(
    PLANNER_SETTINGS_UPDATED_EVENT,
    handlePlannerSettingsUpdated,
  );
});

onBeforeUnmount(() => {
  document.removeEventListener("astro:after-swap", handleAstroAfterSwap);
  document.removeEventListener("astro:page-load", handleAstroPageLoad);
  window.removeEventListener(
    PLANNER_SETTINGS_UPDATED_EVENT,
    handlePlannerSettingsUpdated,
  );
});
</script>

<template>
  <div class="app-shell-header no-print" :class="headerClassName">
    <div class="app-shell-header__inner">
      <CompanyHeader
        :settings="displayedSettings"
        fallback-name=""
        fallback-subtitle=""
        logo-click-href="/"
      >
        <template v-if="canEditBranding" #actions>
          <div class="company-header__button-group">
            <button
              class="company-header__action-button"
              type="button"
              @click="handleAsignadoButtonClick"
            >
              {{ asignadoButtonLabel }}
            </button>
            <button
              class="company-header__action-button"
              type="button"
              @click="handleBrandButtonClick"
            >
              {{ brandButtonLabel }}
            </button>
          </div>
        </template>
      </CompanyHeader>

      <section v-if="canEditBranding && brandEditorOpen" class="brand-editor">
        <div class="brand-editor__header">
          <p class="sidebar-copy">
            Personaliza la cabecera visible en la app y en los informes impresos
            con el nombre y el logotipo de tu empresa.
          </p>
        </div>

        <div class="brand-editor__grid">
          <label class="field">
            <span class="field-label">Nombre de empresa:</span>
            <input
              v-model="brandForm.companyName"
              type="text"
              placeholder="Ej. Carpintería Martín"
            />
          </label>

          <label class="field field--wide">
            <span class="field-label">Subtítulo:</span>
            <input
              v-model="brandForm.companySubtitle"
              type="text"
              placeholder="Ej. Instalaciones y montaje"
            />
          </label>

          <label class="field">
            <span class="field-label">Logotipo:</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              @change="handleBrandLogoChange"
            />
          </label>

          <div class="brand-editor__actions">
            <button
              class="ghost-button"
              type="button"
              :disabled="!brandForm.companyLogoDataUrl || savingBrandSettings"
              @click="removeBrandLogo"
            >
              Quitar logotipo
            </button>
            <button
              class="primary-button"
              type="button"
              :disabled="savingBrandSettings"
              @click="saveBranding"
            >
              {{
                savingBrandSettings
                  ? "Guardando cabecera..."
                  : "Guardar cabecera"
              }}
            </button>
          </div>
        </div>

        <p v-if="brandEditorError" class="pedido-editor__error">
          {{ brandEditorError }}
        </p>
      </section>

      <section
        v-if="canEditBranding && asignadoEditorOpen"
        class="pedido-editor"
      >
        <div class="pedido-editor__header">
          <p class="pedido-editor__copy">
            Añade o elimina las opciones que aparecerán en el dropdown de
            asignado.
          </p>
        </div>

        <div class="pedido-editor__form">
          <label class="field">
            <input
              v-model="newAsignadoOption"
              type="text"
              placeholder="Nombre de la opción"
              @keydown.enter.prevent="addAsignadoOption"
            />
          </label>

          <button
            class="primary-button"
            type="button"
            :disabled="savingAsignadoSettings"
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
            v-for="asignadoOption in asignadoOptionsDraft"
            :key="asignadoOption"
            class="pedido-chip"
          >
            <span>{{ asignadoOption }}</span>
            <button
              class="pedido-chip__remove"
              type="button"
              :disabled="savingAsignadoSettings"
              @click="removeAsignadoOption(asignadoOption)"
            >
              Eliminar
            </button>
          </article>
        </div>

        <div class="brand-editor__actions">
          <button
            class="primary-button"
            type="button"
            :disabled="savingAsignadoSettings"
            @click="saveAsignadoOptions"
          >
            {{
              savingAsignadoSettings
                ? "Guardando asignados..."
                : "Guardar asignados"
            }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
