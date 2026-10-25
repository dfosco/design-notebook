import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { discoverNotebook } from '../../index.js'
import { replayCanvas } from '../../src/canvas-format/index.js'
import { resolveNotebookAsset } from '../../src/core/runtime/resolver.js'
import { resolveNotebookPath } from '../../src/core/artifacts/discovery.js'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const fixtureRoot = path.join(repositoryRoot, 'examples/first-look/notebook')

function write(root, relative, contents) {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, contents)
  return target
}

function makeStubPackage(root) {
  write(root, 'package.json', JSON.stringify({
    name: 'design-notebook',
    type: 'module',
    exports: { '.': './index.js' },
    bin: { 'design-notebook': './bin/design-notebook.js' },
  }))
  write(root, 'index.js', 'export {}\n')
  write(root, 'bin/design-notebook.js', `
    import fs from 'node:fs'
    if (process.env.EXAMPLE_CAPTURE) fs.writeFileSync(process.env.EXAMPLE_CAPTURE, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }))
    if (process.env.EXAMPLE_EXIT_CODE) process.exit(Number(process.env.EXAMPLE_EXIT_CODE))
    if (process.env.EXAMPLE_SIGNAL_READY) {
      fs.writeFileSync(process.env.EXAMPLE_SIGNAL_READY, JSON.stringify({ pid: process.pid }))
      for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
        fs.writeFileSync(process.env.EXAMPLE_SIGNAL_RECEIVED, signal)
        process.exit(0)
      })
      setInterval(() => {}, 1000)
    }
  `)
}

function waitForFile(file, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const check = () => {
      if (fs.existsSync(file)) return resolve()
      if (Date.now() >= deadline) return reject(new Error(`Timed out waiting for ${file}`))
      setTimeout(check, 10)
    }
    check()
  })
}

function waitForExit(child, timeoutMs = 3000) {
  if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for example launcher exit')), timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  })
}

test('first-look fixture has unique artifacts and intentional, non-overlapping canvas references', () => {
  const graph = discoverNotebook(fixtureRoot)
  assert.deepEqual(graph.diagnostics.filter(item => item.severity === 'error'), [])
  assert.deepEqual(graph.artifacts.map(item => item.id).sort(), [
    'borrow-flow', 'checkout-rationale', 'checkout-review', 'existing-catalog',
  ])
  assert.equal(new Set(graph.artifacts.map(item => item.id)).size, graph.artifacts.length)

  const canvas = graph.artifacts.find(item => item.id === 'checkout-review')
  const source = fs.readFileSync(path.join(fixtureRoot, canvas.descriptorPath), 'utf8')
  const replay = replayCanvas(source)
  assert.equal(replay.status, 'complete')
  assert.equal(replay.canvasId, 'checkout-review')
  assert.equal(new Set(replay.placements.map(item => item.id)).size, replay.placements.length)

  const prototypes = graph.artifacts.filter(item => item.kind === 'prototype')
  const sites = graph.artifacts.filter(item => item.kind === 'site')
  for (const placement of replay.placements) {
    if (placement.kind === 'prototype') {
      const artifact = prototypes.find(item => item.id === placement.data.artifactId)
      assert.ok(artifact, `missing prototype ${placement.data.artifactId}`)
      assert.ok(artifact.views.some(view => view.id === placement.data.viewId), `missing exact prototype view ${placement.data.viewId}`)
    }
    if (placement.kind === 'site') {
      const artifact = sites.find(item => item.id === placement.data.artifactId)
      assert.ok(artifact, `missing Site ${placement.data.artifactId}`)
      const view = artifact.views.find(item => item.id === placement.data.viewId)
      assert.ok(view, `missing exact Site view ${placement.data.viewId}`)
      const asset = resolveNotebookAsset(graph, view.screenshot, { basePath: artifact.folderPath, mode: 'local' })
      assert.equal(asset.available, true)
      assert.equal(asset.url, '/research/catalog.site/assets/catalog-home.svg')
      assert.ok(fs.existsSync(resolveNotebookPath(fixtureRoot, artifact.folderPath, view.screenshot)))
    }
  }

  const prototypePlacements = replay.placements.filter(item => item.kind === 'prototype')
  assert.deepEqual(prototypePlacements.map(item => [item.data.artifactId, item.data.viewId]), [
    ['borrow-flow', 'request'], ['borrow-flow', 'confirmation'],
  ])
  for (let first = 0; first < replay.placements.length; first += 1) {
    const a = replay.placements[first]
    for (let second = first + 1; second < replay.placements.length; second += 1) {
      const b = replay.placements[second]
      const separated = a.position.x + a.width <= b.position.x || b.position.x + b.width <= a.position.x ||
        a.position.y + a.height <= b.position.y || b.position.y + b.height <= a.position.y
      assert.equal(separated, true, `${a.id} overlaps ${b.id}`)
    }
  }
})

