<template>
  <div class="component-settings" :class="{ selected }">
    <button
      type="button"
      class="component-settings-select"
      :aria-pressed="selected"
      :aria-label="`${componentData.displayName}，查看设置与说明`"
      @click="$emit('select', componentData)"
    >
      <TagRing :tags="componentData.tags" aria-hidden="true" />
      <span class="component-settings-copy">
        <span class="display-name">{{ componentData.displayName }}</span>
        <span class="component-settings-meta">
          <span v-if="componentData.configurable !== false">
            {{ settings.enabled ? '已启用' : '已关闭' }}
          </span>
          <span v-if="optionsCount > 0">{{ optionsCount }} 项设置</span>
          <span v-else>功能说明</span>
        </span>
      </span>
      <VIcon
        v-if="componentData.configurable === false"
        icon="right-arrow"
        class="details-arrow"
        :size="16"
        aria-hidden="true"
      />
    </button>
    <div
      v-if="componentData.configurable !== false"
      class="component-settings-toggle"
      @click.stop
    >
      <SwitchBox
        v-model="settings.enabled"
        :aria-label="`${componentData.displayName}，${settings.enabled ? '已启用' : '已关闭'}`"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { getComponentSettings } from '@/core/settings'
import SwitchBox from '@/ui/SwitchBox.vue'
import VIcon from '@/ui/icon/VIcon.vue'
import TagRing from './TagRing.vue'
import { OptionsMetadata } from '../component'

export default Vue.extend({
  components: { SwitchBox, TagRing, VIcon },
  props: {
    componentData: {
      type: Object,
      required: true,
    },
    selected: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      settings: getComponentSettings(this.componentData),
    }
  },
  computed: {
    optionsCount() {
      return Object.values((this.componentData.options ?? {}) as OptionsMetadata).filter(
        option => !option.hidden,
      ).length
    },
  },
})
</script>

<style lang="scss">
.settings-panel .component-settings {
  display: flex;
  align-items: stretch;
  width: 100%;
  min-height: 62px;
  position: relative;
  box-sizing: border-box;
  color: var(--clear-panel-ink, #20303d);
  border-bottom: 1px solid var(--clear-panel-border, #e2e9ee);
  transition: background-color 0.16s ease-out;

  .component-settings-select {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    padding: 12px 12px 12px 16px;
    border: 0;
    margin: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    .tag-ring {
      flex: 0 0 auto;
    }
    &:focus-visible {
      outline: 2px solid var(--theme-color);
      outline-offset: -3px;
      border-radius: 5px;
    }
  }
  .component-settings-copy {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    flex: 1;
  }
  .display-name {
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    overflow-wrap: anywhere;
  }
  .component-settings-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 11px;
    line-height: 16px;
    color: var(--clear-panel-muted, #6b7a86);
  }
  .details-arrow {
    flex-shrink: 0;
    color: var(--clear-panel-muted, #6b7a86);
  }
  .component-settings-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 54px;
    .be-switch-box {
      margin: 0;
      padding: 9px 0;
      &:focus-visible {
        outline: 2px solid var(--theme-color) !important;
        outline-offset: 4px;
        border-radius: 5px;
      }
    }
  }
  &:hover {
    background-color: var(--clear-panel-soft, #f3f7f9);
  }
  &.selected {
    background-color: var(--theme-color-10, #eef8fc);
    box-shadow: inset 3px 0 0 var(--theme-color);
    .display-name {
      color: var(--theme-color);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
}
</style>
