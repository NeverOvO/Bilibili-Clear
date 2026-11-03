<template>
  <div class="clear-image-overlay" @click.self="close">
    <section
      ref="dialog"
      class="clear-image-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="帖子图片预览"
      tabindex="-1"
    >
      <header class="clear-image-header">
        <span class="clear-image-caption">{{ author }}的图片</span>
        <span class="clear-image-counter" role="status" aria-live="polite"
          >{{ index + 1 }} / {{ images.length }}</span
        >
        <button
          type="button"
          :disabled="!loaded || failed"
          :aria-pressed="zoomed ? 'true' : 'false'"
          @click="zoomed = !zoomed"
        >
          {{ zoomed ? '适应窗口' : '查看原尺寸' }}
        </button>
        <button
          ref="close"
          type="button"
          class="clear-image-close"
          aria-label="关闭图片预览"
          @click="close"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div
        ref="stage"
        class="clear-image-stage"
        :class="{ 'is-zoomed': zoomed }"
        @click.self="close"
      >
        <button
          v-if="!failed"
          type="button"
          class="clear-image-canvas"
          :aria-label="zoomed ? '缩小图片以适应窗口' : '查看图片原尺寸'"
          @click="zoomed = !zoomed"
        >
          <img
            :key="currentImage"
            :src="currentImage"
            :alt="`${author}的帖子图片 ${index + 1}`"
            referrerpolicy="no-referrer"
            @load="onImageLoaded"
            @error="onImageFailed"
          />
        </button>
        <p v-if="!loaded && !failed" class="clear-image-loading" role="status">正在加载图片…</p>
        <div v-if="failed" class="clear-image-error" role="status">
          <p>图片暂时无法加载</p>
          <a :href="currentImage" target="_blank" rel="noopener noreferrer">在新标签页查看原图</a>
        </div>
      </div>
      <button
        v-if="images.length > 1"
        type="button"
        class="clear-image-previous"
        :disabled="index === 0"
        aria-label="上一张图片"
        @click="move(-1)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
      </button>
      <button
        v-if="images.length > 1"
        type="button"
        class="clear-image-next"
        :disabled="index === images.length - 1"
        aria-label="下一张图片"
        @click="move(1)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </button>
      <footer class="clear-image-footer">左右方向键切换 · Esc 关闭</footer>
      <img
        v-for="image in adjacentImages"
        :key="image"
        class="clear-image-preload"
        :src="image"
        alt=""
        aria-hidden="true"
        referrerpolicy="no-referrer"
      />
    </section>
  </div>
</template>

<script lang="ts">
import type { PropType } from 'vue'
import { addStyle } from '@/core/style'
import imageViewerStyle from './post-image-viewer.scss'

type BackgroundState = { element: HTMLElement; inert: string | null; ariaHidden: string | null }

export default {
  props: {
    images: { type: Array as PropType<string[]>, required: true },
    initialIndex: { type: Number, default: 0 },
    author: { type: String, default: '' },
    opener: { type: HTMLElement as PropType<HTMLElement>, default: null },
  },
  data() {
    return {
      index: this.initialIndex,
      loaded: false,
      failed: false,
      zoomed: false,
      backgrounds: [] as BackgroundState[],
      styleElement: null as HTMLStyleElement | null,
      disposed: false,
    }
  },
  computed: {
    currentImage(): string {
      return this.images[this.index] || ''
    },
    adjacentImages(): string[] {
      return [this.images[this.index - 1], this.images[this.index + 1]].filter(Boolean)
    },
  },
  mounted() {
    this.styleElement = addStyle(imageViewerStyle)
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
    document.documentElement.classList.add('clear-post-image-open')
    document.addEventListener('keydown', this.onKeydown, true)
    document.addEventListener('focusin', this.onFocusIn)
    this.$nextTick(this.focusClose)
  },
  beforeDestroy() {
    this.disposed = true
    document.removeEventListener('keydown', this.onKeydown, true)
    document.removeEventListener('focusin', this.onFocusIn)
    document.documentElement.classList.remove('clear-post-image-open')
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
    this.styleElement?.remove()
    this.$el.remove()
    if (this.opener?.isConnected) {
      this.opener.focus({ preventScroll: true })
    }
  },
  methods: {
    isCurrentImage(event: Event): boolean {
      // Events queued by a detached image must not overwrite the next image's state.
      return (
        !this.disposed &&
        (event.target as HTMLImageElement).getAttribute('src') === this.currentImage
      )
    },
    onImageLoaded(event: Event) {
      if (this.isCurrentImage(event)) {
        this.loaded = true
        this.failed = false
      }
    },
    onImageFailed(event: Event) {
      if (this.isCurrentImage(event)) {
        this.loaded = false
        this.failed = true
      }
    },
    close() {
      this.$emit('close')
    },
    focusClose() {
      if (!this.disposed) {
        ;(this.$refs.close as HTMLButtonElement)?.focus({ preventScroll: true })
      }
    },
    move(direction: number) {
      const index = this.index + direction
      if (index < 0 || index >= this.images.length) {
        return
      }
      this.index = index
      this.loaded = false
      this.failed = false
      this.zoomed = false
      this.$nextTick(() => {
        if (this.disposed) {
          return
        }
        const stage = this.$refs.stage as HTMLElement
        stage.scrollTo(0, 0)
        // A navigation button becomes disabled at the ends; keep keyboard focus in the dialog.
        if (document.activeElement?.matches('button:disabled')) {
          this.focusClose()
        }
      })
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
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        event.stopPropagation()
        this.move(event.key === 'ArrowLeft' ? -1 : 1)
        return
      }
      if (event.key !== 'Tab') {
        return
      }
      const dialog = this.$refs.dialog as HTMLElement
      const controls = [...dialog.querySelectorAll<HTMLElement>('button, a[href]')].filter(
        element => !element.matches(':disabled') && element.getClientRects().length,
      )
      // WebKit can skip buttons in its native Tab order. Always advance focus inside the modal.
      event.preventDefault()
      event.stopPropagation()
      const index = controls.indexOf(document.activeElement as HTMLElement)
      const direction = event.shiftKey ? -1 : 1
      let next = index + direction
      if (index < 0) {
        next = event.shiftKey ? controls.length - 1 : 0
      }
      const target = controls[(next + controls.length) % controls.length] || dialog
      target.focus({ preventScroll: true })
    },
  },
}
</script>
