import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import esbuild from 'esbuild'
import { after } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildNotebook, createNotebookRuntime, NOTEBOOK_RUNTIME_REFRESH_EVENT, prototypeRouteBasePath } from '../../src/core/runtime/index.js'
import { createPrototypeRouteBinding } from '../../src/core/runtime/route.js'
import { materializeCanvas } from '../../src/canvas-renderer/index.js'
import { replayCanvas } from '../../src/canvas-format/index.js'

function tempNotebook(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-notebook-runtime-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function write(root, relative, text) {
  const absolute = path.join(root, ...relative.split('/'))
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, text)
  return absolute
}

function addPrototype(root, folder, id, source = "import data from 'virtual:statefully-data-index'; window.prototypeData = data; export const changed = 0") {
  const name = path.posix.basename(folder).replace(/\.prototype$/, '')
  write(root, `${folder}/${name}.prototype.json`, JSON.stringify({
    formatVersion: 1, id, title: id, runtime: { id: '@dfosco/statefully', version: '0.2.1' }, entry: 'src/index.html',
    views: [{ id: 'home', title: 'Home', path: '/' }, { id: 'details', title: 'Details', path: '/details?tab=summary#top' }],
  }))
  write(root, `${folder}/src/index.html`, '<!doctype html><html><body><div id="root"></div><script type="module" src="./main.jsx"></script></body></html>')
  write(root, `${folder}/src/main.jsx`, source)
}

function addCanvas(root, folder, id, title = 'Original') {
  const name = path.posix.basename(folder).replace(/\.canvas$/, '')
  write(root, `${folder}/${name}.canvas.jsonl`, `${JSON.stringify({ event: 'canvas_created', canvasId: id, formatVersion: 1, title })}\n`)
}

async function loadCanvas(runtime, canvasId) {
  const response = await fetch(`${runtime.address}/__notebook/artifacts/${encodeURIComponent(canvasId)}/canvas`)
  return { response, source: await response.text(), revision: response.headers.get('etag') }
}

async function saveGeometry(runtime, canvasId, revision, payload, headers = {}) {
  const requestHeaders = { origin: runtime.address, 'content-type': 'application/json', 'if-match': revision, ...headers }
  if (Object.hasOwn(headers, 'origin') && headers.origin === undefined) delete requestHeaders.origin
  return fetch(`${runtime.address}/__notebook/artifacts/${encodeURIComponent(canvasId)}/geometry`, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(payload),
  })
}

function addSite(root, folder, id) {
  const name = path.posix.basename(folder).replace(/\.site$/, '')
  write(root, `${folder}/${name}.site.json`, JSON.stringify({
    formatVersion: 1,
    id,
    title: 'External catalog',
    published: { url: 'https://catalog.example.test' },
    views: [{ id: 'home', title: 'Catalog home', path: '/books', screenshot: 'assets/home.svg' }],
  }))
  write(root, `${folder}/assets/home.svg`, '<svg/>')
}

test('Node package root stays free of browser-only shell CSS imports', async () => {
  const rootExports = await import('../../index.js')
  assert.equal(typeof rootExports.discoverNotebook, 'function')
  assert.equal('NotebookShell' in rootExports, false)
})

async function waitFor(predicate, message, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  assert.fail(message)
}

test('serves prototypes by stable ID and resolves named views against current discovery', async t => {
  const root = tempNotebook(t)
  addPrototype(root, 'ordinary grouping/Checkout.prototype', 'checkout')
  const runtime = await createNotebookRuntime({ root })
  t.after(() => runtime.close())
  await runtime.start()

  const resolved = runtime.resolveArtifact('checkout', { kind: 'prototype', viewId: 'details' })
  assert.equal(resolved.available, true)
  assert.equal(resolved.url, `${runtime.address}/__notebook/prototypes/checkout/details?tab=summary#top`)
  assert.equal(runtime.resolveArtifact('checkout', { kind: 'prototype', viewId: 'missing' }).available, false)
  assert.equal(runtime.resolveArtifact('checkout', { kind: 'prototype', viewId: '' }).available, false)
  assert.equal(runtime.resolveArtifact('checkout', { kind: 'prototype', viewId: undefined }).url, `${runtime.address}/__notebook/prototypes/checkout/`)
  assert.equal(runtime.resolveArtifact('checkout', { kind: 'prototype', viewId: null }).diagnostics[0].code, 'INVALID_VIEW_ID')
  assert.equal(runtime.resolveArtifact('missing', { kind: 'prototype' }).available, false)

  const page = await fetch(resolved.url)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /main\.jsx/)
  const graph = await fetch(`${runtime.address}/__notebook/graph`).then(response => response.json())
  assert.equal(graph.artifacts[0].id, 'checkout')
  assert.equal(runtime.resolveArtifact('checkout', { kind: 'prototype', mode: 'static', viewId: 'details' }).url, '/prototypes/checkout/details?tab=summary#top')
})

