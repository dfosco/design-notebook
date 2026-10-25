import assert from 'node:assert/strict'
import test from 'node:test'

import { compareStylesheets } from './css-semantic-compare.mjs'

const packagedLike = `@layer ds-base;
@layer ds-utilities {
  .ds-flex { display: flex; }
  .ds-hidden { display: none; }
}
@media (min-width: 40em) {
  .ds-hover\\:bg-muted:hover { --ds-tw-bg-muted: 1; background-color: var(--ds-tw-bg-muted); }
}
@property --ds-tw-bg-muted {
  syntax: "<length>";
  inherits: false;
  initial-value: 8px;
}
@keyframes ds-pulse {
  50% { opacity: .5; }
}
.ds-animate-pulse { animation: var(--ds-tw-animate-pulse, 2s ds-pulse infinite); }
`

test('root-level traversal indexes rules, layered sections and nested at-rule contexts', () => {
  const report = compareStylesheets({ candidateCss: packagedLike, packagedCss: packagedLike })
  assert.ok(report.candidate.ruleCount > 0, 'rules must be indexed from the stylesheet root')
  assert.ok(report.packaged.atRuleCount >= 3, 'blockless layer entry, @property and @keyframes must be indexed')
  assert.ok(report.candidate.properties.includes('--ds-tw-bg-muted'))
})

test('identical declaration content in different formatting and order is equivalent modulo formatting', () => {
  // At-rule params are compared as exact-trimmed source text, so the
  // minified fixture keeps the `@media` parameter's internal spacing; value
  // and param spacing differences are covered by negative cases below.
  const minified = '@layer ds-base;@layer ds-utilities{.ds-flex{display:flex}.ds-hidden{display:none}}@media (min-width: 40em){.ds-hover\\:bg-muted:hover{--ds-tw-bg-muted:1;background-color:var(--ds-tw-bg-muted)}}@property --ds-tw-bg-muted{syntax:"<length>";inherits:false;initial-value:8px}@keyframes ds-pulse{50%{opacity:.5}}.ds-animate-pulse{animation:var(--ds-tw-animate-pulse, 2s ds-pulse infinite)}'
  const reordered = `${packagedLike.split('@layer ds-utilities {\n  .ds-flex { display: flex; }\n  .ds-hidden { display: none; }\n}\n').join('')}@layer ds-utilities {\n  .ds-hidden { display: none; }\n  .ds-flex { display: flex; }\n}\n`
  const report = compareStylesheets({ packagedCss: minified, candidateCss: reordered })
  assert.equal(report.verdict, 'packaged-superset')
  assert.equal(report.declarations.candidateOnly.count, 0)
  assert.equal(report.declarations.packagedOnly.count, 0)
  assert.equal(report.valueCensus.onlyInCandidate, 0)
})

test('candidate-only declarations are a regression with reviewable entries', () => {
  const candidate = `${packagedLike}\n.ds-new-utility { padding-top: 0.25rem; }`
  const report = compareStylesheets({ candidateCss: candidate, packagedCss: packagedLike })
  assert.equal(report.verdict, 'regressed')
  const entries = report.declarations.candidateOnly.entries.find(entry => entry.selectorContext.startsWith('.ds-new-utility'))
  assert.ok(entries)
  assert.ok(entries.declarations.includes('padding-top: 0.25rem'))
})

test('packaged-only content is categorized separately as the expected first-look superset', () => {
  const candidate = packagedLike.split('.ds-hidden { display: none; }').join('')
  const report = compareStylesheets({ candidateCss: candidate, packagedCss: packagedLike })
  assert.equal(report.verdict, 'packaged-superset')
  const missing = report.declarations.packagedOnly.entries.find(entry => entry.selectorContext.startsWith('.ds-hidden'))
  assert.ok(missing?.declarations.includes('display: none'))
  assert.equal(report.declarations.candidateOnly.count, 0)
})

test('media context differences surface as candidate-only under their at-rule context', () => {
  const candidate = packagedLike.replace('min-width: 40em', 'min-width: 48em')
  const report = compareStylesheets({ candidateCss: candidate, packagedCss: packagedLike })
  assert.equal(report.verdict, 'regressed')
  const contextEntry = report.declarations.candidateOnly.entries.find(entry => entry.selectorContext.includes('@media (min-width: 48em)'))
  assert.ok(contextEntry, 'changed media context must appear as candidate-only declarations')
  assert.ok(report.declarations.packagedOnly.entries.some(entry => entry.selectorContext.includes('@media (min-width: 40em)')))
})

