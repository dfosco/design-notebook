import * as React from 'react'
import { ArrowLeft, ArrowRight, FileIcon, GlobeIcon, LayoutDashboardIcon, PanelLeft, PanelRight } from 'lucide-react'
import { Button } from '../chrome/ui/button.jsx'
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '../chrome/ui/breadcrumb.jsx'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from '../chrome/ui/sidebar.jsx'
import css from './NotebookShell.module.css'
import '../generated/tailwind.css'

const TYPE_ICONS = { prototype: FileIcon, canvas: LayoutDashboardIcon, site: GlobeIcon, doc: FileIcon }

function countArtifacts(entry) {
  if (entry?.type !== 'group') return entry?.artifact?.id ? 1 : 0
  return (entry.children ?? []).reduce((count, child) => count + countArtifacts(child), 0)
}

/**
 * Notebook-data adapter for the Hypercanvas NotebookShell chrome composition.
 * The component primitives, sidebar composition classes, and top-bar JSX shape
 * are sourced from the pinned Hypercanvas NotebookShell. Only data, navigation,
 * and view controls are supplied by Design Notebook.
 */
function ArtifactLink({ entry, selected, selectedViewId, makeHref, onSelect }) {
  const artifact = entry.artifact
  if (!artifact?.id) return null
  const viewId = artifact.id === selected?.id ? selectedViewId : undefined
  const href = makeHref({ artifactId: artifact.id, ...(viewId !== undefined ? { viewId } : {}) })
  const TypeIcon = TYPE_ICONS[artifact.kind] || FileIcon
  const handleClick = event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onSelect({ artifactId: artifact.id, ...(viewId !== undefined ? { viewId } : {}) })
  }
  const anchor = React.createElement('a', {
    href,
    onClick: handleClick,
    'data-artifact-id': artifact.id,
    'data-artifact-kind': artifact.kind,
    'aria-current': artifact.id === selected?.id ? 'page' : undefined,
    'aria-disabled': artifact.available === false ? 'true' : undefined,
    className: artifact.available === false ? css.pageRowUnavailable : undefined,
  },
  React.createElement(TypeIcon, { className: css.typeIcon, 'aria-hidden': 'true' }),
  React.createElement('span', { className: css.pageTitle }, artifact.title || artifact.id),
  artifact.available === false ? React.createElement('span', { className: css.statusMark, title: 'Unavailable' }, '!') : null)

  return React.createElement(SidebarMenuItem, { className: css.pageRow, key: artifact.id },
    React.createElement(SidebarMenuButton, {
      render: anchor,
      isActive: artifact.id === selected?.id,
      className: css.pageButton,
      title: artifact.title || artifact.id,
    }))
}

function FolderEntry({ entry, selected, selectedViewId, activePath, makeHref, onSelect, collapsedPaths, onToggleFolder, nested = false, visualNested = false }) {
  if (entry?.type !== 'group') {
    return React.createElement(ArtifactLink, { entry, selected, selectedViewId, makeHref, onSelect })
  }
  const children = Array.isArray(entry.children) ? entry.children : []
  const active = Boolean(activePath && entry.path && (activePath === entry.path || activePath.startsWith(`${entry.path}/`)))
  const folderKey = entry.path ?? entry.name
  const collapsed = collapsedPaths.has(folderKey)
  const artifactCount = countArtifacts(entry)
  const content = React.createElement(SidebarGroup, {
    className: `${css.group} ${visualNested ? css.nestedFolder : ''}`,
    'data-folder-path': entry.path ?? '',
  },
    React.createElement('div', { className: css.groupHeader },
      React.createElement(SidebarGroupLabel, { className: css.groupLabel },
        React.createElement('button', {
          type: 'button',
          className: css.groupTitle,
          title: entry.name,
          'aria-expanded': !collapsed,
          'aria-label': `${entry.name}, ${artifactCount} ${artifactCount === 1 ? 'artifact' : 'artifacts'}`,
          onClick: () => onToggleFolder(folderKey),
        },
        React.createElement('span', { className: css.folderChevron, 'aria-hidden': 'true' }, collapsed ? '▸' : '▾'),
        React.createElement('span', { className: css.folderTitle }, entry.name),
        React.createElement('span', { className: css.groupCount }, artifactCount)))),
    !collapsed ? React.createElement(SidebarMenu, { className: css.pageList }, children.map((child, index) => React.createElement(FolderEntry, {
      entry: child,
      selected,
      selectedViewId,
      activePath,
      makeHref,
      onSelect,
      collapsedPaths,
      onToggleFolder,
      nested: child?.type === 'group',
      visualNested: child?.type === 'group',
      key: child?.path ?? child?.artifact?.id ?? `${folderKey}-${index}`,
    }))) : null,
    active ? React.createElement('span', { className: css.visuallyHidden, 'aria-current': 'location' }, 'Current folder') : null)
  return nested
    ? React.createElement(SidebarMenuItem, { className: css.nestedFolderItem }, content)
    : content
}

