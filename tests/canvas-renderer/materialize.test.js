import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { materializeCanvas } from '../../src/canvas-renderer/index.js'

const fixture = await readFile(new URL('../canvas-format/fixtures/valid.jsonl', import.meta.url), 'utf8')

test('materializes the canonical JSONL replay with preserved placement identity and geometry', () => {
  const result = materializeCanvas(fixture, {
    mode: 'static',
    assetBaseUrl: 'https://notebook.example/review/',
    resolveArtifact(reference, { kind }) {
      if (kind === 'prototype' && reference === '/checkout') return { url: 'https://notebook.example/prototypes/checkout/' }
      if (kind === 'site' && reference === '/marketing') {
        return {
          title: 'Marketing',
          descriptor: {
            published: { url: 'https://marketing.example/' },
            local: { developmentUrl: 'http://localhost:3000/' },
            views: [{ id: 'home', title: 'Home', screenshot: 'marketing/home.png' }],
          },
        }
      }
      return null
    },
    resolveAsset(value, { purpose }) {
      return purpose === 'site-screenshot'
        ? `https://notebook.example/marketing.site/${value}`
        : `https://notebook.example/review/${value}`
    },
  })

  assert.equal(result.status, 'complete')
  assert.equal(result.canvasId, 'design-review')
  assert.deepEqual(result.scene.items.map(({ id }) => id), ['note-1', 'image-1', 'prototype-1', 'site-1'])
  assert.deepEqual(result.scene.items.map(({ geometry }) => geometry), [
    { x: 10, y: 20, width: 320, height: 120 },
    { x: 440, y: 60, width: 520, height: 320 },
    { x: 920, y: 24, width: 800, height: 600 },
    { x: 1760, y: 24, width: 800, height: 600 },
  ])
  assert.equal(result.scene.items[0].text, 'Updated note')
  assert.equal(result.scene.items[1].src, 'https://notebook.example/review/assets/reference.png')
  assert.equal(result.scene.items[2].kind, 'frame')
  assert.equal(result.scene.items[2].src, 'https://notebook.example/prototypes/checkout/')
  assert.deepEqual(result.scene.items[3], {
    id: 'site-1', kind: 'site', geometry: { x: 1760, y: 24, width: 800, height: 600 },
    src: null, href: 'https://marketing.example/', title: 'Marketing',
  })
  assert.ok(result.scene.notices.some(message => /no resolvable screenshot/.test(message)))
  assert.equal(result.replay.state.widgets[0].position.x, 10)
})

test('static site materialization never uses a localhost or local development URL', () => {
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'static', widgets: [
    { id: 'site', type: 'site', position: { x: 0, y: 0 }, props: { src: 'marketing', viewId: 'home' } },
  ] })
  const result = materializeCanvas(source, {
    mode: 'static',
    resolveArtifact: () => ({ descriptor: {
      local: { developmentUrl: 'http://localhost:3000/' },
      published: { url: 'https://marketing.example/' },
      views: [{ id: 'home', screenshot: 'home.png', localUrl: 'http://localhost:3000/' }],
    } }),
    resolveAsset: () => 'https://notebook.example/assets/home.png',
  })
  assert.equal(result.scene.items[0].href, 'https://marketing.example/')
  assert.equal(result.scene.items[0].src, 'https://notebook.example/assets/home.png')
  assert.equal(result.scene.items[0].href.includes('localhost'), false)
})

test('honors exact site view identity and resolves its route and query against the mode base', () => {
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'views', widgets: [
    { id: 'site', type: 'site', props: { src: 'marketing', viewId: 'catalog' } },
    { id: 'missing', type: 'site', props: { src: 'marketing', viewId: 'does-not-exist' } },
  ] })
  const seen = []
  const result = materializeCanvas(source, {
    mode: 'static',
    resolveArtifact(reference, context) {
      seen.push(context.viewId)
      return { available: true, descriptor: {
        published: { url: 'https://marketing.example/deployment/' },
        local: { developmentUrl: 'http://localhost:3000/' },
        views: [
          { id: 'catalog', title: 'Catalog', path: '/catalog?category=chairs&page=2', screenshot: 'catalog.png' },
          { id: 'home', title: 'Home', path: '/', screenshot: 'home.png' },
        ],
      } }
    },
    resolveAsset: value => `https://notebook.example/shots/${value}`,
  })
  assert.deepEqual(seen, ['catalog', 'does-not-exist'])
  assert.equal(result.scene.items[0].href, 'https://marketing.example/catalog?category=chairs&page=2')
  assert.equal(result.scene.items[0].src, 'https://notebook.example/shots/catalog.png')
  assert.equal(result.scene.items[0].title, 'Catalog')
  assert.equal(result.scene.items[1].src, null)
  assert.equal(result.scene.items[1].href, null)
  assert.ok(result.scene.notices.some(message => /view "does-not-exist".*was not found/.test(message)))
})

