import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { discoverNotebook } from '../../src/core/artifacts/discovery.js'
import { replayCanvas } from '../../src/canvas-format/index.js'
import { normalizeBase, publishNotebook, staticRouteTargets } from '../../src/core/publisher/index.js'
import { createStaticNotebookResolvers } from '../../src/core/publisher/browser.js'
import { buildNotebook } from '../../src/core/runtime/index.js'
import { buildArtifactPath, diagnoseArtifactRoutes, parseArtifactPath } from '../../src/core/runtime/notebook-routes.js'

function write(root, relative, source) {
  const target = path.join(root, ...relative.split('/'))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, source)
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-notebook-publish-fixture-'))
  write(root, 'research/Review.canvas/Review.canvas.jsonl', [
    JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'review', widgets: [
      { id: 'note', type: 'text', position: { x: 20, y: 30 }, props: { text: 'Review notes' } },
      { id: 'image', type: 'image', position: { x: 400, y: 30 }, props: { src: 'assets/sketch.svg', alt: 'Sketch' } },
      { id: 'private-image', type: 'image', position: { x: 800, y: 30 }, props: { src: '/Users/private/sketch.svg', alt: 'Private sketch' } },
    ] }),
  ].join('\n') + '\n')
  write(root, 'research/Review.canvas/assets/sketch.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')
  write(root, 'research/Library.site/Library.site.json', JSON.stringify({
    formatVersion: 1, id: 'library', title: 'Library',
    local: { sourcePath: '/Users/private/library', developmentUrl: 'http://localhost:4173' },
    published: { url: 'https://catalog.example' },
    views: [{ id: 'home', title: 'Home', path: '/books?sort=latest#top', localUrl: 'http://127.0.0.1:4173/books', publishedUrl: 'https://catalog.example/books?sort=latest#top', screenshot: 'assets/home.svg', privateField: 'do-not-copy' }],
    secretField: 'do-not-copy',
  }))
  write(root, 'research/Library.site/assets/home.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')
  write(root, 'research/Notes.doc.mdx', [
    '---',
    'formatVersion: 1',
    'id: notes',
    'title: Notes',
    '---',
    '',
    'A static notebook document.',
    '',
    '![Inline diagram](assets/diagram.svg)',
    '',
    'This authored prose intentionally mentions http://localhost:4173 and /Users/private/prose-example.',
    '',
    '```text',
    '/Users/private/code-example is authored code content, not a runtime resource.',
    '```',
    '',
    'import { Image, Site } from \'design-notebook/docs\'',
    '',
    '<Image src="assets/diagram.svg" alt="Diagram" />',
    '',
    '<Image src="/Users/private/diagram.svg" alt="Private path" />',
    '',
    '<Image src={window.privateAssetPath} alt="Dynamic local reference" />',
    '',
    '![Private diagram](/Users/private/markdown-diagram.svg)',
    '',
    '[Local preview](http://localhost:4173/private)',
    '',
    '<Site artifactId="library" viewId="home" />',
  ].join('\n'))
  write(root, 'research/assets/diagram.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"></svg>')
  write(root, 'research/unreferenced-secret.txt', 'must not be copied')
  write(root, 'node_modules/private-package/index.js', 'must not be copied')
  return root
}

function fixtureWithPrototype() {
  const root = fixture()
  const sourcePrototype = path.resolve('examples/first-look/notebook/research/borrow-flow.prototype')
  fs.cpSync(sourcePrototype, path.join(root, 'research/borrow-flow.prototype'), { recursive: true })
  return root
}

