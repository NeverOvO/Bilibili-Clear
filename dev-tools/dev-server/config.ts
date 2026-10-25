import { readFileSync, existsSync } from 'fs'

interface DevServerConfig {
  port?: number
  maxWatchers?: number
}
const configFile = (path: string) => () =>
  existsSync(path) ? JSON.parse(readFileSync(path, { encoding: 'utf-8' })) : {}
const configSource: (() => DevServerConfig)[] = [
  () => ({
    port: 23333,
    maxWatchers: 16,
  }),
  configFile('dev/dev-server.json'),
]
export const devServerConfig = configSource.reduce(
  (previous, current) => ({ ...previous, ...current() }),
  {} as DevServerConfig,
)
if (
  !Number.isInteger(devServerConfig.port) ||
  devServerConfig.port < 1024 ||
  devServerConfig.port > 65535
) {
  throw new Error('DevServer port 必须为 1024 到 65535 的整数')
}
if (
  !Number.isInteger(devServerConfig.maxWatchers) ||
  devServerConfig.maxWatchers < 1 ||
  devServerConfig.maxWatchers > 64
) {
  throw new Error('DevServer maxWatchers 必须为 1 到 64 的整数')
}
