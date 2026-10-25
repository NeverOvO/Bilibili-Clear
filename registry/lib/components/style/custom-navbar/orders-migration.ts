import { getComponentSettings } from '@/core/settings'
import type { CustomNavbarOptions } from '.'

const migrations: [string, string][] = [
  ['gamesIframe', 'games'],
  ['livesIframe', 'lives'],
  ['mangaIframe', 'manga'],
]

/** Preserve existing preferences when built-in navbar item IDs change. */
export const migrateOrders = () => {
  const { options } = getComponentSettings<CustomNavbarOptions>('customNavbar')
  const names = new Map(migrations)
  const hidden = [...new Set(options.hidden.map(name => names.get(name) ?? name))]
  if (!lodash.isEqual(hidden, options.hidden)) {
    options.hidden = hidden
  }
  migrations.forEach(([from, to]) => {
    ;[options.order, options.openInNewTabOverrides].forEach(record => {
      if (Object.prototype.hasOwnProperty.call(record, from)) {
        if (!Object.prototype.hasOwnProperty.call(record, to)) {
          record[to] = record[from]
        }
        delete record[from]
      }
    })
  })
}
