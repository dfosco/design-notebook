import assert from 'node:assert/strict'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'

const root = path.resolve(import.meta.dirname, '../..')
const screenshotSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#dbeafe"/><text x="32" y="80" font-size="32">Reference screenshot</text></svg>'
const playwrightModule = process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href
  : 'playwright'
const { chromium } = await import(playwrightModule)
const chrome = process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const externalSite = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://site.invalid')
  if (url.pathname === '/ready') {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end('<!doctype html><title>Reachable external site</title><main id="site-ready">Catalog is available</main>')
    return
  }
  if (url.pathname === '/blocked') {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.setHeader('content-security-policy', "frame-ancestors 'none'")
    response.end('<!doctype html><title>Blocked external site</title><main>This page refuses iframe embedding.</main>')
    return
  }
  response.statusCode = 404
  response.end('missing external view')
})

let vite
let browser
try {
  await new Promise((resolve, reject) => {
    externalSite.once('error', reject)
    externalSite.listen(0, '127.0.0.1', resolve)
  })
  const siteOrigin = `http://127.0.0.1:${externalSite.address().port}`
  const plugin = {
    name: 'site-browser-proof-fixture',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://notebook.invalid').pathname
        if (pathname === '/__sites-proof__/') {
          const source = await readFile(path.join(root, 'tests/sites/browser-proof-entry.html'), 'utf8')
          const html = await server.transformIndexHtml(request.url, source.replace('__SITE_PROOF_ORIGIN__', siteOrigin))
          response.setHeader('content-type', 'text/html; charset=utf-8')
          response.end(html)
          return
        }
        if (pathname === '/__sites-proof__/home.svg' || pathname === '/preview/research/catalog.site/assets/home.svg') {
          response.setHeader('content-type', 'image/svg+xml')
          response.end(screenshotSvg)
          return
        }
        next()
      })
    },
  }
  vite = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    plugins: [plugin, react()],
    resolve: { alias: { 'design-notebook/sites': path.join(root, 'src/client/sites/index.js') } },
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    optimizeDeps: { include: ['react', 'react-dom/client'] },
  })
  await vite.listen()
  const notebookOrigin = `http://127.0.0.1:${vite.httpServer.address().port}`
  browser = await chromium.launch({
    headless: true,
    executablePath: chrome,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-extensions', '--no-first-run'],
  })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await page.goto(`${notebookOrigin}/__sites-proof__/`, { waitUntil: 'domcontentloaded', timeout: 10000 })
  await page.waitForFunction(() => document.querySelectorAll('.site-view .canvas-scene').length === 3, undefined, { timeout: 10000 })
  await page.locator('[data-proof="local-reachable"] .canvas-scene__site-screenshot-fallback summary').click()
  await page.locator('[data-proof="local-blocked"] .canvas-scene__site-screenshot-fallback summary').click()

  const reachableLink = await page.locator('[data-proof="local-reachable"] .canvas-scene__site-link').getAttribute('href')
  assert.equal(reachableLink, `${siteOrigin}/ready?source=direct#home`)
  await page.frameLocator('[data-proof="local-reachable"] iframe').locator('#site-ready').waitFor({ state: 'visible', timeout: 5000 })
  assert.equal(await page.frameLocator('[data-proof="local-reachable"] iframe').locator('#site-ready').textContent(), 'Catalog is available')
  const response = await fetch(reachableLink)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /Catalog is available/)

  const observations = []
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    const screenshotChecks = {}
    for (const [key, selector] of Object.entries({
      local: '[data-proof="local-reachable"] .canvas-scene__site-screenshot-fallback img',
      blocked: '[data-proof="local-blocked"] .canvas-scene__site-screenshot-fallback img',
      static: '[data-proof="static"] .canvas-scene__site > img',
    })) {
      const image = page.locator(selector)
      await image.scrollIntoViewIfNeeded()
      await image.evaluate(node => node.decode())
      screenshotChecks[key] = await image.evaluate(node => {
        const bounds = node.getBoundingClientRect()
        const details = node.closest('details')
        const clip = details?.getBoundingClientRect() ?? bounds
        const visibleTop = Math.max(bounds.top, clip.top, 0)
        const visibleBottom = Math.min(bounds.bottom, clip.bottom, innerHeight)
        return {
          naturalWidth: node.naturalWidth,
          width: bounds.width,
          visibleHeight: Math.max(0, visibleBottom - visibleTop),
          expanded: details?.open ?? false,
        }
      })
    }
    for (const selector of [
      '[data-proof="local-reachable"] .canvas-scene__site-link',
      '[data-proof="local-blocked"] .canvas-scene__site-link',
      '[data-proof="static"] .canvas-scene__site-link',
    ]) await page.locator(selector).click({ trial: true })
    observations.push(await page.evaluate(() => {
      const inspect = selector => {
        const section = document.querySelector(selector)
        const view = section.querySelector('.site-view')
        const frame = section.querySelector('iframe')
        const screenshot = section.querySelector('.canvas-scene__site-screenshot-fallback img, .canvas-scene__site > img')
        const link = section.querySelector('.canvas-scene__site-link')
        const visible = node => {
          if (!node) return false
          const rect = node.getBoundingClientRect()
          const style = getComputedStyle(node)
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
        }
        return {
          width: Math.round(view.getBoundingClientRect().width),
          frameCount: section.querySelectorAll('iframe').length,
          frameUrl: frame?.src ?? null,
          linkVisible: visible(link),
          fallbackLabel: section.querySelector('.canvas-scene__site-screenshot-fallback summary')?.textContent ?? null,
          link: link?.href ?? null,
        }
      }
      return {
        viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        local: inspect('[data-proof="local-reachable"]'),
        blocked: inspect('[data-proof="local-blocked"]'),
        static: inspect('[data-proof="static"]'),
        screenshots: null,
      }
    }))
    observations.at(-1).screenshots = screenshotChecks
  }
  for (const item of observations) {
    assert.ok(item.documentWidth <= item.viewport, `document overflow at ${item.viewport}px`)
    assert.ok(item.bodyWidth <= item.viewport, `body overflow at ${item.viewport}px`)
    assert.equal(item.local.frameCount, 1)
    assert.equal(item.local.frameUrl, `${siteOrigin}/ready?source=direct#home`)
    assert.equal(item.screenshots.local.naturalWidth, 640)
    assert.ok(item.screenshots.local.visibleHeight > 0, `local screenshot is clipped at ${item.viewport}px`)
    assert.equal(item.screenshots.local.expanded, true)
    assert.equal(item.local.linkVisible, true)
    assert.match(item.blocked.fallbackLabel, /may be blocked or unavailable/)
    assert.equal(item.blocked.link, `${siteOrigin}/blocked?source=direct#blocked`)
    assert.equal(item.screenshots.blocked.naturalWidth, 640)
    assert.ok(item.screenshots.blocked.visibleHeight > 0, `blocked screenshot is clipped at ${item.viewport}px`)
    assert.equal(item.screenshots.blocked.expanded, true)
    assert.equal(item.blocked.linkVisible, true)
    assert.equal(item.static.frameCount, 0)
    assert.equal(item.screenshots.static.naturalWidth, 640)
    assert.ok(item.screenshots.static.visibleHeight > 0, `static screenshot is clipped at ${item.viewport}px`)
    assert.equal(item.static.link, 'https://published.example/catalog/home?source=direct#top')
  }
  assert.ok(consoleErrors.some(message => /Refused to frame|frame-ancestors/i.test(message)), 'the fixture should demonstrate a site that rejects embedding')
  assert.deepEqual(pageErrors, [])
  console.log(JSON.stringify({ browser: 'Chrome', pageErrors, consoleErrors, observations }, null, 2))
} finally {
  if (browser) await browser.close()
  if (vite) {
    vite.httpServer?.closeAllConnections?.()
    await vite.close()
  }
  externalSite.closeAllConnections?.()
  await new Promise(resolve => externalSite.close(resolve))
}