test('changed @property and @keyframes values are semantic regressions, not at-rule presence only', () => {
  const changedProperty = packagedLike.replace('initial-value: 8px;', 'initial-value: 12px;')
  const propertyReport = compareStylesheets({ candidateCss: changedProperty, packagedCss: packagedLike })
  assert.equal(propertyReport.verdict, 'regressed', 'a changed @property initial-value must fail closed')
  assert.ok(propertyReport.atRules.sharedValueDiff.entries.some(entry =>
    entry.atRule === '@property --ds-tw-bg-muted' && entry.candidateOnlyDeclarations.includes('initial-value: 12px')))

  const changedKeyframe = packagedLike.replace('opacity: .5;', 'opacity: .75;')
  const keyframeReport = compareStylesheets({ candidateCss: changedKeyframe, packagedCss: packagedLike })
  assert.equal(keyframeReport.verdict, 'regressed', 'a changed keyframe step value must fail closed')
  assert.ok(keyframeReport.atRules.sharedValueDiff.entries.some(entry =>
    entry.atRule === '@keyframes ds-pulse' && entry.candidateOnlyDeclarations.includes('50%: opacity: .75')))
})

test('an added candidate !important marker changes cascade semantics and is reported', () => {
  const candidate = packagedLike.replace('display: flex;', 'display: flex !important;')
  const report = compareStylesheets({ candidateCss: candidate, packagedCss: packagedLike })
  assert.equal(report.verdict, 'regressed')
  assert.ok(report.declarations.candidateOnly.entries.some(entry =>
    entry.declarations.includes('display: flex !important')))
})

test('compressed argument spacing in values is surfaced as review drift, not silently equated', () => {
  const candidate = packagedLike.replace(
    'animation: var(--ds-tw-animate-pulse, 2s ds-pulse infinite);',
    'animation: var(--ds-tw-animate-pulse,2s ds-pulse infinite);')
  const report = compareStylesheets({ candidateCss: candidate, packagedCss: packagedLike })
  assert.equal(report.verdict, 'regressed')
  assert.ok(report.declarations.candidateOnly.entries.some(entry =>
    entry.declarations.includes('animation: var(--ds-tw-animate-pulse,2s ds-pulse infinite)')))
})

test('same-selector conflicting duplicate declarations make the verdict inconclusive', () => {
  // A candidate-only new value for a conflicted property is still a
  // regression first; the conflict is additionally surfaced.
  const candidate = `${packagedLike}\n.ds-flex { display: grid; }`
  const report = compareStylesheets({ candidateCss: candidate, packagedCss: packagedLike })
  assert.equal(report.verdict, 'regressed')
  assert.ok(report.declarations.candidateOnly.entries.some(entry => entry.declarations.includes('display: grid')))

  // Identical content containing same-selector conflicting duplicates in
  // order-dependent positions cannot establish what applies on either side:
  // fail closed to inconclusive rather than claiming the compare passed.
  const ambiguous = `${packagedLike}\n.ds-vs-ordering { flex-direction: row; flex-direction: column; }`
  const ambiguousReport = compareStylesheets({ candidateCss: ambiguous, packagedCss: ambiguous })
  assert.equal(ambiguousReport.verdict, 'inconclusive')
  assert.ok(ambiguousReport.candidateConflicts.some(conflict =>
    conflict.values.includes('flex-direction: column') && conflict.values.includes('flex-direction: row')))
})

test('whitespace inside quoted declaration values is significant, not silently equated', () => {
  const packaged = `${packagedLike}\n.ds-label { content: "a b"; }`
  const candidate = `${packagedLike}\n.ds-label { content: "a  b"; }`
  const report = compareStylesheets({ candidateCss: candidate, packagedCss: packaged })
  assert.equal(report.verdict, 'regressed', 'string-internal whitespace must surface as drift, never as a false pass')
  assert.ok(report.declarations.candidateOnly.entries.some(entry => entry.declarations.includes('content: "a  b"')))
  assert.ok(report.declarations.packagedOnly.entries.some(entry => entry.declarations.includes('content: "a b"')))
})

test('quoted at-rule parameters with different internal whitespace are surfaced, not equated', () => {
  const packaged = `${packagedLike}\n@tier "alpha b";\n`
  const candidate = `${packagedLike}\n@tier "alpha  b";\n`
  const report = compareStylesheets({ candidateCss: candidate, packagedCss: packaged })
  assert.equal(report.verdict, 'regressed')
  assert.ok(report.atRules.candidateOnly.entries.some(entry => entry.atRule === '@tier "alpha  b"'))
  assert.ok(report.packaged.atRuleCount > 0)
  assert.ok(report.atRules.packagedOnly.entries.some(entry => entry.atRule === '@tier "alpha b"'))
})

