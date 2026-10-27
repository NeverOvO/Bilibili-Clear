<template>
  <div class="clear-lottery-overlay" :style="theme" @click.self="close">
    <section
      ref="dialog"
      class="clear-lottery-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clear-lottery-title"
      :aria-busy="!loaded && !error ? 'true' : 'false'"
      tabindex="-1"
    >
      <header class="clear-lottery-header">
        <h2 id="clear-lottery-title">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8H8a3 3 0 1 1 3-3Zm0 0h4a3 3 0 1 0-3-3Z"
            /></svg
          >抽奖详情
        </h2>
        <button
          ref="close"
          type="button"
          class="clear-lottery-close"
          aria-label="关闭抽奖详情"
          @click="close"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div class="clear-lottery-content">
        <iframe
          ref="frame"
          :class="['clear-lottery-frame', { 'is-loaded': loaded && !error }]"
          title="B 站原生抽奖详情"
          :aria-hidden="loaded && !error ? null : 'true'"
          :tabindex="loaded && !error ? 0 : -1"
          referrerpolicy="strict-origin-when-cross-origin"
        />
        <div v-if="!loaded || error" class="clear-lottery-state" role="status">
          <template v-if="error">
            <strong>暂时无法打开抽奖</strong>
            <p>{{ error }}</p>
            <button type="button" class="clear-lottery-retry" @click="load">重新加载</button>
          </template>
          <template v-else>
            <span class="clear-lottery-loader" aria-hidden="true" />
            <p>正在打开 B 站抽奖详情…</p>
          </template>
        </div>
      </div>
      <footer class="clear-lottery-footer">
        <span>关闭后继续浏览当前列表</span>
        <a ref="original" :href="originalUrl" target="_blank" rel="noopener noreferrer">打开原帖</a>
      </footer>
    </section>
  </div>
</template>

<script lang="ts">
import type { PropType } from 'vue'
import { addStyle } from '@/core/style'
import type { FollowingItem } from './following'
import { mountNativeLotteryFrame } from './native-lottery'
import lotteryStyle from './lottery.scss'

type BackgroundState = { element: HTMLElement; inert: string | null; ariaHidden: string | null }
const focusableSelector = 'a[href], button, input, textarea, select, iframe, [tabindex]'

export default {
  props: {
    item: { type: Object as PropType<FollowingItem>, required: true },
  },
  data() {
    return {
      loaded: false,
      error: '',
      theme: {} as Record<string, string>,
      returnFocus: null as HTMLElement | null,
      backgrounds: [] as BackgroundState[],
      styleElement: null as HTMLStyleElement | null,
      releaseFrame: null as (() => void) | null,
      disposed: false,
    }
  },
  computed: {
    originalUrl(): string {
      return /^\d+$/.test(this.item.id)
        ? `https://www.bilibili.com/opus/${this.item.id}`
        : this.item.url
    },
  },
  watch: {
    'item.id': function onItemChange() {
      this.$nextTick(this.load)
    },
  },
  mounted() {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const source = document.querySelector('.clear-home-root')
    if (source) {
      const computed = getComputedStyle(source)
      for (const property of [
        '--ch-paper',
        '--ch-soft',
        '--ch-ink',
        '--ch-muted',
        '--ch-line',
        '--ch-accent',
      ]) {
        this.$set(this.theme, property, computed.getPropertyValue(property))
      }
    }
    this.styleElement = addStyle(lotteryStyle)
    document.body.appendChild(this.$el)
    this.backgrounds = [...document.body.children]
      .filter(
        element =>
          element !== this.$el &&
          element instanceof HTMLElement &&
          !element.matches('script, style, link'),
      )
      .map((element: HTMLElement) => {
        const state = {
          element,
          inert: element.getAttribute('inert'),
          ariaHidden: element.getAttribute('aria-hidden'),
        }
        element.setAttribute('inert', '')
        element.setAttribute('aria-hidden', 'true')
        return state
      })
    document.documentElement.classList.add('clear-lottery-open')
    document.addEventListener('keydown', this.onKeydown)
    document.addEventListener('focusin', this.onFocusIn)
    this.$nextTick(() => {
      if (this.disposed) {
        return
      }
      this.focusClose()
      this.load()
    })
  },
  beforeDestroy() {
    this.disposed = true
    this.releaseFrame?.()
    this.releaseFrame = null
    document.removeEventListener('keydown', this.onKeydown)
    document.removeEventListener('focusin', this.onFocusIn)
    document.documentElement.classList.remove('clear-lottery-open')
    for (const state of this.backgrounds as BackgroundState[]) {
      if (state.element.getAttribute('inert') === '') {
        if (state.inert === null) {
          state.element.removeAttribute('inert')
        } else {
          state.element.setAttribute('inert', state.inert)
        }
      }
      if (state.element.getAttribute('aria-hidden') === 'true') {
        if (state.ariaHidden === null) {
          state.element.removeAttribute('aria-hidden')
        } else {
          state.element.setAttribute('aria-hidden', state.ariaHidden)
        }
      }
    }
    this.backgrounds = []
    this.styleElement?.remove()
    this.$el.remove()
    if (this.returnFocus?.isConnected) {
      this.returnFocus.focus({ preventScroll: true })
    }
  },
  methods: {
    close() {
      this.$emit('close')
    },
    focusClose() {
      ;(this.$refs.close as HTMLButtonElement)?.focus({ preventScroll: true })
    },
    onFocusIn(event: FocusEvent) {
      if (!this.disposed && !(this.$el as HTMLElement).contains(event.target as Node)) {
        this.focusClose()
      }
    },
    onKeydown(event: KeyboardEvent) {
      if (this.disposed || event.defaultPrevented || event.isComposing) {
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        this.close()
        return
      }
      if (event.key !== 'Tab') {
        return
      }
      const dialog = this.$refs.dialog as HTMLElement
      const items = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter(
        element =>
          element.tabIndex >= 0 &&
          !element.matches(':disabled, [hidden]') &&
          element.getClientRects().length,
      )
      const first = items[0]
      const last = items[items.length - 1]
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault()
        last?.focus({ preventScroll: true })
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus({ preventScroll: true })
      }
    },
    load() {
      if (this.disposed) {
        return
      }
      this.releaseFrame?.()
      this.releaseFrame = null
      this.loaded = false
      this.error = ''
      if (!this.item.lottery) {
        this.error = '这条动态未提供原生抽奖入口，请打开原帖。'
        return
      }
      this.releaseFrame = mountNativeLotteryFrame(
        this.$refs.frame as HTMLIFrameElement,
        this.item.lottery,
        {
          onState: state => {
            if (this.disposed) {
              return
            }
            this.loaded = state.loaded
            this.error = state.error
          },
          onClose: this.close,
          onFocusBoundary: backwards => {
            if (backwards) {
              this.focusClose()
            } else {
              ;(this.$refs.original as HTMLAnchorElement)?.focus({ preventScroll: true })
            }
          },
        },
      )
    },
  },
}
</script>
