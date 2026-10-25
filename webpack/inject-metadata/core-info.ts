import { objectProperty, identifier, stringLiteral } from '@babel/types'
import manifest from '../../src/core/distribution-manifest.json'
import { commitHash } from '../compilation-info/git'
import { InjectMetadataAction } from './types'

export const injectCoreInfo: InjectMetadataAction = () => [
  objectProperty(identifier('commitHash'), stringLiteral(commitHash)),
  objectProperty(identifier('coreVersion'), stringLiteral(manifest.compatibilityVersion)),
]
