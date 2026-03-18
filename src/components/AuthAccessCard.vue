<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  bootstrapFirstAdmin,
  ensurePlannerAuthInitialized,
  plannerAuthState,
  signInWithPassword,
} from "../lib/planner-auth";

interface Props {
  title?: string;
  subtitle?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: "Acceso a la app",
  subtitle:
    "Inicia sesión para entrar en la agenda o en filtros con los permisos de tu usuario.",
});

const email = ref("");
const password = ref("");
const formError = ref("");
const isSubmitting = ref(false);

const isBootstrapMode = computed(
  () => plannerAuthState.plannerUsersExist.value === false,
);
const submitLabel = computed(() =>
  isBootstrapMode.value ? "Crear admin inicial" : "Entrar",
);

async function submitCredentials() {
  formError.value = "";
  isSubmitting.value = true;

  try {
    if (!email.value.trim() || !password.value.trim()) {
      throw new Error("Escribe email y contraseña.");
    }

    if (isBootstrapMode.value) {
      await bootstrapFirstAdmin(email.value, password.value);
      return;
    }

    await signInWithPassword(email.value, password.value);
  } catch (error) {
    formError.value =
      error instanceof Error
        ? error.message
        : "No se pudo completar el acceso.";
  } finally {
    isSubmitting.value = false;
  }
}

onMounted(() => {
  void ensurePlannerAuthInitialized();
});
</script>

<template>
  <section
    class="planner-sheet"
    :class="{ 'auth-card': !plannerAuthState.isAuthenticated.value }"
  >
    <div v-if="!plannerAuthState.authReady.value" class="auth-card__body">
      <h2>{{ title }}</h2>
      <p class="sidebar-copy">Comprobando acceso…</p>
    </div>

    <div
      v-else-if="plannerAuthState.authStatus.value === 'unavailable'"
      class="auth-card__body"
    >
      <h2>{{ title }}</h2>
      <p class="sidebar-copy">
        Esta versión necesita Supabase configurado para usar usuarios y
        permisos.
      </p>
      <p class="sidebar-copy">
        Añade `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY` para activar el
        acceso con roles.
      </p>
    </div>

    <div
      v-else-if="plannerAuthState.authStatus.value === 'error'"
      class="auth-card__body"
    >
      <h2>{{ title }}</h2>
      <p class="sidebar-copy">
        {{
          plannerAuthState.authError.value ||
          "No se pudo inicializar el acceso."
        }}
      </p>
    </div>

    <form v-else class="auth-card__form" @submit.prevent="submitCredentials">
      <div class="auth-card__header">
        <!-- <p class="eyebrow">
          {{ isBootstrapMode ? "Inicio" : "Usuarios" }}
        </p> -->
        <h2>{{ title }}</h2>
        <p class="sidebar-copy">
          {{
            isBootstrapMode
              ? "Todavía no existe ningún usuario. Crea aquí el primer administrador."
              : subtitle
          }}
        </p>
      </div>

      <label class="field">
        <span class="field-label">Email</span>
        <input v-model="email" type="email" autocomplete="username" />
      </label>

      <label class="field">
        <span class="field-label">Contraseña</span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
        />
      </label>

      <p
        v-if="formError || plannerAuthState.authError.value"
        class="auth-card__error"
      >
        {{ formError || plannerAuthState.authError.value }}
      </p>

      <div class="auth-card__actions">
        <button
          class="primary-button"
          type="submit"
          :disabled="isSubmitting || plannerAuthState.authLoading.value"
        >
          {{ submitLabel }}
        </button>
      </div>
    </form>
  </section>
</template>
