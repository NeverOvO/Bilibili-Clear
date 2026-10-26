import { childListSubtree } from '@/core/observer'
import { addStyle } from '@/core/style'
import nativePlayerStyle from './native-player.scss'

export interface NativePlayerState {
  ready: boolean
  playing: boolean
  muted: boolean
  needsGesture: boolean
  error: string
}
export interface NativePlayerOptions {
  bvid: string
  cid?: number
  onState?: (state: NativePlayerState) => void
  onNavigate?: (direction: -1 | 1) => void
  onClose?: () => void
}

const pathClass = 'clear-native-path'
const playerClass = 'clear-native-player'
const frameClass = 'clear-native-frame'
const playerSelector = '.bpx-player-container, #bilibili-player .bilibili-player'
const bwpMediaSelector = '.bpx-player-video-area bwp-video, .bilibili-player-video bwp-video'
const videoMediaSelector = '.bpx-player-video-area video, .bilibili-player-video video'
const controlSelector = 'input, textarea, select, button, a, [role="button"], [contenteditable="true"], .bpx-player-control-wrap, .bpx-player-sending-area, .bpx-player-dialog-wrap, .bpx-player-ctrl-setting-box, .bilibili-player-control-wrap, .bilibili-player-video-popup'

/**
 * The regular www video page shares the parent page's origin and login session.
 * Only its presentation is changed; permissions, playback and history remain native.
 */
