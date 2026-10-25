import { parseDocument } from 'yaml'

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
const BUILTIN_IMPORT = 'design-notebook/docs'

function issue(code, message, path, extra = {}) {
  return { code, message, ...(path ? { path } : {}), severity: 'error', ...extra }
}

function parseFrontmatter(source, artifactPath) {
  const match = FRONTMATTER.exec(source)
  if (!match) {
    return {
      body: source,
      frontmatter: null,
      lineOffset: 0,
      diagnostics: [issue('MISSING_DOCUMENT_FRONTMATTER', 'A .doc.mdx source must begin with YAML identity frontmatter.', artifactPath, { line: 1 })],
    }
  }

  const yaml = parseDocument(match[1], { uniqueKeys: true, version: '1.2' })
  const diagnostics = []
  for (const error of yaml.errors) {
    const line = error.linePos?.[0]?.line
    diagnostics.push(issue('INVALID_DOCUMENT_FRONTMATTER', error.message, artifactPath, {
      ...(line ? { line: line + 1 } : {}),
    }))
  }
  const lineOffset = match[0].split('\n').length - 1
  if (diagnostics.length) return { body: source.slice(match[0].length), frontmatter: null, lineOffset, diagnostics }

  let frontmatter
  try {
    frontmatter = yaml.toJS({ mapAsMap: false })
  } catch (error) {
    diagnostics.push(issue('INVALID_DOCUMENT_FRONTMATTER', `Cannot read YAML frontmatter: ${error.message}`, artifactPath))
  }
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    diagnostics.push(issue('INVALID_DOCUMENT_FRONTMATTER', 'YAML frontmatter must be a mapping.', artifactPath, { line: 2 }))
    frontmatter = null
  } else {
    if (frontmatter.formatVersion !== 1) diagnostics.push(issue('INVALID_DOCUMENT_FRONTMATTER', 'formatVersion must be 1.', artifactPath, { field: 'formatVersion' }))
    if (typeof frontmatter.id !== 'string' || !ID_PATTERN.test(frontmatter.id)) {
      diagnostics.push(issue('INVALID_DOCUMENT_FRONTMATTER', 'id must be a stable artifact ID.', artifactPath, { field: 'id' }))
    }
    if (typeof frontmatter.title !== 'string' || !frontmatter.title.trim()) {
      diagnostics.push(issue('INVALID_DOCUMENT_FRONTMATTER', 'title must be a non-empty string.', artifactPath, { field: 'title' }))
    }
    if (frontmatter.references !== undefined && (!Array.isArray(frontmatter.references) || frontmatter.references.some(id => typeof id !== 'string' || !ID_PATTERN.test(id)))) {
      diagnostics.push(issue('INVALID_DOCUMENT_FRONTMATTER', 'references must be an array of stable artifact IDs.', artifactPath, { field: 'references' }))
    }
  }

  return { body: source.slice(match[0].length), frontmatter, lineOffset, diagnostics }
}

function inspectMdx(tree) {
  const imports = []
  const components = []
  const visit = node => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'mdxjsEsm') {
      const body = node.data?.estree?.body ?? []
      for (const statement of body) {
        if (statement.type === 'ImportDeclaration' && typeof statement.source?.value === 'string') {
          imports.push({
            source: statement.source.value,
            line: statement.loc?.start?.line,
            bindings: statement.specifiers.map(specifier => specifier.local?.name).filter(Boolean),
          })
        }
      }
      // The parser attaches ESTree in supported compiler versions. Keep a source-text
      // fallback so diagnostics remain useful if a parser omits that attachment.
      if (!body.length && typeof node.value === 'string') {
        for (const match of node.value.matchAll(/(?:^|\n)\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
          imports.push({ source: match[1], line: node.position?.start?.line, bindings: [] })
        }
      }
    }
    if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && typeof node.name === 'string' && /^[A-Z]/.test(node.name)) {
      components.push({ name: node.name.split('.')[0], line: node.position?.start?.line })
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') visit(value)
    }
  }
  visit(tree)
  return { imports, components }
}

function validateImports() {
  return () => (tree, file) => {
    file.data.designNotebookMdx = inspectMdx(tree)
  }
}

function normalizeCompilerError(error, artifactPath, lineOffset) {
  const line = error?.line ?? error?.place?.line ?? error?.position?.start?.line
  const column = error?.column ?? error?.place?.column ?? error?.position?.start?.column
  return issue('INVALID_DOCUMENT_MDX', error?.message ?? 'MDX compilation failed.', artifactPath, {
    ...(line ? { line: line + lineOffset } : {}),
    ...(column ? { column } : {}),
  })
}

