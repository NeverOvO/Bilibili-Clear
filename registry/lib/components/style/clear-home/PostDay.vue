<template>
  <section class="clear-post-day">
    <h3 class="clear-day-title">
      <time :datetime="group.key">{{ group.label }}</time>
    </h3>
    <div class="clear-post-masonry" :style="{ '--clear-post-columns': columnCount }">
      <div v-for="(column, columnIndex) in columns" :key="columnIndex" class="clear-post-column">
        <article
          v-for="item in column"
          :key="item.id"
          class="clear-post"
          :class="{ 'has-lottery': item.lottery, 'is-article': item.article }"
          :data-post-id="item.id"
        >
          <div class="clear-post-author">
            <a :href="authorUrl(item)" target="_blank" rel="noopener noreferrer"
              ><img
                v-if="item.author.face"
                :src="item.author.face"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
              /><span>{{ item.author.name }}</span></a
            >
            <time :datetime="iso(item.timestamp)">{{ clock(item.timestamp) }}</time>
          </div>
          <div v-if="item.accessBadge || item.lottery" class="clear-post-badges">
            <span v-if="item.accessBadge" class="clear-post-access-badge"
              ><svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M6 8V6a4 4 0 0 1 8 0v2M4 8h12v9H4zM10 11v3" /></svg
              >{{ item.accessBadge }}</span
            >
            <button
              v-if="item.lottery"
              type="button"
              class="clear-post-lottery"
              aria-haspopup="dialog"
              title="打开 B 站抽奖详情"
              @click="$emit('open-lottery', item)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8H8a3 3 0 1 1 3-3Zm0 0h4a3 3 0 1 0-3-3Z"
                /></svg
              >参与抽奖
            </button>
          </div>
          <p v-if="foldedMeta[item.id]" class="clear-post-fold-label">{{ foldedMeta[item.id] }}</p>
          <a
            v-if="item.article"
            class="clear-article-preview"
            :href="item.url"
            target="_blank"
            rel="noopener noreferrer"
          >
            <h4>{{ item.article.title || item.title || '阅读文章' }}</h4>
            <div
              class="clear-article-cover clear-post-image-slot"
              :class="{ 'is-loaded': loadedImages[item.article.cover] }"
              :data-image-url="item.article.cover || null"
            >
              <img
                v-if="item.article.cover && requestedImages[item.article.cover]"
                :src="item.article.cover"
                :alt="item.article.title || '文章封面'"
                decoding="async"
                referrerpolicy="no-referrer"
                @load="onImageLoaded(item.article.cover, $event)"
                @error="$set(failedImages, item.article.cover, true)"
              />
              <svg
                v-if="!item.article.cover || failedImages[item.article.cover]"
                class="clear-article-placeholder"
                viewBox="0 0 48 48"
                aria-hidden="true"
              >
                <path d="M13 5h15l9 9v29H13zM28 5v10h9M19 23h12M19 30h12M19 37h7" />
              </svg>
              <span class="clear-article-badge">
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M5 2h7l4 4v12H5zM12 2v5h4M8 11h5M8 14h5" />
                </svg>
                文章
              </span>
            </div>
          </a>
          <div
            v-else
            class="clear-post-body"
            :class="{ 'is-clipped': clippedBodies[item.id] }"
            :data-body-id="item.id"
          >
            <div class="clear-post-body-inner">
              <h4 v-if="item.title">{{ item.title }}</h4>
              <p v-if="item.text" class="clear-post-text">{{ item.text }}</p>
              <div
                v-else-if="detailStates[item.id] === 'loading'"
                class="clear-post-body-placeholder"
                aria-label="正在读取正文"
              >
                <span /><span />
              </div>
              <p
                v-else-if="detailStates[item.id] === 'queued'"
                class="clear-post-detail-state"
                role="status"
              >
                正文等待加载…
              </p>
              <p
                v-else-if="detailStates[item.id] === 'failed'"
                class="clear-post-detail-state"
                role="status"
              >
                正文加载失败，可点击下方按钮重试。
              </p>
              <p
                v-else-if="detailStates[item.id] === 'unavailable'"
                class="clear-post-detail-state"
                role="status"
              >
                正文暂时无法读取，可打开原帖查看。
              </p>
              <div v-if="item.images.length" class="clear-post-images">
                <div
                  v-for="(row, rowIndex) in imageRows(item)"
                  :key="rowIndex"
                  class="clear-post-image-row"
                >
                  <button
                    v-for="entry in row"
                    :key="entry.url"
                    type="button"
                    class="clear-post-image-slot"
                    :class="{
                      'is-loaded': loadedImages[entry.url],
                      'has-error': failedImages[entry.url],
                    }"
                    :data-image-url="entry.url"
                    :style="{
                      aspectRatio: imageRatio(item, entry.url),
                      flexGrow: imageAspect(item, entry.url),
                    }"
                    :aria-label="`${item.author.name}的帖子图片 ${entry.index + 1}，放大查看`"
                    aria-haspopup="dialog"
                    @click.stop="openImage(item, entry.index, $event)"
                  >
                    <img
                      v-if="requestedImages[entry.url]"
                      :src="entry.url"
                      :alt="`${item.author.name}的帖子图片 ${entry.index + 1}`"
                      :width="imageSize(item, entry.url).width"
                      :height="imageSize(item, entry.url).height"
                      decoding="async"
                      referrerpolicy="no-referrer"
                      @load="onImageLoaded(entry.url, $event)"
                      @error="$set(failedImages, entry.url, true)"
                    />
                    <span v-if="failedImages[entry.url]" class="clear-post-image-error"
                      >图片暂未加载，点击重试</span
                    >
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div class="clear-post-footer">
            <span
              v-if="!item.article && detailStates[item.id] === 'loading'"
              class="clear-post-detail-state"
              role="status"
              >正在读取正文…</span
            >
            <button
              v-else-if="!item.article && detailStates[item.id] !== 'loaded'"
              type="button"
              class="clear-post-detail-button"
              :disabled="detailsBusy"
              @click="$emit('load-detail', item)"
            >
              {{
                detailStates[item.id] === 'failed' || detailStates[item.id] === 'unavailable'
                  ? '重试读取正文'
                  : '加载更多正文'
              }}
            </button>
            <a class="clear-post-link" :href="item.url" target="_blank" rel="noopener noreferrer">{{
              item.article
                ? '阅读全文与评论'
                : clippedBodies[item.id]
                ? '查看完整帖子与评论'
                : '查看原帖与评论'
            }}</a>
          </div>
        </article>
      </div>
    </div>
    <PostImageViewer
      v-if="viewer && active"
      :images="viewer.images"
      :initial-index="viewer.index"
      :author="viewer.author"
      :opener="viewer.opener"
      @close="viewer = null"
    />
  </section>
