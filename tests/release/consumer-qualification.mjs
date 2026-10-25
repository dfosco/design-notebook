import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const evidenceRoot = path.join(repoRoot, 'tests/release/evidence')
// The candidate pin is an explicit reviewed freeze manifest written by the
// runtime/package owner as part of the existing frozen-candidate contract.
// The harness never caches or re-pins hashes; a draft is explicitly not release
// authority so stale or unpinned inputs cannot pass qualification.
// Historical pins are preserved separately in
// tests/release/historical-candidate-pins.json and are never assertions.
const releaseFreezePath = path.join(repoRoot, 'tests/release/release-candidate-freeze.json')
if (!fs.existsSync(releaseFreezePath)) {
  throw new Error(`Missing release candidate freeze manifest: tests/release/release-candidate-freeze.json. The runtime/package owner must approve and pin the exact candidate there after local integration proof, before clean-consumer qualification runs.`)
}
const releaseFreeze = JSON.parse(fs.readFileSync(releaseFreezePath, 'utf8'))
if (releaseFreeze.status !== 'frozen') {
  throw new Error(`Release candidate freeze manifest is not approved release authority: status ${JSON.stringify(releaseFreeze.status)}, checked file tests/release/release-candidate-freeze.json. A prepared or unpinned input must fail before pack/install; the runtime/package owner must set status "frozen" only after local integration passes.`)
}
if (releaseFreeze.formatVersion !== 1 || typeof releaseFreeze.expectedVersion !== 'string' || typeof releaseFreeze.candidateHashes !== 'object') {
  throw new Error(`Malformed release candidate freeze manifest: tests/release/release-candidate-freeze.json must contain formatVersion=1, expectedVersion, and candidateHashes.`)
}
for (const [field, kind] of [['frozenBy', 'string'], ['frozenAt', 'string'], ['sourceIdentity', 'string']]) {
  const value = releaseFreeze[field]
  if (typeof value !== kind || value.length === 0) {
    throw new Error(`Release candidate freeze manifest must record the actual freeze ${field} identity; missing or empty in tests/release/release-candidate-freeze.json.`)
  }
}
if (Number.isNaN(Date.parse(releaseFreeze.frozenAt))) {
  throw new Error(`Release candidate freeze manifest frozenAt is not a valid ISO timestamp: ${JSON.stringify(releaseFreeze.frozenAt)}`)
}
if (releaseFreeze.expectedVersion !== '0.10.0-first-look') {
  throw new Error(`Release freeze manifest expects version ${releaseFreeze.expectedVersion}, but qualification verifies the 0.10.0-first-look candidate.`)
}
const expectedVersion = releaseFreeze.expectedVersion
const expectedCandidateHashes = releaseFreeze.candidateHashes
const packedSourceInputRoots = releaseFreeze.packedSourceInputRoots
if (!Array.isArray(packedSourceInputRoots) || packedSourceInputRoots.length === 0 || typeof releaseFreeze.packedSourceSha256 !== 'string' || releaseFreeze.packedSourceSha256.length === 0) {
  throw new Error(`Malformed release candidate freeze manifest: tests/release/release-candidate-freeze.json must contain packedSourceInputRoots and their packedSourceSha256 digest.`)
}
for (const input of packedSourceInputRoots) {
  if (typeof input !== 'string' || input.length === 0) throw new Error(`Malformed packed source input root: ${JSON.stringify(input)}`)
  if (path.isAbsolute(input) || input.includes('..')) throw new Error(`Packed source input roots must be relative notebook paths without traversal: ${input}`)
  const resolved = path.resolve(repoRoot, input)
  if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error(`Packed source input root escapes the repository: ${input}`)
  }
}
const requiredPackedFiles = [
  // Derived from the actual runtime import closure of the package entries
  // (bin CLI, root exports, runtime subpath exports, publisher, client shell,
  // docs, sites, canvas format and renderer) plus files the runtime reads
  // through vendored source scanning and provenance records.
  'LICENSE',
  'LICENSES/tiny-canvas-MIT.txt',
  'src/vendor/hypercanvas/LICENSE',
  'src/vendor/hypercanvas/PROVENANCE.md',
  'src/vendor/hypercanvas/classnames.js',
  'src/vendor/hypercanvas/core-css.js',
  'src/vendor/hypercanvas/chrome/utils.js',
  'src/vendor/hypercanvas/chrome/use-mobile.js',
  'src/vendor/hypercanvas/chrome/ui/breadcrumb.jsx',
  'src/vendor/hypercanvas/chrome/ui/button.jsx',
  'src/vendor/hypercanvas/chrome/ui/input.jsx',
  'src/vendor/hypercanvas/chrome/ui/separator.jsx',
  'src/vendor/hypercanvas/chrome/ui/sheet.jsx',
  'src/vendor/hypercanvas/chrome/ui/sidebar.jsx',
  'src/vendor/hypercanvas/chrome/ui/skeleton.jsx',
  'src/vendor/hypercanvas/chrome/ui/tooltip.jsx',
  'src/vendor/hypercanvas/NotebookShell/NotebookChrome.jsx',
  'src/vendor/hypercanvas/NotebookShell/NotebookShell.module.css',
  'src/vendor/hypercanvas/NotebookShell/hypercanvas-icon.svg',
  'src/vendor/hypercanvas/generated/tailwind.css',
  'src/vendor/hypercanvas/generated/tailwind.source.css',
  'src/vendor/tiny-canvas/index.js',
  'src/vendor/tiny-canvas/interactive.js',
  'src/vendor/tiny-canvas/style.css',
  'src/vendor/tiny-canvas/upstream/tiny-canvas.js',
  'src/vendor/tiny-canvas/upstream/Image-Dv6N7c_d.js',
  'src/vendor/tiny-canvas/upstream/index-BDk96P-Z.js',
  'src/vendor/tiny-canvas/upstream/tiny-canvas.css',
  'src/vendor/tiny-canvas/upstream/LICENSE',
  'src/canvas-format/index.js',
  'src/canvas-renderer/index.js',
  'src/core/artifacts/discovery.js',
  'src/core/docs/index.js',
  'src/core/publisher/index.js',
  'src/core/publisher/browser.js',
  'src/core/runtime/index.js',
  'src/core/runtime/react.js',
  'src/core/runtime/route.js',
  'src/core/runtime/resolver.js',
  'src/core/runtime/notebook-routes.js',
  'src/core/runtime/shell-entry.js',
  'schemas/artifacts/doc-frontmatter.schema.json',
  'schemas/artifacts/prototype.schema.json',
  'schemas/artifacts/site.schema.json',
  'src/client/shell/index.js',
  'src/client/shell/model.js',
  'src/client/shell/style.css',
  'src/client/docs/index.js',
  'src/client/docs/render-scene.js',
  'src/client/docs/style.css',
  'src/client/sites/index.js',
  'src/client/sites/style.css',
  'bin/design-notebook.js',
  'bin/instantiate-example-notebook.js',
  'README.md',
  'docs/getting-started.md',
  'docs/authoring.md',
  'docs/release/0.10.0-first-look.md',
  'docs/format/publishing.md',
  'docs/research/canvas-renderer-provenance.md',
  'examples/first-look/notebook/design-notebook-example.mjs',
  'examples/first-look/notebook/package.json',
  'examples/first-look/notebook/research/borrow-flow.prototype/borrow-flow.prototype.json',
  'examples/first-look/notebook/research/checkout-review.canvas/checkout-review.canvas.jsonl',
  'examples/first-look/notebook/research/checkout-rationale.doc.mdx',
  'examples/first-look/notebook/research/catalog.site/catalog.site.json',
  'skills/design-notebook-authoring/SKILL.md',
]
const evidence = {
  formatVersion: 1,
  phase: 'consumer-qualification',
  status: 'running',
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  startedAt: new Date().toISOString(),
  checks: [],
  failures: [],
  cleanup: { devServerStopped: false, staticServersStopped: true, tempTreeRemoved: false, errors: [] },
}
let temporaryRoot
let devServer
let devServerTrace
let staticServers = []
let keepTemporaryRoot = false

