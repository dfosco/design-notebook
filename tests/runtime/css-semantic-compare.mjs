/** Preserve selector source text exactly (outer trim only). Whitespace inside
 * quoted attribute values can change what a selector matches, so internal
 * selector whitespace is never collapsed; formatting-only re-wrapping of
 * selectors surfaces as review drift instead of a false pass. */
function preserveSelectorText(value) {
  return value.trim()
}

/** Preserve at-rule parameter text. Whitespace can affect quoted strings and
 * grammar-sensitive expressions, so differences remain visible for review. */
export function normalizeAtRuleIdentity(name, params) {
  const normalizedName = name.trim()
  const normalizedParams = params.trim()
  return normalizedParams ? `@${normalizedName} ${normalizedParams}` : `@${normalizedName}`
}

/** Compare trimmed raw values. Whitespace inside strings and syntax-sensitive
 * values is preserved; formatting drift is surfaced for review. */
function normalizeDeclarationValue(value) {
  return value.trim()
}

/** Postcss separates the !important marker from the value; keep the marker,
 * because cascade impact is semantic, not formatting. Callers pass raw
 * postcss Declaration nodes (`prop`, not `property`). */
function normalizeDeclaration(decl) {
  const property = decl.prop.trim()
  const value = normalizeDeclarationValue(decl.value)
  return {
    property,
    value,
    ...(decl.important ? { important: true } : {}),
    // Full signature used for set comparisons below.
    signature: `${property}: ${value}${decl.important ? ' !important' : ''}`,
  }
}

/**
 * Bounded semantic comparison of two vendored-chrome ds-* stylesheets.
 *
 * This compares a SOURCE-COMPILED ds-* candidate (produced when the
 * compilation resource gate opens, e.g. via compileCoreStyles) against the
 * packaged `src/vendor/hypercanvas/generated/tailwind.css` artifact at the
 * declaration and at-rule level. It never invokes the Tailwind compiler: both
 * CSS strings are provided by the caller, parsed with the postcss AST, and the
 * report is a review aid, not a proof of equivalent rendering. Byte equality
 * is impossible by construction (the packaged artifact is the fuller
 * namespace-adapted upstream output; the production candidate only scans the
 * vendored closure and is minified separately), and value representation,
 * cascade order and duplicate overrides are NOT established — differences in
 * those respects are surfaced as review entries and the verdict fails closed
 * (`regressed` for any candidate-only content, `inconclusive` when the
 * candidate is ambiguous about what it would apply, including declaration
 * bodies of generic at-rules such as `@font-face`, `packaged-superset` only
 * when every candidate declaration is accounted for inside the packaged
 * artifact).
 *
 * CLI: node tests/runtime/css-semantic-compare.mjs candidate.css packaged.css --out report.json
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

function addRulesIndexEntry(rules, selectorKey, declaration) {
  const entries = rules.get(selectorKey) ?? []
  entries.push(declaration)
  rules.set(selectorKey, entries)
}

/**
 * Parse a stylesheet into keyed collections. Declaration order within one
 * selector is significant in CSS (later declarations win), so rules keep an
 * ordered list; identical adjacent declarations only count once.
 */
