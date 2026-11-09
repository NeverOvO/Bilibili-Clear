type DiagnosticDetail = Record<string, string | number | boolean>
interface DiagnosticRecord {
  at: number
  elapsedMs: number
  event: string
  detail: DiagnosticDetail
}
interface DiagnosticSession {
  startedAt: number
  lastHeartbeatAt: number
  lifecycle: string
  page: string
  version: string
  manager: string
  droppedEvents: number
  records: DiagnosticRecord[]
}

const storageKey = 'bilibili-clear:runtime-diagnostics:v1'
const retentionMs = 30 * 24 * 60 * 60 * 1000
const heartbeatMs = 1000
const checkpointMs = 15000
const urgentIntervalMs = 5000
const maxRecords = 120
let started = false
let enabled = true
let storageAvailable = true
let suspended = false
let sessions: DiagnosticSession[] = []
let current: DiagnosticSession | undefined
let timer: number | undefined
let hoverFrame: number | undefined
let lastTick = 0
let lastWrite = 0
let lastHover = -Infinity
let eventWindow = 0
let eventCount = 0

const pageType = () => {
  if (location.hostname === 'www.bilibili.com') {
    if (/^\/(?:index\.html)?$/.test(location.pathname)) {
      return 'home'
    }
    if (location.pathname.startsWith('/video/')) {
      return 'video'
    }
    if (location.pathname.startsWith('/bangumi/')) {
      return 'bangumi'
    }
  }
  if (location.hostname === 't.bilibili.com') {
    return 'feeds'
  }
  if (location.hostname === 'live.bilibili.com') {
    return 'live'
  }
  if (location.hostname === 'space.bilibili.com') {
    return 'space'
  }
  return 'other'
}

const compactDetail = (detail: DiagnosticDetail): DiagnosticDetail => {
  const result: DiagnosticDetail = {}
  Object.entries(detail)
    .slice(0, 10)
    .forEach(([key, value]) => {
      if (typeof value === 'string') {
        result[key.slice(0, 40)] = value.slice(0, 160)
      } else if (
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
      ) {
        result[key.slice(0, 40)] = value
      }
    })
  return result
}

const prune = () => {
  const cutoff = Date.now() - retentionMs
  sessions = sessions
    .filter(session => session === current || session.startedAt >= cutoff)
    .slice(-3)
}

const persist = (force = false, urgent = false) => {
  if (!storageAvailable) {
    return
  }
  const now = Date.now()
  if (!force && now - lastWrite < (urgent ? urgentIntervalMs : checkpointMs)) {
    return
  }
  lastWrite = now
  try {
    prune()
    sessionStorage.setItem(storageKey, JSON.stringify({ schemaVersion: 1, enabled, sessions }))
  } catch {
    // Storage can be denied or full; diagnostics must never block the main script.
    storageAvailable = false
  }
}

/** Only fixed labels, booleans and timings belong here; never pass page content or URLs. */
export const recordRuntimeDiagnostic = (
  event: string,
  detail: DiagnosticDetail = {},
  urgent = false,
) => {
  if (!started || !enabled || !current) {
    return
  }
  try {
    const now = Date.now()
    if (now - eventWindow >= 5000) {
      eventWindow = now
      eventCount = 0
    }
    // Bound allocations as well as storage writes during error or observer storms.
    const interaction = event === 'watchlater-hover' || event === 'watchlater-focus'
    if (eventCount >= 20 && !interaction) {
      current.droppedEvents += 1
      return
    }
    eventCount += 1
    if (current.records.length >= maxRecords) {
      current.records.splice(1, 1)
      current.droppedEvents += 1
    }
    current.records.push({
      at: now,
      elapsedMs: Math.round(performance.now()),
      event: event.slice(0, 80),
      detail: compactDetail(detail),
    })
    if (urgent) {
      persist(false, true)
    }
  } catch {
    // Instrumentation is best-effort and must not change callback behavior.
  }
}

