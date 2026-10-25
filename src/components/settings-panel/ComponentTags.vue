<template>
  <nav class="component-tags-preview" aria-label="功能分类与项目设置">
    <div class="component-tags">
      <div class="navigation-label">功能分类</div>
      <button
        v-for="t of tags"
        :key="t.name"
        type="button"
        class="component-tags-item"
        :class="{ selected: !selectedSubPageOpen && t.name === selectedTagName }"
        :aria-current="!selectedSubPageOpen && t.name === selectedTagName ? 'page' : null"
        @click="selectTag(t)"
      >
        <VIcon :size="19" :icon="t.icon" :style="{ color: t.color }" aria-hidden="true" />
        <span class="tag-name">{{ t.displayName }}</span>
        <span class="tag-count">{{ t.count }}</span>
      </button>
    </div>
    <div class="component-tags-secondary">
      <div class="navigation-label">扩展与设置</div>
      <button
        v-for="t of subPages"
        :key="t.name"
        type="button"
        class="component-tags-item"
        :class="{ selected: selectedSubPageOpen && selectedSubPage === t.component }"
        :aria-current="selectedSubPageOpen && selectedSubPage === t.component ? 'page' : null"
        @click="openSubPage($event, t.component)"
      >
        <VIcon :size="19" :icon="t.icon" aria-hidden="true" />
        <span class="tag-name">{{ t.displayName }}</span>
      </button>
    </div>
  </nav>
</template>

<script lang="ts">
import { Executable, VueModule } from '@/core/common-types'
import { ascendingSort } from '@/core/utils/sort'
import VIcon from '@/ui/icon/VIcon.vue'
import { components, ComponentTag } from '../component'
import { subPages } from './sub-pages'
import { SettingsTag, tagFilters } from './tag-filter'

export default Vue.extend({
  components: { VIcon },
  data() {
    return {
      tags: [] as SettingsTag[],
      selectedTagName: '',
      subPages,
      selectedSubPage: null as Executable<VueModule> | null,
      selectedSubPageOpen: false,
      selectedSubPageTrigger: null as EventTarget | null,
    }
  },
  created() {
    this.refreshTags()
    this.reset()
  },
  mounted() {
    this.selectTag(this.tags[0])
  },
  methods: {
    refreshTags() {
      const renderedComponents = components.filter(c => !c.hidden)
      const tags = tagFilters.flatMap(f => {
        if (typeof f === 'function') {
          return f({ components, renderedComponents })
        }
        return f
      })
      this.tags = tags.sort(ascendingSort(it => it.order))
      const activeTag = this.tags.find(t => t.name === this.selectedTagName)
      if (activeTag) {
        this.$emit('tag-change', activeTag)
      }
    },
    reset() {
      this.selectedTagName = this.tags[0]?.name ?? ''
    },
    selectTag(tag: ComponentTag) {
      const selectedTag = (this.tags as SettingsTag[]).find(t => t.name === tag?.name)
      if (!selectedTag) {
        return
      }
      this.selectedTagName = selectedTag.name
      this.selectedSubPageOpen = false
      this.$emit('sub-page', null)
      this.$emit('tag-change', selectedTag)
      this.$emit('change', selectedTag.filter)
    },
    openSubPage(e: MouseEvent, component: Executable<VueModule>) {
      const subPage = this.subPages.find(page => page.component === component)
      if (!subPage) {
        return
      }
      if (this.selectedSubPage === component && this.selectedSubPageOpen) {
        this.selectedSubPageOpen = false
        this.$emit('sub-page', null)
        return
      }
      this.selectedSubPage = component
      this.selectedSubPageTrigger = e.currentTarget
      this.selectedSubPageOpen = true
      this.$emit('sub-page', subPage)
    },
  },
})
</script>

<style lang="scss">
.settings-panel .component-tags-preview {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 16px 10px 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  box-sizing: border-box;
  gap: 24px;
  color: var(--clear-panel-ink, #20303d);

  .navigation-label {
    margin: 0 10px 10px;
    font-size: 11px;
    line-height: 16px;
    font-weight: 500;
    color: var(--clear-panel-muted, #6b7a86);
  }
  .component-tags,
  .component-tags-secondary {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .component-tags-secondary {
    margin-top: auto;
  }
  .component-tags-item {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 38px;
    width: 100%;
    padding: 8px 10px;
    margin: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 13px;
    line-height: 20px;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.16s ease-out;
    .be-icon {
      flex-shrink: 0;
    }
    .tag-name {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .tag-count {
      color: var(--clear-panel-muted, #6b7a86);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    &:hover {
      background-color: var(--clear-panel-border, #e2e9ee);
    }
    &.selected {
      background-color: var(--clear-panel-bg, #fff);
      color: var(--theme-color);
      font-weight: 600;
      box-shadow: inset 3px 0 0 var(--theme-color);
    }
    &:focus-visible {
      outline: 2px solid var(--theme-color);
      outline-offset: 2px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .component-tags-item {
      transition: none;
    }
  }
  @media (max-width: 600px) {
    padding: 12px 6px;
    .navigation-label {
      margin-left: 8px;
      margin-right: 4px;
    }
    .component-tags-item {
      gap: 7px;
      padding: 8px;
      font-size: 12px;
      .tag-count {
        display: none;
      }
    }
  }
}
</style>
