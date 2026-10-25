import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { replayCanvas } from '../../src/canvas-format/index.js'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const sourceNotebook = path.join(repositoryRoot, 'examples/first-look/notebook')
const cliPath = path.join(repositoryRoot, 'bin/design-notebook.js')
const browserModule = process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href
  : 'playwright'
const chrome = process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const candidateFiles = [
  'src/core/publisher/index.js',
  'src/core/publisher/browser.js',
  'tests/publisher/publisher.test.js',
  'tests/publisher/browser-proof.mjs',
  'docs/format/publishing.md',
]
const evidencePath = path.resolve(process.env.DESIGN_NOTEBOOK_BROWSER_PROOF_EVIDENCE
  ?? path.join(repositoryRoot, 'tests/publisher/browser-proof-evidence.json'))
const outputs = []
const httpFailures = []
const consoleErrors = []
const pageErrors = []
const requestFailures = []
let candidateHashes = {}
let outputHashes = []
let originalSourceDigest
let temporaryNotebookRoot
const evidence = {
  formatVersion: 1,
  status: 'running',
  startedAt: new Date().toISOString(),
  evidencePath,
  candidateHashes,
  outputHashes,
  builds: [],
  outputs: [],
  phases: [],
  httpFailures,
  requestFailures,
  consoleErrors,
  pageErrors,
  failures: [],
  integrity: {},
  cleanup: { temporaryTreeRemoved: false, errors: [] },
}
let phase = 'preflight'
let browser
let temporaryRoot

