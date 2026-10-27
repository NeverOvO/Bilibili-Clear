<template>
  <img class="clear-brand-icon" :src="projectMark" alt="" aria-hidden="true" draggable="false" />
</template>

<script lang="ts">
import projectMark from './project-mark.svg?inline'

export default {
  name: 'ClearBrandIcon',
  data: () => ({ projectMark }),
}
</script>

<style lang="scss" scoped>
.clear-brand-icon {
  display: block;
  width: 32px;
  height: 32px;
  flex: none;
  object-fit: contain;
}
</style>
