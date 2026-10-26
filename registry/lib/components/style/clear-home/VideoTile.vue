<template>
  <article class="clear-video-tile">
    <a class="clear-video-cover" :class="{ 'is-watched': progress && progress.completed, 'is-started': progress && !progress.completed && progress.position > 0 }" :href="watchUrl" target="_blank" rel="noopener noreferrer" :aria-label="item.title + '，' + progressLabel">
      <img :src="item.video.cover" :alt="item.title" loading="lazy" referrerpolicy="no-referrer" />
      <div v-if="progress && progress.completed" class="clear-watched-mask">
        <span class="clear-watched-stamp"><span>看完了</span><small>Bilibili Clear</small></span>
      </div>
      <div v-else-if="progress && progress.position > 0" class="clear-started-mask" aria-hidden="true"></div>
      <span v-if="item.video.playCount" class="clear-cover-count">▷ {{ item.video.playCount }}</span>
      <span class="clear-cover-duration">{{ duration(item.video.duration) }}</span>
      <div v-if="progress && progress.position > 0 && !progress.completed" class="clear-watch-track" :aria-label="progressLabel"><span :style="{ width: progressPercent + '%' }"></span></div>
    </a>
    <h3><a :href="watchUrl" target="_blank" rel="noopener noreferrer">{{ item.title }}</a></h3>
    <div class="clear-video-byline"><a :href="authorUrl" target="_blank" rel="noopener noreferrer">{{ item.author.name }}</a><time :datetime="isoDate">{{ time }}</time></div>
    <p class="clear-watch-label" :class="{ 'has-progress': progress }">{{ progressLabel }}</p>
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
  },
  computed: {
    authorUrl(): string { return `https://space.bilibili.com/${this.item.author.id}` },
    isoDate(): string { return new Date(this.item.timestamp).toISOString() },
    time(): string { return new Date(this.item.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) },
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
  methods: { duration },
}
</script>
