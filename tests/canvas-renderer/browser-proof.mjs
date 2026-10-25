import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const playwrightModule = process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href
  : 'playwright'
const { chromium } = await import(playwrightModule)
const chrome = process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const fixture = fs.readFileSync(path.join(root, 'tests/canvas-format/fixtures/valid.jsonl'), 'utf8')
const additionalRecords = [
  { event: 'widget_updated', widgetId: 'site-1', props: { viewId: 'home' } },
  { event: 'widget_added', widget: { id: 'chart-1', type: 'chart', position: { x: -12, y: 640 }, props: { width: 260, height: 140, fallback: { type: 'text', text: '<script>literal fallback</script>' } } } },
].map(record => JSON.stringify(record)).join('\n')
const source = `${fixture.trimEnd()}\n${additionalRecords}\n`
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname === '/') {
    response.setHeader('content-type', 'text/html')
    response.end(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/src/vendor/tiny-canvas/style.css"><main><div id="local"></div><div id="static"></div></main><output id="proof">waiting</output><script type="module">
      import { materializeCanvas } from '/src/canvas-renderer/index.js';
      import { renderScene } from '/src/vendor/tiny-canvas/index.js';
      const source = await (await fetch('/fixture.jsonl')).text();
      const origin = location.origin;
      function resolveArtifact(reference, {kind, mode}) {
        if (kind === 'prototype') {
          const route = mode === 'local' ? '/__notebook/prototypes/' : '/prototypes/';
          return {available:true,title:'Checkout prototype',url:origin+route+encodeURIComponent(reference.replace(/^\\//,''))+'/default/'};
        }
        if (kind === 'site') return {available:true,title:'Marketing',descriptor:{local:{developmentUrl:origin+'/local/sites/marketing/'},published:{url:'https://marketing.example/deploy/'},views:[{id:'home',title:'Home',path:'/campaign?theme=dark',screenshot:'home.png'}]}};
        return null;
      }
      function resolveAsset(value, {purpose}) { return origin+(purpose === 'site-screenshot' ? '/site/shot.svg' : '/canvas/reference.svg'); }
      for (const mode of ['local','static']) {
        const result = materializeCanvas(source,{mode,resolveArtifact,resolveAsset});
        renderScene(document.querySelector('#'+mode),result.scene);
      }
      document.querySelector('#proof').dataset.ready='true';
    </script>`)
  } else if (url.pathname === '/fixture.jsonl') {
    response.setHeader('content-type', 'application/jsonl')
    response.end(source)
  } else if (url.pathname.startsWith('/src/')) {
    const file = path.resolve(root, `.${url.pathname}`)
    if (!file.startsWith(`${root}${path.sep}`)) { response.statusCode=403; response.end(); return }
    response.setHeader('content-type', file.endsWith('.css') ? 'text/css' : 'text/javascript')
    response.end(fs.readFileSync(file))
  } else if (url.pathname.endsWith('.svg')) {
    response.setHeader('content-type', 'image/svg+xml')
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="20"><rect width="32" height="20" fill="green"/></svg>')
  } else if (/^\/(?:__notebook\/)?prototypes\//.test(url.pathname)) {
    response.setHeader('content-type', 'text/html')
    response.end('<!doctype html><main id="module-result">loading</main><script type="module" src="/prototype/main.js"></script>')
  } else if (url.pathname === '/prototype/main.js') {
    response.setHeader('content-type', 'text/javascript')
    response.end("import { result } from './leaf.js'; document.querySelector('#module-result').textContent=result; localStorage.setItem('canvas-proof',result);")
  } else if (url.pathname === '/prototype/leaf.js') {
    response.setHeader('content-type', 'text/javascript')
    response.end("export const result='nested-module-ok';")
  } else {
    response.statusCode = 404
    response.end()
  }
})
let browser
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  browser = await chromium.launch({
    headless: true,
    executablePath: chrome,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-extensions', '--no-first-run'],
  })
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded', timeout: 10000 })
  await page.waitForFunction(() => {
    const frames = [...document.querySelectorAll('.canvas-scene__frame')]
    return document.querySelector('#proof')?.dataset.ready === 'true' && frames.length === 2 && frames.every(frame => frame.contentDocument?.querySelector('#module-result')?.textContent === 'nested-module-ok')
  }, undefined, { timeout: 10000 })
  await page.waitForFunction(() => [...document.querySelectorAll('.canvas-scene__image img,.canvas-scene__site img')].length === 4 && [...document.querySelectorAll('.canvas-scene__image img,.canvas-scene__site img')].every(image => image.complete && image.naturalWidth > 0), undefined, { timeout: 5000 })
  const evidence = await page.evaluate(() => Object.fromEntries(['local', 'static'].map(mode => {
    const root = document.querySelector(`#${mode}`)
    const items = [...root.querySelectorAll('.canvas-scene__item')]
    const frame = root.querySelector('.canvas-scene__frame')
    return [mode, {
      ids: items.map(item => item.dataset.itemId),
      geometry: items.map(item => ({ left: item.style.left, top: item.style.top, width: item.style.width, height: item.style.height })),
      noteText: root.querySelector('[data-item-id="note-1"] .canvas-scene__text')?.textContent,
      imageLoaded: root.querySelector('[data-item-id="image-1"] img')?.naturalWidth > 0,
      prototypeUrl: frame?.src,
      prototypeSandbox: frame?.getAttribute('sandbox'),
      prototypeModule: frame?.contentDocument.querySelector('#module-result')?.textContent,
      prototypeStorage: frame?.contentWindow.localStorage.getItem('canvas-proof'),
      siteScreenshotLoaded: root.querySelector('[data-item-id="site-1"] img')?.naturalWidth > 0,
      siteLink: root.querySelector('.canvas-scene__site-link')?.href,
      fallbackText: root.querySelector('[data-item-id="chart-1"] [role="status"]')?.textContent,
    }]
  })))
  console.log(JSON.stringify({ browser: 'Chrome', fixture: 'tests/canvas-format/fixtures/valid.jsonl plus site-view selection and chart fallback events', pageErrors, ...evidence }, null, 2))
  const expectedIds = ['note-1', 'image-1', 'prototype-1', 'site-1', 'chart-1']
  for (const mode of ['local', 'static']) {
    assert.deepEqual(evidence[mode].ids, expectedIds)
    assert.equal(evidence[mode].geometry[0].left, '10px')
    assert.equal(evidence[mode].geometry[1].left, '440px')
    assert.equal(evidence[mode].geometry[1].top, '60px')
    assert.equal(evidence[mode].geometry[2].left, '920px')
    assert.equal(evidence[mode].geometry[3].left, '1760px')
    assert.equal(evidence[mode].geometry[4].left, '-12px')
    assert.equal(evidence[mode].noteText, 'Updated note')
    assert.equal(evidence[mode].imageLoaded, true)
    assert.equal(evidence[mode].prototypeModule, 'nested-module-ok')
    assert.equal(evidence[mode].prototypeStorage, 'nested-module-ok')
    assert.match(evidence[mode].prototypeSandbox, /allow-same-origin/)
    assert.equal(evidence[mode].siteScreenshotLoaded, true)
    assert.match(evidence[mode].fallbackText, /not supported by this canvas viewer/)
    assert.match(evidence[mode].fallbackText, /<script>literal fallback<\/script>/)
  }
  assert.match(evidence.local.prototypeUrl, /\/__notebook\/prototypes\/checkout\/default\/$/)
  assert.match(evidence.static.prototypeUrl, /\/prototypes\/checkout\/default\/$/)
  assert.match(evidence.local.siteLink, /\/campaign\?theme=dark$/)
  assert.equal(evidence.static.siteLink, 'https://marketing.example/campaign?theme=dark')
  assert.deepEqual(pageErrors, [])
} finally {
  if (browser) await browser.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
