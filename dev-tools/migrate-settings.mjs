#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { migrateSettings, validateSettingsExport } from '../src/core/settings/transfer.mjs'

const usage = `Usage:
  node dev-tools/migrate-settings.mjs --input <settings.json> --output <new-settings.json>

Converts a Bilibili Evolved v2 or HomeFix export to Bilibili Clear's built-in features.
Preserves enabled flags, options and extra extensions without executing embedded code.
Reads the distribution manifest from this checkout. No build or network is required.
The input is unchanged; the output must be a new file in an existing directory.
`

const run = async () => {
  const args = process.argv.slice(2)
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(usage)
    return
  }
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!['--input', '--output'].includes(key) || !value || value.startsWith('--') || values.has(key)) {
      throw new Error('Specify exactly one --input and one --output. Use --help for usage.')
    }
    values.set(key, value)
  }
  if (values.size !== 2) {
    throw new Error('Both --input and --output are required. Use --help for usage.')
  }
  const input = resolve(values.get('--input'))
  const output = resolve(values.get('--output'))
  if (input === output) {
    throw new Error('The input file cannot be overwritten. Choose a new output path.')
  }
  let inputText
  try {
    inputText = await readFile(input, 'utf8')
  } catch {
    throw new Error('Cannot read the input settings file.')
  }
  let parsed
  try {
    parsed = JSON.parse(inputText.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('The input must be a valid JSON settings export.')
  }
  validateSettingsExport(parsed)
  const manifestPath = fileURLToPath(new URL('../src/core/distribution-manifest.json', import.meta.url))
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const converted = migrateSettings(parsed, manifest)
  try {
    await writeFile(output, `${JSON.stringify(converted, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('The output already exists. Choose a new file; existing data was not changed.')
    }
    throw new Error('Cannot create the output file. Choose a writable existing directory.')
  }
  console.log('Created Bilibili Clear settings. Import them after installing Bilibili Clear.')
}

run().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
