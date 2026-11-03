<template>
  <div class="clear-home-root">
    <div
      ref="scrollShell"
      :class="['clear-home-shell', { 'is-following': following }]"
      :inert="shorts ? '' : null"
      :aria-hidden="shorts ? 'true' : null"
      @scroll.passive="scheduleBackToTop"
    >
      <header v-if="following" class="clear-home-toolbar">
        <a
          ref="homeBrand"
          class="clear-home-brand"
          href="https://www.bilibili.com/"
          aria-label="Bilibili Clear 首页"
        >
          <ClearBrandIcon /><span>Bilibili <strong>Clear</strong></span
          ><small>Beta</small>
        </a>
        <HomeNavigation :active="following && !shorts" />
        <a
          class="clear-home-repo"
          href="https://github.com/NeverOvO/Bilibili-Clear"
          target="_blank"
          rel="noopener noreferrer"
          title="打开 NeverOvO / Bilibili-Clear 仓库"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.64 1.22 3.28.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.01-.11-.29-.5-1.43.11-2.98 0 0 .95-.31 3.1 1.15a10.8 10.8 0 0 1 5.64 0c2.15-1.46 3.09-1.15 3.09-1.15.62 1.55.23 2.69.12 2.98.72.78 1.15 1.78 1.15 3.01 0 4.32-2.63 5.28-5.14 5.56.4.35.76 1.03.76 2.08v3.1c0 .3.2.65.77.54A11.25 11.25 0 0 0 12 .75Z"
            />
          </svg>
          <span>NeverOvO</span>
        </a>
      </header>
      <FollowingFeed v-if="followingMounted" v-show="following" :active="following && !shorts" />
    </div>
    <nav v-show="!shorts" class="clear-home-dock clear-edge-dock" aria-label="Bilibili Clear 模式">
      <button
        ref="shortsButton"
        type="button"
        title="打开竖屏模式"
        aria-label="打开竖屏模式"
        @click="shorts = true"
      >
        <ClearActionIcon name="portrait" :size="26" />
        <span>竖屏模式</span>
      </button>
      <button
        type="button"
        :aria-pressed="following"
        :title="following ? '当前为极简首页，点击切换原版' : '当前为原版首页，点击切换极简'"
        :aria-label="following ? '切换到原版精简首页' : '切换到关注极简首页'"
        @click="setMode(!following)"
      >
        <ClearActionIcon name="switch" :size="26" />
        <span>{{ following ? '原版' : '极简' }}</span>
      </button>
    </nav>
    <button
      v-show="following && !shorts && showBackToTop"
      class="clear-back-to-top"
      type="button"
      title="返回顶部"
      aria-label="返回顶部"
      @click="backToTop"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="m8.5 7-3-3.5M15.5 7l3-3.5M6.5 20v1.5m11-1.5v1.5" />
        <rect x="3" y="7" width="18" height="13" rx="3.7" fill="currentColor" fill-opacity=".07" />
        <path d="M8 10h8m-7.1 5.1L12 12l3.1 3.1M12 12v5.3" />
      </svg>
      <span>顶部</span>
    </button>
    <ShortsView v-if="shorts" :account-id="accountId" @close="closeShorts" />
  </div>
</template>

<script lang="ts">
import {
  getComponentSettings,
  addComponentListener,
  removeComponentListener,
} from '@/core/settings'
import { getUID } from '@/core/utils'
import { sizeChange } from '@/core/observer'
import { isClearHomeBootstrapBypassed } from '@/client/clear-home-bootstrap'
import ClearBrandIcon from '@/ui/clear/ClearBrandIcon.vue'
import ClearActionIcon from '@/ui/clear/ClearActionIcon.vue'
import FollowingFeed from './FollowingFeed.vue'
import ShortsView from './ShortsView.vue'
import HomeNavigation from './HomeNavigation.vue'

export default {
  components: { ClearBrandIcon, ClearActionIcon, FollowingFeed, ShortsView, HomeNavigation },
  beforeCreate() {
    // Scheduling state stays outside Vue reactivity; scrolling only updates the threshold flag.
    this.backToTopRuntime = {
      frame: null as number | null,
      observer: null as ResizeObserver | null,
      disposed: false,
    }
  },
  data() {
    const savedMode = getComponentSettings('clearHome').options.mode
    // A one-page startup fallback must not rewrite the user's saved homepage choice.
    const mode = isClearHomeBootstrapBypassed() ? '原版精简' : savedMode
    return {
      mode,
      followingMounted: mode === '关注极简',
      shorts: false,
      showBackToTop: false,
      accountId: getUID() || '',
    }
  },
  computed: {
    following(): boolean {
      return this.mode === '关注极简'
    },
  },
  watch: {
    following: {
      immediate: true,
      handler(value: boolean) {
        if (value) {
          this.followingMounted = true
        }
        document.documentElement.classList.toggle('clear-following-active', value)
        this.$nextTick(this.scheduleBackToTop)
      },
    },
    shorts(value: boolean) {
      this.accountId = getUID() || ''
      document.documentElement.classList.toggle('clear-shorts-active', value)
      this.$nextTick(this.scheduleBackToTop)
    },
  },
  created() {
    addComponentListener('clearHome.mode', this.onModeChanged)
  },
  mounted() {
    ;[this.backToTopRuntime.observer] = sizeChange(
      this.$refs.scrollShell as HTMLElement,
      this.scheduleBackToTop,
    )
    this.scheduleBackToTop()
  },
  beforeDestroy() {
    const runtime = this.backToTopRuntime
    runtime.disposed = true
    runtime.observer?.disconnect()
    if (runtime.frame !== null) {
      window.cancelAnimationFrame(runtime.frame)
    }
    removeComponentListener('clearHome.mode', this.onModeChanged)
    document.documentElement.classList.remove('clear-following-active', 'clear-shorts-active')
  },
  methods: {
    scheduleBackToTop() {
      const runtime = this.backToTopRuntime
      if (runtime.disposed || runtime.frame !== null) {
        return
      }
      runtime.frame = window.requestAnimationFrame(() => {
        runtime.frame = null
        const shell = this.$refs.scrollShell as HTMLElement | undefined
        const visible = Boolean(
          this.following && !this.shorts && shell && shell.scrollTop > shell.clientHeight,
        )
        if (this.showBackToTop !== visible) {
          this.showBackToTop = visible
        }
      })
    },
    backToTop() {
      const shell = this.$refs.scrollShell as HTMLElement | undefined
      if (!shell || !this.following || this.shorts) {
        return
      }
      // Keep keyboard focus on a visible control when the floating button hides on the way up.
      ;(this.$refs.homeBrand as HTMLElement | undefined)?.focus({ preventScroll: true })
      shell.scrollTo({
        top: 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
    },
    onModeChanged(value: string) {
      this.mode = value
    },
    setMode(following: boolean) {
      const mode = following ? '关注极简' : '原版精简'
      this.mode = mode
      getComponentSettings('clearHome').options.mode = mode
    },
    closeShorts() {
      this.shorts = false
      this.$nextTick(() => this.$refs.shortsButton?.focus())
    },
  },
}
</script>