test('static base paths require safe root-relative URL segments', () => {
  assert.equal(normalizeBase('/'), '/')
  assert.equal(normalizeBase('/preview/branch/'), '/preview/branch/')
  assert.equal(normalizeBase('/preview/my%20branch/'), '/preview/my%20branch/')
  assert.equal(normalizeBase(normalizeBase('/preview/my branch')), '/preview/my%20branch/')
  assert.equal(normalizeBase('/design review'), '/design%20review/')
  for (const base of ['https://example.test/', '//example.test/', '/x/../y/', '/%2e%2e/y/', '/a%2fb/', '/x?mode=1', '/x#view', '/x\\y', '/%zz/']) {
    assert.throws(() => normalizeBase(base), TypeError, base)
  }
})

test('shared public routes use stable artifact IDs and authored prototype paths', () => {
  const artifacts = [
    { id: 'checkout flow', kind: 'prototype', views: [
      { id: 'default', path: '/' },
      { id: 'confirm', path: '/confirmation?receipt=1#summary' },
    ] },
    { id: 'review', kind: 'canvas', views: [] },
    { id: 'notes', kind: 'doc', views: [] },
    { id: 'catalog', kind: 'site', views: [{ id: 'home', path: '/', title: 'Home' }] },
  ]
  assert.equal(buildArtifactPath(artifacts[0], { base: '/preview/branch/', viewId: 'confirm' }), '/preview/branch/checkout%20flow/confirmation?receipt=1#summary')
  assert.equal(buildArtifactPath(artifacts[1], { base: '/preview/branch/' }), '/preview/branch/canvas/review')
  assert.equal(buildArtifactPath(artifacts[2], { base: '/preview/branch/' }), '/preview/branch/docs/notes')
  assert.equal(buildArtifactPath(artifacts[3], { base: '/preview/branch/', viewId: 'home' }), '/preview/branch/sites/catalog?view=home')
  assert.equal(parseArtifactPath('/preview/branch/checkout%20flow/confirmation?receipt=1#summary', { artifacts, base: '/preview/branch/' }).artifact.id, 'checkout flow')
  assert.equal(parseArtifactPath('/preview/branch/canvas/review/', { artifacts, base: '/preview/branch/' }).artifact.id, 'review')
  assert.equal(parseArtifactPath('/preview/branch/sites/catalog?view=missing', { artifacts, base: '/preview/branch/' }).status, 'invalid')
  assert.deepEqual(diagnoseArtifactRoutes(artifacts, { base: '/preview/branch/' }), [])
  const conflicting = diagnoseArtifactRoutes([
    { id: 'duplicate', kind: 'canvas', views: [] },
    { id: 'duplicate', kind: 'canvas', views: [] },
  ])
  assert.ok(conflicting.some(item => item.code === 'ARTIFACT_ROUTE_COLLISION' && item.path === '/canvas/duplicate'))
})

test('static route target collection diagnoses route builder failures without aborting', () => {
  const artifact = {
    id: 'checkout',
    kind: 'prototype',
    views: [
      { id: 'confirmation', path: '/confirmation' },
      { id: 'confirmation', path: '/confirmation-again' },
    ],
  }

  const result = staticRouteTargets({ artifacts: [artifact] }, '/', [])

  assert.ok(result.pages.has('checkout/index.html'), 'The valid artifact root route should remain available.')
  assert.ok(result.diagnostics.some(item => item.code === 'INVALID_ARTIFACT_ROUTE' && item.artifactId === 'checkout'))
})

