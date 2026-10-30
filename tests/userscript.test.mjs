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
  const events = {}; const loads = []; const frames = [];
  let observe, mutate;
  runInNewContext(code, {
    URL, console: { warn() {} },
    location: { href: 'https://www.xiaohongshu.com/explore/test', pathname: '/explore/test' },
    document: { body, images: [img], createElement: () => new Element(), addEventListener: (k, fn) => { events[k] = fn; } },
    window: { addEventListener() {} },
    IntersectionObserver: class { constructor(fn) { observe = fn; } observe() {} },
    MutationObserver: class { constructor(fn) { mutate = fn; } observe() {} },
    Image: class { constructor() { loads.push(this); this.naturalWidth = 5886; } },
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: fn => frames.push(fn),
  });
  const flush = () => { while (frames.length) frames.shift()(); };
  return { img, loads, events, toggle: body.children[0].children[0],
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

test('unrelated host and ordinary bucket are ignored', () => {
  for (const src of [web.replace('sns-webpic-qc.xhscdn.com', 'evilxhscdn.com'), web.replace('note_pre_post_uhdr', 'notes_pre_post')]) {
    const h = harness(src); h.show(); assert.equal(h.loads.length, 0);
  }
});