test('projects a separate local Site frame URL and keeps root-relative screenshot assets portable', () => {
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'local-site', widgets: [
    { id: 'site', type: 'site', props: { artifactId: 'catalog', viewId: 'home' } },
  ] })
  const seen = []
  const resolve = mode => materializeCanvas(source, {
    mode,
    resolveArtifact(reference, context) {
      seen.push({ reference, kind: context.kind, viewId: context.viewId, mode: context.mode })
      return { available: true, id: 'catalog', kind: 'site', descriptor: {
        local: { developmentUrl: 'http://127.0.0.1:4173/catalog/' },
        published: { url: 'https://catalog.example/deploy/' },
        views: [{ id: 'home', title: 'Catalog home', path: '/books?sort=title#results', screenshot: 'assets/home.png' }],
      } }
    },
    resolveAsset(value, context) {
      assert.equal(context.purpose, 'site-screenshot')
      return { available: true, url: `/preview/research/catalog.site/${value}` }
    },
  })
  const local = resolve('local')
  const published = resolve('static')
  assert.equal(local.scene.mode, 'local')
  assert.equal(local.scene.items[0].localSrc, 'http://127.0.0.1:4173/books?sort=title#results')
  assert.equal(local.scene.items[0].href, local.scene.items[0].localSrc)
  assert.equal(local.scene.items[0].src, '/preview/research/catalog.site/assets/home.png')
  assert.equal(published.scene.mode, 'static')
  assert.equal(published.scene.items[0].localSrc, undefined)
  assert.equal(published.scene.items[0].href, 'https://catalog.example/books?sort=title#results')
  assert.equal(published.scene.items[0].src, '/preview/research/catalog.site/assets/home.png')
  assert.deepEqual(seen, [
    { reference: 'catalog', kind: 'site', viewId: 'home', mode: 'local' },
    { reference: 'catalog', kind: 'site', viewId: 'home', mode: 'static' },
  ])
})

test('uses the host-selected default Site view only when the request omits viewId', () => {
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'site-default-view', widgets: [
    { id: 'site', type: 'site', props: { artifactId: 'catalog' } },
  ] })
  const result = materializeCanvas(source, {
    mode: 'static',
    resolveArtifact: () => ({ available: true, descriptor: {
      published: { url: 'https://catalog.example/' },
      views: [
        { id: 'home', title: 'Home', path: '/' },
        { id: 'books', title: 'Books', path: '/books?sort=title#results', screenshot: 'books.png' },
      ],
    }, view: { id: 'books', title: 'Books', path: '/books?sort=title#results', screenshot: 'books.png' } }),
    resolveAsset: () => '/static/catalog/books.png',
  })
  assert.equal(result.scene.items[0].title, 'Books')
  assert.equal(result.scene.items[0].href, 'https://catalog.example/books?sort=title#results')
  assert.equal(result.scene.items[0].src, '/static/catalog/books.png')
})

