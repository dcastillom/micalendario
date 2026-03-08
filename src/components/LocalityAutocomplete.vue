<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { SPANISH_MUNICIPALITIES } from "../lib/spanish-municipalities";

const props = defineProps<{
  modelValue: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const MAX_RESULTS = 8;
const MUNICIPALITY_BY_NORMALIZED_NAME = new Map(
  SPANISH_MUNICIPALITIES.map((municipality) => [normalize(municipality), municipality])
);

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

const filteredMunicipalities = computed(() => {
  const query = normalize(inputValue.value);

  if (!query) {
    return SPANISH_MUNICIPALITIES.slice(0, MAX_RESULTS);
  }

  return SPANISH_MUNICIPALITIES.filter((municipality) => normalize(municipality).includes(query)).slice(
    0,
    MAX_RESULTS
  );
});

watch(
  () => props.modelValue,
  (value) => {
    inputValue.value = value;
  }
);

watch(filteredMunicipalities, (results) => {
  highlightedIndex.value = results.length > 0 ? 0 : -1;
});

function openDropdown() {
  isOpen.value = true;
}

function closeDropdown() {
  window.setTimeout(() => {
    isOpen.value = false;
  }, 120);
}

function handleInput(event: Event) {
  const nextValue = (event.target as HTMLInputElement).value;
  inputValue.value = nextValue;
  isOpen.value = true;
}

function selectMunicipality(value: string) {
  inputValue.value = value;
  emit("update:modelValue", value);
  isOpen.value = false;
}

function handleKeydown(event: KeyboardEvent) {
  if (!isOpen.value && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    isOpen.value = true;
    return;
  }

  if (!filteredMunicipalities.value.length) {
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    highlightedIndex.value = (highlightedIndex.value + 1) % filteredMunicipalities.value.length;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    highlightedIndex.value =
      highlightedIndex.value <= 0 ? filteredMunicipalities.value.length - 1 : highlightedIndex.value - 1;
  }

  if (event.key === "Enter" && highlightedIndex.value >= 0) {
    event.preventDefault();
    selectMunicipality(filteredMunicipalities.value[highlightedIndex.value]);
  }

  if (event.key === "Escape") {
    isOpen.value = false;
  }
}

function commitIfValid() {
  const exactMatch = MUNICIPALITY_BY_NORMALIZED_NAME.get(normalize(inputValue.value));

  if (exactMatch) {
    selectMunicipality(exactMatch);
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
      type="text"
      placeholder="Escribe una localidad"
      autocomplete="off"
      @focus="openDropdown"
      @blur="closeDropdown(); commitIfValid()"
      @input="handleInput"
      @keydown="handleKeydown"
    />

    <div v-if="isOpen" class="autocomplete__panel">
      <button
        v-for="(municipality, index) in filteredMunicipalities"
        :key="municipality"
        class="autocomplete__option"
        :class="{ 'is-highlighted': index === highlightedIndex }"
        type="button"
        @mousedown.prevent="selectMunicipality(municipality)"
      >
        {{ municipality }}
      </button>

      <p v-if="filteredMunicipalities.length === 0" class="autocomplete__empty">
        No hay coincidencias.
      </p>
    </div>
  </div>
</template>
