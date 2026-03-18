<script setup lang="ts">
import { computed, useSlots } from "vue";
import type { PlannerSettings } from "../lib/planner-types";

interface Props {
  settings: PlannerSettings;
  fallbackName?: string;
  fallbackSubtitle?: string;
  compact?: boolean;
  logoClickHref?: string;
  hasActions?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  fallbackName: "",
  fallbackSubtitle: "",
  compact: false,
  logoClickHref: "",
  hasActions: false,
});
const slots = useSlots();

const displayName = computed(
  () => props.settings.companyName.trim() || props.fallbackName,
);
const displaySubtitle = computed(
  () => props.settings.companySubtitle.trim() || props.fallbackSubtitle,
);
const hasLogo = computed(() =>
  props.settings.companyLogoDataUrl.trim().startsWith("data:image/"),
);
const hasActions = computed(() => props.hasActions || Boolean(slots.actions));

function reloadApp() {
  if (typeof window === "undefined") {
    return;
  }

  const targetHref = props.logoClickHref.trim();

  if (!targetHref) {
    return;
  }

  window.location.assign(targetHref);
}
</script>

<template>
  <section
    class="company-header"
    :class="{ 'company-header--compact': compact }"
  >
    <button
      v-if="hasLogo && logoClickHref"
      class="company-header__logo company-header__logo-button"
      type="button"
      :aria-label="`Ir al inicio de ${displayName}`"
      @click="reloadApp"
    >
      <img
        :src="settings.companyLogoDataUrl"
        :alt="`Logotipo de ${displayName}`"
      />
    </button>

    <div v-else-if="hasLogo" class="company-header__logo">
      <img
        :src="settings.companyLogoDataUrl"
        :alt="`Logotipo de ${displayName}`"
      />
    </div>

    <div
      class="company-header__body"
      :class="{ 'company-header__body--with-actions': hasActions }"
    >
      <div class="company-header__copy">
        <strong class="company-header__name">{{ displayName }}</strong>
        <p v-if="displaySubtitle" class="company-header__subtitle">
          {{ displaySubtitle }}
        </p>
      </div>

      <div v-if="hasActions" class="company-header__actions">
        <slot name="actions" />
      </div>
    </div>
  </section>
</template>