test('local host serves canonical artifact paths directly under the configured base', async t => {
  const root = tempNotebook(t)
  addPrototype(root, 'research/Checkout.prototype', 'checkout', "import { buildArtifactPath } from 'design-notebook/runtime/notebook-routes'; window.routePath = buildArtifactPath({ id: 'x', kind: 'canvas' });")
  addCanvas(root, 'reviews/Review.canvas', 'review')
  addSite(root, 'sites/Catalog.site', 'catalog')
  write(root, 'notes/Overview.doc.mdx', `---\nformatVersion: 1\nid: overview\ntitle: Overview\nreferences: []\n---\n\n# Overview\n`)
  const routeBase = '/preview/my%20branch/'
  const routePrefix = routeBase.slice(0, -1)
  const runtime = await createNotebookRuntime({ root, base: routeBase })
  t.after(() => runtime.close())
  await runtime.start()

  const transformedPrototype = await fetch(`${runtime.address}/research/Checkout.prototype/src/main.jsx`)
  assert.equal(transformedPrototype.status, 200)
  assert.match(await transformedPrototype.text(), /notebook-routes\.js/, 'the dev host resolves the shared browser-safe route subpath')
  const imageChunk = await fetch(`${runtime.address}/@fs${path.resolve('src/vendor/tiny-canvas/upstream/Image-Dv6N7c_d.js')}`)
  assert.equal(imageChunk.status, 200)
  const imageModule = await imageChunk.text()
  const markdownImport = imageModule.match(/from ["']([^"']*react-markdown[^"']*)["']/)?.[1]
  assert.match(markdownImport ?? '', /^\/(?:node_modules\/)?\.vite\/deps\/react-markdown\.js\?v=/, 'package dependencies must be optimized even when notebook root is elsewhere')
  const optimizedMarkdown = await fetch(new URL(markdownImport, runtime.address))
  assert.equal(optimizedMarkdown.status, 200)
  assert.doesNotMatch(await optimizedMarkdown.text(), /from ["']\/@fs\/[^"']*\/style-to-js\/cjs\/index\.js/, 'optimized ReactMarkdown closure must not expose raw CommonJS')

  // The same portable prebundling must cover the vendored chrome closure when
  // the notebook root is outside the package: Base UI and its store shims may
  // not reach the browser as raw CommonJS module files.
  const externalSidebar = await fetch(`${runtime.address}/@fs${path.resolve('src/vendor/hypercanvas/chrome/ui/sidebar.jsx')}`)
  assert.equal(externalSidebar.status, 200)
  const externalSidebarModule = await externalSidebar.text()
  assert.match(externalSidebarModule, /\/\.vite\/deps\/@base-ui_react_merge-props\.js\?v=/, 'external roots must prebundle the Base UI closure')
  const externalUseStore = await fetch(`${runtime.address}/@fs${path.resolve('node_modules/@base-ui/utils/store/useStore.mjs')}`)
  assert.equal(externalUseStore.status, 200)
  const externalUseStoreModule = await externalUseStore.text()
  assert.match(externalUseStoreModule, /\/\.vite\/deps\/use-sync-external-store_shim\.js\?v=/)
  assert.doesNotMatch(externalUseStoreModule, /from ["']\/@fs\/[^"']*use-sync-external-store\/shim\/index\.js/, 'external roots must not expose the raw CJS store shim')

  const directRoutes = [
    `${routePrefix}/checkout`,
    `${routePrefix}/checkout/`,
    `${routePrefix}/checkout/details?tab=summary#top`,
    `${routePrefix}/canvas/review`,
    `${routePrefix}/canvas/review/`,
    `${routePrefix}/docs/overview`,
    `${routePrefix}/docs/overview/`,
    `${routePrefix}/sites/catalog`,
    `${routePrefix}/sites/catalog/`,
    `${routePrefix}/sites/catalog?view=home`,
    `${routePrefix}/sites/catalog/?view=home`,
  ]
  for (const route of directRoutes) {
    const response = await fetch(`${runtime.address}${route}`)
    assert.equal(response.status, 200, `${route} should serve the notebook shell on direct navigation`)
    assert.match(response.headers.get('content-type') ?? '', /text\/html/)
    assert.match(await response.text(), /design-notebook-root/)
  }

  const graph = await fetch(`${runtime.address}/__notebook/graph`).then(response => response.json())
  assert.equal(graph.routeBase, routeBase)
  assert.deepEqual(graph.routeDiagnostics, [])
  const internalPrototype = await fetch(`${runtime.address}/__notebook/prototypes/checkout/details?tab=summary`)
  assert.equal(internalPrototype.status, 200)
  assert.match(await internalPrototype.text(), /main\.jsx/)
  const invalidView = await fetch(`${runtime.address}${routePrefix}/sites/catalog?view=missing`)
  assert.equal(invalidView.status, 200, 'known artifact with an invalid view still reaches shell diagnostics')
  assert.equal((await fetch(`${runtime.address}/`)).status, 404, 'a configured prefix does not also claim notebook routes at origin root')

  const iframe = await fetch(`${runtime.address}/__notebook/prototypes/checkout/details?tab=summary`)
  assert.equal(iframe.status, 200)
  assert.match(await iframe.text(), /main\.jsx/)
  const legacy = await fetch(`${runtime.address}${routeBase}?artifact=review`)
  assert.equal(legacy.status, 200, 'legacy selection URLs remain readable at the notebook root')
  assert.match(await legacy.text(), /design-notebook-root/)
})

test('direct file edits, descriptor changes, artifact add/rename, canvas append, and invalid recovery refresh the same server', async t => {
  const root = tempNotebook(t)
  addPrototype(root, 'prototypes/Checkout.prototype', 'checkout')
  addCanvas(root, 'deep/reviews/Review.canvas', 'review')
  const descriptorPath = path.join(root, 'prototypes/Checkout.prototype/Checkout.prototype.json')
  const sourcePath = path.join(root, 'prototypes/Checkout.prototype/src/main.jsx')
  const canvasPath = path.join(root, 'deep/reviews/Review.canvas/Review.canvas.jsonl')
  const runtime = await createNotebookRuntime({ root })
  t.after(() => runtime.close())
  await runtime.start()
  const refreshes = []
  const unsubscribe = runtime.onRefresh(event => refreshes.push(event))
  t.after(unsubscribe)

  fs.writeFileSync(sourcePath, `import data from 'virtual:statefully-data-index'; window.prototypeData = data; export const changed = 1`)
  await waitFor(() => refreshes.length >= 1, 'prototype source edit did not emit refresh')
  assert.equal(refreshes.at(-1).file, 'prototypes/Checkout.prototype/src/main.jsx')
  const servedSource = await fetch(`${runtime.address}/prototypes/Checkout.prototype/src/main.jsx`).then(response => response.text())
  assert.match(servedSource, /changed\s*=\s*1/, 'the same dev server must serve the updated source')

  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'))
  descriptor.title = 'Checkout updated'
  fs.writeFileSync(descriptorPath, JSON.stringify(descriptor))
  await waitFor(() => runtime.getSnapshot().artifacts.find(item => item.id === 'checkout')?.title === 'Checkout updated', 'descriptor edit did not update discovery')

  addPrototype(root, 'misc/Added.prototype', 'added')
  await waitFor(() => runtime.getSnapshot().artifacts.some(item => item.id === 'added'), 'new artifact was not discovered')

  fs.mkdirSync(path.join(root, 'ordinary group'), { recursive: true })
  fs.renameSync(path.join(root, 'misc/Added.prototype'), path.join(root, 'ordinary group/Renamed.prototype'))
  fs.renameSync(path.join(root, 'ordinary group/Renamed.prototype/Added.prototype.json'), path.join(root, 'ordinary group/Renamed.prototype/Renamed.prototype.json'))
  await waitFor(() => runtime.getSnapshot().artifacts.some(item => item.id === 'added' && item.path === 'ordinary group/Renamed.prototype'), 'artifact rename did not preserve identity or update route map')
  assert.equal(runtime.resolveArtifact('added', { kind: 'prototype' }).url.endsWith('/__notebook/prototypes/added/'), true)
  assert.equal(runtime.resolveArtifact('added', { kind: 'prototype' }).id, 'added', 'stable-ID references must still resolve after a move')

  fs.appendFileSync(canvasPath, `${JSON.stringify({ event: 'canvas_updated', title: 'Updated' })}\n`)
  await waitFor(() => runtime.getSnapshot().artifacts.find(item => item.id === 'review')?.canvasStatus === 'complete' && refreshes.some(item => item.file === 'deep/reviews/Review.canvas/Review.canvas.jsonl'), 'canvas append did not refresh discovery')

  fs.writeFileSync(descriptorPath, '{ broken json')
  await waitFor(() => runtime.getSnapshot().artifacts.find(item => item.path === 'prototypes/Checkout.prototype')?.available === false, 'invalid descriptor was not made unavailable')
  fs.writeFileSync(descriptorPath, JSON.stringify(descriptor))
  await waitFor(() => runtime.getSnapshot().artifacts.find(item => item.id === 'checkout')?.available === true, 'valid descriptor recovery was not observed')

  const settledCount = refreshes.length
  await new Promise(resolve => setTimeout(resolve, 250))
  assert.equal(refreshes.length, settledCount, 'watcher emitted a self-triggered refresh loop')
  assert.ok(refreshes.length >= 6)
})

test('Statefully file changes update the virtual index, without exposing write routes', async t => {
  const root = tempNotebook(t)
  addPrototype(root, 'Prototype.prototype', 'prototype')
  const flowPath = path.join(root, 'Prototype.prototype/state/Default.flow.json')
  write(root, 'Prototype.prototype/state/Default.flow.json', JSON.stringify({ steps: [{ id: 'first' }] }))
  const runtime = await createNotebookRuntime({ root })
  t.after(() => runtime.close())
  await runtime.start()

  async function loadIndex() {
    const source = await fetch(`${runtime.address}/Prototype.prototype/src/main.jsx`).then(response => response.text())
    const virtualImport = source.match(/from ["']([^"']*__x00__virtual:statefully-data-index[^"']*)["']/)?.[1]
    assert.ok(virtualImport, `transformed source did not reference Statefully's virtual index: ${source}`)
    return fetch(new URL(virtualImport, runtime.address)).then(response => response.text())
  }
  const loaded = await loadIndex()
  assert.match(loaded, /"flows"/)
  assert.match(loaded, /prototype\/Default/)
  fs.writeFileSync(flowPath, JSON.stringify({ steps: [{ id: 'second' }] }))
  await waitFor(async () => /second/.test(await loadIndex()), 'Statefully data edit did not replace virtual index')
  const writeRoute = await fetch(`${runtime.address}/__notebook/write`, { method: 'POST', body: '{}' })
  assert.equal(writeRoute.status, 404)
})

test('serves the package shell with read-only canvas, compiled document, graph, and optional CSS loaders', async t => {
  const root = tempNotebook(t)
  addPrototype(root, 'research/Checkout.prototype', 'checkout')
  addCanvas(root, 'research/Review.canvas', 'review')
  addSite(root, 'research/Catalog.site', 'catalog')
  write(root, 'research/Notes.doc.mdx', `---\nformatVersion: 1\nid: notes\ntitle: Review notes\nreferences: [checkout]\n---\n\n# Review notes\n\nA compiled document body.\n`)
  const runtime = await createNotebookRuntime({ root })
  t.after(() => runtime.close())
  await runtime.start()
  const absentCss = await fetch(`${runtime.address}/__notebook/notebook.css`, { method: 'HEAD' })
  assert.equal(absentCss.status, 204)

  const home = await fetch(`${runtime.address}/`)
  assert.equal(home.status, 200)
  const html = await home.text()
  assert.match(html, /design-notebook-root/)
  const shellEntry = html.match(/src="([^"]*shell-entry\.js)"/)?.[1]
  assert.ok(shellEntry, 'root response must load the package-owned shell entry')
  const shellModule = await fetch(new URL(shellEntry, runtime.address))
  assert.equal(shellModule.status, 200)
  assert.match(await shellModule.text(), /client\/shell\/index\.js/)

  const canvas = await fetch(`${runtime.address}/__notebook/artifacts/review/canvas`)
  assert.equal(canvas.status, 200)
  assert.match(await canvas.text(), /"canvasId":"review"/)

  const document = await fetch(`${runtime.address}/__notebook/artifacts/notes/document.js?revision=0`)
  assert.equal(document.status, 200)
  const moduleSource = await document.text()
  assert.match(moduleSource, /Review notes/)
  assert.match(moduleSource, /designNotebookDiagnostics/)
  assert.match(moduleSource, /\/\.vite\/deps\/react_jsx-runtime|react\/jsx-runtime/)

  write(root, 'notebook.css', ':root { --notebook-shell-accent: navy; }')
  const css = await fetch(`${runtime.address}/__notebook/notebook.css`)
  assert.equal(css.status, 200)
  assert.match(await css.text(), /--notebook-shell-accent/)
  fs.unlinkSync(path.join(root, 'notebook.css'))
  const missingCss = await fetch(`${runtime.address}/__notebook/notebook.css`, { method: 'HEAD' })
  assert.equal(missingCss.status, 204)
  fs.mkdirSync(path.join(root, 'notebook.css'))
  const invalidCss = await fetch(`${runtime.address}/__notebook/notebook.css`, { method: 'HEAD' })
  assert.equal(invalidCss.status, 404)
  assert.equal(runtime.getSnapshot().artifacts.length, 4)
})

test('package-root Vite host prebundles the Tiny Canvas and Hypercanvas browser dependency closures', async t => {
  const root = path.resolve('examples/first-look/notebook')
  const runtime = await createNotebookRuntime({ root })
  t.after(() => runtime.close())
  await runtime.start()

  const imageChunkPath = path.resolve('src/vendor/tiny-canvas/upstream/Image-Dv6N7c_d.js')
  const imageResponse = await fetch(`${runtime.address}/@fs${imageChunkPath}`)
  assert.equal(imageResponse.status, 200)
  const imageModule = await imageResponse.text()
  const markdownUrl = imageModule.match(/from ["']([^"']*react-markdown[^"']*)["']/)?.[1]
  assert.match(markdownUrl ?? '', /^\/node_modules\/\.vite\/deps\/react-markdown\.js\?v=/)

  const markdownResponse = await fetch(new URL(markdownUrl, runtime.address))
  assert.equal(markdownResponse.status, 200)
  const markdownModule = await markdownResponse.text()
  assert.match(markdownModule, /node_modules\/style-to-js\/cjs\/index\.js/, 'the optimized module should contain the transitive CJS dependency')
  assert.doesNotMatch(markdownModule, /from ["']\/@fs\/[^"']*\/style-to-js\/cjs\/index\.js/, 'the browser must not receive an unoptimized raw CJS import')

  const chromePath = path.resolve('src/vendor/hypercanvas/NotebookShell/NotebookChrome.jsx')
  const chromeResponse = await fetch(`${runtime.address}/@fs${chromePath}`)
  assert.equal(chromeResponse.status, 200)
  const chromeModule = await chromeResponse.text()
  assert.match(chromeModule, /\/node_modules\/\.vite\/deps\/lucide-react\.js\?v=/)

  const sidebarPath = path.resolve('src/vendor/hypercanvas/chrome/ui/sidebar.jsx')
  const sidebarResponse = await fetch(`${runtime.address}/@fs${sidebarPath}`)
  assert.equal(sidebarResponse.status, 200)
  const sidebarModule = await sidebarResponse.text()
  assert.match(sidebarModule, /\/node_modules\/\.vite\/deps\/@base-ui_react_merge-props\.js\?v=/)
  assert.match(sidebarModule, /\/node_modules\/\.vite\/deps\/@base-ui_react_use-render\.js\?v=/)

  const useStorePath = path.resolve('node_modules/@base-ui/utils/store/useStore.mjs')
  const useStoreResponse = await fetch(`${runtime.address}/@fs${useStorePath}`)
  assert.equal(useStoreResponse.status, 200)
  const useStoreModule = await useStoreResponse.text()
  assert.match(useStoreModule, /\/node_modules\/\.vite\/deps\/use-sync-external-store_shim\.js\?v=/)
  assert.match(useStoreModule, /\/node_modules\/\.vite\/deps\/use-sync-external-store_shim_with-selector\.js\?v=/)
  assert.doesNotMatch(useStoreModule, /from ["']\/@fs\/[^"']*use-sync-external-store\/shim\/index\.js/)
})

test('geometry saves append move and resize events, preserve history, and reload authoritative geometry', async t => {
  const root = tempNotebook(t)
  const canvasPath = write(root, 'deep/review/Review.canvas/Review.canvas.jsonl', [
    JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'review', title: 'Keep this title', extensionMeta: { owner: 'author' }, widgets: [] }),
    JSON.stringify({ event: 'widget_added', widget: { id: 'card', type: 'text', position: { x: 4, y: -2 }, props: { width: 200, height: 100, text: 'Keep this text', extension: { keep: true } } } }),
    JSON.stringify({ event: 'future_optional', optional: true, extension: 'preserve' }),
  ].join('\n'))
  const originalBytes = fs.readFileSync(canvasPath)
  const runtime = await createNotebookRuntime({ root })
  t.after(() => runtime.close())
  await runtime.start()

  const initial = await loadCanvas(runtime, 'review')
  assert.equal(initial.response.status, 200)
  assert.equal(initial.revision, `"sha256-${crypto.createHash('sha256').update(originalBytes).digest('hex')}"`)
  assert.equal(initial.source, originalBytes.toString('utf8'))

  const movedResponse = await saveGeometry(runtime, 'review', initial.revision, {
    widgetId: 'card', operation: 'move', position: { x: -31, y: 44 },
  })
  assert.equal(movedResponse.status, 200)
  const moved = await movedResponse.json()
  assert.deepEqual(moved.event, { event: 'widget_moved', widgetId: 'card', position: { x: -31, y: 44 } })
  assert.deepEqual(moved.geometry, { x: -31, y: 44, width: 200, height: 100 })
  assert.notEqual(moved.revision, initial.revision)

  const resizedResponse = await saveGeometry(runtime, 'review', moved.revision, {
    widgetId: 'card', operation: 'resize', width: 360, height: 240,
  })
  assert.equal(resizedResponse.status, 200)
  const resized = await resizedResponse.json()
  assert.deepEqual(resized.event, { event: 'widget_updated', widgetId: 'card', props: { width: 360, height: 240 } })
  assert.deepEqual(resized.geometry, { x: -31, y: 44, width: 360, height: 240 })

  const reloaded = await loadCanvas(runtime, 'review')
  assert.equal(reloaded.revision, resized.revision)
  const replayed = replayCanvas(reloaded.source)
  assert.equal(replayed.status, 'complete')
  assert.equal(replayed.canvasId, 'review')
  assert.equal(replayed.state.title, 'Keep this title')
  assert.deepEqual(replayed.state.extensionMeta, { owner: 'author' })
  assert.equal(replayed.state.widgets[0].props.text, 'Keep this text')
  assert.deepEqual(replayed.state.widgets[0].props.extension, { keep: true })
  assert.deepEqual(replayed.state.widgets[0].position, { x: -31, y: 44 })
  assert.equal(replayed.state.widgets[0].props.width, 360)
  assert.equal(replayed.state.widgets[0].props.height, 240)
  assert.match(reloaded.source, /"event":"future_optional".*"extension":"preserve"/)
  assert.ok(reloaded.source.startsWith(originalBytes.toString('utf8')), 'all original JSONL bytes remain an unchanged prefix')
  assert.equal(reloaded.source.slice(originalBytes.length, originalBytes.length + 1), '\n', 'a missing final newline is added only as the append delimiter')
  assert.equal(fs.readFileSync(canvasPath).toString('utf8'), reloaded.source)
})

test('stale and concurrent geometry writes conflict without dropping direct edits or duplicating commits', async t => {
  const root = tempNotebook(t)
  const canvasPath = write(root, 'Review.canvas/Review.canvas.jsonl', `${JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'review', widgets: [] })}\n${JSON.stringify({
    event: 'widget_added', widget: { id: 'card', type: 'text', position: { x: 0, y: 0 }, props: { width: 100, height: 80 } },
  })}\n`)
  const runtime = await createNotebookRuntime({ root })
  t.after(() => runtime.close())
  await runtime.start()

  const loaded = await loadCanvas(runtime, 'review')
  fs.appendFileSync(canvasPath, `${JSON.stringify({ event: 'canvas_updated', title: 'External edit' })}\n`)
  const stale = await saveGeometry(runtime, 'review', loaded.revision, {
    widgetId: 'card', operation: 'move', position: { x: 10, y: 20 },
  })
  assert.equal(stale.status, 409)
  const staleBody = await stale.json()
  assert.equal(staleBody.code, 'CANVAS_REVISION_CONFLICT')
  assert.ok(staleBody.revision)
  assert.match(fs.readFileSync(canvasPath, 'utf8'), /External edit/)
  assert.doesNotMatch(fs.readFileSync(canvasPath, 'utf8'), /widget_moved/)

  const current = await loadCanvas(runtime, 'review')
  const payload = { widgetId: 'card', operation: 'move', position: { x: 50, y: 60 } }
  const results = await Promise.all([
    saveGeometry(runtime, 'review', current.revision, payload),
    saveGeometry(runtime, 'review', current.revision, payload),
  ])
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409])
  const finalText = fs.readFileSync(canvasPath, 'utf8')
  assert.equal((finalText.match(/"event":"widget_moved"/g) ?? []).length, 1)
  const responseBodies = await Promise.all(results.map(result => result.json()))
  assert.ok(responseBodies.find(body => body.code === 'CANVAS_REVISION_CONFLICT')?.revision)
})

test('geometry route rejects malformed streams, invalid requests, and cross-origin writes without editing source', async t => {
  const root = tempNotebook(t)
  const validPath = write(root, 'Review.canvas/Review.canvas.jsonl', `${JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'review', widgets: [] })}\n${JSON.stringify({
    event: 'widget_added', widget: { id: 'card', type: 'text', position: { x: 0, y: 0 }, props: { width: 100, height: 80 } },
  })}\n`)
  const invalidPath = write(root, 'Incomplete.canvas/Incomplete.canvas.jsonl', `${JSON.stringify({
    event: 'canvas_created', formatVersion: 1, canvasId: 'incomplete',
    widgets: [{ id: 'card', type: 'text', position: { x: 0, y: 0 }, props: {} }],
  })}\n${JSON.stringify({ event: 'widget_moved', widgetId: 'missing', position: { x: 1, y: 2 } })}\n`)
  const incompleteBefore = fs.readFileSync(invalidPath)
  const runtime = await createNotebookRuntime({ root })
  t.after(() => runtime.close())
  await runtime.start()
  const initial = await loadCanvas(runtime, 'review')
  const before = fs.readFileSync(validPath)

  const noOrigin = await saveGeometry(runtime, 'review', initial.revision, {
    widgetId: 'card', operation: 'move', position: { x: 1, y: 2 },
  }, { origin: undefined })
  assert.equal(noOrigin.status, 403)
  await noOrigin.text()
  const crossOrigin = await saveGeometry(runtime, 'review', initial.revision, {
    widgetId: 'card', operation: 'move', position: { x: 1, y: 2 },
  }, { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' })
  assert.equal(crossOrigin.status, 403)
  await crossOrigin.text()
  const missingRevision = await fetch(`${runtime.address}/__notebook/artifacts/review/geometry`, {
    method: 'POST', headers: { origin: runtime.address, 'content-type': 'application/json' },
    body: JSON.stringify({ widgetId: 'card', operation: 'move', position: { x: 1, y: 2 } }),
  })
  assert.equal(missingRevision.status, 428)
  await missingRevision.text()
  const extraField = await saveGeometry(runtime, 'review', initial.revision, {
    widgetId: 'card', operation: 'move', position: { x: 1, y: 2 }, title: 'unrelated mutation',
  })
  assert.equal(extraField.status, 400)
  await extraField.text()
  const malformedStream = await saveGeometry(runtime, 'incomplete', '"sha256-0000000000000000000000000000000000000000000000000000000000000000"', {
    widgetId: 'card', operation: 'move', position: { x: 1, y: 2 },
  })
  assert.equal(malformedStream.status, 422)
  await malformedStream.text()
  assert.deepEqual(fs.readFileSync(invalidPath), incompleteBefore, 'an incomplete stream is not repaired or appended')

  const missingWidget = await saveGeometry(runtime, 'review', initial.revision, {
    widgetId: 'not-in-canvas', operation: 'move', position: { x: 1, y: 2 },
  })
  assert.equal(missingWidget.status, 422)
  await missingWidget.text()
  const invalidGeometry = await saveGeometry(runtime, 'review', initial.revision, {
    widgetId: 'card', operation: 'resize', width: 0, height: 20,
  })
  assert.equal(invalidGeometry.status, 400)
  await invalidGeometry.text()
  const traversalId = await saveGeometry(runtime, '../review', initial.revision, {
    widgetId: 'card', operation: 'move', position: { x: 1, y: 2 },
  })
  assert.equal(traversalId.status, 404)
  await traversalId.text()
  const wrongMethod = await fetch(`${runtime.address}/__notebook/artifacts/review/geometry`, { method: 'GET' })
  assert.equal(wrongMethod.status, 405)
  await wrongMethod.text()
  assert.deepEqual(fs.readFileSync(validPath), before, 'rejected requests must leave valid canvas bytes unchanged')
})

test('real runtime resolver URLs normalize into absolute renderer URLs for local and static hosts', async t => {
  const root = tempNotebook(t)
  addPrototype(root, 'group/Checkout.prototype', 'checkout')
  addSite(root, 'research/catalog/External.site', 'catalog')
  write(root, 'assets/hero.png', 'image bytes')
  const runtime = await createNotebookRuntime({ root, base: '/preview/' })
  t.after(() => runtime.close())
  await runtime.start()
  const canvas = JSON.stringify({
    event: 'canvas_created', formatVersion: 1, canvasId: 'resolver-contract',
    widgets: [
      { id: 'prototype', type: 'prototype', position: { x: 0, y: 0 }, props: { artifactId: 'checkout', viewId: 'details' } },
      { id: 'prototype-default', type: 'prototype', position: { x: 0, y: 300 }, props: { artifactId: 'checkout' } },
      { id: 'site-default', type: 'site', position: { x: 400, y: 300 }, props: { artifactId: 'catalog' } },
      { id: 'image', type: 'image', position: { x: 400, y: 0 }, props: { src: 'hero.png' } },
    ],
  })

  for (const mode of ['local', 'static']) {
    const documentBase = mode === 'local' ? `${runtime.address}/` : 'https://published.example/preview/prototypes/checkout/'
    const result = materializeCanvas(canvas, {
      mode,
      resolveArtifact(reference, options) {
        const resolved = runtime.resolveArtifact(reference, { ...options, mode })
        return resolved.url ? { ...resolved, url: new URL(resolved.url, documentBase).href } : resolved
      },
      resolveAsset(reference, options) {
        if (options.purpose === 'site-screenshot') assert.equal(options.basePath, 'research/catalog/External.site')
        const basePath = options.basePath ?? 'assets'
        const resolved = runtime.resolveAsset(reference, { ...options, basePath, mode })
        return resolved.available ? new URL(resolved.url, documentBase).href : null
      },
    })
    assert.equal(result.scene.items.find(item => item.id === 'prototype').src,
      mode === 'local'
        ? `${runtime.address}/__notebook/prototypes/checkout/details?tab=summary#top`
        : 'https://published.example/preview/prototypes/checkout/details?tab=summary#top')
    assert.equal(result.scene.items.find(item => item.id === 'image').src,
      mode === 'local' ? `${runtime.address}/assets/hero.png` : 'https://published.example/preview/assets/hero.png')
    assert.equal(result.scene.items.find(item => item.id === 'prototype-default').src,
      mode === 'local'
        ? `${runtime.address}/__notebook/prototypes/checkout/`
        : 'https://published.example/preview/prototypes/checkout/')
    assert.equal(result.scene.items.find(item => item.id === 'site-default').src,
      mode === 'local' ? `${runtime.address}/research/catalog/External.site/assets/home.svg` : 'https://published.example/preview/research/catalog/External.site/assets/home.svg')
  }

  const site = runtime.resolveArtifact('catalog', { kind: 'site', viewId: undefined })
  assert.equal(site.folderPath, 'research/catalog/External.site')
  assert.equal(site.view.id, 'home')
  assert.equal(runtime.resolveArtifact('catalog', { kind: 'site', viewId: null }).diagnostics[0].code, 'INVALID_VIEW_ID')
  assert.deepEqual(runtime.resolveAsset(site.view.screenshot, { basePath: site.folderPath, mode: 'static' }), {
    available: true,
    url: '/preview/research/catalog/External.site/assets/home.svg',
  })
})

test('static output uses the descriptor runtime and hosting-prefix route for bundled code and state', async t => {
  const root = tempNotebook(t)
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'design-notebook-static-output-'))
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }))
  addPrototype(root, 'nested/Checkout.prototype', 'checkout', `import data from 'virtual:statefully-data-index'; import { prototypeRouteBasePath } from 'design-notebook/runtime/route'; window.prototypeData = data; window.prototypeRoute = prototypeRouteBasePath('checkout', { mode: 'static', base: import.meta.env.BASE_URL, baseIsPrototypePrefix: true }); window.buildMarker = 'build-ok'`)
  write(root, 'nested/Checkout.prototype/state/Default.flow.json', JSON.stringify({ steps: [{ id: 'first' }] }))
  const result = await buildNotebook({ root, outDir: outputRoot, base: '/preview/branch/' })
  assert.equal(result.prototypes.length, 1)
  assert.deepEqual(result.prototypes[0].diagnostics, undefined)
  const htmlFiles = []
  function visit(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const absolute = path.join(folder, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.name.endsWith('.html')) htmlFiles.push(absolute)
    }
  }
  visit(outputRoot)
  assert.equal(htmlFiles.length, 2, 'root and named view routes should have HTML documents')
  const html = fs.readFileSync(path.join(outputRoot, 'prototypes/checkout/index.html'), 'utf8')
  assert.match(html, /\/preview\/branch\/prototypes\/checkout\//)
  const jsFile = html.match(/src="([^"]+\.js)"/)?.[1]
  assert.ok(jsFile, 'built HTML must point to a JavaScript bundle')
  const relativeBundle = new URL(jsFile, 'http://notebook.invalid').pathname.replace('/preview/branch/', '')
  const bundlePath = path.join(outputRoot, relativeBundle)
  const bundle = fs.readFileSync(bundlePath, 'utf8')
  assert.match(bundle, /build-ok/)
  assert.match(bundle, /"checkout\/Default"/)
  assert.match(bundle, /\/preview\/branch\/prototypes\/checkout/)
  assert.match(result.prototypes[0].url, /^\/preview\/branch\/prototypes\/checkout\/$/)

  const repeat = await buildNotebook({ root, outDir: outputRoot, base: '/preview/branch/' })
  assert.equal(repeat.prototypes[0].diagnostics, undefined, 'repeat builds should clean only manifest-owned output')
  assert.ok(fs.existsSync(path.join(outputRoot, 'prototypes/checkout/details/index.html')))
  const generatedIndex = path.join(outputRoot, 'prototypes/checkout/index.html')
  fs.appendFileSync(generatedIndex, '\n<!-- authored sentinel -->')
  const modifiedOutput = await buildNotebook({ root, outDir: outputRoot, base: '/preview/branch/' })
  assert.equal(modifiedOutput.prototypes[0].diagnostics[0].code, 'BUILD_OUTPUT_COLLISION')
  assert.match(fs.readFileSync(generatedIndex, 'utf8'), /authored sentinel/)
})

test('build refuses unsafe output roots and preserves authored output collisions', async t => {
  const root = tempNotebook(t)
  addPrototype(root, 'research/Checkout.prototype', 'checkout')
  write(root, 'research/notes/sentinel.txt', 'authored and must survive')
  await assert.rejects(buildNotebook({ root, outDir: 'research' }), /Build output inside the notebook/)
  assert.equal(fs.readFileSync(path.join(root, 'research/notes/sentinel.txt'), 'utf8'), 'authored and must survive')

  const collisionPath = path.join(root, 'dist/prototypes/checkout')
  write(root, 'dist/prototypes/checkout/authored.txt', 'also authored')
  const result = await buildNotebook({ root, outDir: 'dist' })
  assert.equal(result.prototypes[0].diagnostics[0].code, 'BUILD_OUTPUT_COLLISION')
  assert.equal(fs.readFileSync(path.join(collisionPath, 'authored.txt'), 'utf8'), 'also authored')
})

test('runtime refresh event and runtime declaration remain explicit', () => {
  assert.equal(NOTEBOOK_RUNTIME_REFRESH_EVENT, 'design-notebook:refresh')
})

test('prototype route binding is scoped to the stable ID and tracks browser navigation', () => {
  const listeners = new Map()
  const location = {
    origin: 'http://127.0.0.1:4173',
    pathname: '/__notebook/prototypes/borrow-flow/',
    search: '',
    hash: '',
    get href() { return `${this.origin}${this.pathname}${this.search}${this.hash}` },
  }
  const window = {
    location,
    history: { pushState(_state, _title, target) {
      const url = new URL(target, location.href)
      location.pathname = url.pathname
      location.search = url.search
      location.hash = url.hash
    } },
    addEventListener(name, listener) { listeners.set(name, listener) },
    removeEventListener(name) { listeners.delete(name) },
  }
  const basePath = prototypeRouteBasePath('borrow-flow')
  assert.equal(basePath, '/__notebook/prototypes/borrow-flow')
  assert.equal(prototypeRouteBasePath('borrow-flow', { mode: 'static', base: '/preview/branch/' }), '/preview/branch/prototypes/borrow-flow')
  assert.equal(prototypeRouteBasePath('borrow-flow', { mode: 'static', base: '/preview/branch/prototypes/borrow-flow/', baseIsPrototypePrefix: true }), '/preview/branch/prototypes/borrow-flow')
  const route = createPrototypeRouteBinding({ basePath, window })
  let notifications = 0
  const unsubscribe = route.subscribe(() => notifications += 1)
  route.navigate(`${basePath}/request`)
  assert.equal(route.getSnapshot().pathname, `${basePath}/request`)
  assert.equal(notifications, 1)
  assert.throws(() => route.navigate('https://example.com/'), /current origin/)
  assert.throws(() => route.navigate('/other-prototype/'), /remain below/)
  unsubscribe()
  route.dispose()
  assert.equal(listeners.size, 0)
})

// Vite's esbuild transforms spawn a shared esbuild service process whose stdio
// handles keep this test file's runner process alive after every server has
// been closed. Vite never stops the service itself, so stop it once all
// runtime tests are done (this hook also runs for focused name-pattern runs).
after(async () => {
  await esbuild.stop()
})
