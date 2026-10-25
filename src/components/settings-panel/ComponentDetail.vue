<template>
  <div class="component-detail">
    <div v-if="!settings" class="component-not-found">
      未找到组件'{{ componentData.displayName }}' ({{ componentData.name }}), 可能已被卸载.
    </div>
    <template v-if="settings">
      <div class="component-detail-header">
        <div class="display-name">
          {{ componentData.displayName }}
        </div>
        <button
          type="button"
          class="component-detail-back"
          aria-label="返回功能列表"
          title="返回功能列表"
          @click="$emit('close')"
        >
          <VIcon icon="mdi-arrow-left" :size="16" aria-hidden="true" />
          <span>返回</span>
        </button>
      </div>
      <div class="component-detail-tags">
        <div v-for="t of componentData.tags" :key="t.name" class="tag">
          <div class="tag-color" :style="{ backgroundColor: t.color }"></div>
          {{ t.displayName }}
        </div>
      </div>
      <div class="component-detail-separator"></div>
      <template
        v-if="(componentData.options && generatedOptions.length > 0) || componentData.extraOptions"
      >
        <div class="component-detail-options">
          <div class="component-detail-options-title">选项</div>
          <div v-for="[name, option] of generatedOptions" :key="name" class="generated-option">
            <ComponentOption
              :name="name"
              :display-name="option.displayName"
              :option="option"
              :component="componentData"
            ></ComponentOption>
          </div>
          <div v-if="componentData.extraOptions" class="extra-option">
            <component :is="componentData.extraOptions" :component-data="componentData"></component>
          </div>
          <slot></slot>
        </div>
        <div class="component-detail-separator"></div>
      </template>
      <template v-if="!(componentData.options && !componentData.description)">
        <ComponentDescription
          class="component-detail-description"
          :component-data="componentData"
        />
        <!-- <div class="component-detail-separator"></div> -->
      </template>
      <div class="component-detail-grow"></div>
      <div class="component-detail-internal-data">
        <div class="component-detail-separator"></div>
        <div v-if="componentData.commitHash" class="component-detail-internal-data-row">
          <div class="component-detail-commit">
            <span class="internal-name"
              >Commit: {{ componentData.commitHash.substring(0, 9) }}</span
            >
            <VIcon
              v-if="isLocalDebugUrl"
              class="local-debug-warning"
              icon="mdi-alert-circle-outline"
              :size="14"
              title="当前组件的更新地址是本地开发链接, 不会随着检查更新而更新"
            />
          </div>
        </div>
        <div class="component-detail-internal-data-row">
          <div class="internal-name">内部名称: {{ componentData.name }}</div>
          <MiniToast
            v-if="componentData.configurable !== false && componentActions.length > 0"
            placement="bottom"
            trigger="click"
            class="extra-actions-wrapper"
          >
            <button type="button" class="extra-actions" aria-label="更多功能操作">
              <VIcon icon="mdi-dots-vertical" :size="18" aria-hidden="true" />
            </button>
            <template #toast>
              <div class="extra-actions-list">
                <div v-for="a of componentActions" :key="a.name">
                  <component
                    :is="a.component"
                    v-if="a.component"
                    :item="a"
                    :component="componentData"
                  />
                  <ComponentAction
                    v-else
                    v-show="a.visible !== false"
                    class="extra-action-item"
                    :item="a"
                    :component="componentData"
                  />
                </div>
              </div>
            </template>
          </MiniToast>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { VIcon, MiniToast } from '@/ui'
import { getComponentSettings } from '@/core/settings'
import type { AutoUpdateOptions } from '../auto-update'
import { OptionsMetadata } from '../component'
import ComponentDescription from './ComponentDescription.vue'
import ComponentOption from './ComponentOption.vue'
import { componentSettingsMixin } from './mixins'
import { componentActions, ComponentConfigAction } from './component-actions/component-actions'
import ComponentAction from './component-actions/ComponentAction.vue'

