<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  createDefaultPlannerSettings,
  loadSettings,
  saveSettings,
} from "../lib/planner-client";
import { getSupabaseClient, hasSupabaseConfig } from "../lib/supabase-client";
import {
  createManagedPlannerUser,
  deleteManagedPlannerUser,
  ensurePlannerAuthInitialized,
  loadManagedPlannerUsers,
  PLANNER_AUTH_UPDATED_EVENT,
  plannerAuthState,
  setManagedPlannerUserActive,
  signOutPlannerUser,
} from "../lib/planner-auth";
import {
  dispatchPlannerSettingsUpdated,
  PLANNER_SETTINGS_UPDATED_EVENT,
} from "../lib/planner-ui-events";
import type {
  PlannerRole,
  PlannerSettings,
  PlannerUserProfile,
} from "../lib/planner-types";
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
const headerUserProfile = ref<PlannerUserProfile | null>(null);
const brandEditorOpen = ref(false);
const asignadoEditorOpen = ref(false);
const usersEditorOpen = ref(false);
const brandForm = ref({
  companyName: "",
  companySubtitle: "",
  companyLogoDataUrl: "",
});
const asignadoOptionsDraft = ref<string[]>([]);
const newAsignadoOption = ref("");
const userForm = ref<{
  email: string;
  password: string;
  role: PlannerRole;
}>({
  email: "",
  password: "",
  role: "viewer",
});
const brandEditorError = ref("");
const asignadoOptionError = ref("");
const userEditorError = ref("");
const userEditorNotice = ref("");
const savingBrandSettings = ref(false);
const savingAsignadoSettings = ref(false);
const savingUserEditor = ref(false);
const loadingManagedUsers = ref(false);
const userActionInFlightId = ref("");
const removeUserDialog = ref<PlannerUserProfile | null>(null);