/**
 * Parse frontmatter metadata and compile the remaining Markdown-first MDX into
 * an ES module. The resulting module source is mode-independent; local and
 * static hosts only supply their resolver and import mapping.
 */
export async function compileDocument(source, options = {}) {
  const artifactPath = options.artifact?.path ?? options.path ?? null
  const diagnostics = []
  if (typeof source !== 'string') {
    return { available: false, frontmatter: null, body: '', compiledSource: null, diagnostics: [issue('INVALID_DOCUMENT_SOURCE', 'Document source must be a string.', artifactPath)] }
  }

  const parsed = parseFrontmatter(source, artifactPath)
  diagnostics.push(...parsed.diagnostics)
  if (options.artifact?.available === false) {
    diagnostics.push({
      code: 'UNAVAILABLE_DOCUMENT_ARTIFACT',
      severity: 'warning',
      path: artifactPath,
      message: `Document artifact "${options.artifact.id ?? artifactPath ?? ''}" is unavailable in discovery.`,
      causes: (options.artifact.diagnostics ?? []).map(item => item.code).filter(Boolean),
    })
  }
  const additionalImports = Array.isArray(options.supportedImportSources)
    ? options.supportedImportSources.filter(item => typeof item === 'string' && item.trim())
    : []
  const supported = new Set([BUILTIN_IMPORT, ...additionalImports])
  let compiledSource = null
  try {
    const { compile } = await import('@mdx-js/mdx')
    const vfile = await compile(parsed.body, {
      development: false,
      outputFormat: 'program',
      remarkPlugins: [validateImports([...supported])],
      jsxImportSource: 'react',
      filepath: artifactPath ?? 'document.doc.mdx',
    })
    compiledSource = String(vfile)
    const mdxInfo = vfile.data.designNotebookMdx ?? { imports: [], components: [] }
    const importedBindings = new Set(mdxInfo.imports.flatMap(item => item.bindings))
    for (const item of mdxInfo.imports) {
      if (!supported.has(item.source)) diagnostics.push(issue(
        'UNSUPPORTED_DOCUMENT_IMPORT',
        `Import "${item.source}" is not supported by this notebook renderer. Add a supported component import explicitly or remove it.`,
        artifactPath,
        { ...(item.line ? { line: item.line + parsed.lineOffset } : {}), importSource: item.source },
      ))
    }
    for (const item of mdxInfo.components) {
      if (!importedBindings.has(item.name)) diagnostics.push(issue(
        'UNIMPORTED_DOCUMENT_COMPONENT',
        `Component "${item.name}" must be imported explicitly from a supported notebook component module.`,
        artifactPath,
        { ...(item.line ? { line: item.line + parsed.lineOffset } : {}), component: item.name },
      ))
    }
  } catch (error) {
    diagnostics.push(normalizeCompilerError(error, artifactPath, parsed.lineOffset))
  }

  if (Array.isArray(parsed.frontmatter?.references) && Array.isArray(options.artifacts)) {
    const allArtifacts = options.artifacts
    for (const id of parsed.frontmatter.references) {
      const matches = allArtifacts.filter(item => item?.id === id)
      const code = matches.length === 0 ? 'UNRESOLVED_DOCUMENT_REFERENCE'
        : matches.length > 1 ? 'AMBIGUOUS_DOCUMENT_REFERENCE'
          : matches[0].available === false ? 'UNAVAILABLE_DOCUMENT_REFERENCE' : null
      if (code) diagnostics.push({
        code,
        severity: 'warning',
        path: artifactPath,
        id,
        message: code === 'UNRESOLVED_DOCUMENT_REFERENCE'
          ? `Document reference "${id}" does not match a discovered artifact ID.`
          : code === 'AMBIGUOUS_DOCUMENT_REFERENCE'
            ? `Document reference "${id}" matches multiple discovered artifacts.`
            : `Document reference "${id}" resolves to an unavailable artifact.`,
      })
    }
  }

  const hasError = diagnostics.some(item => item.severity === 'error')
  return {
    available: !hasError && compiledSource !== null && options.artifact?.available !== false,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    compiledSource,
    diagnostics,
  }
}

export { BUILTIN_IMPORT as DOCS_IMPORT_PATH }