function parseIndex(css, label) {
  const rules = new Map()
  const atRuleIdentity = new Map()
  const conflicts = []
  const reviewEntries = []
  const context = []

  const declarationConflicts = declarations => {
    const byProperty = new Map()
    for (const declaration of declarations) {
      const previous = byProperty.get(declaration.property)
      if (previous && previous.signature !== declaration.signature) {
        conflicts.push({
          where: `${selectorKey}-${declaration.property}`,
          note: 'The same property is declared multiple times for one selector with different values; effective value depends on source order, which this comparison does not establish.',
          values: [...new Set([previous.signature, declaration.signature])],
        })
      }
      byProperty.set(declaration.property, declaration)
    }
  }

  let selectorKey = null
  const visit = node => {
    if (node.type === 'decl') {
      const declaration = normalizeDeclaration(node)
      if (!selectorKey) {
        reviewEntries.push({
          atRuleContext: context.map(rule => normalizeAtRuleIdentity(rule.name, rule.params)),
          declaration: declaration.signature,
          note: 'Declaration is outside a style rule and is not semantically indexed; review this at-rule body directly.',
        })
        return
      }
      const existing = rules.get(selectorKey) ?? []
      if (!existing.some(item => item.signature === declaration.signature)) {
        addRulesIndexEntry(rules, selectorKey, declaration)
        if (existing.length) declarationConflicts([...existing, declaration])
      }
      return
    }
    if (node.type === 'rule') {
      const previousKey = selectorKey
      selectorKey = `${preserveSelectorText(node.selector)} under ${context.length ? `[${context.map(node => normalizeAtRuleIdentity(node.name, node.params)).join(' >> ')}]` : 'root'}`
      for (const child of node.nodes ?? []) visit(child)
      selectorKey = previousKey
      return
    }
    if (node.type === 'root') {
      for (const child of node.nodes ?? []) visit(child)
      return
    }
    if (node.type === 'atrule') {
      if (node.name === 'keyframes') {
        const identity = normalizeAtRuleIdentity(node.name, node.params)
        const entries = atRuleIdentity.get(identity) ?? []
        for (const child of node.nodes ?? []) {
          if (child.type !== 'rule') continue
          const stepKey = preserveSelectorText(child.selector)
          const byProperty = new Map()
          for (const step of child.nodes ?? []) {
            if (step.type !== 'decl') continue
            const declaration = normalizeDeclaration(step)
            entries.push(`${stepKey}: ${declaration.signature}`)
            // Set-like comparison below cannot see order within one keyframe
            // step, so conflicting duplicate properties are flagged: the
            // effective value depends on source order, which this comparator
            // does not establish.
            const previous = byProperty.get(declaration.property)
            if (previous && previous.signature !== declaration.signature) {
              conflicts.push({
                where: `${identity} [${stepKey}] ${declaration.property}`,
                note: 'The same property is declared multiple times within one keyframe step with different values; the effective value depends on source order, which this comparison does not establish.',
                values: [...new Set([previous.signature, declaration.signature])],
              })
            }
            byProperty.set(declaration.property, declaration)
          }
        }
        atRuleIdentity.set(identity, entries)
        return
      }
      if (node.name === 'property') {
        const identity = normalizeAtRuleIdentity(node.name, node.params)
        const entries = atRuleIdentity.get(identity) ?? []
        for (const child of node.nodes ?? []) {
          if (child.type === 'decl') entries.push(`${child.prop}: ${normalizeDeclaration(child).signature.split(': ').slice(1).join(': ')}`)
        }
        atRuleIdentity.set(identity, entries)
        return
      }
      context.push(node)
      for (const child of node.nodes ?? []) visit(child)
      context.pop()
      // Block-less statements (for example `@layer ds-base;`) have semantic
      // presence for the gate even without declarations.
      if (!node.nodes?.length) {
        const identity = normalizeAtRuleIdentity(node.name, node.params)
        atRuleIdentity.set(identity, [...(atRuleIdentity.get(identity) ?? [])])
      }
      return
    }
  }

  visit(postcss.parse(css, { from: label }))
  return {
    label,
    rules,
    atRuleIdentity,
    conflicts,
    reviewEntries,
    ruleCount: rules.size,
    declarationCount: [...rules.values()].reduce((total, entries) => total + entries.length, 0),
    atRuleCount: atRuleIdentity.size,
  }
}

