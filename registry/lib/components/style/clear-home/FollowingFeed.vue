<template>
  <main class="clear-following-content">
    <div class="clear-following-heading">
      <div><h1>只看我关注的</h1><p>视频与帖子，按时间慢慢看。</p></div>
      <div class="clear-feed-actions"><button type="button" :disabled="loading" @click="reload">刷新动态</button><button type="button" :disabled="historyLoading" @click="syncHistory">{{ historyLoading ? '同步中…' : '同步观看记录' }}</button></div>
    </div>
    <p v-if="!accountId" class="clear-feed-notice">登录 B 站后显示关注内容。<a href="https://passport.bilibili.com/login" target="_blank" rel="noopener noreferrer">前往登录</a>，完成后点击刷新动态。</p>
    <p v-if="error" class="clear-feed-notice is-error" role="alert">{{ error }} <button type="button" :disabled="loading" @click="loadMore">重试</button></p>
    <p v-if="historyError" class="clear-feed-notice" role="status">{{ historyError }} <button type="button" :disabled="historyLoading" @click="syncHistory">重试同步</button></p>
    <details class="clear-history-note"><summary>观看标记说明</summary><p>同步最近最多 90 条 B 站历史，并记录本浏览器普通视频页的播放位置。有明确完成记录才盖“看完了”印章；多 P 视频需要各分 P 的完成记录。未命中历史不代表从未观看。短视频的进度依赖 B 站播放器写入历史，退出后可手动同步。</p></details>
    <div class="clear-feed-mobile-tabs" role="group" aria-label="关注内容"><button type="button" :aria-pressed="section === 'video'" @click="section = 'video'">视频 {{ videos.length }}</button><button type="button" :aria-pressed="section === 'post'" @click="section = 'post'">帖子 {{ posts.length }}</button></div>
    <div class="clear-following-columns" :data-section="section" :aria-busy="loading ? 'true' : 'false'">
      <section class="clear-followed-videos" aria-labelledby="clear-videos-title">
        <div class="clear-section-heading"><h2 id="clear-videos-title">关注视频</h2><span>{{ videos.length }} 条</span></div>
        <section v-for="group in videoDays" :key="group.key" class="clear-day-group">
          <h3 class="clear-day-title"><time :datetime="group.key">{{ group.label }}</time><span>{{ group.items.length }} 条视频</span></h3>
          <div class="clear-video-grid"><VideoTile v-for="item in group.items" :key="item.id" :item="item" :progress="progressFor(item)" /></div>
        </section>
        <p v-if="!videos.length" class="clear-feed-empty">{{ loading ? '正在读取关注视频…' : '本批内容暂无关注视频，可继续加载更早的动态。' }}</p>
      </section>
      <section class="clear-followed-posts" aria-labelledby="clear-posts-title">
        <div class="clear-section-heading"><h2 id="clear-posts-title">关注帖子</h2><span>{{ posts.length }} 条</span></div>
        <section v-for="group in postDays" :key="group.key" class="clear-post-day">
          <h3 class="clear-day-title"><time :datetime="group.key">{{ group.label }}</time></h3>
          <article v-for="item in group.items" :key="item.id" class="clear-post">
            <div class="clear-post-author"><a :href="authorUrl(item)" target="_blank" rel="noopener noreferrer"><img v-if="item.author.face" :src="item.author.face" alt="" loading="lazy" referrerpolicy="no-referrer" /><span>{{ item.author.name }}</span></a><time :datetime="iso(item.timestamp)">{{ clock(item.timestamp) }}</time></div>
            <h4 v-if="item.title">{{ item.title }}</h4>
            <p v-if="item.text" class="clear-post-text">{{ item.text }}</p>
            <div v-if="item.images.length" class="clear-post-images"><a v-for="(image, index) in item.images.slice(0, 9)" :key="index" :href="item.url" target="_blank" rel="noopener noreferrer"><img :src="image" :alt="`${item.author.name}的帖子图片 ${index + 1}`" loading="lazy" referrerpolicy="no-referrer" /></a></div>
            <a class="clear-post-link" :href="item.url" target="_blank" rel="noopener noreferrer">查看完整动态</a>
          </article>
        </section>
        <p v-if="!posts.length" class="clear-feed-empty">{{ loading ? '正在读取关注帖子…' : '本批内容暂无关注帖子，可继续加载更早的动态。' }}</p>
      </section>
    </div>
    <footer class="clear-feed-pagination"><button v-if="hasMore && accountId" type="button" :disabled="loading" @click="loadMore">{{ loading ? '正在加载…' : '加载更早的关注内容' }}</button><p v-else-if="accountId && !loading">已到当前接口返回的末尾。</p><p>仅展示已确认关注的 UP 原创内容，不混入推荐、直播或转发。</p></footer>
  </main>
