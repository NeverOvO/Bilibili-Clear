<template>
  <section
    ref="dialog"
    class="clear-shorts"
    role="dialog"
    aria-modal="true"
    aria-labelledby="clear-shorts-title"
    tabindex="-1"
    @keydown="onKeydown"
  >
    <span class="clear-shorts-focus-boundary" tabindex="0" @focus="focusLast" />
    <header class="clear-shorts-header">
      <div>
        <h2 id="clear-shorts-title">短视频</h2>
        <span>B 站为你推荐</span>
      </div>
      <button ref="close" class="clear-shorts-close" type="button" @click="$emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        <span>返回首页</span>
      </button>
    </header>

    <div
      class="clear-shorts-stage"
      @wheel="onWheel"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
    >
      <div v-if="current" class="clear-shorts-viewer" :class="{ portrait: current.portrait }">
        <div class="clear-shorts-screen">
          <iframe
            v-if="!suspended"
            :key="current.bvid + playerRevision"
            :src="playerUrl"
            :title="current.title + ' — B 站播放器'"
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowfullscreen
            referrerpolicy="strict-origin-when-cross-origin"
          />
          <div v-else class="clear-shorts-suspended">
            <p>已暂停短视频</p>
            <button type="button" @click="resume">继续播放</button>
          </div>
        </div>
        <div class="clear-shorts-caption">
          <a :href="videoUrl" target="_blank" rel="noopener noreferrer">{{ current.title }}</a>
          <div class="clear-shorts-byline">
            <a :href="authorUrl" target="_blank" rel="noopener noreferrer">{{ current.authorName }}</a>
            <span>{{ durationText(current.duration) }}</span>
            <span>{{ activeIndex + 1 }} / {{ videos.length }}</span>
          </div>
        </div>
      </div>
      <div v-else class="clear-shorts-empty" role="status" aria-live="polite">
        <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="11" y="4" width="26" height="40" rx="6" /><path d="m20 17 11 7-11 7z" /></svg>
        <h3>{{ loading ? '正在获取推荐视频' : '这批推荐没有可播放的视频' }}</h3>
        <p>{{ loading ? '正在过滤广告、短剧和非视频内容。' : '已过滤的内容不会进入播放列表，可以再换一批。' }}</p>
      </div>

      <nav class="clear-shorts-controls" aria-label="短视频操作">
        <button type="button" :disabled="activeIndex <= 0" title="上一条（↑）" @click="previous">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg>
          <span>上一条</span>
        </button>
        <button
          class="clear-shorts-next"
          type="button"
          :disabled="navigating || (!current && loading)"
          title="下一条（↓）"
          @click="next"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          <span>{{ navigating ? '加载中' : '下一条' }}</span>
        </button>
        <button v-if="current" type="button" @click="hideAuthor">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="m6.5 6.5 11 11" /></svg>
          <span>屏蔽此 UP</span>
        </button>
        <a v-if="current" :href="videoUrl" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></svg>
          <span>原页播放</span>
        </a>
      </nav>
    </div>

    <footer class="clear-shorts-footer">
      <div v-if="error" class="clear-shorts-error" role="alert">
        <span>{{ error }}</span>
        <button type="button" :disabled="loading" @click="loadMore">重试</button>
      </div>
      <div v-else-if="loading && current" class="clear-shorts-status" role="status">正在准备下一批视频…</div>
      <button v-else-if="!current && !loading" class="clear-shorts-reload" type="button" @click="loadMore">换一批推荐</button>
      <div v-if="lastHidden" class="clear-shorts-status" role="status">
        <span>已在短视频模式屏蔽 {{ lastHidden.authorName }}</span>
        <button type="button" @click="undoHide">撤销</button>
      </div>
      <p class="clear-shorts-hint">播放器外滚轮或上下滑动切换；播放器内使用原生控件，点击音量开启声音。</p>
      <details class="clear-shorts-filter-note">
        <summary>过滤说明</summary>
        <p>过滤带广告标记的推荐、直播、番剧，以及标题或标签可识别的短剧。未标注的短剧和视频内植入可能漏过，可屏蔽此 UP；屏蔽仅保存在当前脚本、当前账号中。</p>
        <p>播放器由 B 站提供；无法播放时可打开原页。焦点位于播放器内部时，外页的方向键和 Esc 不生效。</p>
      </details>
    </footer>
    <span class="clear-shorts-focus-boundary" tabindex="0" @focus="focusFirst" />
  </section>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { fetchRecommendations, getRecommendationAccount, RecommendedVideo } from './recommendations'

