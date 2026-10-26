<template>
  <main class="clear-following-content">
    <div class="clear-following-heading">
      <div><h1>只看我关注的</h1><p>视频与帖子，按时间慢慢看。</p></div>
      <div class="clear-feed-actions">
        <a class="clear-watchlater-entry" href="https://www.bilibili.com/list/watchlater" target="_blank" rel="noopener noreferrer" :title="watchlaterError || '进入 B 站原版稍后再看'">稍后再看 <span>{{ watchlaterCount === null ? '—' : watchlaterCount }}</span></a>
        <button type="button" :disabled="loading || batchBusy" @click="reload">刷新动态</button>
        <button type="button" :disabled="historyLoading" @click="syncHistory">{{ historyLoading ? '同步中…' : '同步观看记录' }}</button>
      </div>
    </div>
    <p v-if="!accountId" class="clear-feed-notice">登录 B 站后显示关注内容。<a href="https://passport.bilibili.com/login" target="_blank" rel="noopener noreferrer">前往登录</a>，完成后点击刷新动态。</p>
    <p v-if="error" class="clear-feed-notice is-error" role="alert">{{ error }} <button type="button" :disabled="loading" @click="retryPages">重试</button></p>
    <p v-if="historyError" class="clear-feed-notice" role="status">{{ historyError }} <button type="button" :disabled="historyLoading" @click="syncHistory">重试同步</button></p>
    <p v-if="watchlaterError" class="clear-feed-notice" role="status">{{ watchlaterError }} <button type="button" :disabled="watchlaterLoading" @click="syncWatchlater">重试读取稍后再看</button></p>
    <details class="clear-history-note"><summary>观看标记说明</summary><p>观看达到 95% 或剩余不足 30 秒会标记“看完了”；多 P 视频按各分 P 判断。同步最近最多 90 条 B 站历史，并保留本浏览器记录。未命中历史不代表从未观看。按天添加稍后再看只包含当前已加载的视频。</p></details>
    <div class="clear-feed-tabs" role="tablist" aria-label="关注内容" @keydown="onTabKeydown">
      <button id="clear-video-tab" ref="videoTab" type="button" role="tab" aria-controls="clear-video-panel" :aria-selected="section === 'video'" :tabindex="section === 'video' ? 0 : -1" @click="switchSection('video')">视频 <span>{{ videos.length }}</span></button>
      <button id="clear-post-tab" ref="postTab" type="button" role="tab" aria-controls="clear-post-panel" :aria-selected="section === 'post'" :tabindex="section === 'post' ? 0 : -1" @click="switchSection('post')">帖子 <span>{{ posts.length }}</span></button>
    </div>
    <div class="clear-following-panels" :data-section="section" :aria-busy="loading ? 'true' : 'false'">
      <section v-show="section === 'video'" id="clear-video-panel" class="clear-followed-videos" role="tabpanel" aria-labelledby="clear-video-tab" tabindex="0">
        <div class="clear-section-heading"><h2>关注视频</h2><button type="button" :disabled="batchBusy" @click="toggleSelectionMode">{{ selectionMode ? '取消选择' : '添加到稍后再看' }}</button></div>
        <div v-if="selectionMode" class="clear-batch-toolbar">
          <span>已选择 {{ selectedVideos.length }} 个视频</span>
          <div class="clear-batch-actions">
            <button type="button" :disabled="batchBusy" @click="selectUnfinished">选择已加载的未看完</button>
            <button type="button" :disabled="batchBusy || !selectedVideos.length" @click="selectedBvids = []">清空选择</button>
            <button type="button" :disabled="batchBusy || !selectedVideos.length" @click="submitSelected">{{ batchBusy ? '正在添加…' : '一键添加所选' }}</button>
          </div>
        </div>
        <div v-if="batchMessage" class="clear-batch-status" :class="{ 'is-error': batchError }" role="status"><p>{{ batchMessage }}</p><p v-if="batchError">{{ batchError }}</p></div>
        <section v-for="group in videoDays" :key="group.key" class="clear-day-group">
          <div class="clear-day-actions"><h3 class="clear-day-title"><time :datetime="group.key">{{ group.label }}</time><span>{{ group.items.length }} 条视频</span></h3><button type="button" :disabled="batchBusy || !unfinishedVideos(group.items).length" title="仅添加当前已加载的当天未看完视频，自动跳过列表中已有视频" @click="submitDay(group.items)">添加当天未看完（{{ unfinishedVideos(group.items).length }}）</button></div>
          <div class="clear-video-grid"><VideoTile v-for="item in group.items" :key="item.id" :item="item" :progress="progressFor(item)" :selectable="selectionMode" :selected="selectedBvids.includes(item.video.bvid)" :queued="watchlaterAids.includes(item.video.aid)" :selection-disabled="batchBusy" @select-toggle="toggleSelected(item)" /></div>
        </section>
        <p v-if="!videos.length" class="clear-feed-empty">{{ loading ? '正在读取关注视频…' : '已加载的内容暂无关注视频，可继续加载更早的动态。' }}</p>
      </section>
      <section v-show="section === 'post'" id="clear-post-panel" class="clear-followed-posts" role="tabpanel" aria-labelledby="clear-post-tab" tabindex="0">
        <div class="clear-section-heading"><h2>关注帖子</h2><span>{{ posts.length }} 条</span></div>
        <p class="clear-post-reading-note">正文与图片展开显示，评论使用 B 站原版页面。</p>
        <section v-for="group in postDays" :key="group.key" class="clear-post-day">
          <h3 class="clear-day-title"><time :datetime="group.key">{{ group.label }}</time></h3>
          <div class="clear-post-grid">
            <article v-for="item in group.items" :key="item.id" class="clear-post" :data-post-id="item.id">
              <div class="clear-post-author"><a :href="authorUrl(item)" target="_blank" rel="noopener noreferrer"><img v-if="item.author.face" :src="item.author.face" alt="" loading="lazy" referrerpolicy="no-referrer" /><span>{{ item.author.name }}</span></a><time :datetime="iso(item.timestamp)">{{ clock(item.timestamp) }}</time></div>
              <h4 v-if="item.title">{{ item.title }}</h4>
              <p v-if="item.text" class="clear-post-text">{{ item.text }}</p>
              <p v-else-if="postDetailStates[item.id] === 'unavailable'" class="clear-post-detail-state">接口未返回正文，可打开原帖确认。</p>
              <div v-if="item.images.length" class="clear-post-images" :class="{ 'is-single': item.images.length === 1 }"><a v-for="(image, index) in item.images" :key="index" :href="item.url" target="_blank" rel="noopener noreferrer"><img :src="image" :alt="`${item.author.name}的帖子图片 ${index + 1}`" loading="lazy" referrerpolicy="no-referrer" /></a></div>
              <div class="clear-post-footer">
                <span v-if="postDetailStates[item.id] === 'loading'" class="clear-post-detail-state" role="status">正在读取正文…</span>
                <button v-else-if="postDetailStates[item.id] !== 'loaded'" type="button" class="clear-post-detail-button" :disabled="Boolean(detailsRequest)" @click="loadPostBodies(item)">{{ postDetailStates[item.id] === 'failed' || postDetailStates[item.id] === 'unavailable' ? '重试读取正文' : '加载更多正文' }}</button>
                <a class="clear-post-link" :href="item.url" target="_blank" rel="noopener noreferrer">查看原帖与评论</a>
              </div>
            </article>
          </div>
        </section>
        <p v-if="!posts.length" class="clear-feed-empty">{{ loading ? '正在读取关注帖子…' : '已加载的内容暂无关注帖子，可继续加载更早的动态。' }}</p>
      </section>
    </div>
    <div ref="sentinel" class="clear-feed-sentinel" aria-hidden="true"></div>
    <footer class="clear-feed-pagination"><button v-if="hasMore && accountId" type="button" :disabled="loading" @click="loadMore">{{ loading ? (pagesLoaded < 4 ? `正在加载首批内容（${pagesLoaded} / 4 页）…` : '正在加载…') : '加载更早的关注内容' }}</button><p v-else-if="accountId && !loading">已到当前接口返回的末尾。</p><p>已加载 {{ pagesLoaded }} 页，下滑接近底部时继续加载。切换标签保留已加载内容。</p></footer>
  </main>
