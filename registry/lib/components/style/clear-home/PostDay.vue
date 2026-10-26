<template>
  <section class="clear-post-day">
    <h3 class="clear-day-title"><time :datetime="group.key">{{ group.label }}</time></h3>
    <div class="clear-post-masonry" :style="{ '--clear-post-columns': columnCount }">
      <div v-for="(column, columnIndex) in columns" :key="columnIndex" class="clear-post-column">
        <article v-for="item in column" :key="item.id" class="clear-post" :data-post-id="item.id">
          <div class="clear-post-author">
            <a :href="authorUrl(item)" target="_blank" rel="noopener noreferrer"><img v-if="item.author.face" :src="item.author.face" alt="" loading="lazy" referrerpolicy="no-referrer" /><span>{{ item.author.name }}</span></a>
            <time :datetime="iso(item.timestamp)">{{ clock(item.timestamp) }}</time>
          </div>
          <h4 v-if="item.title">{{ item.title }}</h4>
          <p v-if="item.text" class="clear-post-text">{{ item.text }}</p>
          <div v-else-if="detailStates[item.id] === 'loading'" class="clear-post-body-placeholder" aria-label="正在读取正文"><span /><span /></div>
          <p v-else-if="detailStates[item.id] === 'unavailable'" class="clear-post-detail-state">正文暂时无法读取，可打开原帖查看。</p>
          <div v-if="item.images.length" class="clear-post-images">
            <a
              v-for="(image, index) in item.images"
              :key="image"
              class="clear-post-image-slot"
              :class="{ 'is-loaded': loadedImages[image], 'has-error': failedImages[image] }"
              :data-image-url="image"
              :style="{ aspectRatio: imageRatio(item, image) }"
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="`${item.author.name}的帖子图片 ${index + 1}，查看原帖`"
            >
              <img
                v-if="requestedImages[image]"
                :src="image"
                :alt="`${item.author.name}的帖子图片 ${index + 1}`"
                :width="imageSize(item, image).width"
                :height="imageSize(item, image).height"
                decoding="async"
                referrerpolicy="no-referrer"
                @load="onImageLoaded(image, $event)"
                @error="$set(failedImages, image, true)"
              />
              <span v-if="failedImages[image]" class="clear-post-image-error">图片暂未加载，点击查看原帖</span>
            </a>
          </div>
          <div class="clear-post-footer">
            <span v-if="detailStates[item.id] === 'loading'" class="clear-post-detail-state" role="status">正在读取正文…</span>
            <button v-else-if="detailStates[item.id] !== 'loaded'" type="button" class="clear-post-detail-button" :disabled="detailsBusy" @click="$emit('load-detail', item)">{{ detailStates[item.id] === 'failed' || detailStates[item.id] === 'unavailable' ? '重试读取正文' : '加载更多正文' }}</button>
            <a class="clear-post-link" :href="item.url" target="_blank" rel="noopener noreferrer">查看原帖与评论</a>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<script lang="ts">
import type { PropType } from 'vue'
import { sizeChange, visibleInside } from '@/core/observer'
import type { FollowingItem } from './following'

type ImageSize = { width: number; height: number }
type PostGroup = { key: string; label: string; items: FollowingItem[] }
// In-memory dimensions only. Returning to a tab need not rediscover an image's layout.
const naturalSizes = new Map<string, ImageSize>()
const fallbackSize: ImageSize = { width: 4, height: 3 }