async function digestFile(file) {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex')
}

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
  for (const absolute of files.sort()) {
    hash.update(path.relative(directory, absolute).split(path.sep).join('/'))
    hash.update('\0')
    hash.update(await fs.readFile(absolute))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function write(root, relative, source) {
  const target = path.join(root, ...relative.split('/'))
  return fs.mkdir(path.dirname(target), { recursive: true }).then(() => fs.writeFile(target, source))
}

function mimeType(file) {
  return ({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jsonl': 'application/jsonl; charset=utf-8',
    '.svg': 'image/svg+xml',
  })[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

async function staticServer(outputRoot, base) {
  const requests = []
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://static-notebook.invalid')
    requests.push({ path: url.pathname, method: request.method })
    if (url.pathname === `${base}favicon.ico`) {
      response.writeHead(204).end()
      return
    }
    if (!url.pathname.startsWith(base)) {
      response.writeHead(404).end('Outside configured static base')
      return
    }
    let relative
    try {
      relative = decodeURIComponent(url.pathname.slice(base.length))
    } catch {
      response.writeHead(400).end('Invalid URL path')
      return
    }
    if (!relative) relative = 'index.html'
    let file = path.resolve(outputRoot, relative)
    if (file !== outputRoot && !file.startsWith(`${outputRoot}${path.sep}`)) {
      response.writeHead(404).end('Outside static output')
      return
    }
    try {
      const stat = await fs.stat(file)
      if (stat.isDirectory()) file = path.join(file, 'index.html')
      const body = await fs.readFile(file)
      response.writeHead(200, { 'content-type': mimeType(file), 'cache-control': 'no-store' })
      response.end(body)
    } catch {
      response.writeHead(404).end('Not found in static output')
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  }
}

function runCliBuild(notebookRoot, outputRoot, base) {
  const result = spawnSync(process.execPath, [cliPath, 'build', notebookRoot, '--out-dir', outputRoot, '--base', base], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`CLI build failed for base ${base} (exit ${result.status}).\n${result.stdout}\n${result.stderr}`)
  }
  return `${result.stdout}${result.stderr}`
}

async function domSnapshot(page) {
  return page.evaluate(() => ({
    url: location.href,
    title: document.title,
    selectedHeading: document.querySelector('[data-notebook-artifact-title]')?.textContent?.trim() ?? null,
    selectedView: document.querySelector('.notebook-shell__view-select select')?.value ?? null,
    prototypeFrameUrl: document.querySelector('.notebook-shell__prototype-frame')?.src ?? null,
    graphDiagnostics: [...document.querySelectorAll('.notebook-shell__graph-diagnostics li')].map(node => ({
      code: node.dataset.diagnosticCode ?? '',
      message: node.innerText.trim(),
    })),
    artifactIds: [...document.querySelectorAll('[data-artifact-id][data-artifact-kind]')].map(node => node.dataset.artifactId),
    status: [...document.querySelectorAll('[role="alert"], [role="status"], .notebook-shell__diagnostics')]
      .map(node => node.innerText.trim()).filter(Boolean).slice(0, 12),
    bodyText: document.body.innerText.slice(0, 1800),
  })).catch(error => ({ snapshotError: error.message }))
}

async function persistEvidence() {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`
  await fs.mkdir(path.dirname(evidencePath), { recursive: true })
  const temporaryEvidencePath = `${evidencePath}.${process.pid}.tmp`
  await fs.writeFile(temporaryEvidencePath, serialized)
  await fs.rename(temporaryEvidencePath, evidencePath)
}

async function proveImage(locator, expectedPath, label, expectedAlt) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 })
  await locator.scrollIntoViewIfNeeded()
  await locator.evaluate(image => image.decode())
  const result = await locator.evaluate(image => ({
    src: image.currentSrc,
    path: new URL(image.currentSrc).pathname,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    complete: image.complete,
    alt: image.alt,
  }))
  assert.ok(result.complete && result.naturalWidth > 0 && result.naturalHeight > 0, `${label} did not decode: ${JSON.stringify(result)}`)
  assert.equal(result.path, expectedPath, `${label} resolved against an unexpected asset base.`)
  if (expectedAlt !== undefined) assert.equal(result.alt, expectedAlt, `${label} has an unexpected accessible label.`)
  return result
}

async function proveBase(browserInstance, output, base) {
  phase = `serve-${base}`
  const server = await staticServer(output.root, base)
  const page = await browserInstance.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', error => pageErrors.push({ base, message: error.message }))
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push({ base, text: message.text(), location: message.location() })
  })
  page.on('requestfailed', request => requestFailures.push({ base, url: request.url(), error: request.failure()?.errorText }))
  page.on('response', response => {
    if (response.status() >= 400) httpFailures.push({ base, status: response.status(), url: response.url() })
  })
  let snapshot = null
  try {
    phase = `shell-and-prototype-${base}`
    const directUrl = new URL(`${base}borrow-flow/confirmation`, server.origin).href
    await page.goto(directUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await page.locator('.notebook-shell').waitFor({ state: 'visible', timeout: 20_000 })
    for (const [id, kind] of [
      ['borrow-flow', 'prototype'],
      ['checkout-review', 'canvas'],
      ['checkout-rationale', 'doc'],
      ['existing-catalog', 'site'],
    ]) {
      await page.locator(`[data-artifact-id="${id}"][data-artifact-kind="${kind}"]`).waitFor({ state: 'attached', timeout: 10_000 })
    }
    assert.equal(await page.locator('[data-folder-path="research"]').count(), 1, 'Nested research group is absent from shell navigation.')
    const diagnosticsDisclosure = page.locator('.notebook-shell__graph-diagnostics')
    await diagnosticsDisclosure.locator('summary').click()
    assert.equal(await diagnosticsDisclosure.evaluate(node => node.open), true, 'Graph diagnostics disclosure did not open.')
    const graphDiagnostics = await page.locator('.notebook-shell__graph-diagnostics li').evaluateAll(nodes => nodes.map(node => ({
      code: node.dataset.diagnosticCode ?? '',
      message: node.innerText.trim(),
    })))
    assert.deepEqual(
      graphDiagnostics.map(item => item.code).sort(),
      ['CANVAS_EVENT_HISTORY_EXCLUDED', 'SITE_LOCAL_REFERENCE_EXCLUDED'].sort(),
      `Unexpected static graph diagnostics: ${JSON.stringify(graphDiagnostics)}`,
    )
    assert.ok(graphDiagnostics.every(item => item.message.length > 0), 'A graph diagnostic was present without its visible explanation.')
    assert.equal(await page.locator('[data-notebook-artifact-title]').textContent(), 'Borrow a book')
    assert.equal(await page.locator('.notebook-shell__view-select select').inputValue(), 'confirmation')
    assert.equal(new URL(page.url()).pathname, `${base}borrow-flow/confirmation`)
    assert.equal(new URL(page.url()).searchParams.has('artifact'), false)
    const prototypeFrame = page.locator('.notebook-shell__prototype-frame')
    await page.frameLocator('.notebook-shell__prototype-frame').getByRole('heading', { name: 'Your hold is in the queue' }).waitFor({ state: 'visible', timeout: 20_000 })
    assert.equal(
      new URL(await prototypeFrame.getAttribute('src')).pathname,
      `${base}prototypes/borrow-flow/confirmation`,
      'The static route must preserve the resolver path for the authored confirmation view.',
    )

    phase = `prototype-states-${base}`
    const viewSelect = page.locator('.notebook-shell__view-select select')
    await viewSelect.selectOption('request')
    await page.frameLocator('.notebook-shell__prototype-frame').getByRole('heading', { name: 'The Shape of Small Things' }).waitFor({ state: 'visible', timeout: 20_000 })
    assert.equal(new URL(page.url()).pathname, `${base}borrow-flow/request`)
    assert.equal(
      new URL(await prototypeFrame.getAttribute('src')).pathname,
      `${base}prototypes/borrow-flow/request`,
      'The static route must preserve the resolver path for the authored request view.',
    )
    await viewSelect.selectOption('confirmation')
    await page.frameLocator('.notebook-shell__prototype-frame').getByRole('heading', { name: 'Your hold is in the queue' }).waitFor({ state: 'visible', timeout: 20_000 })
    assert.equal(new URL(page.url()).pathname, `${base}borrow-flow/confirmation`, 'Selecting a prototype state did not navigate to its canonical public path.')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.frameLocator('.notebook-shell__prototype-frame').getByRole('heading', { name: 'Your hold is in the queue' }).waitFor({ state: 'visible', timeout: 20_000 })
    assert.equal(await viewSelect.inputValue(), 'confirmation', 'Direct URL refresh did not restore the selected prototype state.')

    phase = `document-assets-${base}`
    await page.locator('[data-artifact-id="checkout-rationale"][data-artifact-kind="doc"]').click()
    await page.locator('.doc-renderer h1').waitFor({ state: 'visible', timeout: 15_000 })
    const expectedDocImage = `${base}notebook-assets/research/assets/publisher-proof.svg`
    const markdownImage = page.locator('.doc-renderer img[alt="Publisher Markdown diagram"]')
    const componentImage = page.locator('.doc-renderer img[alt="Publisher component diagram"]')
    const markdownImageResult = await proveImage(markdownImage, expectedDocImage, 'Nested Markdown image', 'Publisher Markdown diagram')
    const componentImageResult = await proveImage(componentImage, expectedDocImage, 'Nested Image component', 'Publisher component diagram')

    phase = `canvas-assets-${base}`
    await page.locator('[data-artifact-id="checkout-review"][data-artifact-kind="canvas"]').click()
    await page.locator('.tc-canvas [data-block-id="publisher-proof-image"] img').waitFor({ state: 'attached', timeout: 15_000 })
    const chartFallback = page.locator('.tc-canvas [data-block-id="chart-reference"] .canvas-scene__fallback')
    await chartFallback.waitFor({ state: 'visible', timeout: 10_000 })
    const chartFallbackText = await chartFallback.innerText()
    assert.match(chartFallbackText, /Text fallback: The circulation chart is not included/)
    const canvasDiagnostics = await page.locator('.notebook-shell__canvas-stage + .notebook-shell__diagnostics li').evaluateAll(nodes => nodes.map(node => ({
      code: node.dataset.diagnosticCode ?? '',
      message: node.innerText.trim(),
    })))
    const expectedCanvasImage = `${base}notebook-assets/research/checkout-review.canvas/assets/canvas-proof.svg`
    const canvasImageResult = await proveImage(
      page.locator('.tc-canvas [data-block-id="publisher-proof-image"] img'),
      expectedCanvasImage,
      'Canvas image',
      'Publisher canvas image',
    )
    const canvasSite = page.locator('.tc-canvas [data-block-id="catalog-view"] .canvas-scene__site')
    const canvasSiteScreenshot = await proveImage(canvasSite.locator('img'), `${base}notebook-assets/research/catalog.site/assets/catalog-home.svg`, 'Canvas Site screenshot', 'Catalog home')
    assert.equal(await canvasSite.locator('iframe').count(), 0, 'Static Canvas Site output must not contain an iframe.')
    assert.equal(await canvasSite.locator('a').count(), 1)
    assert.equal(await canvasSite.locator('a').getAttribute('href'), 'https://example.com/books')

    phase = `standalone-site-${base}`
    await page.locator('[data-artifact-id="existing-catalog"][data-artifact-kind="site"]').click()
    const site = page.locator('.site-view[data-site-artifact-id="existing-catalog"]')
    await site.waitFor({ state: 'visible', timeout: 15_000 })
    const standaloneScreenshot = await proveImage(site.locator('img'), `${base}notebook-assets/research/catalog.site/assets/catalog-home.svg`, 'Standalone Site screenshot', 'Catalog home')
    assert.equal(await site.locator('iframe').count(), 0, 'Static Site view must not contain an iframe.')
    assert.equal(await site.locator('a').count(), 1)
    assert.equal(await site.locator('a').getAttribute('href'), 'https://example.com/books')
    for (const anchor of await site.locator('a').evaluateAll(nodes => nodes.map(node => node.href))) {
      assert.ok(!/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(anchor), `Static Site exposed a local destination: ${anchor}`)
    }

    assert.deepEqual(httpFailures.filter(item => item.base === base), [], 'Static host returned an HTTP error.')
    assert.deepEqual(requestFailures.filter(item => item.base === base), [], 'Browser request failed.')
    assert.deepEqual(pageErrors.filter(item => item.base === base), [], 'Browser raised a page error.')
    assert.deepEqual(consoleErrors.filter(item => item.base === base), [], 'Browser logged a console error.')
    assert.ok(server.requests.length > 0 && server.requests.every(request => request.path.startsWith(base)), 'A request escaped the configured static base.')
    assert.ok(!server.requests.some(request => request.path.includes('/__notebook/')), 'Static page requested a local notebook-core route.')
    snapshot = await domSnapshot(page)
    const result = {
      base,
      outputTreeSha256: output.sha256,
      requests: server.requests.length,
      prototypeViews: ['request', 'confirmation'],
      graphDiagnostics,
      canvasDiagnostics,
      chartFallbackText,
      markdownImage: markdownImageResult,
      componentImage: componentImageResult,
      canvasImage: canvasImageResult,
      canvasSiteScreenshot,
      standaloneSiteScreenshot: standaloneScreenshot,
      staticSiteIframes: 0,
      siteLink: 'https://example.com/books',
      httpFailures: httpFailures.filter(item => item.base === base),
      requestFailures: requestFailures.filter(item => item.base === base),
      consoleErrors: consoleErrors.filter(item => item.base === base),
      pageErrors: pageErrors.filter(item => item.base === base),
      shellSnapshot: snapshot,
    }
    outputs.push(result)
    evidence.outputs.push(result)
    console.log(JSON.stringify({ phase: 'static-browser-proof-pass', ...result }))
  } catch (error) {
    snapshot = await domSnapshot(page)
    evidence.status = 'failed'
    evidence.failures.push({
      phase: 'static-browser-proof-failure',
      at: phase,
      base,
      candidateHashes,
      outputTreeSha256: output.sha256,
      error: error.stack ?? error.message,
      shellSnapshot: snapshot,
      httpFailures: httpFailures.filter(item => item.base === base),
      requestFailures: requestFailures.filter(item => item.base === base),
      consoleErrors: consoleErrors.filter(item => item.base === base),
      pageErrors: pageErrors.filter(item => item.base === base),
      staticRequests: server.requests,
    })
    throw error
  } finally {
    const closed = await Promise.allSettled([page.close(), server.close()])
    for (const result of closed) {
      if (result.status === 'rejected') evidence.cleanup.errors.push(`Page/server cleanup: ${result.reason?.message ?? result.reason}`)
    }
  }
}

try {
  phase = 'candidate-hashes'
  evidence.phases.push({ phase, status: 'started' })
  candidateHashes = Object.fromEntries(await Promise.all(candidateFiles.map(async relative => [
    relative,
    await digestFile(path.join(repositoryRoot, relative)),
  ])))
  evidence.candidateHashes = candidateHashes
  originalSourceDigest = await treeDigest(sourceNotebook)
  evidence.integrity.originalStarterTreeSha256Before = originalSourceDigest
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'design-notebook-publisher-browser-proof-'))
  const relativeEvidencePath = path.relative(temporaryRoot, evidencePath)
  assert.ok(relativeEvidencePath.startsWith('..') || path.isAbsolute(relativeEvidencePath), 'Evidence path must remain outside the temporary tree that the harness removes.')
  const notebookRoot = path.join(temporaryRoot, 'notebook')
  temporaryNotebookRoot = notebookRoot
  await fs.cp(sourceNotebook, notebookRoot, { recursive: true })

  phase = 'validate-authored-fixture'
  evidence.phases.push({ phase, status: 'started' })
  const canvasPath = path.join(notebookRoot, 'research/checkout-review.canvas/checkout-review.canvas.jsonl')
  const canvasSource = await fs.readFile(canvasPath, 'utf8')
  const canvasHeader = JSON.parse(canvasSource.split(/\r?\n/, 1)[0])
  assert.equal(canvasHeader.event, 'canvas_created')
  assert.equal(canvasHeader.canvasId, 'checkout-review')
  const canvasPlacements = canvasSource.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    .filter(record => record.event === 'widget_added').map(record => record.widget)
  assert.ok(canvasPlacements.some(widget => widget.type === 'prototype' && widget.props?.artifactId === 'borrow-flow'))
  assert.ok(canvasPlacements.some(widget => widget.type === 'site' && widget.props?.artifactId === 'existing-catalog'))
  const replayedCanvas = replayCanvas(canvasSource)
  assert.equal(replayedCanvas.status, 'complete')
  assert.equal(replayedCanvas.state.widgets.find(widget => widget.id === 'prototype-preview')?.props?.viewId, 'request')
  assert.equal(replayedCanvas.state.widgets.find(widget => widget.id === 'catalog-view')?.props?.viewId, 'catalog-home')

  const prototypeDescriptor = JSON.parse(await fs.readFile(path.join(notebookRoot, 'research/borrow-flow.prototype/borrow-flow.prototype.json'), 'utf8'))
  assert.equal(prototypeDescriptor.title, 'Borrow a book')
  assert.deepEqual(prototypeDescriptor.views.map(view => view.id), ['default', 'request', 'confirmation'])
  assert.equal(prototypeDescriptor.views.find(view => view.id === 'request').path, '/request')
  assert.equal(prototypeDescriptor.views.find(view => view.id === 'confirmation').path, '/confirmation')
  const siteDescriptor = JSON.parse(await fs.readFile(path.join(notebookRoot, 'research/catalog.site/catalog.site.json'), 'utf8'))
  assert.equal(siteDescriptor.id, 'existing-catalog')
  assert.equal(siteDescriptor.views[0].id, 'catalog-home')
  assert.equal(siteDescriptor.views[0].screenshot, 'assets/catalog-home.svg')
  assert.equal(siteDescriptor.views[0].publishedUrl, 'https://example.com/books')
  const confirmationState = JSON.parse(await fs.readFile(path.join(notebookRoot, 'research/borrow-flow.prototype/state/confirmation.flow.json'), 'utf8'))
  const requestState = JSON.parse(await fs.readFile(path.join(notebookRoot, 'research/borrow-flow.prototype/state/request.flow.json'), 'utf8'))
  assert.equal(requestState.request.title, 'The Shape of Small Things')
  assert.equal(confirmationState.request.title, 'Your hold is in the queue')
  const prototypeSource = await fs.readFile(path.join(notebookRoot, 'research/borrow-flow.prototype/src/prototype.jsx'), 'utf8')
  assert.ok(prototypeSource.includes('<h1 id="book-title">{content.title}</h1>'))
  const shellSource = await fs.readFile(path.join(repositoryRoot, 'src/client/shell/index.js'), 'utf8')
  for (const selector of ['notebook-shell__prototype-frame', 'notebook-shell__view-select', 'notebook-shell__graph-diagnostics']) {
    assert.ok(shellSource.includes(selector), `Expected Design Notebook shell selector hook is missing: ${selector}`)
  }
  const chromeSource = await fs.readFile(path.join(repositoryRoot, 'src/vendor/hypercanvas/NotebookShell/NotebookChrome.jsx'), 'utf8')
  for (const selector of ['data-artifact-id', 'data-artifact-kind', 'data-notebook-artifact-title', 'data-folder-path']) {
    assert.ok(chromeSource.includes(selector), `Expected vendored Hypercanvas chrome hook is missing: ${selector}`)
  }
  const canvasAdapterSource = await fs.readFile(path.join(repositoryRoot, 'src/vendor/tiny-canvas/interactive.js'), 'utf8')
  for (const selector of ['notebook-shell__canvas-viewport', 'data-block-id', 'canvas-scene__fallback']) {
    assert.ok(canvasAdapterSource.includes(selector), `Expected native Tiny Canvas adapter hook is missing: ${selector}`)
  }
  const siteSource = await fs.readFile(path.join(repositoryRoot, 'src/client/sites/index.js'), 'utf8')
  assert.ok(siteSource.includes('data-site-artifact-id'))
  const canvasSourceModule = await fs.readFile(path.join(repositoryRoot, 'src/vendor/tiny-canvas/index.js'), 'utf8')
  for (const selector of ['canvas-scene__site-link', 'canvas-scene__image', 'canvas-scene__site']) {
    assert.ok(canvasSourceModule.includes(selector), `Expected renderer selector hook is missing: ${selector}`)
  }
  evidence.preflight = {
    artifactIds: ['borrow-flow', 'checkout-review', 'checkout-rationale', 'existing-catalog'],
    prototypeTitle: prototypeDescriptor.title,
    requestStateTitle: requestState.request.title,
    confirmationStateTitle: confirmationState.request.title,
    siteView: { id: siteDescriptor.views[0].id, screenshot: siteDescriptor.views[0].screenshot, publishedUrl: siteDescriptor.views[0].publishedUrl },
    graphDiagnosticExpectation: ['CANVAS_EVENT_HISTORY_EXCLUDED', 'SITE_LOCAL_REFERENCE_EXCLUDED'],
    finalCanvasViews: { prototype: 'request', site: 'catalog-home' },
    shellSelectorHooks: ['data-artifact-id', 'data-artifact-kind', 'data-notebook-artifact-title', 'data-folder-path', 'notebook-shell__prototype-frame', 'notebook-shell__view-select', 'notebook-shell__canvas-viewport'],
  }
  evidence.phases.push({ phase, status: 'passed' })

  phase = 'add-proof-resources-to-temporary-starter-copy'
  evidence.phases.push({ phase, status: 'started' })
  const documentPath = path.join(notebookRoot, 'research/checkout-rationale.doc.mdx')
  let documentSource = await fs.readFile(documentPath, 'utf8')
  assert.ok(documentSource.includes("import { Prototype, Site } from 'design-notebook/docs'"), 'Expected starter document import changed; update this proof against the authored source.')
  documentSource = documentSource.replace(
    "import { Prototype, Site } from 'design-notebook/docs'",
    "import { Prototype, Site, Image } from 'design-notebook/docs'",
  )
  documentSource += '\n\n![Publisher Markdown diagram](assets/publisher-proof.svg)\n\n<Image src="assets/publisher-proof.svg" alt="Publisher component diagram" />\n'
  await fs.writeFile(documentPath, documentSource)
  const proofSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32" viewBox="0 0 64 32"><rect width="64" height="32" fill="#d9e8ff"/><circle cx="16" cy="16" r="9" fill="#315c9b"/></svg>\n'
  await write(notebookRoot, 'research/assets/publisher-proof.svg', proofSvg)
  await write(notebookRoot, 'research/checkout-review.canvas/assets/canvas-proof.svg', proofSvg)
  const amendedCanvas = `${canvasSource.trimEnd()}\n${JSON.stringify({
    event: 'widget_added',
    widget: {
      id: 'publisher-proof-image',
      type: 'image',
      position: { x: 40, y: 650 },
      props: { src: 'assets/canvas-proof.svg', alt: 'Publisher canvas image', width: 180, height: 96 },
    },
  })}\n`
  await fs.writeFile(canvasPath, amendedCanvas)

  const fixtureSourceDigest = await treeDigest(notebookRoot)
  evidence.integrity.proofFixtureTreeSha256BeforeBuild = fixtureSourceDigest
  const buildLogs = {}
  const outputsToTest = [
    { name: 'root', base: '/', directory: path.join(temporaryRoot, 'output-root') },
    { name: 'prefix', base: '/preview/branch/', directory: path.join(temporaryRoot, 'output-prefix') },
  ]
  for (const output of outputsToTest) {
    phase = `cli-build-${output.name}`
    evidence.phases.push({ phase, status: 'started' })
    buildLogs[output.name] = runCliBuild(notebookRoot, output.directory, output.base)
    const generatedKinds = await fs.readdir(output.directory)
    assert.ok(generatedKinds.includes('index.html'))
    const canvasPayload = path.join(output.directory, 'notebook-data/canvases/checkout-review.jsonl')
    const siteScreenshot = path.join(output.directory, 'notebook-assets/research/catalog.site/assets/catalog-home.svg')
    const canvasImage = path.join(output.directory, 'notebook-assets/research/checkout-review.canvas/assets/canvas-proof.svg')
    const documentImage = path.join(output.directory, 'notebook-assets/research/assets/publisher-proof.svg')
    const prototypeView = path.join(output.directory, 'prototypes/borrow-flow/confirmation/index.html')
    for (const requiredFile of [canvasPayload, siteScreenshot, canvasImage, documentImage, prototypeView]) {
      assert.ok((await fs.stat(requiredFile)).isFile(), `CLI output is missing ${path.relative(output.directory, requiredFile)}.`)
    }
    const publishedCanvas = (await fs.readFile(canvasPayload, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    assert.ok(publishedCanvas.some(record => record.event === 'canvas_created'))
    assert.ok((await fs.readFile(path.join(output.directory, 'index.html'), 'utf8')).includes(`${output.base}assets/notebook-`))
    output.sha256 = await treeDigest(output.directory)
    output.root = output.directory
    outputHashes.push({ base: output.base, outputTreeSha256: output.sha256 })
    evidence.outputHashes = outputHashes
    evidence.builds.push({ base: output.base, outputTreeSha256: output.sha256, log: buildLogs[output.name] })
    evidence.phases.push({ phase, status: 'passed', base: output.base, outputTreeSha256: output.sha256 })
  }
  assert.equal(await treeDigest(notebookRoot), fixtureSourceDigest, 'The CLI build changed the authored temporary fixture.')

  phase = 'load-browser-driver'
  evidence.phases.push({ phase, status: 'started' })
  const { chromium } = await import(browserModule)
  browser = await chromium.launch({
    headless: true,
    executablePath: chrome,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-extensions', '--no-first-run'],
  })
  evidence.phases.push({ phase, status: 'passed' })
  for (const output of outputsToTest) await proveBase(browser, output, output.base)

  phase = 'source-and-candidate-integrity'
  assert.equal(await treeDigest(notebookRoot), fixtureSourceDigest, 'Static browser review changed notebook source.')
  assert.equal(await treeDigest(sourceNotebook), originalSourceDigest, 'Static proof changed the repository starter source.')
  assert.ok(Object.keys(candidateHashes).length === candidateFiles.length)
  evidence.integrity.proofFixtureTreeSha256AfterBrowser = await treeDigest(notebookRoot)
  evidence.integrity.originalStarterTreeSha256After = await treeDigest(sourceNotebook)
  evidence.phases.push({ phase, status: 'passed' })
  evidence.status = 'passed'
  console.log(JSON.stringify({
    phase: 'static-publisher-browser-proof-complete',
    candidateHashes,
    originalStarterTreeSha256: originalSourceDigest,
    proofFixtureTreeSha256: fixtureSourceDigest,
    proofFixtureTreeSha256After: await treeDigest(notebookRoot),
    outputs: outputs.map(({ base, outputTreeSha256 }) => ({ base, outputTreeSha256 })),
    buildLogs,
    httpFailures,
    requestFailures,
    consoleErrors,
    pageErrors,
  }))
} catch (error) {
  evidence.status = 'failed'
  evidence.failure = {
    phase: 'static-publisher-browser-proof-aborted',
    at: phase,
    candidateHashes,
    outputHashes,
    error: error.stack ?? error.message,
  }
  evidence.phases.push({ phase, status: 'failed', message: error.message })
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(error => evidence.cleanup.errors.push(`Browser cleanup: ${error.message}`))
  try {
    if (temporaryNotebookRoot) evidence.integrity.proofFixtureTreeSha256AtCleanup = await treeDigest(temporaryNotebookRoot)
    if (originalSourceDigest) evidence.integrity.originalStarterTreeSha256AtCleanup = await treeDigest(sourceNotebook)
    if (originalSourceDigest && evidence.integrity.originalStarterTreeSha256AtCleanup !== originalSourceDigest) {
      evidence.status = 'failed'
      evidence.cleanup.errors.push('Repository starter source digest changed during proof.')
      process.exitCode = 1
    }
  } catch (error) {
    evidence.cleanup.errors.push(`Source digest check: ${error.message}`)
    process.exitCode = 1
  }
  if (temporaryRoot) {
    await fs.rm(temporaryRoot, { recursive: true, force: true }).then(() => { evidence.cleanup.temporaryTreeRemoved = true })
      .catch(error => { evidence.cleanup.errors.push(`Temporary tree cleanup: ${error.message}`); process.exitCode = 1 })
  }
  if (evidence.cleanup.errors.length) {
    evidence.status = 'failed'
    process.exitCode = 1
  }
  evidence.finishedAt = new Date().toISOString()
  evidence.httpFailures = httpFailures
  evidence.requestFailures = requestFailures
  evidence.consoleErrors = consoleErrors
  evidence.pageErrors = pageErrors
  try {
    await persistEvidence()
    console.log(JSON.stringify({ phase: 'static-publisher-browser-proof-evidence-saved', path: evidencePath, status: evidence.status, temporaryTreeRemoved: evidence.cleanup.temporaryTreeRemoved }))
  } catch (error) {
    console.error(JSON.stringify({ phase: 'static-publisher-browser-proof-evidence-save-failed', path: evidencePath, error: error.message }))
    process.exitCode = 1
  }
}
