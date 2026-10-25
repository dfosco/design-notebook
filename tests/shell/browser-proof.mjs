import assert from 'node:assert/strict'
import { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createNotebookRuntime } from '../../src/core/runtime/index.js'
import { materializeCanvas } from '../../src/canvas-renderer/index.js'
import { computeCanvasBoardGeometry } from '../../src/vendor/tiny-canvas/interactive.js'

const playwrightModule = process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href
  : 'playwright'
const { chromium } = await import(playwrightModule)
const chrome = process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const sourceNotebookRoot = path.join(repositoryRoot, 'example-notebook')
const proofRunId = `${Date.now()}-${randomUUID()}`
const evidencePath = process.env.SHELL_PROOF_EVIDENCE
  ? path.resolve(process.env.SHELL_PROOF_EVIDENCE)
  : path.join(tmpdir(), `design-notebook-shell-proof-${proofRunId}.json`)

try {
  await access(evidencePath)
  throw new Error(`Refusing to overwrite existing browser proof evidence: ${evidencePath}`)
} catch (cause) {
  if (cause.code !== 'ENOENT') throw cause
}

function isGeneratedNotebookPath(absolute) {
  const relative = path.relative(sourceNotebookRoot, absolute)
  return relative.split(path.sep).some(part => part === 'node_modules' || part === '.DS_Store')
}

async function treeDigest(directory) {
  const files = []
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (isGeneratedNotebookPath(absolute)) continue
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile()) files.push(absolute)
    }
  }
  await visit(directory)
  const hash = createHash('sha256')
  for (const absolute of files.sort()) {
    hash.update(path.relative(directory, absolute).split(path.sep).join('/'))
    hash.update('\0')
    hash.update(await readFile(absolute))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function waitFor(predicate, message, timeoutMs = 10000, intervalMs = 50) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const value = await predicate()
        if (value) return resolve(value)
        if (Date.now() - started >= timeoutMs) return reject(new Error(message))
        setTimeout(poll, intervalMs)
      } catch (error) {
        reject(error)
      }
    }
    poll()
  })
}

async function waitForFrames(page, count = 2) {
  await page.evaluate(async frames => {
    for (let index = 0; index < frames; index += 1) {
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
  }, count)
}

async function waitForPrototypeSelection(page, { shellPath, viewId, framePath, heading }) {
  await page.waitForFunction(({ expectedShellPath, expectedViewId, expectedFramePath, expectedHeading }) => {
    const selector = document.querySelector('.notebook-shell__view-select select')
    const frame = document.querySelector('.notebook-shell__prototype-frame')
    let documentUrl
    let documentHeading
    try {
      documentUrl = frame?.contentWindow?.location.href
      documentHeading = frame?.contentDocument?.querySelector('h1')?.textContent?.trim()
    } catch {
      return false
    }
    return location.pathname === expectedShellPath && selector?.value === expectedViewId &&
      documentUrl && new URL(documentUrl).pathname === expectedFramePath && documentHeading === expectedHeading
  }, { expectedShellPath: shellPath, expectedViewId: viewId, expectedFramePath: framePath, expectedHeading: heading }, { timeout: 10000 })
  assert.equal(new URL(page.url()).pathname, shellPath)
  assert.equal(await page.locator('.notebook-shell__view-select select').inputValue(), viewId)
  const frameDocument = await page.locator('.notebook-shell__prototype-frame').evaluate(frame => ({
    url: frame.contentWindow.location.href,
    heading: frame.contentDocument.querySelector('h1')?.textContent?.trim(),
  }))
  assert.equal(new URL(frameDocument.url).pathname, framePath)
  assert.equal(frameDocument.heading, heading)
  return frameDocument
}

async function appendEvent(filePath, event) {
  const source = await readFile(filePath, 'utf8')
  await writeFile(filePath, `${source.trimEnd()}\n${JSON.stringify(event)}\n`)
}

function lastWidgetEvent(source, widgetId, eventName) {
  return source.trimEnd().split('\n').map(line => JSON.parse(line)).reverse()
    .find(event => event.event === eventName && (event.widgetId === widgetId || event.widget?.id === widgetId))
}

function widgetEventCount(source, widgetId, eventName) {
  return source.trimEnd().split('\n').map(line => JSON.parse(line))
    .filter(event => event.event === eventName && (event.widgetId === widgetId || event.widget?.id === widgetId)).length
}

async function findNotebookFile(root, predicate) {
  const matches = []
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile() && predicate(entry.name, absolute)) matches.push(absolute)
    }
  }
  await visit(root)
  return matches
}

const originalNotebookDigest = await treeDigest(sourceNotebookRoot)
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'design-notebook-shell-proof-'))
const notebookRoot = path.join(temporaryRoot, 'notebook')
let browser
let runtime
let baseRuntime
let siteServer
let page
let canvasPath
let error
let failureSnapshot
let proofData
const phases = []
const pageErrors = []
const consoleErrors = []
const failedResponses = []
const geometryResponses = []
const allowedFaviconOrigins = new Set()
const refreshEvents = []
const expectedFaviconResponses = []
const expectedFaviconConsoleErrors = []
const expectedConflictConsoleErrors = []
const cleanupErrors = []
const screenshots = {}
const observe = (phase, data = {}) => {
  const item = { phase, at: new Date().toISOString(), ...data }
  phases.push(item)
  console.log(JSON.stringify(item))
}

