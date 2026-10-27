import { getUID } from '@/core/utils'
import { getJson } from '@/core/ajax'
import { LaunchBarAction, LaunchBarActionProvider } from './launch-bar-action'
import { addHistoryItem } from './history-provider'

export const search = (keyword: string) => {
  if (!keyword) {
    return
  }
  addHistoryItem(keyword).catch(error => console.warn('搜索历史暂时无法保存', error))
  const params = {
    keyword,
    from_source: 'nav_suggest_new',
  }
  window.open(
    `https://search.bilibili.com/all?${new URLSearchParams(params)}`,
    '_blank',
    'noopener',
  )
}
export const searchProvider: LaunchBarActionProvider = {
  name: 'search',
  getActions: async input => {
    const api = `https://s.search.bilibili.com/main/suggest?func=suggest&suggest_type=accurate&sub_type=tag&main_ver=v1&highlight=&userid=${getUID()}&bangumi_acc_num=1&special_acc_num=1&topic_acc_num=1&upuser_acc_num=3&tag_num=10&special_num=10&bangumi_num=10&upuser_num=3&term=${encodeURIComponent(
      input,
    )}`
    const results: LaunchBarAction[] = [
      {
        name: input,
        icon: 'search',
        content: async () =>
          Vue.extend({
            render: h => {
              const content = h(
                'div',
                {
                  class: 'suggest-highlight',
                },
                [input],
              )
              return content
            },
          }),
        action: () => search(input),
      },
    ]
    let json: any
    try {
      json = await getJson(api)
    } catch {
      // Direct keyword search remains available if online suggestions fail.
      return results
    }
    if (json?.code !== 0) {
      return results
    }
    const suggests: unknown = lodash.get(json, 'result.tag')
    if (!Array.isArray(suggests)) {
      return results
    }
    results.push(
      ...suggests
        .filter(result => typeof result?.value === 'string' && result.value.trim())
        .map(
          (result): LaunchBarAction => ({
            name: `${input}.${result.value}`,
            icon: 'search',
            suggestName: result.value,
            content: async () =>
              Vue.extend({
                render: h => {
                  // API-provided HTML is untrusted. Recreate highlights from plain text.
                  const { value } = result
                  const start = value.toLowerCase().indexOf(input.toLowerCase())
                  return h(
                    'div',
                    start < 0 || !input
                      ? [value]
                      : [
                          value.slice(0, start),
                          h('span', { class: 'suggest-highlight' }, [
                            value.slice(start, start + input.length),
                          ]),
                          value.slice(start + input.length),
                        ],
                  )
                },
              }),
            action: () => search(result.value),
          }),
        ),
    )
    return lodash.uniqBy(results, it => it.name)
  },
}
