<template>
  <div class="clear-home-root">
    <div :class="['clear-home-shell', { 'is-following': following }]" :inert="shorts ? '' : null" :aria-hidden="shorts ? 'true' : null">
      <header v-if="following" class="clear-home-toolbar">
        <a class="clear-home-brand" href="https://www.bilibili.com/" aria-label="Bilibili Clear 首页">
          <ClearBrandIcon /><span>Bilibili <strong>Clear</strong></span><small>Beta</small>
        </a>
        <HomeNavigation :active="following && !shorts" />
        <a class="clear-home-repo" href="https://github.com/NeverOvO/Bilibili-Clear" target="_blank" rel="noopener noreferrer" title="打开 NeverOvO / Bilibili-Clear 仓库">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.64 1.22 3.28.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.01-.11-.29-.5-1.43.11-2.98 0 0 .95-.31 3.1 1.15a10.8 10.8 0 0 1 5.64 0c2.15-1.46 3.09-1.15 3.09-1.15.62 1.55.23 2.69.12 2.98.72.78 1.15 1.78 1.15 3.01 0 4.32-2.63 5.28-5.14 5.56.4.35.76 1.03.76 2.08v3.1c0 .3.2.65.77.54A11.25 11.25 0 0 0 12 .75Z"/></svg>
          <span>NeverOvO</span>
        </a>
      </header>
      <FollowingFeed v-if="followingMounted" v-show="following" :active="following && !shorts" />
    </div>
    <nav v-show="!shorts" class="clear-home-dock" aria-label="Bilibili Clear 模式">
      <button ref="shortsButton" type="button" title="打开竖屏模式" aria-label="打开竖屏模式" @click="shorts = true">
        <ClearActionIcon name="portrait" :size="26" />
        <span>竖屏模式</span>
      </button>
      <button type="button" :aria-pressed="following" :title="following ? '当前为极简首页，点击切换原版' : '当前为原版首页，点击切换极简'" :aria-label="following ? '切换到原版精简首页' : '切换到关注极简首页'" @click="setMode(!following)">
        <ClearActionIcon name="switch" :size="26" />
        <span>{{ following ? '原版' : '极简' }}</span>
      </button>
    </nav>
    <ShortsView v-if="shorts" :account-id="accountId" @close="closeShorts" />
  </div>
</template>

<script lang="ts">
import { getComponentSettings, addComponentListener, removeComponentListener } from '@/core/settings'
import { getUID } from '@/core/utils'
import ClearBrandIcon from '@/ui/clear/ClearBrandIcon.vue'
import ClearActionIcon from '@/ui/clear/ClearActionIcon.vue'
import FollowingFeed from './FollowingFeed.vue'
import ShortsView from './ShortsView.vue'
import HomeNavigation from './HomeNavigation.vue'

export default {
  components: { ClearBrandIcon, ClearActionIcon, FollowingFeed, ShortsView, HomeNavigation },
  data() {
    const mode = getComponentSettings('clearHome').options.mode
    return {
      mode,
      followingMounted: mode === '关注极简',
      shorts: false,
      accountId: getUID() || '',
    }
  },
  computed: {
    following(): boolean { return this.mode === '关注极简' },
  },
  watch: {
    following: { immediate: true, handler(value: boolean) {
      if (value) {
        this.followingMounted = true
      }
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