function record(name, details = {}) {
  evidence.checks.push({ name, status: 'passed', ...details })
}

function hashBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function hashFile(file) {
  return hashBytes(fs.readFileSync(file))
}

function stripSourceMapComments(source) {
  return source
    .replace(/^[\t ]*\/\/[#@]\s*sourceMappingURL=.*$/gm, '')
    .replace(/\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//g, '')
}

function treeDigest(root) {
  const hash = crypto.createHash('sha256')
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(root, absolute).split(path.sep).join('/')
      if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in digest input: ${relative}`)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) {
        hash.update(relative)
        hash.update('\0')
        hash.update(fs.readFileSync(absolute))
        hash.update('\0')
      }
    }
  }
  visit(root)
  return hash.digest('hex')
}

function filesUnder(root) {
  const files = []
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push(absolute)
    }
  }
  visit(root)
  return files
}

function isPackedSourceExcluded(relative) {
  const segments = relative.split('/')
  return segments.includes('node_modules') || segments[segments.length - 1] === '.DS_Store'
}

function packedSourceDigest(inputRoots) {
  const digest = crypto.createHash('sha256')
  const relativeFiles = []
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(repoRoot, absolute).split(path.sep).join('/')
      if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in packed source input: ${relative}`)
      if (entry.isDirectory()) {
        if (!isPackedSourceExcluded(relative)) visit(absolute)
      } else if (entry.isFile() && !isPackedSourceExcluded(relative)) {
        relativeFiles.push(absolute)
      }
    }
  }
  for (const inputRoot of inputRoots) {
    const absoluteRoot = path.resolve(repoRoot, inputRoot)
    let stats
    try { stats = fs.statSync(absoluteRoot) } catch (error) {
      throw new Error(`Packed source input root does not exist: ${path.relative(repoRoot, absoluteRoot).split(path.sep).join('/')}`)
    }
    if (stats.isFile()) relativeFiles.push(absoluteRoot)
    else visit(absoluteRoot)
  }
  relativeFiles.sort()
  for (const absolute of relativeFiles) {
    digest.update(path.relative(repoRoot, absolute).split(path.sep).join('/'))
    digest.update('\0')
    digest.update(fs.readFileSync(absolute))
    digest.update('\0')
  }
  return digest.digest('hex')
}

function assertManifestCoversRequiredPackedFiles() {
  const uncovered = requiredPackedFiles.filter(file => {
    return !packedSourceInputRoots.some(inputRoot => file === inputRoot.replace(/\/$/, '') || file.startsWith(`${inputRoot.replace(/\/$/, '')}/`))
  })
  assert.deepEqual(uncovered, [], `Freeze manifest packedSourceInputRoots must cover every required packed file. Uncovered: ${uncovered.join(', ')}`)
}

function notebookSourceSnapshot(root) {
  const authored = crypto.createHash('sha256')
  const viteCacheFiles = []
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(root, absolute).split(path.sep).join('/')
      if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in notebook snapshot: ${relative}`)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) {
        const parts = relative.split('/')
        const cacheIndex = parts.findIndex((part, index) => part === 'node_modules' && parts[index + 1] === '.vite')
        const bytes = fs.readFileSync(absolute)
        if (cacheIndex >= 0) viteCacheFiles.push({ path: relative, sha256: hashBytes(bytes) })
        else {
          authored.update(relative)
          authored.update('\0')
          authored.update(bytes)
          authored.update('\0')
        }
      }
    }
  }
  visit(root)
  const cacheHash = crypto.createHash('sha256')
  for (const item of viteCacheFiles) {
    cacheHash.update(item.path)
    cacheHash.update('\0')
    cacheHash.update(item.sha256)
    cacheHash.update('\0')
  }
  return { authoredSha256: authored.digest('hex'), viteCache: { fileCount: viteCacheFiles.length, sha256: cacheHash.digest('hex'), files: viteCacheFiles } }
}

function run(command, args, { cwd, timeout = 10 * 60_000, env = process.env } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited ${result.status ?? result.signal}.\n${result.stdout}\n${result.stderr}`)
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status }
}

async function waitFor(predicate, message, timeout = 30_000) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await predicate()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`${message}${lastError ? ` Last error: ${lastError.message}` : ''}`)
}

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(10_000) })
  return { response, text: await response.text() }
}