try {
  await cp(sourceNotebookRoot, notebookRoot, {
    recursive: true,
    filter: source => !isGeneratedNotebookPath(source),
  })
  const canvasFiles = await findNotebookFile(notebookRoot, name => name === 'checkout-review.canvas.jsonl')
  assert.equal(canvasFiles.length, 1, 'The proof must resolve the authored checkout-review canvas JSONL from the copied notebook.')
  canvasPath = canvasFiles[0]

  siteServer = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end('<!doctype html><title>Catalog fixture</title><main id="catalog-proof">Local catalog fixture is available</main>')
  })
  await new Promise((resolve, reject) => {
    siteServer.once('error', reject)
    siteServer.listen(0, '127.0.0.1', resolve)
  })
  const siteOrigin = `http://127.0.0.1:${siteServer.address().port}`
  const siteDescriptorPath = path.join(notebookRoot, 'research/catalog.site/catalog.site.json')
  const siteDescriptor = JSON.parse(await readFile(siteDescriptorPath, 'utf8'))
  siteDescriptor.local.developmentUrl = siteOrigin
  await writeFile(siteDescriptorPath, `${JSON.stringify(siteDescriptor, null, 2)}\n`)
  await writeFile(path.join(notebookRoot, 'notebook.css'), ':root { --dn-shell-accent: rgb(176, 18, 156); }\n')

  runtime = await createNotebookRuntime({ root: notebookRoot }).then(server => server.start())
  const targetUrl = runtime.address
  assert.ok(targetUrl, 'The local runtime must expose the notebook root URL.')
  allowedFaviconOrigins.add(new URL(targetUrl).origin)
  browser = await chromium.launch({
    headless: true,
    executablePath: chrome,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-extensions', '--no-first-run'],
  })
  page = await browser.newPage({ viewport: { width: 1360, height: 960 } })
  page.on('pageerror', event => pageErrors.push(event.message))
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push({ text: message.text(), location: message.location(), at: new Date().toISOString() })
  })
  page.on('response', response => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url(), method: response.request().method() })
  })
  runtime.onRefresh(event => refreshEvents.push({ revision: event.revision, file: event.file }))
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.locator('.notebook-shell').waitFor({ state: 'visible', timeout: 15000 })
  await waitFor(() => page.locator('[data-notebook-custom-css]').count(), 'Notebook CSS link was not installed.')
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.notebook-shell')).getPropertyValue('--dn-shell-accent').trim() === 'rgb(176, 18, 156)', undefined, { timeout: 10000 })

  for (const id of ['borrow-flow', 'checkout-review', 'checkout-rationale', 'existing-catalog']) {
    await page.locator(`[data-artifact-id="${id}"]`).waitFor({ state: 'attached', timeout: 10000 })
  }
  observe('shell-ready', { url: targetUrl, artifacts: ['borrow-flow', 'checkout-review', 'checkout-rationale', 'existing-catalog'], customCss: true })

  await page.locator('[data-artifact-id="borrow-flow"]').click()
  assert.equal(new URL(page.url()).pathname, '/borrow-flow')
  assert.equal(new URL(page.url()).searchParams.has('artifact'), false)
  const prototypeFrame = page.locator('.notebook-shell__prototype-frame')
  await prototypeFrame.waitFor({ state: 'visible', timeout: 15000 })
  const defaultUrl = await prototypeFrame.getAttribute('src')
  assert.match(defaultUrl, /\/__notebook\/prototypes\/borrow-flow\/$/)
  await page.locator('.notebook-shell__view-select select').selectOption('request')
  assert.equal(new URL(page.url()).pathname, '/borrow-flow/request')
  assert.equal(new URL(page.url()).searchParams.has('artifact'), false)
  await page.waitForFunction(() => /\/request(?:\?|#|$)/.test(document.querySelector('.notebook-shell__prototype-frame')?.src ?? ''), undefined, { timeout: 10000 })
  const requestUrl = await prototypeFrame.getAttribute('src')
  await page.locator('.notebook-shell__view-select select').selectOption('confirmation')
  assert.equal(new URL(page.url()).pathname, '/borrow-flow/confirmation')
  await page.waitForFunction(() => /\/confirmation(?:\?|#|$)/.test(document.querySelector('.notebook-shell__prototype-frame')?.src ?? ''), undefined, { timeout: 10000 })
  observe('prototype-views', { defaultUrl, requestUrl, confirmationUrl: await prototypeFrame.getAttribute('src') })
  await page.getByRole('button', { name: 'Back' }).click()
  const topbarBack = await waitForPrototypeSelection(page, { shellPath: '/borrow-flow/request', viewId: 'request', framePath: '/__notebook/prototypes/borrow-flow/request', heading: 'The Shape of Small Things' })
  await page.getByRole('button', { name: 'Forward' }).click()
  const topbarForward = await waitForPrototypeSelection(page, { shellPath: '/borrow-flow/confirmation', viewId: 'confirmation', framePath: '/__notebook/prototypes/borrow-flow/confirmation', heading: 'Your hold is in the queue' })
  await page.goBack()
  const browserBack = await waitForPrototypeSelection(page, { shellPath: '/borrow-flow/request', viewId: 'request', framePath: '/__notebook/prototypes/borrow-flow/request', heading: 'The Shape of Small Things' })
  await page.goForward()
  const browserForward = await waitForPrototypeSelection(page, { shellPath: '/borrow-flow/confirmation', viewId: 'confirmation', framePath: '/__notebook/prototypes/borrow-flow/confirmation', heading: 'Your hold is in the queue' })
  observe('route-back-forward', { topbarBack, topbarForward, browserBack, browserForward, frameAligned: true })

  await page.locator('[data-artifact-id="checkout-rationale"]').click()
  assert.equal(new URL(page.url()).pathname, '/docs/checkout-rationale')
  assert.equal(new URL(page.url()).searchParams.has('artifact'), false)
  await page.locator('.doc-renderer h1').waitFor({ state: 'visible', timeout: 15000 })
  assert.match(await page.locator('.doc-renderer h1').textContent(), /Borrow flow review/)
  const docPrototypeFrames = page.locator('.doc-widget[data-widget-type="prototype"] iframe')
  await docPrototypeFrames.first().waitFor({ state: 'visible', timeout: 15000 })
  const docPrototypeUrls = await docPrototypeFrames.evaluateAll(nodes => nodes.map(node => node.src))
  assert.equal(docPrototypeUrls.length, 2)
  assert.ok(docPrototypeUrls.some(url => /\/request(?:\?|#|$)/.test(url)))
  assert.ok(docPrototypeUrls.some(url => /\/confirmation(?:\?|#|$)/.test(url)))
  const docSiteSummary = page.locator('.doc-widget[data-widget-type="site"] details summary')
  await docSiteSummary.click()
  const docScreenshot = page.locator('.doc-widget[data-widget-type="site"] img').first()
  await docScreenshot.evaluate(node => node.decode())
  assert.ok(await docScreenshot.evaluate(node => node.naturalWidth > 0))
  await page.frameLocator('.doc-widget[data-widget-type="site"] iframe').locator('#catalog-proof').waitFor({ state: 'visible', timeout: 10000 })
  const docSiteUrls = {
    frame: await page.locator('.doc-widget[data-widget-type="site"] iframe').getAttribute('src'),
    screenshot: await docScreenshot.getAttribute('src'),
  }
  assert.equal(new URL(docSiteUrls.frame).pathname, '/books')
  const docScreenshotWidth = await docScreenshot.evaluate(node => node.naturalWidth)
  await page.setViewportSize({ width: 390, height: 900 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Document must not cause horizontal page overflow at 390px.')
  screenshots.narrowDocument = path.join(tmpdir(), `design-notebook-shell-narrow-document-${proofRunId}.png`)
  await page.screenshot({ path: screenshots.narrowDocument, fullPage: true })
  await page.setViewportSize({ width: 1360, height: 960 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Document must not cause horizontal page overflow at 1360px.')
  observe('document-and-site-embeds', { prototypeUrls: docPrototypeUrls, site: docSiteUrls, screenshotWidth: docScreenshotWidth })

  await page.locator('[data-artifact-id="existing-catalog"]').click()
  assert.equal(new URL(page.url()).pathname, '/sites/existing-catalog')
  await page.locator('.site-view[data-site-artifact-id="existing-catalog"]').waitFor({ state: 'visible', timeout: 15000 })
  const standaloneSite = page.locator('.site-view')
  await standaloneSite.locator('details summary').click()
  const standaloneScreenshot = standaloneSite.locator('img').first()
  await standaloneScreenshot.evaluate(node => node.decode())
  assert.ok(await standaloneScreenshot.evaluate(node => node.naturalWidth > 0))
  await page.frameLocator('.site-view iframe').locator('#catalog-proof').waitFor({ state: 'visible', timeout: 10000 })
  const standaloneSiteUrls = {
    frame: await standaloneSite.locator('iframe').getAttribute('src'),
    screenshot: await standaloneScreenshot.getAttribute('src'),
  }
  assert.equal(new URL(standaloneSiteUrls.frame).pathname, '/books')
  const standaloneScreenshotWidth = await standaloneScreenshot.evaluate(node => node.naturalWidth)
  observe('standalone-site', { ...standaloneSiteUrls, screenshotWidth: standaloneScreenshotWidth })

  await page.locator('[data-artifact-id="checkout-review"]').click()
  assert.equal(new URL(page.url()).pathname, '/canvas/checkout-review')
  const canvas = page.locator('.tc-canvas')
  const note = page.locator('.tc-block[data-block-id="review-note"]')
  const chart = page.locator('.tc-block[data-block-id="chart-reference"] .canvas-scene__fallback')
  const canvasViewport = page.locator('.notebook-shell__canvas-viewport')
  await note.waitFor({ state: 'visible', timeout: 15000 })
  await chart.waitFor({ state: 'visible', timeout: 10000 })
  const waitForFittedBounds = async locators => waitFor(async () => {
    await waitForFrames(page)
    const viewportBox = await canvasViewport.boundingBox()
    const boxes = await Promise.all(locators.map(locator => locator.boundingBox()))
    if (!viewportBox || boxes.some(box => !box)) return false
    const fitted = boxes.every(box => box.x >= viewportBox.x - 1 && box.y >= viewportBox.y - 1 &&
      box.x + box.width <= viewportBox.x + viewportBox.width + 1 &&
      box.y + box.height <= viewportBox.y + viewportBox.height + 1)
    return fitted ? { viewportBox, boxes } : false
  }, 'Fit must settle with all checked placements inside the canvas viewport.')
  await page.getByRole('button', { name: 'Fit canvas to view' }).click()
  const initialFittedBounds = await waitForFittedBounds([note, chart])
  assert.match(await chart.textContent(), /The circulation chart is not included in this first-look viewer/)
  assert.match(await chart.textContent(), /Compare the source report when available\./)
  const beforeControls = await readFile(canvasPath, 'utf8')
  const zoomLabel = page.locator('.tc-canvas-zoom-value')
  const zoomBefore = await zoomLabel.textContent()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  const zoomAfter = await zoomLabel.textContent()
  assert.notEqual(zoomAfter, zoomBefore, 'Native Tiny Canvas zoom must change the zoom level.')
  const canvasBox = await canvas.boundingBox()
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2)
  const scrollBeforePan = await canvas.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))
  await page.mouse.wheel(360, 260)
  await waitFor(async () => {
    const after = await canvas.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))
    return after.left !== scrollBeforePan.left || after.top !== scrollBeforePan.top
  }, 'Native Canvas scrolling did not pan the viewport.')
  const scrollAfterPan = await canvas.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))
  await page.getByRole('button', { name: 'Fit canvas to view' }).click()
  await waitForFittedBounds([note, chart])
  const afterControls = await readFile(canvasPath, 'utf8')
  assert.equal(afterControls, beforeControls, 'Zoom, pan, and Fit must not change authored source.')
  observe('canvas-view-controls', { zoomBefore, zoomAfter, scrollBeforePan, scrollAfterPan, initialFittedBounds, sourceUnchanged: true })

  const captureGeometry = async () => {
    const source = await readFile(canvasPath, 'utf8')
    const materialized = materializeCanvas(source, { mode: 'local', artifacts: [] })
    const item = materialized.scene.items.find(candidate => candidate.id === 'review-note')
    const board = computeCanvasBoardGeometry(materialized.scene.items)
    return { source, geometry: item.geometry, board }
  }
  const renderedGeometry = async locator => locator.evaluate(element => {
    const transform = getComputedStyle(element).transform
    const translation = new DOMMatrixReadOnly(transform === 'none' ? 'matrix(1, 0, 0, 1, 0, 0)' : transform)
    return {
      left: translation.m41,
      top: translation.m42,
      width: Number.parseFloat(getComputedStyle(element).width),
      height: Number.parseFloat(getComputedStyle(element).height),
      transform,
    }
  })
  const geometryMatchesRendered = async (expected = null) => {
    const current = await captureGeometry()
    const geometry = expected ?? current.geometry
    const rendered = await renderedGeometry(page.locator('.tc-block[data-block-id="review-note"]'))
    const target = {
      left: geometry.x - current.board.origin.x,
      top: geometry.y - current.board.origin.y,
      width: geometry.width,
      height: geometry.height,
    }
    return Object.entries(target).every(([key, value]) => Number.isFinite(rendered[key]) && Math.abs(rendered[key] - value) < 1)
  }
  const waitForRenderedGeometry = async (message, expected = null) => {
    await waitFor(() => geometryMatchesRendered(expected), message)
    await waitForFrames(page)
    assert.equal(await geometryMatchesRendered(expected), true, `${message} Geometry must remain settled for two animation frames.`)
  }
  const originalGeometry = await captureGeometry()
  const dragBlock = async (locator, dx, dy) => {
    const box = await locator.boundingBox()
    assert.ok(box, 'Canvas placement must have a measurable hit area.')
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 32))
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + Math.min(box.height / 2, 32) + dy, { steps: 5 })
    await page.mouse.up()
  }
  await dragBlock(note.locator('.tc-note'), 72, 48)
  const originalMoveEvents = widgetEventCount(originalGeometry.source, 'review-note', 'widget_moved')
  await waitFor(async () => {
    const source = await readFile(canvasPath, 'utf8')
    return widgetEventCount(source, 'review-note', 'widget_moved') > originalMoveEvents && lastWidgetEvent(source, 'review-note', 'widget_moved')
  }, 'Tiny Canvas drag did not append a new widget_moved record.')
  const movedGeometry = await captureGeometry()
  await waitForRenderedGeometry('Moved placement did not render authoritative persisted geometry.', movedGeometry.geometry)
  assert.ok(movedGeometry.geometry.x > originalGeometry.geometry.x, 'A local drag must persist the new x coordinate.')
  assert.ok(movedGeometry.geometry.y > originalGeometry.geometry.y, 'A local drag must persist the new y coordinate.')

  const previousResizeEvents = widgetEventCount(movedGeometry.source, 'review-note', 'widget_updated')
  const resize = page.getByRole('button', { name: 'Resize note' })
  const resizeBox = await resize.boundingBox()
  assert.ok(resizeBox)
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 64, resizeBox.y + resizeBox.height / 2 + 42, { steps: 4 })
  await page.mouse.up()
  await waitFor(async () => {
    const source = await readFile(canvasPath, 'utf8')
    return widgetEventCount(source, 'review-note', 'widget_updated') > previousResizeEvents && lastWidgetEvent(source, 'review-note', 'widget_updated')
  }, 'Tiny Canvas resize did not append a new widget_updated record.')
  const resizedGeometry = await captureGeometry()
  await waitForRenderedGeometry('Resized placement did not render authoritative persisted geometry.', resizedGeometry.geometry)
  assert.ok(resizedGeometry.geometry.width > movedGeometry.geometry.width, 'Resize must persist the new width.')
  assert.ok(resizedGeometry.geometry.height > movedGeometry.geometry.height, 'Resize must persist the new height.')
  observe('local-move-and-resize', { before: originalGeometry.geometry, moved: movedGeometry.geometry, resized: resizedGeometry.geometry })

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
  const reviewPlacement = page.locator('.tc-block[data-block-id="review-note"]')
  await reviewPlacement.waitFor({ state: 'visible', timeout: 15000 })
  const reloadGeometry = await captureGeometry()
  assert.deepEqual(reloadGeometry.geometry, resizedGeometry.geometry, 'Reload must render source-authored move and resize geometry.')
  await waitForRenderedGeometry('Reloaded DOM must match replay geometry relative to board origin.', reloadGeometry.geometry)
  const reloadRenderedGeometry = await renderedGeometry(reviewPlacement)

  await appendEvent(canvasPath, {
    event: 'widget_updated', widgetId: 'review-note', props: { text: 'External file refresh reached the viewer.' },
  })
  await page.locator('.tc-block[data-block-id="review-note"] .tc-note').getByText('External file refresh reached the viewer.').waitFor({ state: 'visible', timeout: 15000 })
  const refreshedSource = await readFile(canvasPath, 'utf8')
  assert.ok(refreshEvents.length, 'The local runtime must report the external Canvas file refresh.')
  await appendEvent(canvasPath, {
    event: 'widget_added',
    widget: { id: 'fit-outside-proof', type: 'sticky-note', position: { x: -280, y: 1100 }, props: { text: 'Fit includes outside geometry', width: 240, height: 120 } },
  })
  const outsideItem = page.locator('.tc-block[data-block-id="fit-outside-proof"]')
  await outsideItem.waitFor({ state: 'visible', timeout: 15000 })
  await page.getByRole('button', { name: 'Fit canvas to view' }).click()
  const fittedBounds = await waitFor(async () => {
    await waitForFrames(page)
    const itemBox = await outsideItem.boundingBox()
    const viewportBox = await page.locator('.notebook-shell__canvas-viewport').boundingBox()
    if (!itemBox || !viewportBox) return false
    const isFitted = itemBox.x >= viewportBox.x - 1 && itemBox.y >= viewportBox.y - 1 &&
      itemBox.x + itemBox.width <= viewportBox.x + viewportBox.width + 1 &&
      itemBox.y + itemBox.height <= viewportBox.y + viewportBox.height + 1
    return isFitted ? { itemBox, viewportBox } : false
  }, 'Fit must settle with negative and below-nominal geometry inside the viewport.')
  const fittedOutsideBox = fittedBounds.itemBox
  const fittedViewportBox = fittedBounds.viewportBox
  assert.ok(fittedOutsideBox.x >= fittedViewportBox.x - 1 && fittedOutsideBox.y >= fittedViewportBox.y - 1, 'Fit must bring negative authored coordinates into view.')
  assert.ok(fittedOutsideBox.x + fittedOutsideBox.width <= fittedViewportBox.x + fittedViewportBox.width + 1, 'Fit must include the right edge of extended content.')
  assert.ok(fittedOutsideBox.y + fittedOutsideBox.height <= fittedViewportBox.y + fittedViewportBox.height + 1, 'Fit must include content below nominal canvas height.')
  assert.ok(refreshedSource.includes('External file refresh reached the viewer.'))
  observe('external-canvas-refresh-and-extended-fit', { refreshEvents, text: 'External file refresh reached the viewer.', fittedOutsideBox, fittedViewportBox })

  let conflictStatus
  const expectedConflictUrl = new URL('/__notebook/artifacts/checkout-review/geometry', targetUrl).href
  await page.route('**/__notebook/artifacts/checkout-review/geometry', async route => {
    const externalPosition = { x: 1280, y: -180 }
    await appendEvent(canvasPath, { event: 'widget_moved', widgetId: 'review-note', position: externalPosition })
    const response = await route.fetch()
    conflictStatus = response.status()
    geometryResponses.push({ status: conflictStatus, url: route.request().url(), method: route.request().method() })
    await route.fulfill({ response })
  }, { times: 1 })
  const beforeConflict = await captureGeometry()
  await dragBlock(page.locator('.tc-block[data-block-id="review-note"] .tc-note'), 52, 36)
  await waitFor(() => conflictStatus === 409, 'Stale local geometry edit did not receive HTTP 409.')
  await page.getByText(/Canvas save failed/).waitFor({ state: 'visible', timeout: 10000 })
  await page.getByRole('button', { name: 'Fit canvas to view' }).click()
  const conflictSource = await waitFor(async () => {
    const current = await captureGeometry()
    return current.geometry.x === 1280 && current.geometry.y === -180 ? current : false
  }, 'External conflict geometry was not present in the authoritative JSONL source.')
  await waitForRenderedGeometry('After 409, rendered geometry must match authoritative external JSONL.', conflictSource.geometry)
  assert.equal(conflictStatus, 409)
  assert.notDeepEqual(conflictSource.geometry, beforeConflict.geometry)
  assert.deepEqual(conflictSource.geometry, { ...conflictSource.geometry, x: 1280, y: -180 })
  observe('stale-save-conflict', { status: conflictStatus, authoritativeGeometry: conflictSource.geometry, response: geometryResponses.at(-1) })

  await page.getByRole('button', { name: 'Fit canvas to view' }).click()
  await waitForFittedBounds([reviewPlacement])
  await waitForRenderedGeometry('Final canvas state must settle before capturing success screenshots.')
  screenshots.desktopCanvas = path.join(tmpdir(), `design-notebook-shell-desktop-canvas-${proofRunId}.png`)
  await page.screenshot({ path: screenshots.desktopCanvas, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await waitForFrames(page)
  const canvasNarrowWidth = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }))
  assert.ok(canvasNarrowWidth.scrollWidth <= canvasNarrowWidth.innerWidth, 'Canvas shell must not cause horizontal page overflow at 390px.')
  screenshots.narrowCanvas = path.join(tmpdir(), `design-notebook-shell-narrow-canvas-${proofRunId}.png`)
  await page.screenshot({ path: screenshots.narrowCanvas, fullPage: true })
  await page.setViewportSize({ width: 1360, height: 960 })
  observe('success-screenshots', { desktop: screenshots.desktopCanvas, narrow: screenshots.narrowCanvas, canvasNarrowWidth })

  // Deterministic queued-second-write proof. The first geometry save succeeds
  // server-side while its response and the resulting graph response are both
  // held; a second resize is pressed into the queue meanwhile. Releasing the
  // graph response first forces the shell to remount from authoritative source
  // while the queued write is still pending. Both writes must land, the second
  // request must chain the first response revision, and the rendered preview
  // must reconcile to the authored replay without masking the transition.
  const queuedPhase = { posts: [], graphHold: null, postHold: null, graphCandidate: null, graphCommitted: false, previewObservations: [], graphHoldArmed: true, savingStatusObservations: [], order: [] }
  const queuedGeometryRoute = '**/__notebook/artifacts/checkout-review/geometry'
  const queuedGraphRoute = '**/__notebook/graph'
  const holdQueuedGraph = async route => {
    // The graph snapshot is fetched only after the first geometry save has
    // committed server-side, so the held body can never be a pre-append refresh.
    const response = await route.fetch()
    const body = await response.json()
    queuedPhase.order.push('graph-hold')
    queuedPhase.graphHold = { route, response, sha256: createHash('sha256').update(JSON.stringify(body)).digest('hex') }
  }
  await page.route(queuedGraphRoute, async route => {
    if (route.request().method() !== 'GET' || !queuedPhase.graphHoldArmed || queuedPhase.graphHold) {
      const response = await route.fetch()
      queuedPhase.order.push('graph-passthrough')
      return route.fulfill({ response })
    }
    if (!queuedPhase.graphCandidate) {
      queuedPhase.order.push('graph-candidate')
      queuedPhase.graphCandidate = route
      return
    }
    if (queuedPhase.graphCommitted) {
      await holdQueuedGraph(route)
      return
    }
    const response = await route.fetch()
    queuedPhase.order.push('graph-passthrough')
    return route.fulfill({ response })
  })
  await page.route(queuedGeometryRoute, async route => {
    queuedPhase.order.push('post-entry')
    const response = await route.fetch()
    const body = await response.json()
    const capture = {
      method: route.request().method(),
      url: route.request().url(),
      status: response.status(),
      body: route.request().postDataJSON(),
      revisionHeader: route.request().headers()['if-match'] ?? null,
      revision: body.revision ?? null,
      geometry: body.geometry ?? null,
    }
    queuedPhase.posts.push(capture)
    queuedPhase.order.push('post-captured')
    if (queuedPhase.posts.length === 1) {
      if (capture.status === 200) {
        // Server commit acknowledged: route.fetch resolved with the appended save.
        queuedPhase.order.push('post-commit')
        queuedPhase.graphCommitted = true
        const candidate = queuedPhase.graphCandidate
        queuedPhase.graphCandidate = null
        if (candidate) await holdQueuedGraph(candidate)
      }
      queuedPhase.postHold = { route, response }
      return
    }
    await route.fulfill({ response })
  })

  const queuedBefore = await captureGeometry()
  const queuedMovesBefore = widgetEventCount(queuedBefore.source, 'review-note', 'widget_moved')
  const queuedUpdatesBefore = widgetEventCount(queuedBefore.source, 'review-note', 'widget_updated')
  await page.getByRole('button', { name: 'Fit canvas to view' }).click()
  await waitForFittedBounds([reviewPlacement])
  await dragBlock(reviewPlacement.locator('.tc-note'), 40, 26)
  await waitFor(() => queuedPhase.posts.length >= 1, 'The queued proof never observed the first geometry POST.')
  assert.equal(queuedPhase.posts[0].method, 'POST')
  assert.equal(queuedPhase.posts[0].body.operation, 'move')
  await waitFor(() => Boolean(queuedPhase.graphHold), 'The queued proof never captured a post-append graph response.')
  assert.ok(queuedPhase.order.indexOf('post-commit') >= 0 && queuedPhase.order.indexOf('graph-hold') > queuedPhase.order.indexOf('post-commit'),
    'The held graph response must be fetched only after the first geometry save committed server-side.')
  const queuedAfterAppend = await captureGeometry()
  assert.notDeepEqual(queuedAfterAppend.geometry, queuedBefore.geometry, 'The first queued save must be appended server-side before its response is released.')

  const savingStatusWhilePending = page.getByText('Saving canvas geometry…')
  await savingStatusWhilePending.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  queuedPhase.savingStatusObservations.push({ whileFirstSaveHeld: await savingStatusWhilePending.count() })

  const queuedResizeHandle = page.getByRole('button', { name: 'Resize note' })
  const queuedHandleBox = await queuedResizeHandle.boundingBox()
  assert.ok(queuedHandleBox, 'The queued proof must find the resizable note handle while responses are held.')
  await dragBlock(queuedResizeHandle, 26, 18)
  const queuedHeldPreview = await renderedGeometry(reviewPlacement)
  queuedPhase.previewObservations.push({
    whileBothResponsesHeld: queuedHeldPreview,
    authoritativeAtHold: queuedAfterAppend.geometry,
    previewDiffersFromAuthoritative: {
      width: Math.abs(queuedHeldPreview.width - queuedAfterAppend.geometry.width) > 10,
      height: Math.abs(queuedHeldPreview.height - queuedAfterAppend.geometry.height) > 10,
    },
  })
  assert.equal(queuedPhase.posts.length, 1, 'The queued second save must not reach the server while the first save response is held.')

  await queuedPhase.graphHold.route.fulfill({ response: queuedPhase.graphHold.response })
  await waitForFrames(page)
  let renderedAfterGraphRelease = null
  try { renderedAfterGraphRelease = await renderedGeometry(reviewPlacement) } catch (observationError) {
    renderedAfterGraphRelease = { error: observationError.message }
  }
  queuedPhase.previewObservations.push({ afterGraphRelease: renderedAfterGraphRelease, authoritativeAtGraphRelease: queuedAfterAppend.geometry })
  const savingStatusAfterRemount = page.getByText('Saving canvas geometry…')
  const savingStatusAfterRemountCount = await savingStatusAfterRemount.count()
  queuedPhase.savingStatusObservations.push({ whileQueuedSecondSavePending: savingStatusAfterRemountCount })
  assert.equal(queuedPhase.posts.length, 1, 'The queued second save must still not be sent after the held graph response is released.')

  assert.ok(queuedPhase.postHold, 'The queued proof must hold the first geometry POST response.')
  await queuedPhase.postHold.route.fulfill({ response: queuedPhase.postHold.response })
  await waitFor(() => queuedPhase.posts.length >= 2, 'The queued second save never reached the server after the first response was released.')
  const queuedPost1 = queuedPhase.posts[0]
  const queuedPost2 = queuedPhase.posts[1]
  assert.equal(queuedPost2.method, 'POST')
  assert.equal(queuedPost2.body.operation, 'resize')
  assert.equal(queuedPost2.revisionHeader, `"${String(queuedPost1.revision).replace(/"/g, '')}"`,
    'The queued second save must chain the revision returned by the first response.')
  assert.equal(queuedPost2.status, 200, 'The queued second save must be accepted with the chained revision.')
  assert.equal(queuedPost2.body.width, queuedPost2.geometry.width, 'The queued resize response geometry must echo the request size.')
  assert.equal(queuedPost2.body.height, queuedPost2.geometry.height, 'The queued resize response geometry must echo the request size.')

  await waitFor(async () => widgetEventCount(await readFile(canvasPath, 'utf8'), 'review-note', 'widget_updated') > queuedUpdatesBefore,
    'The queued resize event was not appended to the authored JSONL.')
  const queuedFinal = await captureGeometry()
  assert.deepEqual(queuedFinal.geometry, queuedPost2.geometry, 'The final authored replay must equal the queued second save response geometry.')
  assert.ok(queuedFinal.geometry.width > queuedAfterAppend.geometry.width, 'The queued second write must persist the increased width.')
  assert.ok(queuedFinal.geometry.height > queuedAfterAppend.geometry.height, 'The queued second write must persist the increased height.')
  assert.ok(widgetEventCount(queuedFinal.source, 'review-note', 'widget_moved') > queuedMovesBefore, 'The queued first write must persist its move event.')
  await waitForRenderedGeometry('The final queued-save rendered geometry must match the authored replay.', queuedFinal.geometry)
  assert.equal(await page.locator('.notebook-shell__canvas-save-note').count(), 0, 'A successful queued save chain must clear the save notice.')
  await page.unroute(queuedGeometryRoute)
  await page.unroute(queuedGraphRoute)
  const queuedPhaseSummary = {
    before: { geometry: queuedBefore.geometry, moves: queuedMovesBefore, updates: queuedUpdatesBefore },
    firstPost: {
      operation: queuedPost1.body.operation, revision: queuedPost1.revision, status: queuedPost1.status,
      geometry: queuedPost1.geometry, responseSha256: createHash('sha256').update(JSON.stringify(queuedPost1.geometry)).digest('hex'),
    },
    heldGraphSha256: queuedPhase.graphHold.sha256,
    routeOrder: queuedPhase.order,
    savingStatusObservations: queuedPhase.savingStatusObservations,
    previewObservations: queuedPhase.previewObservations,
    secondPost: {
      operation: queuedPost2.body.operation, revision: queuedPost2.revision, status: queuedPost2.status,
      revisionHeader: queuedPost2.revisionHeader, geometry: queuedPost2.geometry, width: queuedPost2.body.width, height: queuedPost2.body.height,
    },
    finalGeometry: queuedFinal.geometry,
  }
  observe('queued-second-write', queuedPhaseSummary)

  const originalUrl = page.url()
  const popupPromise = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null)
  await page.evaluate(() => {
    document.addEventListener('click', event => {
      const anchor = event.target instanceof Element ? event.target.closest('a') : null
      if (anchor) window.__shellProofMetaClick = {
        trusted: event.isTrusted,
        metaKey: event.metaKey,
        defaultPrevented: event.defaultPrevented,
        href: anchor.href,
      }
    }, { once: true })
  })
  await page.locator('[data-artifact-id="borrow-flow"]').click({ modifiers: ['Meta'] })
  const popup = await popupPromise
  const metaClick = await page.evaluate(() => window.__shellProofMetaClick ?? null)
  assert.deepEqual(metaClick && { trusted: metaClick.trusted, metaKey: metaClick.metaKey, defaultPrevented: metaClick.defaultPrevented }, {
    trusted: true, metaKey: true, defaultPrevented: false,
  }, 'Modified-click must reach the link as trusted and unprevented.')
  assert.equal(page.url(), originalUrl, 'Modified-click must leave the current artifact selected in this tab.')
  assert.equal(await page.locator('[data-artifact-id="checkout-review"]').getAttribute('aria-current'), 'page', 'Modified-click must preserve the active selection.')
  const popupUrl = popup?.url() ?? null
  if (popup) {
    assert.match(popupUrl, /\/borrow-flow(?:\/|$)/)
    await popup.close()
  }
  observe('modified-click', { metaClick, popupObserved: Boolean(popup), popupUrl, currentUrl: page.url() })

  // Direct startup at canonical paths for every artifact kind keeps making the
  // stable-URL promise observable without any prior in-app navigation.
  const directStartup = {}
  const directStartupCases = [
    { kind: 'doc', id: 'checkout-rationale', path: '/docs/checkout-rationale', ready: () => page.locator('.doc-renderer h1').waitFor({ state: 'visible', timeout: 15000 }) },
    { kind: 'site', id: 'existing-catalog', path: '/sites/existing-catalog', ready: () => page.locator('.site-view[data-site-artifact-id="existing-catalog"]').waitFor({ state: 'visible', timeout: 15000 }) },
    { kind: 'canvas', id: 'checkout-review', path: '/canvas/checkout-review', ready: () => page.locator('.tc-block[data-block-id="review-note"]').waitFor({ state: 'attached', timeout: 15000 }) },
    { kind: 'prototype', id: 'borrow-flow', path: '/borrow-flow/request',
      ready: () => page.locator('.notebook-shell__prototype-frame').waitFor({ state: 'visible', timeout: 15000 }),
      verify: async () => {
        assert.equal(await page.locator('.notebook-shell__view-select select').inputValue(), 'request',
          'The directly entered named prototype route must land on the request view selector.')
        const directFrame = page.locator('.notebook-shell__prototype-frame')
        const directFrameSrc = await directFrame.getAttribute('src')
        assert.match(new URL(directFrameSrc, targetUrl).pathname, /^\/__notebook\/prototypes\/borrow-flow\/request\/?$/,
          'The directly entered named prototype route must serve the internal per-view frame path.')
        const directFrameHeading = await page.frameLocator('.notebook-shell__prototype-frame').locator('h1').textContent()
        assert.match(directFrameHeading, /The Shape of Small Things/,
          'The directly entered named prototype frame must render the request view content.')
        return { frameSrc: directFrameSrc, framePathname: new URL(directFrameSrc, targetUrl).pathname, viewSelector: 'request', frameHeading: directFrameHeading.trim() }
      } },
  ]
  for (const direct of directStartupCases) {
    await page.goto(`${targetUrl}${direct.path}`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    assert.equal(new URL(page.url()).pathname, direct.path, `Direct startup at ${direct.path} must keep the canonical route.`)
    assert.equal(new URL(page.url()).searchParams.has('artifact'), false, `Direct startup at ${direct.path} must not generate an artifact query.`)
    await direct.ready()
    assert.equal(await page.locator(`[data-artifact-id="${direct.id}"]`).getAttribute('aria-current'), 'page',
      `Direct startup at ${direct.path} must mark the sidebar entry active.`)
    const directDetails = await direct.verify?.()
    directStartup[direct.kind] = { path: direct.path, canonical: true, ...(directDetails ?? {}) }
  }
  await page.goBack()
  await page.locator('.tc-block[data-block-id="review-note"]').waitFor({ state: 'attached', timeout: 15000 })
  assert.equal(new URL(page.url()).pathname, '/canvas/checkout-review', 'Browser history must return to the directly visited canvas route.')
  await page.goForward()
  await page.locator('.notebook-shell__prototype-frame').waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(new URL(page.url()).pathname, '/borrow-flow/request', 'Browser history must return forward to the named prototype route.')
  assert.match(await page.frameLocator('.notebook-shell__prototype-frame').locator('h1').textContent(), /The Shape of Small Things/,
    'The forward-restored prototype frame must render the request view content again.')
  directStartup.browserHistory = { back: '/canvas/checkout-review', forward: '/borrow-flow/request' }
  observe('direct-canonical-startup', directStartup)

  // Canonical navigation under a non-root deployment prefix. The main runtime
  // is closed first so exactly one Vite dev server owns the shared optimizer
  // cache at a time; the page is parked on about:blank before the socket dies.
  await page.goto('about:blank')
  await runtime.close()
  runtime = null
  baseRuntime = await createNotebookRuntime({ root: notebookRoot, base: '/notebooks/demo/' }).then(server => server.start())
  const baseTarget = baseRuntime.address
  assert.ok(baseTarget, 'The base-prefixed runtime must expose its notebook root URL.')
  allowedFaviconOrigins.add(new URL(baseTarget).origin)
  await page.goto(`${baseTarget}/notebooks/demo/`, { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.locator('.notebook-shell').waitFor({ state: 'visible', timeout: 15000 })
  const baseSidebarHrefs = await page.evaluate(() => [...document.querySelectorAll('a[data-artifact-id]')].map(node => node.getAttribute('href')))
  assert.ok(baseSidebarHrefs.length >= 4)
  for (const href of baseSidebarHrefs) {
    assert.ok(href.startsWith('/notebooks/demo/'), `Sidebar links must carry the deployment prefix: ${href}`)
    assert.equal(new URL(href, 'https://prefix-proof.invalid').searchParams.has('artifact'), false, `Sidebar links must stay canonical under the prefix: ${href}`)
  }
  const baseDocHref = await page.locator('[data-artifact-id="checkout-rationale"]').getAttribute('href')
  assert.equal(baseDocHref, '/notebooks/demo/docs/checkout-rationale')
  await page.locator('[data-artifact-id="checkout-rationale"]').click()
  assert.equal(new URL(page.url()).pathname, '/notebooks/demo/docs/checkout-rationale')
  await page.locator('.doc-renderer h1').waitFor({ state: 'visible', timeout: 15000 })
  assert.match(await page.locator('.doc-renderer h1').textContent(), /Borrow flow review/)
  await page.goBack()
  assert.equal(new URL(page.url()).pathname, '/notebooks/demo/')
  await page.goForward()
  assert.equal(new URL(page.url()).pathname, '/notebooks/demo/docs/checkout-rationale')
  await page.locator('.doc-renderer h1').waitFor({ state: 'visible', timeout: 15000 })
  await page.locator('[data-artifact-id="borrow-flow"]').click()
  const basePrototypeFrame = page.locator('.notebook-shell__prototype-frame')
  await basePrototypeFrame.waitFor({ state: 'visible', timeout: 15000 })
  const basePrototypeSrc = await basePrototypeFrame.getAttribute('src')
  assert.match(new URL(basePrototypeSrc, baseTarget).pathname, /^\/__notebook\/prototypes\/borrow-flow/, 'Prototype frames must use the served internal view route under a prefix.')
  await page.goto(`${baseTarget}/notebooks/demo/sites/existing-catalog`, { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.locator('.site-view[data-site-artifact-id="existing-catalog"]').waitFor({ state: 'visible', timeout: 15000 })
  assert.equal(new URL(page.url()).pathname, '/notebooks/demo/sites/existing-catalog')
  observe('base-prefix-canonical-routes', {
    baseTarget, sidebarHrefs: baseSidebarHrefs.length, docHref: baseDocHref,
    historyVerified: true, prototypeFrameSrc: basePrototypeSrc, deepSiteLink: '/notebooks/demo/sites/existing-catalog',
  })
  await baseRuntime.close()
  baseRuntime = null

  expectedFaviconResponses.push(...failedResponses.filter(response => {
    const url = new URL(response.url)
    return response.status === 404 && response.method === 'GET' && allowedFaviconOrigins.has(url.origin) && url.pathname === '/favicon.ico'
  }))
  expectedFaviconConsoleErrors.push(...consoleErrors.filter(entry =>
    expectedFaviconResponses.some(response => entry.location?.url === response.url && /\b404\b|not found/i.test(entry.text))
  ))
  const unexpectedResponses = failedResponses.filter(response => !(
    response.status === 409 && response.method === 'POST' && response.url === expectedConflictUrl &&
    geometryResponses.some(observed => observed.status === response.status && observed.method === response.method && observed.url === response.url)
  ) && !expectedFaviconResponses.some(expected => expected.status === response.status && expected.method === response.method && expected.url === response.url))
  expectedConflictConsoleErrors.push(...consoleErrors.filter(entry => {
    const mentionsExactUrl = entry.text.includes(expectedConflictUrl) || entry.location?.url === expectedConflictUrl
    const exactConflictObserved = failedResponses.some(response => response.status === 409 && response.method === 'POST' && response.url === expectedConflictUrl) &&
      geometryResponses.some(response => response.status === 409 && response.method === 'POST' && response.url === expectedConflictUrl)
    return mentionsExactUrl && exactConflictObserved
  }))
  const unexpectedConsoleErrors = consoleErrors.filter(entry => !expectedConflictConsoleErrors.includes(entry) && !expectedFaviconConsoleErrors.includes(entry))
  assert.deepEqual(pageErrors, [], `Unexpected page errors: ${JSON.stringify(pageErrors)}`)
  assert.deepEqual(unexpectedConsoleErrors, [], `Unexpected console errors: ${JSON.stringify(unexpectedConsoleErrors)}`)
  assert.deepEqual(unexpectedResponses, [], `Unexpected failed product responses: ${JSON.stringify(unexpectedResponses)}`)
  observe('browser-checks-complete', { pageErrors, consoleErrors, failedResponses })

  const currentCanvas = await readFile(canvasPath, 'utf8')
  proofData = {
    status: 'passed', url: targetUrl, sourceNotebookRoot, originalNotebookDigest,
    artifacts: ['borrow-flow', 'checkout-review', 'checkout-rationale', 'existing-catalog'],
    prototypeViews: { defaultUrl, requestUrl },
    document: { prototypeUrls: docPrototypeUrls, site: docSiteUrls, screenshotWidth: docScreenshotWidth },
    site: { ...standaloneSiteUrls, screenshotWidth: standaloneScreenshotWidth },
    canvas: { zoomBefore, zoomAfter, scrollBeforePan, scrollAfterPan, moved: movedGeometry.geometry, resized: resizedGeometry.geometry, reload: reloadGeometry.geometry, reloadRenderedGeometry, boardOrigin: reloadGeometry.board.origin, externalTextVisible: true, conflict: conflictGeometrySummary(conflictStatus, conflictSource.geometry), currentSourceSha256: createHash('sha256').update(currentCanvas).digest('hex') },
    queuedSecondWrite: queuedPhaseSummary,
    directCanonicalStartup: directStartup,
    basePrefixStage: { baseTarget, docHref: baseDocHref, sidebarHrefsChecked: baseSidebarHrefs.length },
    metaClick, screenshots, phases, pageErrors, consoleErrors, expectedConflictConsoleErrors, expectedFaviconResponses, expectedFaviconConsoleErrors, failedResponses, geometryResponses,
  }
} catch (cause) {
  error = cause
  if (page) {
    try {
      failureSnapshot = await page.evaluate(() => ({
        url: location.href,
        heading: document.querySelector('[data-notebook-artifact-title]')?.textContent ?? null,
        artifacts: [...document.querySelectorAll('[data-artifact-id]')].map(node => ({ id: node.dataset.artifactId, active: node.getAttribute('aria-current') === 'page' })),
        canvas: {
          placements: [...document.querySelectorAll('.tc-canvas [data-block-id]')].map(node => ({ id: node.dataset.blockId, style: node.getAttribute('style'), text: node.innerText?.slice(0, 240) ?? '' })),
          diagnostics: [...document.querySelectorAll('[role="alert"], [role="status"]')].map(node => node.textContent?.slice(0, 400)),
          viewport: (() => { const rect = document.querySelector('.notebook-shell__canvas-viewport')?.getBoundingClientRect(); return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null })(),
        },
        documentWidgets: [...document.querySelectorAll('.doc-widget')].map(node => ({ type: node.dataset.widgetType, text: node.innerText?.slice(0, 300) ?? '' })),
      }))
    } catch (snapshotError) {
      cleanupErrors.push({ step: 'failure-dom-snapshot', message: snapshotError.message, stack: snapshotError.stack })
    }
    try {
      screenshots.failure = path.join(tmpdir(), `design-notebook-shell-failure-${proofRunId}.png`)
      await page.screenshot({ path: screenshots.failure, fullPage: true })
    } catch (snapshotError) {
      cleanupErrors.push({ step: 'failure-screenshot', message: snapshotError.message, stack: snapshotError.stack })
    }
  }
} finally {
  const cleanupStep = async (step, action) => {
    try { await action() } catch (cause) { cleanupErrors.push({ step, message: cause.message, stack: cause.stack }) }
  }
  await cleanupStep('browser-close', async () => browser?.close())
  await cleanupStep('base-runtime-close', async () => {
    const pendingBaseRuntime = baseRuntime
    baseRuntime = null
    if (pendingBaseRuntime) await pendingBaseRuntime.close()
  })
  await cleanupStep('runtime-close', async () => runtime?.close())
  await cleanupStep('site-server-close', async () => {
    if (siteServer?.listening) await new Promise((resolve, reject) => siteServer.close(cause => cause ? reject(cause) : resolve()))
  })
  await cleanupStep('temporary-fixture-remove', async () => rm(temporaryRoot, { recursive: true, force: true }))
  let finalDigest = null
  await cleanupStep('source-notebook-digest', async () => { finalDigest = await treeDigest(sourceNotebookRoot) })
  const sourceNotebookUnchanged = finalDigest !== null && finalDigest === originalNotebookDigest
  if (!sourceNotebookUnchanged) cleanupErrors.push({ step: 'source-preservation', message: 'The ignored example notebook changed during the proof.' })
  const failure = error ? { name: error.name, message: error.message, stack: error.stack, pageSnapshot: failureSnapshot } : null
  const finalEvidence = () => ({
    ...(proofData ?? {}), status: failure || cleanupErrors.length ? 'failed' : 'passed', evidencePath,
    sourceNotebookRoot, originalNotebookDigest, finalDigest, sourceNotebookUnchanged, failure,
    cleanupErrors, screenshots, phases, refreshEvents, geometryResponses, pageErrors, consoleErrors, failedResponses,
    expectedFaviconResponses, expectedFaviconConsoleErrors, expectedConflictConsoleErrors,
  })
  await cleanupStep('evidence-write', async () => writeFile(evidencePath, `${JSON.stringify(finalEvidence(), null, 2)}\n`))
  if (cleanupErrors.some(item => item.step === 'evidence-write')) {
    try { await writeFile(evidencePath, `${JSON.stringify(finalEvidence(), null, 2)}\n`) } catch (writeError) {
      cleanupErrors.push({ step: 'evidence-write-retry', message: writeError.message, stack: writeError.stack })
    }
  }
  console.log(JSON.stringify({ evidencePath, status: finalEvidence().status, phases: phases.length, cleanupErrors }))
}

if (error || cleanupErrors.length) process.exitCode = 1

function conflictGeometrySummary(status, geometry) {
  return { status, geometry }
}