test('a view-specific Site URL takes precedence over its root URL and keeps its exact query and fragment', () => {
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'site-direct-urls', widgets: [
    { id: 'site', type: 'site', props: { artifactId: 'catalog', viewId: 'home' } },
  ] })
  const resolveArtifact = () => ({ available: true, descriptor: {
    local: { developmentUrl: 'http://127.0.0.1:4173/root/' },
    published: { url: 'https://catalog.example/root/' },
    views: [{
      id: 'home',
      path: '/books?from=path#path-fragment',
      localUrl: 'http://127.0.0.1:4173/direct?local=1#local-view',
      publishedUrl: 'https://catalog.example/direct?view=1&sort=title#results',
      screenshot: 'home.png',
    }],
  } })
  const staticResult = materializeCanvas(source, { mode: 'static', resolveArtifact, resolveAsset: () => '/preview/catalog/home.png' })
  const localResult = materializeCanvas(source, { mode: 'local', resolveArtifact, resolveAsset: () => '/preview/catalog/home.png' })
  assert.equal(staticResult.scene.items[0].href, 'https://catalog.example/direct?view=1&sort=title#results')
  assert.equal(localResult.scene.items[0].localSrc, 'http://127.0.0.1:4173/direct?local=1#local-view')
  assert.equal(localResult.scene.items[0].href, 'http://127.0.0.1:4173/direct?local=1#local-view')
})

test('Site screenshot resolution receives the artifact folder as the runtime basePath', () => {
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'site-asset-base', widgets: [
    { id: 'site', type: 'site', props: { artifactId: 'catalog', viewId: 'home' } },
  ] })
  let assetOptions
  const result = materializeCanvas(source, {
    mode: 'static',
    resolveArtifact: () => ({ available: true, folderPath: 'groups/research/catalog.site', descriptor: {
      published: { url: 'https://catalog.example/' },
      views: [{ id: 'home', path: '/', screenshot: 'assets/home.png' }],
    } }),
    resolveAsset: (reference, options) => {
      assetOptions = { reference, ...options }
      return { available: true, url: '/preview/groups/research/catalog.site/assets/home.png' }
    },
  })
  assert.equal(result.scene.items[0].src, '/preview/groups/research/catalog.site/assets/home.png')
  assert.equal(assetOptions.reference, 'assets/home.png')
  assert.equal(assetOptions.basePath, 'groups/research/catalog.site')
  assert.equal(assetOptions.mode, 'static')
})

test('local Site without a local server falls back to a published link and reports the missing local view', () => {
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'site-no-local', widgets: [
    { id: 'site', type: 'site', props: { artifactId: 'catalog', viewId: 'home' } },
  ] })
  const result = materializeCanvas(source, {
    mode: 'local',
    resolveArtifact: () => ({ available: true, descriptor: {
      published: { url: 'https://catalog.example/' },
      views: [{ id: 'home', path: '/books', screenshot: 'home.png' }],
    } }),
    resolveAsset: () => 'https://notebook.example/catalog.site/home.png',
  })
  assert.equal(result.scene.items[0].localSrc, undefined)
  assert.equal(result.scene.items[0].href, 'https://catalog.example/books')
  assert.ok(result.diagnostics.some(item => item.code === 'unavailable-site-local-view'))
})

test('static Site materialization never exposes a local iframe URL or machine-local published link', () => {
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'site-local-publication', widgets: [
    { id: 'site', type: 'site', props: { artifactId: 'catalog', viewId: 'home' } },
  ] })
  const result = materializeCanvas(source, { mode: 'static', resolveArtifact: () => ({ available: true, descriptor: {
    local: { developmentUrl: 'http://localhost:4173/' },
    published: { url: 'https://127.0.0.1/' },
    views: [{ id: 'home', path: '/', localUrl: 'http://localhost:4173/', publishedUrl: 'https://127.0.0.1/', screenshot: 'home.png' }],
  } }), resolveAsset: () => '/preview/site/home.png' })
  assert.equal(Object.hasOwn(result.scene.items[0], 'localSrc'), false)
  assert.equal(result.scene.items[0].href, null)
  assert.equal(result.scene.items[0].src, '/preview/site/home.png')
  assert.ok(result.diagnostics.some(item => item.code === 'unavailable-site-link'))
})

test('does not render site artifacts declared unavailable', () => {
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'unavailable', widgets: [
    { id: 'site', type: 'site', props: { src: 'missing', viewId: 'home' } },
  ] })
  const result = materializeCanvas(source, { mode: 'static', resolveArtifact: () => ({
    available: false,
    descriptor: { published: { url: 'https://site.example/' }, views: [{ id: 'home', screenshot: 'home.png' }] },
  }), resolveAsset: () => 'https://site.example/home.png' })
  assert.equal(result.scene.items[0].src, null)
  assert.equal(result.scene.items[0].href, null)
  assert.ok(result.scene.notices.some(message => /artifact for widget site is unavailable/.test(message)))
})