const stopTimer = () => {
  window.clearTimeout(timer)
  timer = undefined
  if (hoverFrame !== undefined) {
    window.cancelAnimationFrame(hoverFrame)
    hoverFrame = undefined
  }
}

const tick = () => {
  timer = undefined
  if (!enabled || suspended || document.hidden || !current) {
    return
  }
  const now = performance.now()
  const delayMs = Math.round(now - lastTick - heartbeatMs)
  current.lastHeartbeatAt = Date.now()
  current.page = pageType()
  if (delayMs >= 1500) {
    // A delayed timer is evidence of a stall or suspension, not attribution to this script.
    recordRuntimeDiagnostic('foreground-heartbeat-delay', { delayMs }, true)
  }
  lastTick = now
  persist()
  timer = window.setTimeout(tick, heartbeatMs)
}

const startTimer = () => {
  stopTimer()
  lastTick = performance.now()
  if (enabled && !suspended && !document.hidden) {
    timer = window.setTimeout(tick, heartbeatMs)
  }
}

const beginSession = () => {
  let version = 'unknown'
  let manager = 'unknown'
  try {
    if (typeof GM_info !== 'undefined') {
      version = String(GM_info.script?.version || version).slice(0, 40)
      manager = String(GM_info.scriptHandler || manager).slice(0, 60)
    }
  } catch {
    // Script manager metadata is optional.
  }
  current = {
    startedAt: Date.now(),
    lastHeartbeatAt: Date.now(),
    lifecycle: document.hidden ? 'hidden' : 'active',
    page: pageType(),
    version,
    manager,
    droppedEvents: 0,
    records: [],
  }
  sessions.push(current)
  eventWindow = 0
  eventCount = 0
  recordRuntimeDiagnostic('session-start', { visible: !document.hidden })
  persist(true)
  startTimer()
}

const readStorage = () => {
  try {
    const raw = sessionStorage.getItem(storageKey)
    if (!raw || raw.length > 1000000) {
      return
    }
    const saved = JSON.parse(raw)
    if (saved?.schemaVersion !== 1 || !Array.isArray(saved.sessions)) {
      return
    }
    enabled = saved.enabled !== false
    sessions = saved.sessions
      .slice(-3)
      .filter(
        session =>
          Number.isFinite(session?.startedAt) &&
          session.startedAt >= Date.now() - retentionMs &&
          Array.isArray(session.records),
      )
      .map(session => ({
        startedAt: session.startedAt,
        lastHeartbeatAt: Number(session.lastHeartbeatAt) || session.startedAt,
        lifecycle: String(session.lifecycle).slice(0, 30),
        page: String(session.page).slice(0, 30),
        version: String(session.version).slice(0, 40),
        manager: String(session.manager).slice(0, 60),
        droppedEvents: Number(session.droppedEvents) || 0,
        records: session.records
          .slice(-maxRecords)
          .filter(record => Number.isFinite(record?.at) && typeof record.event === 'string')
          .map(record => ({
            at: record.at,
            elapsedMs: Number(record.elapsedMs) || 0,
            event: record.event.slice(0, 80),
            detail: compactDetail(record.detail || {}),
          })),
      }))
  } catch {
    storageAvailable = false
  }
}

const onVisibilityChange = () => {
  if (enabled && current) {
    current.lifecycle = document.hidden ? 'hidden' : 'active'
    recordRuntimeDiagnostic('visibility-change', { visible: !document.hidden })
    persist(false, true)
  }
  // Background throttling must not be counted as a foreground freeze.
  startTimer()
}

const onPageHide = (event: PageTransitionEvent) => {
  suspended = true
  stopTimer()
  if (enabled && current) {
    current.lifecycle = event.persisted ? 'bfcache' : 'pagehide'
    recordRuntimeDiagnostic('pagehide', { persisted: event.persisted })
    persist(true)
  }
}

const onPageShow = (event: PageTransitionEvent) => {
  suspended = false
  if (enabled && current && event.persisted) {
    current.lifecycle = document.hidden ? 'hidden' : 'active'
    recordRuntimeDiagnostic('bfcache-resume')
    persist(true)
  }
  startTimer()
}

