import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createNotebookRuntime } from '../../src/core/runtime/index.js'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const sourceNotebookRoot = path.join(repositoryRoot, 'examples/first-look/notebook')
const playwrightPath = process.env.PLAYWRIGHT_MODULE
  ? path.resolve(process.env.PLAYWRIGHT_MODULE)
  : '/Users/danielfosco/.paseo/worktrees/1qqnmvz3/noxious-mayfly/node_modules/playwright/index.mjs'
const chrome = process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const startedAt = new Date()
const stamp = startedAt.toISOString().replaceAll(':', '-').replaceAll('.', '-')
const evidencePath = path.join(os.tmpdir(), `design-notebook-refresh-diagnostic-${stamp}.json`)
const screenshotPath = path.join(os.tmpdir(), `design-notebook-refresh-diagnostic-${stamp}.png`)

async function treeDigest(directory) {
  const files = []
  async function visit(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile()) files.push(absolute)
    }
  }
  await visit(directory)
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    hash.update(path.relative(directory, file).split(path.sep).join('/'))
    hash.update('\0')
    hash.update(await fs.readFile(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function payloadString(frame) {
  const payload = frame?.payload ?? frame
  return Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload)
}

function parseFrame(frame) {
  const raw = payloadString(frame)
  try { return { raw, json: JSON.parse(raw) } } catch { return { raw } }
}

function withTimeout(promise, label, timeoutMs = 8000) {
  let timer
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(label)), timeoutMs) }),
  ]).finally(() => clearTimeout(timer))
}

const trace = {
  startedAt: startedAt.toISOString(),
  evidencePath,
  sourceNotebookRoot,
  playwrightPath,
  chrome,
  originalDigest: await treeDigest(sourceNotebookRoot),
  events: [],
  watcherEvents: [],
  websocket: [],
  browserRequests: [],
  route: [],
  navigations: [],
  pageErrors: [],
  classifications: [],
  graphBodiesConsumed: [],
  graphResponseAnnotations: [],
  cleanup: {},
}
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-notebook-refresh-browser-'))
const notebookRoot = path.join(temporaryRoot, 'notebook')
const canvasPath = path.join(notebookRoot, 'research/checkout-review.canvas/checkout-review.canvas.jsonl')
const runtimeRefreshOne = deferred()
const runtimeRefreshTwo = deferred()
const wsRefreshOne = deferred()
const wsRefreshTwo = deferred()
const clientFetchOne = deferred()
const clientFetchTwo = deferred()
const routeOneEntry = deferred()
const routeOneFetch = deferred()
const routeTwoEntry = deferred()
const routeTwoFetch = deferred()
const routeTwoFulfill = deferred()
const routeOneFulfill = deferred()
const releaseFirstRoute = deferred()
let browser
let page
let runtime
let unsubscribe
let graphRouteCount = 0
let graphPageRequestCount = 0
let probeActive = false
let expectedFailure = null

function record(target, value) {
  const item = { elapsedMs: Date.now() - Date.parse(trace.startedAt), ...value }
  trace[target].push(item)
  return item
}

async function persist(stage) {
  trace.lastSavedStage = stage
  trace.lastSavedAt = new Date().toISOString()
  await fs.writeFile(evidencePath, `${JSON.stringify(trace, null, 2)}\n`)
}

