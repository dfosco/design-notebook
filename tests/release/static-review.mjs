import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const statePath = process.env.RELEASE_EVIDENCE
if (!statePath) throw new Error('Set RELEASE_EVIDENCE to the retained consumer-qualification prepared JSON.')
const playwrightPath = process.env.PLAYWRIGHT_MODULE
if (!playwrightPath) throw new Error('Set PLAYWRIGHT_MODULE to the already-installed Playwright ESM entry.')
const { chromium } = await import(pathToFileURL(path.resolve(playwrightPath)).href)
const chromePath = process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const evidence = {
  formatVersion: 1,
  phase: 'packed-consumer-static-browser-review',
  status: 'running',
  startedAt: new Date().toISOString(),
  consumerEvidencePath: path.resolve(statePath),
  outputs: [],
  failures: [],
  cleanup: { browserClosed: false, serversClosed: false, errors: [] },
}
const runId = evidence.startedAt.replaceAll(':', '-').replaceAll('.', '-')
const staticServers = []
let browser
let failure

function digestFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
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

function canvasBoardOrigin(canvasJsonlPath) {
  const placements = new Map()
  for (const line of fs.readFileSync(canvasJsonlPath, 'utf8').split(/\r?\n/).filter(Boolean)) {
    const record = JSON.parse(line)
    if (record.event === 'canvas_created') {
      for (const widget of record.widgets ?? []) {
        placements.set(widget.id, { x: widget.position?.x ?? 0, y: widget.position?.y ?? 0 })
      }
    } else if (record.event === 'widget_added') {
      const widget = record.widget
      placements.set(widget.id, { x: widget.position?.x ?? 0, y: widget.position?.y ?? 0 })
    } else if (record.event === 'widget_moved') {
      const current = placements.get(record.widgetId)
      if (current && record.position) placements.set(record.widgetId, { ...current, x: record.position.x, y: record.position.y })
    } else if (record.event === 'widget_removed') {
      placements.delete(record.widgetId)
    }
  }
  const left = Math.min(0, ...[...placements.values()].map(placement => placement.x))
  const top = Math.min(0, ...[...placements.values()].map(placement => placement.y))
  // The pinned Tiny Canvas adapter's computeCanvasBoardGeometry uses a 128px board margin.
  return { x: left - 128, y: top - 128 }
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
        if (cacheIndex >= 0) viteCacheFiles.push({ path: relative, sha256: crypto.createHash('sha256').update(bytes).digest('hex') })
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

function serveStatic(root, prefix) {
  const serverPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`
  const faviconResponses = []
  const server = http.createServer((request, response) => {
    let pathname
    try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://static.invalid').pathname) } catch {
      response.writeHead(400).end('Bad path')
      return
    }
    if (pathname === '/favicon.ico') {
      faviconResponses.push({ requestUrl: request.url, pathname, status: 204, at: new Date().toISOString() })
      response.writeHead(204).end()
      return
    }
    if (!pathname.startsWith(serverPrefix)) {
      response.writeHead(404).end('Not found')
      return
    }
    const relative = pathname.slice(serverPrefix.length)
    let file = path.resolve(root, ...relative.split('/').filter(Boolean))
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      response.writeHead(404).end('Not found')
      return
    }
    try {
      if (fs.statSync(file).isDirectory()) {
        if (!pathname.endsWith('/')) {
          const query = new URL(request.url ?? '/', 'http://static.invalid').search
          response.writeHead(301, { location: pathname + '/' + query }).end()
          return
        }
        file = path.join(file, 'index.html')
      }
    } catch {
      response.writeHead(404).end('Not found')
      return
    }
    let bytes
    try { bytes = fs.readFileSync(file) } catch {
      response.writeHead(404).end('Not found')
      return
    }
    const contentTypes = {
      '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8', '.jsonl': 'application/x-ndjson; charset=utf-8', '.svg': 'image/svg+xml',
      '.woff': 'font/woff', '.woff2': 'font/woff2',
    }
    response.writeHead(200, { 'content-type': contentTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': bytes.length })
    if (request.method === 'HEAD') response.end()
    else response.end(bytes)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      const address = server.address()
      resolve({ server, origin: `http://127.0.0.1:${address.port}${serverPrefix}`, requests: [], faviconResponses })
    })
  })
}