const blockedKey = (accountId: string) => `bilibiliClear.shorts.blockedAuthors.${accountId}`
const readBlocked = (accountId: string): string[] => {
  const saved = GM_getValue(blockedKey(accountId), [])
  return Array.isArray(saved) ? saved.filter(id => typeof id === 'string' && /^\d+$/.test(id)).slice(-500) : []
}

export default defineComponent({
  name: 'ClearShortsView',
  props: {
    accountId: { type: String, default: getRecommendationAccount },
  },
  data() {
    return {
      videos: [] as RecommendedVideo[],
      activeIndex: 0,
      nextPage: 1,
      loading: false,
      navigating: false,
      error: '',
      disposed: false,
      accountChanged: false,
      suspended: false,
      request: null as AbortController | null,
      seen: new Set<string>(),
      blockedAuthors: readBlocked(this.accountId),
      lastHidden: null as RecommendedVideo | null,
      playerRevision: 0,
      wheelDelta: 0,
      lastNavigation: 0,
      touchStartY: null as number | null,
    }
  },
  computed: {
    current(): RecommendedVideo | undefined {
      return this.videos[this.activeIndex]
    },
    playerUrl(): string {
      if (!this.current) {
        return ''
      }
      const params = new URLSearchParams({
        bvid: this.current.bvid,
        cid: String(this.current.cid),
        autoplay: '1',
        muted: '1',
        danmaku: '0',
      })
      return `https://player.bilibili.com/player.html?${params}`
    },
    videoUrl(): string {
      return this.current ? `https://www.bilibili.com/video/${this.current.bvid}/` : ''
    },
    authorUrl(): string {
      return this.current ? `https://space.bilibili.com/${this.current.authorId}` : ''
    },
  },
  watch: {
    accountId() {
      this.request?.abort()
      this.videos = []
      this.lastHidden = null
      this.accountChanged = true
      this.error = '登录账号已变化，请关闭短视频模式后重新打开。'
    },
  },
  mounted() {
    this.focusFirst()
    document.addEventListener('focusin', this.containFocus)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.loadMore()
  },
  beforeDestroy() {
    this.disposed = true
    this.request?.abort()
    document.removeEventListener('focusin', this.containFocus)
    document.removeEventListener('visibilitychange', this.onVisibility)
  },
  methods: {
    durationText(value: number) {
      const seconds = Math.max(0, Math.floor(value))
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    },
    isCurrentAccount() {
      if (!this.accountChanged && this.accountId && this.accountId === getRecommendationAccount()) {
        return true
      }
      this.request?.abort()
      this.videos = []
      this.lastHidden = null
      this.accountChanged = true
      this.error = '请登录 B 站，并重新打开短视频模式。'
      return false
    },
    async loadMore() {
      if (this.loading || this.disposed || !this.isCurrentAccount()) {
        return
      }
      this.loading = true
      this.error = ''
      const request = new AbortController()
      this.request = request
      try {
        // At most two batches per explicit navigation, even if every item is filtered.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const batch = await fetchRecommendations(this.nextPage, request.signal, {
            authors: new Set(this.blockedAuthors),
            videos: this.seen,
          })
          if (this.disposed || request.signal.aborted || !this.isCurrentAccount()) {
            return
          }
          this.nextPage += 1
          const incoming = batch.items.filter(video => !this.seen.has(video.bvid) && !this.blockedAuthors.includes(video.authorId))
          incoming.forEach(video => this.seen.add(video.bvid))
          this.videos.push(...incoming)
          if (incoming.length > 0) {
            // Preserve a useful back stack without keeping an unbounded viewing session in memory.
            if (this.videos.length > 100 && this.activeIndex > 30) {
              const trim = Math.min(this.activeIndex - 30, this.videos.length - 100)
              this.videos.splice(0, trim)
              this.activeIndex -= trim
            }
            return
          }
        }
        this.error = '这两批推荐已被过滤或已经看过，可以稍后再换一批。'
      } catch (error) {
        if (!this.disposed && !request.signal.aborted) {
          this.error = error instanceof Error ? error.message : '获取推荐失败，请稍后重试。'
        }
        request.abort()
      } finally {
        if (this.request === request) {
          this.loading = false
          this.request = null
        }
      }
    },
    async next() {
      if (this.navigating || !this.isCurrentAccount()) {
        return
      }
      this.lastNavigation = Date.now()
      if (this.activeIndex + 1 < this.videos.length) {
        this.activeIndex += 1
        this.suspended = false
        return
      }
      this.navigating = true
      const previous = this.current?.bvid
      try {
        await this.loadMore()
        if (!this.disposed && previous && this.current?.bvid === previous && this.activeIndex + 1 < this.videos.length) {
          this.activeIndex += 1
        }
        this.suspended = false
      } finally {
        this.navigating = false
      }
    },
    previous() {
      if (this.activeIndex > 0 && this.isCurrentAccount()) {
        this.lastNavigation = Date.now()
        this.activeIndex -= 1
        this.suspended = false
      }
    },
    hideAuthor() {
      if (!this.current || !this.isCurrentAccount()) {
        return
      }
      const hidden = this.current
      const previousVideos = this.videos.slice(0, this.activeIndex).filter(video => video.authorId !== hidden.authorId)
      this.lastHidden = hidden
      this.blockedAuthors = [...new Set([...this.blockedAuthors, hidden.authorId])].slice(-500)
      GM_setValue(blockedKey(this.accountId), this.blockedAuthors)
      this.videos = this.videos.filter(video => video.authorId !== hidden.authorId)
      this.activeIndex = Math.min(previousVideos.length, Math.max(0, this.videos.length - 1))
      if (!this.current) {
        this.loadMore()
      }
    },
    undoHide() {
      if (!this.lastHidden || !this.isCurrentAccount()) {
        return
      }
      this.blockedAuthors = this.blockedAuthors.filter(id => id !== this.lastHidden.authorId)
      GM_setValue(blockedKey(this.accountId), this.blockedAuthors)
      if (!this.videos.some(video => video.bvid === this.lastHidden.bvid)) {
        this.videos.splice(this.activeIndex, 0, this.lastHidden)
      }
      this.lastHidden = null
    },
    onWheel(event: WheelEvent) {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return
      }
      event.preventDefault()
      if (Date.now() - this.lastNavigation < 700) {
        return
      }
      this.wheelDelta += event.deltaY * (event.deltaMode === 1 ? 16 : 1)
      if (Math.abs(this.wheelDelta) < 80) {
        return
      }
      if (this.wheelDelta > 0) {
        this.next()
      } else {
        this.previous()
      }
      this.wheelDelta = 0
    },
    onTouchStart(event: TouchEvent) {
      this.touchStartY = event.touches.length === 1 ? event.touches[0].clientY : null
    },
    onTouchEnd(event: TouchEvent) {
      if (this.touchStartY === null || event.changedTouches.length !== 1) {
        return
      }
      const distance = this.touchStartY - event.changedTouches[0].clientY
      this.touchStartY = null
      if (Math.abs(distance) < 70) {
        return
      }
      if (distance > 0) {
        this.next()
      } else {
        this.previous()
      }
    },
    onKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        this.$emit('close')
        return
      }
      const target = event.target as HTMLElement
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        if (event.key === 'ArrowDown') {
          this.next()
        } else {
          this.previous()
        }
      }
    },
    containFocus(event: FocusEvent) {
      const dialog = this.$refs.dialog as HTMLElement
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) {
        this.focusFirst()
      }
    },
    focusFirst() {
      ;(this.$refs.close as HTMLButtonElement)?.focus()
    },
    focusLast() {
      const dialog = this.$refs.dialog as HTMLElement
      const elements = dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, iframe')
      elements?.[elements.length - 1]?.focus()
    },
    onVisibility() {
      // The embed is cross-origin: unmount it rather than claiming to control its player API.
      if (document.hidden) {
        this.suspended = true
      }
    },
    resume() {
      this.playerRevision += 1
      this.suspended = false
    },
  },
})
</script>