try {
  await fs.cp(sourceNotebookRoot, notebookRoot, { recursive: true })
  const originalCanvas = await fs.readFile(canvasPath, 'utf8')
  runtime = await createNotebookRuntime({ root: notebookRoot }).then(server => server.start())
  runtime.server.watcher.on('all', (event, file) => record('watcherEvents', {
    event,
    file: path.relative(notebookRoot, file).split(path.sep).join('/'),
  }))
  unsubscribe = runtime.onRefresh(event => {
    const item = record('events', {
      revision: event.revision,
      file: event.file,
      canvasTitle: event.artifacts.find(artifact => artifact.id === 'checkout-review')?.canvasTitle ?? null,
      available: event.artifacts.find(artifact => artifact.id === 'checkout-review')?.available,
    })
    if (event.revision === 1) runtimeRefreshOne.resolve(item)
    if (event.revision === 2) runtimeRefreshTwo.resolve(item)
  })

  browser = await chromium.launch({
    headless: true,
    executablePath: chrome,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-extensions', '--no-first-run'],
  })
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', error => trace.pageErrors.push(error.message))
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) record('navigations', { url: frame.url() })
  })
  page.on('request', request => {
    if (new URL(request.url()).pathname !== '/__notebook/graph') return
    record('browserRequests', { phase: 'request', url: request.url(), method: request.method(), probeActive })
    if (!probeActive) return
    graphPageRequestCount += 1
    if (graphPageRequestCount === 1) clientFetchOne.resolve()
    if (graphPageRequestCount === 2) clientFetchTwo.resolve()
  })
  page.on('requestfinished', request => {
    if (new URL(request.url()).pathname === '/__notebook/graph') record('browserRequests', {
      phase: 'finished', url: request.url(), probeActive,
    })
  })
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname === '/__notebook/graph') record('browserRequests', {
      phase: 'failed', url: request.url(), failure: request.failure()?.errorText ?? null, probeActive,
    })
  })
  page.on('websocket', socket => {
    record('websocket', { phase: 'opened', url: socket.url() })
    socket.on('framereceived', frame => {
      const parsed = parseFrame(frame)
      const json = parsed.json
      const item = record('websocket', {
        phase: 'received', raw: parsed.raw.slice(0, 4000),
        ...(json && typeof json === 'object' ? { type: json.type, event: json.event, revision: json.data?.revision } : {}),
      })
      if (json?.type === 'custom' && json.event === 'design-notebook:refresh') {
        if (json.data?.revision === 1) wsRefreshOne.resolve(item)
        if (json.data?.revision === 2) wsRefreshTwo.resolve(item)
      }
    })
    socket.on('framesent', frame => {
      const parsed = parseFrame(frame)
      record('websocket', { phase: 'sent', raw: parsed.raw.slice(0, 2000), type: parsed.json?.type })
    })
    socket.on('socketerror', message => record('websocket', { phase: 'error', message }))
    socket.on('close', () => record('websocket', { phase: 'closed' }))
  })
  await page.addInitScript(() => {
    const entries = []
    const graphBodies = []
    Object.defineProperty(window, '__designNotebookFetchTrace', { value: entries, configurable: false })
    Object.defineProperty(window, '__designNotebookGraphBodiesConsumed', { value: graphBodies, configurable: false })
    Object.defineProperty(window, '__designNotebookRefreshProbeActive', { value: false, writable: true, configurable: false })
    const originalJson = Response.prototype.json
    Response.prototype.json = async function () {
      const value = await originalJson.call(this)
      let url
      try { url = new URL(this.url, location.href) } catch { return value }
      if (url.pathname === '/__notebook/graph') {
        graphBodies.push({ title: value.artifacts?.find(item => item.id === 'checkout-review')?.title, at: performance.now() })
      }
      return value
    }
    const originalFetch = window.fetch.bind(window)
    window.fetch = (...args) => {
      const input = args[0]
      const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url
      let url
      try { url = new URL(rawUrl, location.href) } catch { return originalFetch(...args) }
      if (url.pathname !== '/__notebook/graph') return originalFetch(...args)
      const item = { phase: 'fetch-start', url: url.href, active: window.__designNotebookRefreshProbeActive, at: performance.now() }
      entries.push(item)
      const promise = originalFetch(...args)
      return promise.then(response => {
        entries.push({ ...item, phase: 'fetch-complete', status: response.status, at: performance.now() })
        return response
      }, error => {
        entries.push({ ...item, phase: 'fetch-failed', error: String(error), at: performance.now() })
        throw error
      })
    }
  })
  await page.goto(runtime.address, { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.locator('.notebook-shell__artifact[data-artifact-id="checkout-review"]').waitFor({ state: 'visible', timeout: 15000 })
  await page.locator('.notebook-shell__artifact[data-artifact-id="checkout-review"]').click()
  await page.locator('.canvas-scene__item[data-item-id="review-note"]').waitFor({ state: 'visible', timeout: 15000 })
  await withTimeout((async () => {
    while (!trace.websocket.some(item => item.type === 'connected')) await new Promise(resolve => setTimeout(resolve, 10))
  })(), 'Vite HMR WebSocket did not report connected.')
  trace.startupGraphFetches = await page.evaluate(() => window.__designNotebookFetchTrace.filter(item => item.phase === 'fetch-start'))
  assert.ok(trace.startupGraphFetches.length >= 1, 'Fetch instrumentation should see the initial graph request before the race.')

  await page.route('**/__notebook/graph', async route => {
    const number = ++graphRouteCount
    const recordStage = (phase, extra = {}) => record('route', {
      phase, number, url: route.request().url(), ...extra,
    })
    recordStage('entry')
    if (number === 1) routeOneEntry.resolve()
    if (number === 2) routeTwoEntry.resolve()
    recordStage('fetch-start')
    const response = await route.fetch()
    recordStage('fetch-complete', { status: response.status() })
    const graph = await response.json()
    const annotation = number === 1 ? 'Graph response one (older)' : 'Graph response two (latest)'
    const artifact = graph.artifacts?.find(item => item.id === 'checkout-review')
    if (artifact) artifact.title = annotation
    const annotateEntries = entries => {
      for (const entry of entries ?? []) {
        if (entry?.type === 'artifact' && entry.artifact?.id === 'checkout-review') entry.artifact.title = annotation
        annotateEntries(entry?.children)
      }
    }
    annotateEntries(graph.entries)
    trace.graphResponseAnnotations.push({ request: number, title: annotation, artifactFound: Boolean(artifact) })
    if (number === 1) {
      routeOneFetch.resolve({ status: response.status() })
      await releaseFirstRoute.promise
    }
    if (number === 2) routeTwoFetch.resolve({ status: response.status() })
    const headers = { ...response.headers() }
    delete headers['content-length']
    delete headers['content-encoding']
    await route.fulfill({ status: response.status(), headers, body: JSON.stringify(graph) })
    recordStage('fulfilled', { status: response.status() })
    if (number === 1) routeOneFulfill.resolve()
    if (number === 2) routeTwoFulfill.resolve({ status: response.status() })
  })
  await page.evaluate(() => { window.__designNotebookRefreshProbeActive = true })
  probeActive = true

  const baseline = originalCanvas.trimEnd().split('\n')
  const olderLines = baseline.slice()
  const olderHeader = JSON.parse(olderLines[0])
  olderHeader.title = 'Borrow flow review older refresh'
  olderLines[0] = JSON.stringify(olderHeader)
  olderLines.push(JSON.stringify({
    event: 'widget_added',
    widget: { id: 'refresh-proof-note', type: 'sticky-note', position: { x: -160, y: 920 }, props: { text: 'Older refresh', width: 240, height: 120 } },
  }))
  assert.equal(await fs.readFile(canvasPath, 'utf8'), originalCanvas, 'Temporary Canvas starts with the starter source.')
  await fs.writeFile(canvasPath, `${olderLines.join('\n')}\n`)
  await withTimeout(Promise.all([runtimeRefreshOne.promise, wsRefreshOne.promise, clientFetchOne.promise, routeOneEntry.promise, routeOneFetch.promise]),
    'First refresh failed to prove the runtime event → WebSocket → client fetch → route.fetch chain.')
  assert.equal((await routeOneFetch.promise).status, 200, 'First graph request should reach the runtime and return 200 before it is held.')
  const pageFetchAfterFirst = await page.evaluate(() => window.__designNotebookFetchTrace.filter(item => item.phase === 'fetch-start' && item.active).length)
  assert.equal(pageFetchAfterFirst, 1, 'The first known refresh must produce exactly one client graph fetch.')
  trace.classifications.push('First refresh instrumentation verified through browser fetch and route.fetch 200.')

  const latestLines = olderLines.slice()
  const latestHeader = JSON.parse(latestLines[0])
  latestHeader.title = 'Borrow flow review latest refresh'
  latestLines[0] = JSON.stringify(latestHeader)
  latestLines.push(JSON.stringify({
    event: 'widget_added',
    widget: { id: 'refresh-latest-note', type: 'sticky-note', position: { x: -80, y: 880 }, props: { text: 'Latest refresh', width: 260, height: 120 } },
  }))
  await fs.writeFile(canvasPath, `${latestLines.join('\n')}\n`)
  const [eventTwo, wsTwo] = await withTimeout(Promise.all([runtimeRefreshTwo.promise, wsRefreshTwo.promise]),
    'Runtime refresh revision 2 or the matching browser WebSocket frame was not observed.')
  trace.classifications.push(`Second runtime refresh revision ${eventTwo.revision}; WebSocket delivered revision ${wsTwo.revision}.`)

  try {
    await withTimeout(Promise.all([clientFetchTwo.promise, routeTwoEntry.promise, routeTwoFetch.promise, routeTwoFulfill.promise]),
      'Revision 2 was delivered but the second graph request did not pass client fetch and route stages.', 3000)
    trace.classifications.push('Second graph fetch completed and fulfilled while the first response remained held.')
    await page.getByRole('heading', { name: 'Graph response two (latest)' }).waitFor({ state: 'visible', timeout: 8000 })
    await page.locator('.canvas-scene__item[data-item-id="refresh-latest-note"]').waitFor({ state: 'visible', timeout: 8000 })
    releaseFirstRoute.resolve()
    await withTimeout(routeOneFulfill.promise, 'First graph response was not fulfilled after release.')
    await page.waitForFunction(() => window.__designNotebookGraphBodiesConsumed.some(item => item.title === 'Graph response one (older)'), null, { timeout: 8000 })
    trace.graphBodiesConsumed = await page.evaluate(() => window.__designNotebookGraphBodiesConsumed)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const latestAfterStale = await page.locator('.notebook-shell__header h1').textContent()
    trace.classifications.push('The first response was fulfilled, consumed by the browser, and had render frames to apply; the newer graph snapshot remained selected.')
    assert.equal(latestAfterStale, 'Graph response two (latest)')
    assert.equal((await page.locator('.canvas-scene__item[data-item-id="refresh-latest-note"]').count()), 1)
  } catch (error) {
    expectedFailure = error
    trace.failure = { name: error.name, message: error.message }
    trace.classifications.push('The graph refresh assertion did not complete; inspect request stages, consumed graph bodies, rendered heading, and failure details.')
  }

  trace.pageFetches = await page.evaluate(() => window.__designNotebookFetchTrace)
  trace.pageStateBeforeCleanup = await page.evaluate(() => ({
    title: document.querySelector('.notebook-shell__header h1')?.textContent,
    itemIds: [...document.querySelectorAll('.canvas-scene__item')].map(item => item.dataset.itemId),
    diagnostics: [...document.querySelectorAll('.notebook-shell__diagnostics li')].map(item => item.textContent),
  }))
  if (expectedFailure) {
    trace.failure = { name: expectedFailure.name, message: expectedFailure.message }
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(error => { trace.screenshotError = error.message })
    trace.screenshotPath = screenshotPath
  } else {
    trace.latestTitleAfterReleasingOlderResponse = await page.locator('.notebook-shell__header h1').textContent()
    assert.equal(trace.latestTitleAfterReleasingOlderResponse, 'Graph response two (latest)', 'Late older graph response must not replace the newest graph snapshot.')
    assert.equal(graphRouteCount, 2)
    assert.deepEqual(trace.pageErrors, [])
  }
} catch (error) {
  trace.failure ??= { name: error.name, message: error.message }
  if (page) {
    trace.pageFetches = await page.evaluate(() => window.__designNotebookFetchTrace ?? []).catch(() => [])
    trace.pageStateBeforeCleanup = await page.evaluate(() => ({
      title: document.querySelector('.notebook-shell__header h1')?.textContent,
      itemIds: [...document.querySelectorAll('.canvas-scene__item')].map(item => item.dataset.itemId),
      diagnostics: [...document.querySelectorAll('.notebook-shell__diagnostics li')].map(item => item.textContent),
    })).catch(error => ({ captureError: error.message }))
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(error => { trace.screenshotError = error.message })
    trace.screenshotPath = screenshotPath
  }
} finally {
  await persist('before-cleanup')
  releaseFirstRoute.resolve()
  unsubscribe?.()
  try { await browser?.close(); trace.cleanup.browserClosed = true } catch (error) { trace.cleanup.browserError = error.message }
  try { await runtime?.close(); trace.cleanup.runtimeClosed = true } catch (error) { trace.cleanup.runtimeError = error.message }
  try { await fs.rm(temporaryRoot, { recursive: true, force: true }); trace.cleanup.temporaryRootRemoved = true } catch (error) { trace.cleanup.temporaryRootError = error.message }
  trace.finalDigest = await treeDigest(sourceNotebookRoot)
  trace.cleanup.originalDigestPreserved = trace.finalDigest === trace.originalDigest
  trace.cleanup.evidencePath = evidencePath
  trace.completedAt = new Date().toISOString()
  await persist('after-cleanup')
}

console.log(JSON.stringify({ evidencePath, screenshotPath: trace.screenshotPath ?? null, classifications: trace.classifications, failure: trace.failure ?? null, cleanup: trace.cleanup }, null, 2))
if (trace.failure || expectedFailure || !trace.cleanup.originalDigestPreserved) process.exitCode = 1
