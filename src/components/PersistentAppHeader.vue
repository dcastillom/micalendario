<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  createDefaultPlannerSettings,
  loadSettings,
  saveSettings,
} from "../lib/planner-client";
import { getSupabaseClient, hasSupabaseConfig } from "../lib/supabase-client";
import {
  clearPlannerAuthError,
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
  dispatchPlannerOpenImportDialog,
  dispatchPlannerOpenVacationsDialog,
  dispatchPlannerSettingsUpdated,
  PLANNER_SETTINGS_UPDATED_EVENT,
  PLANNER_FLOATING_AGENDA_ACTION_EVENT,
  PLANNER_FLOATING_AGENDA_STATE_EVENT,
  PLANNER_FLOATING_AGENDA_STATE_REQUEST_EVENT,
  type PlannerFloatingAgendaAction,
  type PlannerFloatingAgendaState,
} from "../lib/planner-ui-events";
import type {
  PlannerRole,
  PlannerSettings,
  PlannerUserProfile,
} from "../lib/planner-types";
import AuthAccessCard from "./AuthAccessCard.vue";
import CompanyHeader from "./CompanyHeader.vue";
import AgendaIcon from "./AgendaIcon.vue";

interface Props {
  initialPathname?: string;
}

const props = withDefaults(defineProps<Props>(), {
  initialPathname: "/",
});
const MAX_LOGO_FILE_SIZE_BYTES = 1024 * 1024;
const actionIcons = {
  auth: "⇥", users: "♙", people: "☷", brand: "▣",
  vacations: "☑", import: "↓", filters: "☰",
};

function normalizePathname(pathname: string) {
  const withoutIndex = pathname.replace(/\/index\.html$/, "/");
  const normalized = withoutIndex.replace(/\/+$/, "");

  return normalized || "/";
}

const plannerSettings = ref<PlannerSettings>(createDefaultPlannerSettings());
const currentPathname = ref(normalizePathname(props.initialPathname));
const headerUserProfile = ref<PlannerUserProfile | null>(null);
const headerMenuRef = ref<HTMLElement | null>(null);
const headerMenuOpen = ref(false);
const floatingMenuOpen = ref(false);
const floatingToggleRef = ref<HTMLButtonElement | null>(null);
const floatingAgendaState = ref<PlannerFloatingAgendaState>({ viewMode: "month", ready: false });
const loginDialogOpen = ref(false);
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
  () => isAgendaRoute.value || isReportsRoute.value,
);
const canImportReports = computed(
  () =>
    (isAgendaRoute.value || isReportsRoute.value) &&
    isAuthenticated.value &&
    (headerUserProfile.value?.role === "admin" ||
      headerUserProfile.value?.role === "editor"),
);
const canManageVacations = computed(
  () =>
    (isAgendaRoute.value || isReportsRoute.value) &&
    isAuthenticated.value &&
    (headerUserProfile.value?.role === "admin" ||
      headerUserProfile.value?.role === "editor"),
);
const canShowAuthAction = computed(
  () => hasSupabaseConfig() && (isAgendaRoute.value || isReportsRoute.value),
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
  asignadoEditorOpen.value ? "Cerrar asignados" : "Editar personas",
);
const usersButtonLabel = computed(() =>
  usersEditorOpen.value ? "Cerrar usuarios" : "Gestionar usuarios",
);
const headerMenuButtonLabel = computed(() =>
  headerMenuOpen.value ? "Cerrar menú" : "Abrir menú",
);
const contextualHeaderActionHref = computed(() =>
  isReportsRoute.value ? "/" : "/filtros",
);
const contextualHeaderActionLabel = computed(() =>
  isReportsRoute.value ? "Volver a la agenda" : "Ir a filtros",
);
const closeIconPaths = ["M6 6 18 18", "M18 6 6 18"];
const headerMenuIconPaths = computed(() =>
  headerMenuOpen.value ? closeIconPaths : ["M4 7h16", "M4 12h16", "M4 17h16"],
);
const authActionLabel = computed(() => {
  if (isAuthenticated.value) {
    return "Salir";
  }

  return plannerAuthState.plannerUsersExist.value === false
    ? "Crear admin inicial"
    : "Iniciar sesión";
});
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
  headerMenuOpen.value = false;
}

function closeHeaderMenu() {
  headerMenuOpen.value = false;
}

function openLoginDialog() {
  closeHeaderMenu();
  clearPlannerAuthError();
  loginDialogOpen.value = true;
}

function closeLoginDialog() {
  loginDialogOpen.value = false;
}