function staticServer(root, prefix = '/') {
  const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`
  const server = http.createServer((req, res) => {
    let pathname
    try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://static.invalid').pathname) } catch {
      res.writeHead(400).end('Bad path')
      return
    }
    if (pathname === '/favicon.ico') {
      res.writeHead(204).end()
      return
    }
    if (!pathname.startsWith(normalizedPrefix)) {
      res.writeHead(404).end('Not found')
      return
    }
    const relative = pathname.slice(normalizedPrefix.length)
    let absolute = path.resolve(root, ...relative.split('/').filter(Boolean))
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      res.writeHead(404).end('Not found')
      return
    }
    try {
      if (fs.statSync(absolute).isDirectory()) absolute = path.join(absolute, 'index.html')
    } catch {
      res.writeHead(404).end('Not found')
      return
    }
    let bytes
    try { bytes = fs.readFileSync(absolute) } catch {
      res.writeHead(404).end('Not found')
      return
    }
    const extension = path.extname(absolute).toLowerCase()
    const types = {
      '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8', '.jsonl': 'application/x-ndjson; charset=utf-8', '.svg': 'image/svg+xml',
      '.txt': 'text/plain; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2',
    }
    res.writeHead(200, { 'content-type': types[extension] ?? 'application/octet-stream', 'content-length': bytes.length })
    if (req.method === 'HEAD') res.end()
    else res.end(bytes)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      const address = server.address()
      resolve({ server, origin: `http://127.0.0.1:${address.port}${normalizedPrefix}`, prefix: normalizedPrefix })
    })
  })
}

function appendJsonl(file, record) {
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`)
}

function checkPackedDocumentationLinks(packedPaths) {
  const markdownFiles = [
    'README.md',
    'docs/getting-started.md',
    'docs/authoring.md',
    'docs/release/0.10.0-first-look.md',
    'docs/research/canvas-renderer-provenance.md',
    'docs/format/publishing.md',
    'skills/design-notebook-authoring/SKILL.md',
  ]
  const missing = []
  for (const source of markdownFiles) {
    const markdown = fs.readFileSync(path.join(repoRoot, source), 'utf8')
    for (const [, target] of markdown.matchAll(/\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) continue
      let relative
      try { relative = decodeURIComponent(target.split(/[?#]/, 1)[0]) } catch { missing.push(`${source} -> ${target} (invalid URL encoding)`); continue }
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source), relative))
      const existsInPackage = [...packedPaths].some(file => file === resolved || file.startsWith(`${resolved.replace(/\/$/, '')}/`))
      if (!existsInPackage) missing.push(`${source} -> ${resolved}`)
    }
  }
  assert.deepEqual(missing, [], `Packed Markdown links do not resolve within the package: ${missing.join(', ')}`)
}

function writeDoc(file, id, title, body = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `---\nformatVersion: 1\nid: ${id}\ntitle: ${title}\n---\n\n# ${title}\n\n${body}`)
}

function createScaleFixture(notebookRoot) {
  const research = path.join(notebookRoot, 'research')
  for (let index = 1; index <= 59; index += 1) {
    const group = `group-${String(Math.floor((index - 1) / 8) + 1).padStart(2, '0')}`
    const subGroup = index % 2 ? 'flows' : 'notes'
    writeDoc(path.join(research, 'scale', group, subGroup, `item-${String(index).padStart(2, '0')}.doc.mdx`), `scale-item-${String(index).padStart(2, '0')}`, `Scale item ${String(index).padStart(2, '0')}`)
  }
  const addedPath = path.join(research, 'scale', 'group-08', 'flows', 'release-added.doc.mdx')
  writeDoc(addedPath, 'release-added', 'Added during release verification')

  const documentAsset = path.join(research, 'assets', 'release-doc.svg')
  const canvasAsset = path.join(research, 'checkout-review.canvas', 'assets', 'release-canvas.svg')
  fs.mkdirSync(path.dirname(documentAsset), { recursive: true })
  fs.mkdirSync(path.dirname(canvasAsset), { recursive: true })
  fs.writeFileSync(documentAsset, '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#315bd6"/></svg>')
  fs.writeFileSync(canvasAsset, '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#315bd6"/></svg>')
  fs.writeFileSync(path.join(notebookRoot, 'notebook.css'), ':root { --notebook-release-proof: #315bd6; }\n')

  const docPath = path.join(research, 'checkout-rationale.doc.mdx')
  const documentSource = fs.readFileSync(docPath, 'utf8')
  const originalImports = "import { Prototype, Site } from 'design-notebook/docs'"
  assert.ok(documentSource.includes(originalImports), 'Packaged example no longer has the expected MDX component import to extend.')
  fs.writeFileSync(docPath, `${documentSource.replace(originalImports, "import { Prototype, Site, Image } from 'design-notebook/docs'")}\n\n![Release Markdown image](assets/release-doc.svg)\n\n<Image src="assets/release-doc.svg" alt="Release component image" />\n`)
  appendJsonl(path.join(research, 'checkout-review.canvas', 'checkout-review.canvas.jsonl'), {
    event: 'widget_added',
    widget: { id: 'release-proof-image', type: 'image', position: { x: 920, y: 520 }, props: { src: 'assets/release-canvas.svg', alt: 'Release canvas image', width: 160, height: 80 } },
  })
  return { addedPath, docPath, documentAsset, canvasAsset }
}

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null
}

function waitForChildEvent(child, trace, eventName, timeoutMs) {
  const existing = trace.events.find(event => event.name === eventName)
  if (existing) return Promise.resolve(existing)
  return new Promise(resolve => {
    let timer
    const finish = value => {
      if (timer) clearTimeout(timer)
      child.off(eventName, listener)
      resolve(value)
    }
    const listener = (...args) => finish(trace.events.findLast(event => event.name === eventName) ?? { name: eventName, args })
    child.once(eventName, listener)
    timer = setTimeout(() => finish(null), timeoutMs)
  })
}

