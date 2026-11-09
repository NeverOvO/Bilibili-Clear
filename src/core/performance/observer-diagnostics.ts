import { recordRuntimeDiagnostic, runtimeDiagnostics } from './runtime-diagnostics'

let nextId = 0

/** Measure synchronous observer work only; never retain mutation records or DOM nodes. */
export const traceMutationCallback = (
  callback: MutationCallback,
  scope: string,
): MutationCallback => {
  const id = ++nextId
  // Keep generated-script coordinates for source-map lookup, without URLs or page content.
  const source = runtimeDiagnostics.isEnabled()
    ? (new Error().stack || '')
        .split('\n')
        .slice(1, 6)
        .map(line => line.match(/:(\d+):(\d+)\)?$/)?.[0].replace(/\)$/, '') || '')
        .filter(Boolean)
        .join(',')
    : ''
  let windowStart = 0
  let calls = 0
  let recordsSeen = 0
  let totalMs = 0
  let lastReport = -Infinity
  return function measuredMutation(records, observer) {
    if (!runtimeDiagnostics.isEnabled()) {
      return callback.call(this, records, observer)
    }
    const start = performance.now()
    if (start - windowStart >= 1000) {
      windowStart = start
      calls = 0
      recordsSeen = 0
      totalMs = 0
    }
    calls++
    recordsSeen += records.length
    try {
      return callback.call(this, records, observer)
    } finally {
      const duration = performance.now() - start
      totalMs += duration
      if ((duration >= 50 || calls >= 100 || totalMs >= 200) && start - lastReport >= 5000) {
        lastReport = start
        recordRuntimeDiagnostic(
          'mutation-observer-busy',
          {
            id,
            scope,
            callback: callback.name || 'anonymous',
            source,
            calls,
            records: recordsSeen,
            callbackMs: Math.round(duration),
            totalMs: Math.round(totalMs),
            windowMs: Math.round(performance.now() - windowStart),
          },
          true,
        )
      }
    }
  }
}
