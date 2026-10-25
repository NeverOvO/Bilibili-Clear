<template>
  <div class="be-settings">
    <div class="clear-launcher" aria-label="Bilibili Clear">
      <button
        ref="launcherButton"
        type="button"
        title="Bilibili Clear · 设置与页面功能"
        aria-label="打开 Bilibili Clear 设置与页面功能"
        aria-haspopup="dialog"
        :aria-expanded="Boolean(activePanel)"
        :class="{ open: activePanel }"
        @click="toggleLauncher"
        @mouseenter="loadPanel('settingsPanelPopup')"
        @focus="loadPanel('settingsPanelPopup')"
      >
        <ClearLauncherIcon />
      </button>
    </div>
    <div
      v-if="activePanel"
      class="clear-panel-backdrop"
      aria-hidden="true"
      @click.self="closePanel"
    ></div>
    <VPopup
      ref="widgetsPanelPopup"
      v-model="widgetsOpened"
      v-show="widgetsOpened"
      class="widgets-panel-popup clear-panel-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bilibili-clear-widgets-title"
      tabindex="-1"
      :fixed="true"
      :auto-close="false"
    >
      <WidgetsPanel
        :active="widgetsOpened"
        @close="closePanel"
        @settings="openPanel('settings')"
      />
    </VPopup>
    <VPopup
      ref="settingsPanelPopup"
      v-model="settingsOpened"
      v-show="settingsOpened"
      class="settings-panel-popup clear-panel-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bilibili-clear-settings-title"
      tabindex="-1"
      :fixed="true"
      :auto-close="false"
    >
      <SettingsPanel
        :active="settingsOpened"
        @close="closePanel"
        @widgets="openPanel('widgets')"
      />
    </VPopup>
  </div>
</template>

<script lang="ts">
import { VPopup } from '@/ui'
import ClearLauncherIcon from './ClearLauncherIcon.vue'

type PanelName = 'settings' | 'widgets'
const focusableSelector =
  'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]'