async function closeServer(server) {
  if (!server.listening) return
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

async function proveImage(locator, base, relative, label) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 })
  await locator.scrollIntoViewIfNeeded()
  const image = await locator.evaluate(async element => {
    await element.decode()
    const rect = element.getBoundingClientRect()
    return {
      src: element.currentSrc,
      alt: element.alt,
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    }
  })
  const url = new URL(image.src)
  assert.equal(url.pathname, `${base}${relative}`, `${label} used an unexpected output path.`)
  assert.ok(image.naturalWidth > 0 && image.naturalHeight > 0, `${label} did not decode.`)
  return image
}

async function canvasBlockGeometry(page, widgetId, boardOrigin) {
  const block = page.locator(`.tc-canvas article.tc-block[data-block-id="${widgetId}"]`)
  await block.waitFor({ state: 'visible', timeout: 15_000 })
  return block.evaluate((element, origin) => {
    const transform = getComputedStyle(element).transform
    const matrix = transform === 'none' ? new DOMMatrix() : new DOMMatrix(transform)
    return {
      x: matrix.m41 + origin.x,
      y: matrix.m42 + origin.y,
      width: Number.parseFloat(element.style.width),
      height: Number.parseFloat(element.style.height),
    }
  }, boardOrigin)
}

async function tinyCanvasGeometryStorage(page, widgetIds) {
  return page.evaluate(ids => {
    const source = localStorage.getItem('tiny-canvas-queue')
    if (!source) return []
    const records = JSON.parse(source)
    if (!Array.isArray(records)) throw new TypeError('Tiny Canvas storage queue is not an array.')
    return records.filter(record => ids.includes(record?.id) && ['x', 'y', 'width', 'height'].some(key => Object.hasOwn(record, key)))
  }, widgetIds)
}

