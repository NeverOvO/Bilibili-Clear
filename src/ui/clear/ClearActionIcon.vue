<template>
  <svg
    class="clear-action-icon"
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <g v-if="name === 'widgets'">
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </g>
    <g v-else-if="name === 'settings'">
      <path d="M3 7h5m6 0h7M3 17h9m6 0h3" />
      <circle cx="11" cy="7" r="3" />
      <circle cx="15" cy="17" r="3" />
    </g>
    <g v-else-if="name === 'portrait'">
      <rect x="5" y="2.5" width="14" height="19" rx="3" />
      <path d="m9.5 8.4 5.5 3.6-5.5 3.6Z" />
    </g>
    <path
      v-else-if="name === 'switch'"
      d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"
    />
    <path v-else-if="name === 'close'" d="m6 6 12 12M18 6 6 18" />
  </svg>
</template>

<script lang="ts">
export default {
  name: 'ClearActionIcon',
  props: {
    name: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      default: 24,
    },
  },
}
</script>

<style lang="scss">
.clear-action-icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