function diffRules(candidate, packaged, limit) {
  const candidateOnly = []
  const packagedOnly = []
  for (const [key, entries] of candidate.rules) {
    const packagedEntries = packaged.rules.get(key)
    if (!packagedEntries) {
      candidateOnly.push({ selectorContext: key, declarations: entries.map(entry => entry.signature) })
      continue
    }
    const missing = entries.filter(entry => !packagedEntries.some(other => other.signature === entry.signature))
    if (missing.length) candidateOnly.push({ selectorContext: key, declarations: missing.map(entry => entry.signature) })
  }
  for (const [key, entries] of packaged.rules) {
    const candidateEntries = candidate.rules.get(key)
    if (!candidateEntries) {
      packagedOnly.push({ selectorContext: key, declarations: entries.map(entry => entry.signature) })
      continue
    }
    const missing = entries.filter(entry => !candidateEntries.some(other => other.signature === entry.signature))
    if (missing.length) packagedOnly.push({ selectorContext: key, declarations: missing.map(entry => entry.signature) })
  }
  const truncate = entries => entries.length > limit
    ? { count: entries.length, truncated: true, entries: entries.slice(0, limit) }
    : { count: entries.length, truncated: false, entries }
  return { candidateOnly: truncate(candidateOnly), packagedOnly: truncate(packagedOnly) }
}

function diffAtRules(candidate, packaged, limit) {
  const candidateOnly = []
  const packagedOnly = []
  const sharedValueDiff = []
  for (const [identity, entries] of candidate.atRuleIdentity) {
    const packagedEntries = packaged.atRuleIdentity.get(identity)
    if (!packagedEntries) {
      candidateOnly.push({ atRule: identity, declarations: entries })
      continue
    }
    const missing = entries.filter(entry => !packagedEntries.includes(entry))
    if (missing.length) sharedValueDiff.push({ atRule: identity, candidateOnlyDeclarations: missing })
  }
  for (const [identity, entries] of packaged.atRuleIdentity) {
    const candidateEntries = candidate.atRuleIdentity.get(identity)
    if (!candidateEntries) {
      packagedOnly.push({ atRule: identity, declarations: entries })
      continue
    }
    const missing = entries.filter(entry => !candidateEntries.includes(entry))
    if (missing.length) sharedValueDiff.push({ atRule: identity, packagedOnlyDeclarations: missing })
  }
  const truncate = entries => entries.length > limit
    ? { count: entries.length, truncated: true, entries: entries.slice(0, limit) }
    : { count: entries.length, truncated: false, entries }
  return {
    candidateOnly: truncate(candidateOnly),
    packagedOnly: truncate(packagedOnly),
    sharedValueDiff: truncate(sharedValueDiff),
  }
}

function summarize(index) {
  const properties = new Set()
  for (const entries of index.rules.values()) for (const declaration of entries) properties.add(declaration.property)
  for (const identity of index.atRuleIdentity.keys()) {
    if (identity.startsWith('@property ')) properties.add(identity.slice('@property '.length).trim())
  }
  return { label: index.label, ruleCount: index.ruleCount, declarationCount: index.declarationCount, atRuleCount: index.atRuleCount, properties: [...properties].sort() }
}

/**
 * Build the comparison report for two stylesheet sources.
 * `candidateCss` is the newly compiled ds-* candidate CSS;
 * `packagedCss` is the committed packaged artifact.
 */
