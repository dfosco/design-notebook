import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import { coreSourceFiles, scanCoreCandidates } from '../../src/vendor/hypercanvas/core-css.js'

const packageRoot = fileURLToPath(new URL('../..', import.meta.url))

test('packaged chrome CSS covers every utility in the vendored source closure', () => {
  const sourceFiles = coreSourceFiles(packageRoot)
  const candidates = scanCoreCandidates(sourceFiles.map(file => ({
    content: fs.readFileSync(file, 'utf8'),
    extension: path.extname(file).slice(1),
  })))
  const stylesheetPath = path.join(packageRoot, 'src/vendor/hypercanvas/generated/tailwind.css')
  const stylesheet = postcss.parse(fs.readFileSync(stylesheetPath, 'utf8'), { from: stylesheetPath })
  const emittedClasses = new Set()
  stylesheet.walkRules(rule => {
    selectorParser(selectors => selectors.walkClasses(node => emittedClasses.add(node.value)))
      .processSync(rule.selector)
  })

  // Tailwind's group/name and peer/name classes label ancestors; the compiler
  // consumes them as variant context and does not emit selectors for them.
  const utilities = candidates.filter(candidate =>
    !candidate.startsWith('ds-group/') && !candidate.startsWith('ds-peer/'))
  const missing = utilities.filter(candidate => !emittedClasses.has(candidate))

  assert.ok(sourceFiles.some(file => file.endsWith('/NotebookShell/NotebookChrome.jsx')))
  assert.ok(emittedClasses.has('ds-h-full'))
  assert.deepEqual(missing, [])
})
