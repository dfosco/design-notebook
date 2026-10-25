import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createNotebookRuntime } from '../../src/core/runtime/index.js'

const playwrightModule = process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href
  : 'playwright'
const { chromium } = await import(playwrightModule)
const chrome = process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sourceNotebookRoot = path.resolve(import.meta.dirname, '../../examples/first-look/notebook')

async function treeDigest(directory) {
  const files = []
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
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
    hash.update(await readFile(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function withTimeout(promise, label, timeoutMs = 10000) {
  let timer
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(label)), timeoutMs) }),
  ]).finally(() => clearTimeout(timer))
}

const originalDigest = await treeDigest(sourceNotebookRoot)
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'design-notebook-refresh-proof-'))
const notebookRoot = path.join(temporaryRoot, 'notebook')
const events = []
const requests = []
const routeStages = []
const websocketFrames = []
const navigations = []
const pageErrors = []
let refreshProbeActive = false
let refreshRequestFinishCount = 0
let notifyBothRefreshRequestsFinish
const bothRefreshRequestsFinish = new Promise(resolve => { notifyBothRefreshRequestsFinish = resolve })
let runtime
let browser
let page
let unsubscribe
let releaseFirstResponse
try {
  await cp(sourceNotebookRoot, notebookRoot, { recursive: true })
  const canvasPath = path.join(notebookRoot, 'research/checkout-review.canvas/checkout-review.canvas.jsonl')
  const originalSource = await readFile(canvasPath, 'utf8')
  runtime = await createNotebookRuntime({ root: notebookRoot }).then(server => server.start())
  browser = await chromium.launch({
    headless: true,
    executablePath: chrome,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-extensions', '--no-first-run'],
  })
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('request', request => {
    const url = request.url()
    if (new URL(url).pathname !== '/__notebook/graph') return
    const record = { phase: 'page-request', refreshProbeActive, url, method: request.method(), at: Date.now() }
    requests.push(record)
    console.log(JSON.stringify(record))
  })
  page.on('requestfinished', request => {
    if (new URL(request.url()).pathname !== '/__notebook/graph') return
    const record = { phase: 'page-finished', refreshProbeActive, url: request.url(), at: Date.now() }
    requests.push(record)
    console.log(JSON.stringify(record))
    if (refreshProbeActive && ++refreshRequestFinishCount === 2) notifyBothRefreshRequestsFinish(record)
  })
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname !== '/__notebook/graph') return
    requests.push({ phase: 'page-failed', url: request.url(), failure: request.failure()?.errorText, at: Date.now() })
  })
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) navigations.push({ url: frame.url(), at: Date.now() })
  })
  page.on('websocket', socket => {
    websocketFrames.push({ phase: 'opened', url: socket.url(), at: Date.now() })
    socket.on('framereceived', data => websocketFrames.push({ phase: 'received', data: String(data).slice(0, 1000), at: Date.now() }))
    socket.on('framesent', data => websocketFrames.push({ phase: 'sent', data: String(data).slice(0, 1000), at: Date.now() }))
  })
  await page.goto(runtime.address, { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.locator('.notebook-shell__artifact[data-artifact-id="checkout-review"]').click()
  await page.locator('.canvas-scene__item[data-item-id="review-note"]').waitFor({ state: 'visible', timeout: 15000 })
  refreshProbeActive = true

  let notifyRefreshOne
  let notifyRefreshTwo
  const refreshOne = new Promise(resolve => { notifyRefreshOne = resolve })
  const refreshTwo = new Promise(resolve => { notifyRefreshTwo = resolve })
  unsubscribe = runtime.onRefresh(event => {
    const snapshot = {
      revision: event.revision,
      file: event.file,
      title: event.artifacts.find(artifact => artifact.id === 'checkout-review')?.title,
      at: Date.now(),
    }
    events.push(snapshot)
    console.log(JSON.stringify({ phase: 'runtime-refresh', ...snapshot }))
    if (events.length === 1) notifyRefreshOne(snapshot)
    if (events.length === 2) notifyRefreshTwo(snapshot)
  })

  let notifyRouteOneEntry
  let notifyRouteOneFetch
  let notifyRouteTwoEntry
  let notifyRouteTwoFetch
  let notifyRouteTwoFulfill
  const routeOneEntry = new Promise(resolve => { notifyRouteOneEntry = resolve })
  const routeOneFetch = new Promise(resolve => { notifyRouteOneFetch = resolve })
  let notifyRouteOneFulfill
  const routeOneFulfill = new Promise(resolve => { notifyRouteOneFulfill = resolve })
  const routeTwoEntry = new Promise(resolve => { notifyRouteTwoEntry = resolve })
  const routeTwoFetch = new Promise(resolve => { notifyRouteTwoFetch = resolve })
  const routeTwoFulfill = new Promise(resolve => { notifyRouteTwoFulfill = resolve })
  const firstResponseHold = new Promise(resolve => { releaseFirstResponse = resolve })
  let graphRouteCount = 0
  const recordRouteStage = record => {
    routeStages.push(record)
    console.log(JSON.stringify(record))
  }
  await page.route('**/__notebook/graph', async route => {
    const number = ++graphRouteCount
    const record = { phase: 'route-enter', number, url: route.request().url(), at: Date.now() }
    recordRouteStage(record)
    if (number === 1) notifyRouteOneEntry(record)
    if (number === 2) notifyRouteTwoEntry(record)
    record.fetchStartedAt = Date.now()
    recordRouteStage({ phase: 'route-fetch-start', number, at: record.fetchStartedAt })
    const response = await route.fetch()
    record.fetchCompletedAt = Date.now()
    record.status = response.status()
    recordRouteStage({ phase: 'route-fetch-complete', number, status: record.status, at: record.fetchCompletedAt })
    if (number === 1) {
      notifyRouteOneFetch(record)
      await firstResponseHold
      await route.fulfill({ response })
      const fulfilled = { phase: 'route-fulfilled', number, at: Date.now() }
      recordRouteStage(fulfilled)
      notifyRouteOneFulfill(fulfilled)
      return
    }
    if (number === 2) notifyRouteTwoFetch(record)
    await route.fulfill({ response })
    recordRouteStage({ phase: 'route-fulfilled', number, at: Date.now() })
    if (number === 2) notifyRouteTwoFulfill(record)
  })

  const initialLines = originalSource.trimEnd().split('\n')
  assert.equal(await readFile(canvasPath, 'utf8'), originalSource, 'Canvas must still match the source snapshot before refresh writes.')
  const olderLines = initialLines.slice()
  const olderHeader = JSON.parse(olderLines[0])
  olderHeader.title = 'Borrow flow review older refresh'
  olderLines[0] = JSON.stringify(olderHeader)
  olderLines.push(JSON.stringify({
    event: 'widget_added',
    widget: { id: 'refresh-proof-note', type: 'sticky-note', position: { x: -160, y: 920 }, props: { text: 'Older refresh', width: 240, height: 120 } },
  }))
  await writeFile(canvasPath, `${olderLines.join('\n')}\n`)
  await withTimeout(Promise.all([refreshOne, routeOneEntry, routeOneFetch]), 'First refresh did not reach the graph route and complete route.fetch().')

  const latestLines = olderLines.slice()
  const latestHeader = JSON.parse(latestLines[0])
  latestHeader.title = 'Borrow flow review latest refresh'
  latestLines[0] = JSON.stringify(latestHeader)
  latestLines.push(JSON.stringify({
    event: 'widget_added',
    widget: { id: 'refresh-latest-note', type: 'sticky-note', position: { x: -80, y: 880 }, props: { text: 'Latest refresh', width: 260, height: 120 } },
  }))
  await writeFile(canvasPath, `${latestLines.join('\n')}\n`)
  await withTimeout(Promise.all([refreshTwo, routeTwoEntry, routeTwoFetch, routeTwoFulfill]), 'Second refresh did not pass all runtime and route stages.')
  await page.getByRole('heading', { name: 'Borrow flow review latest refresh' }).waitFor({ state: 'visible', timeout: 10000 })
  await page.locator('.canvas-scene__item[data-item-id="refresh-latest-note"]').waitFor({ state: 'visible', timeout: 10000 })
  releaseFirstResponse()
  await withTimeout(Promise.all([routeOneFulfill, bothRefreshRequestsFinish]), 'Both graph requests did not finish after releasing the older response.')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  const report = {
    url: runtime.address,
    refreshEvents: events,
    pageRequests: requests,
    graphRouteStages: routeStages,
    websocketFrames,
    navigations,
    latestTitleAfterOlderRelease: await page.locator('.notebook-shell__header h1').textContent(),
    latestPlacementId: await page.locator('.canvas-scene__item[data-item-id="refresh-latest-note"]').getAttribute('data-item-id'),
    pageErrors,
    originalDigest,
    canvasUnchangedByViewingBeforeWrites: true,
  }
  console.log(JSON.stringify(report, null, 2))
  assert.equal(events.length, 2, 'Two filesystem writes must produce two runtime refresh revisions.')
  assert.equal(graphRouteCount, 2, 'Both graph refreshes must reach the browser route.')
  assert.equal(report.latestTitleAfterOlderRelease, 'Borrow flow review latest refresh', 'The late older graph response must not overwrite the latest graph.')
  assert.deepEqual(pageErrors, [])
} catch (error) {
  console.error(JSON.stringify({
    phase: 'refresh-diagnostic-failure',
    error: { name: error.name, message: error.message },
    refreshEvents: events,
    pageRequests: requests,
    graphRouteStages: routeStages,
    websocketFrames,
    navigations,
    pageErrors,
    url: page?.url() ?? null,
    documentState: page ? await page.evaluate(() => ({
      title: document.querySelector('.notebook-shell__header h1')?.textContent,
      canvasItemIds: [...document.querySelectorAll('.canvas-scene__item')].map(item => item.dataset.itemId),
      diagnostics: [...document.querySelectorAll('.notebook-shell__diagnostics li')].map(item => item.textContent),
    })).catch(captureError => ({ captureError: captureError.message })) : null,
  }, null, 2))
  throw error
} finally {
  releaseFirstResponse?.()
  unsubscribe?.()
  try { await browser?.close() } finally {
    try { await runtime?.close() } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  }
  assert.equal(await treeDigest(sourceNotebookRoot), originalDigest, 'The checked-in starter tree must remain byte-identical.')
}
