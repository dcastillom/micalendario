<script setup lang="ts">
import { computed, useSlots } from "vue";
import type { PlannerSettings } from "../lib/planner-types";

interface Props {
  settings: PlannerSettings;
  fallbackName?: string;
  fallbackSubtitle?: string;
  compact?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  fallbackName: "Mi Calendario",
  fallbackSubtitle: "",
  compact: false,
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
const hasActions = computed(() => Boolean(slots.actions));
</script>

<template>
  <section
    class="company-header"
    :class="{ 'company-header--compact': compact }"
  >
    <div v-if="hasLogo" class="company-header__logo">
      <img
        :src="settings.companyLogoDataUrl"
        :alt="`Logotipo de ${displayName}`"
      />
    </div>

    <div
      class="company-header__copy"
      :class="{ 'company-header__copy--with-actions': hasActions }"
    >
      <strong class="company-header__name">{{ displayName }}</strong>
      <div v-if="hasActions" class="company-header__actions">
        <slot name="actions" />
      </div>
      <p v-if="displaySubtitle" class="company-header__subtitle">
        {{ displaySubtitle }}
      </p>
    </div>
  </section>
</template>