function NotebookTopbar({ selected, sidebarOpen, sidebarToggleRef, onSidebarToggle, onBack, onForward, trailing }) {
  return React.createElement('div', { className: css.artifactNavigation, 'data-hc-notebook-topbar': '' },
    !sidebarOpen ? React.createElement(Button, {
      variant: 'ghost', size: 'icon', className: css.artifactSidebarToggle,
      ref: sidebarToggleRef,
      onClick: onSidebarToggle,
      'aria-label': 'Open notebook sidebar',
      title: 'Open sidebar',
    }, React.createElement(PanelRight, { size: 17 })) : null,
    React.createElement(Breadcrumb, { className: css.artifactTitle },
      React.createElement(BreadcrumbList, null,
        React.createElement(BreadcrumbItem, null,
          React.createElement(BreadcrumbPage, { 'data-notebook-artifact-title': '' }, selected?.title || selected?.id || 'Design Notebook')))),
    React.createElement('div', { className: css.artifactNavigationActions, 'aria-label': 'Artifact navigation' },
      React.createElement(Button, { variant: 'ghost', size: 'icon', 'aria-label': 'Back', title: 'Back', onClick: onBack }, React.createElement(ArrowLeft, { size: 16 })),
      React.createElement(Button, { variant: 'ghost', size: 'icon', 'aria-label': 'Forward', title: 'Forward', onClick: onForward }, React.createElement(ArrowRight, { size: 16 })),
      trailing))
}