export default {
  name: 'SettingsContainer',
  components: {
    VPopup,
    ClearLauncherIcon,
    SettingsPanel: () => import('./SettingsPanel.vue').then(m => m.default),
    WidgetsPanel: () => import('./WidgetsPanel.vue').then(m => m.default),
  },
  data() {
    return {
      settingsOpened: false,
      widgetsOpened: false,
      returnFocus: null as HTMLElement | null,
    }
  },
  computed: {
    activePanel(): PanelName | null {
      if (this.settingsOpened) {
        return 'settings'
      }
      return this.widgetsOpened ? 'widgets' : null
    },
  },
  watch: {
    settingsOpened(open: boolean) {
      if (open) {
        this.widgetsOpened = false
      }
    },
    widgetsOpened(open: boolean) {
      if (open) {
        this.settingsOpened = false
      }
    },
    activePanel(next: PanelName | null, previous: PanelName | null) {
      document.body.classList.toggle('bilibili-clear-dialog-open', Boolean(next))
      if (next) {
        if (!previous) {
          this.returnFocus = document.activeElement as HTMLElement
        }
        this.loadPanel(`${next}PanelPopup`)
        this.$nextTick(() => this.getActiveDialog()?.focus({ preventScroll: true }))
      } else {
        const target = this.returnFocus
        this.returnFocus = null
        this.$nextTick(() => {
          if (target?.isConnected) {
            target.focus({ preventScroll: true })
          }
        })
      }
    },
  },
  mounted() {
    GM_registerMenuCommand('功能', () => this.openPanel('widgets'))
    GM_registerMenuCommand('设置', () => this.openPanel('settings'))
    document.addEventListener('keydown', this.handleKeydown)
    document.addEventListener('focusin', this.handleFocus)
  },
  beforeDestroy() {
    document.removeEventListener('keydown', this.handleKeydown)
    document.removeEventListener('focusin', this.handleFocus)
    document.body.classList.remove('bilibili-clear-dialog-open')
    if (this.activePanel && this.returnFocus?.isConnected) {
      this.returnFocus.focus({ preventScroll: true })
    }
  },
  methods: {
    openPanel(name: PanelName) {
      this.settingsOpened = name === 'settings'
      this.widgetsOpened = name === 'widgets'
    },
    toggleLauncher() {
      if (this.activePanel) {
        this.closePanel()
      } else {
        this.openPanel('settings')
      }
    },
    closePanel() {
      this.settingsOpened = false
      this.widgetsOpened = false
    },
    getActiveDialog(): HTMLElement | null {
      return this.activePanel
        ? this.$refs[`${this.activePanel}PanelPopup`]?.$el ?? null
        : null
    },
    isVisible(element: HTMLElement) {
      return (
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== 'hidden' &&
        !element.closest('.be-popup.close, [hidden], [aria-hidden="true"]')
      )
    },
    // Extension option windows may be mounted on body, outside this container.
    getExternalDialog(element: HTMLElement): HTMLElement | null {
      const popup = element.closest(
        '.be-settings-extra-options, .be-popup.open, .tippy-box, .toast-card-container',
      ) as HTMLElement | null
      return popup && !this.$el.contains(popup) && this.isVisible(popup) ? popup : null
    },
    handleFocus(event: FocusEvent) {
      const dialog = this.getActiveDialog()
      const target = event.target as HTMLElement
      if (!dialog || !target || dialog.contains(target) || this.getExternalDialog(target)) {
        return
      }
      dialog.focus({ preventScroll: true })
    },
    handleKeydown(event: KeyboardEvent) {
      const dialog = this.getActiveDialog()
      if (!dialog || event.defaultPrevented || event.isComposing) {
        return
      }
      const target = event.target as HTMLElement
      if (event.key === 'Escape') {
        // Some extensions mount a VPopup as their root element.
        const nested = target.closest('.be-popup.open') as (HTMLElement & { __vue__?: Vue })
        if (nested && nested !== dialog) {
          const owner = nested.__vue__
          const popup = owner?.$options.name === 'VPopup'
            ? owner
            : owner?.$children.find(child => child.$el === nested && child.$options.name === 'VPopup')
          if (popup) {
            event.preventDefault()
            event.stopPropagation()
            popup.$emit('popup-change', false)
            const trigger = (popup as Vue & { trigger?: HTMLElement }).trigger
            this.$nextTick(() => {
              if (trigger?.isConnected) {
                trigger.focus({ preventScroll: true })
              } else {
                dialog.focus({ preventScroll: true })
              }
            })
          }
          return
        }
        if (this.getExternalDialog(target)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        this.closePanel()
        return
      }
      if (event.key !== 'Tab' || this.getExternalDialog(target)) {
        return
      }
      const items = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter(
        element =>
          element.tabIndex >= 0 &&
          !element.matches(':disabled, [aria-disabled="true"]') &&
          this.isVisible(element),
      )
      const first = items[0]
      const last = items[items.length - 1]
      if (!first) {
        event.preventDefault()
        dialog.focus()
      } else if (event.shiftKey && (target === first || target === dialog)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (target === last || !dialog.contains(target))) {
        event.preventDefault()
        first.focus()
      }
    },
    loadPanel(refName: string) {
      const popup = this.$refs[refName]
      if (popup && !popup.loaded) {
        popup.loaded = true
      }
    },
  },
}
</script>

<style lang="scss">
@import 'common';

body.bilibili-clear-dialog-open {
  overflow: hidden !important;
  .be-settings-extra-options {
    z-index: 100003;
  }
}

.be-settings {
  --clear-panel-bg: #fff;
  --clear-panel-soft: #f3f7f9;
  --clear-panel-border: #e2e9ee;
  --clear-panel-ink: #20303d;
  --clear-panel-muted: #6b7a86;
  --panel-height: min(740px, calc(100vh - 64px));
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--clear-panel-ink);

  @supports (height: 100dvh) {
    --panel-height: min(740px, calc(100dvh - 64px));
  }
  body.dark & {
    --clear-panel-bg: var(--be-color-panel-bg, #222);
    --clear-panel-soft: var(--be-color-card-bg, #2c2c2c);
    --clear-panel-border: #ffffff24;
    --clear-panel-ink: var(--be-color-text-title, #eee);
    --clear-panel-muted: #a5adb5;
  }
  body.player-mode-blackmask & {
    visibility: hidden;
  }
  > .clear-launcher {
    position: fixed;
    left: calc(20px + env(safe-area-inset-left, 0px));
    bottom: calc(20px + env(safe-area-inset-bottom, 0px));
    z-index: 1002;
    @include on-fullscreen {
      display: none;
    }
    > button {
      appearance: none;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      padding: 0;
      margin: 0;
      border: 1px solid var(--clear-panel-border);
      border-radius: 16px;
      background: var(--clear-panel-bg);
      color: var(--theme-color, #00a0d8);
      box-shadow: 0 4px 16px rgba(18, 33, 44, 0.12);
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: border-color 0.18s ease, box-shadow 0.18s ease;
      &:hover,
      &:focus-visible {
        border-color: var(--theme-color, #00a0d8);
        box-shadow: 0 6px 20px rgba(18, 33, 44, 0.18);
      }
      &:focus-visible {
        outline: 2px solid var(--theme-color, #00a0d8);
        outline-offset: 3px;
      }
    }
  }
  .clear-panel-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100000;
    background: rgba(18, 33, 44, 0.38);
  }
  .clear-panel-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    right: auto;
    z-index: 100001;
    max-width: calc(100vw - 64px);
    max-height: var(--panel-height);
    border-radius: 18px;
    background: var(--clear-panel-bg);
    color: var(--clear-panel-ink);
    border: 1px solid var(--clear-panel-border);
    box-shadow: 0 24px 80px rgba(18, 33, 44, 0.24), 0 4px 16px rgba(18, 33, 44, 0.1);
    outline: none;
    &.open,
    &.close {
      transform: translate(-50%, -50%);
    }
    &.open {
      animation: clear-panel-appear 0.16s ease-out;
    }
    button {
      font: inherit;
    }
    button:focus-visible,
    [role='button']:focus-visible,
    [role='switch']:focus-visible,
    a:focus-visible {
      outline: 2px solid var(--theme-color, #00a0d8) !important;
      outline-offset: 3px;
    }
  }
  .settings-panel-popup {
    width: 1080px;
    height: var(--panel-height);
  }
  .widgets-panel-popup {
    width: 620px;
  }
  @media (max-width: 700px) {
    --panel-height: calc(100vh - 24px);
    @supports (height: 100dvh) {
      --panel-height: calc(100dvh - 24px);
    }
    .clear-panel-dialog {
      max-width: calc(100vw - 24px);
      border-radius: 14px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .clear-panel-dialog.open {
      animation: none;
    }
    > .clear-launcher > button {
      transition: none;
    }
  }
}

@keyframes clear-panel-appear {
  from {
    opacity: 0;
    transform: translate(-50%, calc(-50% + 8px));
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%);
  }
}

.bilibili-player-dm-tip-wrap {
  pointer-events: none !important;
}
</style>