test('grammar-sensitive at-rule spacing such as calc() terms is significant, not normalized away', () => {
  const candidate = `${packagedLike}\n@media (min-width: calc(100% - 1rem)) {\n  .ds-gap { margin: 0; }\n}\n`
  const report = compareStylesheets({ candidateCss: candidate, packagedCss: `${packagedLike}\n@media (min-width: calc(100%-1rem)) {\n  .ds-gap { margin: 0; }\n}\n` })
  assert.equal(report.verdict, 'regressed', 'missing spaces around the subtraction operator change the parsed term')
  assert.ok(report.declarations.candidateOnly.entries.some(entry =>
    entry.selectorContext.includes('@media (min-width: calc(100% - 1rem))')))
  assert.ok(report.declarations.packagedOnly.entries.some(entry =>
    entry.selectorContext.includes('@media (min-width: calc(100%-1rem))')))
})

test('a property registered only through @property appears in the candidate property summary', () => {
  const candidate = `${packagedLike}\n@property --ds-only-candidate {\n  syntax: "<color>";\n  inherits: true;\n  initial-value: red;\n}\n`
  const report = compareStylesheets({ candidateCss: candidate, packagedCss: packagedLike })
  assert.equal(report.verdict, 'regressed')
  assert.ok(report.atRules.candidateOnly.entries.some(entry => entry.atRule === '@property --ds-only-candidate'))
  assert.ok(report.candidate.properties.includes('--ds-only-candidate'), 'registered property names must be summarized')
  assert.ok(!report.packaged.properties.includes('--ds-only-candidate'))
})

test('whitespace inside quoted selector attribute values is significant, not silently equated', () => {
  const packaged = `${packagedLike}\n[data-label="a b"] { color: red; }\n`
  const candidate = `${packagedLike}\n[data-label="a  b"] { color: red; }\n`
  const report = compareStylesheets({ candidateCss: candidate, packagedCss: packaged })
  assert.equal(report.verdict, 'regressed', 'quoted attribute selectors can match different elements; drift must surface')
  assert.ok(report.declarations.candidateOnly.entries.some(entry =>
    entry.selectorContext.startsWith('[data-label="a  b"]')))
  assert.ok(report.declarations.packagedOnly.entries.some(entry =>
    entry.selectorContext.startsWith('[data-label="a b"]')))
})

test('conflicting duplicate declarations within one candidate keyframe step fail closed, not set-equated', () => {
  // Reversing the duplicate order inside one step keeps the same declaration
  // set, so set comparison alone would call the sides identical; the effective
  // keyframe value is order-dependent and must be surfaced.
  const packaged = packagedLike.replace(
    '@keyframes ds-pulse {\n  50% { opacity: .5; }\n}',
    '@keyframes ds-pulse {\n  50% { opacity: .75; opacity: .5; }\n}')
  const candidate = packagedLike.replace(
    '@keyframes ds-pulse {\n  50% { opacity: .5; }\n}',
    '@keyframes ds-pulse {\n  50% { opacity: .5; opacity: .75; }\n}')
  const report = compareStylesheets({ candidateCss: candidate, packagedCss: packaged })
  assert.equal(report.verdict, 'inconclusive')
  const conflict = report.candidateConflicts.find(entry =>
    entry.where.includes('@keyframes ds-pulse') &&
    entry.values.includes('opacity: .5') && entry.values.includes('opacity: .75'))
  assert.ok(conflict, 'the reversed duplicate keyframe property must be reported as an unestablished-order conflict')
})

test('generic declaration-bearing at-rules such as @font-face yield review entries and fail closed, not a throw', () => {
  const fontFace = `${packagedLike}\n@font-face {\n  font-family: "DS Prototype";\n  src: url("/fonts/ds.woff2") format("woff2");\n}\n`
  const report = compareStylesheets({ candidateCss: fontFace, packagedCss: fontFace })
  assert.equal(report.verdict, 'inconclusive', 'unindexed at-rule bodies must fail closed rather than claim a pass or throw')
  assert.ok(report.candidateReviewEntries.some(entry =>
    entry.atRuleContext.includes('@font-face') && entry.declaration === 'font-family: "DS Prototype"'),
  'each @font-face declaration must be listed with its at-rule context for direct review')
})