export function compareStylesheets({
  candidateCss,
  packagedCss,
  candidateLabel = 'source-compiled candidate',
  packagedLabel = 'packaged generated/tailwind.css',
  limit = 40,
} = {}) {
  if (typeof candidateCss !== 'string' || typeof packagedCss !== 'string') {
    throw new TypeError('candidateCss and packagedCss must be CSS strings.')
  }
  const candidate = parseIndex(candidateCss, candidateLabel)
  const packaged = parseIndex(packagedCss, packagedLabel)
  const declarations = diffRules(candidate, packaged, limit)
  const atRules = diffAtRules(candidate, packaged, limit)
  // A count census only measures drift magnitude; it establishes nothing.
  const candidateBag = new Map()
  for (const entries of candidate.rules.values()) for (const item of entries) candidateBag.set(item.signature, (candidateBag.get(item.signature) ?? 0) + 1)
  const packagedBag = new Map()
  for (const entries of packaged.rules.values()) for (const item of entries) packagedBag.set(item.signature, (packagedBag.get(item.signature) ?? 0) + 1)
  const valueCensus = {
    onlyInCandidate: [...candidateBag].filter(([value]) => !packagedBag.has(value)).length,
    onlyInPackaged: [...packagedBag].filter(([value]) => !candidateBag.has(value)).length,
  }
  const candidateSideDiff = declarations.candidateOnly.count > 0
    || atRules.candidateOnly.count > 0
    || atRules.sharedValueDiff.entries.some(entry => entry.candidateOnlyDeclarations)
  const candidateConflicts = [...candidate.conflicts]
  const candidateReviewEntries = [...candidate.reviewEntries]
  const verdict = candidateSideDiff
    ? 'regressed'
    : (candidateConflicts.length > 0 || candidateReviewEntries.length > 0 ? 'inconclusive' : 'packaged-superset')
  return {
    schemaVersion: 2,
    method: 'design-notebook css-semantic-compare v2',
    disclaimer: 'Review aid only. Declaration-level comparison does not establish rendering equivalence: cascade order, duplicate overrides, value representation and descendant matching are NOT verified here. Declaration values and at-rule parameters are compared conservatively, preserving trimmed source text.',
    candidate: summarize(candidate),
    packaged: summarize(packaged),
    declarations,
    atRules,
    valueCensus,
    candidateConflicts,
    candidateReviewEntries,
    packagedReviewEntries: [...packaged.reviewEntries],
    verdict,
    interpretation: {
      regressed: 'The candidate emits at least one declaration or at-rule the packaged artifact lacks (including changed @property/@keyframes values). Gate owner must review before shipping.',
      inconclusive: 'The candidate contains same-selector conflicting declarations (or conflicting duplicates within one keyframe step) whose effective value depends on unestablished source order, or declarations outside style rules (for example in generic at-rules such as @font-face) that this comparator does not semantically index. Review the listed entries directly.',
      'packaged-superset': 'Every candidate declaration is accounted for inside the packaged artifact. Packaged-only entries are expected fuller upstream content but remain review items.',
    }[verdict],
  }
}

/** Read two files and produce the report. */
export function compareFiles(candidatePath, packagedPath, { limit } = {}) {
  const read = file => {
    const bytes = fs.readFileSync(path.resolve(file))
    return { css: bytes.toString('utf8'), sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  const candidate = read(candidatePath)
  const packaged = read(packagedPath)
  const report = compareStylesheets({
    candidateCss: candidate.css,
    packagedCss: packaged.css,
    ...(limit ? { limit } : {}),
    candidateLabel: `${path.basename(candidatePath)} (sha256-${candidate.sha256})`,
    packagedLabel: `${path.basename(packagedPath)} (sha256-${packaged.sha256})`,
  })
  report.candidate.sha256 = candidate.sha256
  report.packaged.sha256 = packaged.sha256
  return report
}

/**
 * CLI entrypoint when invoked directly:
 *   node tests/runtime/css-semantic-compare.mjs candidate.css packaged.css [--out report.json] [--limit N]
 */
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const outIndex = argv.indexOf('--out')
  const limitIndex = argv.indexOf('--limit')
  const files = argv.filter((value, index) =>
    value !== '--out' && value !== '--limit' && index !== outIndex + 1 && index !== limitIndex + 1)
  const [candidatePath, packagedPath] = files
  if (!candidatePath || !packagedPath || candidatePath.startsWith('--') || packagedPath.startsWith('--')) {
    console.error('usage: node tests/runtime/css-semantic-compare.mjs candidate.css packaged.css [--out report.json] [--limit N]')
    process.exit(2)
  }
  const report = compareFiles(candidatePath, packagedPath, { limit: limitIndex >= 0 ? Number(argv[limitIndex + 1]) || 40 : 40 })
  const text = JSON.stringify(report, null, 2)
  if (outIndex >= 0) {
    fs.mkdirSync(path.dirname(path.resolve(argv[outIndex + 1])), { recursive: true })
    fs.writeFileSync(argv[outIndex + 1], `${text}\n`)
    console.log(`wrote ${argv[outIndex + 1]}`)
  } else {
    console.log(text)
  }
  process.exitCode = report.verdict === 'regressed' || report.verdict === 'inconclusive' ? 1 : 0
}
