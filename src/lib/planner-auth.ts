import type { User } from "@supabase/supabase-js";
import { computed, readonly, ref } from "vue";
import {
  getSupabaseAnonKeyValue,
  getSupabaseClient,
  hasSupabaseConfig,
} from "./supabase-client";
import type { PlannerRole, PlannerUserProfile } from "./planner-types";

export type PlannerAuthStatus =
  | "checking"
  | "authenticated"
  | "unauthenticated"
  | "unavailable"
  | "error";

interface CreatePlannerUserInput {
  email: string;
  password: string;
  role: PlannerRole;
}

interface SetPlannerUserActiveInput {
  userId: string;
  isActive: boolean;
}

interface SessionIdentity {
  id: string;
  email: string;
}

const authStatus = ref<PlannerAuthStatus>("checking");
const authReady = ref(false);
const authError = ref("");
const sessionIdentity = ref<SessionIdentity | null>(null);
const currentUserProfile = ref<PlannerUserProfile | null>(null);
const plannerUsersExist = ref<boolean | null>(null);
const managedUsers = ref<PlannerUserProfile[]>([]);
const authLoading = ref(false);

let initializePromise: Promise<void> | null = null;
let authSubscriptionBound = false;
let authSyncEventBound = false;
export const PLANNER_AUTH_UPDATED_EVENT = "planner:auth-updated";
const authEmitterId = `planner-auth-${Math.random().toString(36).slice(2)}`;

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? "").trim().toLocaleLowerCase("es-ES");
}

function normalizeRole(value: string | null | undefined): PlannerRole {
  if (value === "admin" || value === "editor") {
    return value;
  }

  return "viewer";
}

function normalizePlannerUserProfile(row: {
  id: string;
  email: string | null;
  role: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}): PlannerUserProfile {
  return {
    id: row.id,
    email: normalizeEmail(row.email),
    role: normalizeRole(row.role),
    isActive: row.is_active ?? true,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? new Date().toISOString(),
  };
}

function getSupabaseClientOrThrow() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error("Supabase no está configurado.");
  }

  return supabase;
}

async function resolveFunctionInvokeErrorMessage(
  error: unknown,
  fallbackMessage: string,
) {
  if (error && typeof error === "object" && "context" in error) {
    const response = (error as { context?: Response }).context;

    if (response instanceof Response) {
      try {
        const payload = await response.clone().json();

        if (
          payload &&
          typeof payload === "object" &&
          "error" in payload &&
          typeof payload.error === "string" &&
          payload.error.trim()
        ) {
          return payload.error.trim();
        }
      } catch {
        // Ignore JSON parsing errors and continue with text fallback.
      }

      try {
        const responseText = (await response.clone().text()).trim();

        if (responseText) {
          return responseText;
        }
      } catch {
        // Ignore text parsing errors and continue with default fallback.
      }
    }
  }

  if (error instanceof Error) {
    const normalizedMessage = error.message.trim();

    if (
      normalizedMessage &&
      normalizedMessage !== "Edge Function returned a non-2xx status code"
    ) {
      return normalizedMessage;
    }
  }

  return fallbackMessage;
}

function dispatchPlannerAuthUpdated() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(PLANNER_AUTH_UPDATED_EVENT, {
      detail: {
        source: authEmitterId,
      },
    }),
  );
}

async function refreshPlannerUsersExist() {
  if (!hasSupabaseConfig()) {
    plannerUsersExist.value = null;
    return null;
  }

  const supabase = getSupabaseClientOrThrow();
  const { data, error } = await supabase.rpc("planner_has_users");

  if (error) {
    throw error;
  }

  plannerUsersExist.value = Boolean(data);
  return plannerUsersExist.value;
}

async function invokePlannerUserAdmin(body: Record<string, unknown>) {
  const supabase = getSupabaseClientOrThrow();
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  const accessToken = session?.access_token?.trim();

  if (!accessToken) {
    throw new Error("No se encontró una sesión válida para gestionar usuarios.");
  }

  const anonKey = getSupabaseAnonKeyValue();

  if (!anonKey) {
    throw new Error("Falta la anon key de Supabase para invocar la función.");
  }

  return supabase.functions.invoke("planner-user-admin", {
    body: {
      ...body,
      accessToken,
    },
    headers: {
      Authorization: `Bearer ${anonKey}`,
    },
  });
}

