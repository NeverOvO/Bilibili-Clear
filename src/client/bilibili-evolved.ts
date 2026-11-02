import { init } from './init'
import { finishClearHomeBootstrap } from './clear-home-bootstrap'

init().catch(error => {
  finishClearHomeBootstrap()
  console.error('[Bilibili Clear] 启动失败。', error)
})