</template>

<script lang="ts">
import { getUID } from '@/core/utils'
import { visibleInside } from '@/core/observer'
import { fetchFollowingPage, fetchFollowingPostDetail, FollowingItem } from './following'
import { getProgressStore } from './runtime'
import { fetchWatchlater, addWatchlaterBatch } from './watchlater'
import VideoTile from './VideoTile.vue'

const dateKey = (timestamp: number) => {
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const groupDays = (items: FollowingItem[]) => {
  const groups: { key: string; label: string; items: FollowingItem[] }[] = []
  const today = dateKey(Date.now())
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  for (const item of items) {
    const key = dateKey(item.timestamp)
    let group = groups[groups.length - 1]
    if (!group || group.key !== key) {
      const label = key === today ? '今天' : key === dateKey(yesterday.getTime()) ? '昨天' : key.replace(/-/g, '.')
      group = { key, label, items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups
}
const uniqueVideos = (items: FollowingItem[]) => {
  const aids = new Set<number>()
  const bvids = new Set<string>()
  return items.filter(item => {
    const video = item.video
    if (!video || video.aid <= 0 || !video.bvid || aids.has(video.aid) || bvids.has(video.bvid)) { return false }
    aids.add(video.aid)
    bvids.add(video.bvid)
    return true
  })
}

export default {
  components: { VideoTile },
  props: { active: { type: Boolean, default: true } },
  data() {
    return {
      accountId: getUID() || '', items: [] as FollowingItem[],
      offset: '', hasMore: true, loading: false, error: '', pagesLoaded: 0, started: false,
      historyLoading: false, historyError: '', revision: 0,
      section: 'video', disposed: false,
      postDetailStates: {} as Record<string, 'loading' | 'loaded' | 'failed' | 'unavailable'>,
      detailsRequest: null as AbortController | null,
      request: null as AbortController | null,
      historyRequest: null as AbortController | null,
      watchlaterRequest: null as AbortController | null,
      watchlaterLoading: false, watchlaterError: '', watchlaterCount: null as number | null,
      watchlaterAids: [] as number[], lastWatchlaterSync: 0,
      selectionMode: false, selectedBvids: [] as string[], batchBusy: false, batchMessage: '', batchError: '',
      batchRequest: null as AbortController | null,
      unsubscribe: null as (() => void) | null,
      scrollRoot: null as HTMLElement | null, pageObserver: null as IntersectionObserver | null,
      postObserver: null as IntersectionObserver | null,
      nearBottom: false, autoLoadArmed: false, userScrollUntil: 0, lastScrollTop: 0,
      pointerScrolling: false,
      scrollPositions: { video: 0, post: 0 }, restoringScroll: false,
    }
  },
  computed: {
    videos(): FollowingItem[] { return uniqueVideos(this.items.filter((item: FollowingItem) => item.kind === 'video')) },
    posts(): FollowingItem[] { return this.items.filter((item: FollowingItem) => item.kind === 'post') },
    videoDays() { return groupDays(this.videos) },
    postDays() { return groupDays(this.posts) },
    selectedVideos(): FollowingItem[] { return this.videos.filter((item: FollowingItem) => this.selectedBvids.includes(item.video.bvid)) },
  },
  watch: {
    active(value: boolean) {
      if (!value) {
        this.request?.abort()
        this.request = null
        this.loading = false
        this.cancelPostBodies()
        this.pageObserver?.disconnect()
        this.postObserver?.disconnect()
        this.autoLoadArmed = false
        this.pointerScrolling = false
        return
      }
      this.onFocus()
      this.ensureStarted()
      this.$nextTick(() => { this.restoreScroll(); this.installObservers() })
    },
  },
  created() {
    this.unsubscribe = getProgressStore().subscribe(() => { this.revision++ })
    window.addEventListener('focus', this.onFocus)
    this.ensureStarted()
  },
  mounted() {
    this.scrollRoot = (this.$el as HTMLElement).closest('.clear-home-shell') as HTMLElement
    this.scrollRoot?.addEventListener('scroll', this.onScroll, { passive: true })
    this.scrollRoot?.addEventListener('wheel', this.onUserScroll, { passive: true })
    this.scrollRoot?.addEventListener('touchmove', this.onUserScroll, { passive: true })
    this.scrollRoot?.addEventListener('keydown', this.onScrollKey)
    this.scrollRoot?.addEventListener('pointerdown', this.onPointerDown, { passive: true })
    window.addEventListener('pointerup', this.onPointerUp, { passive: true })
    window.addEventListener('pointercancel', this.onPointerUp, { passive: true })
    this.installObservers()
  },
  beforeDestroy() {
    this.disposed = true
    this.cancelPostBodies()
    this.request?.abort()
    this.historyRequest?.abort()
    this.watchlaterRequest?.abort()
    this.batchRequest?.abort()
    this.unsubscribe?.()
    this.pageObserver?.disconnect()
    this.postObserver?.disconnect()
    this.scrollRoot?.removeEventListener('scroll', this.onScroll)
    this.scrollRoot?.removeEventListener('wheel', this.onUserScroll)
    this.scrollRoot?.removeEventListener('touchmove', this.onUserScroll)
    this.scrollRoot?.removeEventListener('keydown', this.onScrollKey)
    this.scrollRoot?.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)
    window.removeEventListener('focus', this.onFocus)
  },
  methods: {
    ensureStarted() {
      if (!this.active || !this.accountId || this.disposed) { return }
      if (!this.started) {
        this.started = true
        this.loadPages(4)
        this.syncHistory()
        this.syncWatchlater()
      } else if (!this.loading && !this.error && this.pagesLoaded < 4 && this.hasMore) {
        this.loadPages(4 - this.pagesLoaded)
      }
    },
    installObservers() {
      this.pageObserver?.disconnect()
      this.postObserver?.disconnect()
      if (!this.active || this.disposed || !this.scrollRoot || !this.$refs.sentinel) { return }
      ;[this.pageObserver] = visibleInside(this.$refs.sentinel as HTMLElement, this.scrollRoot, '0px 0px 800px 0px', entries => {
        this.nearBottom = entries.some(entry => entry.isIntersecting)
        this.tryAutoLoad()
      })
      if (this.section === 'post') {
        const targets = [...(this.$el as HTMLElement).querySelectorAll<HTMLElement>('.clear-post[data-post-id]')]
        if (targets.length) {
          ;[this.postObserver] = visibleInside(targets, this.scrollRoot, '500px 0px', entries => {
            const ids = entries.filter(entry => entry.isIntersecting).map(entry => (entry.target as HTMLElement).dataset.postId)
            this.loadPostBodies(undefined, ids)
          })
        }
      }
    },
    onUserScroll() { this.userScrollUntil = Date.now() + 1200 },
    onPointerDown(event: PointerEvent) { if (event.button === 0) { this.pointerScrolling = true } },
    onPointerUp() { this.pointerScrolling = false },
    onScrollKey(event: KeyboardEvent) {
      if (['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) { this.onUserScroll() }
    },
    onScroll() {
      if (!this.active || !this.scrollRoot || this.restoringScroll) { return }
      const top = this.scrollRoot.scrollTop
      if (top > this.lastScrollTop + 1 && (this.pointerScrolling || Date.now() < this.userScrollUntil)) { this.autoLoadArmed = true }
      this.lastScrollTop = top
      this.scrollPositions[this.section] = top
      // A single user scroll may request one page, never an unbounded fill-the-viewport loop.
      this.tryAutoLoad()
    },
    tryAutoLoad() {
      if (!this.active || !this.nearBottom || !this.autoLoadArmed || this.loading || this.error || this.pagesLoaded < 4 || !this.hasMore) { return }
      this.autoLoadArmed = false
      this.loadPages(1)
    },
    restoreScroll() {
      if (!this.scrollRoot || !this.active) { return }
      this.restoringScroll = true
      this.userScrollUntil = 0
      this.scrollRoot.scrollTop = this.scrollPositions[this.section] || 0
      this.lastScrollTop = this.scrollRoot.scrollTop
      this.$nextTick(() => { this.restoringScroll = false })
    },
    switchSection(section: 'video' | 'post', focus = false) {
      if (section !== this.section) {
        if (this.scrollRoot) { this.scrollPositions[this.section] = this.scrollRoot.scrollTop }
        this.section = section
        this.autoLoadArmed = false
        this.nearBottom = false
        // Pending detail requests finish once and stay cached when only the tab changes.
        this.$nextTick(() => { this.restoreScroll(); this.installObservers() })
      }
      if (focus) { this.$nextTick(() => (this.$refs[`${section}Tab`] as HTMLButtonElement)?.focus({ preventScroll: true })) }
    },
    onTabKeydown(event: KeyboardEvent) {
      const sections = { ArrowLeft: this.section === 'video' ? 'post' : 'video', ArrowRight: this.section === 'video' ? 'post' : 'video', Home: 'video', End: 'post' }
      const section = sections[event.key]
      if (section) { event.preventDefault(); this.switchSection(section, true) }
    },
    cancelPostBodies() {
      this.detailsRequest?.abort()
      this.detailsRequest = null
      Object.keys(this.postDetailStates).forEach(id => { if (this.postDetailStates[id] === 'loading') { this.$delete(this.postDetailStates, id) } })
    },
    async loadPostBodies(requestedItem?: FollowingItem, visibleIds?: string[]) {
      if (!this.active || this.detailsRequest || this.section !== 'post' || !this.accountId || this.disposed) { return }
      const candidates = requestedItem ? [requestedItem] : this.posts.filter((item: FollowingItem) => !this.postDetailStates[item.id] && (!visibleIds || visibleIds.includes(item.id))).slice(0, 12)
      if (!candidates.length) { return }
      const controller = new AbortController()
      const accountId = this.accountId
      this.detailsRequest = controller
      let next = 0
      const worker = async () => {
        while (next < candidates.length && !controller.signal.aborted && this.active) {
          const item = candidates[next++]
          this.$set(this.postDetailStates, item.id, 'loading')
          try {
            const detail = await fetchFollowingPostDetail(item, accountId, controller.signal)
            if (this.disposed || controller.signal.aborted || this.detailsRequest !== controller || this.accountId !== accountId) { return }
            const index = this.items.findIndex((existing: FollowingItem) => existing.id === item.id)
            if (index >= 0) { this.$set(this.items, index, detail) }
            this.$set(this.postDetailStates, item.id, detail.postContentStatus === 'unavailable' ? 'unavailable' : 'loaded')
          } catch (error) {
            if (!this.disposed && !controller.signal.aborted && this.detailsRequest === controller) { this.$set(this.postDetailStates, item.id, 'failed') }
          }
        }
      }
      try { await Promise.all([worker(), worker()]) } finally {
        if (this.detailsRequest === controller) {
          this.detailsRequest = null
          // Reobserve only to service newly visible, never previously attempted, post bodies.
          this.$nextTick(this.installObservers)
        }
      }
    },
    iso(timestamp: number) { return new Date(timestamp).toISOString() },
    clock(timestamp: number) { return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) },
    authorUrl(item: FollowingItem) { return `https://space.bilibili.com/${item.author.id}` },
    progressFor(item: FollowingItem) { void this.revision; return getProgressStore().get(item.video.bvid) },
    unfinishedVideos(items: FollowingItem[]) { return uniqueVideos(items).filter(item => !this.progressFor(item)?.completed && !this.watchlaterAids.includes(item.video.aid)) },
    toggleSelectionMode() { this.selectionMode = !this.selectionMode; this.selectedBvids = [] },
    toggleSelected(item: FollowingItem) {
      if (!this.selectionMode || this.batchBusy || this.watchlaterAids.includes(item.video.aid)) { return }
      this.selectedBvids = this.selectedBvids.includes(item.video.bvid) ? this.selectedBvids.filter(bvid => bvid !== item.video.bvid) : [...this.selectedBvids, item.video.bvid]
    },
    selectUnfinished() { this.selectedBvids = this.unfinishedVideos(this.videos).map(item => item.video.bvid) },
    submitSelected() { this.addToWatchlater(this.selectedVideos) },
    submitDay(items: FollowingItem[]) { this.addToWatchlater(this.unfinishedVideos(items)) },
    async addToWatchlater(items: FollowingItem[]) {
      const videos = uniqueVideos(items)
      if (this.batchBusy || !videos.length || !this.active || !this.accountId) { return }
      if ((getUID() || '') !== this.accountId) { this.reload(); return }
      const controller = new AbortController()
      const accountId = this.accountId
      this.batchRequest = controller
      this.batchBusy = true
      this.batchMessage = `正在添加 ${videos.length} 个视频…`
      this.batchError = ''
      try {
        const result = await addWatchlaterBatch(videos.map(item => ({ aid: item.video.aid, bvid: item.video.bvid })), { signal: controller.signal })
        if (this.disposed || this.batchRequest !== controller || accountId !== this.accountId) { return }
        const successful = new Set([...result.added, ...result.existing])
        this.watchlaterAids = [...new Set([...this.watchlaterAids, ...successful])]
        this.selectedBvids = this.selectedBvids.filter(bvid => !videos.some(item => item.video.bvid === bvid && successful.has(item.video.aid)))
        this.batchMessage = `${result.cancelled ? '添加已停止。' : ''}已添加 ${result.added.length} 个，已在列表 ${result.existing.length} 个，失败 ${result.failed.length} 个。`
        this.batchError = result.failed[0]?.message || ''
        // Supersede a focus-triggered snapshot that could predate the batch writes.
        this.watchlaterRequest?.abort()
        this.watchlaterRequest = null
        this.watchlaterLoading = false
        this.watchlaterCount = null
        this.lastWatchlaterSync = 0
        this.syncWatchlater()
      } catch (error) {
        if (!this.disposed && this.batchRequest === controller) {
          this.batchMessage = '本次添加未完成。'
          this.batchError = error instanceof Error ? error.message : '请稍后重试。'
        }
      } finally {
        if (this.batchRequest === controller) { this.batchBusy = false; this.batchRequest = null }
      }
    },
    async syncWatchlater() {
      if (!this.active || !this.accountId || this.watchlaterLoading || this.disposed) { return }
      if ((getUID() || '') !== this.accountId) { this.reload(); return }
      const controller = new AbortController()
      const accountId = this.accountId
      this.watchlaterRequest = controller
      this.watchlaterLoading = true
      this.watchlaterError = ''
      try {
        const result = await fetchWatchlater(controller.signal)
        if (this.disposed || this.watchlaterRequest !== controller || accountId !== this.accountId) { return }
        this.watchlaterCount = result.count
        this.watchlaterAids = result.aids
        this.lastWatchlaterSync = Date.now()
      } catch (error) {
        if (this.watchlaterRequest === controller && !controller.signal.aborted) { this.watchlaterError = error instanceof Error ? error.message : '稍后再看数量暂时无法读取。' }
      } finally {
        if (this.watchlaterRequest === controller) { this.watchlaterLoading = false; this.watchlaterRequest = null }
      }
    },
    onFocus() {
      if (!this.active) { return }
      const accountId = getUID() || ''
      if (accountId !== this.accountId) { this.reload() } else {
        this.revision++
        if (this.started && Date.now() - this.lastWatchlaterSync > 30000) { this.syncWatchlater() }
      }
    },
    reload() {
      this.cancelPostBodies()
      this.request?.abort(); this.request = null; this.loading = false
      this.historyRequest?.abort(); this.historyRequest = null; this.historyLoading = false; this.historyError = ''
      this.watchlaterRequest?.abort(); this.watchlaterRequest = null; this.watchlaterLoading = false
      this.batchRequest?.abort(); this.batchRequest = null; this.batchBusy = false
      this.postDetailStates = {}; this.items = []; this.selectedBvids = []; this.selectionMode = false
      this.accountId = getUID() || ''; this.offset = ''; this.hasMore = true; this.error = ''; this.pagesLoaded = 0
      this.started = false; this.autoLoadArmed = false; this.nearBottom = false
      this.batchMessage = ''; this.batchError = ''; this.watchlaterCount = null; this.watchlaterAids = []; this.lastWatchlaterSync = 0; this.watchlaterError = ''
      this.scrollPositions = { video: 0, post: 0 }
      this.ensureStarted()
      this.$nextTick(this.restoreScroll)
    },
    loadMore() { this.loadPages(1) },
    retryPages() { this.loadPages(Math.max(1, 4 - this.pagesLoaded)) },
    async loadPages(count = 1) {
      if (!this.active || this.loading || !this.hasMore || !this.accountId || this.disposed) { return }
      const controller = new AbortController()
      this.request = controller; this.loading = true; this.error = ''; this.autoLoadArmed = false
      try {
        for (let page = 0; page < count && this.hasMore && this.active; page++) {
          const result = await fetchFollowingPage(this.offset, controller.signal)
          if (this.disposed || this.request !== controller || controller.signal.aborted) { return }
          if (result.accountId !== this.accountId || (getUID() || '') !== this.accountId) {
            this.items = []
            throw new Error('登录账号已变化，请刷新动态。')
          }
          const byId = new Map<string, FollowingItem>(this.items.map((item: FollowingItem) => [item.id, item]))
          result.items.forEach((item: FollowingItem) => { if (!byId.has(item.id) || !this.postDetailStates[item.id]) { byId.set(item.id, item) } })
          this.items = [...byId.values()].sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id))
          this.hasMore = result.hasMore && result.offset !== this.offset
          this.offset = result.offset
          this.pagesLoaded++
          this.$nextTick(this.installObservers)
        }
      } catch (error) {
        if (this.request === controller && !controller.signal.aborted) { this.error = error instanceof Error ? error.message : '读取关注内容失败，请重试。' }
      } finally {
        if (this.request === controller) {
          this.loading = false; this.request = null
          this.$nextTick(this.installObservers)
        }
      }
    },
    async syncHistory() {
      this.historyRequest?.abort()
      if (!this.active || !this.accountId) { this.historyLoading = false; this.historyError = ''; return }
      const controller = new AbortController()
      this.historyRequest = controller; this.historyLoading = true; this.historyError = ''
      try {
        await getProgressStore().syncHistory(controller.signal)
        if (this.disposed || this.historyRequest !== controller) { return }
        this.revision++
      } catch (error) {
        if (this.historyRequest === controller && !controller.signal.aborted) { this.historyError = error instanceof Error ? error.message : '观看历史同步失败，已保存的本地记录仍可使用。' }
      } finally {
        if (this.historyRequest === controller) { this.historyLoading = false; this.historyRequest = null }
      }
    },
  },
}
</script>
