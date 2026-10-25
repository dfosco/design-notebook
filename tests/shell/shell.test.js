import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'

function createShellTestServer() {
  return createServer({ configFile: false, appType: 'custom', logLevel: 'silent', plugins: [react()], server: { middlewareMode: true } })
}

function makeArtifact(id, kind, path, available = true) {
  return { id, kind, path, folderPath: path.split('/').slice(0, -1).join('/'), title: `${kind} ${id}`, available, diagnostics: available ? [] : [{ code: 'BROKEN_ARTIFACT', message: `${id} source is invalid.` }], views: kind === 'prototype' ? [{ id: 'default', title: 'Default', path: '/' }, { id: 'review', title: 'Review', path: '/review' }] : [] }
}

function groupedGraph() {
  const entries = []
  const artifacts = []
  for (let group = 0; group < 4; group += 1) {
    const children = []
    for (let index = 0; index < 16; index += 1) {
      const kind = ['prototype', 'canvas', 'site', 'doc'][index % 4]
      const artifact = makeArtifact(`${kind}-${group}-${index}`, kind, `research/group-${group}/${kind}-${index}.${kind === 'doc' ? 'doc.mdx' : kind}`)
      artifacts.push(artifact)
      children.push({ type: 'artifact', artifact })
    }
    entries.push({ type: 'group', name: `group-${group}`, path: `research/group-${group}`, children })
  }
  return { root: '/notebook', entries, artifacts, diagnostics: [] }
}