</template>

<script lang="ts">
import { getUID } from '@/core/utils'
import { fetchFollowingPage, FollowingItem } from './following'
import { getProgressStore } from './runtime'
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
export default {
  components: { VideoTile },
  data() {
    return {
      accountId: getUID() || '',
      items: [] as FollowingItem[],
      offset: '', hasMore: true, loading: false, error: '',
      historyLoading: false, historyError: '', revision: 0,
      section: 'video', disposed: false,
      request: null as AbortController | null,
      historyRequest: null as AbortController | null,
      unsubscribe: null as (() => void) | null,
    }
  },
  computed: {
    videos(): FollowingItem[] { return this.items.filter((item: FollowingItem) => item.kind === 'video') },
    posts(): FollowingItem[] { return this.items.filter((item: FollowingItem) => item.kind === 'post') },
    videoDays() { return groupDays(this.videos) },
    postDays() { return groupDays(this.posts) },
  },
  created() {
    this.unsubscribe = getProgressStore().subscribe(() => { this.revision++ })
    this.loadMore()
    this.syncHistory()
    window.addEventListener('focus', this.onFocus)
  },
  beforeDestroy() {
    this.disposed = true
    this.request?.abort()
    this.historyRequest?.abort()
    this.unsubscribe?.()
    window.removeEventListener('focus', this.onFocus)
  },
  methods: {
    iso(timestamp: number) { return new Date(timestamp).toISOString() },
    clock(timestamp: number) { return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) },
    authorUrl(item: FollowingItem) { return `https://space.bilibili.com/${item.author.id}` },
    progressFor(item: FollowingItem) {
      // Reading the revision makes non-reactive, account-scoped store changes rerender cards.
      void this.revision
      return getProgressStore().get(item.video.bvid)
    },
    onFocus() {
      const accountId = getUID() || ''
      if (accountId !== this.accountId) {
        this.reload()
      } else {
        this.revision++
      }
    },
    reload() {
      this.request?.abort()
      this.request = null
      this.loading = false
      this.accountId = getUID() || ''
      this.items = []
      this.offset = ''
      this.hasMore = true
      this.error = ''
      this.loadMore()
      this.syncHistory()
    },
    async loadMore() {
      if (this.loading || !this.hasMore || !this.accountId) { return }
      const controller = new AbortController()
      this.request = controller
      this.loading = true
      this.error = ''
      try {
        const result = await fetchFollowingPage(this.offset, controller.signal)
        if (this.disposed || this.request !== controller) { return }
        if (result.accountId !== this.accountId || (getUID() || '') !== this.accountId) {
          this.items = []
          throw new Error('登录账号已变化，请刷新动态。')
        }
        const byId = new Map<string, FollowingItem>(this.items.map((item: FollowingItem) => [item.id, item]))
        result.items.forEach((item: FollowingItem) => byId.set(item.id, item))
        this.items = [...byId.values()].sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id))
        this.hasMore = result.hasMore && result.offset !== this.offset
        this.offset = result.offset
      } catch (error) {
        if (this.request === controller && !controller.signal.aborted) {
          this.error = error instanceof Error ? error.message : '读取关注内容失败，请重试。'
        }
      } finally {
        if (this.request === controller) { this.loading = false; this.request = null }
      }
    },
    async syncHistory() {
      this.historyRequest?.abort()
      if (!this.accountId) { this.historyLoading = false; this.historyError = ''; return }
      const controller = new AbortController()
      this.historyRequest = controller
      this.historyLoading = true
      this.historyError = ''
      try {
        await getProgressStore().syncHistory(controller.signal)
        if (this.disposed || this.historyRequest !== controller) { return }
        this.revision++
      } catch (error) {
        if (this.historyRequest === controller && !controller.signal.aborted) {
          this.historyError = error instanceof Error ? error.message : '观看历史同步失败，已保存的本地记录仍可使用。'
        }
      } finally {
        if (this.historyRequest === controller) { this.historyLoading = false; this.historyRequest = null }
      }
    },
  },
}
</script>