async function recordDevServerLiveness(address, trace, phase) {
  const sample = { at: new Date().toISOString(), phase }
  if (!address) {
    sample.alive = false
    sample.error = 'Dev server address was not available.'
    trace.serverLiveness.push(sample)
    return sample
  }
  try {
    const response = await fetch(new URL('__notebook/graph', address), { signal: AbortSignal.timeout(1_500) })
    await response.arrayBuffer()
    sample.status = response.status
    sample.alive = response.status === 200
  } catch (error) {
    sample.alive = false
    sample.error = error.message
  }
  trace.serverLiveness.push(sample)
  return sample
}

async function stopChild(child, label, address) {
  if (!child || !devServerTrace) return { stopped: true, graceful: true, exitCode: child?.exitCode ?? 0, signalCode: child?.signalCode ?? null, trigger: 'already-closed' }
  const trace = devServerTrace
  const signalTimeouts = [['SIGINT', 10_000], ['SIGTERM', 3_000], ['SIGKILL', 3_000]]
  let trigger = childHasExited(child) ? 'already-exited' : null
  await recordDevServerLiveness(address, trace, 'before-stop')
  for (const [signal, timeoutMs] of signalTimeouts) {
    if (childHasExited(child)) break
    trigger = signal
    trace.signals.push({ signal, at: new Date().toISOString(), exitCodeBefore: child.exitCode, signalCodeBefore: child.signalCode })
    try {
      trace.signals.at(-1).sent = child.kill(signal)
    } catch (error) {
      trace.signals.at(-1).error = error.message
    }
    if (childHasExited(child)) break
    const exitEvent = await waitForChildEvent(child, trace, 'exit', timeoutMs)
    trace.signals.at(-1).exitObserved = Boolean(exitEvent)
    await recordDevServerLiveness(address, trace, `after-${signal}`)
  }

  const exitEvent = trace.events.findLast(event => event.name === 'exit') ?? null
  const closeEvent = await waitForChildEvent(child, trace, 'close', 2_000)
  trace.shutdown = {
    at: new Date().toISOString(),
    trigger,
    exitCode: child.exitCode,
    signalCode: child.signalCode,
    exitEvent,
    closeEvent,
    exited: childHasExited(child),
    graceful: childHasExited(child) && child.exitCode === 0 && child.signalCode === null && trigger !== 'SIGKILL',
    stopped: childHasExited(child) && trace.serverLiveness.at(-1)?.alive === false,
  }
  evidence.devServerTrace = trace
  if (!trace.shutdown.exited) throw new Error(`${label} did not exit after signal escalation: ${JSON.stringify(trace.shutdown)}`)
  return trace.shutdown
}

