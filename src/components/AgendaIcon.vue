<script setup lang="ts">
defineProps<{ name: "previous" | "next" | "today" | "day" | "month" }>();
</script>

<template>
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    <path v-if="name === 'previous'" d="M19 12H5m0 0 7-7m-7 7 7 7" />
    <path v-else-if="name === 'next'" d="M5 12h14m0 0-7-7m7 7-7 7" />
    <path v-else-if="name === 'day'" d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" />
    <template v-else>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4m8-4v4M4 9h16" />
      <circle v-if="name === 'today'" cx="12" cy="14" r="1.4" fill="currentColor" stroke="none" />
    </template>
  </svg>
</template>
