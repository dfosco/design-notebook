#!/usr/bin/env node
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildNotebook, createNotebookRuntime } from '../src/core/runtime/index.js'
import { publishNotebook } from '../src/core/publisher/index.js'

function argumentsOf(argv) {
  const [command, ...values] = argv
  const options = {
    command: command === '--help' || command === '-h' ? 'help' : command,
    help: command === '--help' || command === '-h',
    root: process.cwd(),
    base: '/',
  }
  let positional = false
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--') continue
    if (value === '--help' || value === '-h') options.help = true
    else if (value === '--base') options.base = values[++index]
    else if (value === '--host') options.host = values[++index]
    else if (value === '--port') options.port = Number(values[++index])
    else if (value === '--out-dir') options.outDir = values[++index]
    else if (value.startsWith('--')) throw new Error(`Unknown option: ${value}`)
    else if (!positional) { options.root = path.resolve(value); positional = true }
    else throw new Error(`Unexpected argument: ${value}`)
  }
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) {
    throw new TypeError('--port must be an integer from 0 to 65535.')
  }
  return options
}

function help() {
  return `Design Notebook first-look runtime

Usage:
  npm run dev -- [notebook-root] [--host 127.0.0.1] [--port 5173] [--base /prefix/]
  npm run build -- [notebook-root] [--out-dir dist] [--base /prefix/]

The root is a notebook content folder. Dev serves the bundled read-only notebook shell, artifact previews, and graph refresh events.
Build assembles a static notebook viewer and its prototype outputs; it does not deploy or start external Sites.
`
}

async function dev(options) {
  const runtime = await createNotebookRuntime(options)
  await runtime.start()
  console.log(`Design Notebook: ${runtime.address}/`)
  console.log(`Notebook root: ${runtime.root}`)
  console.log(`Read-only graph: ${runtime.address}/__notebook/graph`)
  const close = async () => {
    await runtime.close()
    process.exitCode = 0
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
  await new Promise(resolve => {
    process.once('SIGINT', resolve)
    process.once('SIGTERM', resolve)
  })
}

async function build(options) {
  const built = await buildNotebook(options)
  const result = await publishNotebook({
    root: built.root,
    outputRoot: built.outDir,
    base: built.base,
    graph: built.graph,
    prototypeResults: built.prototypes,
  })
  console.log(`Static notebook output: ${result.outputRoot}`)
  for (const prototype of built.prototypes) {
    const diagnostics = prototype.diagnostics ?? []
    console.log(`${prototype.artifactId}: ${diagnostics.length ? 'failed' : prototype.url}`)
    for (const item of diagnostics) console.error(`  ${item.code}: ${item.message}`)
  }
  for (const item of result.diagnostics.filter(diagnostic => diagnostic.severity === 'error')) {
    console.error(`${item.path}: ${item.code}: ${item.message}`)
  }
  if (!result.success || built.prototypes.some(prototype => prototype.diagnostics?.length) || built.diagnostics.some(item => item.severity === 'error')) process.exitCode = 1
}

export async function main(argv = process.argv.slice(2)) {
  const options = argumentsOf(argv)
  if (options.help || !options.command || options.command === 'help') {
    console.log(help())
    return
  }
  if (options.command === 'dev') return dev(options)
  if (options.command === 'build') return build(options)
  throw new Error(`Unknown command: ${options.command}`)
}

function isInvokedAsExecutable() {
  const invokedPath = process.argv[1]
  if (!invokedPath) return false
  try {
    return fs.realpathSync(invokedPath) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (isInvokedAsExecutable()) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