test('example init creates a fresh working copy and refuses to overwrite existing work', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-notebook-example-init-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  fs.mkdirSync(path.join(temp, 'bin'), { recursive: true })
  fs.mkdirSync(path.join(temp, 'examples/first-look'), { recursive: true })
  fs.copyFileSync(path.join(repositoryRoot, 'bin/instantiate-example-notebook.js'), path.join(temp, 'bin/instantiate-example-notebook.js'))
  fs.cpSync(fixtureRoot, path.join(temp, 'examples/first-look/notebook'), { recursive: true })

  const helper = path.join(temp, 'bin/instantiate-example-notebook.js')
  const created = spawnSync(process.execPath, [helper], { cwd: temp, encoding: 'utf8' })
  assert.equal(created.status, 0, created.stderr)
  const workingCopy = path.join(temp, 'example-notebook')
  assert.equal(fs.readFileSync(path.join(workingCopy, 'research/checkout-review.canvas/checkout-review.canvas.jsonl'), 'utf8'),
    fs.readFileSync(path.join(fixtureRoot, 'research/checkout-review.canvas/checkout-review.canvas.jsonl'), 'utf8'))

  const sentinel = path.join(workingCopy, 'keep-me.txt')
  fs.writeFileSync(sentinel, 'authored working copy')
  const refused = spawnSync(process.execPath, [helper], { cwd: temp, encoding: 'utf8' })
  assert.notEqual(refused.status, 0)
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'authored working copy')
})

test('example resolves and launches source-checkout and installed package entry points', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-notebook-example-launch-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.scripts.dev, 'node ./design-notebook-example.mjs dev')
  assert.equal(manifest.scripts.build, 'node ./design-notebook-example.mjs build')
  assert.deepEqual(manifest.dependencies ?? {}, {})
  assert.equal(fs.existsSync(path.join(fixtureRoot, 'src')), false)
  const runnerText = fs.readFileSync(path.join(fixtureRoot, 'design-notebook-example.mjs'), 'utf8')

  const sourceRoot = path.join(temp, 'source-checkout')
  makeStubPackage(sourceRoot)
  const sourceExample = path.join(sourceRoot, 'examples/first-look/notebook')
  fs.cpSync(fixtureRoot, sourceExample, { recursive: true })
  const sourceCapture = path.join(temp, 'source-capture.json')
  const sourceRun = spawnSync(process.execPath, [path.join(sourceExample, 'design-notebook-example.mjs'), 'dev', '--host', '127.0.0.1'], {
    cwd: sourceExample,
    encoding: 'utf8',
    env: { ...process.env, EXAMPLE_CAPTURE: sourceCapture },
  })
  assert.equal(sourceRun.status, 0, sourceRun.stderr)
  assert.deepEqual(JSON.parse(fs.readFileSync(sourceCapture, 'utf8')), {
    argv: ['dev', '.', '--host', '127.0.0.1'],
    cwd: fs.realpathSync(sourceExample),
  })

  const consumerRoot = path.join(temp, 'consumer')
  const installedRoot = path.join(consumerRoot, 'node_modules/design-notebook')
  makeStubPackage(installedRoot)
  const consumerExample = path.join(consumerRoot, 'example-notebook')
  fs.cpSync(fixtureRoot, consumerExample, { recursive: true })
  const consumerCapture = path.join(temp, 'consumer-capture.json')
  const consumerRun = spawnSync(process.execPath, [path.join(consumerExample, 'design-notebook-example.mjs'), 'build', '--base', '/preview/'], {
    cwd: consumerExample,
    encoding: 'utf8',
    env: { ...process.env, EXAMPLE_CAPTURE: consumerCapture },
  })
  assert.equal(consumerRun.status, 0, consumerRun.stderr)
  assert.deepEqual(JSON.parse(fs.readFileSync(consumerCapture, 'utf8')), {
    argv: ['build', '.', '--base', '/preview/'],
    cwd: fs.realpathSync(consumerExample),
  })
  assert.match(runnerText, /createRequire\(import\.meta\.url\)\.resolve\('design-notebook'\)/)

  const failedRun = spawnSync(process.execPath, [path.join(consumerExample, 'design-notebook-example.mjs'), 'build'], {
    cwd: consumerExample,
    encoding: 'utf8',
    env: { ...process.env, EXAMPLE_EXIT_CODE: '7' },
  })
  assert.equal(failedRun.status, 7)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`example launcher forwards ${signal} and waits for its CLI`, async t => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), `design-notebook-example-${signal.toLowerCase()}-`))
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
    const packageRoot = path.join(temp, 'design-notebook')
    makeStubPackage(packageRoot)
    const example = path.join(packageRoot, 'examples/first-look/notebook')
    fs.cpSync(fixtureRoot, example, { recursive: true })
    const ready = path.join(temp, 'ready.json')
    const received = path.join(temp, 'received-signal.txt')
    const wrapper = spawn(process.execPath, [path.join(example, 'design-notebook-example.mjs'), 'dev'], {
      cwd: example,
      stdio: 'ignore',
      env: { ...process.env, EXAMPLE_SIGNAL_READY: ready, EXAMPLE_SIGNAL_RECEIVED: received },
    })
    t.after(() => {
      const childPid = fs.existsSync(ready) ? JSON.parse(fs.readFileSync(ready, 'utf8')).pid : null
      if (wrapper.exitCode === null) wrapper.kill('SIGKILL')
      if (childPid) { try { process.kill(childPid, 'SIGKILL') } catch {} }
    })

    await waitForFile(ready)
    wrapper.kill(signal)
    const result = await waitForExit(wrapper)
    assert.equal(result.code, 0)
    assert.equal(result.signal, null)
    assert.equal(fs.readFileSync(received, 'utf8'), signal)
  })
}