async function captureReviewScreenshot(page, archiveHash, runId, outputName, stage) {
  const directory = path.join(repositoryRoot, 'tests/release/evidence')
  fs.mkdirSync(directory, { recursive: true })
  const screenshotPath = path.join(directory, `${archiveHash}.${runId}.${outputName}.${stage}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  return { path: path.relative(repositoryRoot, screenshotPath).split(path.sep).join('/'), sha256: digestFile(screenshotPath) }
}

async function snapshot(page) {
  return page.evaluate(() => ({
    url: location.href,
    title: document.title,
    heading: document.querySelector('[data-notebook-artifact-title]')?.textContent,
    diagnostics: [...document.querySelectorAll('.notebook-shell__diagnostics li')].map(item => ({ code: item.dataset.diagnosticCode, text: item.textContent })),
    visibleArtifactIds: [...document.querySelectorAll('[data-artifact-id][data-artifact-kind]')].map(item => item.dataset.artifactId),
    bodyText: document.body.innerText.slice(0, 8000),
  }))
}

async function runBase(context, output, base, outputName, runId, archiveHash, boardOrigin) {
  const server = await serveStatic(output.outputRoot, base)
  staticServers.push(server.server)
  const page = await context.newPage({ viewport: { width: 1365, height: 950 } })
  const httpFailures = []
  const requestFailures = []
  const pageErrors = []
  const consoleErrors = []
  const staticRequests = []
  const geometryPosts = []
  const screenshots = []
  let phase = 'open-static-shell'
  page.on('response', response => {
    if (response.status() >= 400) httpFailures.push({ url: response.url(), status: response.status() })
  })
  page.on('request', request => {
    const url = new URL(request.url())
    if (request.method() === 'POST' && /^\/__notebook\/artifacts\/[^/]+\/geometry$/.test(url.pathname)) {
      geometryPosts.push({ url: url.href, method: request.method() })
    }
  })
  page.on('requestfailed', request => requestFailures.push({ url: request.url(), failure: request.failure()?.errorText }))
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })

  const originalRequest = server.server.listeners('request')[0]
  server.server.removeListener('request', originalRequest)
  server.server.on('request', (request, response) => {
    staticRequests.push(request.url)
    originalRequest(request, response)
  })

  try {
    const url = `${server.origin}borrow-flow/confirmation`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await page.locator('[data-notebook-artifact-title]').waitFor({ state: 'visible', timeout: 15_000 })
    const graphDisclosure = page.locator('.notebook-shell__graph-diagnostics')
    await graphDisclosure.locator('summary').click()
    const graphDiagnostics = await graphDisclosure.locator('li').evaluateAll(nodes => nodes.map(node => ({ code: node.dataset.diagnosticCode ?? '', text: node.innerText.trim() })))
    assert.equal(await page.locator('[data-artifact-id][data-artifact-kind]').count(), 64, 'The packaged mixed-folder graph should render all 64 artifacts.')
    assert.ok(graphDiagnostics.some(item => item.code === 'CANVAS_EVENT_HISTORY_EXCLUDED'), 'Static diagnostics should disclose omitted canvas event history.')
    assert.ok(graphDiagnostics.some(item => item.code === 'SITE_LOCAL_REFERENCE_EXCLUDED'), 'Static diagnostics should disclose excluded local Site data.')

    phase = 'prototype-route-and-direct-refresh'
    await page.frameLocator('.notebook-shell__prototype-frame').getByRole('heading', { name: 'Your hold is in the queue' }).waitFor({ state: 'visible', timeout: 20_000 })
    screenshots.push(await captureReviewScreenshot(page, archiveHash, runId, outputName, 'shell-prototype'))
    const selectedView = page.locator('.notebook-shell__view-select select')
    assert.equal(await selectedView.inputValue(), 'confirmation')
    const requestUrl = new URL(page.url())
    assert.equal(requestUrl.pathname, `${base}borrow-flow/confirmation`)
    assert.equal(requestUrl.searchParams.has('artifact'), false, 'Generated prototype routes must not use the legacy artifact query.')
    const framePath = new URL(await page.locator('.notebook-shell__prototype-frame').getAttribute('src')).pathname
    assert.equal(framePath, `${base}prototypes/borrow-flow/confirmation`)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.frameLocator('.notebook-shell__prototype-frame').getByRole('heading', { name: 'Your hold is in the queue' }).waitFor({ state: 'visible', timeout: 20_000 })
    assert.equal(await selectedView.inputValue(), 'confirmation', 'Refresh did not preserve the selected prototype state.')
    await selectedView.selectOption('request')
    await page.frameLocator('.notebook-shell__prototype-frame').getByRole('heading', { name: 'The Shape of Small Things' }).waitFor({ state: 'visible', timeout: 20_000 })
    assert.equal(new URL(page.url()).pathname, `${base}borrow-flow/request`, 'Selecting a prototype view should navigate to its canonical public path.')
    assert.equal(new URL(await page.locator('.notebook-shell__prototype-frame').getAttribute('src')).pathname, `${base}prototypes/borrow-flow/request`)

    phase = 'moved-group-navigation'
    const group = page.locator('[data-folder-path="workspace"] button[aria-expanded]')
    await group.waitFor({ state: 'visible', timeout: 10_000 })
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
    const reviewGroup = page.locator('[data-folder-path="workspace/review-cycle"] button[aria-expanded]')
    await reviewGroup.waitFor({ state: 'visible', timeout: 10_000 })
    if (await reviewGroup.getAttribute('aria-expanded') !== 'true') await reviewGroup.click()
    await page.locator('[data-folder-path="workspace/review-cycle/scale"] button[aria-expanded]').waitFor({ state: 'visible', timeout: 10_000 })

    phase = 'document-resources'
    await page.goto(`${server.origin}docs/checkout-rationale`, { waitUntil: 'domcontentloaded' })
    await page.locator('.doc-renderer h1').waitFor({ state: 'visible', timeout: 15_000 })
    assert.equal(new URL(page.url()).pathname, `${base}docs/checkout-rationale`)
    assert.equal(new URL(page.url()).searchParams.has('artifact'), false)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.doc-renderer h1').waitFor({ state: 'visible', timeout: 15_000 })
    const docBase = 'notebook-assets/workspace/review-cycle/assets/release-doc.svg'
    const markdownImage = await proveImage(page.locator('.doc-renderer img[alt="Release Markdown image"]'), base, docBase, 'Nested Markdown image')
    const componentImage = await proveImage(page.locator('.doc-renderer img[alt="Release component image"]'), base, docBase, 'Nested Image component')
    screenshots.push(await captureReviewScreenshot(page, archiveHash, runId, outputName, 'shell-document-resources'))

    phase = 'canvas-resources-and-fallback'
    await page.goto(`${server.origin}canvas/checkout-review`, { waitUntil: 'domcontentloaded' })
    await page.locator('.tc-canvas').waitFor({ state: 'visible', timeout: 15_000 })
    assert.equal(new URL(page.url()).pathname, `${base}canvas/checkout-review`)
    assert.equal(new URL(page.url()).searchParams.has('artifact'), false)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.tc-canvas').waitFor({ state: 'visible', timeout: 15_000 })
    const canvasImageBlock = page.locator('.tc-canvas article.tc-block[data-block-id="release-proof-image"]')
    await canvasImageBlock.locator('img').waitFor({ state: 'visible', timeout: 15_000 })
    const canvasImage = await proveImage(canvasImageBlock.locator('img'), base, 'notebook-assets/workspace/review-cycle/checkout-review.canvas/assets/release-canvas.svg', 'Canvas image')
    const unknownFallback = page.locator('.tc-canvas article.tc-block[data-block-id="chart-reference"] .canvas-scene__fallback')
    await unknownFallback.waitFor({ state: 'visible', timeout: 10_000 })
    const unknownFallbackText = await unknownFallback.innerText()
    assert.match(unknownFallbackText, /The circulation chart is not included/)
    const sitePlacement = page.locator('.tc-canvas article.tc-block[data-block-id="catalog-view"]')
    const siteScreenshot = await proveImage(sitePlacement.locator('img'), base, 'notebook-assets/workspace/review-cycle/catalog.site/assets/catalog-home.svg', 'Canvas Site screenshot')
    assert.equal(await sitePlacement.locator('iframe').count(), 0, 'Static Canvas Site must not contain an iframe.')
    assert.equal(await sitePlacement.locator('a').getAttribute('href'), 'https://example.com/books')
    screenshots.push(await captureReviewScreenshot(page, archiveHash, runId, outputName, 'shell-canvas-resources'))

    phase = 'static-canvas-native-temporary-geometry'
    const geometryWidgetIds = ['prototype-preview', 'confirmation-preview', 'catalog-view', 'review-note', 'chart-reference', 'release-proof-image']
    const note = page.locator('.tc-canvas article.tc-block[data-block-id="review-note"]')
    await note.scrollIntoViewIfNeeded()
    const geometryBefore = await canvasBlockGeometry(page, 'review-note', boardOrigin)
    const localStorageGeometryBefore = await tinyCanvasGeometryStorage(page, geometryWidgetIds)
    assert.deepEqual(localStorageGeometryBefore, [], 'Static canvas geometry must not be stored in Tiny Canvas localStorage.')
    const noteBox = await note.boundingBox()
    assert.ok(noteBox, 'Tiny Canvas review note must have a measurable native block.')
    await page.mouse.move(noteBox.x + noteBox.width / 2, noteBox.y + noteBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(noteBox.x + noteBox.width / 2 + 56, noteBox.y + noteBox.height / 2 + 38, { steps: 6 })
    await page.mouse.up()
    await page.waitForFunction(({ id, x, y, origin }) => {
      const element = document.querySelector(`.tc-canvas article.tc-block[data-block-id="${id}"]`)
      if (!element) return false
      const transform = getComputedStyle(element).transform
      const matrix = transform === 'none' ? new DOMMatrix() : new DOMMatrix(transform)
      const currentX = matrix.m41 + origin.x
      const currentY = matrix.m42 + origin.y
      return Math.abs(currentX - x) > 20 || Math.abs(currentY - y) > 20
    }, { id: 'review-note', x: geometryBefore.x, y: geometryBefore.y, origin: boardOrigin }, { timeout: 10_000 })
    const geometryAfterMove = await canvasBlockGeometry(page, 'review-note', boardOrigin)
    const resizeHandle = note.locator('button.tc-resize-handle[aria-label="Resize note"]')
    await resizeHandle.focus()
    await resizeHandle.press('ArrowRight')
    await page.waitForFunction(({ id, width }) => {
      const element = document.querySelector(`.tc-canvas article.tc-block[data-block-id="${id}"]`)
      return Boolean(element && Number.parseFloat(element.style.width) > width + 5)
    }, { id: 'review-note', width: geometryAfterMove.width }, { timeout: 10_000 })
    const geometryAfterResize = await canvasBlockGeometry(page, 'review-note', boardOrigin)
    assert.ok(Math.abs(geometryAfterMove.x - geometryBefore.x) > 20 || Math.abs(geometryAfterMove.y - geometryBefore.y) > 20, 'Native Tiny Canvas drag did not temporarily move the review note.')
    assert.ok(geometryAfterResize.width > geometryAfterMove.width + 5, 'Native Tiny Canvas resize handle did not temporarily resize the review note.')
    assert.match(await page.locator('.notebook-shell__canvas-save-note').innerText(), /temporary.*will not be saved/i, 'Static geometry edits must be clearly temporary.')
    assert.deepEqual(await tinyCanvasGeometryStorage(page, geometryWidgetIds), [], 'Static drag/resize must not persist geometry in localStorage.')
    assert.deepEqual(geometryPosts, [], 'Static drag/resize must not POST geometry to a local notebook service.')
    screenshots.push(await captureReviewScreenshot(page, archiveHash, runId, outputName, 'shell-canvas-temporary-geometry'))

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.tc-canvas article.tc-block[data-block-id="review-note"]').waitFor({ state: 'visible', timeout: 15_000 })
    const geometryAfterReload = await canvasBlockGeometry(page, 'review-note', boardOrigin)
    for (const key of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(geometryAfterReload[key] - geometryBefore[key]) <= 2, `Static ${key} geometry did not reset to the published value after reload.`)
    }
    assert.deepEqual(await tinyCanvasGeometryStorage(page, geometryWidgetIds), [], 'Reload must not reveal persisted Tiny Canvas geometry in localStorage.')
    assert.deepEqual(geometryPosts, [], 'Static page reload and geometry edits must not POST to the local notebook service.')
    screenshots.push(await captureReviewScreenshot(page, archiveHash, runId, outputName, 'shell-canvas-reloaded'))

    phase = 'standalone-site-and-css'
    await page.goto(`${server.origin}sites/existing-catalog?view=catalog-home`, { waitUntil: 'domcontentloaded' })
    const standaloneSite = page.locator('.site-view[data-site-artifact-id="existing-catalog"]')
    await standaloneSite.waitFor({ state: 'visible', timeout: 15_000 })
    assert.equal(new URL(page.url()).pathname, `${base}sites/existing-catalog`)
    assert.equal(new URL(page.url()).searchParams.get('view'), 'catalog-home')
    assert.equal(new URL(page.url()).searchParams.has('artifact'), false)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await standaloneSite.waitFor({ state: 'visible', timeout: 15_000 })
    const standaloneScreenshot = await proveImage(standaloneSite.locator('img'), base, 'notebook-assets/workspace/review-cycle/catalog.site/assets/catalog-home.svg', 'Standalone Site screenshot')
    assert.equal(await standaloneSite.locator('iframe').count(), 0, 'Static Site must not contain an iframe.')
    const siteLink = standaloneSite.locator('a')
    assert.equal(await siteLink.getAttribute('href'), 'https://example.com/books')
    assert.equal(await siteLink.textContent().then(text => text.trim()), 'Open Catalog home')
    await siteLink.click({ modifiers: ['Alt'], trial: true })
    assert.ok(!/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(await siteLink.getAttribute('href')))
    screenshots.push(await captureReviewScreenshot(page, archiveHash, runId, outputName, 'shell-standalone-site'))
    const customCss = page.locator('.notebook-shell link[data-notebook-custom-css]')
    await customCss.waitFor({ state: 'attached', timeout: 10_000 })
    assert.equal(new URL(await customCss.getAttribute('href')).pathname, `${base}notebook-assets/notebook.css`)
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--notebook-release-proof').trim()), '#315bd6', 'The copied root notebook.css did not affect the rendered client.')

    phase = 'no-local-runtime-and-zero-errors'
    const exactFaviconRequests = staticRequests.filter(request => new URL(request, server.origin).pathname === '/favicon.ico')
    const exactFaviconResponses = server.faviconResponses.filter(response => response.pathname === '/favicon.ico')
    assert.ok(exactFaviconResponses.every(response => response.status === 204), `Fixture favicon responses must be 204: ${JSON.stringify(exactFaviconResponses)}`)
    assert.equal(exactFaviconResponses.length, exactFaviconRequests.length, 'Every exact /favicon.ico request must have an observed fixture response.')
    const applicationRequests = staticRequests.filter(request => !exactFaviconRequests.includes(request))
    assert.ok(applicationRequests.length > 0 && applicationRequests.every(request => new URL(request, server.origin).pathname.startsWith(base)), 'An application request escaped the configured base path.')
    assert.ok(!staticRequests.some(request => request.includes('/__notebook/')), 'The static client requested a local-core endpoint.')
    assert.deepEqual(httpFailures, [], `Static browser HTTP failures: ${JSON.stringify(httpFailures)}`)
    assert.deepEqual(requestFailures, [], `Static browser request failures: ${JSON.stringify(requestFailures)}`)
    assert.deepEqual(pageErrors, [], `Static browser page errors: ${JSON.stringify(pageErrors)}`)
    assert.deepEqual(consoleErrors, [], `Static browser console errors: ${JSON.stringify(consoleErrors)}`)

    return {
      base,
      outputTreeSha256: output.outputHash,
      requestCount: staticRequests.length,
      faviconResponses: exactFaviconResponses,
      graphDiagnostics,
      prototypeStates: ['request', 'confirmation'],
      images: { markdownImage, componentImage, canvasImage, siteScreenshot, standaloneScreenshot },
      unknownFallback: unknownFallbackText,
      canvasGeometry: { before: geometryBefore, afterMove: geometryAfterMove, afterResize: geometryAfterResize, afterReload: geometryAfterReload, geometryPosts, localStorageGeometryBefore, localStorageGeometryAfter: await tinyCanvasGeometryStorage(page, geometryWidgetIds) },
      screenshots,
      standaloneSiteIframeCount: await standaloneSite.locator('iframe').count(),
      staticRequests,
      httpFailures,
      requestFailures,
      pageErrors,
      consoleErrors,
      snapshot: await snapshot(page),
    }
  } catch (error) {
    const failureRecord = {
      base,
      phase,
      message: error.message,
      stack: error.stack,
      httpFailures,
      requestFailures,
      pageErrors,
      consoleErrors,
      staticRequests,
      geometryPosts,
      faviconResponses: server.faviconResponses,
      snapshot: await snapshot(page).catch(snapshotError => ({ error: snapshotError.message })),
    }
    evidence.failures.push(failureRecord)
    throw error
  } finally {
    await page.close()
    await closeServer(server.server)
    staticServers.splice(staticServers.indexOf(server.server), 1)
  }
}

try {
  assert.ok(fs.existsSync(statePath), `Consumer evidence not found: ${statePath}`)
  const consumer = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  assert.equal(consumer.status, 'prepared-for-browser-review')
  assert.equal(consumer.cleanup.devServerStopped, true, 'The notebook dev server must already be stopped.')
  assert.equal(consumer.cleanup.staticServersStopped, true, 'Consumer static servers must already be stopped.')
  assert.ok(consumer.packageArchive?.sha256)
  for (const build of Object.values(consumer.builds)) {
    assert.ok(fs.existsSync(build.outputRoot), `Prepared output was removed: ${build.outputRoot}`)
    assert.equal(treeDigest(build.outputRoot), build.outputHash, `Prepared output changed: ${build.outputRoot}`)
  }
  evidence.packageArchive = consumer.packageArchive
  evidence.candidateHashes = consumer.candidateHashes
  evidence.sourceExampleSha256 = consumer.sourceExampleSha256
  evidence.consumerNotebookSha256 = consumer.sourceTreeSha256
  const consumerSource = notebookSourceSnapshot(consumer.notebookRoot)
  assert.equal(consumerSource.authoredSha256, consumer.sourceTreeSha256, 'Consumer authored notebook source changed after its builds.')
  assert.deepEqual(consumerSource.viteCache, consumer.viteCache.afterBuild, 'Generated .vite cache files changed after the consumer build.')

  browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-extensions', '--no-first-run'],
  })
  const context = await browser.newContext({ viewport: { width: 1365, height: 950 } })
  for (const [name, base] of [['root', '/'], ['prefix', '/preview/branch/']]) {
    const output = consumer.builds[name]
    const boardOrigin = canvasBoardOrigin(path.join(output.outputRoot, 'notebook-data/canvases/checkout-review.jsonl'))
    evidence.outputs.push({ ...await runBase(context, output, base, name, runId, consumer.packageArchive.sha256, boardOrigin), boardOrigin })
  }
  evidence.status = 'passed'
} catch (error) {
  evidence.status = 'failed'
  evidence.failures.push({ message: error.message, stack: error.stack })
  failure = error
} finally {
  if (browser) {
    try { await browser.close(); evidence.cleanup.browserClosed = true }
    catch (error) { evidence.cleanup.errors.push(`Browser cleanup: ${error.message}`) }
  }
  for (const server of staticServers) {
    try { await closeServer(server) }
    catch (error) { evidence.cleanup.errors.push(`Static server cleanup: ${error.message}`) }
  }
  evidence.cleanup.serversClosed = staticServers.every(server => !server.listening)
  staticServers.length = 0

  const preservation = { outputs: [], errors: [] }
  try {
    const consumer = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    for (const [name, output] of Object.entries(consumer.builds ?? {})) {
      try {
        const actualSha256 = treeDigest(output.outputRoot)
        preservation.outputs.push({ name, path: output.outputRoot, expectedSha256: output.outputHash, actualSha256, unchanged: actualSha256 === output.outputHash })
        if (actualSha256 !== output.outputHash) preservation.errors.push(`${name} prepared output changed: expected ${output.outputHash}, got ${actualSha256}`)
      } catch (error) { preservation.errors.push(`${name} prepared output could not be hashed: ${error.message}`) }
    }
    try {
      const snapshotAfterBrowser = notebookSourceSnapshot(consumer.notebookRoot)
      preservation.notebookSourceSha256 = snapshotAfterBrowser.authoredSha256
      preservation.viteCache = snapshotAfterBrowser.viteCache
      preservation.notebookSourceUnchanged = snapshotAfterBrowser.authoredSha256 === consumer.sourceTreeSha256
      preservation.viteCacheUnchanged = JSON.stringify(snapshotAfterBrowser.viteCache) === JSON.stringify(consumer.viteCache.afterBuild)
      if (!preservation.notebookSourceUnchanged) preservation.errors.push('Consumer authored notebook source changed during browser review.')
      if (!preservation.viteCacheUnchanged) preservation.errors.push('Consumer generated .vite cache changed during browser review.')
    } catch (error) { preservation.errors.push(`Consumer notebook source could not be rehashed: ${error.message}`) }
    try {
      preservation.sourceExampleSha256 = treeDigest(path.join(repositoryRoot, 'examples/first-look/notebook'))
      preservation.sourceExampleUnchanged = preservation.sourceExampleSha256 === consumer.sourceExampleSha256
      if (!preservation.sourceExampleUnchanged) preservation.errors.push('Packaged example source changed during browser review.')
    } catch (error) { preservation.errors.push(`Packaged example source could not be rehashed: ${error.message}`) }
  } catch (error) { preservation.errors.push(`Prepared consumer evidence could not be reread: ${error.message}`) }
  evidence.preservation = preservation
  evidence.cleanup.errors.push(...preservation.errors)
  if (evidence.cleanup.errors.length || !evidence.cleanup.browserClosed || !evidence.cleanup.serversClosed) {
    evidence.status = 'failed'
    if (!failure) {
      failure = new Error(`Browser review cleanup or preservation check failed: ${JSON.stringify({ cleanup: evidence.cleanup, preservation })}`)
      evidence.failures.push({ message: failure.message, stack: failure.stack })
    }
  }
}

evidence.finishedAt = new Date().toISOString()
const consumer = (() => {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')) } catch { return null }
})()
const archiveHash = consumer?.packageArchive?.sha256 ?? `missing-${Date.now()}`
evidence.evidencePath = path.join(repositoryRoot, 'tests/release/evidence', `${archiveHash}.${runId}.browser.json`)
fs.mkdirSync(path.dirname(evidence.evidencePath), { recursive: true })
fs.writeFileSync(evidence.evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ status: evidence.status, evidencePath: evidence.evidencePath, archiveSha256: evidence.packageArchive?.sha256, outputs: evidence.outputs.map(output => ({ base: output.base, outputTreeSha256: output.outputTreeSha256 })), cleanup: evidence.cleanup })}\n`)
if (failure) process.exitCode = 1
