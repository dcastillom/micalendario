<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { SPANISH_LOCALITIES, SPANISH_PROVINCES } from "../lib/spanish-municipalities";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    disabled?: boolean;
  }>(),
  {
    disabled: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const MAX_RESULTS = 8;
const inputValue = ref(props.modelValue);
const isOpen = ref(false);
const highlightedIndex = ref(-1);

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-ES")
    .trim();
}

const PROVINCES = new Set(SPANISH_PROVINCES);
const LOCALITIES = SPANISH_LOCALITIES.map((locality) => {
  const municipalityName = locality.replace(/\s+\([^()]+\)$/, "");

  return {
    locality,
    normalizedLocality: normalize(locality),
    normalizedMunicipalityName: normalize(municipalityName),
    isProvince: PROVINCES.has(locality)
  };
});

const LOCALITY_BY_NORMALIZED_NAME = new Map(LOCALITIES.map(({ normalizedLocality, locality }) => [normalizedLocality, locality]));

function getMatchPriority(
  query: string,
  locality: {
    normalizedLocality: string;
    normalizedMunicipalityName: string;
    isProvince: boolean;
  }
) {
  if (locality.normalizedLocality === query) {
    return 0;
  }

  if (locality.isProvince && locality.normalizedLocality.startsWith(query)) {
    return 1;
  }

  if (!locality.isProvince && locality.normalizedMunicipalityName.startsWith(query)) {
    return 2;
  }

  if (locality.isProvince && locality.normalizedLocality.includes(query)) {
    return 3;
  }

  if (!locality.isProvince && locality.normalizedMunicipalityName.includes(query)) {
    return 4;
  }

  return 5;
}

const filteredLocalities = computed(() => {
  const query = normalize(inputValue.value);

  if (!query) {
    return [...SPANISH_PROVINCES, ...SPANISH_LOCALITIES.filter((locality) => !PROVINCES.has(locality))].slice(0, MAX_RESULTS);
  }

  return LOCALITIES.filter(({ normalizedLocality }) => normalizedLocality.includes(query))
    .sort((left, right) => {
      const priorityDifference = getMatchPriority(query, left) - getMatchPriority(query, right);

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return left.locality.localeCompare(right.locality, "es", { sensitivity: "base" });
    })
    .slice(0, MAX_RESULTS)
    .map(({ locality }) => locality);
});

watch(
  () => props.modelValue,
  (value) => {
    inputValue.value = value;
  }
);

watch(filteredLocalities, (results) => {
  highlightedIndex.value = results.length > 0 ? 0 : -1;
});

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) {
      isOpen.value = false;
    }
  },
);

function openDropdown() {
  if (props.disabled) {
    return;
  }

  isOpen.value = true;
}

function closeDropdown() {
  window.setTimeout(() => {
    isOpen.value = false;
  }, 120);
}

function handleInput(event: Event) {
  if (props.disabled) {
    return;
  }

  const nextValue = (event.target as HTMLInputElement).value;
  inputValue.value = nextValue;
  isOpen.value = true;
}

function selectLocality(value: string) {
  inputValue.value = value;
  emit("update:modelValue", value);
  isOpen.value = false;
}

function handleKeydown(event: KeyboardEvent) {
  if (props.disabled) {
    return;
  }

  if (!isOpen.value && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    isOpen.value = true;
    return;
  }

  if (!filteredLocalities.value.length) {
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    highlightedIndex.value = (highlightedIndex.value + 1) % filteredLocalities.value.length;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    highlightedIndex.value =
      highlightedIndex.value <= 0 ? filteredLocalities.value.length - 1 : highlightedIndex.value - 1;
  }

  if (event.key === "Enter" && highlightedIndex.value >= 0) {
    event.preventDefault();
    selectLocality(filteredLocalities.value[highlightedIndex.value]);
  }

  if (event.key === "Escape") {
    isOpen.value = false;
  }
}

function commitIfValid() {
  const exactMatch = LOCALITY_BY_NORMALIZED_NAME.get(normalize(inputValue.value));

  if (exactMatch) {
    selectLocality(exactMatch);
    return;
  }

  inputValue.value = props.modelValue;
  isOpen.value = false;
}
</script>

<template>
  <div class="autocomplete">
    <input
      :value="inputValue"
      :disabled="props.disabled"
      type="text"
      placeholder="Escribe un municipio o provincia"
      autocomplete="off"
      @focus="openDropdown"
      @blur="closeDropdown(); commitIfValid()"
      @input="handleInput"
      @keydown="handleKeydown"
    />

    <div v-if="isOpen && !props.disabled" class="autocomplete__panel">
      <button
        v-for="(locality, index) in filteredLocalities"
        :key="locality"
        class="autocomplete__option"
        :class="{ 'is-highlighted': index === highlightedIndex }"
        type="button"
        @mousedown.prevent="selectLocality(locality)"
      >
        {{ locality }}
      </button>

      <p v-if="filteredLocalities.length === 0" class="autocomplete__empty">
        No hay coincidencias.
      </p>
    </div>
  </div>
</template>
