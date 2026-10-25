import assert from 'node:assert/strict';
import test from 'node:test';
import { renderScene } from '../../src/vendor/tiny-canvas/index.js';

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.parentNode = null;
  }

  append(...children) {
    for (const child of children) {
      child.parentNode = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...children);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(name, callback, options) {
    this.listeners[name] = { callback, options };
  }

  dispatch(name) {
    this.listeners[name]?.callback({ currentTarget: this });
  }
}

Object.defineProperty(FakeElement.prototype, 'textContent', {
  set(value) {
    this._textContent = String(value);
    this.replaceChildren();
  },
  get() {
    return this._textContent || '';
  },
});

Object.defineProperty(FakeElement.prototype, 'src', {
  set(value) {
    this._src = String(value);
  },
  get() {
    return this._src;
  },
});

class FakeDocument {
  baseURI = 'https://notebook.example/review/';

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

function fixture() {
  const ownerDocument = new FakeDocument();
  const container = new FakeElement('div', ownerDocument);
  const scene = {
    title: 'Review scene',
    width: 900,
    height: 600,
    items: [
      { id: 'note/one', kind: 'text', text: '<script>plain text</script>', geometry: { x: 10, y: 20, width: 240, height: 120 } },
      { id: 'photo', kind: 'image', src: './photo.png', alt: 'A photo', geometry: { x: 280, y: 20, width: 200, height: 160 } },
      { id: 'prototype', kind: 'frame', src: '/prototype/demo', title: 'Demo', geometry: { x: 500, y: 20, width: 320, height: 240 } },
      { id: 'unknown', kind: 'chart', geometry: { x: 10, y: 200, width: 200, height: 100 } },
    ],
  };
  return { container, scene };
}

test('renders explicit scene items with stable IDs, geometry and fallbacks', () => {
  const { container, scene } = fixture();
  const before = structuredClone(scene);
  renderScene(container, scene);

  const [board] = container.children;
  assert.equal(board.tagName, 'SECTION');
  assert.equal(board.attributes['aria-label'], 'Review scene');
  assert.equal(board.style.width, '900px');
  assert.deepEqual(board.children.map((item) => item.dataset.itemId), [
    'note/one', 'photo', 'prototype', 'unknown',
  ]);

  const [text, image, frame, unknown] = board.children;
  assert.equal(text.style.left, '10px');
  assert.equal(text.children[0].textContent, '<script>plain text</script>');
  assert.equal(image.children[0].children[0].src, 'https://notebook.example/review/photo.png');
  assert.equal(image.children[0].children[0].alt, 'A photo');
  assert.equal(frame.children[0].src, 'https://notebook.example/prototype/demo');
  assert.equal(frame.children[0].title, 'Demo');
  assert.equal(frame.children[0].attributes.sandbox, 'allow-scripts allow-forms allow-popups allow-same-origin');
  assert.equal(unknown.children[0].attributes.role, 'status');
  assert.match(unknown.children[0].textContent, /Unsupported canvas item: chart/);
  assert.deepEqual(scene, before);
});

test('preserves valid negative authored positions', () => {
  const { container, scene } = fixture();
  scene.items[0].geometry.x = -48;
  scene.items[0].geometry.y = -12;
  renderScene(container, scene);
  const item = container.children[0].children[0];
  assert.equal(item.style.left, '-48px');
  assert.equal(item.style.top, '-12px');
});

test('keeps cross-origin frames opaque under the sandbox policy', () => {
  const { container, scene } = fixture();
  scene.items[2].src = 'https://prototype.example/app';
  renderScene(container, scene);
  const frame = container.children[0].children[2].children[0];
  assert.equal(frame.attributes.sandbox, 'allow-scripts allow-forms allow-popups');
});

test('uses visible fallbacks for unsafe or failed resources', () => {
  const { container, scene } = fixture();
  scene.items[1].src = 'javascript:alert(1)';
  renderScene(container, scene);
  const [board] = container.children;
  assert.equal(board.children[1].children[0].textContent, 'Image source is unavailable.');

  const loaded = fixture();
  renderScene(loaded.container, loaded.scene);
  const image = loaded.container.children[0].children[1].children[0].children[0];
  image.dispatch('error');
  assert.equal(image.parentNode, null);
  assert.equal(loaded.container.children[0].children[1].children[0].children[0].textContent, 'Image could not be loaded.');
});

test('renders site screenshots with deployed links and visible replay notices', () => {
  const { container, scene } = fixture();
  scene.notices = ['Canvas replay stopped at unsupported event.'];
  scene.items = [{ id: 'site', kind: 'site', src: '/shots/home.png', href: 'https://site.example/', title: 'Site', geometry: { x: 0, y: 0, width: 300, height: 200 } }];
  renderScene(container, scene);
  const [board] = container.children;
  assert.equal(board.children[0].attributes.role, 'status');
  assert.match(board.children[0].textContent, /unsupported event/);
  const site = board.children[1].children[0];
  const [image, link] = site.children;
  assert.equal(image.tagName, 'IMG');
  assert.equal(image.src, 'https://notebook.example/shots/home.png');
  assert.equal(link.tagName, 'A');
  assert.equal(link.href, 'https://site.example/');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(link.textContent, 'Open Site');
});

test('local Site views embed only their local URL and keep screenshot and open-link fallbacks visible', () => {
  const { container, scene } = fixture();
  scene.mode = 'local';
  scene.items = [{
    id: 'site', kind: 'site', localSrc: 'http://127.0.0.1:4173/books?sort=title#results',
    src: '/preview/sites/catalog/home.png', href: 'http://127.0.0.1:4173/books?sort=title#results',
    title: 'Catalog home', geometry: { x: 0, y: 0, width: 480, height: 270 },
  }];
  renderScene(container, scene);
  const site = container.children[0].children[0].children[0];
  const [frame, screenshotFallback, link] = site.children;
  assert.equal(frame.tagName, 'IFRAME');
  assert.equal(frame.src, 'http://127.0.0.1:4173/books?sort=title#results');
  assert.equal(frame.title, 'Catalog home');
  assert.equal(frame.referrerPolicy, 'no-referrer');
  assert.equal(frame.attributes.sandbox, 'allow-scripts allow-forms allow-popups');
  assert.equal(screenshotFallback.tagName, 'DETAILS');
  assert.match(screenshotFallback.children[0].textContent, /may be blocked or unavailable/);
  assert.equal(screenshotFallback.children[1].tagName, 'IMG');
  assert.equal(screenshotFallback.children[1].src, 'https://notebook.example/preview/sites/catalog/home.png');
  assert.equal(link.href, 'http://127.0.0.1:4173/books?sort=title#results');
  assert.equal(link.textContent, 'Open Catalog home locally');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
});

test('static Site views ignore any local frame URL and show only screenshot plus deployed link', () => {
  const { container, scene } = fixture();
  scene.mode = 'static';
  scene.items = [{
    id: 'site', kind: 'site', localSrc: 'http://localhost:4173/local-only',
    src: '/preview/sites/catalog/home.png', href: 'https://catalog.example/books',
    title: 'Catalog home', geometry: { x: 0, y: 0, width: 480, height: 270 },
  }];
  renderScene(container, scene);
  const site = container.children[0].children[0].children[0];
  assert.deepEqual(site.children.map(child => child.tagName), ['IMG', 'A']);
  assert.equal(site.children[0].src, 'https://notebook.example/preview/sites/catalog/home.png');
  assert.equal(site.children[1].href, 'https://catalog.example/books');
  assert.equal(site.children[1].textContent, 'Open Catalog home');
});

test('Site fallback remains explicit when screenshot, local URL, and destination are missing', () => {
  const { container, scene } = fixture();
  scene.mode = 'local';
  scene.items = [{
    id: 'site', kind: 'site', src: null, localSrc: null, href: null, title: 'Unavailable site',
    geometry: { x: 0, y: 0, width: 300, height: 200 },
  }];
  renderScene(container, scene);
  const site = container.children[0].children[0].children[0];
  assert.equal(site.children[0].tagName, 'DETAILS');
  assert.equal(site.children[0].children[1].attributes.role, 'status');
  assert.equal(site.children[0].children[1].textContent, 'Site screenshot is unavailable.');
  assert.equal(site.children[1].attributes.role, 'status');
  assert.equal(site.children[1].textContent, 'Site destination is unavailable.');
});

test('renders text fallback literally and labels it as unsupported widget content', () => {
  const { container, scene } = fixture();
  scene.items = [{
    id: 'chart', kind: 'chart', message: 'Widget type chart is unsupported; showing fallback.',
    fallback: { type: 'text', text: '<script>not executable</script>' },
    geometry: { x: -8, y: 14, width: 280, height: 120 },
  }];
  renderScene(container, scene);
  const item = container.children[0].children[0];
  assert.equal(item.dataset.itemId, 'chart');
  assert.equal(item.style.left, '-8px');
  assert.equal(item.style.top, '14px');
  assert.equal(item.children[0].attributes.role, 'status');
  assert.equal(item.children[0].textContent, 'Widget type chart is unsupported; showing fallback. Text fallback: <script>not executable</script>');
});

test('rejects malformed scenes and provides a non-persistent unmount', () => {
  const { container, scene } = fixture();
  assert.throws(() => renderScene(container, { items: [{ id: 'bad', geometry: {} }] }), /geometry/);
  assert.equal(container.children.length, 0);

  const unmount = renderScene(container, scene);
  assert.equal(container.children.length, 1);
  unmount();
  assert.equal(container.children.length, 0);
});