async function loadCurrentUserProfile(userId: string) {
  const supabase = getSupabaseClientOrThrow();
  const { data, error } = await supabase
    .from("planner_users")
    .select("id, email, role, is_active, created_at, updated_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? normalizePlannerUserProfile(data) : null;
}

async function applySessionUser(user: User | null, broadcast = false) {
  sessionIdentity.value = user
    ? {
        id: user.id,
        email: normalizeEmail(user.email),
      }
    : null;

  if (!user) {
    currentUserProfile.value = null;
    managedUsers.value = [];
    authStatus.value = "unauthenticated";

    if (broadcast) {
      dispatchPlannerAuthUpdated();
    }

    return;
  }

  try {
    const profile = await loadCurrentUserProfile(user.id);

    if (profile?.isActive) {
      currentUserProfile.value = profile;
      authStatus.value = "authenticated";
      authError.value = "";

      if (broadcast) {
        dispatchPlannerAuthUpdated();
      }

      return;
    }

    const hasUsers = await refreshPlannerUsersExist();

    currentUserProfile.value = null;
    managedUsers.value = [];
    authStatus.value = "unauthenticated";

    if (profile && !profile.isActive) {
      authError.value = "Tu usuario está dado de baja.";
      await getSupabaseClientOrThrow().auth.signOut();

      if (broadcast) {
        dispatchPlannerAuthUpdated();
      }

      return;
    }

    if (hasUsers) {
      authError.value = "Tu usuario no tiene permisos para acceder a la app.";
      await getSupabaseClientOrThrow().auth.signOut();

      if (broadcast) {
        dispatchPlannerAuthUpdated();
      }

      return;
    }
  } catch (error) {
    console.error("No se pudo sincronizar la sesión del usuario.", error);
    currentUserProfile.value = null;
    managedUsers.value = [];
    authStatus.value = "error";
    authError.value =
      "No se pudo validar la sesión actual. Revisa la configuración de Supabase.";

    if (broadcast) {
      dispatchPlannerAuthUpdated();
    }
  }
}

export async function refreshPlannerAuthSession(broadcast = false) {
  if (!hasSupabaseConfig()) {
    authStatus.value = "unavailable";
    authReady.value = true;
    plannerUsersExist.value = null;
    return;
  }

  await refreshPlannerUsersExist();
  const supabase = getSupabaseClientOrThrow();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  await applySessionUser(session?.user ?? null, broadcast);
}

export async function ensurePlannerAuthInitialized() {
  if (initializePromise) {
    return initializePromise;
  }

  initializePromise = (async () => {
    if (!hasSupabaseConfig()) {
      authStatus.value = "unavailable";
      authReady.value = true;
      plannerUsersExist.value = null;
      return;
    }

    try {
      await refreshPlannerAuthSession();

      const supabase = getSupabaseClientOrThrow();

      if (!authSubscriptionBound) {
        supabase.auth.onAuthStateChange((_event, nextSession) => {
          void refreshPlannerUsersExist().catch((refreshError) => {
            console.error(
              "No se pudo refrescar el estado de usuarios durante el cambio de sesión.",
              refreshError,
            );
          });
          void applySessionUser(nextSession?.user ?? null, true);
        });
        authSubscriptionBound = true;
      }

      if (!authSyncEventBound && typeof window !== "undefined") {
        window.addEventListener(PLANNER_AUTH_UPDATED_EVENT, (event) => {
          if (!(event instanceof CustomEvent)) {
            return;
          }

          if (event.detail?.source === authEmitterId) {
            return;
          }

          void refreshPlannerAuthSession().catch((refreshError) => {
            console.error(
              "No se pudo refrescar la sesión tras un cambio de autenticación externo.",
              refreshError,
            );
          });
        });
        authSyncEventBound = true;
      }
    } catch (error) {
      console.error("No se pudo inicializar la autenticación.", error);
      authStatus.value = "error";
      authError.value =
        "No se pudo inicializar la autenticación. Revisa la configuración de Supabase y las migraciones.";
    } finally {
      authReady.value = true;
    }
  })();

  return initializePromise;
}

export async function signInWithPassword(email: string, password: string) {
  await ensurePlannerAuthInitialized();

  if (!hasSupabaseConfig()) {
    throw new Error("La autenticación requiere Supabase configurado.");
  }

  authLoading.value = true;
  authError.value = "";

  try {
    const supabase = getSupabaseClientOrThrow();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizeEmail(email),
      password,
    });

    if (error) {
      throw error;
    }

    await applySessionUser(data.user ?? data.session?.user ?? null, true);

    if (authStatus.value !== "authenticated") {
      throw new Error(authError.value || "No se pudo completar el acceso.");
    }
  } finally {
    authLoading.value = false;
  }
}

export async function signOutPlannerUser() {
  await ensurePlannerAuthInitialized();

  if (!hasSupabaseConfig()) {
    return;
  }

  authLoading.value = true;
  authError.value = "";

  try {
    await getSupabaseClientOrThrow().auth.signOut();
    currentUserProfile.value = null;
    sessionIdentity.value = null;
    managedUsers.value = [];
    authStatus.value = "unauthenticated";
    dispatchPlannerAuthUpdated();
  } finally {
    authLoading.value = false;
  }
}

