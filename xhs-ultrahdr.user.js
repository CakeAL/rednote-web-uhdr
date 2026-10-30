// ==UserScript==
// @name         小红书 Ultra HDR 原图
// @namespace    local.rednote.uhdr
// @version      0.3.2
// @description  小红书原图与 Middle 画质切换，左侧浮动下载操作，支持 HDR 与普通图片原文件。
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
      const parts = url.pathname.split('!')[0].split('/').filter(Boolean);
      const id = parts.pop();
      if (!/^1040[A-Za-z0-9_-]+$/.test(id || '')) return null;
      const bucket = parts.at(-1);
      const known = ['notes_uhdr', 'note_pre_post_uhdr', 'spectrum', 'notes_pre_post', 'note_pre_post'];
      if (known.includes(bucket)) return `https://ci.xiaohongshu.com/${bucket}/${id}`;
      // Bare IDs occur either at the root or after the web CDN's date/signature.
      if (!parts.length || (parts.length === 2 && /^\d{12}$/.test(parts[0]) && /^[a-f0-9]{32}$/i.test(parts[1]))) {
        return `https://ci.xiaohongshu.com/${id}`;
      }
      return null;
    } catch { return null; }
  }

  let enabled = true;
  let mode = 'middle';
  try { mode = localStorage.getItem('xhs-original-quality') || 'middle'; } catch {}
  if (!['middle', 'original', 'web'].includes(mode)) mode = 'middle';
  function displayURL(url) {
    return mode === 'middle' ? `${url}?imageMogr2/thumbnail/1440x1440>/format/jpg` : url;
  }
  let running = 0;
  let scheduled = false;
  const records = new Map();
  const pending = [];
  const visible = new WeakSet();
  const watched = new WeakSet();
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;top:50%;left:12px;transform:translateY(-50%);z-index:2147483647;display:none;flex-direction:column;gap:12px;align-items:stretch;max-width:190px;max-height:85vh;overflow:auto;padding:14px;background:#202124ed;color:white;border-radius:12px;font:13px system-ui;box-shadow:0 2px 12px #0004';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.style.cssText = 'background:transparent;color:inherit;border:0;cursor:pointer;font:inherit';
  toggle.title = '点击关闭并恢复网页图片。原图加载成功不代表屏幕已经输出 HDR。';
  const link = document.createElement('a');
  link.textContent = '打开原图';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.style.cssText = 'color:#a8d8ff;display:none';
  document.body.append(panel);
  const downloadAll = document.createElement('button');
  downloadAll.type = 'button';
  downloadAll.textContent = '下载本帖全部原图 ZIP';
  downloadAll.style.cssText = toggle.style.cssText;
  const progress = document.createElement('span');
  const downloadOne = document.createElement('button');
  downloadOne.type = 'button';
  downloadOne.textContent = '下载原图';
  downloadOne.style.cssText = toggle.style.cssText;
  const settings = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = '设置';
  const qualityLabel = document.createElement('label');
  qualityLabel.textContent = '浏览画质';
  const quality = document.createElement('select');
  quality.style.cssText = 'display:block;width:100%;margin:10px 0;padding:5px;background:#303134;color:white;border:1px solid #777;border-radius:5px;font:inherit';
  quality.setAttribute('aria-label', '浏览画质');
  for (const [value, text] of [['middle', 'Middle 1440（SDR、省流）'], ['original', '原图（保留源文件 HDR）'], ['web', '网页默认（省流）']]) {
    const option = document.createElement('option');
    option.value = value; option.textContent = text; quality.append(option);
  }
  quality.value = mode;
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:12px;line-height:1.6;color:#bdc1c6';
  hint.textContent = 'Middle 最长边 1440，实测会移除增益图。下载始终保存原文件。';
  qualityLabel.append(quality);
  settings.append(summary, qualityLabel, hint);
  // Keep all actions anchored to the screen, independent of image/slide position.
  panel.append(link, downloadAll, downloadOne, toggle, settings, progress);
  let currentImage = null;
  let downloading = false;
  let activeNoteId = noteId();

  function arrange() {
    const detailOpen = Array.from(document.querySelectorAll('.note-container, .note-detail-container, .image-viewer, img.preview-interactive')).some(root => {
      const r = root.getBoundingClientRect();
      const style = getComputedStyle(root);
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
    });
    const display = detailOpen ? 'flex' : 'none';
    if (panel.style.display !== display) panel.style.display = display;
    let best = null;
    let area = 0;
    let priority = -1;
    for (const img of document.images) {
      if (!eligible(img) || !source(img)) continue;
      const r = img.getBoundingClientRect();
      const a = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) *
        Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      const rank = img.matches('img.preview-interactive') ? 1 : 0;
      if (a > 0 && (rank > priority || (rank === priority && a > area))) {
        area = a; best = img; priority = rank;
      }
    }
    currentImage = best;
    downloadOne.disabled = downloading || !best;
    link.style.display = best ? '' : 'none';
    if (best) {
      link.href = source(best);
    }
  }

  function update() {
    let count = 0;
    for (const [img, record] of records) {
      if (!img.isConnected || source(img) !== record.url) records.delete(img);
      else if (record.status === 'done') count++;
    }
    const name = mode === 'middle' ? 'Middle · SDR' : mode === 'original' ? '原图' : '网页默认';
    const text = enabled ? `${name}：已替换 ${count} 张` : '自动替换：已关闭';
    if (toggle.textContent !== text) toggle.textContent = text;
    arrange();
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
    if (!img.isConnected || !visible.has(img)) return false;
    const box = img.getBoundingClientRect();
    // The full-screen preview is a separate portal outside the note container.
    // It must remain eligible even when the user zooms below thumbnail size.
    if (img.matches('img.preview-interactive')) return box.width > 0 && box.height > 0;
    // Leave feed thumbnails and avatars alone; support detail views.
    return box.width >= 280 && box.height >= 180 &&
      !!img.closest('.note-detail-container, .note-container, .image-viewer, [role="dialog"]');
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
            img.src = record.displayURL;
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
      probe.src = record.displayURL;
    }
  }

  function consider(img) {
    if (!enabled || mode === 'web' || !eligible(img)) return;
    const url = source(img);
    if (!url) return;
    const previous = records.get(img);
    if (previous?.url === url) {
      // Vue/lazy loading can put the processed URL back after our replacement.
      if (previous.status === 'done' && (img.getAttribute('src') !== previous.displayURL || img.hasAttribute('srcset'))) {
        if (img.getAttribute('src') !== previous.displayURL) previous.saved = save(img);
        for (const { node } of previous.saved) node.removeAttribute('srcset');
        img.src = previous.displayURL;
      }
      return;
    }
    const record = { url, displayURL: displayURL(url), status: 'pending' };
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
    const id = noteId();
    if (id !== activeNoteId) {
      activeNoteId = id;
      if (!downloading) progress.textContent = '';
    }
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
  quality.onchange = () => {
    for (const [img, record] of records) {
      if (record.status === 'done' && source(img) === record.url) restore(record);
    }
    mode = quality.value;
    try { localStorage.setItem('xhs-original-quality', mode); } catch {}
    records.clear(); pending.length = 0;
    schedule();
  };

  // Downloads preserve the exact bytes, including gain maps and motion-photo tails.
  function noteId() {
    return location.pathname.match(/\/(?:explore|discovery\/item)\/([a-f0-9]{24})/i)?.[1] ||
      location.pathname.match(/\/user\/profile\/[a-f0-9]{24}\/([a-f0-9]{24})/i)?.[1];
  }
  function fileURL(id) {
    if (typeof id !== 'string' || id.length > 256 || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(id)) throw Error('无效图片路径');
    return `https://ci.xiaohongshu.com/${id}`;
  }
  async function noteImages() {
    const id = noteId();
    if (!id) throw Error('请先打开具体笔记');
    // The live carousel includes offscreen slides and loop clones. Read all of
    // them, deduplicate by object URL, and check the displayed total when present.
    const domImages = new Map();
    let expected = 0;
    for (const img of document.images) {
      const root = img.closest('.note-container, .note-detail-container, .image-viewer');
      if (!root || root.getBoundingClientRect().width === 0) continue;
      const url = source(img) || originalURL(img.getAttribute('data-src'));
      if (url) domImages.set(url, { url });
      const total = root.innerText?.match(/\b\d+\s*\/\s*(\d+)\b/);
      if (total) expected = Math.max(expected, Number(total[1]));
    }
    if (domImages.size && (!expected || domImages.size === expected)) {
      return { id, images: [...domImages.values()] };
    }
    const page = new URL(location.href);
    page.pathname = `/discovery/item/${id}`;
    page.hash = '';
    const response = await fetch(page.href, { credentials: 'same-origin' });
    if (!response.ok) throw Error(`笔记请求失败 HTTP ${response.status}`);
    const html = await response.text();
    const state = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
    if (!state) throw Error('未取得笔记数据，请确认登录或稍后重试');
    // Replace JS undefined tokens while preserving string contents; never eval remote code.
    const data = JSON.parse(state[1].replace(/"(?:\\.|[^"\\])*"|\bundefined\b|new Map\(\[\]\)/g,
      token => token === 'undefined' ? 'null' : token === 'new Map([])' ? '{}' : token));
    const note = data.noteData?.data?.noteData || data.note?.noteDetailMap?.[id]?.note;
    if (note?.noteId !== id || !note.imageList?.length) throw Error(`无法读取完整图片列表${expected ? `（应有 ${expected} 张）` : ''}，请刷新笔记后重试`);
    const images = note.imageList.map(image => ({ url: fileURL(image.fileId) }));
    // Mobile sharing can place the cover last; keep the desktop carousel order.
    const remaining = new Map(images.map(image => [image.url, image]));
    const ordered = [];
    for (const img of document.images) {
      if (!img.closest('.note-container, .note-detail-container, .image-viewer')) continue;
      const url = source(img);
      if (remaining.has(url)) { ordered.push(remaining.get(url)); remaining.delete(url); }
    }
    return { id, images: [...ordered, ...remaining.values()] };
  }
  async function imageBytes(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
      if (!response.ok) throw Error(`原图请求失败 HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let ext;
      if (bytes[0] === 255 && bytes[1] === 216) ext = 'jpg';
      else if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) ext = 'png';
      else {
        const head = new TextDecoder().decode(bytes.subarray(0, 64));
        if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') ext = 'webp';
        else if (head.startsWith('GIF8')) ext = 'gif';
        else if (head.slice(4, 8) === 'ftyp') ext = /avif|avis/.test(head) ? 'avif' : 'heic';
        else throw Error('服务器未返回可识别的图片原文件');
      }
      return { bytes, ext };
    } finally { clearTimeout(timer); }
  }
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ZIP store mode: no recompression, external library or image conversion.
  const crcTable = Array.from({ length: 256 }, (_, i) => {
    for (let k = 0; k < 8; k++) i = (i >>> 1) ^ ((i & 1) ? 0xedb88320 : 0);
    return i >>> 0;
  });
  function zip(files) {
    const local = [], central = [];
    let offset = 0, centralSize = 0;
    for (const file of files) {
      const name = new TextEncoder().encode(file.name), size = file.bytes.length;
      let crc = 0xffffffff;
      for (const byte of file.bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
      crc = (crc ^ 0xffffffff) >>> 0;
      if (offset + size + 30 + name.length >= 0xffffffff) throw Error('原图总大小超过 ZIP 支持范围');
      const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer);
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true);
      h.setUint16(12, 33, true); h.setUint32(14, crc, true); h.setUint32(18, size, true);
      h.setUint32(22, size, true); h.setUint16(26, name.length, true); header.set(name, 30);
      local.push(header, file.bytes);
      const entry = new Uint8Array(46 + name.length), e = new DataView(entry.buffer);
      e.setUint32(0, 0x02014b50, true); e.setUint16(4, 20, true); e.setUint16(6, 20, true);
      e.setUint16(8, 0x800, true); e.setUint16(14, 33, true); e.setUint32(16, crc, true);
      e.setUint32(20, size, true); e.setUint32(24, size, true); e.setUint16(28, name.length, true);
      e.setUint32(42, offset, true); entry.set(name, 46);
      central.push(entry); centralSize += entry.length; offset += header.length + size;
    }
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
    return new Blob([...local, ...central, end], { type: 'application/zip' });
  }
  async function download(action) {
    if (downloading) return;
    downloading = true; downloadAll.disabled = downloadOne.disabled = true;
    try { await action(); }
    catch (error) { progress.textContent = `下载失败：${error.message}`; console.warn('[XHS 原图]', error); }
    finally { downloading = false; downloadAll.disabled = downloadOne.disabled = false; }
  }
  downloadOne.onclick = () => {
    const url = currentImage && source(currentImage), id = noteId() || 'xhs';
    if (!url) return;
    download(async () => {
      progress.textContent = '正在下载当前原图…';
      const { bytes, ext } = await imageBytes(url);
      saveBlob(new Blob([bytes]), `${id}_${url.split('/').pop()}.${ext}`);
      progress.textContent = '原图已交给浏览器保存';
    });
  };
  downloadAll.onclick = () => download(async () => {
    progress.textContent = '正在读取本帖图片列表…';
    const { id, images } = await noteImages();
    const files = [];
    for (let i = 0; i < images.length; i++) {
      progress.textContent = `正在下载 ${i + 1}/${images.length}…`;
      const { bytes, ext } = await imageBytes(images[i].url);
      files.push({ name: `${String(i + 1).padStart(2, '0')}.${ext}`, bytes });
    }
    progress.textContent = `正在打包 ${files.length} 张原图…`;
    saveBlob(zip(files), `${id}_originals.zip`);
    progress.textContent = `${files.length}/${images.length} 张原图已打包，已交给浏览器保存`;
  });
  document.addEventListener('error', event => {
    const record = records.get(event.target);
    if (record?.status === 'done' && event.target.getAttribute('src') === record.displayURL) {
      record.status = 'failed';
      restore(record);
      update();
    }
  }, true);
  new MutationObserver(changes => {
    // Our own layout/status updates must not trigger an observer loop.
    if (changes.some(change => !panel.contains(change.target))) schedule();
  }).observe(document.body, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset', 'class', 'style', 'hidden'],
  });
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', arrange, true);
  window.addEventListener('popstate', schedule);
  scan();
})();
