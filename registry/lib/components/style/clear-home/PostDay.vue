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
                :src="avatarPreview(item.author.face)"
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
                :src="requestedImages[item.article.cover]"
                :alt="item.article.title || '文章封面'"
                decoding="async"
                referrerpolicy="no-referrer"
                @load="onImageLoaded(item.article.cover, $event)"
                @error="onImageFailed(item.article.cover)"
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
                      :src="requestedImages[entry.url]"
                      :alt="`${item.author.name}的帖子图片 ${entry.index + 1}`"
                      :width="imageSize(item, entry.url).width"
                      :height="imageSize(item, entry.url).height"
                      decoding="async"
                      referrerpolicy="no-referrer"
                      @load="onImageLoaded(entry.url, $event)"
                      @error="onImageFailed(entry.url)"
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
            <a
              v-if="!item.article && clippedBodies[item.id]"
              class="clear-post-truncated"
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
              >… 内容较长，查看完整内容</a
            >
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
type PreviewJob = {
  owner: object
  valid: () => boolean
  start: (release: () => void) => void
  cancel: () => void
}
type PostRuntime = {
  frame: number
  waitingTick: boolean
  mounted: boolean
  disposed: boolean
  syncTargets: boolean
  notifyLayout: boolean
  imageObserver: IntersectionObserver | null
  resizeObserver: ResizeObserver | null
  root: HTMLElement | null
  resizeTargets: Set<HTMLElement>
  imageTargets: Set<HTMLElement>
  visibleImages: Set<HTMLElement>
  hiddenImages: Set<HTMLElement>
  dirtyBodies: Set<HTMLElement>
  queued: Set<string>
  pending: Map<string, () => void>
}
const naturalSizes = new Map<string, ImageSize>()
const fallbackSize: ImageSize = { width: 4, height: 3 }
// Shared by all day groups: scrolling across several days cannot start a full-size image burst.
const previewQueue: PreviewJob[] = []
let activePreviews = 0
const drainPreviewQueue = () => {
  while (activePreviews < 4 && previewQueue.length) {
    const job = previewQueue.shift()
    if (!job.valid()) {
      job.cancel()
      continue
    }
    activePreviews++
    let released = false
    const release = () => {
      if (released) {
        return
      }
      released = true
      activePreviews--
      drainPreviewQueue()
    }
    job.start(release)
  }
}
const cancelQueuedPreviews = (owner: object) => {
  for (let index = previewQueue.length - 1; index >= 0; index--) {
    if (previewQueue[index].owner === owner) {
      previewQueue.splice(index, 1)[0].cancel()
    }
  }
}
const thumbnailUrl = (url: string, width: number, ratio: number) => {
  try {
    const image = new URL(url)
    if (!/(^|\.)hdslb\.com$/i.test(image.hostname) || !/^https?:$/.test(image.protocol)) {
      return url
    }
    image.protocol = 'https:'
    // Preserve aspect ratio while capping both the thumbnail's width and tall-image pixel count.
    const pixels = Math.max(
      1,
      Math.round(Math.min(width * Math.min(window.devicePixelRatio || 1, 2), 720, 1200 * ratio)),
    )
    image.pathname = `${image.pathname.split('@')[0]}@${pixels}w.jpg`
    return image.href
  } catch {
    return url
  }
}