test('publishNotebook bundles a mixed nested notebook at root and under a hosting prefix', async t => {
  const root = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const graph = discoverNotebook(root)

  for (const base of ['/', '/preview/branch/']) {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), `design-notebook-publish-${base === '/' ? 'root' : 'prefix'}-`))
    t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }))
    const result = await publishNotebook({ root, outputRoot, base, graph, prototypeResults: [] })
    assert.equal(result.success, true, JSON.stringify(result.diagnostics))
    assert.ok(fs.existsSync(path.join(outputRoot, 'index.html')))
    assert.ok(fs.existsSync(path.join(outputRoot, 'notebook-data/canvases/review.jsonl')))
    assert.ok(fs.existsSync(path.join(outputRoot, 'canvas/review/index.html')))
    assert.ok(fs.existsSync(path.join(outputRoot, 'docs/notes/index.html')))
    assert.ok(fs.existsSync(path.join(outputRoot, 'sites/library/index.html')))
    assert.ok(fs.existsSync(path.join(outputRoot, 'notebook-assets/research/Review.canvas/assets/sketch.svg')))
    assert.ok(fs.existsSync(path.join(outputRoot, 'notebook-assets/research/Library.site/assets/home.svg')))
    assert.ok(fs.existsSync(path.join(outputRoot, 'notebook-assets/research/assets/diagram.svg')))
    assert.equal(fs.existsSync(path.join(outputRoot, 'research/unreferenced-secret.txt')), false)
    assert.equal(fs.existsSync(path.join(outputRoot, 'node_modules')), false)
    assert.equal(fs.existsSync(path.join(outputRoot, 'research/Library.site/Library.site.json')), false)

    const assetsRoot = path.join(outputRoot, 'assets')
    const bundleFiles = fs.readdirSync(assetsRoot).filter(name => name.endsWith('.js'))
    assert.ok(bundleFiles.length > 0)
    const bundle = bundleFiles.map(name => fs.readFileSync(path.join(assetsRoot, name), 'utf8')).join('\n')
    const entryHtml = fs.readFileSync(path.join(outputRoot, 'index.html'), 'utf8')
    const entrySource = entryHtml.match(/<script\b[^>]*\bsrc="([^"]+\.js)"/)?.[1]
    assert.ok(entrySource, 'The published HTML must reference the notebook entry bundle.')
    const entryPath = new URL(entrySource, 'https://notebook.invalid').pathname
    assert.ok(entryPath.startsWith(`${base}assets/notebook-`), `Unexpected notebook entry path: ${entryPath}`)
    const entryFile = path.join(outputRoot, ...entryPath.slice(base.length).split('/').map(decodeURIComponent))
    assert.ok(fs.existsSync(entryFile), `The published HTML entry bundle does not exist: ${entryPath}`)
    const entryBundle = fs.readFileSync(entryFile, 'utf8')
    assert.ok(entryBundle.includes('https://catalog.example/books?sort=latest#top'))
    assert.ok(bundle.includes(base))
    assert.ok(bundle.includes('https://catalog.example/books?sort=latest#top'))
    assert.ok(bundle.includes('notebook-assets/research/assets/diagram.svg'))
    assert.ok(bundle.includes('assets/diagram.svg'))
    assert.ok(!bundle.includes('/Users/private/library'))
    assert.ok(!bundle.includes('/Users/private/diagram.svg'))
    assert.ok(!bundle.includes('/Users/private/markdown-diagram.svg'))
    assert.ok(!bundle.includes('localhost:4173/private'))
    assert.ok(!bundle.includes('do-not-copy'))
    assert.ok(!bundle.includes('must not be copied'))
    assert.ok(bundle.includes('localhost:4173'))
    assert.ok(bundle.includes('/Users/private/prose-example'))
    assert.ok(bundle.includes('/Users/private/code-example'))
    assert.ok(!bundle.includes('privateAssetPath'))
    assert.equal(Object.hasOwn(result.graph, 'root'), false)
    const site = result.graph.artifacts.find(item => item.id === 'library')
    assert.equal(Object.hasOwn(site.descriptor, 'local'), false)
    assert.equal(Object.hasOwn(site.descriptor, 'secretField'), false)
    assert.equal(Object.hasOwn(site.descriptor.views[0], 'localUrl'), false)
    assert.equal(Object.hasOwn(site.descriptor.views[0], 'privateField'), false)
    const doc = result.graph.artifacts.find(item => item.id === 'notes')
    assert.equal(doc.folderPath, 'research')
    assert.ok(result.diagnostics.some(item => item.code === 'DYNAMIC_DOCUMENT_RESOURCE_UNSUPPORTED' && item.artifactId === 'notes'))
    const docAssetResolver = createStaticNotebookResolvers({
      graph: result.graph,
      base,
      assetPaths: { 'research\u0000assets/diagram.svg': 'notebook-assets/research/assets/diagram.svg' },
    })
    assert.deepEqual(docAssetResolver.resolveAsset('assets/diagram.svg', { basePath: doc.folderPath }), {
      available: true,
      url: `${base}notebook-assets/research/assets/diagram.svg`,
    })
    const canvasSource = fs.readFileSync(path.join(outputRoot, 'notebook-data/canvases/review.jsonl'), 'utf8')
    assert.ok(!canvasSource.includes('/Users/private/sketch.svg'))
    assert.ok(canvasSource.includes('private-image'))
    assert.equal(result.graph.entries[0].type, 'group')
    assert.equal(result.graph.entries[0].name, 'research')
    const ids = []
    const visit = entry => entry.type === 'group' ? entry.children.forEach(visit) : ids.push(entry.artifact?.id)
    result.graph.entries.forEach(visit)
    assert.deepEqual(ids, ['library', 'notes', 'review'])

    const server = http.createServer((request, response) => {
      const pathname = new URL(request.url, 'http://static.invalid').pathname
      if (base !== '/' && pathname === base.slice(0, -1)) {
        response.writeHead(301, { location: base }).end()
        return
      }
      if (!pathname.startsWith(base)) {
        response.writeHead(404).end()
        return
      }
      const relative = decodeURIComponent(pathname.slice(base.length)) || 'index.html'
      let file = path.resolve(outputRoot, ...relative.split('/'))
      if (file.startsWith(`${outputRoot}${path.sep}`) && fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        if (!pathname.endsWith('/')) {
          // Redirect from the parsed pathname, not the raw request URL:
          // appending to request.url adds the slash after the query string,
          // which never changes the pathname and redirects forever.
          const parsedUrl = new URL(request.url, 'http://static.invalid')
          response.writeHead(301, { location: `${parsedUrl.pathname}/${parsedUrl.search}` }).end()
          return
        }
        file = path.join(file, 'index.html')
      }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200)
      fs.createReadStream(file).pipe(response)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise(resolve => server.close(resolve)))
    const origin = `http://127.0.0.1:${server.address().port}`
    const direct = await fetch(`${origin}${base}docs/notes`)
    assert.equal(direct.status, 200)
    assert.ok(direct.url.endsWith(`${base}docs/notes/`), 'Static directory-index redirect should preserve the canonical artifact selection path.')
    const html = await direct.text()
    const script = html.match(/src="([^"]+\.js)"/)?.[1]
    assert.ok(script)
    assert.equal((await fetch(new URL(script, `${origin}/`))).status, 200)
    assert.equal((await fetch(`${origin}${base}canvas/review`)).status, 200)
    assert.equal((await fetch(`${origin}${base}canvas/review/`)).status, 200)
    assert.equal((await fetch(`${origin}${base}sites/library?view=home`)).status, 200)
    assert.equal((await fetch(`${origin}${base}notebook-data/canvases/review.jsonl`)).status, 200)
    assert.equal((await fetch(`${origin}${base}notebook-assets/research/Library.site/assets/home.svg`)).status, 200)
    assert.equal((await fetch(`${origin}${base}notebook-assets/research/assets/diagram.svg`)).status, 200)
  }
})

