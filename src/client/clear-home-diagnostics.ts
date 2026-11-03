import diagnosticsStyle from './clear-home-diagnostics.scss'

type StartupRecord = { at: number; state: string; event: string; detail: string }
const records: StartupRecord[] = []
const rows = new Map<StartupRecord, HTMLLIElement>()
const paintTimes = new Map<string, number>()
const frameHandles = new Set<number>()
let started = false
let closed = false
let entryAt = 0
let version = '未知版本'
let manager = '未知管理器'
let host: HTMLDivElement | undefined
let list: HTMLOListElement | undefined
let summary: HTMLParagraphElement | undefined
let manualCopy: HTMLTextAreaElement | undefined
let renderFrame: number | undefined
let rootRetry: number | undefined
let mountTimer: number | undefined
let deadline: number | undefined
let finishTimer: number | undefined
let paintObserver: PerformanceObserver | undefined
let guardFrameState: 'waiting' | 'connected' | 'removed' | undefined
let capped = false

const onHome = () =>
  window.top === window.self &&
  location.hostname === 'www.bilibili.com' &&
  /^\/(?:index\.html)?$/.test(location.pathname)
const stateLabel = () =>
  ({ loading: '解析中', interactive: 'DOM 就绪', complete: '加载完成' }[document.readyState])
const shortText = (value: string, limit: number) => value.slice(0, limit)
const timeLabel = (at: number) => `${at.toFixed(1)} ms`

const summaryText = () => {
  const fcp = paintTimes.get('first-contentful-paint')
  let paintSummary = '尚无首屏内容绘制时间，不能据此判断注入早晚。'
  if (fcp !== undefined) {
    paintSummary =
      fcp < entryAt
        ? `首屏内容绘制早于脚本入口 ${timeLabel(entryAt - fcp)}；该数据不识别画面内容。`
        : '脚本入口早于首屏内容绘制；该数据不能证明原版画面从未出现。'
  }
  const lines = [paintSummary]
  if (guardFrameState === 'removed') {
    lines.push('首次绘制机会到来时，遮罩已被移除。')
  } else if (guardFrameState === 'connected') {
    lines.push('遮罩曾保留到绘制机会，是否实际显示仍需结合你的观察。')
  }
  return lines.join(' ')
}

const serialize = () => {
  return [
    `Bilibili Clear 启动诊断 ${version}`,
    `管理器：${manager}`,
    '时间以本次页面导航开始为零点；入口时间包含注入前等待，不能单独区分管理器与脚本解析耗时。',
    summaryText(),
    ...[...records]
      .sort((left, right) => left.at - right.at)
      .map(
        item =>
          `${timeLabel(item.at)} [${item.state}] ${item.event}${
            item.detail ? ` | ${item.detail}` : ''
          }`,
      ),
    ...(capped ? ['日志已达到 100 条上限，后续条目未记录。'] : []),
  ].join('\n')
}

const render = () => {
  renderFrame = undefined
  if (closed || !list || !summary) {
    return
  }
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 36
  const fragment = document.createDocumentFragment()
  for (const item of [...records].sort((left, right) => left.at - right.at)) {
    let row = rows.get(item)
    if (!row) {
      row = document.createElement('li')
      const time = document.createElement('time')
      time.textContent = timeLabel(item.at)
      const content = document.createElement('div')
      const label = document.createElement('strong')
      label.textContent = item.event
      const detail = document.createElement('span')
      detail.textContent = `${item.state}${item.detail ? ` · ${item.detail}` : ''}`
      content.append(label, detail)
      row.append(time, content)
      rows.set(item, row)
    }
    fragment.appendChild(row)
  }
  list.appendChild(fragment)
  summary.textContent = summaryText()
  if (manualCopy && !manualCopy.hidden) {
    manualCopy.value = serialize()
  }
  if (atBottom) {
    list.scrollTop = list.scrollHeight
  }
}
const scheduleRender = () => {
  if (!closed && host && renderFrame === undefined) {
    renderFrame = window.requestAnimationFrame(() => {
      try {
        render()
      } catch {
        renderFrame = undefined
      }
    })
  }
}

/** Only pass fixed stage names, booleans and timings; never pass settings or request data. */
export const recordHomeStartup = (event: string, detail = '') => {
  if (!started || closed) {
    return
  }
  try {
    if (records.length >= 100) {
      capped = true
      return
    }
    records.push({
      at: performance.now(),
      state: stateLabel(),
      event: shortText(event, 80),
      detail: shortText(detail, 240),
    })
    scheduleRender()
  } catch {
    // Diagnostics must never change whether the main script can start.
  }
}

