<template>
  <section class="settings-panel">
    <header class="settings-panel-header">
      <div class="settings-panel-mark" aria-hidden="true">
        <VIcon icon="settings-outline" :size="24" />
      </div>
      <div class="settings-panel-heading">
        <h2 id="bilibili-clear-settings-title">设置</h2>
        <span>Bilibili Clear</span>
      </div>
      <button
        type="button"
        class="settings-panel-close"
        title="关闭设置窗口（Esc）"
        aria-label="关闭设置窗口"
        @click="$emit('close')"
      >
        <VIcon icon="close" :size="20" />
      </button>
    </header>
    <div
      class="settings-panel-content"
      :class="{ 'showing-detail': componentDetailOpen, 'showing-sub-page': selectedSubPage }"
    >
      <aside ref="sidebarContainer" class="sidebar">
        <ComponentTags
          ref="componentTags"
          @change="searchFilter = $event"
          @tag-change="selectedTag = $event"
          @sub-page="openSubPage"
        />
      </aside>
      <div v-show="!selectedSubPage" class="settings-panel-workspace">
        <div class="settings-panel-browser">
          <div class="settings-panel-search-bar">
            <VIcon icon="search" :size="18" aria-hidden="true" />
            <TextBox
              v-model="searchKeyword"
              class="settings-panel-search"
              placeholder="搜索功能或设置"
              aria-label="搜索功能或设置"
            />
            <button
              v-if="searchKeyword"
              type="button"
              class="settings-panel-clear-search"
              aria-label="清空搜索"
              @click="searchKeyword = ''"
            >
              <VIcon icon="close" :size="16" />
            </button>
          </div>
          <div class="settings-panel-list-heading">
            <span class="settings-panel-category">{{ selectedTag.displayName || '全部功能' }}</span>
            <span class="settings-panel-count">{{ renderedComponents.length }}</span>
            <div class="settings-panel-search-actions">
              <VButton
                v-for="action of searchBarActions"
                :key="action.key"
                type="transparent"
                icon
                :title="actionTitle(action)"
                :aria-label="actionTitle(action)"
                :disabled="action.disabled ? action.disabled(searchBarContext) : false"
                @click="action.run(searchBarContext)"
              >
                <VIcon :icon="action.icon" :size="17" />
              </VButton>
            </div>
          </div>
          <div ref="mainContainer" class="main">
            <div ref="componentList" class="component-list">
              <div v-for="c of renderedComponents" :key="c.name" @click.capture="handleRowClick($event, c)">
                <ComponentSettings
                  :selected="isComponentSelected(c.name)"
                  :component-data="c"
                  :data-name="c.name"
                  @select="selectComponent"
                />
              </div>
              <div v-if="renderedComponents.length === 0" class="settings-panel-empty" role="status">
                <VIcon icon="search" :size="28" aria-hidden="true" />
                <strong>没有找到匹配的功能</strong>
                <span>换个关键词，或选择其他分类。</span>
                <button v-if="searchKeyword" type="button" @click="searchKeyword = ''">清空搜索</button>
              </div>
            </div>
          </div>
        </div>
        <div
          ref="detailsPanel"
          class="component-detail-panel"
          :class="{ 'has-component': componentDetailOpen }"
          tabindex="-1"
          role="region"
          :aria-label="selectedComponent ? selectedComponent.displayName + '设置与说明' : '功能详情'"
        >
          <ComponentDetail
            v-if="selectedComponent"
            :key="selectedComponent.name"
            :component-data="selectedComponent"
            @close="closePopper(true)"
          />
          <div v-else class="settings-panel-detail-empty">
            <VIcon icon="settings-outline" :size="40" aria-hidden="true" />
            <h3>按你的习惯调整 B 站</h3>
            <p>选择一项功能，查看说明并调整选项。</p>
            <span>功能开关与详细选项分开操作</span>
          </div>
        </div>
      </div>
      <div v-show="selectedSubPage" class="settings-panel-sub-page">
        <keep-alive>
          <component
            :is="selectedSubPage.component"
            v-if="selectedSubPage"
            :key="selectedSubPage.name"
          />
        </keep-alive>
      </div>
    </div>
    <footer class="settings-panel-footer">
      <span>v{{ version }}</span>
      <span><kbd>Esc</kbd> 关闭窗口</span>
    </footer>
  </section>