const errorType = (value: unknown) => {
  const name = value instanceof Error ? value.name : typeof value
  return [
    'Error',
    'TypeError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'URIError',
    'EvalError',
  ].includes(name)
    ? name
    : 'other'
}
const onError = (event: ErrorEvent) => {
  recordRuntimeDiagnostic('page-error', { type: errorType(event.error) }, true)
}
const onRejection = (event: PromiseRejectionEvent) => {
  recordRuntimeDiagnostic('page-unhandled-rejection', { type: errorType(event.reason) }, true)
}

const onWatchlaterHover = (event: PointerEvent | FocusEvent) => {
  if (!enabled || suspended || document.hidden || hoverFrame !== undefined) {
    return
  }
  const now = performance.now()
  if (now - lastHover < urgentIntervalMs || !(event.target instanceof Element)) {
    return
  }
  const button = event.target.closest('.clear-video-watchlater')
  if (!button || (event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) {
    return
  }
  lastHover = now
  recordRuntimeDiagnostic(
    event.type === 'focusin' ? 'watchlater-focus' : 'watchlater-hover',
    { queued: button.classList.contains('is-queued'), disabled: button.hasAttribute('disabled') },
  )
  // This interaction has its own 5 s limit, including immediately after startup.
  persist(true)
  // A pair of rAF callbacks records a rendering opportunity, not a successful paint.
  hoverFrame = window.requestAnimationFrame(() => {
    hoverFrame = window.requestAnimationFrame(() => {
      hoverFrame = undefined
      recordRuntimeDiagnostic('watchlater-frame-opportunity', {
        elapsedMs: Math.round(performance.now() - now),
      })
    })
  })
}

const exportDiagnostics = () => {
  prune()
  return JSON.stringify(
    {
      schemaVersion: 1,
      exportedAt: Date.now(),
      enabled,
      storageAvailable,
      scope: 'This tab and origin only; latest three sessions, up to 120 events each.',
      interpretation:
        'A missing pagehide or frame callback does not prove a crash. Heartbeat delays may also reflect device sleep or browser suspension. Page errors are not necessarily caused by Bilibili Clear.',
      sessions,
    },
    null,
    2,
  )
}

const download = () => {
  const url = URL.createObjectURL(new Blob([exportDiagnostics()], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `bilibili-clear-diagnostics-${Date.now()}.json`
  try {
    anchor.click()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
}

const clear = () => {
  sessions = []
  current = undefined
  if (enabled) {
    beginSession()
  } else {
    persist(true)
  }
}

const setEnabled = (value: boolean) => {
  if (enabled === value) {
    return
  }
  if (!value) {
    recordRuntimeDiagnostic('diagnostics-disabled')
    if (current) {
      current.lifecycle = 'disabled'
    }
  }
  enabled = value
  if (enabled && started) {
    beginSession()
  } else {
    stopTimer()
    persist(true)
  }
}

export const runtimeDiagnostics = {
  export: exportDiagnostics,
  download,
  clear,
  setEnabled,
  isEnabled: () => started && enabled,
}

export const startRuntimeDiagnostics = () => {
  if (started || window.top !== window.self) {
    return
  }
  try {
    started = true
    readStorage()
    if (enabled) {
      beginSession()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    document.addEventListener('pointerover', onWatchlaterHover, { capture: true, passive: true })
    document.addEventListener('focusin', onWatchlaterHover, { capture: true, passive: true })
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('导出卡顿诊断日志', download)
      GM_registerMenuCommand('清空卡顿诊断日志', clear)
      GM_registerMenuCommand('开启／关闭卡顿诊断', () => {
        setEnabled(!enabled)
        window.alert(`卡顿诊断已${enabled ? '开启' : '关闭'}。`)
      })
    }
  } catch {
    // Unsupported menu or browser APIs must not interrupt userscript startup.
  }
}
