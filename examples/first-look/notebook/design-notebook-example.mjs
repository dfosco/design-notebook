#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

function packageRootAt(candidate) {
  const packageFile = path.join(candidate, 'package.json')
  const cliFile = path.join(candidate, 'bin/design-notebook.js')
  if (!fs.existsSync(packageFile) || !fs.existsSync(cliFile)) return null
  try {
    const manifest = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
    if (manifest.name === 'design-notebook') return { current: candidate, cliFile }
  } catch {}
  return null
}

function findPackageRoot(from) {
  let current = path.resolve(from)
  while (true) {
    const packageRoot = packageRootAt(current)
    if (packageRoot) return packageRoot
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  try {
    // Resolve the exported package entry point instead of assuming
    // package.json itself is exported. This also works for a copied example
    // beside node_modules/design-notebook.
    const entry = createRequire(import.meta.url).resolve('design-notebook')
    return packageRootAt(path.dirname(entry))
  } catch {
    return null
  }
}

const [command, ...args] = process.argv.slice(2)
if (!['dev', 'build'].includes(command)) {
  throw new Error('Usage: npm run dev [-- CLI options] or npm run build [-- CLI options]')
}
const packageRoot = findPackageRoot(process.cwd())
if (!packageRoot) {
  throw new Error('Could not find the Design Notebook source/package above this example folder.')
}

const child = spawn(process.execPath, [packageRoot.cliFile, command, '.', ...args], {
  cwd: process.cwd(),
  stdio: 'inherit',
})
const forwardedSignals = ['SIGINT', 'SIGTERM']
const forwardSignal = signal => {
  if (child.exitCode === null && child.signalCode === null) child.kill(signal)
}
for (const signal of forwardedSignals) process.on(signal, forwardSignal)
const removeSignalHandlers = () => {
  for (const signal of forwardedSignals) process.off(signal, forwardSignal)
}
child.once('error', error => {
  console.error(error.message)
  process.exitCode = 1
})
child.once('close', (code, signal) => {
  removeSignalHandlers()
  process.exitCode = code ?? (signal ? 1 : 0)
})