const isAgendaRoute = computed(() => currentPathname.value === "/");
const isReportsRoute = computed(() => currentPathname.value === "/filtros");
const isAuthenticated = computed(() =>
  Boolean(headerUserProfile.value?.isActive),
);
const canManageSettings = computed(
  () => headerUserProfile.value?.role === "admin",
);
const canManageUsers = computed(
  () => headerUserProfile.value?.role === "admin",
);
const canEditBranding = computed(
  () =>
    canManageSettings.value && (isAgendaRoute.value || isReportsRoute.value),
);
const canRenderHeaderActions = computed(
  () => isAuthenticated.value && (isAgendaRoute.value || isReportsRoute.value),
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
  brandEditorOpen.value ? "Cerrar cabecera" : "Editar cabecera",
);
const asignadoButtonLabel = computed(() =>
  asignadoEditorOpen.value ? "Cerrar asignados" : "Editar asignados",
);
const usersButtonLabel = computed(() =>
  usersEditorOpen.value ? "Cerrar usuarios" : "Gestionar usuarios",
);
const contextualHeaderActionHref = computed(() =>
  isReportsRoute.value ? "/" : "/filtros",
);
const contextualHeaderActionLabel = computed(() =>
  isReportsRoute.value ? "Volver a la agenda" : "Ir a filtros e impresión",
);
const closeIconPaths = ["M6 6 18 18", "M18 6 6 18"];
const usersIconPaths = computed(() =>
  usersEditorOpen.value
    ? closeIconPaths
    : [
        "M15 19v-1.5A3.5 3.5 0 0 0 11.5 14H6.5A3.5 3.5 0 0 0 3 17.5V19",
        "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
        "M18 8v6",
        "M21 11h-6",
      ],
);
const asignadoIconPaths = computed(() =>
  asignadoEditorOpen.value
    ? closeIconPaths
    : [
        "M10 6h10",
        "M10 12h10",
        "M10 18h10",
        "M4 6.5 5.75 8.25 8 6",
        "M4 12.5 5.75 14.25 8 12",
        "M4 18.5 5.75 20.25 8 18",
      ],
);
const brandIconPaths = computed(() =>
  brandEditorOpen.value
    ? closeIconPaths
    : [
        "M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v9A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.5z",
        "M4 10h16",
        "M8 14h8",
      ],
);
const logoutIconPaths = [
  "M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10",
  "M13 8l4 4-4 4",
  "M17 12H9",
];
const contextualHeaderIconPaths = computed(() =>
  isReportsRoute.value
    ? ["M4 10.5 12 4l8 6.5v8.5a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"]
    : [
        "M7 8V4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5V8",
        "M6.5 19H17.5A1.5 1.5 0 0 0 19 17.5V11a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6.5A1.5 1.5 0 0 0 6.5 19Z",
        "M8 14.5h8v5H8zM16.5 11.5h.01",
      ],
);
const currentUserEmail = computed(() => headerUserProfile.value?.email ?? "");
const currentUserRoleLabel = computed(() => {
  if (headerUserProfile.value?.role === "admin") {
    return "Admin";
  }

  if (headerUserProfile.value?.role === "editor") {
    return "Editor";
  }

  return "Solo vista";
});
const headerClassName = computed(() => ({
  "app-shell-header--reports": isReportsRoute.value,
  "app-shell-header--editing":
    brandEditorOpen.value || asignadoEditorOpen.value || usersEditorOpen.value,
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

function resetUserForm() {
  userForm.value = {
    email: "",
    password: "",
    role: "viewer",
  };
}

function closeAdminEditors() {
  brandEditorOpen.value = false;
  asignadoEditorOpen.value = false;
  usersEditorOpen.value = false;
}

async function refreshHeaderAuthState() {
  if (!hasSupabaseConfig()) {
    headerUserProfile.value = null;
    return;
  }

  const supabase = getSupabaseClient();

  if (!supabase) {
    headerUserProfile.value = null;
    return;
  }

  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error || !session?.user) {
      headerUserProfile.value = null;
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("planner_users")
      .select("id, email, role, is_active, created_at, updated_at")
      .eq("id", session.user.id)
      .maybeSingle();

    if (profileError || !profile || !profile.is_active) {
      headerUserProfile.value = null;
      return;
    }

    headerUserProfile.value = {
      id: profile.id,
      email: String(profile.email ?? session.user.email ?? "")
        .trim()
        .toLowerCase(),
      role:
        profile.role === "admin" || profile.role === "editor"
          ? profile.role
          : "viewer",
      isActive: Boolean(profile.is_active),
      createdAt: profile.created_at ?? new Date().toISOString(),
      updatedAt: profile.updated_at ?? new Date().toISOString(),
    };
  } catch (error) {
    console.error("No se pudo sincronizar la sesión de la cabecera.", error);
    headerUserProfile.value = null;
  }
}

function syncCurrentPathname() {
  if (typeof window === "undefined") {
    return;
  }

  currentPathname.value = normalizePathname(window.location.pathname);
}

async function refreshPlannerSettings() {
  if (!isAuthenticated.value) {
    plannerSettings.value = createDefaultPlannerSettings();
    syncBrandForm(plannerSettings.value);
    syncAsignadoDraft(plannerSettings.value);
    return;
  }

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

async function refreshManagedUsers() {
  if (!canManageUsers.value) {
    return;
  }

  loadingManagedUsers.value = true;
  userEditorError.value = "";

  try {
    await loadManagedPlannerUsers();
  } catch (error) {
    console.error("No se pudo cargar la lista de usuarios.", error);
    userEditorError.value = "No se pudo cargar la lista de usuarios.";
  } finally {
    loadingManagedUsers.value = false;
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
  void refreshHeaderAuthState();
}

function handleAstroPageLoad() {
  syncCurrentPathname();
  void refreshHeaderAuthState();
  if (isAuthenticated.value) {
    void refreshPlannerSettings();
  }
}

function handleWindowFocus() {
  void refreshHeaderAuthState();
}

function handlePlannerAuthUpdated() {
  void refreshHeaderAuthState().then(() => {
    if (isAuthenticated.value) {
      void refreshPlannerSettings();

      if (usersEditorOpen.value && canManageUsers.value) {
        void refreshManagedUsers();
      }
    }
  });
}

function handleBrandButtonClick() {
  if (!canEditBranding.value) {
    return;
  }

  brandEditorOpen.value = !brandEditorOpen.value;
  asignadoEditorOpen.value = false;
  usersEditorOpen.value = false;
  brandEditorError.value = "";

  if (brandEditorOpen.value) {
    syncBrandForm(plannerSettings.value);
  }
}

function handleAsignadoButtonClick() {
  if (!canEditBranding.value) {
    return;
  }

  asignadoEditorOpen.value = !asignadoEditorOpen.value;
  brandEditorOpen.value = false;
  usersEditorOpen.value = false;
  asignadoOptionError.value = "";

  if (asignadoEditorOpen.value) {
    syncAsignadoDraft(plannerSettings.value);
    newAsignadoOption.value = "";
  }
}

function handleUsersButtonClick() {
  if (!canManageUsers.value) {
    return;
  }

  usersEditorOpen.value = !usersEditorOpen.value;
  brandEditorOpen.value = false;
  asignadoEditorOpen.value = false;
  userEditorError.value = "";
  userEditorNotice.value = "";

  if (usersEditorOpen.value) {
    resetUserForm();
    void refreshManagedUsers();
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
  if (!canEditBranding.value) {
    return;
  }

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
  if (!canEditBranding.value) {
    return;
  }

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

function getRoleLabel(role: PlannerRole) {
  if (role === "admin") {
    return "Admin";
  }

  if (role === "editor") {
    return "Editor";
  }

  return "Solo vista";
}

function isCurrentManagedUser(user: PlannerUserProfile) {
  return user.id === headerUserProfile.value?.id;
}

function openRemoveManagedUserDialog(user: PlannerUserProfile) {
  if (!canManageUsers.value || userActionInFlightId.value) {
    return;
  }

  if (isCurrentManagedUser(user)) {
    userEditorError.value =
      "No puedes eliminar definitivamente tu propia cuenta desde este panel.";
    return;
  }

  userEditorError.value = "";
  userEditorNotice.value = "";
  removeUserDialog.value = user;
}

function closeRemoveManagedUserDialog(force = false) {
  if (userActionInFlightId.value && !force) {
    return;
  }

  removeUserDialog.value = null;
}

async function createPlannerUser() {
  if (!canManageUsers.value) {
    return;
  }

  userEditorError.value = "";
  userEditorNotice.value = "";
  savingUserEditor.value = true;

  try {
    const email = userForm.value.email.trim();
    const password = userForm.value.password.trim();

    if (!email || !password) {
      throw new Error("Escribe email y contraseña para el nuevo usuario.");
    }

    if (password.length < 8) {
      throw new Error(
        "La contraseña inicial debe tener al menos 8 caracteres.",
      );
    }

    await createManagedPlannerUser({
      email,
      password,
      role: userForm.value.role,
    });

    userEditorNotice.value = `Usuario ${email} creado correctamente.`;
    resetUserForm();
  } catch (error) {
    console.error("No se pudo crear el usuario.", error);
    userEditorError.value =
      error instanceof Error ? error.message : "No se pudo crear el usuario.";
  } finally {
    savingUserEditor.value = false;
  }
}

async function toggleManagedUserActive(
  user: PlannerUserProfile,
  nextIsActive: boolean,
) {
  if (!canManageUsers.value || userActionInFlightId.value) {
    return;
  }

  userEditorError.value = "";
  userEditorNotice.value = "";
  userActionInFlightId.value = user.id;

  try {
    await setManagedPlannerUserActive({
      userId: user.id,
      isActive: nextIsActive,
    });
    userEditorNotice.value = nextIsActive
      ? `Usuario ${user.email} reactivado.`
      : `Usuario ${user.email} dado de baja.`;
  } catch (error) {
    console.error("No se pudo actualizar el estado del usuario.", error);
    userEditorError.value =
      error instanceof Error
        ? error.message
        : "No se pudo actualizar el estado del usuario.";
  } finally {
    userActionInFlightId.value = "";
  }
}

async function removeManagedUserPermanently(user: PlannerUserProfile) {
  if (!canManageUsers.value || userActionInFlightId.value) {
    return;
  }

  userEditorError.value = "";
  userEditorNotice.value = "";
  userActionInFlightId.value = user.id;

  try {
    await deleteManagedPlannerUser(user.id);
    userEditorNotice.value = `Usuario ${user.email} eliminado definitivamente.`;
    closeRemoveManagedUserDialog(true);
  } catch (error) {
    console.error("No se pudo eliminar definitivamente el usuario.", error);
    userEditorError.value =
      error instanceof Error
        ? error.message
        : "No se pudo eliminar definitivamente el usuario.";
  } finally {
    userActionInFlightId.value = "";
  }
}

async function handleSignOut() {
  closeAdminEditors();
  closeRemoveManagedUserDialog(true);
  userEditorError.value = "";
  userEditorNotice.value = "";
  resetUserForm();
  await signOutPlannerUser();
  headerUserProfile.value = null;
}

onMounted(() => {
  syncCurrentPathname();
  syncBrandForm(plannerSettings.value);
  syncAsignadoDraft(plannerSettings.value);
  resetUserForm();
  void ensurePlannerAuthInitialized().then(() => {
    void refreshHeaderAuthState().then(() => {
      if (isAuthenticated.value) {
        void refreshPlannerSettings();
      }
    });
  });
  document.addEventListener("astro:after-swap", handleAstroAfterSwap);
  document.addEventListener("astro:page-load", handleAstroPageLoad);
  window.addEventListener("focus", handleWindowFocus);
  window.addEventListener(PLANNER_AUTH_UPDATED_EVENT, handlePlannerAuthUpdated);
  window.addEventListener(
    PLANNER_SETTINGS_UPDATED_EVENT,
    handlePlannerSettingsUpdated,
  );
});

watch(isAuthenticated, (nextIsAuthenticated) => {
  if (!nextIsAuthenticated) {
    closeAdminEditors();
    userEditorError.value = "";
    userEditorNotice.value = "";
    resetUserForm();
    plannerSettings.value = createDefaultPlannerSettings();
    syncBrandForm(plannerSettings.value);
    syncAsignadoDraft(plannerSettings.value);
    return;
  }

  void refreshPlannerSettings();
});

watch(canManageUsers, (nextCanManageUsers) => {
  if (!nextCanManageUsers) {
    usersEditorOpen.value = false;
    closeRemoveManagedUserDialog(true);
    userEditorError.value = "";
    userEditorNotice.value = "";
    resetUserForm();
  }
});

watch(canEditBranding, (nextCanEditBranding) => {
  if (!nextCanEditBranding) {
    brandEditorOpen.value = false;
    asignadoEditorOpen.value = false;
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("astro:after-swap", handleAstroAfterSwap);
  document.removeEventListener("astro:page-load", handleAstroPageLoad);
  window.removeEventListener("focus", handleWindowFocus);
  window.removeEventListener(
    PLANNER_AUTH_UPDATED_EVENT,
    handlePlannerAuthUpdated,
  );
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
        :has-actions="canRenderHeaderActions"
        logo-click-href="/"
      >
        <template #actions>
          <div
            v-if="canRenderHeaderActions"
            class="company-header__actions-stack"
          >
            <!-- <div class="company-header__user-meta">
              <strong class="company-header__user-email">{{ currentUserEmail }}</strong>
              <span class="company-header__user-role">{{ currentUserRoleLabel }}</span>
            </div> -->
            <div class="company-header__button-group">
              <button
                v-if="canManageUsers"
                class="company-header__action-button company-header__action-button--icon"
                :class="{
                  'company-header__action-button--active': usersEditorOpen,
                }"
                type="button"
                :aria-label="usersButtonLabel"
                :title="usersButtonLabel"
                @click="handleUsersButtonClick"
              >
                <svg
                  aria-hidden="true"
                  class="company-header__action-icon"
                  viewBox="0 0 24 24"
                >
                  <path
                    v-for="path in usersIconPaths"
                    :key="path"
                    :d="path"
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.9"
                  />
                </svg>
              </button>
              <button
                v-if="canEditBranding"
                class="company-header__action-button company-header__action-button--icon"
                :class="{
                  'company-header__action-button--active': asignadoEditorOpen,
                }"
                type="button"
                :aria-label="asignadoButtonLabel"
                :title="asignadoButtonLabel"
                @click="handleAsignadoButtonClick"
              >
                <svg
                  aria-hidden="true"
                  class="company-header__action-icon"
                  viewBox="0 0 24 24"
                >
                  <path
                    v-for="path in asignadoIconPaths"
                    :key="path"
                    :d="path"
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.9"
                  />
                </svg>
              </button>
              <button
                v-if="canEditBranding"
                class="company-header__action-button company-header__action-button--icon"
                :class="{
                  'company-header__action-button--active': brandEditorOpen,
                }"
                type="button"
                :aria-label="brandButtonLabel"
                :title="brandButtonLabel"
                @click="handleBrandButtonClick"
              >
                <svg
                  aria-hidden="true"
                  class="company-header__action-icon"
                  viewBox="0 0 24 24"
                >
                  <path
                    v-for="path in brandIconPaths"
                    :key="path"
                    :d="path"
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.9"
                  />
                </svg>
              </button>
              <a
                class="ghost-link company-header__action-button company-header__action-button--filters company-header__action-button--icon"
                :aria-label="contextualHeaderActionLabel"
                :href="contextualHeaderActionHref"
                :title="contextualHeaderActionLabel"
              >
                <svg
                  aria-hidden="true"
                  class="company-header__action-icon"
                  viewBox="0 0 24 24"
                >
                  <path
                    v-for="path in contextualHeaderIconPaths"
                    :key="path"
                    :d="path"
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.9"
                  />
                </svg>
              </a>
              <button
                class="company-header__action-button company-header__action-button--logout company-header__action-button--icon"
                type="button"
                aria-label="Salir"
                title="Salir"
                @click="handleSignOut"
              >
                <svg
                  aria-hidden="true"
                  class="company-header__action-icon"
                  viewBox="0 0 24 24"
                >
                  <path
                    v-for="path in logoutIconPaths"
                    :key="path"
                    :d="path"
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.9"
                  />
                </svg>
              </button>
            </div>
          </div>
        </template>
      </CompanyHeader>

      <section v-if="canManageUsers && usersEditorOpen" class="users-editor">
        <div class="users-editor__header">
          <p class="sidebar-copy">
            Crea nuevos usuarios, dales de baja, reactívalos o elimínalos de
            forma definitiva. Solo el administrador puede gestionar accesos.
          </p>
        </div>

        <div class="users-editor__grid">
          <label class="field">
            <span class="field-label">Email:</span>
            <input
              v-model="userForm.email"
              type="email"
              autocomplete="off"
              placeholder="persona@empresa.com"
            />
          </label>

          <label class="field">
            <span class="field-label">Contraseña inicial:</span>
            <input
              v-model="userForm.password"
              type="password"
              autocomplete="new-password"
              placeholder="Mínimo 8 caracteres"
            />
          </label>

          <label class="field">
            <span class="field-label">Rol:</span>
            <select v-model="userForm.role">
              <option value="viewer">Solo vista</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          <div class="brand-editor__actions users-editor__actions">
            <button
              class="primary-button"
              type="button"
              :disabled="savingUserEditor"
              @click="createPlannerUser"
            >
              {{ savingUserEditor ? "Creando usuario..." : "Crear usuario" }}
            </button>
          </div>
        </div>

        <p v-if="userEditorError" class="pedido-editor__error">
          {{ userEditorError }}
        </p>
        <p v-else-if="userEditorNotice" class="users-editor__notice">
          {{ userEditorNotice }}
        </p>

        <div v-if="loadingManagedUsers" class="users-editor__state">
          Cargando usuarios...
        </div>
        <div
          v-else-if="plannerAuthState.managedUsers.value.length === 0"
          class="users-editor__state"
        >
          Todavía no hay usuarios creados.
        </div>
        <div v-else class="users-editor__list">
          <article
            v-for="managedUser in plannerAuthState.managedUsers.value"
            :key="managedUser.id"
            class="users-editor__item"
          >
            <div class="users-editor__item-main">
              <strong>{{ managedUser.email }}</strong>
              <div class="users-editor__badges">
                <span class="users-editor__badge users-editor__badge--role">
                  {{ getRoleLabel(managedUser.role) }}
                </span>
                <span
                  class="users-editor__badge"
                  :class="
                    managedUser.isActive
                      ? 'users-editor__badge--active'
                      : 'users-editor__badge--inactive'
                  "
                >
                  {{ managedUser.isActive ? "Activo" : "Baja" }}
                </span>
                <span
                  v-if="isCurrentManagedUser(managedUser)"
                  class="users-editor__badge users-editor__badge--self"
                >
                  Tu cuenta
                </span>
              </div>
            </div>

            <div class="users-editor__item-actions">
              <button
                v-if="!isCurrentManagedUser(managedUser)"
                class="ghost-button"
                type="button"
                :disabled="userActionInFlightId === managedUser.id"
                @click="
                  toggleManagedUserActive(managedUser, !managedUser.isActive)
                "
              >
                {{
                  userActionInFlightId === managedUser.id
                    ? "Guardando..."
                    : managedUser.isActive
                      ? "Dar de baja"
                      : "Reactivar"
                }}
              </button>
              <button
                v-if="!isCurrentManagedUser(managedUser)"
                class="inline-remove"
                type="button"
                :disabled="userActionInFlightId === managedUser.id"
                @click="openRemoveManagedUserDialog(managedUser)"
              >
                {{
                  userActionInFlightId === managedUser.id
                    ? "Guardando..."
                    : "Eliminar"
                }}
              </button>
            </div>
          </article>
        </div>

        <div
          v-if="removeUserDialog"
          class="confirm-overlay"
          @click.self="closeRemoveManagedUserDialog"
        >
          <section
            class="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-user-dialog-title"
          >
            <h2 id="remove-user-dialog-title">
              ¿Quieres eliminar este usuario definitivamente?
            </h2>
            <dl class="confirm-dialog__details">
              <div>
                <dt>Email:</dt>
                <dd>{{ removeUserDialog.email }}</dd>
              </div>
              <div>
                <dt>Rol:</dt>
                <dd>{{ getRoleLabel(removeUserDialog.role) }}</dd>
              </div>
              <div>
                <dt>Estado actual:</dt>
                <dd>{{ removeUserDialog.isActive ? "Activo" : "Baja" }}</dd>
              </div>
            </dl>
            <p class="pedido-editor__error">
              Esta acción eliminará la cuenta de forma permanente y no se puede
              deshacer.
            </p>
            <div class="confirm-dialog__actions">
              <button
                class="ghost-button"
                type="button"
                :disabled="userActionInFlightId === removeUserDialog.id"
                @click="closeRemoveManagedUserDialog"
              >
                Cancelar
              </button>
              <button
                class="inline-remove"
                type="button"
                :disabled="userActionInFlightId === removeUserDialog.id"
                @click="removeManagedUserPermanently(removeUserDialog)"
              >
                {{
                  userActionInFlightId === removeUserDialog.id
                    ? "Eliminando..."
                    : "Eliminar definitivamente"
                }}
              </button>
            </div>
          </section>
        </div>
      </section>

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
