// ==UserScript==
// @name         小红书 Ultra HDR 原图
// @namespace    local.rednote.uhdr
// @version      0.1.0
// @description  将可见的大图中的 note_pre_post_uhdr 图片换成保留增益图的 CDN 原文件；失败自动回退。
// @match        https://www.xiaohongshu.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  // Preserve the bucket directory. Removing it returns 404 for these images.
  function originalURL(value) {
    try {
      const url = new URL(value, location.href);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      if (!(url.hostname.endsWith('.xhscdn.com') || url.hostname === 'ci.xiaohongshu.com')) return null;
      const match = url.pathname.match(/\/(note_pre_post_uhdr\/[A-Za-z0-9_-]+)(?:!.*)?$/);
      return match ? `https://ci.xiaohongshu.com/${match[1]}` : null;
    } catch { return null; }
  }

  let enabled = true;
  let running = 0;
  let scheduled = false;
  const records = new Map();
  const pending = [];
  const visible = new WeakSet();
  const watched = new WeakSet();
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;display:flex;gap:10px;align-items:center;padding:10px 14px;background:#202124;color:white;border-radius:12px;font:13px system-ui;box-shadow:0 2px 12px #0004';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.style.cssText = 'background:transparent;color:inherit;border:0;cursor:pointer;font:inherit';
  toggle.title = '点击关闭并恢复网页图片。原图加载成功不代表屏幕已经输出 HDR。';
  const link = document.createElement('a');
  link.textContent = '打开原图';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.style.cssText = 'color:#a8d8ff;display:none';
  panel.append(toggle, link);
  document.body.append(panel);

  function update() {
    let count = 0;
    for (const [img, record] of records) {
      if (!img.isConnected || source(img) !== record.url) records.delete(img);
      else if (record.status === 'done') count++;
    }
    const text = enabled ? `HDR 原图：已替换 ${count} 张` : 'HDR 原图：已关闭';
    if (toggle.textContent !== text) toggle.textContent = text;
  }

  function save(img) {
    const nodes = [img, ...(img.parentElement?.tagName === 'PICTURE'
      ? img.parentElement.querySelectorAll('source') : [])];
    return nodes.map(node => ({ node, src: node.getAttribute('src'), srcset: node.getAttribute('srcset') }));
  }

  function restore(record) {
    for (const { node, src, srcset } of record.saved || []) {
      for (const [name, value] of [['src', src], ['srcset', srcset]]) {
        if (value === null) node.removeAttribute(name);
        else node.setAttribute(name, value);
      }
    }
  }

  function source(img) {
    // Prefer src: currentSrc can still refer to the previous slide during a swap.
    return originalURL(img.getAttribute('src') || img.currentSrc);
  }

  function eligible(img) {
    if (!enabled || !img.isConnected || !visible.has(img)) return false;
    const box = img.getBoundingClientRect();
    // Leave feed thumbnails and avatars alone; support detail and enlarged views.
    return box.width >= 280 && box.height >= 180 &&
      (/^\/(explore|discovery\/item)\//.test(location.pathname) ||
        !!img.closest('.note-detail-mask, .note-detail-container, .note-container, .image-viewer, [role="dialog"]'));
  }

  function drain() {
    while (running < 2 && pending.length) {
      const { img, record } = pending.shift();
      if (!eligible(img) || records.get(img) !== record || source(img) !== record.url) {
        if (records.get(img) === record) records.delete(img);
        continue;
      }
      running++;
      const probe = new Image();
      probe.referrerPolicy = 'no-referrer';
      let finished = false;
      const timer = setTimeout(() => finish(false), 30000);
      function finish(ok) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        probe.onload = probe.onerror = null;
        running--;
        if (records.get(img) === record) {
          if (ok && eligible(img) && source(img) === record.url) {
            record.saved = save(img);
            record.status = 'done';
            for (const { node } of record.saved) node.removeAttribute('srcset');
            img.referrerPolicy = 'no-referrer';
            img.src = record.url;
            link.href = record.url;
            link.style.display = '';
          } else if (!ok) {
            record.status = 'failed';
            console.warn('[XHS Ultra HDR] 原图未能加载，保留网页图片', record.url);
          } else records.delete(img);
        }
        update();
        drain();
      }
      probe.onload = () => finish(probe.naturalWidth > 0);
      probe.onerror = () => finish(false);
      probe.src = record.url;
    }
  }

  function consider(img) {
    if (!eligible(img)) return;
    const url = source(img);
    if (!url) return;
    const previous = records.get(img);
    if (previous?.url === url) {
      // Vue/lazy loading can put the processed URL back after our replacement.
      if (previous.status === 'done' && (img.getAttribute('src') !== url || img.hasAttribute('srcset'))) {
        if (img.getAttribute('src') !== url) previous.saved = save(img);
        for (const { node } of previous.saved) node.removeAttribute('srcset');
        img.src = url;
      }
      return;
    }
    const record = { url, status: 'pending' };
    records.set(img, record);
    pending.push({ img, record });
    drain();
  }

  const intersection = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) { visible.add(entry.target); consider(entry.target); }
      else visible.delete(entry.target);
    }
  });

  function scan() {
    scheduled = false;
    for (const img of document.images) {
      if (!watched.has(img)) { watched.add(img); intersection.observe(img); }
      consider(img);
    }
    update();
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(scan); }
  }
  toggle.onclick = () => {
    enabled = !enabled;
    if (!enabled) {
      for (const [img, record] of records) {
        if (record.status === 'done' && source(img) === record.url) restore(record);
      }
      link.style.display = 'none';
    }
    records.clear();
    pending.length = 0;
    schedule();
  };
  document.addEventListener('error', event => {
    const record = records.get(event.target);
    if (record?.status === 'done' && event.target.getAttribute('src') === record.url) {
      record.status = 'failed';
      restore(record);
      update();
    }
  }, true);
  new MutationObserver(schedule).observe(document.body, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset', 'class'],
  });
  window.addEventListener('resize', schedule);
  window.addEventListener('popstate', schedule);
  scan();
})();