export function NotebookChrome({
  graph, selected, selectedViewId, activePath, makeHref, onSelect,
  sidebarOpen, onSidebarOpenChange, onBack, onForward, trailing,
  children, className = '', mode,
}) {
  const sidebarToggleRef = React.useRef(null)
  const reopenRef = React.useRef(null)
  const focusReopenOnClose = React.useRef(false)
  const focusTopbarOnClose = React.useRef(false)
  const focusSidebarOnOpen = React.useRef(false)
  const [collapsedPaths, setCollapsedPaths] = React.useState(() => new Set())
  const onToggleFolder = folderPath => setCollapsedPaths(current => {
    const next = new Set(current)
    if (next.has(folderPath)) next.delete(folderPath)
    else next.add(folderPath)
    return next
  })
  const requestSidebarOpenChange = nextOpen => {
    if (nextOpen && !sidebarOpen) focusSidebarOnOpen.current = true
    if (!nextOpen && sidebarOpen) {
      if (selected?.kind === 'canvas') focusReopenOnClose.current = true
      else focusTopbarOnClose.current = true
    }
    onSidebarOpenChange(nextOpen)
  }
  React.useEffect(() => {
    if (sidebarOpen && focusSidebarOnOpen.current) {
      focusSidebarOnOpen.current = false
      sidebarToggleRef.current?.focus()
    }
    if (!sidebarOpen && focusReopenOnClose.current) {
      focusReopenOnClose.current = false
      reopenRef.current?.focus()
    }
    if (!sidebarOpen && focusTopbarOnClose.current) {
      focusTopbarOnClose.current = false
      sidebarToggleRef.current?.focus()
    }
  }, [sidebarOpen])
  const entries = Array.isArray(graph?.entries) ? graph.entries : []
  const total = Array.isArray(graph?.artifacts) ? graph.artifacts.length : 0
  const tree = entries.length
    ? React.createElement(SidebarMenu, { className: css.rootEntryList }, entries.map((entry, index) => React.createElement(FolderEntry, {
      entry, selected, selectedViewId, activePath, makeHref, onSelect,
      collapsedPaths, onToggleFolder, nested: entry?.type === 'group', visualNested: false,
      key: entry?.path ?? entry?.artifact?.id ?? entry?.name ?? index,
    })))
    : React.createElement(SidebarGroup, { className: css.group },
      React.createElement(SidebarGroupLabel, { className: css.groupLabel }, 'Files'),
      React.createElement('p', { className: css.emptyGroupAction }, 'This notebook has no discovered artifacts.'))

  const mainContent = React.createElement('main', { className: `${css.content} ${selected ? css.contentArtifact : ''}` },
    selected?.kind === 'canvas' ? null : React.createElement(NotebookTopbar, {
      selected,
      sidebarOpen,
      sidebarToggleRef,
      onSidebarToggle: () => requestSidebarOpenChange(!sidebarOpen),
      onBack,
      onForward,
      trailing,
    }),
    React.createElement('div', { className: selected ? css.artifactViewer : undefined }, children))

  return React.createElement('div', { className: `${css.shell} ${sidebarOpen ? css.shellOpen : css.shellClosed} ${className}`.trim(), 'data-mode': mode, 'data-sidebar-open': sidebarOpen ? 'true' : 'false' },
    React.createElement(SidebarProvider, {
      className: `${css.sidebarProvider} ds-h-full ds-min-h-0`,
      open: sidebarOpen,
      onOpenChange: requestSidebarOpenChange,
    },
      React.createElement(Sidebar, { 'data-hc-surface': 'toolbar', className: css.sidebar, collapsible: 'none', 'aria-label': 'Notebook pages', 'aria-hidden': !sidebarOpen },
        React.createElement(SidebarHeader, { className: css.sidebarHeader },
          React.createElement(SidebarMenu, null,
            React.createElement(SidebarMenuItem, null,
              React.createElement(SidebarMenuButton, {
                size: 'lg', className: css.notebookButton,
                render: React.createElement('div', { role: 'heading', 'aria-level': 1 }),
              },
                React.createElement('span', { className: css.notebookIcon, 'aria-hidden': 'true' }),
                React.createElement('span', null, 'Design Notebook')))),
          sidebarOpen ? React.createElement(Button, { variant: 'ghost', size: 'icon', className: css.artifactSidebarToggle, ref: sidebarToggleRef, 'aria-label': 'Hide notebook sidebar', title: 'Hide sidebar', onClick: () => requestSidebarOpenChange(false) }, React.createElement(PanelLeft, { size: 17 })) : null),
        React.createElement(SidebarSeparator, { className: css.sidebarDivider }),
        React.createElement(SidebarContent, { className: css.pageNavigation, role: 'navigation', 'aria-label': 'Artifacts' }, tree),
        React.createElement(SidebarFooter, { className: css.sidebarFooter },
          React.createElement('span', { className: css.pageCount }, `${total} ${total === 1 ? 'artifact' : 'artifacts'}`)))),
    mainContent,
    !sidebarOpen && selected?.kind === 'canvas' ? React.createElement(Button, {
      variant: 'ghost', size: 'icon', className: css.reopenButton,
      ref: reopenRef,
      onClick: () => requestSidebarOpenChange(true), 'aria-label': 'Open notebook sidebar', title: 'Open sidebar',
    }, React.createElement('span', { className: css.notebookIcon, 'aria-hidden': 'true' })) : null)
}
