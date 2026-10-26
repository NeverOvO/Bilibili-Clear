<template>
  <div class="clear-home-root">
    <div :class="['clear-home-shell', { 'is-following': following }]" :inert="shorts ? '' : null" :aria-hidden="shorts ? 'true' : null">
      <header class="clear-home-toolbar">
        <a v-if="following" class="clear-home-brand" href="https://www.bilibili.com/" aria-label="Bilibili Clear 首页">
          <ClearLauncherIcon /><span>Bilibili <strong>Clear</strong></span><small>Beta</small>
        </a>
        <nav class="clear-home-modes" aria-label="首页模式">
          <button type="button" :aria-pressed="!following" @click="setMode(false)">原版精简</button>
          <button type="button" :aria-pressed="following" @click="setMode(true)">关注极简</button>
        </nav>
        <button ref="shortsButton" type="button" class="clear-shortcut" @click="shorts = true">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m10 8 6 4-6 4Z" fill="currentColor"/></svg>
          短视频
        </button>
      </header>
      <FollowingFeed v-if="following" />
    </div>
    <ShortsView v-if="shorts" :account-id="accountId" @close="closeShorts" />
  </div>
</template>

<script lang="ts">
import { getComponentSettings, addComponentListener, removeComponentListener } from '@/core/settings'
import { getUID } from '@/core/utils'
import ClearLauncherIcon from '@/components/settings-panel/ClearLauncherIcon.vue'
import FollowingFeed from './FollowingFeed.vue'
import ShortsView from './ShortsView.vue'

export default {
  components: { ClearLauncherIcon, FollowingFeed, ShortsView },
  data() {
    return {
      mode: getComponentSettings('clearHome').options.mode,
      shorts: false,
      accountId: getUID() || '',
    }
  },
  computed: {
    following(): boolean { return this.mode === '关注极简' },
  },
  watch: {
    following: { immediate: true, handler(value: boolean) {
      document.documentElement.classList.toggle('clear-following-active', value)
    } },
    shorts(value: boolean) {
      this.accountId = getUID() || ''
      document.documentElement.classList.toggle('clear-shorts-active', value)
    },
  },
  created() {
    addComponentListener('clearHome.mode', this.onModeChanged)
  },
  beforeDestroy() {
    removeComponentListener('clearHome.mode', this.onModeChanged)
    document.documentElement.classList.remove('clear-following-active', 'clear-shorts-active')
  },
  methods: {
    onModeChanged(value: string) { this.mode = value },
    setMode(following: boolean) {
      getComponentSettings('clearHome').options.mode = following ? '关注极简' : '原版精简'
    },
    closeShorts() {
      this.shorts = false
      this.$nextTick(() => this.$refs.shortsButton?.focus())
    },
  },
}
</script>