export default {
  components: { PostImageViewer },
  props: {
    group: { type: Object as PropType<PostGroup>, required: true },
    layoutKey: { type: String, default: 'posts' },
    detailStates: { type: Object as PropType<Record<string, string>>, required: true },
    detailsBusy: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    foldedMeta: { type: Object as PropType<Record<string, string>>, default: () => ({}) },
  },
  beforeCreate() {
    // Observers, element sets and scheduling flags must not take part in Vue's render dependency graph.
    this._postRuntime = {
      frame: 0,
      waitingTick: false,
      mounted: false,
      disposed: false,
      syncTargets: true,
      notifyLayout: true,
      imageObserver: null,
      resizeObserver: null,
      root: null,
      resizeTargets: new Set(),
      imageTargets: new Set(),
      visibleImages: new Set(),
      hiddenImages: new Set(),
      dirtyBodies: new Set(),
      queued: new Set(),
      pending: new Map(),
    } as PostRuntime
  },
  data() {
    return {
      columnCount: 1,
      contentWidth: 0,
      columnIds: [[]] as string[][],
      requestedImages: {} as Record<string, string>,
      loadedImages: {} as Record<string, boolean>,
      failedImages: {} as Record<string, boolean>,
      imageSizes: {} as Record<string, ImageSize>,
      clippedBodies: {} as Record<string, boolean>,
      viewer: null as {
        images: string[]
        index: number
        author: string
        opener: HTMLElement
      } | null,
    }
  },
  computed: {
    itemIds(): string {
      return this.group.items.map((item: FollowingItem) => item.id).join('|')
    },
    mediaKey(): string {
      return this.group.items
        .map(
          (item: FollowingItem) =>
            `${item.id}:${
              item.article ? `article:${item.article.cover}` : `post:${item.images.join(',')}`
            }`,
        )
        .join('|')
    },
    previewReadyKey(): string {
      return this.group.items
        .map((item: FollowingItem) => `${item.id}:${this.previewReady(item)}`)
        .join('|')
    },
    columns(): FollowingItem[][] {
      const items = new Map<string, FollowingItem>(
        this.group.items.map((item: FollowingItem) => [item.id, item]),
      )
      return this.columnIds.map((ids: string[]) => ids.map(id => items.get(id)).filter(Boolean))
    },
  },
  watch: {
    itemIds: {
      immediate: true,
      handler() {
        this.assignColumns()
      },
    },
    layoutKey() {
      this.assignColumns(true)
    },
    mediaKey() {
      this.scheduleLayout(true)
    },
    previewReadyKey() {
      this.scheduleLayout()
    },
    active(value: boolean) {
      if (value) {
        this.resumeObservers()
      } else {
        this.pauseObservers()
        this.viewer = null
      }
    },
  },
  mounted() {
    const runtime = this._postRuntime as PostRuntime
    runtime.mounted = true
    runtime.root = (this.$el as HTMLElement).closest('.clear-home-shell')
    ;[runtime.resizeObserver] = sizeChange([], entries => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement
        if (element === this.$el) {
          if (Math.abs(entry.contentRect.width - this.contentWidth) > 1) {
            this.scheduleLayout()
          }
        } else {
          const body = element.matches('.clear-post-body') ? element : element.parentElement
          if (body?.matches('.clear-post-body')) {
            runtime.dirtyBodies.add(body)
            this.scheduleLayout()
          }
        }
      }
    })
    if (runtime.root) {
      ;[runtime.imageObserver] = visibleInside([], runtime.root, '320px 0px', entries => {
        if (!this.active || runtime.disposed) {
          return
        }
        for (const entry of entries) {
          const element = entry.target as HTMLElement
          if (entry.isIntersecting) {
            runtime.visibleImages.add(element)
          } else {
            runtime.visibleImages.delete(element)
          }
        }
        this.scheduleLayout()
      })
    }
    if (this.active) {
      this.resumeObservers()
    }
  },
  beforeDestroy() {
    const runtime = this._postRuntime as PostRuntime
    runtime.disposed = true
    this.pauseObservers()
    for (const finish of runtime.pending.values()) {
      finish()
    }
    runtime.pending.clear()
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
    avatarPreview(url: string): string {
      return thumbnailUrl(url, 36, 1)
    },
    previewReady(item: FollowingItem): boolean {
      if (item.article || item.text.trim() || item.postContentStatus === 'resolved') {
        return true
      }
      return ['loaded', 'failed', 'unavailable'].includes(this.detailStates[item.id])
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
    imageSize(item: FollowingItem, url: string): ImageSize {
      return item.imageSizes?.[url] || this.imageSizes[url] || naturalSizes.get(url) || fallbackSize
    },
    imageRatio(item: FollowingItem, url: string): string {
      const size = this.imageSize(item, url)
      return `${size.width} / ${size.height}`
    },
    scheduleLayout(syncTargets = false) {
      const runtime = this._postRuntime as PostRuntime
      runtime.syncTargets = runtime.syncTargets || syncTargets
      if (
        !runtime.mounted ||
        !this.active ||
        runtime.disposed ||
        runtime.frame ||
        runtime.waitingTick
      ) {
        return
      }
      runtime.waitingTick = true
      this.$nextTick(() => {
        runtime.waitingTick = false
        if (!this.active || runtime.disposed || runtime.frame) {
          return
        }
        runtime.frame = requestAnimationFrame(() => {
          runtime.frame = 0
          if (!this.active || runtime.disposed) {
            return
          }
          const width = (this.$el as HTMLElement).clientWidth
          if (width && width !== this.contentWidth) {
            this.contentWidth = width
            const count = Math.min(4, Math.max(1, Math.floor((width + 20) / 340)))
            if (count !== this.columnCount) {
              this.columnCount = count
              this.assignColumns(true)
              return
            }
          }
          if (runtime.syncTargets) {
            runtime.syncTargets = false
            this.syncObservedTargets()
          }
          this.updateClippedBodies()
          this.queueVisibleImages()
          if (runtime.notifyLayout) {
            runtime.notifyLayout = false
            this.$emit('layout-ready')
          }
        })
      })
    },
    resumeObservers() {
      const runtime = this._postRuntime as PostRuntime
      if (!runtime.mounted || runtime.disposed) {
        return
      }
      runtime.resizeObserver?.observe(this.$el as HTMLElement)
      this.scheduleLayout(true)
    },
    pauseObservers() {
      const runtime = this._postRuntime as PostRuntime
      cancelAnimationFrame(runtime.frame)
      runtime.frame = 0
      runtime.resizeObserver?.disconnect()
      runtime.imageObserver?.disconnect()
      runtime.resizeTargets.clear()
      runtime.imageTargets.clear()
      runtime.visibleImages.clear()
      runtime.hiddenImages.clear()
      runtime.dirtyBodies.clear()
      cancelQueuedPreviews(runtime)
      runtime.syncTargets = true
    },
    syncObservedTargets() {
      const runtime = this._postRuntime as PostRuntime
      const element = this.$el as HTMLElement
      const resizeTargets = new Set([
        ...element.querySelectorAll<HTMLElement>('.clear-post-body, .clear-post-body-inner'),
      ])
      for (const target of runtime.resizeTargets) {
        if (!resizeTargets.has(target)) {
          runtime.resizeObserver?.unobserve(target)
          runtime.dirtyBodies.delete(target)
        }
      }
      for (const target of resizeTargets) {
        if (!runtime.resizeTargets.has(target)) {
          runtime.resizeObserver?.observe(target)
          const body = target.matches('.clear-post-body') ? target : target.parentElement
          if (body) {
            runtime.dirtyBodies.add(body)
          }
        }
      }
      runtime.resizeTargets = resizeTargets
      const imageTargets = new Set([
        ...element.querySelectorAll<HTMLElement>('.clear-post-image-slot[data-image-url]'),
      ])
      for (const target of runtime.imageTargets) {
        if (!imageTargets.has(target)) {
          runtime.imageObserver?.unobserve(target)
          runtime.visibleImages.delete(target)
          runtime.hiddenImages.delete(target)
        }
      }
      for (const target of imageTargets) {
        if (!runtime.imageTargets.has(target) && !this.requestedImages[target.dataset.imageUrl]) {
          runtime.imageObserver?.observe(target)
        }
      }
      runtime.imageTargets = imageTargets
    },
    updateClippedBodies() {
      const runtime = this._postRuntime as PostRuntime
      // Read every dirty body's geometry before applying any Vue or tabindex updates.
      const measurements = [...runtime.dirtyBodies]
        .filter(body => body.isConnected)
        .map(body => {
          const clipped = body.scrollHeight > body.clientHeight + 1
          const bottom = body.getBoundingClientRect().bottom
          const buttons = [
            ...body.querySelectorAll<HTMLButtonElement>('.clear-post-image-slot'),
          ].map(button => ({
            button,
            hidden: clipped && button.getBoundingClientRect().top >= bottom,
          }))
          return { body, clipped, buttons }
        })
      runtime.dirtyBodies.clear()
      for (const { body, clipped, buttons } of measurements) {
        if (this.clippedBodies[body.dataset.bodyId] !== clipped) {
          this.$set(this.clippedBodies, body.dataset.bodyId, clipped)
        }
        for (const { button, hidden } of buttons) {
          if (button.tabIndex !== (hidden ? -1 : 0)) {
            button.tabIndex = hidden ? -1 : 0
          }
          if (hidden) {
            runtime.hiddenImages.add(button)
          } else {
            runtime.hiddenImages.delete(button)
          }
        }
      }
    },
    queueVisibleImages() {
      const runtime = this._postRuntime as PostRuntime
      if (!runtime.visibleImages.size) {
        return
      }
      const items = new Map<string, FollowingItem>(
        this.group.items.map((item: FollowingItem) => [item.id, item]),
      )
      // Width reads are batched before setting reactive image sources.
      const candidates = [...runtime.visibleImages]
        .filter(target => !runtime.hiddenImages.has(target))
        .map(target => {
          const url = target.dataset.imageUrl
          const item = items.get(target.closest<HTMLElement>('[data-post-id]')?.dataset.postId)
          return { target, url, item, width: target.clientWidth }
        })
        .filter(
          entry =>
            entry.url &&
            entry.item &&
            entry.width > 0 &&
            this.previewReady(entry.item) &&
            !this.requestedImages[entry.url] &&
            !runtime.queued.has(entry.url),
        )
      for (const { target, url, item, width } of candidates) {
        runtime.queued.add(url)
        previewQueue.push({
          owner: runtime,
          valid: () =>
            !runtime.disposed &&
            this.active &&
            target.isConnected &&
            runtime.visibleImages.has(target) &&
            !runtime.hiddenImages.has(target),
          cancel: () => runtime.queued.delete(url),
          start: release => {
            runtime.queued.delete(url)
            let timer = 0
            const finish = () => {
              clearTimeout(timer)
              runtime.pending.delete(url)
              release()
            }
            timer = window.setTimeout(() => {
              this.$set(this.failedImages, url, true)
              this.$delete(this.requestedImages, url)
              finish()
            }, 15000)
            runtime.pending.set(url, finish)
            this.$set(
              this.requestedImages,
              url,
              thumbnailUrl(url, width, this.imageAspect(item, url)),
            )
            runtime.imageObserver?.unobserve(target)
            runtime.visibleImages.delete(target)
          },
        })
      }
      drainPreviewQueue()
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
      // Removed cards must not leave an empty leading column, but appending data keeps existing positions.
      if (!reset) {
        const compact = columns.filter(ids => ids.length)
        columns.splice(
          0,
          columns.length,
          ...compact,
          ...Array.from({ length: this.columnCount - compact.length }, () => []),
        )
      }
      const assigned = new Set(columns.flat())
      const heights = columns.map(ids =>
        ids.reduce((sum, id) => sum + this.estimateHeight(byId.get(id)), 0),
      )
      for (const item of this.group.items as FollowingItem[]) {
        if (!assigned.has(item.id)) {
          const column = heights.indexOf(Math.min(...heights))
          columns[column].push(item.id)
          heights[column] += this.estimateHeight(item)
        }
      }
      if (
        columns.some((ids, index) => ids.join('|') !== this.columnIds[index]?.join('|')) ||
        columns.length !== this.columnIds.length
      ) {
        this.columnIds = columns
        const runtime = this._postRuntime as PostRuntime
        runtime.notifyLayout = true
        this.scheduleLayout(true)
      }
    },
    onImageLoaded(url: string, event: Event) {
      const runtime = this._postRuntime as PostRuntime
      runtime.pending.get(url)?.()
      if (runtime.disposed) {
        return
      }
      const image = event.target as HTMLImageElement
      const item = (this.group.items as FollowingItem[]).find(
        entry => entry.images.includes(url) || entry.article?.cover === url,
      )
      const known = item?.imageSizes?.[url] || this.imageSizes[url] || naturalSizes.get(url)
      if (
        image.naturalWidth > 0 &&
        image.naturalHeight > 0 &&
        (!known ||
          Math.abs(known.width / known.height - image.naturalWidth / image.naturalHeight) > 0.01)
      ) {
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
    onImageFailed(url: string) {
      const runtime = this._postRuntime as PostRuntime
      runtime.pending.get(url)?.()
      if (!runtime.disposed) {
        this.$set(this.failedImages, url, true)
      }
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