const onContentLoaded = () => recordHomeStartup('DOMContentLoaded 事件')
const onLoaded = () => recordHomeStartup('load 事件')
const stopObserving = () => {
  window.clearTimeout(deadline)
  window.clearTimeout(finishTimer)
  deadline = undefined
  finishTimer = undefined
  paintObserver?.disconnect()
  paintObserver = undefined
  frameHandles.forEach(handle => window.cancelAnimationFrame(handle))
  frameHandles.clear()
  document.removeEventListener('DOMContentLoaded', onContentLoaded)
  window.removeEventListener('load', onLoaded)
}
const close = () => {
  closed = true
  stopObserving()
  window.clearTimeout(rootRetry)
  window.clearTimeout(mountTimer)
  if (renderFrame !== undefined) {
    window.cancelAnimationFrame(renderFrame)
    renderFrame = undefined
  }
  host?.remove()
  host = undefined
  list = undefined
  summary = undefined
  manualCopy = undefined
  rows.clear()
}

const mount = (attempt = 0) => {
  if (closed) {
    return
  }
  try {
    if (!document.documentElement) {
      if (attempt < 120) {
        rootRetry = window.setTimeout(() => mount(attempt + 1), 16)
      }
      return
    }
    host = document.createElement('div')
    host.id = 'bilibili-clear-startup-diagnostics'
    const shadow = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = diagnosticsStyle
    const panel = document.createElement('section')
    panel.className = 'startup-panel'
    panel.setAttribute('aria-label', 'Bilibili Clear 启动诊断')
    const header = document.createElement('header')
    const heading = document.createElement('strong')
    heading.textContent = '启动诊断'
    const meta = document.createElement('span')
    meta.className = 'version'
    meta.textContent = version
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.textContent = '收起'
    toggle.setAttribute('aria-expanded', 'true')
    const dismiss = document.createElement('button')
    dismiss.type = 'button'
    dismiss.textContent = '关闭'
    dismiss.addEventListener('click', close)
    header.append(heading, meta, toggle, dismiss)
    const body = document.createElement('div')
    body.className = 'panel-body'
    summary = document.createElement('p')
    summary.className = 'summary'
    list = document.createElement('ol')
    list.setAttribute('aria-label', '启动时间线')
    const footer = document.createElement('footer')
    const note = document.createElement('p')
    note.textContent =
      '时间从页面导航起算；入口时间不能单独区分注入等待与脚本解析。日志仅保留在本页。'
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'copy-button'
    copy.textContent = '复制日志'
    manualCopy = document.createElement('textarea')
    manualCopy.readOnly = true
    manualCopy.hidden = true
    manualCopy.setAttribute('aria-label', '复制失败，可选择并手动复制以下启动日志')
    copy.addEventListener('click', async () => {
      copy.disabled = true
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error('Clipboard unavailable')
        }
        await navigator.clipboard.writeText(serialize())
        copy.textContent = '已复制'
      } catch {
        if (!closed && manualCopy) {
          manualCopy.hidden = false
          manualCopy.value = serialize()
          manualCopy.focus()
          manualCopy.select()
          copy.textContent = '请在下方手动复制'
        }
      } finally {
        copy.disabled = false
      }
    })
    toggle.addEventListener('click', () => {
      body.hidden = !body.hidden
      toggle.textContent = body.hidden ? '展开' : '收起'
      toggle.setAttribute('aria-expanded', String(!body.hidden))
    })
    footer.append(note, copy, manualCopy)
    body.append(summary, list, footer)
    panel.append(header, body)
    shadow.append(style, panel)
    document.documentElement.appendChild(host)
    render()
  } catch {
    // A missing Shadow DOM or a blocked insertion must not interrupt the userscript.
    host?.remove()
    host = undefined
  }
}

const recordPaint = (entry: PerformanceEntry) => {
  if (
    !started ||
    closed ||
    !['first-paint', 'first-contentful-paint'].includes(entry.name) ||
    paintTimes.has(entry.name)
  ) {
    return
  }
  paintTimes.set(entry.name, entry.startTime)
  if (records.length >= 100) {
    capped = true
    return
  }
  // Buffered entries can predate script startup. Keep the actual browser timestamp.
  records.push({
    at: entry.startTime,
    state: '浏览器时间条目，DOM 状态未知',
    event: entry.name,
    detail: '绘制时间不识别画面内容',
  })
  scheduleRender()
}