export default {
  props: {
    group: { type: Object as PropType<PostGroup>, required: true },
    detailStates: { type: Object as PropType<Record<string, string>>, required: true },
    detailsBusy: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  data() {
    return {
      columnCount: 1,
      contentWidth: 0,
      columnIds: [[]] as string[][],
      requestedImages: {} as Record<string, boolean>,
      loadedImages: {} as Record<string, boolean>,
      failedImages: {} as Record<string, boolean>,
      imageSizes: {} as Record<string, ImageSize>,
      imageObserver: null as IntersectionObserver | null,
      resizeObserver: null as ResizeObserver | null,
      disposed: false,
    }
  },
  computed: {
    columns(): FollowingItem[][] {
      const items = new Map<string, FollowingItem>(this.group.items.map((item: FollowingItem) => [item.id, item]))
      return this.columnIds.map((ids: string[]) => ids.map(id => items.get(id)).filter(Boolean))
    },
  },
  watch: {
    'group.items': { immediate: true, handler() {
      this.assignColumns()
      this.$nextTick(this.observeImages)
    } },
    active(value: boolean) {
      if (value) { this.$nextTick(() => { this.measureWidth(); this.observeImages() }) }
      else { this.imageObserver?.disconnect() }
    },
  },
  mounted() {
    this.measureWidth()
    ;[this.resizeObserver] = sizeChange(this.$el as HTMLElement, this.measureWidth)
    this.$nextTick(this.observeImages)
  },
  beforeDestroy() {
    this.disposed = true
    this.resizeObserver?.disconnect()
    this.imageObserver?.disconnect()
  },
  methods: {
    imageSize(item: FollowingItem, url: string): ImageSize {
      return item.imageSizes?.[url] || this.imageSizes[url] || naturalSizes.get(url) || fallbackSize
    },
    imageRatio(item: FollowingItem, url: string): string {
      const size = this.imageSize(item, url)
      return `${size.width} / ${size.height}`
    },
    measureWidth() {
      if (this.disposed || !this.active || !this.$el) { return }
      const width = (this.$el as HTMLElement).clientWidth
      if (!width || width === this.contentWidth) { return }
      this.contentWidth = width
      const count = Math.min(4, Math.max(1, Math.floor((width + 20) / 340)))
      if (count !== this.columnCount) {
        this.columnCount = count
        this.assignColumns(true)
      }
      this.$nextTick(this.observeImages)
    },
    estimateHeight(item: FollowingItem) {
      const width = Math.max(160, (this.contentWidth - (this.columnCount - 1) * 20) / this.columnCount - 36)
      const charsPerLine = Math.max(10, Math.floor(width / 15))
      const lines = item.text.split('\n').reduce((count, paragraph) => count + Math.max(1, Math.ceil(paragraph.length / charsPerLine)), 0)
      let height = 112 + (item.title ? 58 : 0) + (item.text ? lines * 27 : 54)
      const imageWidth = item.images.length === 1 ? width : (width - 8) / 2
      for (let index = 0; index < item.images.length; index += 2) {
        const row = item.images.slice(index, index + 2).map(url => {
          const size = this.imageSize(item, url)
          return imageWidth * size.height / size.width
        })
        height += Math.max(...row) + 8
      }
      return height
    },
    assignColumns(reset = false) {
      const byId = new Map<string, FollowingItem>(this.group.items.map((item: FollowingItem) => [item.id, item]))
      const columns: string[][] = reset || this.columnIds.length !== this.columnCount
        ? Array.from({ length: this.columnCount }, () => [])
        : this.columnIds.map((ids: string[]) => ids.filter(id => byId.has(id)))
      const assigned = new Set(columns.flat())
      const heights = columns.map(ids => ids.reduce((sum, id) => sum + this.estimateHeight(byId.get(id)), 0))
      for (const item of this.group.items as FollowingItem[]) {
        if (assigned.has(item.id)) { continue }
        const column = heights.indexOf(Math.min(...heights))
        columns[column].push(item.id)
        heights[column] += this.estimateHeight(item)
      }
      // Existing cards stay in their assigned columns when detail text or pictures expand.
      this.columnIds = columns
    },
    observeImages() {
      this.imageObserver?.disconnect()
      if (this.disposed || !this.active || !this.$el) { return }
      const element = this.$el as HTMLElement
      // The parent must observe the cards after a column-count change has rendered.
      this.$emit('layout-ready')
      const root = element.closest('.clear-home-shell') as HTMLElement | null
      const targets = [...element.querySelectorAll<HTMLElement>('.clear-post-image-slot[data-image-url]')]
        .filter(target => !this.requestedImages[target.dataset.imageUrl])
      if (!root || !targets.length) { return }
      ;[this.imageObserver] = visibleInside(targets, root, '1400px 0px', entries => {
        if (!this.active || this.disposed) { return }
        for (const entry of entries) {
          if (!entry.isIntersecting) { continue }
          const target = entry.target as HTMLElement
          const url = target.dataset.imageUrl
          if (url) { this.$set(this.requestedImages, url, true) }
          this.imageObserver?.unobserve(target)
        }
      })
    },
    onImageLoaded(url: string, event: Event) {
      const image = event.target as HTMLImageElement
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        const size = { width: image.naturalWidth, height: image.naturalHeight }
        this.$emit('before-layout')
        this.$set(this.imageSizes, url, size)
        naturalSizes.set(url, size)
        if (naturalSizes.size > 800) { naturalSizes.delete(naturalSizes.keys().next().value) }
      }
      this.$set(this.loadedImages, url, true)
      this.$delete(this.failedImages, url)
    },
    iso(timestamp: number) { return new Date(timestamp).toISOString() },
    clock(timestamp: number) { return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) },
    authorUrl(item: FollowingItem) { return `https://space.bilibili.com/${item.author.id}` },
  },
}
</script>
