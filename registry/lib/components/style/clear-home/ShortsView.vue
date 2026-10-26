<template>
  <section
    ref="dialog"
    class="clear-shorts"
    role="dialog"
    aria-modal="true"
    aria-labelledby="clear-shorts-title"
    tabindex="-1"
    @keydown="onKeydown"
    @wheel="onWheel"
    @touchstart.passive="onTouchStart"
    @touchend.passive="onTouchEnd"
  >
    <span class="clear-shorts-focus-boundary" tabindex="0" @focus="focusLast" />
    <div class="clear-shorts-stage">
      <img v-if="current && !currentPresented" class="clear-shorts-cover" :src="current.cover" alt="" decoding="async" referrerpolicy="no-referrer" />
      <iframe
        v-for="slot in playerSlots"
        :key="slot.key"
        :ref="'player-' + slot.key"
        class="clear-shorts-native-frame"
        :class="{ 'is-active': slot.video && slot.video.bvid === currentBvid, 'is-ready': slot.state.ready }"
        :title="slot.video ? slot.video.title + ' — B 站原生播放器' : 'B 站播放器预留位置'"
        :tabindex="slot.video && slot.video.bvid === currentBvid ? 0 : -1"
        :aria-hidden="slot.video && slot.video.bvid === currentBvid ? null : 'true'"
        :inert="slot.video && slot.video.bvid === currentBvid ? null : ''"
        :allow="slot.video && slot.video.bvid === currentBvid ? 'autoplay; fullscreen; picture-in-picture; encrypted-media' : `autoplay 'none'; fullscreen; picture-in-picture; encrypted-media`"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-presentation"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
      />
      <div v-if="!current" class="clear-shorts-empty" role="status" aria-live="polite">
        <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="11" y="4" width="26" height="40" rx="6" /><path d="m20 17 11 7-11 7z" /></svg>
        <h3>{{ loading ? '正在获取推荐视频' : '这批推荐没有可播放的视频' }}</h3>
        <p>{{ loading ? '正在过滤广告、短剧和非视频内容。' : '可以再换一批，或返回首页。' }}</p>
        <button v-if="!loading" type="button" @click="loadMore">换一批推荐</button>
      </div>
      <div v-else-if="playerState.error" class="clear-shorts-player-message" role="alert">
        <p>{{ playerState.error }}</p>
        <div><button type="button" @click="reloadPlayer">重新加载</button><a :href="videoUrl" target="_blank" rel="noopener noreferrer">打开原页播放</a></div>
      </div>
      <div v-else-if="suspended || playerState.needsGesture" class="clear-shorts-play-gate">
        <button type="button" @click="resume">
          <svg viewBox="0 0 40 40" aria-hidden="true"><path d="m14 9 17 11-17 11z" /></svg>
          <span>{{ suspended ? '继续播放' : '点击播放并开启声音' }}</span>
        </button>
        <p v-if="!suspended">浏览器需要点击一次才能有声播放。</p>
      </div>
      <div v-else-if="!playerState.ready" class="clear-shorts-loading" role="status">正在打开 B 站播放器…</div>
    </div>

    <header class="clear-shorts-header">
      <button ref="close" class="clear-shorts-close" type="button" aria-label="退出竖屏模式，返回首页" title="返回首页（Esc）" @click="$emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <div class="clear-shorts-heading"><h2 id="clear-shorts-title">竖屏模式</h2><span>网页推荐</span></div>
      <details class="clear-shorts-help">
        <summary aria-label="竖屏模式操作与过滤说明" title="操作与过滤说明">•••</summary>
        <div>
          <strong>使用当前 B 站网页登录</strong>
          <p>播放器加载 B 站原生视频页，登录、清晰度、弹幕和观看记录由 B 站处理。</p>
          <p>滚轮、上下键或上下滑动切换视频；原生播放控件保留自己的操作。浏览器阻止有声播放时，点击画面中的播放按钮。</p>
          <p>过滤带广告标记的推荐、直播、番剧及可识别短剧。未标记的短剧和视频内植入可能漏过，可屏蔽此 UP。</p>
        </div>
      </details>
    </header>

    <div v-if="current" class="clear-shorts-caption">
      <a class="clear-shorts-author" :href="authorUrl" target="_blank" rel="noopener noreferrer">@{{ current.authorName }}</a>
      <a class="clear-shorts-video-title" :href="videoUrl" target="_blank" rel="noopener noreferrer">{{ current.title }}</a>
      <p>{{ durationText(current.duration) }}<span>{{ activeIndex + 1 }} / {{ videos.length }}</span></p>
    </div>

    <nav class="clear-shorts-controls" aria-label="竖屏模式操作">
      <button type="button" :disabled="activeIndex <= 0" title="上一条（↑）" @click="previous">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg><span>上一条</span>
      </button>
      <button type="button" :disabled="navigating || (!current && loading)" title="下一条（↓）" @click="next">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg><span>{{ navigating ? '加载中' : '下一条' }}</span>
      </button>
      <button v-if="current" type="button" :disabled="!playerState.ready" :aria-label="playerState.muted ? '开启声音' : '静音'" :title="playerState.muted ? '开启声音' : '静音'" @click="toggleMute">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z" /><path v-if="playerState.muted" d="m16 9 5 6m0-6-5 6" /><path v-else d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></svg><span>{{ playerState.muted ? '开声音' : '声音开' }}</span>
      </button>
      <a v-if="current" :href="commentUrl" target="_blank" rel="noopener noreferrer" title="前往原视频评论区">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a9 9 0 0 1-9 8.5 10 10 0 0 1-4-.8L3 21l1.5-4.5A8 8 0 0 1 3 11.5 9 9 0 0 1 12 3a9 9 0 0 1 9 8.5Z" /><path d="M7 11h.1m4.9 0h.1m4.9 0h.1" /></svg><span>原页评论</span>
      </a>
      <button v-if="current" type="button" title="在竖屏模式中屏蔽此 UP" @click="hideAuthor">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="m6.5 6.5 11 11" /></svg><span>不看此 UP</span>
      </button>
      <a v-if="current" :href="videoUrl" target="_blank" rel="noopener noreferrer" title="打开原视频页面">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></svg><span>原页播放</span>
      </a>
    </nav>

    <div class="clear-shorts-notices" aria-live="polite">
      <div v-if="error" class="clear-shorts-notice" role="alert"><span>{{ error }}</span><button type="button" :disabled="loading" @click="loadMore">重试</button></div>
      <div v-else-if="navigating && loading" class="clear-shorts-notice" role="status">正在接续下一条…</div>
      <div v-if="lastHidden" class="clear-shorts-notice" role="status"><span>已屏蔽 {{ lastHidden.authorName }}</span><button type="button" @click="undoHide">撤销</button></div>
    </div>
    <span class="clear-shorts-focus-boundary" tabindex="0" @focus="focusFirst" />
  </section>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { fetchRecommendations, getRecommendationAccount, RecommendedVideo } from './recommendations'