/** The compiled branch controls collection and UI; release builds never start diagnostics. */
export const startHomeStartupDiagnostics = () => {
  if (webpackGitInfo.branch !== 'beta' || started) {
    return
  }
  try {
    if (!onHome()) {
      return
    }
    started = true
    entryAt = performance.now()
    try {
      if (typeof GM_info !== 'undefined') {
        version = shortText(String(GM_info.script?.version || version), 32)
        manager = shortText(String(GM_info.scriptHandler || manager), 60)
      }
    } catch {
      // GM metadata is optional; stage collection does not need it.
    }
    recordHomeStartup(
      '脚本入口',
      `head=${Boolean(document.head)}，body=${Boolean(document.body)}，原版容器存在=${Boolean(
        document.querySelector('#i_cecream, .bili-feed4'),
      )}（不代表可见），管理器=${manager}`,
    )
    for (const entry of performance.getEntriesByType('paint')) {
      recordPaint(entry)
    }
    const navigation = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    if (navigation?.domContentLoadedEventStart) {
      recordHomeStartup(
        '已有 DOMContentLoaded 时间',
        timeLabel(navigation.domContentLoadedEventStart),
      )
    }
    if (navigation?.loadEventStart) {
      recordHomeStartup('已有 load 时间', timeLabel(navigation.loadEventStart))
    }
    document.addEventListener('DOMContentLoaded', onContentLoaded, { once: true })
    window.addEventListener('load', onLoaded, { once: true })
    try {
      if (
        typeof PerformanceObserver !== 'undefined' &&
        PerformanceObserver.supportedEntryTypes?.includes('paint')
      ) {
        paintObserver = new PerformanceObserver(entries => {
          try {
            entries.getEntries().forEach(recordPaint)
          } catch {
            // Browser instrumentation is best-effort.
          }
        })
        paintObserver.observe({ type: 'paint', buffered: true })
      } else {
        recordHomeStartup('绘制监听不可用', '保留现有浏览器时间条目与启动阶段日志')
      }
    } catch {
      recordHomeStartup('绘制监听不可用', '浏览器拒绝 paint 监听')
    }
    deadline = window.setTimeout(() => {
      recordHomeStartup('被动采集结束', '已到 15 秒采集上限；后续主动启动日志仍保留')
      stopObserving()
    }, 15000)
    // Leave the first task to the startup guard; render the diagnostic UI afterwards.
    mountTimer = window.setTimeout(() => mount(), 0)
  } catch {
    // This temporary diagnostic module must always fail open.
  }
}

/** rAF offers a rendering opportunity, not proof that the user saw the overlay. */
export const recordHomeGuardFrame = (overlay: HTMLElement) => {
  if (!started || closed) {
    return
  }
  recordHomeStartup('遮罩 DOM 已挂载', `connected=${overlay.isConnected}`)
  guardFrameState = 'waiting'
  const next = (index: number) => {
    const handle = window.requestAnimationFrame(() => {
      frameHandles.delete(handle)
      if (closed) {
        return
      }
      try {
        if (!overlay.isConnected) {
          if (index === 1) {
            guardFrameState = 'removed'
          }
          recordHomeStartup(`遮罩绘制机会 ${index}`, '遮罩已被移除；不能证明它曾实际显示')
        } else {
          guardFrameState = 'connected'
          const rect = overlay.getBoundingClientRect()
          const css = window.getComputedStyle(overlay)
          const center = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
          recordHomeStartup(
            `遮罩绘制机会 ${index}`,
            `${Math.round(rect.width)}×${Math.round(rect.height)}，display=${
              css.display
            }，visibility=${css.visibility}，opacity=${css.opacity}，中心命中遮罩=${Boolean(
              center && overlay.contains(center),
            )}`,
          )
        }
        if (index < 2) {
          next(index + 1)
        }
      } catch {
        recordHomeStartup(`遮罩绘制机会 ${index}`, '无法读取布局状态')
      }
    })
    frameHandles.add(handle)
  }
  try {
    next(1)
  } catch {
    recordHomeStartup('遮罩绘制机会不可用')
  }
}

/** Stop passive observers shortly after handoff; the panel and explicit stage logs remain. */
export const finishHomeStartupDiagnostics = () => {
  if (!started || closed || finishTimer !== undefined) {
    return
  }
  try {
    finishTimer = window.setTimeout(() => {
      recordHomeStartup('被动采集结束', '首页交接后结束浏览器事件监听；本页日志仍可复制')
      stopObserving()
    }, 1000)
  } catch {
    // Diagnostics must never block the handoff.
  }
}