</template>

<script lang="ts">
import { VIcon, TextBox, VButton } from '@/ui'
import { getHook } from '@/plugins/hook'
import { deleteValue } from '@/core/utils'
import { meta } from '@/core/meta'
import ComponentSettings from './ComponentSettings.vue'
import { ComponentMetadata, components } from '../component'
import ComponentDetail from './ComponentDetail.vue'
import ComponentTags from './ComponentTags.vue'
import { getDescriptionText } from '../description'
import { SearchBarAction, SearchBarActionContext, searchBarActions } from './search-bar-actions'
import { SubPage } from './sub-pages'
import { SettingsTag } from './tag-filter'

const defaultSearchFilter = (items: ComponentMetadata[]) => items
export default {
  name: 'SettingsPanel',
  components: { VIcon, TextBox, VButton, ComponentSettings, ComponentDetail, ComponentTags },
  props: {
    active: { type: Boolean, default: true },
  },
  data() {
    return {
      components,
      version: meta.version,
      renderedComponents: components.filter(c => !c.hidden),
      selectedComponent: null as ComponentMetadata | null,
      selectedComponents: [] as ComponentMetadata[],
      selectedSubPage: null as SubPage | null,
      selectedTag: {} as SettingsTag,
      componentDetailOpen: false,
      searchKeyword: '',
      searchFilter: defaultSearchFilter,
      searchBarActions,
      searchGeneration: 0,
      debouncedSearch: null,
      detailReturnFocus: null as HTMLElement | null,
    }
  },
  computed: {
    isComponentSelected() {
      return (name: string) =>
        this.selectedComponents.some((component: ComponentMetadata) => component.name === name)
    },
    searchBarContext(): SearchBarActionContext {
      return lodash.pick(
        this,
        'components',
        'selectedComponent',
        'selectedComponents',
        'searchKeyword',
        'searchFilter',
      )
    },
  },
  watch: {
    searchKeyword() {
      this.searchGeneration += 1
      this.debouncedSearch()
    },
    searchFilter() {
      this.searchKeyword = ''
      this.closePopper()
      this.updateRenderedComponents()
    },
    components() {
      this.updateRenderedComponents()
      this.$refs.componentTags?.refreshTags()
      if (!this.components.some((c: ComponentMetadata) => c.name === this.selectedComponent?.name)) {
        this.closePopper()
      }
    },
    active(value: boolean) {
      if (value) {
        this.$refs.componentTags?.refreshTags()
        this.updateRenderedComponents()
      }
    },
  },
  created() {
    this.debouncedSearch = lodash.debounce(() => this.updateRenderedComponents(), 150)
  },
  beforeDestroy() {
    this.debouncedSearch.cancel()
    this.searchGeneration += 1
  },
  methods: {
    actionTitle(action: SearchBarAction) {
      return typeof action.title === 'function' ? action.title(this.searchBarContext) : action.title
    },
    openSubPage(page: SubPage | null) {
      this.selectedSubPage = page
      if (page) {
        this.closePopper()
      }
    },
    closePopper(restoreFocus = false) {
      const selectedName = this.selectedComponent?.name
      const closeHooks = getHook('settingsPanel.componentDetail.close')
      if (selectedName) {
        closeHooks.before(selectedName)
      }
      this.selectedComponent = null
      this.selectedComponents = []
      this.componentDetailOpen = false
      if (selectedName) {
        closeHooks.after(selectedName)
      }
      if (restoreFocus) {
        this.$nextTick(() => {
          if (this.detailReturnFocus?.isConnected) {
            this.detailReturnFocus.focus({ preventScroll: true })
          }
        })
      }
    },
    handleRowClick(event: MouseEvent, component: ComponentMetadata) {
      const target = event.target as HTMLElement
      if (
        target.closest('.component-settings-toggle') ||
        (!event.ctrlKey && !event.metaKey && !event.shiftKey)
      ) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      this.selectMultipleComponent(component, event.shiftKey)
    },
    selectMultipleComponent(component: ComponentMetadata, listSelect = false) {
      if (this.selectedComponent && listSelect) {
        const list = this.renderedComponents as ComponentMetadata[]
        let start = list.findIndex(c => c.name === this.selectedComponent.name)
        let end = list.findIndex(c => c.name === component.name)
        if (start < 0 || end < 0) {
          return
        }
        if (start > end) {
          ;[start, end] = [end, start]
        }
        this.selectedComponents = list.slice(start, end + 1)
        return
      }
      if (this.selectedComponents.some((c: ComponentMetadata) => c.name === component.name)) {
        deleteValue(this.selectedComponents, (c: ComponentMetadata) => c.name === component.name)
      } else {
        this.selectedComponents.push(component)
      }
    },
    selectComponent(component: ComponentMetadata) {
      const isAlreadySelected = this.componentDetailOpen && this.selectedComponent?.name === component.name
      this.closePopper()
      if (isAlreadySelected) {
        return
      }
      const openHooks = getHook('settingsPanel.componentDetail.open')
      openHooks.before(component.name)
      this.detailReturnFocus = document.activeElement as HTMLElement
      this.selectedComponent = component
      this.selectedComponents.push(component)
      this.componentDetailOpen = true
      openHooks.after(component.name)
      this.$nextTick(() => this.$refs.detailsPanel?.focus({ preventScroll: true }))
    },
    async updateRenderedComponents() {
      this.searchGeneration += 1
      const generation = this.searchGeneration
      const keyword = this.searchKeyword.trim().toLowerCase()
      const currentComponents = [...components]
      const textMap: Record<string, string> = keyword
        ? Object.fromEntries(await Promise.all(currentComponents.map(async component => {
            let description = ''
            try {
              description = await getDescriptionText(component)
            } catch (error) {
              console.warn('功能说明暂时无法读取', component.name, error)
            }
            return [
              component.name,
              [
                component.name,
                component.displayName,
                component.tags.map(tag => `${tag.name} ${tag.displayName}`).join(' '),
                description,
              ].join(' ').toLowerCase(),
            ]
          })))
        : {}
      if (generation !== this.searchGeneration) {
        return
      }
      const filtered = currentComponents.filter(
        component => !component.hidden && (!keyword || textMap[component.name]?.includes(keyword)),
      )
      this.renderedComponents = this.searchFilter(filtered)
    },
  },
}
</script>