import { mountNativePlayer, NativePlayerState } from './native-player'

const blockedKey = (accountId: string) => `bilibiliClear.shorts.blockedAuthors.${accountId}`
const readBlocked = (accountId: string): string[] => {
  const saved = GM_getValue(blockedKey(accountId), [])
  return Array.isArray(saved) ? saved.filter(id => typeof id === 'string' && /^\d+$/.test(id)).slice(-500) : []
}
const initialPlayerState = (): NativePlayerState => ({
  ready: false, playing: false, muted: false, needsGesture: false, error: '',
})
type NativePlayer = ReturnType<typeof mountNativePlayer>
interface PlayerSlot {
  key: number
  revision: number
  video: RecommendedVideo | null
  state: NativePlayerState
  presented: boolean
}
const initialPlayerSlots = (): PlayerSlot[] => [1, 2].map(key => ({
  key, revision: 0, video: null, state: initialPlayerState(), presented: false,
}))
const queueLowWater = 4
const queueTarget = 10

export default defineComponent({
  name: 'ClearShortsView',
  props: { accountId: { type: String, default: getRecommendationAccount } },
  data() {
    return {
      videos: [] as RecommendedVideo[], activeIndex: 0, nextPage: 1,
      loading: false, navigating: false, boundaryBvid: '', error: '', disposed: false,
      accountChanged: false, suspended: false,
      request: null as AbortController | null,
      loadTask: null as Promise<void> | null,
      seen: new Set<string>(), blockedAuthors: readBlocked(this.accountId),
      lastHidden: null as RecommendedVideo | null,
      player: null as NativePlayer | null,
      playerState: initialPlayerState(),
      playerSlots: initialPlayerSlots(), slotPlayers: new Map<number, NativePlayer>(),
      playerEpoch: 0, activePlayerKey: 0,
      coverPreloads: new Map<string, HTMLImageElement>(),
      wheelDelta: 0, lastNavigation: 0, touchStartY: null as number | null,
    }
  },
  computed: {
    current(): RecommendedVideo | undefined { return this.videos[this.activeIndex] },
    currentBvid(): string { return this.current?.bvid || '' },
    currentPresented(): boolean { return this.playerSlots.some(slot => slot.video?.bvid === this.currentBvid && slot.presented) },
    videoUrl(): string { return this.current ? `https://www.bilibili.com/video/${this.current.bvid}/` : '' },
    commentUrl(): string { return this.videoUrl ? `${this.videoUrl}#comment` : '' },
    authorUrl(): string { return this.current ? `https://space.bilibili.com/${this.current.authorId}` : '' },
  },
  watch: {
    currentBvid() {
      this.syncPlayerSlots()
      this.maybePrefetch()
    },
    accountId() {
      this.cancelLoading()
      this.disposePlayers()
      this.videos = []; this.lastHidden = null; this.accountChanged = true
      this.error = '登录账号已变化，请关闭竖屏模式后重新打开。'
    },
  },
  mounted() {
    this.focusFirst()
    document.addEventListener('focusin', this.containFocus)
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('focus', this.checkAccount)
    this.loadMore()
  },
  beforeDestroy() {
    this.disposed = true
    this.cancelLoading()
    this.disposePlayers()
    document.removeEventListener('focusin', this.containFocus)
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('focus', this.checkAccount)
  },
  methods: {
    durationText(value: number) {
      const seconds = Math.max(0, Math.floor(value))
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    },
    cancelLoading() {
      this.request?.abort(); this.request = null; this.loading = false; this.loadTask = null
    },
    disposeSlot(slot: PlayerSlot) {
      slot.revision++
      this.slotPlayers.get(slot.key)?.dispose()
      this.slotPlayers.delete(slot.key)
      if (this.activePlayerKey === slot.key) { this.player = null; this.activePlayerKey = 0 }
      slot.video = null
      slot.state = initialPlayerState()
      slot.presented = false
    },
    clearCoverPreloads() {
      this.coverPreloads.forEach(image => { image.src = '' })
      this.coverPreloads.clear()
    },
    disposePlayers() {
      this.playerEpoch++
      this.playerSlots.forEach(this.disposeSlot)
      this.player = null
      this.activePlayerKey = 0
      this.clearCoverPreloads()
    },
    warmCovers() {
      if (document.hidden || this.disposed) { this.clearCoverPreloads(); return }
      const upcoming = this.videos.slice(this.activeIndex + 1, this.activeIndex + 4)
      const retained = new Set(upcoming.map(video => video.bvid))
      this.coverPreloads.forEach((image, bvid) => {
        if (!retained.has(bvid)) { image.src = ''; this.coverPreloads.delete(bvid) }
      })
      upcoming.forEach(video => {
        if (!video.cover || this.coverPreloads.has(video.bvid)) { return }
        const image = new Image()
        image.referrerPolicy = 'no-referrer'
        image.src = video.cover
        this.coverPreloads.set(video.bvid, image)
      })
    },
    async syncPlayerSlots() {
      const epoch = ++this.playerEpoch
      if (this.disposed || this.accountChanged || !this.current) {
        this.disposePlayers()
        this.playerState = initialPlayerState()
        return
      }
      // Keep both iframe nodes in fixed DOM positions. Moving the next frame before
      // the previous one can reload its browsing context, especially in Safari.
      const desired = this.videos.slice(this.activeIndex, this.activeIndex + (document.hidden ? 1 : 2))
      const keep = new Set(desired.map(video => video.bvid))
      this.playerSlots.filter(slot => slot.video && !keep.has(slot.video.bvid)).forEach(this.disposeSlot)
      for (const video of desired) {
        if (!this.playerSlots.some(slot => slot.video?.bvid === video.bvid)) {
          const available = this.playerSlots.find(slot => !slot.video)
          if (available) { available.video = video }
        }
      }
      this.playerState = { ...this.playerSlots.find(slot => slot.video?.bvid === this.currentBvid)!.state }
      this.warmCovers()
      await this.$nextTick()
      if (this.disposed || epoch !== this.playerEpoch) { return }
      for (const slot of this.playerSlots) {
        const video = slot.video
        if (!video || this.slotPlayers.has(slot.key)) { continue }
        const ref = this.$refs['player-' + slot.key]
        const iframe = (Array.isArray(ref) ? ref[0] : ref) as HTMLIFrameElement | undefined
        if (!iframe) { continue }
        const active = video.bvid === this.currentBvid
        const revision = slot.revision
        const ownsSlot = () => !this.disposed && slot.revision === revision && slot.video === video
        const controller = mountNativePlayer(iframe, {
          bvid: video.bvid, cid: video.cid, preload: !active || document.hidden,
          onState: state => {
            if (!ownsSlot()) { return }
            slot.state = { ...state }
            if (state.playing) { slot.presented = true }
            if (video.bvid === this.currentBvid) { this.playerState = { ...state } }
          },
          onNavigate: direction => {
            if (ownsSlot() && video.bvid === this.currentBvid) { this.navigate(direction) }
          },
          onClose: () => { if (ownsSlot() && video.bvid === this.currentBvid) { this.$emit('close') } },
        })
        this.slotPlayers.set(slot.key, controller)
      }
      const activeSlot = this.playerSlots.find(slot => slot.video?.bvid === this.currentBvid)
      if (!activeSlot) { return }
      const nextPlayer = this.slotPlayers.get(activeSlot.key)
      if (nextPlayer && this.activePlayerKey !== activeSlot.key) {
        this.player?.pause()
        this.player = nextPlayer
        this.activePlayerKey = activeSlot.key
        this.suspended = document.hidden
        if (document.hidden) { nextPlayer.pause() }
        else { nextPlayer.play() }
      }
    },
    reloadPlayer() {
      const slot = this.playerSlots.find(item => item.video?.bvid === this.currentBvid)
      if (slot) { this.disposeSlot(slot) }
      this.syncPlayerSlots()
    },
    checkAccount() { this.isCurrentAccount() },
    isCurrentAccount() {
      if (!this.accountChanged && this.accountId && this.accountId === getRecommendationAccount()) { return true }
      this.cancelLoading(); this.disposePlayers(); this.videos = []; this.lastHidden = null
      this.accountChanged = true
      this.error = '请登录 B 站，并重新打开竖屏模式。'
      return false
    },
    maybePrefetch() {
      if (document.hidden || this.disposed || this.error || this.accountChanged) { return }
      if (this.videos.length - this.activeIndex - 1 <= queueLowWater) { this.loadMore() }
    },
    loadMore(): Promise<void> {
      // Navigation at the queue boundary waits for the same background fill, never a no-op.
      if (this.loadTask) { return this.loadTask }
      if (this.disposed || document.hidden || !this.isCurrentAccount()) { return Promise.resolve() }
      this.loading = true; this.error = ''
      const request = new AbortController()
      this.request = request
      const task = this.fillQueue(request).finally(() => {
        if (this.request === request) { this.loading = false; this.request = null; this.loadTask = null }
      })
      this.loadTask = task
      return task
    },
    async fillQueue(request: AbortController) {
      let added = 0
      try {
        // Bounded work even when several recommendation pages contain only exclusions.
        for (let attempt = 0; attempt < 4; attempt += 1) {
          if (this.videos.length - this.activeIndex - 1 >= queueTarget) { break }
          const batch = await fetchRecommendations(this.nextPage, request.signal, {
            authors: new Set(this.blockedAuthors), videos: this.seen,
          })
          if (this.disposed || request.signal.aborted || this.request !== request || !this.isCurrentAccount()) { return }
          this.nextPage++
          const incoming = batch.items.filter(video => !this.seen.has(video.bvid) && !this.blockedAuthors.includes(video.authorId))
          incoming.forEach(video => this.seen.add(video.bvid))
          this.videos.push(...incoming)
          added += incoming.length
          if (this.videos.length > 100 && this.activeIndex > 30) {
            const trim = Math.min(this.activeIndex - 30, this.videos.length - 100)
            this.videos.splice(0, trim); this.activeIndex -= trim
          }
          // A waiting swipe can use the first new result while the rest of the queue fills.
          if (this.navigating && this.currentBvid === this.boundaryBvid && this.activeIndex + 1 < this.videos.length) {
            this.activeIndex++
            this.navigating = false
            this.boundaryBvid = ''
          }
          this.syncPlayerSlots()
        }
        if (!added && this.videos.length - this.activeIndex - 1 <= queueLowWater) {
          this.error = '这几批推荐已被过滤或已经看过，可以稍后再换一批。'
        }
      } catch (error) {
        if (!this.disposed && !request.signal.aborted && this.request === request) {
          this.error = error instanceof Error ? error.message : '获取推荐失败，请稍后重试。'
        }
        request.abort()
      }
    },
    navigate(direction: -1 | 1) {
      if (Date.now() - this.lastNavigation < 650) { return }
      if (direction > 0) { this.next() } else { this.previous() }
    },
    async next() {
      if (this.navigating || !this.isCurrentAccount()) { return }
      this.lastNavigation = Date.now()
      if (this.activeIndex + 1 < this.videos.length) { this.activeIndex++; return }
      this.navigating = true
      const previous = this.current?.bvid
      this.boundaryBvid = previous || ''
      try {
        await this.loadMore()
        if (!this.disposed && previous && this.current?.bvid === previous && this.activeIndex + 1 < this.videos.length) { this.activeIndex++ }
      } finally {
        if (this.boundaryBvid === (previous || '')) { this.navigating = false; this.boundaryBvid = '' }
      }
    },
    previous() {
      if (this.activeIndex > 0 && this.isCurrentAccount()) { this.lastNavigation = Date.now(); this.activeIndex-- }
    },
    hideAuthor() {
      if (!this.current || !this.isCurrentAccount()) { return }
      const hidden = this.current
      const previousVideos = this.videos.slice(0, this.activeIndex).filter(video => video.authorId !== hidden.authorId)
      this.lastHidden = hidden
      this.blockedAuthors = [...new Set([...this.blockedAuthors, hidden.authorId])].slice(-500)
      GM_setValue(blockedKey(this.accountId), this.blockedAuthors)
      this.videos = this.videos.filter(video => video.authorId !== hidden.authorId)
      this.activeIndex = Math.min(previousVideos.length, Math.max(0, this.videos.length - 1))
      this.syncPlayerSlots(); this.maybePrefetch()
    },
    undoHide() {
      if (!this.lastHidden || !this.isCurrentAccount()) { return }
      this.blockedAuthors = this.blockedAuthors.filter(id => id !== this.lastHidden.authorId)
      GM_setValue(blockedKey(this.accountId), this.blockedAuthors)
      if (!this.videos.some(video => video.bvid === this.lastHidden.bvid)) { this.videos.splice(this.activeIndex, 0, this.lastHidden) }
      this.lastHidden = null
      this.syncPlayerSlots(); this.maybePrefetch()
    },
    onWheel(event: WheelEvent) {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || (event.target as HTMLElement)?.closest('.clear-shorts-help')) { return }
      event.preventDefault()
      if (Date.now() - this.lastNavigation < 650) { return }
      this.wheelDelta += event.deltaY * (event.deltaMode === 1 ? 16 : 1)
      if (Math.abs(this.wheelDelta) < 80) { return }
      this.navigate(this.wheelDelta > 0 ? 1 : -1); this.wheelDelta = 0
    },
    onTouchStart(event: TouchEvent) {
      this.touchStartY = event.touches.length === 1 && !(event.target as HTMLElement)?.closest('.clear-shorts-help') ? event.touches[0].clientY : null
    },
    onTouchEnd(event: TouchEvent) {
      if (this.touchStartY === null || event.changedTouches.length !== 1) { return }
      const distance = this.touchStartY - event.changedTouches[0].clientY
      this.touchStartY = null
      if (Math.abs(distance) >= 70) { this.navigate(distance > 0 ? 1 : -1) }
    },
    onKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.stopPropagation(); this.$emit('close'); return }
      const target = event.target as HTMLElement
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) { return }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation(); this.navigate(event.key === 'ArrowDown' ? 1 : -1)
      }
    },
    containFocus(event: FocusEvent) {
      const dialog = this.$refs.dialog as HTMLElement
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) { this.focusFirst() }
    },
    focusFirst() { (this.$refs.close as HTMLButtonElement)?.focus() },
    focusLast() {
      const elements = (this.$refs.dialog as HTMLElement)?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, iframe.is-active')
      elements?.[elements.length - 1]?.focus()
    },
    onVisibility() {
      if (document.hidden) {
        this.cancelLoading(); this.player?.pause(); this.suspended = true
        this.syncPlayerSlots()
      } else if (this.isCurrentAccount()) {
        this.syncPlayerSlots(); this.maybePrefetch()
      }
    },
    async resume() {
      if (!this.isCurrentAccount()) { return }
      this.suspended = false
      try { await this.player?.play() } catch {
        this.playerState = { ...this.playerState, needsGesture: true }
      }
    },
    toggleMute() { this.player?.toggleMute() },
  },
})
</script>
