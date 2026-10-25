<template>
  <section class="widgets-panel" :aria-busy="loading" @keydown.esc.capture="closeLocalPopup">
    <header class="widgets-panel-header">
      <div class="widgets-panel-mark" aria-hidden="true">
        <VIcon icon="widgets" :size="24" />
      </div>
      <div class="widgets-panel-heading">
        <h2 id="bilibili-clear-widgets-title">功能</h2>
        <p>当前页面可用的操作</p>
      </div>
      <button
        type="button"
        class="widgets-panel-close"
        title="关闭功能窗口（Esc）"
        aria-label="关闭功能窗口"
        @click="$emit('close')"
      >
        <VIcon icon="close" :size="20" />
      </button>
    </header>

    <div class="widgets-panel-body">
      <div v-if="loading" class="widgets-panel-state" role="status">
        <VIcon icon="widgets" :size="30" />
        <p>正在整理本页功能…</p>
      </div>
      <div v-if="!loading && failedWidgets > 0" class="widgets-panel-notice" role="status">
        <span>部分功能暂时无法加载。</span>
        <button type="button" class="widgets-panel-text-action" @click="queueRefresh">
          重试
        </button>
      </div>
      <div v-if="!loading && widgets.length === 0" class="widgets-panel-state" role="status">
        <VIcon icon="widgets" :size="30" />
        <h3>{{ failedWidgets > 0 ? '暂时未能加载功能' : '当前页面暂无可用操作' }}</h3>
        <p>到视频、动态或直播页面查看相应功能，也可在设置中开启需要的功能。</p>
      </div>
      <div v-show="!loading" class="widget-items">
        <component
          :is="w.component"
          v-for="w of widgets"
          :key="w.name"
          class="widget-item"
          :options="w.options"
        />
      </div>
    </div>

    <footer class="widgets-panel-footer">
      <span>功能随当前页面显示</span>
      <button type="button" class="widgets-panel-settings" @click="$emit('settings')">
        <VIcon icon="settings-outline" :size="17" />
        打开设置
      </button>
    </footer>
  </section>
</template>

<script lang="ts">
import { Widget } from '@/components/widget'
import { matchUrlPattern } from '@/core/utils'
import { VIcon } from '@/ui'
import { registerAndGetData } from '../../plugins/data'
import { WidgetsPlugin } from '.'

const allWidgets: Widget[] = []
const widgetFilter = async (widget: Widget) => {
  if (widget.urlExclude && widget.urlExclude.some(matchUrlPattern)) {
    return false
  }
  if (widget.urlInclude && widget.urlInclude.every(lodash.negate(matchUrlPattern))) {
    return false
  }
  return widget.condition ? (await widget.condition()) === true : true
}

export default Vue.extend({
  components: { VIcon },
  props: {
    active: {
      type: Boolean,
      default: true,
    },
  },
  data() {
    unsafeWindow.allWidgets = allWidgets
    return {
      allWidgets,
      widgets: [] as Widget[],
      loading: true,
      failedWidgets: 0,
      refreshVersion: 0,
      refreshQueued: false,
      disposed: false,
    }
  },
  watch: {
    allWidgets() {
      this.queueRefresh()
    },
    active(value: boolean) {
      if (value) {
        this.queueRefresh()
      } else {
        this.refreshVersion += 1
      }
    },
  },
  created() {
    registerAndGetData(WidgetsPlugin, allWidgets)
    this.queueRefresh()
  },
  beforeDestroy() {
    this.disposed = true
    this.refreshVersion += 1
  },
  methods: {
    closeLocalPopup(event: KeyboardEvent) {
      if (event.isComposing || event.defaultPrevented || !(event.target instanceof Element)) {
        return
      }
      const element = event.target.closest('.be-popup.open') as HTMLElement & {
        __vue__?: {
          $emit: (name: string, open: boolean) => void
          trigger: HTMLElement | null
        }
      }
      if (!element || !this.$el.contains(element) || !element.__vue__) {
        return
      }
      const popup = element.__vue__
      const trigger = popup.trigger
      event.preventDefault()
      event.stopPropagation()
      popup.$emit('popup-change', false)
      this.$nextTick(() => {
        if (trigger instanceof HTMLElement && trigger.isConnected) {
          trigger.focus({ preventScroll: true })
        }
      })
    },
    queueRefresh() {
      if (!this.active || this.disposed || this.refreshQueued) {
        return
      }
      this.refreshQueued = true
      this.$nextTick(() => {
        this.refreshQueued = false
        if (this.active && !this.disposed) {
          this.refreshWidgets()
        }
      })
    },
    async refreshWidgets() {
      this.refreshVersion += 1
      const version = this.refreshVersion
      const snapshot = lodash.uniqBy(this.allWidgets as Widget[], widget => widget.name)
      this.loading = true
      const results = await Promise.all(
        snapshot.map(async widget => {
          try {
            return { widget, available: await widgetFilter(widget), failed: false }
          } catch (error) {
            console.error(`[Bilibili Clear] 功能入口加载失败: ${widget.name}`, error)
            return { widget, available: false, failed: true }
          }
        }),
      )
      if (this.disposed || !this.active || version !== this.refreshVersion) {
        return
      }
      // Keep registration order even when async conditions finish out of order.
      this.widgets = results.filter(result => result.available).map(result => result.widget)
      this.failedWidgets = results.filter(result => result.failed).length
      this.loading = false
    },
  },
})
</script>