function toggleHeaderMenu() {
  headerMenuOpen.value = !headerMenuOpen.value;
}

function handleAuthActionClick() {
  if (isAuthenticated.value) {
    void handleSignOut();
    return;
  }

  openLoginDialog();
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
  floatingAgendaState.value = { viewMode: "month", ready: false };
  closeHeaderMenu();
  closeLoginDialog();
  void refreshHeaderAuthState();
  void refreshPlannerSettings();
}

function handleAstroPageLoad() {
  syncCurrentPathname();
  window.dispatchEvent(new Event(PLANNER_FLOATING_AGENDA_STATE_REQUEST_EVENT));
  closeHeaderMenu();
  void refreshHeaderAuthState();
  void refreshPlannerSettings();
}

function handleWindowFocus() {
  void refreshHeaderAuthState();
}

function handleDocumentPointerDown(event: Event) {
  if (
    !headerMenuOpen.value ||
    !(event.target instanceof Node) ||
    !headerMenuRef.value
  ) {
    return;
  }

  if (!headerMenuRef.value.contains(event.target)) {
    closeHeaderMenu();
  }
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    if (floatingMenuOpen.value) {
      floatingMenuOpen.value = false;
      floatingToggleRef.value?.focus();
      return;
    }
    if (removeUserDialog.value) {
      closeRemoveManagedUserDialog();
      return;
    }

    if (
      usersEditorOpen.value ||
      brandEditorOpen.value ||
      asignadoEditorOpen.value
    ) {
      closeAdminEditors();
      return;
    }

    closeHeaderMenu();
  }
}

function handleFloatingAgendaState(event: Event) {
  if (event instanceof CustomEvent && event.detail) floatingAgendaState.value = event.detail as PlannerFloatingAgendaState;
}

function runFloatingAgendaAction(action: PlannerFloatingAgendaAction) {
  window.dispatchEvent(new CustomEvent(PLANNER_FLOATING_AGENDA_ACTION_EVENT, { detail: action }));
}

function runFloatingAction(action: () => void) {
  action();
}