</template>

<script lang="ts">
import type { PropType } from 'vue'
import { sizeChange, visibleInside } from '@/core/observer'
import type { FollowingItem } from './following'
import PostImageViewer from './PostImageViewer.vue'

type ImageSize = { width: number; height: number }
type PostGroup = { key: string; label: string; items: FollowingItem[] }
// In-memory dimensions only. Returning to a tab need not rediscover an image's layout.
const naturalSizes = new Map<string, ImageSize>()
const fallbackSize: ImageSize = { width: 4, height: 3 }

export default {
  components: { PostImageViewer },
  props: {
    group: { type: Object as PropType<PostGroup>, required: true },
    detailStates: { type: Object as PropType<Record<string, string>>, required: true },
    detailsBusy: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    foldedMeta: { type: Object as PropType<Record<string, string>>, default: () => ({}) },
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
      bodyObserver: null as ResizeObserver | null,
      clippedBodies: {} as Record<string, boolean>,
      viewer: null as {
        images: string[]
        index: number
        author: string
        opener: HTMLElement
      } | null,
      disposed: false,
    }
  },
  computed: {
    columns(): FollowingItem[][] {
      const items = new Map<string, FollowingItem>(
        this.group.items.map((item: FollowingItem) => [item.id, item]),
      )
      return this.columnIds.map((ids: string[]) => ids.map(id => items.get(id)).filter(Boolean))
    },
  },
  watch: {
    'group.items': {
      immediate: true,
      handler() {
        this.assignColumns()
        this.$nextTick(this.observeImages)
      },
    },
    active(value: boolean) {
      if (value) {
        this.$nextTick(() => {
          this.measureWidth()
          this.observeImages()
        })
      } else {
        this.imageObserver?.disconnect()
        this.viewer = null
      }
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
    this.bodyObserver?.disconnect()
  },
  methods: {
    openImage(item: FollowingItem, index: number, event: MouseEvent) {
      this.viewer = {
        images: [...item.images],
        index,
        author: item.author.name,
        opener: event.currentTarget as HTMLElement,
      }
    },
    imageRows(item: FollowingItem): { url: string; index: number }[][] {
      const rows: { url: string; index: number }[][] = []
      for (let index = 0; index < item.images.length; index += 2) {
        rows.push(
          item.images
            .slice(index, index + 2)
            .map((url, offset) => ({ url, index: index + offset })),
        )
      }
      return rows
    },
    imageAspect(item: FollowingItem, url: string): number {
      const size = this.imageSize(item, url)
      return size.width / size.height
    },
    updateClippedBodies() {
      if (this.disposed || !this.active || !this.$el) {
        return
      }
      for (const body of (this.$el as HTMLElement).querySelectorAll<HTMLElement>(
        '.clear-post-body',
      )) {
        const clipped = body.scrollHeight > body.clientHeight + 1
        const bottom = body.getBoundingClientRect().bottom
        for (const button of body.querySelectorAll<HTMLButtonElement>('button')) {
          button.tabIndex = clipped && button.getBoundingClientRect().top >= bottom ? -1 : 0
        }
        if (this.clippedBodies[body.dataset.bodyId] !== clipped) {
          this.$set(this.clippedBodies, body.dataset.bodyId, clipped)
        }
      }
    },
    imageSize(item: FollowingItem, url: string): ImageSize {
      return item.imageSizes?.[url] || this.imageSizes[url] || naturalSizes.get(url) || fallbackSize
    },
    imageRatio(item: FollowingItem, url: string): string {
      const size = this.imageSize(item, url)
      return `${size.width} / ${size.height}`
    },
    measureWidth() {
      if (this.disposed || !this.active || !this.$el) {
        return
      }
      const width = (this.$el as HTMLElement).clientWidth
      if (!width || width === this.contentWidth) {
        return
      }
      this.contentWidth = width
      const count = Math.min(4, Math.max(1, Math.floor((width + 20) / 340)))
      if (count !== this.columnCount) {
        this.columnCount = count
        this.assignColumns(true)
      }
      this.$nextTick(this.observeImages)
    },
    estimateHeight(item: FollowingItem) {
      const width = Math.max(
        160,
        (this.contentWidth - (this.columnCount - 1) * 20) / this.columnCount - 36,
      )
      if (item.article) {
        return 178 + (width * 9) / 16
      }
      const charsPerLine = Math.max(10, Math.floor(width / 15))
      const lines = item.text
        .split('\n')
        .reduce(
          (count, paragraph) => count + Math.max(1, Math.ceil(paragraph.length / charsPerLine)),
          0,
        )
      let height = 112 + (item.title ? 58 : 0) + (item.text ? lines * 27 : 54)
      for (const row of this.imageRows(item)) {
        const ratio = row.reduce((sum, entry) => sum + this.imageAspect(item, entry.url), 0)
        height += (width - (row.length - 1) * 8) / ratio + 8
      }
      return Math.min(height, window.innerHeight * 2 - 32)
    },
    assignColumns(reset = false) {
      const byId = new Map<string, FollowingItem>(
        this.group.items.map((item: FollowingItem) => [item.id, item]),
      )
      const columns: string[][] =
        reset || this.columnIds.length !== this.columnCount
          ? Array.from({ length: this.columnCount }, () => [])
          : this.columnIds.map((ids: string[]) => ids.filter(id => byId.has(id)))
      const assigned = new Set(columns.flat())
      const heights = columns.map(ids =>
        ids.reduce((sum, id) => sum + this.estimateHeight(byId.get(id)), 0),
      )
      for (const item of this.group.items as FollowingItem[]) {
        if (assigned.has(item.id)) {
          continue
        }
        const column = heights.indexOf(Math.min(...heights))
        columns[column].push(item.id)
        heights[column] += this.estimateHeight(item)
      }
      // Existing cards stay in their assigned columns when detail text or pictures expand.
      this.columnIds = columns
    },
    observeImages() {
      this.imageObserver?.disconnect()
      this.bodyObserver?.disconnect()
      if (this.disposed || !this.active || !this.$el) {
        return
      }
      const element = this.$el as HTMLElement
      // The parent must observe the cards after a column-count change has rendered.
      this.$emit('layout-ready')
      const bodies = [
        ...element.querySelectorAll<HTMLElement>('.clear-post-body, .clear-post-body-inner'),
      ]
      if (bodies.length) {
        ;[this.bodyObserver] = sizeChange(bodies, this.updateClippedBodies)
      }
      this.updateClippedBodies()
      const root = element.closest('.clear-home-shell') as HTMLElement | null
      const targets = [
        ...element.querySelectorAll<HTMLElement>('.clear-post-image-slot[data-image-url]'),
      ].filter(target => !this.requestedImages[target.dataset.imageUrl])
      if (!root || !targets.length) {
        return
      }
      ;[this.imageObserver] = visibleInside(targets, root, '1400px 0px', entries => {
        if (!this.active || this.disposed) {
          return
        }
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue
          }
          const target = entry.target as HTMLElement
          const url = target.dataset.imageUrl
          if (url) {
            this.$set(this.requestedImages, url, true)
          }
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
        if (naturalSizes.size > 800) {
          naturalSizes.delete(naturalSizes.keys().next().value)
        }
      }
      this.$set(this.loadedImages, url, true)
      this.$delete(this.failedImages, url)
    },
    iso(timestamp: number) {
      return new Date(timestamp).toISOString()
    },
    clock(timestamp: number) {
      return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    },
    authorUrl(item: FollowingItem) {
      return `https://space.bilibili.com/${item.author.id}`
    },
  },
}
</script>