export async function bootstrapFirstAdmin(email: string, password: string) {
  await ensurePlannerAuthInitialized();

  if (!hasSupabaseConfig()) {
    throw new Error("La autenticación requiere Supabase configurado.");
  }

  const hasUsers = await refreshPlannerUsersExist();

  if (hasUsers) {
    throw new Error("La app ya tiene usuarios. Inicia sesión con tu cuenta.");
  }

  authLoading.value = true;
  authError.value = "";

  try {
    const supabase = getSupabaseClientOrThrow();
    const { data, error } = await supabase.auth.signUp({
      email: normalizeEmail(email),
      password,
    });

    if (error) {
      throw error;
    }

    if (!data.session?.user) {
      throw new Error(
        "Desactiva la confirmación de email en Supabase Auth para poder crear el administrador inicial desde la app.",
      );
    }

    const { error: bootstrapError } = await supabase.rpc(
      "planner_bootstrap_admin",
    );

    if (bootstrapError) {
      throw bootstrapError;
    }

    await refreshPlannerUsersExist();
    await applySessionUser(data.session.user, true);
  } finally {
    authLoading.value = false;
  }
}

export async function loadManagedPlannerUsers() {
  await ensurePlannerAuthInitialized();

  if (!hasSupabaseConfig()) {
    managedUsers.value = [];
    return [];
  }

  const supabase = getSupabaseClientOrThrow();
  const { data, error } = await supabase
    .from("planner_users")
    .select("id, email, role, is_active, created_at, updated_at")
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  managedUsers.value = (data ?? []).map((row) =>
    normalizePlannerUserProfile(row),
  );

  return managedUsers.value;
}

export async function createManagedPlannerUser(input: CreatePlannerUserInput) {
  await ensurePlannerAuthInitialized();

  if (!hasSupabaseConfig()) {
    throw new Error("La autenticación requiere Supabase configurado.");
  }

  const { data, error } = await invokePlannerUserAdmin({
      action: "create",
      email: normalizeEmail(input.email),
      password: input.password,
      role: input.role,
  });

  if (error) {
    throw new Error(
      await resolveFunctionInvokeErrorMessage(
        error,
        "No se pudo crear el usuario. Revisa que la función planner-user-admin esté desplegada y tenga acceso a SUPABASE_SERVICE_ROLE_KEY.",
      ),
    );
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  await loadManagedPlannerUsers();
  return data?.user ?? null;
}

export async function deleteManagedPlannerUser(userId: string) {
  await ensurePlannerAuthInitialized();

  if (!hasSupabaseConfig()) {
    throw new Error("La autenticación requiere Supabase configurado.");
  }

  const { data, error } = await invokePlannerUserAdmin({
      action: "delete",
      userId,
  });

  if (error) {
    throw new Error(
      await resolveFunctionInvokeErrorMessage(
        error,
        "No se pudo dar de baja al usuario. Revisa la función planner-user-admin.",
      ),
    );
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  await loadManagedPlannerUsers();
}

export async function setManagedPlannerUserActive(
  input: SetPlannerUserActiveInput,
) {
  await ensurePlannerAuthInitialized();

  if (!hasSupabaseConfig()) {
    throw new Error("La autenticación requiere Supabase configurado.");
  }

  const { data, error } = await invokePlannerUserAdmin({
      action: "set-active",
      userId: input.userId,
      isActive: input.isActive,
  });

  if (error) {
    throw new Error(
      await resolveFunctionInvokeErrorMessage(
        error,
        "No se pudo actualizar el estado del usuario. Revisa la función planner-user-admin.",
      ),
    );
  }

  if (data?.error) {
    throw new Error(String(data.error));
  }

  await loadManagedPlannerUsers();
  return data?.user ?? null;
}

export const plannerAuthState = {
  authStatus: readonly(authStatus),
  authReady: readonly(authReady),
  authError: readonly(authError),
  authLoading: readonly(authLoading),
  sessionIdentity: readonly(sessionIdentity),
  currentUserProfile: readonly(currentUserProfile),
  plannerUsersExist: readonly(plannerUsersExist),
  managedUsers: readonly(managedUsers),
  isAuthenticated: computed(() => authStatus.value === "authenticated"),
  isAdmin: computed(() => currentUserProfile.value?.role === "admin"),
  isEditor: computed(() => currentUserProfile.value?.role === "editor"),
  isViewer: computed(() => currentUserProfile.value?.role === "viewer"),
  canManageSettings: computed(() => currentUserProfile.value?.role === "admin"),
  canManageUsers: computed(() => currentUserProfile.value?.role === "admin"),
  canEditReports: computed(
    () =>
      currentUserProfile.value?.role === "admin" ||
      currentUserProfile.value?.role === "editor",
  ),
  canViewReports: computed(
    () =>
      currentUserProfile.value?.role === "admin" ||
      currentUserProfile.value?.role === "editor" ||
      currentUserProfile.value?.role === "viewer",
  ),
};
