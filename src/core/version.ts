import { FeatureBase } from '@/components/types'
import { loadFeatureCode } from './external-input'
import manifest from './distribution-manifest.json'
import { useScopedConsole } from './utils/log'

export enum CompareResult {
  Less = -1,
  Equal = 0,
  Greater = 1,
  Incomparable = NaN,
}
export class Version {
  parts: number[]
  constructor(public versionString: string) {
    if (!/^\d+(?:\.\d+)*$/.test(versionString)) {
      throw new Error('Invalid version string')
    }
    this.parts = versionString.split('.').map(Number)
    if (this.parts.some(part => !Number.isSafeInteger(part))) {
      throw new Error('Invalid version segment')
    }
  }
  compareTo(other: Version) {
    const length = Math.max(this.parts.length, other.parts.length)
    for (let i = 0; i < length; ++i) {
      const current = this.parts[i] ?? 0
      const compared = other.parts[i] ?? 0
      if (current > compared) {
        return CompareResult.Greater
      }
      if (current < compared) {
        return CompareResult.Less
      }
    }
    return CompareResult.Equal
  }
  greaterThan(other: Version) {
    return this.compareTo(other) === CompareResult.Greater
  }
  lessThan(other: Version) {
    return this.compareTo(other) === CompareResult.Less
  }
  equals(other: Version) {
    return this.compareTo(other) === CompareResult.Equal
  }
}
/**
 * 检测功能版本是否能够在当前本体运行
 * @param feature 功能的 Metadata 对象
 */
export const isFeatureAcceptable = async (feature: FeatureBase | string) => {
  try {
    const console = useScopedConsole('isFeatureAcceptable')
    if (typeof feature === 'string') {
      feature = loadFeatureCode(feature) as FeatureBase
    }
    // 无效代码
    if (feature === null || feature === undefined) {
      return false
    }
    const currentVersionText = manifest.compatibilityVersion
    const { coreVersion: requiredVersionText } = feature
    console.log('currentVersion =', currentVersionText, ', requiredVersion =', requiredVersionText)
    // 没有版本信息, 按旧版行为默认通过检测
    if (requiredVersionText === undefined) {
      return true
    }
    if (typeof requiredVersionText !== 'string') {
      return false
    }
    const currentVersion = new Version(currentVersionText)
    const requiredVersion = new Version(requiredVersionText)
    return currentVersion.equals(requiredVersion) || currentVersion.greaterThan(requiredVersion)
  } catch (error) {
    console.warn('check failed, feature =', feature)
    // Invalid compatibility metadata must not bypass the installation boundary.
    return false
  }
}