export const mountNativePlayer = (iframe: HTMLIFrameElement, options: NativePlayerOptions) => {
  let disposed = false
  let stopped = false
  let frameDocument: Document | undefined
  let observer: MutationObserver | undefined
  let style: HTMLStyleElement | undefined
  let player: HTMLElement | undefined
  let media: HTMLVideoElement | undefined
  let markedPath: HTMLElement[] = []
  let mediaAttempted = false
  let scanQueued = false
  let desiredMuted = false
  let wantsPlayback = !document.hidden
  let playSequence = 0
  let wheelDelta = 0
  let lastNavigation = 0
  let touchStart: { x: number; y: number } | undefined
  let playFeedbackTimer: number | undefined
  let state: NativePlayerState = {
    ready: false, playing: false, muted: false, needsGesture: false, error: '',
  }
  const emit = (patch: Partial<NativePlayerState>) => {
    if (disposed) {
      return
    }
    state = { ...state, ...patch }
    options.onState?.({ ...state })
  }
  const pause = () => {
    wantsPlayback = false
    playSequence++
    window.clearTimeout(playFeedbackTimer)
    try {
      media?.pause?.()
    } catch (error) {
      console.warn('[Bilibili Clear] 原生播放器暂停失败。', error)
    }
    emit({ playing: false })
  }
  const stop = (message: string) => {
    if (stopped || disposed) {
      return
    }
    stopped = true
    pause()
    emit({ error: message, needsGesture: false })
  }
  const correctVideo = () => {
    if (disposed || stopped || !frameDocument) {
      return false
    }
    try {
      const win = iframe.contentWindow as Window & { cid?: number | string | number[] }
      const url = new URL(win.location.href)
      const activeBvid = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1]
      if (url.origin !== location.origin || activeBvid !== options.bvid) {
        stop('播放器已离开当前推荐视频，请切换下一条或打开原页。')
        return false
      }
      const cid = Array.isArray(win.cid) ? 0 : Number(win.cid)
      if (options.cid && Number.isFinite(cid) && cid > 0 && cid !== options.cid) {
        stop('播放器已切换分 P，请在原页继续观看该合集。')
        return false
      }
      return true
    } catch {
      stop('无法连接同源播放器，请打开原页播放。')
      return false
    }
  }
  const readMediaState = () => {
    if (!media || !correctVideo()) {
      return
    }
    const playing = !media.paused && !media.ended
    if (playing && !wantsPlayback) {
      media.pause()
      return
    }
    const muted = Boolean(media.muted) || media.volume === 0
    if (mediaAttempted) {
      desiredMuted = muted
    }
    emit({ playing, muted, ...(playing ? { needsGesture: false } : {}) })
  }
  const applySound = () => {
    if (!media) {
      return
    }
    // Do not modify the site's persisted player settings or account preferences.
    media.muted = desiredMuted
    if (!desiredMuted && media.volume === 0) {
      media.volume = 0.5
    }
  }
  const play = async () => {
    wantsPlayback = true
    if (!media || !correctVideo()) {
      return
    }
    mediaAttempted = true
    const currentMedia = media
    const sequence = ++playSequence
    window.clearTimeout(playFeedbackTimer)
    try {
      applySound()
      // Calling play synchronously before the await retains a real button's activation.
      await Promise.resolve(currentMedia.play())
      if (disposed || sequence !== playSequence || currentMedia !== media) {
        return
      }
      emit({ needsGesture: false, error: '' })
      readMediaState()
      // Some BWP builds return void. Wait for their playing event, then expose a real play button.
      playFeedbackTimer = window.setTimeout(() => {
        if (sequence === playSequence && media === currentMedia && currentMedia.paused) {
          emit({ needsGesture: true, playing: false })
        }
      }, 4000)
    } catch (error) {
      if (disposed || sequence !== playSequence || currentMedia !== media) {
        return
      }
      if ((error as Error)?.name === 'NotAllowedError') {
        emit({ needsGesture: true, playing: false })
      } else if ((error as Error)?.name !== 'AbortError') {
        // Native entitlement and network messages stay visible inside the player.
        emit({ needsGesture: true, playing: false })
        console.warn('[Bilibili Clear] 原生播放器未开始播放。', error)
      }
    }
  }
  const autoplay = () => {
    if (!wantsPlayback || mediaAttempted || !media || !correctVideo()) {
      return
    }
    mediaAttempted = true
    play()
  }
  const navigate = (direction: -1 | 1) => {
    if (disposed || Date.now() - lastNavigation < 650) {
      return
    }
    lastNavigation = Date.now()
    options.onNavigate?.(direction)
  }
  const ended = () => {
    if (!correctVideo()) {
      return
    }
    pause()
    // Leave this native page before its own next-video countdown can show unfiltered content.
    navigate(1)
  }
  const mediaFailed = () => {
    emit({ playing: false, needsGesture: false, error: '原生播放器暂时无法播放，可重试或打开原页。' })
  }
  const mediaEvents: [string, EventListener][] = [
    ['loadedmetadata', autoplay], ['canplay', autoplay], ['playing', () => { autoplay(); readMediaState() }],
    ['pause', readMediaState], ['volumechange', readMediaState], ['ended', ended], ['error', mediaFailed],
  ]
  const unbindMedia = () => {
    playSequence++
    window.clearTimeout(playFeedbackTimer)
    mediaEvents.forEach(([name, handler]) => media?.removeEventListener(name, handler))
  }
  const ignoreControl = (event: Event) => {
    const target = event.target as Element | null
    return target?.nodeType === 1 && Boolean(target.closest(controlSelector))
  }
  const onKeydown = (event: KeyboardEvent) => {
    if (ignoreControl(event) || event.altKey || event.ctrlKey || event.metaKey) {
      return
    }
    if (event.key === 'Escape') {
      if (frameDocument?.fullscreenElement) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      options.onClose?.()
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!event.repeat) {
        navigate(event.key === 'ArrowDown' ? 1 : -1)
      }
    }
  }
  const onWheel = (event: WheelEvent) => {
    if (ignoreControl(event) || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    if (Date.now() - lastNavigation < 650) {
      wheelDelta = 0
      return
    }
    wheelDelta += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1)
    if (Math.abs(wheelDelta) >= 80) {
      navigate(wheelDelta > 0 ? 1 : -1)
      wheelDelta = 0
    }
  }
  const onTouchStart = (event: TouchEvent) => {
    touchStart = !ignoreControl(event) && event.touches.length === 1
      ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
      : undefined
  }
  const onTouchEnd = (event: TouchEvent) => {
    const start = touchStart
    touchStart = undefined
    if (!start || event.changedTouches.length !== 1) {
      return
    }
    const touch = event.changedTouches[0]
    const dx = start.x - touch.clientX
    const dy = start.y - touch.clientY
    if (Math.abs(dy) >= 70 && Math.abs(dy) > Math.abs(dx) * 1.4) {
      event.preventDefault()
      event.stopImmediatePropagation()
      navigate(dy > 0 ? 1 : -1)
    }
  }
  const clearDocument = () => {
    observer?.disconnect()
    observer = undefined
    frameDocument?.removeEventListener('keydown', onKeydown, true)
    frameDocument?.removeEventListener('wheel', onWheel, true)
    frameDocument?.removeEventListener('touchstart', onTouchStart, true)
    frameDocument?.removeEventListener('touchend', onTouchEnd, true)
    unbindMedia()
    markedPath.forEach(element => element.classList.remove(pathClass))
    markedPath = []
    player?.classList.remove(playerClass)
    frameDocument?.documentElement.classList.remove(frameClass)
    style?.remove()
    style = undefined
    media = undefined
    player = undefined
    frameDocument = undefined
  }
  const scan = () => {
    scanQueued = false
    if (disposed || !frameDocument || !correctVideo()) {
      return
    }
    const nextPlayer = frameDocument.querySelector<HTMLElement>(playerSelector)
    if (!nextPlayer) {
      return
    }
    if (nextPlayer !== player) {
      player?.classList.remove(playerClass)
      player = nextPlayer
      emit({ ready: true })
    }
    // A framework may retain the same player element while replacing its class or
    // parent wrapper during startup. Reconcile the path even when identity is unchanged.
    player.classList.add(playerClass)
    const nextPath: HTMLElement[] = []
    for (let ancestor = player.parentElement; ancestor && ancestor !== frameDocument.body; ancestor = ancestor.parentElement) {
      nextPath.push(ancestor)
      ancestor.classList.add(pathClass)
    }
    markedPath.forEach(element => {
      if (!nextPath.includes(element)) {
        element.classList.remove(pathClass)
      }
    })
    markedPath = nextPath
    // BWP can retain a native video element as an implementation detail. Its public
    // custom element is the active media API, matching the shared player agent.
    const nextMedia = player.querySelector<HTMLVideoElement>(bwpMediaSelector) ||
      player.querySelector<HTMLVideoElement>(videoMediaSelector)
    if (nextMedia && nextMedia !== media) {
      unbindMedia()
      media = nextMedia
      mediaAttempted = false
      mediaEvents.forEach(([name, handler]) => media.addEventListener(name, handler))
      if (media.readyState >= 1 || (media.tagName.toLowerCase() === 'bwp-video' && media.duration > 0)) {
        autoplay()
      }
    }
  }
  const queueScan = () => {
    if (!scanQueued && !disposed) {
      scanQueued = true
      Promise.resolve().then(scan)
    }
  }
  const connectDocument = () => {
    if (disposed || stopped) {
      return
    }
    try {
      const nextDocument = iframe.contentDocument
      if (!nextDocument?.body || !nextDocument.head || nextDocument.URL === 'about:blank') {
        return
      }
      if (nextDocument !== frameDocument) {
        const resumeAfterDocumentChange = wantsPlayback
        if (frameDocument) {
          pause()
        }
        clearDocument()
        wantsPlayback = resumeAfterDocumentChange
        frameDocument = nextDocument
        if (!correctVideo()) {
          return
        }
        frameDocument.addEventListener('keydown', onKeydown, true)
        frameDocument.addEventListener('wheel', onWheel, { capture: true, passive: false })
        frameDocument.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
        frameDocument.addEventListener('touchend', onTouchEnd, { capture: true, passive: false })
        ;[observer] = childListSubtree(frameDocument.body, queueScan)
      }
      frameDocument.documentElement.classList.add(frameClass)
      if (!style?.isConnected) {
        style = addStyle(nativePlayerStyle, '', frameDocument.head)
      }
      scan()
    } catch {
      stop('播放器页面未能在当前窗口打开，请使用原页播放。')
    }
  }
  iframe.addEventListener('load', connectDocument)
  const poll = window.setInterval(connectDocument, 300)
  const startupTimeout = window.setTimeout(() => {
    if (!disposed && !media) {
      stop('原生播放器加载超时，请重试或打开原页。')
    }
  }, 25000)
  if (/^BV[0-9A-Za-z]{10}$/.test(options.bvid)) {
    const url = new URL(`/video/${options.bvid}/`, 'https://www.bilibili.com')
    url.searchParams.set('bilibili_clear_shorts', '1')
    url.searchParams.set('autoplay', '1')
    if (iframe.getAttribute('src') !== url.href) {
      iframe.src = url.href
    }
    connectDocument()
  } else {
    stop('视频编号无效，请切换下一条。')
  }
  const dispose = () => {
    if (disposed) {
      return
    }
    disposed = true
    pause()
    window.clearInterval(poll)
    window.clearTimeout(startupTimeout)
    window.clearTimeout(playFeedbackTimer)
    iframe.removeEventListener('load', connectDocument)
    clearDocument()
    // Release the previous page's player, requests and native recommendation timers.
    iframe.src = 'about:blank'
  }
  return {
    play,
    pause,
    toggleMute() {
      if (media && correctVideo()) {
        desiredMuted = !(Boolean(media.muted) || media.volume === 0)
        applySound()
        readMediaState()
      }
    },
    dispose,
    destroy: dispose,
  }
}
