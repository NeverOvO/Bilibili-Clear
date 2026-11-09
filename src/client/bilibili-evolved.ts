import { init } from './init'
import { finishClearHomeBootstrap } from './clear-home-bootstrap'
import { finishHomeStartupDiagnostics, recordHomeStartup } from './clear-home-diagnostics'
import { recordRuntimeDiagnostic } from '@/core/performance/runtime-diagnostics'

init().catch(error => {
  recordRuntimeDiagnostic('startup-failed', {}, true)
  recordHomeStartup('启动失败', error instanceof Error ? error.name : typeof error)
  finishClearHomeBootstrap('启动异常')
  finishHomeStartupDiagnostics()
  console.error('[Bilibili Clear] 启动失败。', error)
})
