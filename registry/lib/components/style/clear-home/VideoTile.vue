<template>
  <article class="clear-video-tile" :class="{ 'is-selectable': selectable, 'is-selected': selected }">
    <span v-if="selectable && queued" class="clear-video-selection is-queued">已在稍后再看</span>
    <label v-else-if="selectable" class="clear-video-selection">
      <input type="checkbox" :checked="selected" :disabled="selectionDisabled || adding" :aria-label="`选择视频：${item.title}`" @change="$emit('select-toggle')" />
      <span>{{ selected ? '已选择' : '选择' }}</span>
    </label>
    <button
      class="clear-video-watchlater"
      type="button"
      :class="{ 'is-queued': queued, 'is-adding': adding, 'has-error': addError && !queued }"
      :disabled="queued || selectionDisabled || adding"
      :title="watchlaterLabel"
      :aria-label="`${watchlaterLabel}：${item.title}`"
      :aria-busy="adding ? 'true' : 'false'"
      @click.stop="$emit('watchlater-add')"
    >
      <svg v-if="queued" class="clear-watchlater-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10a2 2 0 0 1 2 2v16l-7-4-7 4V5a2 2 0 0 1 2-2Z"/><path d="m8 9 3 3 5-5"/></svg>
      <svg v-else-if="adding" class="clear-watchlater-pending" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="M11 6v5l3 2M18 15v7m-3.5-3.5h7"/></svg>
      <span>{{ queued ? '已添加' : (adding ? '正在添加…' : (addError ? '重试添加' : '添加至稍后再看')) }}</span>
    </button>
    <span v-if="addError && !queued" class="clear-video-add-error" role="alert" :title="addError">添加失败，点击右上角重试</span>
    <a class="clear-video-cover" :class="{ 'is-watched': progress && progress.completed, 'is-started': progress && !progress.completed && progress.position > 0 }" :href="watchUrl" target="_blank" rel="noopener noreferrer" :aria-label="item.title + '，' + progressLabel" @click="onVideoClick">
      <img :src="item.video.cover" :alt="item.title" loading="lazy" referrerpolicy="no-referrer" />
      <div v-if="progress && progress.completed" class="clear-watched-mask">
        <span class="clear-watched-stamp"><span>看完了</span><small>Bilibili Clear</small></span>
      </div>
      <div v-else-if="progress && progress.position > 0" class="clear-started-mask" aria-hidden="true"></div>
      <div class="clear-cover-meta">
        <span v-if="item.video.playCount" class="clear-cover-plays">▷ {{ item.video.playCount }}</span>
        <span class="clear-cover-progress" :class="{ 'has-progress': hasWatchProgress, 'is-complete': progress && progress.completed }" :title="progressLabel">{{ compactProgress }}</span>
        <span v-if="!hasWatchProgress" class="clear-cover-length">{{ duration(item.video.duration) }}</span>
      </div>
      <div v-if="progress && progress.position > 0 && !progress.completed" class="clear-watch-track" :aria-label="progressLabel"><span :style="{ width: progressPercent + '%' }"></span></div>
    </a>
    <h3><a :href="watchUrl" target="_blank" rel="noopener noreferrer" @click="onVideoClick">{{ item.title }}</a></h3>
    <div class="clear-video-byline"><a :href="authorUrl" target="_blank" rel="noopener noreferrer">{{ item.author.name }}</a><time :datetime="isoDate">{{ time }}</time></div>
  </article>
</template>

<script lang="ts">
import type { PropType } from 'vue'
import type { FollowingItem } from './following'
import type { WatchProgress } from './progress'
const duration = (seconds: number) => {
  const n = Math.max(0, Math.floor(Number(seconds) || 0))
  return n >= 3600
    ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
    : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
}
export default {
  props: {
    item: { type: Object as PropType<FollowingItem>, required: true },
    progress: { type: Object as PropType<WatchProgress>, default: undefined },
    selectable: { type: Boolean, default: false },
    selected: { type: Boolean, default: false },
    queued: { type: Boolean, default: false },
    selectionDisabled: { type: Boolean, default: false },
    adding: { type: Boolean, default: false },
    addError: { type: String, default: '' },
  },
  computed: {
    authorUrl(): string { return `https://space.bilibili.com/${this.item.author.id}` },
    isoDate(): string { return new Date(this.item.timestamp).toISOString() },
    time(): string { return new Date(this.item.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) },
    watchlaterLabel(): string {
      if (this.queued) { return '已在稍后再看' }
      if (this.adding) { return '正在添加至稍后再看…' }
      return this.addError ? `添加失败：${this.addError}，点击重试` : '添加至稍后再看'
    },
    hasWatchProgress(): boolean {
      return Boolean(this.progress && !this.progress.completed && (this.progress.position > 0 || this.progress.partCompleted))
    },
    compactProgress(): string {
      const p = this.progress
      if (p?.completed) { return '看完了' }
      if (!this.hasWatchProgress) { return '无观看记录' }
      const total = p.duration || this.item.video.duration
      const part = p.pages > 1 || p.page > 1 ? `P${p.page || 1} ` : ''
      const clock = (value: number) => duration(value).padStart(5, '0')
      return `${part}${clock(p.position)}/${total > 0 ? clock(total) : '--:--'}`
    },
    progressLabel(): string {
      const p = this.progress
      if (!p) { return '无观看记录' }
      if (p.completed) { return '看完了' }
      const part = p.pages > 1 || p.page > 1 ? `P${p.page || 1} · ` : ''
      if (p.partCompleted) { return `${part}该分 P 已看完` }
      return `${part}看到 ${duration(p.position)}${p.duration > 0 ? ` / ${duration(p.duration)}` : ''}`
    },
    progressPercent(): number {
      return Math.min(100, Math.max(0, this.progress.position / (this.progress.duration || this.item.video.duration || 1) * 100))
    },
    watchUrl(): string {
      const url = new URL(this.item.url)
      const p = this.progress
      if (p && !p.completed) {
        if (p.page > 1) { url.searchParams.set('p', String(p.page)) }
        if (p.position > 0 && !p.partCompleted) { url.searchParams.set('t', String(Math.floor(p.position))) }
      }
      return url.href
    },
  },
  methods: {
    duration,
    onVideoClick(event: MouseEvent) {
      if (!this.selectable) { return }
      event.preventDefault()
      if (!this.selectionDisabled && !this.queued && !this.adding) { this.$emit('select-toggle') }
    },
  },
}
</script>