test('does not treat malformed explicit view IDs as a request for the default route', () => {
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'invalid-view-id', widgets: [
    { id: 'site', type: 'site', props: { src: 'site', viewId: 7 } },
  ] })
  const result = materializeCanvas(source, { mode: 'static', resolveArtifact: () => ({ available: true, descriptor: {
    published: { url: 'https://site.example/' }, views: [{ id: 'home', path: '/', screenshot: 'home.png' }],
  } }), resolveAsset: () => 'https://site.example/home.png' })
  assert.equal(result.scene.items[0].href, null)
  assert.equal(result.scene.items[0].src, null)
  assert.ok(result.scene.notices.some(message => /view "7".*was not found/.test(message)))
})

test('rejects loopback and machine-local static site destinations', () => {
  for (const published of [
    'http://localhost:8080/',
    'https://preview.localhost/',
    'https://127.0.0.1/',
    'https://127.20.1.5/',
    'https://[::1]/',
    'https://preview.local/',
    'https://[::ffff:7f00:1]/',
    'https://0.0.0.0/',
  ]) {
    const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'local-publish', widgets: [
      { id: 'site', type: 'site', props: { src: 'site' } },
    ] })
    const result = materializeCanvas(source, { mode: 'static', resolveArtifact: () => ({ available: true, descriptor: { published: { url: published } } }) })
    assert.equal(result.scene.items[0].href, null, published)
    assert.ok(result.scene.notices.some(message => /no valid static destination/.test(message)), published)
  }
})

test('passes prototype view identity to the host resolver', () => {
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'prototype-view', widgets: [
    { id: 'prototype', type: 'prototype', props: { src: 'checkout', viewId: 'mobile' } },
  ] })
  let seen
  materializeCanvas(source, { resolveArtifact: (reference, context) => {
    seen = { reference, kind: context.kind, viewId: context.viewId }
    return { available: true, url: 'https://notebook.example/prototype/mobile/' }
  } })
  assert.deepEqual(seen, { reference: 'checkout', kind: 'prototype', viewId: 'mobile' })
})

test('keeps a prototype marked unavailable out of the rendered frame', () => {
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'prototype-unavailable', widgets: [
    { id: 'prototype', type: 'prototype', props: { src: 'missing' } },
  ] })
  const result = materializeCanvas(source, { resolveArtifact: () => ({ available: false, url: 'https://notebook.example/must-not-render/' }) })
  assert.equal(result.scene.items[0].src, null)
  assert.ok(result.scene.notices.some(message => /no resolved local or published entry/.test(message)))
})

test('resolves relative canvas assets from the caller-selected host base', () => {
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'assets', widgets: [
    { id: 'image', type: 'image', props: { src: '../assets/photo.png' } },
  ] })
  const result = materializeCanvas(source, { assetBaseUrl: 'https://notebook.example/canvases/review/' })
  assert.equal(result.scene.items[0].src, 'https://notebook.example/canvases/assets/photo.png')
})

test('turns resolver failures into visible unavailable references instead of aborting the scene', () => {
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'resolver-error', widgets: [
    { id: 'image', type: 'image', props: { src: 'image.png' } },
    { id: 'prototype', type: 'prototype', props: { src: 'prototype-id' } },
  ] })
  const result = materializeCanvas(source, {
    resolveAsset() { throw new Error('asset host unavailable') },
    resolveArtifact() { throw new Error('artifact host unavailable') },
  })
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.scene.items.map(item => item.id), ['image', 'prototype'])
  assert.ok(result.scene.notices.some(message => /no resolvable source/.test(message)))
  assert.ok(result.scene.notices.some(message => /no resolved local or published entry/.test(message)))
})

