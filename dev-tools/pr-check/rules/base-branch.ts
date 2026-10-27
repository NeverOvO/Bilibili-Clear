import { CheckRule } from '../types'

const allowedBaseRefs = ['master']

export const baseBranchRule: CheckRule = {
  name: 'base-branch',
  check: ({ baseRef }) => {
    if (!baseRef || allowedBaseRefs.includes(baseRef)) {
      return {}
    }
    return {
      errors: [`pull request base branch must be master, got ${baseRef}.`],
    }
  },
}