test('static resolver preserves prototype query and fragment while requiring exact view IDs', () => {
  const graph = { artifacts: [{
    id: 'checkout', kind: 'prototype', title: 'Checkout', available: true,
    views: [{ id: 'confirm', title: 'Confirm', path: '/confirmation?receipt=1#summary' }],
  }] }
  const resolver = createStaticNotebookResolvers({ graph, base: '/preview/branch/' })
  const exact = resolver.resolveArtifact('checkout', { kind: 'prototype', viewId: 'confirm' })
  assert.equal(exact.url, '/preview/branch/prototypes/checkout/confirmation?receipt=1#summary')
  const missing = resolver.resolveArtifact('checkout', { kind: 'prototype', viewId: 'missing' })
  assert.equal(missing.available, false)
  assert.equal(resolver.resolveArtifact('checkout', { kind: 'prototype', viewId: undefined }).url, '/preview/branch/prototypes/checkout/confirmation?receipt=1#summary')
})

test('static resolver serves only copied assets and rejects local URL references', () => {
  const graph = { artifacts: [] }
  const resolver = createStaticNotebookResolvers({
    graph,
    base: '/preview/',
    assetPaths: { 'research/doc\u0000assets/image.svg': 'notebook-assets/research/doc/assets/image.svg' },
  })
  assert.deepEqual(resolver.resolveAsset('assets/image.svg', { basePath: 'research/doc' }), {
    available: true,
    url: '/preview/notebook-assets/research/doc/assets/image.svg',
  })
  assert.equal(resolver.resolveAsset('assets/missing.svg', { basePath: 'research/doc' }).available, false)
  assert.equal(resolver.resolveAsset('http://127.0.0.1:4173/image.svg').available, false)
})

