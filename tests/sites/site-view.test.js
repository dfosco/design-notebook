import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readdir } from 'node:fs/promises'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { discoverNotebook } from '../../index.js'
import { materializeCanvas } from '../../src/canvas-renderer/index.js'
import { buildNotebook, createNotebookRuntime } from '../../src/core/runtime/index.js'

function write(root, relativePath, contents) {
  const destination = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, contents)
  return destination
}

function addSiteViewPrototype(root) {
  write(root, 'SiteEntry.prototype/SiteEntry.prototype.json', JSON.stringify({
    formatVersion: 1,
    id: 'site-entry',
    title: 'Site entry test',
    runtime: { id: '@dfosco/statefully', version: '0.2.1' },
    entry: 'src/index.html',
    views: [{ id: 'home', title: 'Home', path: '/' }],
  }))
  write(root, 'SiteEntry.prototype/src/index.html', '<!doctype html><html><body><div id="root"></div><script type="module" src="./main.jsx"></script></body></html>')
  write(root, 'SiteEntry.prototype/src/main.jsx', `
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import { SiteView } from 'design-notebook/sites'
    createRoot(document.getElementById('root')).render(React.createElement(SiteView, {
      artifactId: 'external-catalog', viewId: 'home', mode: import.meta.env.PROD ? 'static' : 'local',
      resolveArtifact: () => ({ available: false }),
      resolveAsset: () => null,
    }))
  `)
  write(root, 'SiteEntry.prototype/state/default.flow.json', JSON.stringify({}))
}

test('descriptor-only example Site is discoverable and resolves its supplied screenshot without Site source code', async () => {
  const root = new URL('../../examples/first-look/notebook/', import.meta.url).pathname
  const graph = discoverNotebook(root)
  const site = graph.artifacts.find(item => item.id === 'existing-catalog')
  assert.equal(site.kind, 'site')
  assert.equal(site.available, true)
  assert.equal(site.views[0].screenshot, 'assets/catalog-home.svg')
  assert.deepEqual(await readdir(new URL(`../../examples/first-look/notebook/${site.folderPath}/`, import.meta.url)), [
    'assets', 'catalog.site.json',
  ])

  const server = await createServer({
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    plugins: [react()],
    server: { middlewareMode: true },
  })
  try {
    const { SiteView } = await server.ssrLoadModule('/src/client/sites/index.js')
    const resolvedAssets = []
    const markup = renderToStaticMarkup(React.createElement(SiteView, {
      artifactId: site.id,
      viewId: site.views[0].id,
      artifacts: graph.artifacts,
      mode: 'static',
      resolveArtifact: reference => reference === site.id ? { ...site, descriptor: site.descriptor } : null,
      resolveAsset: (reference, context) => {
        resolvedAssets.push({ reference, basePath: context.basePath, mode: context.mode })
        return `/published/${context.basePath}/${reference}`
      },
    }))
    assert.deepEqual(resolvedAssets, [{
      reference: 'assets/catalog-home.svg',
      basePath: site.folderPath,
      mode: 'static',
    }])
    assert.match(markup, /data-site-artifact-id="existing-catalog"/)
  } finally {
    await server.close()
  }
})

test('Site screenshot resolution uses the real runtime resolver for a nested descriptor-only artifact', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-notebook-sites-runtime-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  write(root, 'groups/research/catalog.site/catalog.site.json', JSON.stringify({
    formatVersion: 1,
    id: 'nested-catalog',
    title: 'Nested catalog',
    published: { url: 'https://catalog.example/' },
    views: [{ id: 'home', title: 'Home', path: '/', screenshot: 'assets/home.svg' }],
  }))
  write(root, 'groups/research/catalog.site/assets/home.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>')
  const runtime = await createNotebookRuntime({ root, base: '/preview/' })
  t.after(() => runtime.close())

  const materialized = materializeCanvas(JSON.stringify({
    event: 'canvas_created', formatVersion: 1, canvasId: 'runtime-site-asset',
    widgets: [{ id: 'catalog', type: 'site', props: { artifactId: 'nested-catalog', viewId: 'home' } }],
  }), {
    mode: 'static',
    resolveArtifact: runtime.resolveArtifact,
    resolveAsset: runtime.resolveAsset,
  })
  assert.equal(materialized.scene.items[0].src, '/preview/groups/research/catalog.site/assets/home.svg')
  assert.equal(materialized.scene.items[0].href, 'https://catalog.example/')
  assert.ok(!materialized.diagnostics.some(item => item.code === 'unavailable-site-screenshot'))

  const defaultView = materializeCanvas(JSON.stringify({
    event: 'canvas_created', formatVersion: 1, canvasId: 'runtime-site-default-view',
    widgets: [{ id: 'catalog', type: 'site', props: { artifactId: 'nested-catalog' } }],
  }), {
    mode: 'static',
    resolveArtifact: runtime.resolveArtifact,
    resolveAsset: runtime.resolveAsset,
  })
  assert.equal(defaultView.scene.items[0].src, '/preview/groups/research/catalog.site/assets/home.svg')
  assert.equal(defaultView.scene.items[0].href, 'https://catalog.example/')
  assert.ok(!defaultView.diagnostics.some(item => item.code === 'unavailable-site-view'))
})

