import { childListSubtree } from '@/core/observer'
import { getCommentArea } from './comment-area'
import {
  CommentAreaCallback,
  CommentCallbackInput,
  CommentCallbackPair,
  CommentItemCallback,
} from './types'
import { CommentArea } from './areas/base'
import { deleteValue } from '@/core/utils'

export class CommentAreaManager {
  /** 当前页面所有的评论区列表 */
  commentAreas: CommentArea[] = []
  commentAreaCallbacks: CommentCallbackPair<CommentAreaCallback>[] = []

  protected static commentAreaSelectors = '.bili-comment, .bb-comment, bili-comments'
  protected initialized = false
  private observedAreas = new Map<HTMLElement, CommentArea>()

  init() {
    if (this.initialized) {
      return
    }
    childListSubtree(document.body, records => {
      if (this.observedAreas.size && records.some(record => record.removedNodes.length)) {
        this.observedAreas.forEach(area => {
          if (!area.element.isConnected) {
            this.removeArea(area)
          }
        })
      }
      records.forEach(r => {
        r.addedNodes.forEach(n => this.observeAreas(n))
      })
    })
    this.initialized = true
    dqa(CommentAreaManager.commentAreaSelectors).forEach(it => this.observeAreas(it))
  }

  async observeAreas(node: Node) {
    if (
      !(node instanceof HTMLElement) ||
      !node.isConnected ||
      !node.matches(CommentAreaManager.commentAreaSelectors) ||
      this.observedAreas.has(node)
    ) {
      return
    }
    const area = getCommentArea(node)
    this.observedAreas.set(node, area)
    try {
      await area.observe()
    } catch (error) {
      if (this.observedAreas.get(node) === area) {
        this.removeArea(area)
      }
      console.error('初始化评论区监听失败。', error)
      return
    }
    if (this.observedAreas.get(node) === area && node.isConnected) {
      this.commentAreas.push(area)
      this.commentAreaCallbacks.forEach(c => c.added?.(area))
    }
  }

  private removeArea(area: CommentArea) {
    this.observedAreas.delete(area.element)
    area.disconnect()
    if (this.commentAreas.includes(area)) {
      deleteValue(this.commentAreas, item => item === area)
      this.commentAreaCallbacks.forEach(c => c.removed?.(area))
    }
  }

  forEachCommentArea(input: CommentCallbackInput<CommentAreaCallback>) {
    const pair = CommentArea.resolveCallbackPair(input)
    this.commentAreas.forEach(it => pair.added?.(it))
    this.commentAreaCallbacks.push(pair)
  }

  forEachCommentItem(callbacks: CommentCallbackPair<CommentItemCallback>) {
    this.forEachCommentArea(area => area.forEachCommentItem(callbacks))
  }
}
