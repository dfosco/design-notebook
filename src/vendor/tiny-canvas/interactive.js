import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Block, Canvas, Frame, Image, Mark, Note } from './upstream/tiny-canvas.js'

const h = React.createElement
const ZOOM_LEVELS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
const MIN_BOARD_SIZE = 1200
const BOARD_MARGIN = 128

function sceneBounds(items) {
  if (!items.length) return { left: 0, top: 0, right: MIN_BOARD_SIZE, bottom: 800 }
  return items.reduce((bounds, item) => ({
    left: Math.min(bounds.left, item.geometry.x),
    top: Math.min(bounds.top, item.geometry.y),
    right: Math.max(bounds.right, item.geometry.x + item.geometry.width),
    bottom: Math.max(bounds.bottom, item.geometry.y + item.geometry.height),
  }), { left: 0, top: 0, right: MIN_BOARD_SIZE, bottom: 800 })
}

export function computeCanvasBoardGeometry(items) {
  const bounds = sceneBounds(items)
  const origin = {
    x: Math.min(0, bounds.left) - BOARD_MARGIN,
    y: Math.min(0, bounds.top) - BOARD_MARGIN,
  }
  return {
    origin,
    width: Math.max(MIN_BOARD_SIZE, bounds.right + BOARD_MARGIN - origin.x),
    height: Math.max(800, bounds.bottom + BOARD_MARGIN - origin.y),
    bounds,
  }
}

function siteContent(item, mode) {
  const local = mode === 'local' && item.localSrc
  let sameOrigin = false
  try { sameOrigin = new URL(item.localSrc, globalThis.location?.href).origin === globalThis.location?.origin } catch {}
  const children = []
  if (local) children.push(h('iframe', {
    key: 'frame', className: 'canvas-scene__site-frame', src: item.localSrc,
    title: item.title || `Site ${item.id}`, loading: 'lazy', referrerPolicy: 'no-referrer',
    sandbox: `allow-scripts allow-forms allow-popups${sameOrigin ? ' allow-same-origin' : ''}`,
  }))
  const screenshot = item.src
    ? h('img', { src: item.src, alt: item.title || '', loading: 'lazy', decoding: 'async' })
    : h('div', { className: 'canvas-scene__fallback', role: 'status' }, 'Site screenshot is unavailable.')
  if (local) {
    children.push(h('details', { key: 'screenshot', className: 'canvas-scene__site-screenshot-fallback' },
      h('summary', null, 'Fallback screenshot (embedded preview may be blocked or unavailable)'),
      screenshot,
    ))
  } else {
    children.push(h('div', { key: 'screenshot', className: 'canvas-scene__site-static-screenshot' }, screenshot))
  }
  if (item.href) children.push(h('a', {
    key: 'link', className: 'canvas-scene__site-link', href: item.href,
    target: '_blank', rel: 'noopener noreferrer',
  }, `${local ? 'Open' : 'Open'} ${item.title || 'site'}${local ? ' locally' : ''}`))
  else children.push(h('div', { key: 'link-error', className: 'canvas-scene__fallback', role: 'status' }, 'Site destination is unavailable.'))
  return h('div', { className: `canvas-scene__site canvas-scene__site--${local ? 'local' : 'static'}` }, ...children)
}

