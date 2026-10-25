import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { coreSourceFiles, cssInventory, scanCoreCandidates } from '../../src/vendor/hypercanvas/core-css.js'

const root = new URL('../../src/vendor/hypercanvas/', import.meta.url)
const read = relative => readFile(new URL(relative, root), 'utf8')

test('vendored chrome retains pinned upstream component source and records its adapter provenance', async () => {
  const [provenance, sidebar, button, breadcrumb, adapter, license] = await Promise.all([
    read('PROVENANCE.md'),
    read('chrome/ui/sidebar.jsx'),
    read('chrome/ui/button.jsx'),
    read('chrome/ui/breadcrumb.jsx'),
    read('NotebookShell/NotebookChrome.jsx'),
    read('LICENSE'),
  ])

  assert.match(provenance, /bf1b4bc3a3158f90f37600e9e270ab68e6d0bd7f/)
  assert.match(provenance, /SidebarProvider.*Sidebar.*header\/separator\/content\/footer/s)
  assert.match(provenance, /MIT licensed/)
  assert.equal(license.trim(), 'MIT')
  assert.match(sidebar, /function SidebarProvider/)
  assert.match(sidebar, /function Sidebar\(/)
  assert.match(button, /function Button\(/)
  assert.match(breadcrumb, /function Breadcrumb\(/)
  assert.match(adapter, /SidebarProvider/)
  assert.match(adapter, /collapsible: 'none'/)
  assert.match(adapter, /NotebookTopbar/)
  assert.match(adapter, /BreadcrumbPage/)
  assert.match(adapter, /ArrowLeft/)
  assert.match(adapter, /Hide notebook sidebar/)
  assert.doesNotMatch(adapter, /Open in browser/)
})

test('vendored Tailwind pipeline and generated CSS use the isolated ds namespace', async () => {
  const [pipeline, source, generated, helper, components] = await Promise.all([
    read('core-css.js'),
    read('generated/tailwind.source.css'),
    read('generated/tailwind.css'),
    read('classnames.js'),
    Promise.all([
      read('chrome/ui/sidebar.jsx'),
      read('chrome/ui/button.jsx'),
      read('chrome/ui/input.jsx'),
      read('chrome/ui/separator.jsx'),
      read('chrome/ui/sheet.jsx'),
      read('chrome/ui/tooltip.jsx'),
      read('NotebookShell/NotebookChrome.jsx'),
    ]),
  ])

  assert.match(pipeline, /from '@tailwindcss\/node'/)
  assert.match(pipeline, /from '@tailwindcss\/oxide'/)
  assert.match(pipeline, /selectorParser\(/)
  assert.match(pipeline, /nativeCandidate\(candidate\)/)
  assert.match(pipeline, /prefix: 'ds-'/)
  assert.match(source, /prefix\(ds\)/)
  assert.match(source, /ds-utilities/)
  assert.doesNotMatch(source, /@import ["']tailwindcss\/base\.css/)
  assert.match(generated, /\.ds-flex\{/)
  assert.match(generated, /@layer ds-utilities/)
  assert.doesNotMatch(generated, /\.hc-[\w\\:-]+[,{]/)
  assert.doesNotMatch(generated, /--hc-(?:tw|color|font|radius|shadow)-/)
  assert.match(helper, /startsWith\('ds-'\)/)
  assert.doesNotMatch(helper, /startsWith\('hc-'\)/)
  for (const sourceText of components) {
    assert.match(sourceText, /ds-/)
    assert.doesNotMatch(sourceText, /(?<![-\w])hc-[\w*\[]/)
  }
})

test('packaged chrome CSS covers every emitted utility candidate in the vendored source closure', async () => {
  const files = coreSourceFiles()
  const candidates = scanCoreCandidates(await Promise.all(files.map(async file => ({
    content: await readFile(file, 'utf8'),
    extension: file.split('.').pop(),
  }))))
  const generated = await read('generated/tailwind.css')
  const emittedClasses = new Set(cssInventory(generated).classes)
  // group/name and peer/name are structural variant markers. They appear in
  // selectors produced by their variants, but Tailwind emits no standalone
  // utility selector for the marker itself.
  const structuralMarkers = candidate => /^ds-(?:group|peer)\/[\w-]+$/.test(candidate)
  const missing = candidates.filter(candidate => !structuralMarkers(candidate) && !emittedClasses.has(candidate))

  assert.deepEqual(missing, [])
  assert.ok(emittedClasses.has('ds-h-full'), 'NotebookChrome ds-h-full adapter class is packaged')
  assert.ok(emittedClasses.has('ds-min-h-0'), 'NotebookChrome ds-min-h-0 adapter class is packaged')
})
