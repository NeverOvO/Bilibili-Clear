<template>
  <svg
    class="clear-action-icon"
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <g v-if="['widgets', 'settings', 'portrait', 'switch'].includes(name)">
      <path d="m8.5 7-3-3.5M15.5 7l3-3.5M6.5 20v1.5m11-1.5v1.5" />
      <rect x="3" y="7" width="18" height="13" rx="3.7" fill="currentColor" fill-opacity=".07" />
      <g v-if="name === 'widgets'" fill="currentColor" stroke="none">
        <rect x="7.8" y="9.9" width="2.8" height="2.8" rx=".8" />
        <rect x="13.4" y="9.9" width="2.8" height="2.8" rx=".8" />
        <rect x="7.8" y="14.3" width="2.8" height="2.8" rx=".8" />
        <rect x="13.4" y="14.3" width="2.8" height="2.8" rx=".8" />
      </g>
      <g v-else-if="name === 'settings'" stroke-width="1.45">
        <path d="M7.3 11h9.4m-9.4 5h9.4" />
        <circle cx="10" cy="11" r="1.7" fill="currentColor" stroke="none" />
        <circle cx="14" cy="16" r="1.7" fill="currentColor" stroke="none" />
      </g>
      <g v-else-if="name === 'portrait'" stroke-width="1.45">
        <path d="M7 10.5v6m10-6v6" />
        <path d="m10.2 10.8 4.2 2.7-4.2 2.7Z" fill="currentColor" stroke-width=".7" />
      </g>
      <path
        v-else-if="name === 'switch'"
        d="M7.7 11.2h8.6m-2-2 2 2-2 2M16.3 15.8H7.7m2-2-2 2 2 2"
        stroke-width="1.45"
      />
    </g>
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