function NotebookResizeHandle({ itemId, geometry, onSizeCommit }) {
  const start = useRef(null)
  const resize = (handle, width, height) => {
    const block = handle.closest('.tc-block')
    if (block) {
      block.style.width = `${width}px`
      block.style.height = `${height}px`
    }
  }
  return h('button', {
    type: 'button',
    className: 'tc-resize-handle tc-no-drag',
    'aria-label': `Resize canvas item ${itemId}`,
    title: 'Drag to resize. Use arrow keys for precise resizing.',
    onPointerDown: event => {
      event.preventDefault()
      event.stopPropagation()
      const zoom = Number.parseFloat(getComputedStyle(event.currentTarget).getPropertyValue('--tc-canvas-zoom')) || 1
      start.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, zoom, width: geometry.width, height: geometry.height }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: event => {
      if (start.current?.pointerId !== event.pointerId) return
      event.preventDefault()
      const next = {
        width: Math.max(120, start.current.width + (event.clientX - start.current.x) / start.current.zoom),
        height: Math.max(80, start.current.height + (event.clientY - start.current.y) / start.current.zoom),
      }
      resize(event.currentTarget, next.width, next.height)
      start.current.currentSize = next
    },
    onPointerUp: event => {
      if (start.current?.pointerId !== event.pointerId) return
      const next = start.current.currentSize
      start.current = null
      if (next) onSizeCommit(next)
    },
    onPointerCancel: event => {
      if (start.current?.pointerId !== event.pointerId) return
      resize(event.currentTarget, start.current.width, start.current.height)
      start.current = null
    },
    onKeyDown: event => {
      const block = event.currentTarget.closest('.tc-block')
      const next = resizeGeometryByKeyboard(logicalGeometryFromBlockStyle(block, geometry), event.key)
      if (!next) return
      event.preventDefault()
      resize(event.currentTarget, next.width, next.height)
      onSizeCommit(next)
    },
  })
}

export function logicalGeometryFromBlockStyle(block, fallback) {
  const width = Number.parseFloat(block?.style?.width)
  const height = Number.parseFloat(block?.style?.height)
  return {
    width: Number.isFinite(width) && width > 0 ? width : fallback.width,
    height: Number.isFinite(height) && height > 0 ? height : fallback.height,
  }
}

export function resizeGeometryByKeyboard(geometry, key) {
  const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[key]
  if (!delta) return null
  return {
    width: Math.max(120, geometry.width + delta[0]),
    height: Math.max(80, geometry.height + delta[1]),
  }
}

function notebookResizableBlock(common, geometry, onSizeCommit, children, className) {
  return h(Block, {
    ...common,
    className,
    style: { width: geometry.width, height: geometry.height },
  }, children, h(NotebookResizeHandle, { itemId: common.id, geometry, onSizeCommit }))
}

function widgetElement(item, geometry, origin, mode, onCommit) {
  const position = { x: geometry.x - origin.x, y: geometry.y - origin.y }
  const moved = next => onCommit(item.id, 'move', {
    x: next.x + origin.x,
    y: next.y + origin.y,
  })
  const resized = size => onCommit(item.id, 'resize', size)
  const common = {
    id: item.id,
    ...position,
    persistPosition: false,
    onPositionCommit: moved,
  }
  if (item.kind === 'text') return h(Note, {
    ...common,
    text: item.text || '',
    width: geometry.width,
    height: geometry.height,
    color: item.color || 'yellow',
    persistSize: false,
    onSizeCommit: resized,
  })
  if (item.kind === 'markdown') return h(Mark, {
    ...common,
    content: item.text || '',
    width: geometry.width,
    height: geometry.height,
    persistSize: false,
    onSizeCommit: resized,
  })
  if (item.kind === 'image' && item.src) return h(Image, {
    ...common,
    src: item.src,
    alt: item.alt || '',
    width: geometry.width,
    height: geometry.height,
    persistSize: false,
    onSizeCommit: resized,
  })
  if (item.kind === 'frame' && item.src) return h(Frame, {
    ...common,
    route: item.src,
    title: item.title || `Canvas frame ${item.id}`,
    width: geometry.width,
    height: geometry.height,
    snapshot: item.snapshot || undefined,
    persistSize: false,
    onSizeCommit: resized,
  })
  if (item.kind === 'site') return notebookResizableBlock(
    common, geometry, resized, siteContent(item, mode), 'tc-resizable-block',
  )

  const fallbackText = item.fallback?.type === 'text' && typeof item.fallback.text === 'string'
    ? item.fallback.text
    : 'Content is unavailable.'
  return notebookResizableBlock(
    common, geometry, resized,
    h('div', { className: 'canvas-scene__fallback', role: 'status' }, `${item.message || `Unsupported canvas item: ${item.kind || 'unknown'}`} ${fallbackText}`),
    'tc-resizable-block canvas-scene__unsupported',
  )
}