async function startDev(executable, notebookRoot, cwd) {
  const child = spawn(executable, ['dev', notebookRoot, '--host', '127.0.0.1', '--port', '0'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  devServer = child
  const trace = { startedAt: new Date().toISOString(), events: [], signals: [], serverLiveness: [] }
  devServerTrace = trace
  for (const name of ['spawn', 'error', 'exit', 'close']) {
    child.on(name, (...args) => {
      const event = { name, at: new Date().toISOString() }
      if (name === 'error') event.error = args[0]?.message ?? String(args[0])
      else if (name === 'exit' || name === 'close') {
        event.exitCode = args[0]
        event.signalCode = args[1]
      }
      trace.events.push(event)
    })
  }
  let output = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { output += chunk })
  const address = await waitFor(async () => {
    const match = output.match(/Design Notebook: (http:\/\/127\.0\.0\.1:\d+\/)\s/)
      ?? output.match(/Design Notebook: (http:\/\/127\.0\.0\.1:\d+\/)/)
    if (!match) {
      if (childHasExited(child)) throw new Error(`Installed dev executable exited code=${child.exitCode} signal=${child.signalCode}:\n${output}`)
      const spawnError = trace.events.find(event => event.name === 'error')
      if (spawnError) throw new Error(`Installed dev executable failed to spawn: ${spawnError.error}`)
      return null
    }
    try {
      const response = await fetch(new URL('__notebook/graph', match[1]), { signal: AbortSignal.timeout(1_000) })
      return response.ok ? { origin: match[1], output } : null
    } catch { return null }
  }, 'Installed dev executable did not become ready.')
  return { child, ...address }
}

async function runQualification() {
  evidence.sourceExampleSha256 = treeDigest(path.join(repoRoot, 'examples/first-look/notebook'))
  const nodeFromPath = run(process.platform === 'win32' ? 'where' : 'which', ['node']).stdout.trim().split(/\r?\n/)[0]
  assert.equal(fs.realpathSync.native(nodeFromPath), fs.realpathSync.native(process.execPath), 'The first node on PATH must be the tested minimum Node runtime.')
  evidence.environment.nodeExecutable = fs.realpathSync.native(process.execPath)
  evidence.environment.nodeFromPath = fs.realpathSync.native(nodeFromPath)
  evidence.environment.npm = run('npm', ['--version']).stdout.trim()
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  assert.equal(packageJson.version, expectedVersion, `Expected package owner candidate ${expectedVersion}, found ${packageJson.version}.`)
  assert.equal(packageJson.bin?.['design-notebook'], './bin/design-notebook.js', 'Installed CLI must be exposed through package bin metadata.')
  assert.equal(packageJson.license, 'MIT', 'The package candidate must declare the selected MIT license.')
  assert.match(packageJson.engines?.node ?? '', /20\.19\.0/, 'Package must declare the verified Vite Node floor.')
  evidence.package = { name: packageJson.name, version: packageJson.version, license: packageJson.license, engines: packageJson.engines }
  evidence.candidateHashes = {
    LICENSE: hashFile(path.join(repoRoot, 'LICENSE')),
    'package.json': hashFile(path.join(repoRoot, 'package.json')),
    'package-lock.json': hashFile(path.join(repoRoot, 'package-lock.json')),
    'index.js': hashFile(path.join(repoRoot, 'index.js')),
    'index.d.ts': hashFile(path.join(repoRoot, 'index.d.ts')),
    'bin/design-notebook.js': hashFile(path.join(repoRoot, 'bin/design-notebook.js')),
  }
  assert.deepEqual(evidence.candidateHashes, expectedCandidateHashes, 'Package source differs from tests/release/release-candidate-freeze.json. The runtime/package owner must re-pin the freeze manifest to the exact candidate before qualification.')
  assertManifestCoversRequiredPackedFiles()
  const sourceDigestBeforePack = packedSourceDigest(packedSourceInputRoots)
  assert.equal(sourceDigestBeforePack, releaseFreeze.packedSourceSha256, 'Working-tree source differs from the frozen packedSourceSha256 in tests/release/release-candidate-freeze.json. The runtime/package owner must re-pin the freeze manifest to the exact candidate before qualification.')

  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'design-notebook-clean-consumer-'))
  const packageDirectory = path.join(temporaryRoot, 'pack')
  const consumerDirectory = path.join(temporaryRoot, 'consumer')
  const outputs = { root: path.join(temporaryRoot, 'output-root'), prefix: path.join(temporaryRoot, 'output-prefix') }
  fs.mkdirSync(packageDirectory, { recursive: true })
  fs.mkdirSync(consumerDirectory, { recursive: true })

  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', packageDirectory], { cwd: repoRoot }).stdout)[0]
  assert.equal(packedSourceDigest(packedSourceInputRoots), sourceDigestBeforePack, 'Working-tree packed source changed while npm pack ran.')
  const archive = path.join(packageDirectory, packed.filename)
  evidence.packageArchive = { filename: packed.filename, shasum: packed.shasum, integrity: packed.integrity, sha256: hashFile(archive), entryCount: packed.entryCount }
  const packedPaths = new Set(packed.files.map(file => file.path))
  const missingPackedFiles = requiredPackedFiles.filter(file => !packedPaths.has(file))
  assert.deepEqual(missingPackedFiles, [], `Packed candidate omitted required public files: ${missingPackedFiles.join(', ')}`)
  checkPackedDocumentationLinks(packedPaths)
  record('pack-list-and-attribution', { entryCount: packed.entryCount, requiredFiles: requiredPackedFiles, packageArchive: evidence.packageArchive })

  fs.writeFileSync(path.join(consumerDirectory, 'package.json'), JSON.stringify({ name: 'clean-design-notebook-consumer', private: true, version: '1.0.0' }, null, 2))
  run('npm', ['install', '--no-audit', '--no-fund', archive], { cwd: consumerDirectory, timeout: 10 * 60_000 })
  const installedPackage = path.join(consumerDirectory, 'node_modules/design-notebook')
  const installedPackageJson = JSON.parse(fs.readFileSync(path.join(installedPackage, 'package.json'), 'utf8'))
  assert.equal(installedPackageJson.version, expectedVersion)
  assert.equal(installedPackageJson.license, 'MIT', 'The installed package must retain MIT metadata.')
  assert.equal(installedPackageJson.dependencies?.['react-markdown'], '^10.1.0', 'The installed package must declare Tiny Canvas markdown rendering support.')
  assert.match(fs.readFileSync(path.join(installedPackage, 'LICENSE'), 'utf8'), /^MIT License\b/, 'The installed package must include its root MIT license text.')
  for (const [subpath, declaration] of Object.entries(installedPackageJson.exports)) {
    const relativeTarget = typeof declaration === 'string' ? declaration : declaration.import
    if (relativeTarget && !relativeTarget.includes('*')) assert.ok(fs.statSync(path.join(installedPackage, relativeTarget)).isFile(), `Installed export ${subpath} points outside the package or to a missing file.`)
  }
  const installedBin = path.join(consumerDirectory, 'node_modules/.bin/design-notebook')
  assert.ok(fs.existsSync(installedBin), 'npm did not install the public design-notebook executable.')
  const packageApi = await import(pathToFileURL(path.join(installedPackage, 'index.js')).href)
  assert.equal(typeof packageApi.discoverNotebook, 'function')
  record('clean-install-and-public-entry', { installedVersion: installedPackageJson.version, reactMarkdown: installedPackageJson.dependencies['react-markdown'], installedBin: 'node_modules/.bin/design-notebook', exportNames: Object.keys(packageApi).sort() })

  const notebookRoot = path.join(consumerDirectory, 'notebook')
  const packagedExample = path.join(installedPackage, 'examples/first-look/notebook')
  assert.ok(fs.existsSync(packagedExample), 'Installed package does not contain the four-artifact example.')
  fs.cpSync(packagedExample, notebookRoot, { recursive: true })
  const exampleAssets = createScaleFixture(notebookRoot)
  const discover = () => packageApi.discoverNotebook(notebookRoot)
  let graph = discover()
  assert.deepEqual(graph.diagnostics.filter(item => item.severity === 'error'), [])
  assert.equal(graph.artifacts.length, 64, 'Four-artifact starter plus scale fixture should contain 64 artifacts.')
  const expectedKinds = new Set(graph.artifacts.map(artifact => artifact.kind))
  assert.deepEqual([...expectedKinds].sort(), ['canvas', 'doc', 'prototype', 'site'])
  assert.ok(graph.entries.some(entry => entry.type === 'group' && entry.name === 'research'))
  record('included-example-and-mixed-scale-fixture', { artifactCount: graph.artifacts.length, kinds: [...expectedKinds].sort(), nestedGroup: 'research/scale/group-*/flows|notes' })

  const addedPath = exampleAssets.addedPath
  graph = discover()
  assert.equal(graph.artifacts.find(item => item.id === 'release-added')?.title, 'Added during release verification')
  writeDoc(addedPath, 'release-added', 'Edited during release verification')
  assert.equal(discover().artifacts.find(item => item.id === 'release-added')?.title, 'Edited during release verification')
  const renamedPath = path.join(path.dirname(addedPath), 'release-renamed.doc.mdx')
  fs.renameSync(addedPath, renamedPath)
  graph = discover()
  assert.equal(graph.artifacts.find(item => item.id === 'release-added')?.path, path.relative(notebookRoot, renamedPath).split(path.sep).join('/'))
  assert.equal(graph.artifacts.find(item => item.id === 'release-added')?.title, 'Edited during release verification')
  record('direct-add-edit-rename-discovery', { stableId: 'release-added', finalPath: graph.artifacts.find(item => item.id === 'release-added').path })

  const local = await startDev(installedBin, notebookRoot, consumerDirectory)
  evidence.localOrigin = local.origin
  const graphUrl = new URL('__notebook/graph', local.origin)
  const initialGraphResponse = await fetch(graphUrl)
  assert.equal(initialGraphResponse.status, 200)
  let servedGraph = await initialGraphResponse.json()
  assert.equal(servedGraph.artifacts.length, 64)
  const docModule = await request(new URL('__notebook/artifacts/checkout-rationale/document.js?revision=0', local.origin))
  assert.equal(docModule.response.status, 200)
  assert.match(docModule.text, /Release Markdown image/)
  const canvasResponse = await request(new URL('__notebook/artifacts/checkout-review/canvas', local.origin))
  assert.equal(canvasResponse.response.status, 200)
  assert.match(canvasResponse.text, /"type":"chart"/)
  assert.match(canvasResponse.text, /"fallback":\{"type":"text"/)
  const canvasGeometryUrl = new URL('__notebook/artifacts/checkout-review/geometry', local.origin)
  const initialCanvasRevision = canvasResponse.response.headers.get('etag')
  assert.match(initialCanvasRevision ?? '', /^"sha256-[a-f0-9]{64}"$/, 'Local Canvas GET must expose the exact-byte revision used by geometry saves.')
  const postCanvasGeometry = (operation, geometry, revision) => request(canvasGeometryUrl, {
    method: 'POST',
    headers: {
      origin: new URL(local.origin).origin,
      'content-type': 'application/json',
      'if-match': revision,
    },
    body: JSON.stringify({ widgetId: 'review-note', operation, ...geometry }),
  })
  const movedGeometry = { position: { x: 540, y: 390 } }
  const moveResponse = await postCanvasGeometry('move', movedGeometry, initialCanvasRevision)
  assert.equal(moveResponse.response.status, 200, moveResponse.text)
  const moveResult = JSON.parse(moveResponse.text)
  assert.equal(moveResult.event.event, 'widget_moved')
  assert.equal(moveResult.event.widgetId, 'review-note')
  assert.deepEqual(moveResult.event.position, movedGeometry.position)
  assert.deepEqual(moveResult.geometry, { x: 540, y: 390, width: 390, height: 132 })
  assert.match(moveResult.revision, /^"sha256-[a-f0-9]{64}"$/)
  const resizedGeometry = { width: 410, height: 150 }
  const resizeResponse = await postCanvasGeometry('resize', resizedGeometry, moveResult.revision)
  assert.equal(resizeResponse.response.status, 200, resizeResponse.text)
  const resizeResult = JSON.parse(resizeResponse.text)
  assert.equal(resizeResult.event.event, 'widget_updated')
  assert.equal(resizeResult.event.widgetId, 'review-note')
  assert.deepEqual(resizeResult.event.props, resizedGeometry)
  assert.deepEqual(resizeResult.geometry, { x: 540, y: 390, width: 410, height: 150 })
  const savedCanvasResponse = await request(new URL('__notebook/artifacts/checkout-review/canvas', local.origin))
  assert.equal(savedCanvasResponse.response.status, 200)
  assert.equal(savedCanvasResponse.response.headers.get('etag'), resizeResult.revision)
  assert.ok(savedCanvasResponse.text.startsWith(canvasResponse.text), 'Local geometry saves must append without rewriting the existing JSONL source.')
  const savedCanvasRecords = savedCanvasResponse.text.trimEnd().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(savedCanvasRecords.slice(-2), [moveResult.event, resizeResult.event])
  record('local-canvas-geometry-save-appends-move-and-resize', {
    canvasId: 'checkout-review', widgetId: 'review-note',
    events: [moveResult.event, resizeResult.event], revision: resizeResult.revision,
  })

  const descriptorPath = path.join(notebookRoot, 'research/catalog.site/catalog.site.json')
  const siteArtifactPath = 'research/catalog.site'
  const originalDescriptor = fs.readFileSync(descriptorPath, 'utf8')
  fs.writeFileSync(descriptorPath, '{ invalid JSON')
  servedGraph = await waitFor(async () => {
    const current = await fetch(graphUrl).then(response => response.json())
    const site = current.artifacts.find(item => item.path === siteArtifactPath)
    return site?.available === false && site.diagnostics?.some(item => item.code === 'INVALID_DESCRIPTOR_JSON') ? current : null
  }, 'Installed dev host did not surface invalid Site descriptor.')
  const invalidSite = servedGraph.artifacts.find(item => item.path === siteArtifactPath)
  assert.equal(invalidSite.id, null, 'Malformed JSON must not retain an unparsed authored ID.')
  assert.equal(invalidSite.available, false)
  assert.ok(invalidSite.diagnostics.some(item => item.code === 'INVALID_DESCRIPTOR_JSON' && item.path === 'research/catalog.site/catalog.site.json'))
  fs.writeFileSync(descriptorPath, originalDescriptor)
  servedGraph = await waitFor(async () => {
    const current = await fetch(graphUrl).then(response => response.json())
    return current.artifacts.find(item => item.id === 'existing-catalog' && item.path === siteArtifactPath)?.available === true ? current : null
  }, 'Installed dev host did not recover after descriptor repair.')
  record('invalid-file-diagnostic-and-recovery', { artifactId: 'existing-catalog', unavailableObserved: true, recoveryObserved: true })

  const parentBefore = path.join(notebookRoot, 'research')
  const parentAfter = path.join(notebookRoot, 'workspace/review-cycle')
  fs.mkdirSync(path.dirname(parentAfter), { recursive: true })
  fs.renameSync(parentBefore, parentAfter)
  servedGraph = await waitFor(async () => {
    const current = await fetch(graphUrl).then(response => response.json())
    const prototype = current.artifacts.find(item => item.id === 'borrow-flow')
    const site = current.artifacts.find(item => item.id === 'existing-catalog')
    return prototype?.path.startsWith('workspace/review-cycle/') && site?.folderPath === 'workspace/review-cycle/catalog.site' ? current : null
  }, 'Installed runtime did not refresh after moving the parent group.')
  assert.equal(servedGraph.artifacts.length, 64)
  assert.equal(servedGraph.artifacts.find(item => item.id === 'checkout-review').id, 'checkout-review')
  assert.equal(servedGraph.artifacts.find(item => item.id === 'checkout-rationale').id, 'checkout-rationale')
  const movedDoc = servedGraph.artifacts.find(item => item.id === 'checkout-rationale')
  assert.equal(movedDoc.payloadPath, 'workspace/review-cycle/checkout-rationale.doc.mdx')
  const movedDocModule = await request(new URL('__notebook/artifacts/checkout-rationale/document.js?revision=latest', local.origin))
  assert.equal(movedDocModule.response.status, 200)
  assert.match(movedDocModule.text, /Release Markdown image/)
  record('parent-folder-move-preserves-identity-and-grouping', { artifactCount: 64, siteFolderPath: servedGraph.artifacts.find(item => item.id === 'existing-catalog').folderPath, documentPath: movedDoc.path })

  const markerValue = `source-edit-${Date.now()}`
  const marker = `window.releaseConsumerMarker = '${markerValue}'`
  const prototypeSourcePath = path.join(notebookRoot, 'workspace/review-cycle/borrow-flow.prototype/src/main.jsx')
  fs.appendFileSync(prototypeSourcePath, `\n${marker}\n`)
  const sourceUrl = new URL('workspace/review-cycle/borrow-flow.prototype/src/main.jsx', local.origin)
  let lastSourceProbe
  let prototypeSource
  try {
    prototypeSource = await waitFor(async () => {
      const response = await fetch(sourceUrl)
      const body = await response.text()
      const executableBody = stripSourceMapComments(body)
      const escapedMarker = markerValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const markerPattern = new RegExp(`window\\.releaseConsumerMarker\\s*=\\s*["']${escapedMarker}["']\\s*;?`)
      const markerMatch = markerPattern.exec(executableBody)
      const markerIndex = markerMatch?.index ?? -1
      lastSourceProbe = {
        url: sourceUrl.href,
        status: response.status,
        contentType: response.headers.get('content-type'),
        markerValue,
        markerValueFound: markerIndex >= 0,
        bodyLength: body.length,
        bodySha256: hashBytes(Buffer.from(body)),
        bodyExcerpt: markerIndex >= 0
          ? executableBody.slice(Math.max(0, markerIndex - 240), Math.min(executableBody.length, markerIndex + markerMatch[0].length + 240))
          : body.slice(0, 1200),
      }
      const mimeType = (lastSourceProbe.contentType ?? '').split(';', 1)[0].trim().toLowerCase()
      return response.status === 200 && /^(?:text|application)\/(?:java|ecma)script$/.test(mimeType) && markerIndex >= 0
        ? { ...lastSourceProbe, executableMarkerFound: true }
        : null
    }, 'Installed dev server did not serve direct source edits.')
  } catch (error) {
    throw new Error(`${error.message} Last source response: ${JSON.stringify(lastSourceProbe)}`)
  }
  assert.equal(prototypeSource.status, 200)
  assert.match(prototypeSource.contentType ?? '', /^(?:text|application)\/(?:java|ecma)script(?:\s*;|$)/i)
  assert.equal(prototypeSource.executableMarkerFound, true)
  record('direct-source-edit-through-installed-runtime', { marker: markerValue, response: prototypeSource })

  const snapshotBeforeBuild = notebookSourceSnapshot(notebookRoot)
  const devExit = await stopChild(devServer, 'Installed notebook dev server', local.origin)
  devServer = null
  evidence.devServerShutdown = devExit
  evidence.cleanup.devServerStopped = devExit.stopped
  assert.equal(devExit.stopped, true, `Installed dev server did not stop: ${JSON.stringify(devExit)}`)
  assert.equal(devExit.graceful, true, `Installed dev server required forced termination: ${JSON.stringify(devExit)}`)

  const buildResults = {}
  for (const [name, base] of [['root', '/'], ['prefix', '/preview/branch/']]) {
    const outputRoot = outputs[name]
    const build = run(installedBin, ['build', notebookRoot, '--out-dir', outputRoot, '--base', base], { cwd: consumerDirectory, timeout: 10 * 60_000 })
    const requiredOutput = [
      'index.html',
      'notebook-assets/notebook.css',
      'notebook-data/canvases/checkout-review.jsonl',
      'notebook-assets/workspace/review-cycle/catalog.site/assets/catalog-home.svg',
      'notebook-assets/workspace/review-cycle/checkout-review.canvas/assets/release-canvas.svg',
      'notebook-assets/workspace/review-cycle/assets/release-doc.svg',
      'prototypes/borrow-flow/request/index.html',
      'prototypes/borrow-flow/confirmation/index.html',
    ]
    for (const relative of requiredOutput) assert.ok(fs.statSync(path.join(outputRoot, relative)).isFile(), `${name} build missing ${relative}`)
    const canvas = fs.readFileSync(path.join(outputRoot, 'notebook-data/canvases/checkout-review.jsonl'), 'utf8')
    assert.match(canvas, /"fallback":\{"type":"text"/)
    assert.match(canvas, /"canvasId":"checkout-review"/)
    assert.doesNotMatch(canvas, /local-only|privateField|removed-content-token/)
    const html = fs.readFileSync(path.join(outputRoot, 'index.html'), 'utf8')
    assert.match(html, new RegExp(`${base.replaceAll('/', '\\/')}assets\\/notebook-`))
    const bundleFiles = filesUnder(path.join(outputRoot, 'assets')).filter(file => file.endsWith('.js'))
    assert.ok(bundleFiles.some(file => fs.readFileSync(file, 'utf8').includes('notebook-assets/notebook.css')), `${name} shell bundle must resolve the optional root stylesheet at runtime.`)
    const outputHash = treeDigest(outputRoot)
    buildResults[name] = { base, outputRoot, outputHash, log: build.stdout }
  }
  const snapshotAfterBuild = notebookSourceSnapshot(notebookRoot)
  assert.equal(snapshotAfterBuild.authoredSha256, snapshotBeforeBuild.authoredSha256, 'Static builds modified authored notebook files.')
  assert.equal(treeDigest(path.join(repoRoot, 'examples/first-look/notebook')), evidence.sourceExampleSha256, 'Consumer qualification modified the packaged source example.')
  evidence.builds = buildResults
  evidence.sourceTreeSha256 = snapshotBeforeBuild.authoredSha256
  evidence.viteCache = { beforeBuild: snapshotBeforeBuild.viteCache, afterBuild: snapshotAfterBuild.viteCache }
  record('installed-cli-static-root-prefix-and-source-preservation', {
    builds: Object.fromEntries(Object.entries(buildResults).map(([key, value]) => [key, { base: value.base, outputHash: value.outputHash }])),
    sourceTreeSha256: snapshotBeforeBuild.authoredSha256,
    viteCache: evidence.viteCache,
  })

  const localAssetPath = path.join(parentAfter, 'catalog.site/assets/catalog-home.svg')
  assert.ok(fs.existsSync(localAssetPath))
  for (const [name, base] of [['root', '/'], ['prefix', '/preview/branch/']]) {
    const running = await staticServer(outputs[name], base)
    staticServers.push(running.server)
    const rootUrl = new URL('borrow-flow/confirmation', running.origin)
    const rootPage = await request(rootUrl)
    assert.equal(rootPage.response.status, 200)
    assert.match(rootPage.text, /Design Notebook/)
    assert.equal(rootUrl.pathname, `${base}borrow-flow/confirmation`)
    for (const route of [
      'canvas/checkout-review',
      'docs/checkout-rationale',
      'sites/existing-catalog?view=catalog-home',
      'borrow-flow/request',
    ]) {
      const page = await request(new URL(route, running.origin))
      assert.equal(page.response.status, 200, `${name} canonical shell route failed: ${route}`)
      assert.match(page.text, /Design Notebook/)
    }
    for (const relative of [
      'notebook-assets/notebook.css',
      'notebook-assets/workspace/review-cycle/catalog.site/assets/catalog-home.svg',
      'notebook-assets/workspace/review-cycle/checkout-review.canvas/assets/release-canvas.svg',
      'notebook-assets/workspace/review-cycle/assets/release-doc.svg',
      'prototypes/borrow-flow/confirmation/',
    ]) {
      const asset = await request(new URL(relative, running.origin))
      assert.equal(asset.response.status, 200, `${name} static request failed: ${relative}`)
    }
    const stylesheet = await request(new URL('notebook-assets/notebook.css', running.origin))
    assert.match(stylesheet.text, /--notebook-release-proof/)
    const selectedPage = await request(new URL('prototypes/borrow-flow/request/', running.origin))
    assert.equal(selectedPage.response.status, 200)
    record(`static-http-${name}-direct-routes-and-assets`, { base, origin: running.origin, status: 200, routes: ['canvas/checkout-review', 'docs/checkout-rationale', 'sites/existing-catalog?view=catalog-home', 'borrow-flow/confirmation', 'borrow-flow/request'] })
  }
  for (const server of staticServers) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  staticServers = []
  evidence.cleanup.staticServersStopped = true
  evidence.temporaryRoot = temporaryRoot
  evidence.notebookRoot = notebookRoot
  evidence.consumerDirectory = consumerDirectory
  evidence.status = 'prepared-for-browser-review'
  evidence.finishedAt = new Date().toISOString()
  evidence.statePath = path.join(evidenceRoot, `${evidence.packageArchive.sha256}.prepared.json`)
  fs.mkdirSync(evidenceRoot, { recursive: true })
  fs.writeFileSync(evidence.statePath, `${JSON.stringify(evidence, null, 2)}\n`)
  keepTemporaryRoot = true
  process.stdout.write(`${JSON.stringify({ status: evidence.status, statePath: evidence.statePath, packageArchive: evidence.packageArchive, builds: Object.fromEntries(Object.entries(buildResults).map(([key, value]) => [key, { base: value.base, outputHash: value.outputHash }])), notebookSourceSha256: snapshotBeforeBuild })}\n`)
}

let runFailure
try {
  await runQualification()
} catch (error) {
  evidence.status = 'failed'
  evidence.failures.push({ message: error.message, stack: error.stack })
  evidence.candidateHashes ??= {}
  runFailure = error
} finally {
  if (devServer) {
    try {
      const shutdown = await stopChild(devServer, 'Installed notebook dev server', evidence.localOrigin)
      evidence.devServerShutdown = shutdown
      evidence.cleanup.devServerStopped = shutdown.stopped
    } catch (error) { evidence.cleanup.errors.push(error.message) }
    devServer = null
  }
  for (const server of staticServers) {
    try { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
    catch (error) { evidence.cleanup.errors.push(error.message) }
  }
  staticServers = []
  evidence.cleanup.staticServersStopped = true
  if (temporaryRoot && !keepTemporaryRoot) {
    try {
      fs.rmSync(temporaryRoot, { recursive: true, force: true })
      evidence.cleanup.tempTreeRemoved = true
    } catch (error) { evidence.cleanup.errors.push(error.message) }
  }
}

if (runFailure) {
  const sourceExample = path.join(repoRoot, 'examples/first-look/notebook')
  if (fs.existsSync(sourceExample)) {
    try {
      evidence.sourceExampleAfterSha256 = treeDigest(sourceExample)
      evidence.sourceExampleUnchanged = evidence.sourceExampleSha256 === evidence.sourceExampleAfterSha256
    } catch (error) { evidence.cleanup.errors.push(`Could not hash the original example after failure: ${error.message}`) }
  }
  evidence.finishedAt = new Date().toISOString()
  fs.mkdirSync(evidenceRoot, { recursive: true })
  const failurePath = path.join(evidenceRoot, `failure-${Date.now()}.json`)
  try {
    fs.writeFileSync(failurePath, `${JSON.stringify(evidence, null, 2)}\n`)
    process.stderr.write(`${JSON.stringify({ status: evidence.status, failurePath, message: runFailure.message, cleanup: evidence.cleanup, sourceExampleUnchanged: evidence.sourceExampleUnchanged })}\n`)
  } catch (writeError) {
    process.stderr.write(`${JSON.stringify({ status: evidence.status, failure: runFailure.message, evidenceWriteError: writeError.message, cleanup: evidence.cleanup })}\n`)
  }
  process.exitCode = 1
}