test('SiteView sends the stable artifact and exact view selection through the shared resolver', async () => {
  const server = await createServer({
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    plugins: [react()],
    server: { middlewareMode: true },
  })
  try {
    const { SiteView } = await server.ssrLoadModule('/src/client/sites/index.js')
    const requests = []
    const markup = renderToStaticMarkup(React.createElement(SiteView, {
      artifactId: 'catalog-stable-id',
      viewId: 'home-screen',
      mode: 'static',
      artifacts: [{ id: 'catalog-stable-id', kind: 'site' }],
      resolveArtifact(reference, context) {
        requests.push({ reference, kind: context.kind, viewId: context.viewId, mode: context.mode })
        return { available: true, id: reference, descriptor: {
          published: { url: 'https://catalog.example/' },
          views: [{ id: 'home-screen', path: '/books?sort=title#results', screenshot: 'assets/home.png' }],
        } }
      },
      resolveAsset(reference, context) {
        requests.push({ reference, purpose: context.purpose, mode: context.mode })
        return { available: true, url: '/published/catalog.site/assets/home.png' }
      },
    }))
    assert.deepEqual(requests, [
      { reference: 'catalog-stable-id', kind: 'site', viewId: 'home-screen', mode: 'static' },
      { reference: 'assets/home.png', purpose: 'site-screenshot', mode: 'static' },
    ])
    assert.match(markup, /data-site-artifact-id="catalog-stable-id"/)
    assert.match(markup, /data-site-view-id="home-screen"/)
    assert.match(markup, /data-render-mode="static"/)
    assert.match(markup, /Resolving Site view/)
  } finally {
    await server.close()
  }
})

test('SiteView requires an explicit discovered Site artifact ID', async () => {
  const server = await createServer({
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    plugins: [react()],
    server: { middlewareMode: true },
  })
  try {
    const { SiteView } = await server.ssrLoadModule('/src/client/sites/index.js')
    const markup = renderToStaticMarkup(React.createElement(SiteView, { artifactId: '  ' }))
    assert.match(markup, /SiteView requires a discovered Site artifact ID/)
  } finally {
    await server.close()
  }
})

test('runtime package alias resolves SiteView in local dev and static prototype builds', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-notebook-sites-export-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  addSiteViewPrototype(root)

  const runtime = await createNotebookRuntime({ root, host: '127.0.0.1', port: 0 })
  t.after(() => runtime.close())
  await runtime.start()
  const page = await fetch(`${runtime.address}/__notebook/prototypes/site-entry/`)
  assert.equal(page.status, 200)
  const entry = await fetch(`${runtime.address}/SiteEntry.prototype/src/main.jsx`)
  assert.equal(entry.status, 200)
  const entryModule = await entry.text()
  assert.match(entryModule, /SiteView/)
  const siteModulePath = entryModule.match(/from "([^"]*\/src\/client\/sites\/index\.js)"/)
  assert.ok(siteModulePath, 'the package import should resolve to the shared SiteView entry')
  const siteModule = await fetch(new URL(siteModulePath[1], runtime.address))
  assert.equal(siteModule.status, 200)
  assert.match(await siteModule.text(), /canvas-renderer/)

  const output = path.join(root, 'dist')
  const built = await buildNotebook({ root, outDir: 'dist', base: '/preview/' })
  assert.equal(built.diagnostics.length, 0)
  assert.equal(built.prototypes.length, 1)
  assert.deepEqual(built.prototypes[0].diagnostics, undefined)
  const files = fs.readdirSync(path.join(output, 'prototypes/site-entry/assets'))
  const bundle = files.map(file => fs.readFileSync(path.join(output, 'prototypes/site-entry/assets', file), 'utf8')).join('\n')
  assert.match(bundle, /Site screenshot is unavailable/)
  assert.match(bundle, /canvas-scene__site-frame/)
})