function handlePlannerAuthUpdated() {
  void refreshHeaderAuthState().then(() => {
    if (isAuthenticated.value) {
      closeLoginDialog();
    }

    void refreshPlannerSettings();

    if (isAuthenticated.value) {
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

  closeHeaderMenu();
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

  closeHeaderMenu();
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

  closeHeaderMenu();
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

function handleImportReportsClick() {
  if (!canImportReports.value) {
    return;
  }

  closeHeaderMenu();
  dispatchPlannerOpenImportDialog();
}

function handleVacationsClick() {
  if (!canManageVacations.value) {
    return;
  }

  closeHeaderMenu();
  dispatchPlannerOpenVacationsDialog();
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
      void refreshPlannerSettings();
    });
  });
  document.addEventListener("astro:after-swap", handleAstroAfterSwap);
  document.addEventListener("astro:page-load", handleAstroPageLoad);
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  window.addEventListener("focus", handleWindowFocus);
  window.addEventListener("keydown", handleWindowKeydown);
  window.addEventListener(PLANNER_FLOATING_AGENDA_STATE_EVENT, handleFloatingAgendaState);
  window.dispatchEvent(new Event(PLANNER_FLOATING_AGENDA_STATE_REQUEST_EVENT));
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
    closeLoginDialog();
    void refreshPlannerSettings();
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
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  window.removeEventListener("focus", handleWindowFocus);
  window.removeEventListener("keydown", handleWindowKeydown);
  window.removeEventListener(PLANNER_FLOATING_AGENDA_STATE_EVENT, handleFloatingAgendaState);
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
    <div v-if="canRenderHeaderActions" class="floating-actions" @mouseleave="floatingMenuOpen = false">
      <div v-if="floatingMenuOpen" id="floating-actions-panel" class="floating-actions__panel" aria-label="Acciones rápidas">
        <template v-if="isAgendaRoute">
          <p class="floating-actions__heading">Agenda</p>
          <button v-if="canImportReports" type="button" class="floating-actions__item" :disabled="!floatingAgendaState.ready" @click="runFloatingAgendaAction('add')"><span aria-hidden="true">＋</span>Añadir informe</button>
          <button type="button" class="floating-actions__item" :class="{ 'is-active': floatingAgendaState.viewMode === 'day' }" :disabled="!floatingAgendaState.ready" @click="runFloatingAgendaAction('day')"><AgendaIcon name="day" />Vista diaria</button>
          <button type="button" class="floating-actions__item" :class="{ 'is-active': floatingAgendaState.viewMode === 'month' }" :disabled="!floatingAgendaState.ready" @click="runFloatingAgendaAction('month')"><AgendaIcon name="month" />Vista mensual</button>
          <button type="button" class="floating-actions__item" :disabled="!floatingAgendaState.ready" @click="runFloatingAgendaAction('previous')"><AgendaIcon name="previous" />{{ floatingAgendaState.viewMode === 'day' ? 'Día anterior' : 'Mes anterior' }}</button>
          <button type="button" class="floating-actions__item" :disabled="!floatingAgendaState.ready" @click="runFloatingAgendaAction('today')"><AgendaIcon name="today" />Hoy</button>
          <button type="button" class="floating-actions__item" :disabled="!floatingAgendaState.ready" @click="runFloatingAgendaAction('next')"><AgendaIcon name="next" />{{ floatingAgendaState.viewMode === 'day' ? 'Día siguiente' : 'Mes siguiente' }}</button>
        </template>
        <template v-else-if="isReportsRoute && canImportReports">
          <p class="floating-actions__heading">Agenda</p>
          <a class="floating-actions__item" href="/?add=1"><span aria-hidden="true">＋</span>Añadir informe</a>
        </template>
        <p class="floating-actions__heading floating-actions__heading--section">Acciones</p>
        <button v-if="canManageUsers" type="button" class="floating-actions__item" @click="runFloatingAction(handleUsersButtonClick)"><span aria-hidden="true">{{ actionIcons.users }}</span>{{ usersButtonLabel }}</button>
        <button v-if="canEditBranding" type="button" class="floating-actions__item" @click="runFloatingAction(handleAsignadoButtonClick)"><span aria-hidden="true">{{ actionIcons.people }}</span>{{ asignadoButtonLabel }}</button>
        <button v-if="canEditBranding" type="button" class="floating-actions__item" @click="runFloatingAction(handleBrandButtonClick)"><span aria-hidden="true">{{ actionIcons.brand }}</span>{{ brandButtonLabel }}</button>
        <button v-if="canManageVacations" type="button" class="floating-actions__item" @click="runFloatingAction(handleVacationsClick)"><span aria-hidden="true">{{ actionIcons.vacations }}</span>Gestionar ausencias</button>
        <button v-if="canImportReports" type="button" class="floating-actions__item" @click="runFloatingAction(handleImportReportsClick)"><span aria-hidden="true">{{ actionIcons.import }}</span>Importar Excel</button>
        <a class="floating-actions__item" :href="contextualHeaderActionHref"><span aria-hidden="true">{{ actionIcons.filters }}</span>{{ contextualHeaderActionLabel }}</a>
        <button v-if="canShowAuthAction" type="button" class="floating-actions__item" @click="runFloatingAction(handleAuthActionClick)"><span aria-hidden="true">{{ actionIcons.auth }}</span>{{ authActionLabel }}</button>
      </div>
      <button ref="floatingToggleRef" type="button" class="floating-actions__toggle" :aria-expanded="floatingMenuOpen" aria-controls="floating-actions-panel" :aria-label="floatingMenuOpen ? 'Cerrar acciones rápidas' : 'Abrir acciones rápidas'" @click="floatingMenuOpen = !floatingMenuOpen">
        <span aria-hidden="true">{{ floatingMenuOpen ? '×' : '+' }}</span>
      </button>
    </div>
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
                v-if="canShowAuthAction"
                class="company-header__action-button company-header__action-button--icon"
                :class="{
                  'company-header__action-button--logout': isAuthenticated,
                }"
                type="button"
                :aria-label="authActionLabel"
                @click="handleAuthActionClick"
              >
                <span aria-hidden="true" class="company-header__action-icon company-header__text-icon">{{ actionIcons.auth }}</span>
              </button>
              <button
                v-if="canManageUsers"
                class="company-header__action-button company-header__action-button--icon"
                :class="{
                  'company-header__action-button--active': usersEditorOpen,
                }"
                type="button"
                :aria-label="usersButtonLabel"
                @click="handleUsersButtonClick"
              >
                <span aria-hidden="true" class="company-header__action-icon company-header__text-icon company-header__text-icon--users">{{ actionIcons.users }}</span>
              </button>
              <button
                v-if="canEditBranding"
                class="company-header__action-button company-header__action-button--icon"
                :class="{
                  'company-header__action-button--active': asignadoEditorOpen,
                }"
                type="button"
                :aria-label="asignadoButtonLabel"
                @click="handleAsignadoButtonClick"
              >
                <span aria-hidden="true" class="company-header__action-icon company-header__text-icon">{{ actionIcons.people }}</span>
              </button>
              <button
                v-if="canEditBranding"
                class="company-header__action-button company-header__action-button--icon"
                :class="{
                  'company-header__action-button--active': brandEditorOpen,
                }"
                type="button"
                :aria-label="brandButtonLabel"
                @click="handleBrandButtonClick"
              >
                <span aria-hidden="true" class="company-header__action-icon company-header__text-icon">{{ actionIcons.brand }}</span>
              </button>
              <button
                v-if="canManageVacations"
                class="company-header__action-button company-header__action-button--icon"
                type="button"
                aria-label="Gestionar ausencias"
                @click="handleVacationsClick"
              >
                <span aria-hidden="true" class="company-header__action-icon company-header__text-icon">{{ actionIcons.vacations }}</span>
              </button>
              <button
                v-if="canImportReports"
                class="company-header__action-button company-header__action-button--icon"
                type="button"
                aria-label="Importar Excel"
                @click="handleImportReportsClick"
              >
                <span aria-hidden="true" class="company-header__action-icon company-header__text-icon">{{ actionIcons.import }}</span>
              </button>
              <a
                class="ghost-link company-header__action-button company-header__action-button--icon"
                :aria-label="contextualHeaderActionLabel"
                :href="contextualHeaderActionHref"
              >
                <span aria-hidden="true" class="company-header__action-icon company-header__text-icon">{{ actionIcons.filters }}</span>
              </a>
            </div>
            <div ref="headerMenuRef" class="company-header__menu-shell">
              <button
                class="company-header__action-button company-header__action-button--icon company-header__menu-toggle"
                :class="{
                  'company-header__action-button--active': headerMenuOpen,
                }"
                type="button"
                :aria-label="headerMenuButtonLabel"
                @click="toggleHeaderMenu"
              >
                <svg
                  aria-hidden="true"
                  class="company-header__action-icon"
                  viewBox="0 0 24 24"
                >
                  <path
                    v-for="path in headerMenuIconPaths"
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

              <div v-if="headerMenuOpen" class="company-header__menu-dropdown">
                <button
                  v-if="canShowAuthAction"
                  class="company-header__menu-item"
                  :class="{
                    'company-header__menu-item--logout': isAuthenticated,
                  }"
                  type="button"
                  @click="handleAuthActionClick"
                >
                  <span aria-hidden="true" class="company-header__menu-item-icon company-header__text-icon">{{ actionIcons.auth }}</span>
                  <span>{{ authActionLabel }}</span>
                </button>
                <button
                  v-if="canManageVacations"
                  class="company-header__menu-item company-header__menu-item--filters"
                  type="button"
                  @click="handleVacationsClick"
                >
                  <span aria-hidden="true" class="company-header__menu-item-icon company-header__text-icon">{{ actionIcons.vacations }}</span>
                  <span>Vacaciones</span>
                </button>
                <button
                  v-if="canImportReports"
                  class="company-header__menu-item company-header__menu-item--filters"
                  type="button"
                  @click="handleImportReportsClick"
                >
                  <span aria-hidden="true" class="company-header__menu-item-icon company-header__text-icon">{{ actionIcons.import }}</span>
                  <span>Importar Excel</span>
                </button>

                <button
                  v-if="canManageUsers"
                  class="company-header__menu-item"
                  type="button"
                  @click="handleUsersButtonClick"
                >
                  <span aria-hidden="true" class="company-header__menu-item-icon company-header__text-icon">{{ actionIcons.users }}</span>
                  <span>{{ usersButtonLabel }}</span>
                </button>

                <button
                  v-if="canEditBranding"
                  class="company-header__menu-item"
                  type="button"
                  @click="handleAsignadoButtonClick"
                >
                  <span aria-hidden="true" class="company-header__menu-item-icon company-header__text-icon">{{ actionIcons.people }}</span>
                  <span>{{ asignadoButtonLabel }}</span>
                </button>

                <button
                  v-if="canEditBranding"
                  class="company-header__menu-item"
                  type="button"
                  @click="handleBrandButtonClick"
                >
                  <span aria-hidden="true" class="company-header__menu-item-icon company-header__text-icon">{{ actionIcons.brand }}</span>
                  <span>{{ brandButtonLabel }}</span>
                </button>

                <a
                  class="company-header__menu-item"
                  :href="contextualHeaderActionHref"
                  @click="closeHeaderMenu"
                >
                  <span aria-hidden="true" class="company-header__menu-item-icon company-header__text-icon">{{ actionIcons.filters }}</span>
                  <span>{{ contextualHeaderActionLabel }}</span>
                </a>
              </div>
            </div>
          </div>
        </template>
      </CompanyHeader>

      <div
        v-if="loginDialogOpen"
        class="confirm-overlay"
        @click.self="closeLoginDialog"
      >
        <section
          class="confirm-dialog confirm-dialog--auth"
          role="dialog"
          aria-modal="true"
          aria-labelledby="login-dialog-title"
        >
          <div class="confirm-dialog__header">
            <h2 id="login-dialog-title">Acceso</h2>
            <button
              class="confirm-dialog__close"
              type="button"
              aria-label="Cerrar"
              @click="closeLoginDialog"
            >
              X
            </button>
          </div>
          <AuthAccessCard
            embedded
            title="Acceso"
            subtitle="Inicia sesión para desbloquear edición y administración."
            @success="closeLoginDialog"
          />
        </section>
      </div>

      <div
        v-if="canManageUsers && usersEditorOpen"
        class="confirm-overlay"
        @click.self="closeAdminEditors"
      >
        <section
          class="confirm-dialog confirm-dialog--management"
          role="dialog"
          aria-modal="true"
          aria-labelledby="users-editor-title"
        >
          <div class="confirm-dialog__header">
            <h2 id="users-editor-title">Gestionar usuarios</h2>
            <button
              class="confirm-dialog__close"
              type="button"
              aria-label="Cerrar"
              @click="closeAdminEditors"
            >
              X
            </button>
          </div>
          <section class="users-editor">
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
                  {{
                    savingUserEditor ? "Creando usuario..." : "Crear usuario"
                  }}
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
                      toggleManagedUserActive(
                        managedUser,
                        !managedUser.isActive,
                      )
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
          </section>

          <div class="confirm-dialog__actions">
            <button
              class="ghost-button"
              type="button"
              @click="closeAdminEditors"
            >
              Cerrar
            </button>
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
              <div class="confirm-dialog__header">
                <h2 id="remove-user-dialog-title">
                  ¿Quieres eliminar este usuario definitivamente?
                </h2>
                <button
                  class="confirm-dialog__close"
                  type="button"
                  aria-label="Cerrar"
                  @click="closeRemoveManagedUserDialog"
                >
                  X
                </button>
              </div>
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
                Esta acción eliminará la cuenta de forma permanente y no se
                puede deshacer.
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
      </div>

      <div
        v-if="canEditBranding && brandEditorOpen"
        class="confirm-overlay"
        @click.self="closeAdminEditors"
      >
        <section
          class="confirm-dialog confirm-dialog--management"
          role="dialog"
          aria-modal="true"
          aria-labelledby="brand-editor-title"
        >
          <div class="confirm-dialog__header">
            <h2 id="brand-editor-title">Editar cabecera</h2>
            <button
              class="confirm-dialog__close"
              type="button"
              aria-label="Cerrar"
              @click="closeAdminEditors"
            >
              X
            </button>
          </div>
          <section class="brand-editor">
            <div class="brand-editor__header">
              <p class="sidebar-copy">
                Personaliza la cabecera visible en la app y en los informes
                impresos con el nombre y el logotipo de tu empresa.
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
                  :disabled="
                    !brandForm.companyLogoDataUrl || savingBrandSettings
                  "
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

          <div class="confirm-dialog__actions">
            <button
              class="ghost-button"
              type="button"
              @click="closeAdminEditors"
            >
              Cerrar
            </button>
          </div>
        </section>
      </div>

      <div
        v-if="canEditBranding && asignadoEditorOpen"
        class="confirm-overlay"
        @click.self="closeAdminEditors"
      >
        <section
          class="confirm-dialog confirm-dialog--management"
          role="dialog"
          aria-modal="true"
          aria-labelledby="asignado-editor-title"
        >
          <div class="confirm-dialog__header">
            <h2 id="asignado-editor-title">Editar personas</h2>
            <button
              class="confirm-dialog__close"
              type="button"
              aria-label="Cerrar"
              @click="closeAdminEditors"
            >
              X
            </button>
          </div>
          <section class="pedido-editor">
            <div class="pedido-editor__header">
              <p class="pedido-editor__copy">
                Añade o elimina asignados o laborantes
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
                    ? "Guardando personas..."
                    : "Guardar personas"
                }}
              </button>
            </div>
          </section>

          <div class="confirm-dialog__actions">
            <button
              class="ghost-button"
              type="button"
              @click="closeAdminEditors"
            >
              Cerrar
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
