import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { documentCanvasScene } from '../../src/client/docs/render-scene.js'

test('document canvas scenes preserve local and static rendering modes when resized', () => {
  const baseScene = {
    title: 'Embedded Site',
    width: 320,
    height: 180,
    notices: [],
    items: [{ id: 'site', kind: 'site', localSrc: 'http://localhost:4173/books', geometry: { x: 12, y: 18, width: 320, height: 180 } }],
  }

  const local = documentCanvasScene({ ...baseScene, mode: 'local' }, 640, 360)
  const statik = documentCanvasScene({ ...baseScene, mode: 'static' }, 1280, 720)

  assert.equal(local.mode, 'local')
  assert.equal(statik.mode, 'static')
  assert.deepEqual(local.items[0].geometry, { x: 0, y: 0, width: 640, height: 360 })
  assert.deepEqual(statik.items[0].geometry, { x: 0, y: 0, width: 1280, height: 720 })
})

test('document components preserve source order, full-width wrapper, and unavailable reference output', async () => {
  const server = await createServer({
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    plugins: [react()],
    server: { middlewareMode: true },
  })
  try {
    const { Document, Prototype, Site, Image, CanvasWidget } = await server.ssrLoadModule('/src/client/docs/index.js')
    function Content() {
      return React.createElement(React.Fragment, null,
        React.createElement('p', null, 'First block'),
        React.createElement(Prototype, { artifactId: 'missing-prototype', viewId: 'explicit-view' }),
        React.createElement('p', null, 'Second block'),
        React.createElement(Site, { artifactId: 'missing-site', viewId: 'missing-view' }),
        React.createElement(Image, { src: 'assets/missing.png', alt: 'Missing diagram' }),
        React.createElement(CanvasWidget, { type: 'custom-chart', props: { fallback: { type: 'text', text: '<literal fallback>' } } }),
      )
    }
    const requested = []
    const markup = renderToStaticMarkup(React.createElement(Document, {
      Content,
      artifact: { id: 'doc', title: 'Document', path: 'docs/review.doc.mdx', folderPath: 'docs' },
      artifacts: [],
      mode: 'static',
      resolveArtifact: (reference, context) => {
        requested.push({ reference, kind: context.kind, viewId: context.viewId })
        return { available: false, diagnostics: [{ code: 'UNAVAILABLE_ARTIFACT' }] }
      },
      resolveAsset: () => ({ available: false, diagnostics: [{ code: 'UNAVAILABLE_ASSET' }] }),
    }))
    const css = await readFile(new URL('../../src/client/docs/style.css', import.meta.url), 'utf8')

    assert.ok(markup.indexOf('First block') < markup.indexOf('Prototype view is unavailable.'))
    assert.ok(markup.indexOf('Prototype view is unavailable.') < markup.indexOf('Second block'))
    assert.ok(markup.includes('Site view and destination are unavailable.'))
    assert.ok(markup.includes('Image source is unavailable.'))
    assert.ok(markup.includes('&lt;literal fallback&gt;'))
    assert.ok(markup.includes('data-document-id="doc"'))
    assert.deepEqual(requested, [
      { reference: 'missing-prototype', kind: 'prototype', viewId: 'explicit-view' },
      { reference: 'missing-site', kind: 'site', viewId: 'missing-view' },
    ])
    assert.match(css, /\.doc-renderer[\s\S]*?width:\s*100%/)
    assert.match(css, /overflow-x:\s*hidden/)
    assert.match(css, /\.doc-widget[\s\S]*?max-width:\s*100%/)
    assert.doesNotMatch(css, /width:\s*\d+px/)
  } finally {
    await server.close()
  }
})
