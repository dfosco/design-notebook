import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { compileDocument } from '../../src/core/docs/index.js'

const root = path.resolve(import.meta.dirname, '../..')
const playwrightModule = process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href
  : 'playwright'
const { chromium } = await import(playwrightModule)
const chrome = process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const source = `---
formatVersion: 1
id: browser-width-proof
title: Browser width proof
references: [proof-prototype, proof-site]
---
import { Prototype, Site, Image } from 'design-notebook/docs'

# First prose block

The prototype view stays between authored prose blocks.

<Prototype artifactId="proof-prototype" viewId="overview" />

The site view and image follow in source order.

<Site artifactId="proof-site" viewId="home" />

<Image src="diagram.svg" alt="Proof diagram" />
`
const discoveryArtifacts = [
  { id: 'proof-prototype', kind: 'prototype', available: true },
  { id: 'proof-site', kind: 'site', available: true },
]
const compiled = await compileDocument(source, { artifacts: discoveryArtifacts, mode: 'static' })
assert.equal(compiled.available, true, JSON.stringify(compiled.diagnostics))

const proofPlugin = {
  name: 'docs-browser-proof-fixture',
  resolveId(id) {
    if (id === 'virtual:docs-browser-proof') return '\0virtual:docs-browser-proof'
    return undefined
  },
  load(id) {
    if (id === '\0virtual:docs-browser-proof') return compiled.compiledSource
    return undefined
  },
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const pathname = new URL(request.url, 'http://localhost').pathname
      if (pathname === '/__docs-proof__/') {
        const entry = await readFile(path.join(root, 'tests/docs/browser-proof-entry.html'), 'utf8')
        const html = await server.transformIndexHtml('/__docs-proof__/', entry)
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.end(html)
        return
      }
      if (pathname === '/__docs-proof__/prototype.html') {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.end('<!doctype html><title>Prototype fixture</title><main>Prototype loaded</main>')
        return
      }
      if (pathname === '/__docs-proof__/site.svg') {
        response.setHeader('content-type', 'image/svg+xml')
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect width="48" height="32" fill="green"/></svg>')
        return
      }
      next()
    })
  },
}