test('reports unsupported replay features, partial replay and unavailable references as render notices', () => {
  const source = [
    JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'partial', sources: [{ id: 'source' }], connectors: [{ id: 'edge', start: { widgetId: 'a' }, end: { widgetId: 'b' } }], widgets: [
      { id: 'prototype', type: 'prototype', position: { x: -20, y: -10 }, props: { width: 100, height: 80, src: 'missing' } },
    ] }),
    JSON.stringify({ event: 'connector_added', connector: { id: 'later' } }),
  ].join('\n')
  const result = materializeCanvas(source, { resolveArtifact: () => null })
  assert.equal(result.status, 'partial')
  assert.deepEqual(result.scene.items[0].geometry, { x: -20, y: -10, width: 100, height: 80 })
  assert.ok(result.diagnostics.some(item => item.code === 'unsupported-event'))
  assert.ok(result.diagnostics.some(item => item.code === 'unsupported-header-sources'))
  assert.ok(result.diagnostics.some(item => item.code === 'unsupported-header-connectors'))
  assert.ok(result.diagnostics.some(item => item.code === 'unavailable-prototype'))
  assert.ok(result.scene.notices.length >= 4)
})

test('rejects invalid rendering modes and keeps unknown widget types visible', () => {
  assert.throws(() => materializeCanvas(fixture, { mode: 'preview' }), /mode/)
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'future', widgets: [
    { id: 'widget-x', type: 'future-widget', position: { x: 0, y: 0 }, props: { width: 10, height: 10 } },
  ] })
  const result = materializeCanvas(source)
  assert.equal(result.scene.items[0].kind, 'future-widget')
  assert.match(result.scene.items[0].message, /not supported/)
  assert.ok(result.scene.notices.some(message => /no declared fallback/.test(message)))
})

test('projects only the declared literal text fallback for unknown widgets and preserves layout', () => {
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'fallback', widgets: [
    { id: 'chart', type: 'chart', position: { x: -24, y: 18 }, props: { width: 420, height: 210, fallback: { type: 'text', text: '<img src=x onerror=alert(1)>' } } },
  ] })
  const local = materializeCanvas(source, { mode: 'local' })
  const published = materializeCanvas(source, { mode: 'static' })
  assert.deepEqual(local.scene.items, published.scene.items)
  assert.deepEqual(local.scene.items[0], {
    id: 'chart', kind: 'chart', geometry: { x: -24, y: 18, width: 420, height: 210 },
    message: 'Widget type “chart” is not supported by this canvas viewer; showing its text fallback.',
    fallback: { type: 'text', text: '<img src=x onerror=alert(1)>' },
  })
  assert.equal(local.replay.state.widgets[0].props.fallback.text, '<img src=x onerror=alert(1)>')
  assert.equal(local.scene.notices.length, 0)
})

test('keeps malformed, missing, and unsupported fallback shapes unavailable with diagnostics', () => {
  const widgets = [
    { id: 'missing', type: 'chart', props: {} },
    { id: 'bad-text', type: 'chart', props: { fallback: { type: 'text', text: 42 } } },
    { id: 'unsupported', type: 'chart', props: { fallback: { type: 'html', text: '<b>unsafe</b>' } } },
  ]
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'bad-fallback', widgets })
  const result = materializeCanvas(source)
  assert.deepEqual(result.scene.items.map(item => item.fallback), [undefined, undefined, undefined])
  assert.deepEqual(result.diagnostics.filter(item => item.widgetId).map(item => item.code), [
    'missing-widget-fallback', 'invalid-widget-fallback', 'unsupported-widget-fallback',
  ])
  assert.ok(result.scene.items.every(item => /content is unavailable/.test(item.message)))
  assert.deepEqual(result.replay.state.widgets, widgets)
})

test('falls back for malformed optional canvas size without discarding replayed widgets', () => {
  const source = JSON.stringify({ event: 'canvas_created', formatVersion: 1, canvasId: 'bad-size', width: -1, height: 'large', widgets: [
    { id: 'note', type: 'sticky-note', props: { text: 'still visible' } },
  ] })
  const result = materializeCanvas(source)
  assert.equal(result.status, 'complete')
  assert.equal(result.scene.width, 1200)
  assert.equal(result.scene.height, 800)
  assert.equal(result.scene.items[0].text, 'still visible')
  assert.ok(result.scene.notices.some(message => /dimensions are unusable/.test(message)))
})