export default Vue.extend({
  components: {
    ComponentDescription,
    ComponentOption,
    ComponentAction,
    VIcon,
    MiniToast,
  },
  mixins: [componentSettingsMixin],
  data() {
    return {
      componentActions: componentActions
        .map(factory => factory((this as any).componentData))
        .filter(it => {
          if (it === undefined) {
            return false
          }
          if ((it as ComponentConfigAction).visible === false) {
            return false
          }
          return true
        }),
    }
  },
  computed: {
    generatedOptions() {
      return Object.entries((this.componentData.options ?? {}) as OptionsMetadata).filter(
        ([, option]) => !option.hidden,
      )
    },
    isLocalDebugUrl() {
      const { options } = getComponentSettings<AutoUpdateOptions>('autoUpdate')
      const url = options.urls.components[this.componentData.name]?.url ?? ''
      return /^http:\/\/(?:localhost|127\.0\.0\.1):\d+\/registry\/dist\/components\/.+\.js$/.test(url)
    },
  },
  async mounted() {
    await this.$nextTick()
    this.$emit('mounted')
  },
})
</script>

<style lang="scss">
@import 'common';

.settings-panel .component-detail {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  background-color: var(--clear-panel-bg, #fff);
  color: var(--clear-panel-ink, #20303d);

  .component-not-found {
    padding: 24px;
    line-height: 1.7;
  }
  .extra-option {
    display: flow-root;
    min-width: 0;
  }
  &-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 22px 22px 14px;
    background-color: var(--clear-panel-bg, #fff);
    position: sticky;
    top: 0;
    z-index: 2;
    .display-name {
      min-width: 0;
      overflow-wrap: anywhere;
      font-size: 18px;
      font-weight: 600;
      line-height: 1.45;
    }
  }
  &-back,
  .extra-actions {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex-shrink: 0;
    min-width: 32px;
    min-height: 32px;
    padding: 6px 8px;
    margin: 0;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--clear-panel-muted, #6b7a86);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    &:hover {
      color: var(--theme-color);
      background-color: var(--clear-panel-soft, #f3f7f9);
    }
    &:focus-visible {
      outline: 2px solid var(--theme-color);
      outline-offset: 2px;
    }
  }
  &-tags {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0 22px 18px;
    .tag {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      line-height: 18px;
      color: var(--clear-panel-muted, #6b7a86);
      .tag-color {
        border-radius: 50%;
        width: 6px;
        height: 6px;
        flex-shrink: 0;
      }
    }
  }
  &-separator {
    height: 1px;
    background-color: var(--clear-panel-border, #e2e9ee);
    margin: 0 22px;
    flex-shrink: 0;
  }
  &-description {
    padding: 18px 22px;
    line-height: 1.75;
    overflow-wrap: anywhere;
    img {
      max-width: 100%;
      height: auto;
    }
  }
  &-options {
    padding: 18px 22px;
    .component-detail-options-title {
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 12px;
    }
    .generated-option:not(:last-child) {
      margin-bottom: 12px;
    }
    .component-option {
      min-height: 30px;
      gap: 8px;
      line-height: 1.5;
      .option-name {
        min-width: 0;
        margin-right: 0;
        overflow-wrap: anywhere;
      }
      .be-text-box,
      .be-text-area,
      .be-dropdown {
        min-width: 0;
      }
      textarea {
        max-width: 100%;
      }
    }
  }
  &-grow {
    flex: 1;
  }
  &-internal-data {
    display: flex;
    flex-direction: column;
    justify-content: center;
    flex-shrink: 0;
    position: sticky;
    bottom: 0;
    background-color: var(--clear-panel-bg, #fff);
    padding-bottom: 12px;
    .component-detail-separator {
      margin-bottom: 8px;
    }
    &-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 26px;
      padding: 0 22px;
    }
    .internal-name {
      font-size: 11px;
      line-height: 1.6;
      color: var(--clear-panel-muted, #6b7a86);
      overflow-wrap: anywhere;
    }
    .component-detail-commit {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .local-debug-warning {
      color: #c27c12;
      flex-shrink: 0;
    }
    .tippy-content {
      padding: 4px;
    }
    .extra-actions-wrapper {
      flex-shrink: 0;
      .extra-actions-list {
        width: max-content;
      }
    }
  }
  &-operations {
    @include h-center();
    > * {
      flex: 1 0 0;
      &:not(:last-child) {
        margin-right: 8px;
      }
    }
  }
}
</style>