const server = await createServer({
  root,
  configFile: false,
  appType: 'custom',
  logLevel: 'silent',
  plugins: [proofPlugin, react()],
  resolve: { alias: { 'design-notebook/docs': path.join(root, 'src/client/docs/index.js') } },
  server: { host: '127.0.0.1', port: 0, strictPort: false },
  optimizeDeps: { include: ['react', 'react-dom/client'] },
})
let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  const origin = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch({
    headless: true,
    executablePath: chrome,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-extensions', '--no-first-run'],
  })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(`${origin}/__docs-proof__/`, { waitUntil: 'domcontentloaded', timeout: 10000 })
  try {
    await page.waitForFunction(() => document.querySelectorAll('.doc-widget__canvas .canvas-scene').length === 3, undefined, { timeout: 10000 })
  } catch (error) {
    console.error(JSON.stringify({ pageErrors, html: await page.content() }, null, 2))
    throw error
  }
  await page.waitForFunction(() => {
    const site = document.querySelector('.doc-widget[data-widget-type="site"]')
    return site?.querySelector('.canvas-scene__site--static img') && site.querySelectorAll('iframe').length === 0
  }, undefined, { timeout: 5000 })
  assert.equal(await page.locator('.doc-widget[data-widget-type="site"] details').count(), 0, 'Static Site embeds show a screenshot and deployed link without a local iframe or disclosure.')
  await page.waitForFunction(() => [...document.querySelectorAll('.doc-widget img')].every(image => image.complete && image.naturalWidth > 0), undefined, { timeout: 5000 })
  await page.waitForFunction(() => [...document.querySelectorAll('.canvas-scene__frame, .canvas-scene__site-link')].every(node => node.tagName === 'IFRAME' ? node.src : node.href), undefined, { timeout: 5000 })

  const observations = []
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForFunction(() => [...document.querySelectorAll('.doc-widget__canvas .canvas-scene')].every(scene => Math.round(scene.getBoundingClientRect().width) === Math.round(scene.parentElement.clientWidth)), undefined, { timeout: 5000 })
    observations.push(await page.evaluate(() => {
      const article = document.querySelector('.doc-renderer')
      const widgets = [...article.querySelectorAll(':scope > .doc-widget')]
      return {
        viewportWidth: window.innerWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        articleClientWidth: article.clientWidth,
        articleScrollWidth: article.scrollWidth,
        childOrder: [...article.children].map(node => node.matches('.doc-widget') ? node.dataset.widgetType : node.tagName.toLowerCase()),
        widgetWidths: widgets.map(widget => ({ container: widget.clientWidth, scene: Math.round(widget.querySelector('.canvas-scene').getBoundingClientRect().width) })),
        imageWidths: [...article.querySelectorAll('img')].map(image => image.naturalWidth),
        prototypeUrls: [...article.querySelectorAll('.canvas-scene__frame')].map(frame => frame.src),
        siteUrls: [...article.querySelectorAll('.canvas-scene__site-link')].map(link => link.href),
        screenshotUrls: [...article.querySelectorAll('.canvas-scene__image img')].map(image => image.src),
      }
    }))
  }
  for (const item of observations) {
    assert.ok(item.documentScrollWidth <= item.viewportWidth, `document overflow at ${item.viewportWidth}px`)
    assert.ok(item.bodyScrollWidth <= item.viewportWidth, `body overflow at ${item.viewportWidth}px`)
    assert.ok(item.articleScrollWidth <= item.articleClientWidth, `article overflow at ${item.viewportWidth}px`)
    assert.deepEqual(item.childOrder.filter(value => ['prototype', 'site', 'image'].includes(value)), ['prototype', 'site', 'image'])
    assert.ok(item.widgetWidths.every(value => value.scene === value.container), `widget did not fill its width at ${item.viewportWidth}px`)
    assert.ok(item.imageWidths.every(value => value > 0))
    assert.ok(item.prototypeUrls.every(url => url === `${origin}/__docs-proof__/prototype.html`))
    assert.ok(item.siteUrls.every(url => url === 'https://example.test/preview/home?tab=one#top'))
    assert.ok(item.screenshotUrls.every(url => url === `${origin}/__docs-proof__/site.svg`))
  }
  assert.equal(observations[1].widgetWidths[0].scene, 1440)
  await page.evaluate(() => window.renderDocsMode('local'))
  await page.waitForFunction(() => document.querySelectorAll('.doc-widget__canvas .canvas-scene').length === 3, undefined, { timeout: 5000 })
  await page.waitForFunction(() => {
    const site = document.querySelector('.doc-widget[data-widget-type="site"]')
    return site?.querySelector('.canvas-scene__site--local iframe') && site.querySelector('.canvas-scene__site-screenshot-fallback summary')
  }, undefined, { timeout: 5000 })
  const localUrls = await page.evaluate(() => ({
    prototype: document.querySelector('.canvas-scene__frame')?.src,
    siteFrame: document.querySelector('.doc-widget[data-widget-type="site"] .canvas-scene__site-frame')?.src,
    site: document.querySelector('.canvas-scene__site-link')?.href,
    siteScreenshot: document.querySelector('.doc-widget[data-widget-type="site"] .canvas-scene__site img')?.src,
    screenshot: document.querySelector('.canvas-scene__image img')?.src,
  }))
  assert.deepEqual(localUrls, {
    prototype: `${origin}/__docs-proof__/prototype.html?mode=local`,
    siteFrame: `${origin}/preview/home?tab=one#top`,
    site: `${origin}/preview/home?tab=one#top`,
    siteScreenshot: `${origin}/__docs-proof__/site.svg`,
    screenshot: `${origin}/__docs-proof__/site.svg`,
  })
  assert.deepEqual(pageErrors, [])
  console.log(JSON.stringify({ browser: 'Chrome', pageErrors, observations, localUrls }, null, 2))
} finally {
  if (browser) await browser.close()
  server.httpServer?.closeAllConnections?.()
  await server.close()
}