test('buildNotebook output and publisher assemble a four-artifact static notebook under a prefix', async t => {
  const root = fixtureWithPrototype()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const outputRoot = path.join(root, 'dist')
  const base = '/preview/branch/'
  const graph = discoverNotebook(root)

  // The CLI owns this one prototype build stage. publishNotebook receives its
  // graph and results and must reuse the resulting static files.
  const prototypeStage = await buildNotebook({ root, outDir: 'dist', base })
  assert.equal(prototypeStage.prototypes.length, 1)
  assert.deepEqual(prototypeStage.prototypes[0].diagnostics ?? [], [])
  const result = await publishNotebook({
    root,
    outputRoot,
    base,
    graph: prototypeStage.graph,
    prototypeResults: prototypeStage.prototypes,
  })

  assert.equal(result.success, true, JSON.stringify(result.diagnostics))
  assert.deepEqual(new Set(result.graph.artifacts.map(item => item.kind)), new Set(['canvas', 'site', 'doc', 'prototype']))
  const prototypeRoute = path.join(outputRoot, 'prototypes/borrow-flow/confirmation/index.html')
  assert.ok(fs.existsSync(prototypeRoute))
  assert.ok(fs.existsSync(path.join(outputRoot, 'borrow-flow/index.html')))
  assert.ok(fs.existsSync(path.join(outputRoot, 'borrow-flow/request/index.html')))
  assert.ok(fs.existsSync(path.join(outputRoot, 'borrow-flow/confirmation/index.html')))
  assert.ok(fs.existsSync(path.join(outputRoot, 'assets')))
  assert.ok(fs.existsSync(path.join(outputRoot, 'notebook-data/canvases/review.jsonl')))
  assert.ok(fs.existsSync(path.join(outputRoot, 'notebook-assets/research/Library.site/assets/home.svg')))

  // Serve only the generated output, with the configured hosting prefix.
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://static.invalid').pathname
    if (!pathname.startsWith(base)) {
      response.writeHead(404).end()
      return
    }
    const relative = pathname.slice(base.length) || 'index.html'
    let file = path.resolve(outputRoot, ...relative.split('/'))
    if (file.startsWith(`${outputRoot}${path.sep}`) && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    if (!file.startsWith(`${outputRoot}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200)
    fs.createReadStream(file).pipe(response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  assert.equal((await fetch(`${origin}${base}docs/notes`)).status, 200)
  assert.equal((await fetch(`${origin}${base}borrow-flow/confirmation`)).status, 200)
  assert.equal((await fetch(`${origin}${base}canvas/review`)).status, 200)
  assert.equal((await fetch(`${origin}${base}sites/library?view=home`)).status, 200)
  assert.equal((await fetch(`${origin}${base}notebook-data/canvases/review.jsonl`)).status, 200)
  assert.equal((await fetch(`${origin}${base}notebook-assets/research/Library.site/assets/home.svg`)).status, 200)
  assert.equal((await fetch(`${origin}${base}notebook-assets/research/assets/diagram.svg`)).status, 200)
  assert.equal((await fetch(`${origin}${base}prototypes/borrow-flow/confirmation/`)).status, 200)
})

test('publisher reports missing referenced files and leaves visible content paths degraded', async t => {
  const root = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  write(root, 'research/Review.canvas/Review.canvas.jsonl', JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'review', widgets: [
    { id: 'missing', type: 'image', props: { src: 'assets/absent.svg', alt: 'Unavailable diagram' } },
  ] }) + '\n')
  const graph = discoverNotebook(root)
  const result = await publishNotebook({ root, outputRoot: path.join(root, 'dist'), graph, prototypeResults: [] })
  assert.equal(result.success, true)
  assert.ok(result.diagnostics.some(item => item.code === 'MISSING_PUBLISH_INPUT' && item.artifactId === 'review' && item.input === 'research/Review.canvas/assets/absent.svg'))
  const canvas = result.graph.artifacts.find(item => item.id === 'review')
  assert.equal(canvas.available, true)
  assert.ok(fs.existsSync(path.join(root, 'dist/index.html')))
})

test('publisher emits only a final-state canvas rendering snapshot without historical or private metadata', async t => {
  const root = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const authored = [
    JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'review', title: 'Review', width: 1000, height: 700, localSessionPath: '/Users/private/session.json', widgets: [
      { id: 'visible-note', type: 'text', position: { x: 10, y: 20 }, props: { text: 'Current note', width: 300, height: 120, privateToken: 'active-private-token' } },
      { id: 'chart-fallback', type: 'chart', props: { fallback: { type: 'text', text: 'Chart is unavailable.', privateExtension: 'fallback-private-value' } } },
      { id: 'removed-note', type: 'text', props: { text: 'Removed private content' } },
      { id: 'local-image', type: 'image', props: { src: '/Users/private/local.svg', alt: 'Local' } },
    ], privateHeaderField: 'private-header-value' }),
    JSON.stringify({ event: 'widget_removed', widgetId: 'removed-note', widget: { id: 'removed-note', type: 'text', props: { text: 'Removed private content', localPath: '/Users/private/removed.svg' } }, privateRemovalReason: 'private-removal-reason' }),
    JSON.stringify({ event: 'optional_extension', required: false, secret: 'optional-private-secret' }),
  ].join('\n') + '\n'
  write(root, 'research/Review.canvas/Review.canvas.jsonl', authored)
  const outputRoot = path.join(root, 'dist')
  const result = await publishNotebook({ root, outputRoot, graph: discoverNotebook(root), prototypeResults: [] })
  assert.equal(result.success, true, JSON.stringify(result.diagnostics))
  assert.equal(fs.readFileSync(path.join(root, 'research/Review.canvas/Review.canvas.jsonl'), 'utf8'), authored)
  const published = fs.readFileSync(path.join(outputRoot, 'notebook-data/canvases/review.jsonl'), 'utf8')
  assert.ok(published.includes('Current note'))
  assert.ok(published.includes('visible-note'))
  for (const privateValue of ['/Users/private/session.json', '/Users/private/local.svg', 'private-header-value', 'active-private-token', 'fallback-private-value', 'Removed private content', 'optional-private-secret', 'private-removal-reason', 'privateHeaderField']) {
    assert.ok(!published.includes(privateValue), `published snapshot contains ${privateValue}`)
  }
  const records = published.trimEnd().split('\n').map(line => JSON.parse(line))
  assert.equal(records.length, 1)
  assert.equal(records[0].event, 'canvas_created')
  assert.equal(replayCanvas(published).status, 'complete')
  assert.deepEqual(records[0].widgets.map(widget => widget.id), ['visible-note', 'chart-fallback', 'local-image'])
  assert.deepEqual(records[0].widgets[1].props.fallback, { type: 'text', text: 'Chart is unavailable.' })
  assert.ok(result.diagnostics.some(item => item.code === 'CANVAS_PRIVATE_METADATA_EXCLUDED'))
  assert.ok(result.diagnostics.some(item => item.code === 'LOCAL_OR_INVALID_ASSET_URL_EXCLUDED' && item.artifactId === 'review'))
})

test('incomplete required canvas replay is unavailable and its source details are not published', async t => {
  const root = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = [
    JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'review', widgets: [{ id: 'valid-prefix', type: 'text', props: { text: 'Valid prefix' } }] }),
    JSON.stringify({ event: 'future_private_event', required: true, token: 'private-token-value' }),
  ].join('\n') + '\n'
  write(root, 'research/Review.canvas/Review.canvas.jsonl', source)
  const result = await publishNotebook({ root, outputRoot: path.join(root, 'dist'), graph: discoverNotebook(root), prototypeResults: [] })
  assert.equal(result.success, false)
  assert.equal(result.graph.artifacts.find(item => item.id === 'review').available, false)
  assert.equal(fs.existsSync(path.join(root, 'dist/notebook-data/canvases/review.jsonl')), false)
  const reviewDiagnostics = result.diagnostics.filter(item => item.artifactId === 'review' || item.path?.includes('Review.canvas'))
  assert.ok(reviewDiagnostics.some(item => item.severity === 'error'))
  assert.ok(reviewDiagnostics.every(item => !JSON.stringify(item).includes('private-token-value')))
})

test('publisher refuses to overwrite unowned static output and keeps it unchanged', async t => {
  const root = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const outputRoot = path.join(root, 'dist')
  fs.mkdirSync(outputRoot)
  fs.writeFileSync(path.join(outputRoot, 'index.html'), '<h1>owner content</h1>')
  write(outputRoot, 'canvas/review/index.html', '<h1>route owner content</h1>')
  const result = await publishNotebook({ root, outputRoot, graph: discoverNotebook(root), prototypeResults: [] })
  assert.equal(result.success, false)
  assert.ok(result.diagnostics.some(item => item.code === 'STATIC_OUTPUT_COLLISION'))
  assert.equal(fs.readFileSync(path.join(outputRoot, 'index.html'), 'utf8'), '<h1>owner content</h1>')
  assert.equal(fs.readFileSync(path.join(outputRoot, 'canvas/review/index.html'), 'utf8'), '<h1>route owner content</h1>')
})

test('prototype stage failures stay visible and make the publisher result unsuccessful', async t => {
  const root = fixture()
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  write(root, 'research/Flow.prototype/Flow.prototype.json', JSON.stringify({
    formatVersion: 1, id: 'flow', title: 'Flow', runtime: { id: '@dfosco/statefully', version: '0.2.1' }, entry: 'index.html',
    views: [{ id: 'home', title: 'Home', path: '/' }],
  }))
  write(root, 'research/Flow.prototype/index.html', '<div>prototype</div>')
  const graph = discoverNotebook(root)
  const result = await publishNotebook({ root, outputRoot: path.join(root, 'dist'), graph, prototypeResults: [{ artifactId: 'flow', outDir: path.join(root, 'dist/prototypes/flow'), diagnostics: [{ code: 'PROTOTYPE_BUILD_FAILED', message: 'bundler stopped' }] }] })
  assert.equal(result.success, false)
  assert.equal(result.graph.artifacts.find(item => item.id === 'flow').available, false)
  assert.ok(result.diagnostics.some(item => item.code === 'PROTOTYPE_STATIC_OUTPUT_UNAVAILABLE' && item.artifactId === 'flow' && item.path === 'research/Flow.prototype'))
})
