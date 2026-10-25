#!/usr/bin/env node

// Convert a local v2 settings export without evaluating its embedded component code.
// Run from any directory:
// node dev-tools/homefix/migrate-settings.mjs --input settings.json --output settings-homefix.json
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const componentRoot = 'registry/dist/components'
const updateRoot =
  'https://raw.githubusercontent.com/NeverOvO/Bilibili-Evolved-HomeFix/master'

const components = [
  {
    name: 'simplifyHome',
    displayName: '简化首页',
    id: 'style/simplify/home',
    addedOptions: {},
  },
  {
    name: 'customNavbar',
    displayName: '自定义顶栏',
    id: 'style/custom-navbar',
    addedOptions: {},
  },
  {
    name: 'removePromotions',
    displayName: '删除广告',
    id: 'utils/remove-promotions',
    addedOptions: {},
  },
  {
    name: 'hideRecommendedLive',
    displayName: '隐藏直播推荐',
    id: 'style/hide/video/recommended-live',
    addedOptions: {
      hideHomeLive: {
        displayName: '隐藏首页直播推荐',
        defaultValue: false,
      },
    },
  },
]

const usage = `Usage:
  node dev-tools/homefix/migrate-settings.mjs --input <settings.json> --output <new-settings.json>

Reads the four homepage component bundles from this checkout's registry/dist.
Updates only components already installed in the input settings export.
Preserves existing component settings and unrelated data, and points repaired
components at this fork for future updates. No code is executed or downloaded.
The input is never changed; the output must be a new file in an existing directory.
Install this fork's userscript core before importing the generated settings file.
`

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const requireRecord = (value, label) => {
  if (!isRecord(value)) {
    throw new Error(`Invalid settings export: ${label} must be an object.`)
  }
  return value
}

const parseArguments = args => {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    return null
  }
  const result = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (
      !['--input', '--output'].includes(key) ||
      !value ||
      value.startsWith('--') ||
      Object.hasOwn(result, key)
    ) {
      throw new Error('Specify exactly one --input file and one --output file. Use --help for usage.')
    }
    result[key] = value
  }
  if (!result['--input'] || !result['--output']) {
    throw new Error('Both --input and --output are required. Use --help for usage.')
  }
  const input = resolve(result['--input'])
  const output = resolve(result['--output'])
  if (input === output) {
    throw new Error('The output must be a new file; the input cannot be overwritten.')
  }
  return { input, output }
}

// webpack/inject-metadata/core-info.ts injects these as string-literal properties.
// Reading only these constrained literals avoids evaluating UMD bundles or settings code.
const readBuildField = (code, key, valuePattern, componentName) => {
  const property = new RegExp(`(?:^|[,{])\\s*["']?${key}["']?\\s*:\\s*(["'])(${valuePattern})\\1`, 'g')
  const values = new Set([...code.matchAll(property)].map(match => match[2]))
  if (values.size !== 1) {
    throw new Error(`Cannot read unambiguous build metadata for ${componentName}. Rebuild its release artifact.`)
  }
  return [...values][0]
}

const readArtifact = async component => {
  const relativePath = `${componentRoot}/${component.id}.js`
  let code
  try {
    code = await readFile(resolve(repositoryRoot, relativePath), 'utf8')
  } catch {
    throw new Error(`Cannot read the release artifact for ${component.name}. Build the homepage components first.`)
  }
  return {
    code,
    url: `${updateRoot}/${relativePath}`,
    commitHash: readBuildField(code, 'commitHash', '[a-f0-9]{40}(?:[a-f0-9]{24})?', component.name),
    coreVersion: readBuildField(code, 'coreVersion', '\\d+(?:\\.\\d+)+', component.name),
  }
}

const migrate = async ({ input, output }) => {
  let inputText
  try {
    inputText = await readFile(input, 'utf8')
  } catch {
    throw new Error('Cannot read the input settings file.')
  }
  let settings
  try {
    settings = JSON.parse(inputText.replace(/^\uFEFF/, ''))
  } catch {
    // Native JSON parse errors may include private input excerpts.
    throw new Error('The input must be a valid JSON settings export.')
  }
  requireRecord(settings, 'root')
  const installed = requireRecord(settings.userComponents, 'userComponents')
  const selected = components.filter(component => Object.hasOwn(installed, component.name))
  if (selected.length === 0) {
    throw new Error('The input has none of the four supported homepage components installed.')
  }
  const builtIns = requireRecord(settings.components, 'components')
  const autoUpdate = requireRecord(builtIns.autoUpdate, 'components.autoUpdate')
  const updateOptions = requireRecord(autoUpdate.options, 'components.autoUpdate.options')
  const updateUrls = updateOptions.urls === undefined
    ? {}
    : requireRecord(updateOptions.urls, 'components.autoUpdate.options.urls')
  const componentUpdates = updateUrls.components === undefined
    ? {}
    : requireRecord(updateUrls.components, 'components.autoUpdate.options.urls.components')

  const artifacts = await Promise.all(selected.map(readArtifact))
  const now = Date.now()
  selected.forEach((component, index) => {
    const record = requireRecord(installed[component.name], component.name)
    const componentSettings = requireRecord(record.settings, `${component.name}.settings`)
    const options = requireRecord(componentSettings.options, `${component.name}.settings.options`)
    const metadata = requireRecord(record.metadata, `${component.name}.metadata`)
    const metadataOptions = metadata.options === undefined
      ? {}
      : requireRecord(metadata.options, `${component.name}.metadata.options`)
    const artifact = artifacts[index]

    record.code = artifact.code
    // Runtime metadata comes from the new bundle. Preserve compatible cached labels,
    // options, tags and extension fields rather than trying to execute that bundle here.
    record.metadata = {
      ...metadata,
      name: component.name,
      displayName: component.displayName,
      commitHash: artifact.commitHash,
      coreVersion: artifact.coreVersion,
    }
    if (Object.keys(component.addedOptions).length > 0) {
      record.metadata.options = { ...metadataOptions, ...component.addedOptions }
      Object.entries(component.addedOptions).forEach(([key, definition]) => {
        if (!Object.hasOwn(options, key)) {
          options[key] = definition.defaultValue
        }
      })
    }

    const existingUpdate = Object.hasOwn(componentUpdates, component.name)
      ? requireRecord(componentUpdates[component.name], `${component.name} update record`)
      : { installTime: now }
    // Match the existing autoUpdate installation hook while retaining installTime.
    componentUpdates[component.name] = {
      ...existingUpdate,
      url: artifact.url,
      lastUpdateCheck: now,
      alwaysUpdate: false,
    }
  })
  updateUrls.components = componentUpdates
  updateOptions.urls = updateUrls

  try {
    await writeFile(output, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('The output already exists. Choose a new filename; no existing file was overwritten.')
    }
    throw new Error('Cannot create the output file. Choose a writable existing directory and a new filename.')
  }
  console.log(`Created migrated settings for ${selected.length} installed homepage components.`)
  console.log('Install the fork userscript core, then import the generated file through the original settings panel.')
}

try {
  const args = parseArguments(process.argv.slice(2))
  if (args === null) {
    console.log(usage)
  } else {
    await migrate(args)
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
