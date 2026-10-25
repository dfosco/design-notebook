const ITEM_KINDS = new Set(['text', 'image', 'frame', 'site']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validGeometry(geometry, id) {
  if (!isRecord(geometry)) {
    throw new TypeError(`Scene item "${id}" must have geometry.`);
  }

  const { x, y, width, height } = geometry;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new TypeError(`Scene item "${id}" geometry must use finite coordinates and positive finite size.`);
  }

  return { x, y, width, height };
}

function safeUrl(value, baseURI) {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const url = new URL(value, baseURI);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch {
    return null;
  }

  return null;
}

function fallback(document, item, message) {
  const view = document.createElement('div');
  view.className = 'canvas-scene__fallback';
  view.setAttribute('role', 'status');
  view.textContent = message || item.message || `Unsupported canvas item: ${item.kind || 'unknown'}`;
  return view;
}

function itemView(document, item, baseURI, mode = 'static') {
  if (!ITEM_KINDS.has(item.kind)) {
    if (item.fallback?.type === 'text' && typeof item.fallback.text === 'string') {
      return fallback(document, item, `${item.message || `Unsupported canvas item: ${item.kind || 'unknown'}`} Text fallback: ${item.fallback.text}`);
    }
    return fallback(document, item);
  }

  if (item.kind === 'text') {
    const view = document.createElement('div');
    view.className = 'canvas-scene__text';
    view.textContent = typeof item.text === 'string' ? item.text : '';
    return view;
  }

  if (item.kind === 'image') {
    const src = safeUrl(item.src, baseURI);
    if (!src) return fallback(document, item, 'Image source is unavailable.');

    const figure = document.createElement('figure');
    figure.className = 'canvas-scene__image';
    const image = document.createElement('img');
    image.src = src;
    image.alt = typeof item.alt === 'string' ? item.alt : '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('error', () => {
      figure.replaceChildren(fallback(document, item, 'Image could not be loaded.'));
    }, { once: true });
    figure.append(image);
    return figure;
  }

  if (item.kind === 'site') {
    const view = document.createElement('div');
    view.className = `canvas-scene__site canvas-scene__site--${mode === 'local' ? 'local' : 'static'}`;
    const src = safeUrl(item.src, baseURI);
    const localSrc = mode === 'local' ? safeUrl(item.localSrc, baseURI) : null;
    if (localSrc) {
      const frame = document.createElement('iframe');
      frame.className = 'canvas-scene__site-frame';
      frame.src = localSrc;
      frame.title = typeof item.title === 'string' && item.title.trim() ? item.title : `Site ${item.id}`;
      frame.loading = 'lazy';
      frame.referrerPolicy = 'no-referrer';
      const sandbox = ['allow-scripts', 'allow-forms', 'allow-popups'];
      if (isSameOrigin(localSrc, baseURI)) sandbox.push('allow-same-origin');
      frame.setAttribute('sandbox', sandbox.join(' '));
      view.append(frame);

    }

    if (mode === 'local') {
      const screenshotFallback = document.createElement('details');
      screenshotFallback.className = 'canvas-scene__site-screenshot-fallback';
      const summary = document.createElement('summary');
      summary.textContent = localSrc
        ? 'Fallback screenshot (embedded preview may be blocked or unavailable)'
        : 'Reference screenshot';
      screenshotFallback.append(summary);
      if (src) {
        const image = document.createElement('img');
        image.src = src;
        image.alt = typeof item.title === 'string' ? item.title : '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.addEventListener('error', () => {
          image.replaceWith(fallback(document, item, 'Site screenshot could not be loaded.'));
        }, { once: true });
        screenshotFallback.append(image);
      } else {
        screenshotFallback.append(fallback(document, item, 'Site screenshot is unavailable.'));
      }
      view.append(screenshotFallback);
    } else if (src) {
      const image = document.createElement('img');
      image.src = src;
      image.alt = typeof item.title === 'string' ? item.title : '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => {
        image.replaceWith(fallback(document, item, 'Site screenshot could not be loaded.'));
      }, { once: true });
      view.append(image);
    } else {
      view.append(fallback(document, item, 'Site screenshot is unavailable.'));
    }
    const href = safeUrl(item.href, baseURI);
    if (href) {
      const link = document.createElement('a');
      link.className = 'canvas-scene__site-link';
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const siteTitle = typeof item.title === 'string' && item.title.trim() ? item.title : 'site';
      link.textContent = localSrc ? `Open ${siteTitle} locally` : `Open ${siteTitle}`;
      view.append(link);
    } else {
      view.append(fallback(document, item, 'Site destination is unavailable.'));
    }
    return view;
  }

  const src = safeUrl(item.src, baseURI);
  if (!src) return fallback(document, item, 'Frame source is unavailable.');

  const frame = document.createElement('iframe');
  frame.className = 'canvas-scene__frame';
  frame.src = src;
  frame.title = typeof item.title === 'string' && item.title.trim()
    ? item.title
    : `Canvas frame ${item.id}`;
  frame.loading = 'lazy';
  frame.referrerPolicy = 'no-referrer';
  const sandbox = ['allow-scripts', 'allow-forms', 'allow-popups'];
  if (isSameOrigin(src, baseURI)) sandbox.push('allow-same-origin');
  frame.setAttribute('sandbox', sandbox.join(' '));
  return frame;
}