test('shell renders a large mixed ordinary hierarchy with stable destinations and view choices', async () => {
  const server = await createShellTestServer()
  try {
    const { NotebookShell } = await server.ssrLoadModule('/src/client/shell/index.js')
    const graph = groupedGraph()
    const html = renderToStaticMarkup(React.createElement(NotebookShell, {
      graph,
      mode: 'static',
      baseUrl: 'https://notebook.example/preview/branch/prototype-1-0/review',
      routeBase: '/preview/branch/',
      customCssUrl: '/preview/branch/notebook.css',
    }))

    assert.equal((html.match(/data-artifact-id=/g) ?? []).length, 64)
    assert.equal((html.match(/data-folder-path="research\/group-/g) ?? []).length, 4)
    assert.ok(html.includes('href="/preview/branch/prototype-0-0"'))
    assert.ok(html.includes('href="/preview/branch/prototype-1-0/review"'))
    assert.ok(html.includes('href="/preview/branch/canvas/canvas-0-1"'))
    assert.ok(html.includes('href="/preview/branch/sites/site-0-2"'))
    assert.ok(html.includes('href="/preview/branch/docs/doc-0-3"'))
    assert.ok(!html.includes('?artifact='))
    assert.ok(html.includes('aria-label="Artifacts"'))
    assert.ok(html.includes('data-slot="sidebar-wrapper"'))
    assert.ok(html.includes('data-slot="sidebar"'))
    assert.ok(html.includes('data-hc-notebook-topbar=""'))
    assert.ok(html.includes('data-slot="breadcrumb"'))
    assert.ok(html.includes('value="review" selected=""'))
    assert.ok(html.includes('prototype-1-0'))
    assert.ok(html.includes('data-mode="static"'))
    assert.ok(html.includes('href="https://notebook.example/preview/branch/notebook.css"'))
    assert.ok(!html.includes('node_modules'))
  } finally {
    await server.close()
  }
})

test('mixed folder hierarchy uses vendored collapsible section composition and artifact icons', async () => {
  const server = await createShellTestServer()
  try {
    const { NotebookShell } = await server.ssrLoadModule('/src/client/shell/index.js')
    const doc = makeArtifact('decision-doc', 'doc', 'research/decision.doc.mdx')
    const canvas = makeArtifact('review-canvas', 'canvas', 'research/design/review.canvas')
    const prototype = makeArtifact('flow-prototype', 'prototype', 'research/design/flow.prototype')
    const graph = {
      entries: [{
        type: 'group', name: 'research', path: 'research', children: [
          { type: 'artifact', artifact: doc },
          { type: 'group', name: 'design', path: 'research/design', children: [
            { type: 'artifact', artifact: canvas },
            { type: 'artifact', artifact: prototype },
          ] },
        ],
      }],
      artifacts: [doc, canvas, prototype],
      diagnostics: [],
    }
    const html = renderToStaticMarkup(React.createElement(NotebookShell, { graph, routeBase: '/' }))

    assert.ok(html.includes('aria-label="research, 3 artifacts"'))
    assert.ok(html.includes('aria-label="design, 2 artifacts"'))
    assert.ok(html.includes('▾'))
    assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 2)
    assert.equal((html.match(/data-slot="sidebar-group-label"/g) ?? []).length, 2)
    assert.equal((html.match(/data-slot="sidebar-menu"/g) ?? []).length >= 3, true)
    assert.equal((html.match(/<svg/g) ?? []).length >= 5, true)
    assert.ok(html.includes('Design Notebook'))
    assert.ok(html.includes('aria-level="1"'))
    assert.ok(!html.includes('class="siteStatus'))
    assert.ok(!html.includes('◈') && !html.includes('▧') && !html.includes('◎') && !html.includes('≡'))
    assert.ok(html.indexOf('decision-doc') < html.indexOf('review-canvas'))
  } finally {
    await server.close()
  }
})

test('Canvas pages omit the shared Hypercanvas artifact top bar', async () => {
  const server = await createShellTestServer()
  try {
    const { NotebookShell } = await server.ssrLoadModule('/src/client/shell/index.js')
    const { NotebookChrome } = await server.ssrLoadModule('/src/vendor/hypercanvas/NotebookShell/NotebookChrome.jsx')
    const canvas = makeArtifact('canvas-one', 'canvas', 'research/canvas-one.canvas')
    const prototype = makeArtifact('prototype-one', 'prototype', 'research/prototype-one.prototype')
    const render = (artifact, pathname) => renderToStaticMarkup(React.createElement(NotebookShell, {
      graph: { entries: [{ type: 'artifact', artifact }], artifacts: [artifact], diagnostics: [] },
      baseUrl: `https://notebook.example${pathname}`,
      routeBase: '/',
    }))
    const canvasHtml = render(canvas, '/canvas/canvas-one')
    const prototypeHtml = render(prototype, '/prototype-one')
    const closedPrototypeHtml = renderToStaticMarkup(React.createElement(NotebookChrome, {
      graph: { entries: [{ type: 'artifact', artifact: prototype }], artifacts: [prototype], diagnostics: [] },
      selected: prototype,
      makeHref: () => '/prototype-one',
      onSelect() {},
      sidebarOpen: false,
      onSidebarOpenChange() {},
    }))
    const closedCanvasHtml = renderToStaticMarkup(React.createElement(NotebookChrome, {
      graph: { entries: [{ type: 'artifact', artifact: canvas }], artifacts: [canvas], diagnostics: [] },
      selected: canvas,
      makeHref: () => '/canvas/canvas-one',
      onSelect() {},
      sidebarOpen: false,
      onSidebarOpenChange() {},
    }))

    assert.ok(!canvasHtml.includes('data-hc-notebook-topbar'))
    assert.ok(prototypeHtml.includes('data-hc-notebook-topbar=""'))
    assert.equal((prototypeHtml.match(/aria-label="Hide notebook sidebar"/g) ?? []).length, 1)
    assert.ok(!prototypeHtml.includes('aria-label="Open notebook sidebar"'))
    assert.equal((closedPrototypeHtml.match(/aria-label="Open notebook sidebar"/g) ?? []).length, 1)
    assert.ok(!closedPrototypeHtml.includes('aria-label="Hide notebook sidebar"'))
    assert.ok(!prototypeHtml.includes('Open in browser'))
    assert.ok(closedCanvasHtml.includes('aria-label="Open notebook sidebar"'))
    assert.ok(closedCanvasHtml.includes('data-sidebar-open="false"'))
    assert.ok(canvasHtml.includes('data-sidebar-open="true"'))
  } finally {
    await server.close()
  }
})

test('shell preserves an explicit missing destination and displays unavailable artifact diagnostics', async () => {
  const server = await createShellTestServer()
  try {
    const { NotebookShell } = await server.ssrLoadModule('/src/client/shell/index.js')
    const unavailable = makeArtifact('broken', 'canvas', 'broken.canvas', false)
    const graph = { root: '/notebook', entries: [{ type: 'artifact', artifact: unavailable }], artifacts: [unavailable], diagnostics: [{ code: 'BAD_CANVAS', message: 'Canvas JSONL could not be replayed.' }] }
    const unavailableHtml = renderToStaticMarkup(React.createElement(NotebookShell, { graph, baseUrl: 'https://notebook.example/canvas/broken' }))
    const missingHtml = renderToStaticMarkup(React.createElement(NotebookShell, { graph: { entries: [], artifacts: [], diagnostics: [] }, baseUrl: 'https://notebook.example/canvas/deleted-id' }))
    const errorHtml = renderToStaticMarkup(React.createElement(NotebookShell, { error: new Error('Graph endpoint failed.'), graph: null, baseUrl: 'https://notebook.example/' }))

    assert.ok(unavailableHtml.includes('canvas is unavailable'))
    assert.ok(unavailableHtml.includes('broken source is invalid.'))
    assert.ok(unavailableHtml.includes('1 notebook diagnostic'))
    assert.ok(missingHtml.includes('Notebook route was not found.'))
    assert.ok(missingHtml.includes('data-route-status="not-found"'))
    assert.ok(missingHtml.includes('This notebook has no discovered artifacts.'))
    assert.ok(errorHtml.includes('Notebook could not be loaded'))
    assert.ok(errorHtml.includes('Graph endpoint failed.'))
  } finally {
    await server.close()
  }
})

test('legacy artifact query links select by stable ID and render canonical destinations', async () => {
  const server = await createShellTestServer()
  try {
    const { NotebookShell } = await server.ssrLoadModule('/src/client/shell/index.js')
    const artifact = makeArtifact('legacy-doc', 'doc', 'moved/notes.doc.mdx')
    const graph = { entries: [{ type: 'artifact', artifact }], artifacts: [artifact], diagnostics: [] }
    const html = renderToStaticMarkup(React.createElement(NotebookShell, {
      graph,
      baseUrl: 'https://notebook.example/preview/?artifact=legacy-doc',
      routeBase: '/preview/',
    }))
    assert.ok(html.includes('legacy-doc'))
    assert.ok(html.includes('href="/preview/docs/legacy-doc"'))
    assert.ok(!html.includes('?artifact='))
  } finally {
    await server.close()
  }
})

test('prototype surface passes the selected stable view to the host resolver', async () => {
  const server = await createShellTestServer()
  try {
    const { NotebookShell } = await server.ssrLoadModule('/src/client/shell/index.js')
    const artifact = makeArtifact('borrow-flow', 'prototype', 'research/borrow-flow.prototype')
    artifact.views[1].path = '/review?tab=compare#top'
    const graph = { root: '/notebook', entries: [{ type: 'artifact', artifact }], artifacts: [artifact], diagnostics: [] }
    const calls = []
    const html = renderToStaticMarkup(React.createElement(NotebookShell, {
      graph,
      mode: 'static',
      baseUrl: 'https://notebook.example/preview/borrow-flow/review?tab=compare#top',
      routeBase: '/preview/',
      resolveArtifact: (reference, options) => {
        calls.push({ reference, ...options })
        return { available: true, id: reference, kind: 'prototype', viewId: options.viewId, url: '/preview/prototypes/borrow-flow/review?tab=compare#top' }
      },
    }))
    assert.ok(html.includes('src="https://notebook.example/preview/prototypes/borrow-flow/review?tab=compare#top"'))
    assert.ok(html.includes('sandbox="allow-scripts allow-forms allow-popups allow-same-origin"'))
    assert.deepEqual(calls, [{ reference: 'borrow-flow', kind: 'prototype', viewId: 'review', mode: 'static' }])

    const localHtml = renderToStaticMarkup(React.createElement(NotebookShell, {
      graph,
      mode: 'local',
      baseUrl: 'http://127.0.0.1:4173/borrow-flow/review?tab=compare#top',
      resolveArtifact: (reference, options) => ({ available: true, id: reference, kind: 'prototype', viewId: options.viewId, url: 'http://127.0.0.1:4173/__notebook/prototypes/borrow-flow/review' }),
    }))
    assert.ok(localHtml.includes('src="http://127.0.0.1:4173/__notebook/prototypes/borrow-flow/review"'))
    assert.ok(localHtml.includes('sandbox="allow-scripts allow-forms allow-popups allow-same-origin"'))

    let invalidViewId = null
    const malformedViewHtml = renderToStaticMarkup(React.createElement(NotebookShell, {
      graph,
      mode: 'local',
      baseUrl: 'http://127.0.0.1:4173/?artifact=borrow-flow&view=',
      resolveArtifact: (_reference, options) => {
        invalidViewId = options.viewId
        return { available: false, diagnostics: [{ code: 'INVALID_VIEW_ID', message: 'Prototype viewId must be a non-empty string.' }] }
      },
    }))
    assert.equal(invalidViewId, null)
    assert.ok(malformedViewHtml.includes('data-route-status="invalid"'))
    assert.ok(malformedViewHtml.includes('INVALID_VIEW_ID'))
    assert.ok(!malformedViewHtml.includes('<iframe'))
  } finally {
    await server.close()
  }
})

test('client CSS retains canvas layout while Hypercanvas chrome comes from the vendored module', async () => {
  const { readFile } = await import('node:fs/promises')
  const css = await readFile(new URL('../../src/client/shell/style.css', import.meta.url), 'utf8')
  const hypercanvasCss = await readFile(new URL('../../src/vendor/hypercanvas/NotebookShell/NotebookShell.module.css', import.meta.url), 'utf8')
  const canvasCss = await readFile(new URL('../../src/vendor/tiny-canvas/upstream/tiny-canvas.css', import.meta.url), 'utf8')
  assert.match(css, /--dn-shell-sidebar-width/)
  assert.match(css, /--dn-shell-accent/)
  assert.match(css, /--dn-shell-surface/)
  assert.match(css, /--dn-shell-surface:\s*var\(--ds-color-background/)
  assert.match(css, /--dn-shell-text:\s*var\(--ds-color-foreground/)
  assert.match(css, /\.notebook-shell__view-select select\s*\{\s*color:\s*inherit;\s*font:\s*inherit;/)
  assert.match(css, /body:has\(\.notebook-shell\)\s*\{\s*margin:\s*0;/)
  assert.doesNotMatch(css, /\.notebook-shell button\s*,\s*\.notebook-shell select/)
  assert.doesNotMatch(css, /\.notebook-shell__canvas-toolbar/)
  assert.match(css, /\.notebook-shell__canvas-title\s*\{[^}]*font-size:\s*14px;[^}]*font-weight:\s*600;/s)
  assert.match(css, /\.notebook-shell__canvas-title\s*\{[^}]*color:\s*var\(--dn-shell-muted, #656d76\);/s)
  assert.match(css, /\.notebook-shell__canvas-title\s*\{[^}]*padding:\s*4px 8px;[^}]*text-overflow:\s*ellipsis;/s)
  assert.match(css, /\.notebook-shell\[data-sidebar-open="false"\] \.notebook-shell__canvas-title\s*\{[^}]*left:\s*56px;/s)
  assert.match(css, /\.notebook-shell__canvas-fit\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*auto 12px 12px auto;/s)
  assert.match(css, /\.notebook-shell__canvas-status\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*auto 12px 54px auto;/s)
  assert.match(css, /\.notebook-shell__prototype-frame\s*\{[^}]*flex:\s*1 1 auto;[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*0;/s)
  assert.doesNotMatch(css, /\.notebook-shell__prototype-frame[^}]*min-height:\s*min\(/s)
  assert.match(hypercanvasCss, /var\(--dn-shell-sidebar-width, 286px\)/)
  assert.match(hypercanvasCss, /\.artifactNavigation\s*\{/)
  assert.match(hypercanvasCss, /\.sidebarHeader\s*\{[^}]*height:\s*var\(--dn-shell-header-height\);/s)
  assert.match(hypercanvasCss, /\.artifactNavigation\s*\{[^}]*flex:\s*0 0 var\(--dn-shell-header-height, 56px\);/s)
  assert.doesNotMatch(hypercanvasCss, /openBrowserButton/)
  assert.match(hypercanvasCss, /\.sidebarProvider\s*\{/)
  assert.match(hypercanvasCss, /\.pageButton\s*\{[^}]*text-decoration:\s*none/s)
  assert.match(hypercanvasCss, /\.pageButton:visited\s*\{\s*color:\s*inherit/)
  assert.match(hypercanvasCss, /\.groupHeader\s*\{[^}]*justify-content:\s*space-between/s)
  assert.match(hypercanvasCss, /\.groupTitle\s*\{[^}]*font-weight:\s*650/s)
  assert.match(hypercanvasCss, /\.groupCount\s*,\s*\.sidebarFooterInfo\s*\{[^}]*font-size:\s*10px/s)
  assert.match(hypercanvasCss, /\.notebookButton\s*\{[^}]*font-weight:\s*600/s)
  assert.match(hypercanvasCss, /\.groupTitle\s*\{[^}]*font-size:\s*12px;[^}]*font-weight:\s*650/s)
  assert.doesNotMatch(hypercanvasCss, /\.siteStatus/)
  assert.match(canvasCss, /\.tc-canvas-control\{[^}]*font:inherit;font-weight:[^;]+;color:var\(--fgColor-default, CanvasText\);/)
  assert.match(hypercanvasCss, /\.artifactViewer\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column/s)
  assert.match(hypercanvasCss, /@media \(max-width: 720px\)/)
  assert.match(hypercanvasCss, /transform:\s*translateX\(-102%\)/)
  assert.match(css, /\.notebook-shell__canvas-viewport\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden/s)
  assert.match(css, /\.notebook-shell__canvas-viewport\s*\{[^}]*transform:\s*translateZ\(0\)/s)
  assert.match(css, /\.notebook-shell__canvas-viewport\s+\.tc-canvas-controls\s*\{[^}]*position:\s*fixed/s)
  assert.match(css, /--bgColor-default:\s*var\(--dn-shell-surface\)/)
  assert.match(css, /--fgColor-default:\s*var\(--dn-shell-text\)/)
  assert.match(css, /\.notebook-shell__canvas-viewport\s+\.tc-canvas\s*\{[\s\S]*?height:\s*100%/)
  assert.doesNotMatch(css, /\.notebook-shell__sidebar\s*\{/)
  assert.doesNotMatch(css, /\.notebook-shell__header\s*\{/)
})
