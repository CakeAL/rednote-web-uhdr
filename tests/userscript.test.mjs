import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const code = readFileSync(new URL('../xhs-ultrahdr.user.js', import.meta.url), 'utf8');
const key = 'note_pre_post_uhdr/1040test';
const web = `https://sns-webpic-qc.xhscdn.com/date/sign/${key}!h5_1080jpg`;
const original = `https://ci.xiaohongshu.com/${key}`;

function harness(src = web) {
  class Element {
    constructor() { this.attrs = new Map(); this.style = {}; this.children = []; this.isConnected = true; }
    getAttribute(k) { return this.attrs.get(k) ?? null; }
    setAttribute(k, v) { this.attrs.set(k, v); }
    removeAttribute(k) { this.attrs.delete(k); }
    hasAttribute(k) { return this.attrs.has(k); }
    set src(v) { this.setAttribute('src', v); }
    get src() { return this.getAttribute('src'); }
    get currentSrc() { return this.src; }
    append(...nodes) { this.children.push(...nodes); }
    closest() { return null; }
    getBoundingClientRect() { return { width: 600, height: 400 }; }
  }
  const img = new Element(); img.src = src; img.setAttribute('srcset', `${web} 2x`);
  const body = new Element();
  const images = [img];
  const events = {}; const loads = []; const frames = [];
  const api = {};
  let observe, mutate;
  runInNewContext(code.replace('  scan();\n})();', '  Object.assign(testAPI, { zip, fileURL, imageBytes, noteImages });\n  scan();\n})();'), {
    URL, console: { warn() {} },
    Blob, TextEncoder, TextDecoder, testAPI: api,
    innerWidth: 1200, innerHeight: 900,
    location: { href: 'https://www.xiaohongshu.com/explore/6adcdadf000000002c0252f4', pathname: '/explore/6adcdadf000000002c0252f4' },
    document: { body, images, createElement: () => new Element(), addEventListener: (k, fn) => { events[k] = fn; } },
    window: { addEventListener() {} },
    IntersectionObserver: class { constructor(fn) { observe = fn; } observe() {} },
    MutationObserver: class { constructor(fn) { mutate = fn; } observe() {} },
    Image: class { constructor() { loads.push(this); this.naturalWidth = 5886; } },
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: fn => frames.push(fn),
  });
  const flush = () => { while (frames.length) frames.shift()(); };
  return { img, images, loads, events, api, toggle: body.children[0].children[0],
    show() { observe([{ target: img, isIntersecting: true }]); },
    mutate() { mutate(); flush(); }, flush };
}

test('preserves complete bucket path and removes srcset; toggle restores both', () => {
  const h = harness(); h.show();
  assert.equal(h.loads[0].src, original);
  h.loads[0].onload();
  assert.equal(h.img.src, original);
  assert.equal(h.img.getAttribute('srcset'), null);
  h.toggle.onclick(); h.flush();
  assert.equal(h.img.src, web);
  assert.equal(h.img.getAttribute('srcset'), `${web} 2x`);
});

test('whole-post list includes offscreen slides, deduplicates clones, keeps carousel order', async () => {
  const h = harness();
  const root = { innerText: '2/2', getBoundingClientRect: () => ({ width: 800 }) };
  h.img.closest = () => root;
  const second = new h.img.constructor(); second.src = web.replace('1040test', '1040next'); second.closest = () => root;
  const clone = new h.img.constructor(); clone.src = web; clone.closest = () => root;
  h.images.push(second, clone);
  const result = await h.api.noteImages();
  assert.equal(result.images.length, 2);
  assert.equal(result.images[0].url, original);
  assert.equal(result.images[1].url, original.replace('1040test', '1040next'));
});

test('ZIP stores exact bytes and standard CRC32 with directory entries', async () => {
  const { api } = harness();
  const bytes = new TextEncoder().encode('123456789');
  const archive = new Uint8Array(await api.zip([{ name: '01.jpg', bytes }]).arrayBuffer());
  const view = new DataView(archive.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(14, true), 0xcbf43926);
  assert.deepEqual(archive.slice(36, 45), bytes);
  assert.equal(view.getUint32(45, true), 0x02014b50);
  assert.equal(view.getUint32(archive.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(archive.length - 14, true), 1);
  assert.throws(() => api.fileURL('../bad'), /无效/);
});

test('preload error leaves web image intact', () => {
  const h = harness(); h.show(); h.loads[0].onerror();
  assert.equal(h.img.src, web);
  h.mutate(); assert.equal(h.loads.length, 1);
});

test('late preload completion after disabling cannot replace image', () => {
  const h = harness(); h.show(); h.toggle.onclick(); h.flush(); h.loads[0].onload();
  assert.equal(h.img.src, web);
});

test('reused element does not receive previous slide, including stale currentSrc', () => {
  const h = harness(); h.show();
  h.img.src = 'https://sns-webpic-qc.xhscdn.com/notes_pre_post/other!jpg';
  Object.defineProperty(h.img, 'currentSrc', { value: web });
  h.loads[0].onload();
  assert.match(h.img.src, /notes_pre_post\/other/);
});

test('site lazy loader can be replaced again; displayed image error rolls back', () => {
  const h = harness(); h.show(); h.loads[0].onload();
  h.img.src = web; h.mutate(); assert.equal(h.img.src, original);
  h.events.error({ target: h.img }); assert.equal(h.img.src, web);
  h.mutate(); assert.equal(h.loads.length, 1);
});

test('unrelated host and avatar bucket are ignored', () => {
  for (const src of [web.replace('sns-webpic-qc.xhscdn.com', 'evilxhscdn.com'), web.replace('note_pre_post_uhdr', 'avatar')]) {
    const h = harness(src); h.show(); assert.equal(h.loads.length, 0);
  }
});

test('spectrum and other photo buckets preserve complete paths', () => {
  for (const bucket of ['spectrum', 'notes_pre_post', 'note_pre_post']) {
    const h = harness(web.replace('note_pre_post_uhdr', bucket)); h.show();
    assert.equal(h.loads[0].src, original.replace('note_pre_post_uhdr', bucket));
    h.loads[0].onload();
    assert.equal(h.img.src, original.replace('note_pre_post_uhdr', bucket));
  }
});
