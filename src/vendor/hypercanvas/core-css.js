/**
 * Vendored Hypercanvas Tailwind boundary. Tailwind v4 uses a colon prefix
 * internally; this adapter exposes the literal ds-* API at both ends
 * (ds-flex, ds-hover:bg-muted). It scans only this package's vendored chrome.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { compile, optimize, __unstable__loadDesignSystem } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import valueParser from 'postcss-value-parser'

const here = path.dirname(fileURLToPath(import.meta.url))
export const defaultPackageRoot = path.resolve(here, '../../..')
const extensions = /\.(?:[cm]?js|jsx|ts|tsx|html)$/
const excluded = /(?:^|[/\\])(?:node_modules|dist|\.git|__tests__)(?:[/\\]|$)|\.(?:test|spec)\.[^.]+$/

export function coreSourceFiles(packageRoot = defaultPackageRoot, _applicationRoot = packageRoot, { includeStyles = false } = {}) {
  const roots = [path.join(packageRoot, 'src/vendor/hypercanvas')]
  const files = new Set()
  function walk(directory) {
    if (!fs.existsSync(directory)) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (excluded.test(path.relative(packageRoot, file))) continue
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile() && (extensions.test(entry.name) || (includeStyles && entry.name.endsWith('.css')))) files.add(file)
    }
  }
  roots.forEach(walk)
  return [...files].sort()
}

export function nativeCandidate(candidate) {
  return candidate.startsWith('ds-') ? `ds:${candidate.slice(3)}` : candidate
}

// Normalize the authored prefix before lexical scanning as well as compilation.
// Otherwise v4's scanner drops valid child variants such as ds-*:p-2.
export function scanCoreCandidates(files) {
  const scanner = new Scanner({ sources: [] })
  const normalized = files.map(file => ({
    ...file,
    content: file.content.replace(/(^|[\s"'`])ds-/g, '$1ds:'),
  }))
  return scanner.scanFiles(normalized).filter(candidate => candidate.startsWith('ds:'))
    .map(candidate => `ds-${candidate.slice(3)}`)
}

/** Work on CSS ASTs, not string substitutions of escaped class selectors. */
export function isolateCompiledCss(css) {
  const ast = postcss.parse(css)
  const animations = new Map()
  ast.walkAtRules(/keyframes$/, rule => {
    const name = rule.params.trim()
    const renamed = name.startsWith('ds-') ? name : `ds-${name}`
    animations.set(name, renamed)
    rule.params = renamed
  })
  ast.walkRules(rule => {
    rule.selector = selectorParser(selectors => selectors.walkClasses(node => {
      if (node.value.startsWith('ds:')) node.value = `ds-${node.value.slice(3)}`
    })).processSync(rule.selector)
  })
  ast.walkDecls(decl => {
    decl.prop = decl.prop.replace(/^--tw-/, '--ds-tw-')
    decl.value = decl.value.replace(/--tw-/g, '--ds-tw-')
    if (/animation/.test(decl.prop) || /^--ds-animate-/.test(decl.prop)) {
      const value = valueParser(decl.value)
      value.walk(node => {
        if (node.type === 'word' && animations.has(node.value)) node.value = animations.get(node.value)
      })
      decl.value = value.toString()
    }
  })
  ast.walkAtRules(rule => {
    if (rule.name === 'property') rule.params = rule.params.replace(/^--tw-/, '--ds-tw-')
    if (rule.name === 'layer' && (rule.nodes || !rule.params.includes(','))) rule.params = rule.params.split(',').map(name => {
      name = name.trim()
      return name.startsWith('ds-') ? name : `ds-${name}`
    }).join(', ')
  })
  return ast.toString()
}