<style lang="scss">
@import 'common';

.widgets-panel {
  --widgets-surface: #fff;
  --widgets-field: #f4f7f9;
  --widgets-line: #e3e9ed;
  --widgets-ink: #20303d;
  --widgets-muted: #6b7a86;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  min-height: 280px;
  max-height: var(--panel-height, calc(100vh - 64px));
  overflow: hidden;
  background: var(--widgets-surface);
  color: var(--widgets-ink);
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  line-height: 1.5;

  body.dark & {
    --widgets-surface: var(--be-color-panel-bg, #222);
    --widgets-field: var(--be-color-card-bg, #2b2d31);
    --widgets-line: #ffffff1f;
    --widgets-ink: var(--be-color-text-title, #eee);
    --widgets-muted: #a1acb8;
  }

  &-header {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-shrink: 0;
    padding: 24px 28px 20px;
    border-bottom: 1px solid var(--widgets-line);
  }

  &-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 42px;
    height: 42px;
    border: 1px solid var(--widgets-line);
    border-radius: 12px;
    color: var(--theme-color, #00a0d8);
  }

  &-heading {
    flex: 1;
    min-width: 0;

    h2 {
      margin: 0;
      color: inherit;
      font-size: 22px;
      font-weight: 600;
      line-height: 1.4;
    }

    p {
      margin: 3px 0 0;
      color: var(--widgets-muted);
      font-size: 13px;
    }
  }

  &-close,
  &-settings,
  &-text-action {
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--theme-color, #00a0d8);
      outline-offset: 3px;
    }
  }

  &-close {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 36px;
    height: 36px;
    padding: 0;
    border-radius: 9px;
    color: var(--widgets-muted);

    &:hover {
      background: var(--widgets-field);
      color: var(--widgets-ink);
    }
  }

  &-body {
    min-height: 0;
    padding: 24px 28px;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: #93a5b14d transparent;
  }

  &-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 150px;
    padding: 20px;
    box-sizing: border-box;
    text-align: center;
    color: var(--widgets-muted);

    h3 {
      margin: 16px 0 0;
      color: var(--widgets-ink);
      font-size: 16px;
      font-weight: 600;
    }

    p {
      max-width: 320px;
      margin: 10px 0 0;
      font-size: 13px;
      line-height: 1.7;
    }
  }

  &-notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    margin-bottom: 16px;
    border-radius: 8px;
    background: var(--widgets-field);
    color: var(--widgets-muted);
    font-size: 13px;
  }

  &-text-action {
    flex-shrink: 0;
    padding: 4px;
    color: var(--theme-color, #00a0d8);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .widget-items,
  .widget-items .multiple-widgets {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-items: start;
    gap: 12px;
  }

  .widget-items {
    .widget-item {
      min-width: 0;
      max-width: 100%;
      font-size: 14px;
    }

    .multiple-widgets,
    .switch-options,
    .option-widget-layout {
      grid-column: 1 / -1;
      min-width: 0;
    }

    .default-widget.be-button,
    .switch-options > .be-button {
      box-sizing: border-box;
      min-height: 60px;
      padding: 14px 16px;
      border-radius: 10px;
      font-size: 14px;
      color: var(--widgets-ink);
      box-shadow: 0 0 0 1px var(--widgets-line);

      > .content-container {
        justify-content: flex-start;
        min-width: 0;
        line-height: 1.5;
      }

      .widget-icon,
      .switch-icon {
        flex-shrink: 0;
        margin-right: 12px;
        color: var(--theme-color, #00a0d8);
        opacity: 1;
      }

      .widget-name {
        min-width: 0;
        white-space: normal;
        overflow-wrap: anywhere;
      }

      &:focus-visible {
        box-shadow: 0 0 0 2px var(--theme-color, #00a0d8);
      }
    }

    .option-widget-layout {
      display: flex;
      flex-direction: column-reverse;
    }

    // Expand local options inside the window instead of beyond the scroll viewport.
    .switch-options .switch-options-popup,
    .option-widget-layout .option-widget-popup {
      position: static;
      inset: auto;
      display: none;
      width: 100%;
      min-width: 0;
      max-height: none;
      margin: 10px 0 0;
      padding: 12px;
      box-sizing: border-box;
      transform: none;
      transition: none;
      box-shadow: none;
      border: 1px solid var(--widgets-line);
      border-radius: 10px;
      background: var(--widgets-field);
      color: var(--widgets-ink);
      white-space: normal;
      overflow: visible;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px 12px;

      &.open {
        display: grid;
        transform: none;
      }
    }
  }

  &-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-shrink: 0;
    padding: 16px 28px;
    border-top: 1px solid var(--widgets-line);
    color: var(--widgets-muted);
    font-size: 12px;
  }

  &-settings {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
    padding: 6px 0;
    color: var(--widgets-ink);
    font-size: 13px;
    font-weight: 500;

    &:hover {
      color: var(--theme-color, #00a0d8);
    }
  }

  @media (max-width: 540px) {
    &-header {
      gap: 10px;
      padding: 20px;
    }

    &-body {
      padding: 20px;
    }

    &-footer {
      padding: 14px 20px;
    }

    .widget-items,
    .widget-items .multiple-widgets,
    .widget-items .switch-options .switch-options-popup,
    .widget-items .option-widget-layout .option-widget-popup {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .widget-items .be-button,
    .widget-items .be-button * {
      transition: none;
    }
  }
}
</style>
