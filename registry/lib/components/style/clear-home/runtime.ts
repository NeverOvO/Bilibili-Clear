import { createProgressStore } from './progress'

let store: ReturnType<typeof createProgressStore> | undefined
export const getProgressStore = () => {
  if (!store) {
    store = createProgressStore()
  }
  return store
}
export const releaseProgressStore = () => {
  store?.dispose()
  store = undefined
}
