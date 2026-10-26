<template>
  <div class="clear-home-root">
    <div :class="['clear-home-shell', { 'is-following': following }]" :inert="shorts ? '' : null" :aria-hidden="shorts ? 'true' : null">
      <header v-if="following" class="clear-home-toolbar">
        <a class="clear-home-brand" href="https://www.bilibili.com/" aria-label="Bilibili Clear 首页">
          <ClearLauncherIcon /><span>Bilibili <strong>Clear</strong></span><small>Beta</small>
        </a>
        <span class="clear-home-mode-label">关注极简</span>
      </header>
      <FollowingFeed v-if="following" />
    </div>
    <nav v-show="!shorts" class="clear-home-dock" aria-label="Bilibili Clear 模式">
      <button ref="shortsButton" type="button" title="打开短视频模式" aria-label="打开短视频模式" @click="shorts = true">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="4"/><path d="m10 8 6 4-6 4Z"/></svg>
        <span>短视频</span>
      </button>
      <button type="button" :aria-pressed="following" :title="following ? '当前为极简首页，点击切换原版' : '当前为原版首页，点击切换极简'" :aria-label="following ? '切换到原版精简首页' : '切换到关注极简首页'" @click="setMode(!following)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4"/></svg>
        <span>{{ following ? '原版' : '极简' }}</span>
      </button>
    </nav>
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