function currentZoom(root) {
  const value = root?.querySelector('.tc-canvas-zoom-value')?.textContent || '100%'
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed / 100 : 1
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

async function setZoom(root, desired) {
  const zoomOut = root?.querySelector('[aria-label="Zoom out"]')
  const zoomIn = root?.querySelector('[aria-label="Zoom in"]')
  if (!zoomOut || !zoomIn) return
  const target = ZOOM_LEVELS.filter(value => value <= desired).at(-1) ?? ZOOM_LEVELS[0]
  for (let step = 0; step < ZOOM_LEVELS.length; step += 1) {
    const current = currentZoom(root)
    if (Math.abs(current - target) < 0.001) break
    ;(current > target ? zoomOut : zoomIn).click()
    await nextFrame()
  }
}

/** Renders the pinned Tiny Canvas component closure with notebook-owned geometry persistence. */
export function InteractiveCanvas({ scene, canvasId, revision, mode = 'local', saveCanvasGeometry }) {
  const root = useRef(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [geometryOverrides, setGeometryOverrides] = useState({})
  const [saveState, setSaveState] = useState({ pending: 0, error: null })
  const [mountGeneration, setMountGeneration] = useState(0)
  const revisionRef = useRef(revision)
  const queueRef = useRef(Promise.resolve())
  const operationSequenceRef = useRef(new Map())
  const operationCounterRef = useRef(0)
  const sourceGenerationRef = useRef(0)

  useEffect(() => {
    revisionRef.current = revision
    sourceGenerationRef.current += 1
    operationSequenceRef.current.clear()
    setGeometryOverrides({})
  }, [revision])

  useEffect(() => {
    const element = root.current
    if (!element) return undefined
    const measure = () => setViewport({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])

  const items = useMemo(() => scene.items.map(item => ({
    ...item,
    geometry: geometryOverrides[item.id] || item.geometry,
  })), [geometryOverrides, scene.items])
  const board = useMemo(() => computeCanvasBoardGeometry(items), [items])

  const commit = useCallback((widgetId, operation, value) => {
    const current = items.find(item => item.id === widgetId)?.geometry
    const optimistic = current && (operation === 'move'
      ? { ...current, x: value.x, y: value.y }
      : { ...current, width: value.width, height: value.height })
    const sequence = ++operationCounterRef.current
    operationSequenceRef.current.set(widgetId, sequence)
    const sourceGeneration = sourceGenerationRef.current
    if (optimistic) setGeometryOverrides(previous => ({ ...previous, [widgetId]: optimistic }))
    if (mode !== 'local' || typeof saveCanvasGeometry !== 'function' || typeof canvasId !== 'string' || !canvasId.trim()) {
      const message = mode === 'static'
        ? 'This published canvas has no writable notebook service. Geometry changes are temporary and will not be saved.'
        : !canvasId
          ? 'This canvas has no authored canvasId, so geometry cannot be saved.'
          : 'The local host does not provide canvas geometry persistence. Geometry changes are temporary.'
      if (mode === 'local') {
        setGeometryOverrides(previous => {
          const next = { ...previous }
          delete next[widgetId]
          return next
        })
        setMountGeneration(value => value + 1)
      }
      setSaveState(current => ({ ...current, error: new Error(message) }))
      return
    }
    setSaveState(current => ({ pending: current.pending + 1, error: null }))
    const save = async () => {
      if (sourceGenerationRef.current !== sourceGeneration) {
        setSaveState(current => ({ pending: Math.max(0, current.pending - 1), error: null }))
        return
      }
      const request = {
        canvasId,
        widgetId,
        operation,
        revision: revisionRef.current,
        ...(operation === 'move' ? { position: { x: value.x, y: value.y } } : { width: value.width, height: value.height }),
      }
      const result = await saveCanvasGeometry(request)
      if (!result || typeof result.revision !== 'string' || !result.geometry) {
        throw new Error('Canvas save returned no authoritative revision or geometry.')
      }
      if (sourceGenerationRef.current !== sourceGeneration) {
        setSaveState(current => ({ pending: Math.max(0, current.pending - 1), error: null }))
        return
      }
      revisionRef.current = result.revision
      if (operationSequenceRef.current.get(widgetId) === sequence) {
        setGeometryOverrides(previous => ({ ...previous, [widgetId]: result.geometry }))
      }
      setSaveState(current => ({ pending: Math.max(0, current.pending - 1), error: null }))
    }
    const pending = queueRef.current.then(save)
    queueRef.current = pending.catch(() => {})
    pending.catch(error => {
      if (sourceGenerationRef.current === sourceGeneration && operationSequenceRef.current.get(widgetId) === sequence) {
        setGeometryOverrides(previous => {
          const next = { ...previous }
          delete next[widgetId]
          return next
        })
        setMountGeneration(value => value + 1)
      }
      setSaveState(current => ({ pending: Math.max(0, current.pending - 1), error }))
    })
  }, [canvasId, items, mode, saveCanvasGeometry])

  const fit = useCallback(async () => {
    const canvas = root.current?.querySelector('.tc-canvas')
    const boardElement = root.current?.querySelector('.tc-canvas-board')
    if (!canvas || !boardElement || !viewport.width || !viewport.height) return
    const contentWidth = Math.max(1, board.bounds.right - board.bounds.left)
    const contentHeight = Math.max(1, board.bounds.bottom - board.bounds.top)
    const target = Math.min(2, viewport.width / contentWidth, viewport.height / contentHeight)
    await setZoom(root.current, target)
    const scale = currentZoom(root.current)
    canvas.scrollLeft = Math.max(0, (board.bounds.left - board.origin.x + contentWidth / 2) * scale - canvas.clientWidth / 2)
    canvas.scrollTop = Math.max(0, (board.bounds.top - board.origin.y + contentHeight / 2) * scale - canvas.clientHeight / 2)
  }, [board, viewport.height, viewport.width])

  const statusMessage = mode === 'static'
    ? 'Published canvas is read-only. Move and resize changes are temporary and will not be saved.'
    : saveState.error
      ? `Canvas save failed: ${saveState.error.message}`
      : saveState.pending
        ? 'Saving canvas geometry…'
        : null

  return h('section', { className: 'notebook-shell__canvas-stage', 'data-canvas-mode': mode },
    h('div', { className: 'notebook-shell__canvas-viewport', ref: root, role: 'region', 'aria-label': `${scene.title || 'Notebook'} canvas`, 'data-canvas-id': canvasId },
      h(Canvas, {
        key: mountGeneration,
        className: 'notebook-shell__tiny-canvas',
        title: scene.title,
        canvasWidth: board.width,
        canvasHeight: board.height,
        dotted: true,
        copyable: false,
        resettable: false,
        onPointerDown: event => {
          if (event.target === event.currentTarget) event.currentTarget.focus({ preventScroll: true })
        },
      }, ...items.map(item => widgetElement(item, item.geometry, board.origin, mode, commit))),
      scene.title ? h('h1', { className: 'notebook-shell__canvas-title' }, scene.title) : null,
      h('button', {
        type: 'button',
        className: 'tc-canvas-control tc-no-drag notebook-shell__canvas-fit',
        onClick: () => { void fit() },
        'aria-label': 'Fit canvas to view',
      }, 'Fit'),
      statusMessage ? h('div', {
        className: 'notebook-shell__canvas-status notebook-shell__canvas-save-note',
        role: saveState.error ? 'alert' : 'status',
      }, statusMessage) : null,
    ),
  )
}

export const tinyCanvasZoomLevels = ZOOM_LEVELS