export function cssInventory(css) {
  const ast = postcss.parse(css)
  const classes = new Set(), variables = new Set(), references = new Set()
  ast.walkRules(rule => {
    selectorParser(selectors => selectors.walkClasses(node => classes.add(node.value))).processSync(rule.selector)
  })
  ast.walkDecls(decl => {
    if (decl.prop.startsWith('--')) variables.add(decl.prop)
    for (const match of decl.value.matchAll(/var\((--[\w-]+)/g)) references.add(match[1])
  })
  ast.walkAtRules('property', rule => variables.add(rule.params))
  return { classes: [...classes].sort(), variables: [...variables].sort(), references: [...references].sort() }
}

export async function compileCoreStyles({
  packageRoot = defaultPackageRoot,
  applicationRoot = path.resolve(packageRoot, '../..'),
  development = false,
  extraCandidates = [],
} = {}) {
  const entry = path.join(packageRoot, 'src/vendor/hypercanvas/generated/tailwind.source.css')
  const dependencies = new Set([entry])
  const input = fs.readFileSync(entry, 'utf8')
  const files = coreSourceFiles(packageRoot, applicationRoot)
  const detected = scanCoreCandidates(files.map(file => ({ content: fs.readFileSync(file, 'utf8'), extension: path.extname(file).slice(1) })))
  const requested = new Set([...detected, ...extraCandidates].filter(candidate => candidate.startsWith('ds-')))
  const candidates = [...requested].map(nativeCandidate)
  if (development) {
    // Keep the full finite utility catalogue in dev, plus all observed variants
    // and arbitrary values. There is intentionally no production safelist here.
    const design = await __unstable__loadDesignSystem(input, { base: path.dirname(entry) })
    candidates.push(...design.getClassList().map(([name]) => `ds:${name}`))
  }
  const builder = await compile(input, {
    base: path.dirname(entry), from: entry, onDependency: file => dependencies.add(file),
  })
  const isolated = isolateCompiledCss(builder.build([...new Set(candidates)].sort()))
  const inventory = cssInventory(isolated)
  // CSS modules and Canvas CSS are runtime consumers too. Detect removed
  // semantic names instead of accepting their var() hard-coded fallbacks.
  const legacyTokens = /var\(\s*(--(?:color-[a-z][\w-]*|shadow-(?:resting|floating)|radius(?:-[\w-]+)?))(?=[\s,)])/g
  const tokens = new Set(inventory.variables)
  for (const file of coreSourceFiles(packageRoot, applicationRoot, { includeStyles: true })) {
    const source = fs.readFileSync(file, 'utf8')
    if (file.endsWith('.css')) {
      for (const [, token] of source.matchAll(legacyTokens)) {
        throw new Error(`Removed Core semantic token ${token} in ${path.relative(packageRoot, file)}; use --ds-* from tailwind.css`)
      }
    }
    for (const [, token] of source.matchAll(/var\((--ds-(?:color|font|shadow|radius|spacing)[\w-]*)/g)) {
      if (!tokens.has(token)) throw new Error(`Undefined vendored chrome CSS token ${token} in ${path.relative(packageRoot, file)}`)
    }
  }
  // Arbitrary variants may refer to a custom descendant class; only emitted
  // Tailwind selectors themselves carry the mandatory namespace.
  const css = development ? isolated : optimize(isolated, { file: entry, minify: true }).code
  return {
    css,
    manifest: {
      schemaVersion: 1, version: JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version, prefix: 'ds-', mode: development ? 'development' : 'production',
      sha256: createHash('sha256').update(css).digest('hex'),
      classes: inventory.classes, variables: inventory.variables,
      sourceFiles: files.map(file => path.relative(packageRoot, file).replaceAll(path.sep, '/')),
    },
    candidates: [...requested],
    dependencies: [...dependencies, ...files],
  }
}

/** Vite serves static vendored chrome CSS in installed apps and watches all vendored chrome sources in dev. */
export default function coreCss(options = {}) {
  const packageRoot = options.packageRoot || defaultPackageRoot
  const sourceEntry = path.join(packageRoot, 'src/vendor/hypercanvas/generated/tailwind.source.css')
  let applicationRoot, development, immutable, server, cached
  const observedCandidates = new Set()
  function owns(file) {
    const relative = path.relative(packageRoot, file)
    return relative.startsWith(`src${path.sep}vendor${path.sep}hypercanvas${path.sep}`)
  }
  async function styles() {
    if (!cached) cached = compileCoreStyles({ packageRoot, applicationRoot, development, extraCandidates: [...observedCandidates] }).then(result => {
      if (development) result.candidates.forEach(candidate => observedCandidates.add(candidate))
      return result
    })
    return cached
  }
  return {
    name: 'design-notebook-vendored-chrome-css', enforce: 'pre',
    configResolved(config) {
      applicationRoot = options.applicationRoot || config.root
      immutable = sourceEntry.split(path.sep).some(part => part === 'node_modules' || part.endsWith('.app'))
        || fs.existsSync(path.join(applicationRoot, '.hypercanvas-shell'))
      development = config.command === 'serve' && !immutable
    },
    async load(id) {
      const file = id.split('?')[0]
      if (path.resolve(file) !== sourceEntry) return null
      if (!development) {
        const staticFile = [path.join(packageRoot, 'src/vendor/hypercanvas/generated/tailwind.css')]
          .find(file => fs.existsSync(file))
        if (staticFile) { this.addWatchFile(staticFile); return fs.readFileSync(staticFile, 'utf8') }
        if (immutable) throw new Error('Packaged vendored chrome stylesheet is missing; rebuild the application rather than JIT-compiling Core at runtime')
      }
      const result = await styles()
      result.dependencies.forEach(file => this.addWatchFile(file))
      return result.css
    },
    configureServer(instance) {
      server = instance
      if (development) server.watcher.add?.([path.join(packageRoot, 'src/vendor/hypercanvas')])
      const update = file => {
        if (!development || !owns(file)) return
        cached = null
        for (const mod of server.moduleGraph.getModulesByFile(sourceEntry) || []) server.moduleGraph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      }
      // New/deleted source files have no module yet, so handleHotUpdate alone
      // would miss their new arbitrary utility candidates.
      server.watcher.on('add', update)
      server.watcher.on('unlink', update)
      server.httpServer?.once('close', () => {
        server.watcher.off('add', update)
        server.watcher.off('unlink', update)
      })
    },
    async handleHotUpdate(context) {
      if (!development || !owns(context.file)) return
      if (extensions.test(context.file) && fs.existsSync(context.file)) {
        scanCoreCandidates([{ content: fs.readFileSync(context.file, 'utf8'), extension: path.extname(context.file).slice(1) }])
          .filter(candidate => candidate.startsWith('ds-')).forEach(candidate => observedCandidates.add(candidate))
      }
      cached = null
      const modules = [...(server.moduleGraph.getModulesByFile(sourceEntry) || [])]
      for (const mod of modules) server.moduleGraph.invalidateModule(mod)
      return [...new Set([...context.modules, ...modules])]
    },
  }
}