function isSameOrigin(value, baseURI) {
  try {
    return new URL(value).origin === new URL(baseURI).origin;
  } catch {
    return false;
  }
}

/** Render a materialized, in-memory scene without reading or persisting authoring state. */
export function renderScene(container, scene) {
  if (!container || typeof container.replaceChildren !== 'function') {
    throw new TypeError('A DOM container is required.');
  }
  if (!isRecord(scene) || !Array.isArray(scene.items)) {
    throw new TypeError('Scene must be an object with an items array.');
  }

  const document = container.ownerDocument;
  if (!document || typeof document.createElement !== 'function') {
    throw new TypeError('The container must belong to a DOM document.');
  }

  const board = document.createElement('section');
  board.className = 'canvas-scene';
  board.setAttribute('role', 'region');
  if (typeof scene.title === 'string' && scene.title.trim()) {
    board.setAttribute('aria-label', scene.title);
  }
  board.style.position = 'relative';
  board.style.width = `${dimension(scene.width, 1200)}px`;
  board.style.height = `${dimension(scene.height, 800)}px`;

  for (const notice of Array.isArray(scene.notices) ? scene.notices : []) {
    if (typeof notice !== 'string' || !notice.trim()) continue;
    const message = document.createElement('p');
    message.className = 'canvas-scene__notice';
    message.setAttribute('role', 'status');
    message.textContent = notice;
    board.append(message);
  }

  for (const item of scene.items) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim()) {
      throw new TypeError('Every scene item must have a non-empty string id.');
    }
    const geometry = validGeometry(item.geometry, item.id);
    const placement = document.createElement('article');
    placement.className = `canvas-scene__item canvas-scene__item--${ITEM_KINDS.has(item.kind) ? item.kind : 'fallback'}`;
    placement.dataset.itemId = item.id;
    placement.style.position = 'absolute';
    placement.style.left = `${geometry.x}px`;
    placement.style.top = `${geometry.y}px`;
    placement.style.width = `${geometry.width}px`;
    placement.style.height = `${geometry.height}px`;
    placement.append(itemView(document, item, document.baseURI, scene.mode));
    board.append(placement);
  }

  container.replaceChildren(board);
  return () => {
    if (board.parentNode === container) container.replaceChildren();
  };
}

function dimension(value, fallbackValue) {
  if (value === undefined) return fallbackValue;
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError('Scene dimensions must be positive finite numbers.');
  }
  return value;
}
