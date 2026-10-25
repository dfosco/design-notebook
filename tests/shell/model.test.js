import assert from 'node:assert/strict'
import test from 'node:test'
import { artifactForSelection, artifactViews, canvasFitTransform, canvasViewBounds, firstArtifactSelection, selectionHref } from '../../src/client/shell/model.js'
import { parseArtifactPath } from '../../src/core/runtime/notebook-routes.js'

test('shell links delegate canonical paths to the shared route helper', () => {
  const artifacts = [
    { id: 'review:canvas', kind: 'canvas' },
    { id: 'doc one', kind: 'doc' },
    { id: 'site-one', kind: 'site', views: [{ id: 'overview' }] },
    { id: 'prototype-one', kind: 'prototype', views: [{ id: 'default', path: '/' }, { id: 'review', path: '/review?tab=compare#top' }] },
  ]
  const graph = { artifacts }
  assert.equal(selectionHref(graph, '/preview/branch/', { artifactId: 'review:canvas' }), '/preview/branch/canvas/review%3Acanvas')
  assert.equal(selectionHref(graph, '/preview/branch/', { artifactId: 'doc one' }), '/preview/branch/docs/doc%20one')
  assert.equal(selectionHref(graph, '/preview/branch/', { artifactId: 'site-one', viewId: 'overview' }), '/preview/branch/sites/site-one?view=overview')
  assert.equal(selectionHref(graph, '/preview/branch/', { artifactId: 'prototype-one', viewId: 'review' }), '/preview/branch/prototype-one/review?tab=compare#top')
  assert.equal(selectionHref(graph, '/', { artifactId: 'prototype-one' }), '/prototype-one')
  assert.equal(selectionHref(graph, '/', { artifactId: 'site-one', viewId: 'missing' }), null)
})

test('shell route parsing resolves exact paths and legacy links without view fallback', () => {
  const artifacts = [
    { id: 'canvas-one', kind: 'canvas' },
    { id: 'site-one', kind: 'site', views: [{ id: 'overview' }, { id: 'details' }] },
    { id: 'prototype-one', kind: 'prototype', views: [{ id: 'default', path: '/' }, { id: 'review', path: '/review?mode=wide#top' }] },
  ]
  const options = { artifacts, base: '/preview/' }
  assert.equal(parseArtifactPath('/preview/canvas/canvas-one', options).artifact.id, 'canvas-one')
  assert.equal(parseArtifactPath('/preview/sites/site-one?view=details', options).view.id, 'details')
  assert.equal(parseArtifactPath('/preview/sites/site-one', options).artifact.id, 'site-one')
  const prototypeRoot = parseArtifactPath('/preview/prototype-one', options)
  assert.equal(prototypeRoot.status, 'matched')
  assert.equal(prototypeRoot.artifact.id, 'prototype-one')
  assert.equal(parseArtifactPath('/preview/prototype-one/review?mode=wide#top', options).view.id, 'review')
  const legacy = parseArtifactPath('/preview/?artifact=canvas-one', options)
  assert.equal(legacy.status, 'matched')
  assert.equal(legacy.canonicalPath, '/preview/canvas/canvas-one')
  assert.equal(legacy.legacy, true)
  assert.equal(parseArtifactPath('/preview/sites/site-one?view=', options).status, 'invalid')
  assert.equal(parseArtifactPath('/preview/sites/site-one?view=missing', options).status, 'invalid')
  assert.equal(parseArtifactPath('/preview/__notebook/prototypes/prototype-one', options).status, 'not-found')
})

test('tree default selection and artifact lookup retain stable IDs after path changes', () => {
  const moved = { id: 'kept-id', kind: 'doc', path: 'renamed/notes.doc.mdx' }
  const entries = [{ type: 'group', name: 'renamed', path: 'renamed', children: [{ type: 'artifact', artifact: moved }] }]
  const selection = firstArtifactSelection(entries)
  assert.deepEqual(selection, { artifactId: 'kept-id' })
  assert.equal(artifactForSelection({ artifacts: [{ ...moved, path: 'other/place.doc.mdx' }] }, selection).id, 'kept-id')
  assert.equal(artifactForSelection({ artifacts: [] }, selection), null)
})

test('artifact view projection tolerates malformed metadata and preserves authored IDs', () => {
  assert.deepEqual(artifactViews({ views: [{ id: 'overview', title: 'Overview' }, { id: '' }, null, { title: 'Missing ID' }] }), [
    { id: 'overview', title: 'Overview' },
  ])
})

test('canvas Fit includes item bounds beyond nominal dimensions and preserves negative authored positions', () => {
  const bounds = canvasViewBounds({ width: 1200, height: 800, items: [
    { geometry: { x: -180, y: -40, width: 120, height: 100 } },
    { geometry: { x: 1180, y: 790, width: 420, height: 180 } },
    { geometry: { x: NaN, y: 0, width: 20, height: 20 } },
  ] })
  assert.deepEqual(bounds, { x: -180, y: -40, width: 1780, height: 1010 })
  const transform = canvasFitTransform({ width: 1000, height: 700 }, bounds)
  assert.equal(transform.scale, Math.min(952 / 1780, 652 / 1010))
  assert.ok(transform.x > 24)
  assert.ok(transform.y > 24)
  assert.deepEqual(canvasViewBounds({ width: 500, height: 300, items: [] }), { x: 0, y: 0, width: 500, height: 300 })
})