<style lang="scss">
.be-settings .settings-panel {
  --header-height: 84px;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-radius: inherit;
  color: var(--clear-panel-ink);
  background: var(--clear-panel-bg);
  box-sizing: border-box;
  button {
    cursor: pointer;
    color: inherit;
    background: transparent;
    border: 0;
    padding: 0;
  }
  .settings-panel-header {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: var(--header-height);
    flex-shrink: 0;
    padding: 16px 24px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--clear-panel-border);
  }
  .settings-panel-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 42px;
    height: 42px;
    border-radius: 12px;
    color: var(--theme-color);
    background: var(--clear-panel-soft);
  }
  .settings-panel-heading {
    flex: 1;
    h2 {
      margin: 0;
      font-size: 21px;
      line-height: 28px;
      font-weight: 600;
      color: inherit;
    }
    span {
      font-size: 12px;
      color: var(--clear-panel-muted);
    }
  }
  .settings-panel-close,
  .settings-panel-clear-search {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    border-radius: 8px;
    color: var(--clear-panel-muted);
  }
  .settings-panel-close:hover {
    background: var(--clear-panel-soft);
    color: var(--clear-panel-ink);
  }
  .settings-panel-content {
    display: flex;
    flex: 1;
    min-height: 0;
    min-width: 0;
    > .sidebar {
      width: 176px;
      flex: 0 0 176px;
      display: flex;
      min-height: 0;
      background: var(--clear-panel-soft);
      border-right: 1px solid var(--clear-panel-border);
    }
  }
  .settings-panel-workspace {
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  .settings-panel-browser {
    display: flex;
    flex-direction: column;
    width: 340px;
    flex: 0 0 340px;
    min-height: 0;
    border-right: 1px solid var(--clear-panel-border);
  }
  .settings-panel-search-bar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    height: 40px;
    padding: 0 8px 0 12px;
    margin: 16px 16px 12px;
    border: 1px solid var(--clear-panel-border);
    background: var(--clear-panel-soft);
    border-radius: 9px;
    color: var(--clear-panel-muted);
    &:focus-within {
      border-color: var(--theme-color);
      box-shadow: 0 0 0 2px var(--theme-color-20);
    }
    .settings-panel-search {
      box-shadow: none;
      font-size: 13px;
      align-self: stretch;
      input {
        padding: 8px;
        color: var(--clear-panel-ink);
      }
    }
  }
  .settings-panel-list-heading {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
    min-height: 36px;
    padding: 0 16px 10px;
    color: var(--clear-panel-muted);
    font-size: 12px;
    border-bottom: 1px solid var(--clear-panel-border);
    .settings-panel-category {
      color: var(--clear-panel-ink);
      font-weight: 600;
    }
    .settings-panel-count {
      font-variant-numeric: tabular-nums;
    }
    .settings-panel-search-actions {
      display: flex;
      gap: 3px;
      margin-left: auto;
    }
  }
  .main {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: #93a5b14d transparent;
  }
  .component-detail-panel {
    flex: 1;
    min-width: 0;
    min-height: 0;
    outline: none;
    display: flex;
    background: var(--clear-panel-bg);
  }
  .settings-panel-detail-empty,
  .settings-panel-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 28px;
    color: var(--clear-panel-muted);
    text-align: center;
    flex: 1;
    font-size: 13px;
    line-height: 1.7;
    .be-icon {
      color: var(--theme-color);
      opacity: 0.65;
      margin-bottom: 6px;
    }
    h3,
    strong {
      margin: 0;
      color: var(--clear-panel-ink);
      font-size: 17px;
      font-weight: 500;
    }
    p {
      margin: 0;
    }
    span {
      font-size: 12px;
    }
    button {
      padding: 7px 12px;
      color: var(--theme-color);
      border: 1px solid var(--clear-panel-border);
      border-radius: 6px;
    }
  }
  .settings-panel-empty {
    padding: 48px 20px;
  }
  .settings-panel-sub-page {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 24px;
    font-size: 13px;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    .sub-page-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
      &:not(:last-child) {
        margin-bottom: 14px;
      }
    }
    .separator {
      height: 1px;
      background: var(--clear-panel-border);
      width: 100%;
    }
  }
  .settings-panel-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    min-height: 34px;
    padding: 0 20px;
    border-top: 1px solid var(--clear-panel-border);
    font-size: 11px;
    color: var(--clear-panel-muted);
    kbd {
      font: inherit;
      border: 1px solid var(--clear-panel-border);
      border-radius: 4px;
      padding: 1px 5px;
      margin-right: 3px;
    }
  }
  @media (max-width: 1050px) {
    .settings-panel-content > .sidebar {
      width: 156px;
      flex-basis: 156px;
    }
    .settings-panel-browser {
      width: 300px;
      flex-basis: 300px;
    }
  }
  @media (max-width: 880px) {
    .settings-panel-browser {
      width: auto;
      flex: 1;
      border-right: 0;
    }
    .component-detail-panel {
      display: none;
    }
    .showing-detail {
      .settings-panel-browser {
        display: none;
      }
      .component-detail-panel {
        display: flex;
      }
    }
  }
  @media (max-width: 520px) {
    --header-height: 72px;
    .settings-panel-header {
      gap: 10px;
      padding: 12px 14px;
    }
    .settings-panel-mark {
      display: none;
    }
    .settings-panel-content > .sidebar {
      width: 112px;
      flex-basis: 112px;
    }
    .component-tags-preview {
      padding: 12px 4px;
      .navigation-label {
        margin-left: 8px;
      }
      .component-tags-item {
        padding: 8px;
        gap: 6px;
        .be-icon {
          display: none;
        }
      }
    }
    .settings-panel-search-bar {
      margin: 12px 10px 8px;
      padding-left: 8px;
    }
    .settings-panel-sub-page {
      padding: 16px;
      .sub-page-row {
        flex-wrap: wrap;
        gap: 8px;
      }
    }
  }
}
</style>
