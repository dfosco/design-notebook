import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { computeCanvasBoardGeometry, InteractiveCanvas, logicalGeometryFromBlockStyle, resizeGeometryByKeyboard } from '../../src/vendor/tiny-canvas/interactive.js'

test('board geometry includes negative and beyond-default authored item bounds', () => {
  const board = computeCanvasBoardGeometry([
    { geometry: { x: -640, y: -310, width: 320, height: 180 } },
    { geometry: { x: 2500, y: 1900, width: 400, height: 500 } },
  ])

  assert.deepEqual(board.origin, { x: -768, y: -438 })
  assert.deepEqual(board.bounds, { left: -640, top: -310, right: 2900, bottom: 2400 })
  assert.equal(board.width, 3796)
  assert.equal(board.height, 2966)
})

test('keyboard resize reads logical block dimensions instead of zoomed viewport pixels', () => {
  const block = {
    style: { width: '200px', height: '160px' },
    getBoundingClientRect() { return { width: 100, height: 80 } },
  }
  const logical = logicalGeometryFromBlockStyle(block, { width: 270, height: 170 })
  assert.deepEqual(resizeGeometryByKeyboard(logical, 'ArrowRight'), { width: 210, height: 160 })
  assert.deepEqual(resizeGeometryByKeyboard(logical, 'ArrowDown'), { width: 200, height: 170 })
  assert.equal(resizeGeometryByKeyboard(logical, 'Enter'), null)
})

test('interactive canvas uses Tiny Canvas widgets and clearly labels static saves as unavailable', () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  let storageCalls = 0
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem() { storageCalls += 1; return null },
      setItem() { storageCalls += 1 },
    },
  })
  let html
  try {
    html = renderToStaticMarkup(React.createElement(InteractiveCanvas, {
      canvasId: 'review-canvas',
      revision: '"rev-1"',
      mode: 'static',
      scene: {
        title: 'Review',
        items: [
          { id: 'note-1', kind: 'text', text: 'Literal <b>text</b>', color: 'yellow', geometry: { x: -40, y: 25, width: 270, height: 170 } },
          { id: 'markdown-1', kind: 'markdown', text: '**Markdown**', geometry: { x: 1320, y: 900, width: 400, height: 220 } },
          { id: 'site-1', kind: 'site', title: 'Existing site', src: 'https://site.example/screenshot.png', href: 'https://site.example/', geometry: { x: 600, y: 380, width: 360, height: 240 } },
          { id: 'unknown-1', kind: 'unsupported-widget', message: 'Unsupported canvas item', fallback: { type: 'text', text: '<img src=x onerror=alert(1)>' }, geometry: { x: 20, y: 40, width: 300, height: 160 } },
        ],
      },
    }))
  } finally {
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
    else delete globalThis.localStorage
  }

  assert.match(html, /Published canvas is read-only\. Move and resize changes are temporary and will not be saved\./)
  assert.match(html, /<h1 class="notebook-shell__canvas-title">Review<\/h1>/)
  assert.match(html, /class="notebook-shell__canvas-status notebook-shell__canvas-save-note" role="status"/)
  assert.doesNotMatch(html, /notebook-shell__canvas-toolbar/)
  assert.match(html, /data-block-id="note-1"/)
  assert.match(html, /data-block-id="markdown-1"/)
  assert.match(html, /data-block-id="site-1"/)
  assert.match(html, /data-block-id="unknown-1"/)
  assert.match(html, /Literal &lt;b&gt;text&lt;\/b&gt;/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.doesNotMatch(html, /<img src=x onerror=alert/)
  assert.match(html, /aria-label="Fit canvas to view"/)
  assert.match(html, /class="tc-canvas-control tc-no-drag notebook-shell__canvas-fit"/)
  assert.match(html, /aria-label="Canvas zoom"/)
  assert.match(html, /canvas-scene__site-static-screenshot/)
  assert.match(html, /<img src="https:\/\/site\.example\/screenshot\.png"/)
  assert.match(html, /href="https:\/\/site\.example\/"/)
  assert.doesNotMatch(html, /canvas-scene__site-screenshot-fallback/)
  assert.doesNotMatch(html, /<iframe/)
  assert.equal(storageCalls, 0)
})

test('local canvas has a title overlay without a permanent saved-status strip', () => {
  const html = renderToStaticMarkup(React.createElement(InteractiveCanvas, {
    canvasId: 'review-canvas',
    revision: '"rev-1"',
    mode: 'local',
    scene: { title: 'Review', items: [] },
  }))

  assert.match(html, /<h1 class="notebook-shell__canvas-title">Review<\/h1>/)
  assert.match(html, /aria-label="Fit canvas to view"/)
  assert.doesNotMatch(html, /notebook-shell__canvas-status/)
  assert.doesNotMatch(html, /notebook-shell__canvas-toolbar/)
})

test('local Site screenshot stays available in a disclosure beside the same-origin preview', () => {
  const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { href: 'http://127.0.0.1:4173/', origin: 'http://127.0.0.1:4173' },
  })
  let html
  try {
    html = renderToStaticMarkup(React.createElement(InteractiveCanvas, {
      canvasId: 'review-canvas',
      revision: '"rev-1"',
      mode: 'local',
      scene: {
        title: 'Review',
        items: [{
          id: 'site-1', kind: 'site', title: 'Existing site',
          localSrc: 'http://127.0.0.1:4173/catalog/',
          src: 'http://127.0.0.1:4173/catalog/screenshot.png',
          href: 'http://127.0.0.1:4173/catalog/',
          geometry: { x: 0, y: 0, width: 360, height: 240 },
        }],
      },
    }))
  } finally {
    if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation)
    else delete globalThis.location
  }

  assert.match(html, /sandbox="allow-scripts allow-forms allow-popups allow-same-origin"/)
  assert.match(html, /<details class="canvas-scene__site-screenshot-fallback"><summary>Fallback screenshot/)
  assert.match(html, /src="http:\/\/127\.0\.0\.1:4173\/catalog\/screenshot\.png"/)
})
