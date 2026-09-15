// IncBlog editor: Normal (Medium-style WYSIWYG).
// ponytail: no framework; document.execCommand for WYSIWYG.

const contentField = document.getElementById('content');
const formatField = document.getElementById('format');
const editorHost = document.getElementById('editor-host');
const wordCountEl = document.getElementById('word-count');
const titleInput = document.getElementById('title');
const aiError = document.getElementById('ai-error');

/* ---------------- helpers ---------------- */

function safeBox(node) {
  if (node && typeof node.getBoundingClientRect === 'function') return node.getBoundingClientRect();
  return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 };
}

function updateCounts() {
  const text = editorHost.textContent || '';
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  wordCountEl.textContent = `${words} words · ${minutes} min read`;
}

function setContent(val) { contentField.value = val; updateCounts(); }

/* ---------------- normal mode (WYSIWYG) ---------------- */

function renderNormal() {
  editorHost.classList.add('normal-host');
  editorHost.contentEditable = 'true';
  editorHost.innerHTML = contentField.value;
  if (!editorHost.innerHTML.trim()) editorHost.innerHTML = '';
  ensureGutter();
  positionGutter();
}

function syncNormalFromDom() { setContent(editorHost.innerHTML); }

function onNormalInput() { syncNormalFromDom(); positionGutter(); }

/* dynamic + button: tracks the line/paragraph the cursor is in, sits in the left gutter */
let gutterPlus = null;
function ensureGutter() {
  if (gutterPlus && document.contains(gutterPlus)) return;
  gutterPlus = document.createElement('button');
  gutterPlus.type = 'button';
  gutterPlus.className = 'gutter-add';
  gutterPlus.textContent = '+';
  gutterPlus.title = 'Add content';
  gutterPlus.hidden = true;
  gutterPlus.addEventListener('mousedown', (ev) => { ev.preventDefault(); openInsertMenu(gutterPlus); });
  editorHost.parentElement.appendChild(gutterPlus);
}

function currentBlock() {
  const sel = window.getSelection();
  let node = (sel && sel.rangeCount > 0) ? sel.anchorNode : null;
  if (node && !editorHost.contains(node)) node = null;
  if (node) {
    while (node && node.nodeType !== 1 && node.parentNode) node = node.parentNode;
    while (node && node.parentNode && node.parentNode !== editorHost) node = node.parentNode;
    if (node && editorHost.contains(node)) return node;
  }
  // No (usable) selection — fall back to the editor's first line block, or the host itself.
  // This lets the + sit on the first line on init, before the caret exists.
  const first = editorHost.firstElementChild;
  return first || editorHost;
}

function positionGutter() {
  ensureGutter();
  if (!gutterPlus) return;
  const block = currentBlock();
  if (!block) { gutterPlus.hidden = true; return; }
  const paneRect = editorHost.parentElement.getBoundingClientRect();
  const blockRect = block.getBoundingClientRect();
  // For an empty host with no block, align to the top text line inside the padding.
  const top = (block === editorHost)
    ? 8
    : Math.round(blockRect.top - paneRect.top + 4);
  gutterPlus.style.top = `${top}px`;
  gutterPlus.hidden = false;
}

/* selection toolbar */

let selToolbar;
function showFloat(el) { if (el) el.style.display = 'flex'; }
function hideFloat(el) { if (el) el.style.display = 'none'; }
function isFloatShown(el) { return !!el && el.style.display === 'flex'; }

function buildSelToolbar() {
  selToolbar = document.querySelector('.sel-toolbar');
  if (!selToolbar) return;
  selToolbar.querySelectorAll('[data-cmd]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const cmd = btn.dataset.cmd;
      if (cmd === 'h1' || cmd === 'h2' || cmd === 'h3' || cmd === 'blockquote') {
        const tag = cmd === 'blockquote' ? 'blockquote' : cmd.toUpperCase();
        document.execCommand('formatBlock', false, tag);
      } else {
        document.execCommand(cmd, false, null);
      }
      syncNormalFromDom();
      positionSelToolbar();
    });
    // Links are made by selecting text and pasting a URL (onNormalPaste), not a button.
  });
}

function positionSelToolbar() {
  if (!selToolbar) return;
  if (isFloatShown(insertMenu)) { hideFloat(selToolbar); return; }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { hideFloat(selToolbar); return; }
  if (!editorHost.contains(sel.anchorNode)) { hideFloat(selToolbar); return; }
  // Require the selection to actually be inside the editor (both anchors).
  if (sel.anchorNode && sel.focusNode && (!editorHost.contains(sel.focusNode))) { hideFloat(selToolbar); return; }
  const rect = safeBox(sel.getRangeAt(0));
  if (rect.width === 0 && rect.height === 0) { hideFloat(selToolbar); return; }
  selToolbar.style.display = 'flex';
  const top = rect.top - selToolbar.offsetHeight - 8;
  const left = rect.left + rect.width / 2 - selToolbar.offsetWidth / 2;
  // Place above the selection; if it would clip the top, drop it below.
  if (top < 8) {
    selToolbar.style.top = `${Math.round(rect.bottom + 8)}px`;
  } else {
    selToolbar.style.top = `${Math.round(top)}px`;
  }
  selToolbar.style.left = `${Math.round(Math.max(8, Math.min(left, window.innerWidth - selToolbar.offsetWidth - 8)))}px`;
}

function onSelectionChange() { positionSelToolbar(); }

/* insert menu (+ gutter) */

let insertMenu;
function buildInsertMenu() {
  insertMenu = document.querySelector('.insert-menu');
}

function openInsertMenu(anchor) {
  if (!insertMenu) return;
  const rect = safeBox(anchor);
  insertMenu.style.display = 'flex';
  // Position via viewport coords (menu is position:fixed).
  const top = Math.min(rect.bottom + 6, window.innerHeight - insertMenu.offsetHeight - 8);
  insertMenu.style.top = `${Math.max(8, top)}px`;
  insertMenu.style.left = `${Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - insertMenu.offsetWidth - 8)))}px`;
  const imgInput = insertMenu.querySelector('[data-img-url]');
  const imgBtn = insertMenu.querySelector('[data-insert="image"]');
  const insertImage = () => {
    const url = (imgInput.value || '').trim();
    if (!url) return;
    editorHost.focus();
    insertFullImage(url);
    imgInput.value = '';
    closeInsertMenu();
    syncNormalFromDom();
    positionGutter();
  };
  if (imgBtn) imgBtn.onclick = insertImage;
  if (imgInput) {
    imgInput.onkeydown = (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); insertImage(); }
      if (ev.key === 'Escape') { closeInsertMenu(); }
      ev.stopPropagation();
    };
    // Stop typing in the field from dismissing on outside-click logic.
    imgInput.addEventListener('mousedown', (ev) => ev.stopPropagation());
    setTimeout(() => imgInput.focus(), 0);
  }
  insertMenu.querySelectorAll('[data-insert]').forEach((btn) => {
    if (btn.dataset.insert === 'image') return;
    btn.onclick = () => {
      const kind = btn.dataset.insert;
      editorHost.focus();
      if (kind === 'divider') {
        document.execCommand('insertHorizontalRule', false, null);
      } else if (kind === 'h2' || kind === 'h3') {
        document.execCommand('formatBlock', false, kind.toUpperCase());
      }
      closeInsertMenu();
      syncNormalFromDom();
      positionGutter();
    };
  });
}

function insertFullImage(url) {
  document.execCommand('insertHTML', false, `<p><img src="${url}" alt="" class="editor-img"></p>`);
}

function closeInsertMenu() {
  if (!insertMenu) return;
  hideFloat(insertMenu);
  const imgInput = insertMenu.querySelector('[data-img-url]');
  if (imgInput) imgInput.value = '';
}

/* paste: auto-embed image URLs as full-size images; otherwise embed link on an empty line */

function looksLikeImage(url) {
  return /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?.*)?$/i.test(url);
}

function isUrl(s) { return /^https?:\/\/\S+$/.test((s || '').trim()); }
function selectionInEditor(sel) {
  return !!sel && sel.rangeCount > 0 && !sel.isCollapsed
    && editorHost.contains(sel.anchorNode) && editorHost.contains(sel.focusNode);
}

function onNormalPaste(e) {
  const text = (e.clipboardData || window.clipboardData).getData('text');
  if (!isUrl(text)) return;
  const url = text.trim();
  const sel = window.getSelection();
  const anchor = sel && sel.anchorNode;
  const inEmpty = (editorHost.textContent.trim() === '')
    || (anchor && anchor.nodeType === 3 && anchor.textContent === '');

  // Selecting text first, then pasting a bare URL → turn the selection into a link.
  if (selectionInEditor(sel)) {
    e.preventDefault();
    document.execCommand('createLink', false, url);
    syncNormalFromDom();
    // Re-selecting isn't possible after createLink; just refresh the toolbar.
    hideFloat(selToolbar);
    positionGutter();
    return;
  }

  // Images embed anywhere, on their own block.
  if (looksLikeImage(url)) {
    e.preventDefault();
    if (inEmpty) {
      document.execCommand('insertHTML', false, `<p><img src="${url}" alt="" class="editor-img"></p>`);
    } else {
      document.execCommand('insertHTML', false, `<p><br></p><p><img src="${url}" alt="" class="editor-img"></p><p><br></p>`);
    }
    syncNormalFromDom();
    positionGutter();
  } else if (inEmpty) {
    e.preventDefault();
    document.execCommand('insertHTML', false, `<p><a href="${url}">${url}</a></p>`);
    syncNormalFromDom();
    positionGutter();
  }
}

/* ---------------- wiring ---------------- */

buildSelToolbar();
buildInsertMenu();
// Start with both floating menus hidden (not relying on the [hidden] attr).
hideFloat(selToolbar);
hideFloat(insertMenu);

editorHost.addEventListener('input', onNormalInput);
editorHost.addEventListener('paste', onNormalPaste);
editorHost.addEventListener('keyup', positionGutter);
editorHost.addEventListener('scroll', positionGutter);
editorHost.addEventListener('click', (e) => { e.stopPropagation(); positionGutter(); });
document.addEventListener('selectionchange', onSelectionChange);
window.addEventListener('scroll', () => { positionGutter(); }, { passive: true });
window.addEventListener('resize', () => { positionGutter(); if (isFloatShown(selToolbar)) positionSelToolbar(); });
editorHost.addEventListener('blur', () => {
  setTimeout(() => { hideFloat(selToolbar); }, 150);
  setTimeout(positionGutter, 160);
});

// Dismiss both floating menus on any pointer-down outside their own bounds.
// mousedown fires before blur, so clicks on the menu/password fields keep working.
document.addEventListener('mousedown', (e) => {
  const t = e.target;
  // Selection toolbar: hide if click is outside the toolbar AND outside the editor.
  if (isFloatShown(selToolbar) && !selToolbar.contains(t) && !editorHost.contains(t)) {
    hideFloat(selToolbar);
    const sel = window.getSelection();
    if (sel && sel.rangeCount && editorHost.contains(sel.anchorNode)) sel.removeAllRanges();
  }
  // Insert menu: hide if click is outside the menu AND not on the + button.
  if (isFloatShown(insertMenu) && !insertMenu.contains(t) && !(gutterPlus && t === gutterPlus)) {
    closeInsertMenu();
  }
});

// initial render
renderNormal();
updateCounts();

/* ---------------- scheduled status ---------------- */

const statusSelect = document.getElementById('status');
const scheduleField = document.getElementById('schedule-field');
function syncSchedule() { scheduleField.hidden = statusSelect.value !== 'scheduled'; }
statusSelect.addEventListener('change', syncSchedule);
syncSchedule();

/* ---------------- AI helpers ---------------- */

function showError(message) {
  aiError.textContent = message;
  aiError.hidden = false;
  setTimeout(() => { aiError.hidden = true; }, 6000);
}

async function callAi(endpoint, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Thinking…';
  try {
    const res = await fetch(`/api/ai/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ title: titleInput.value, content: contentField.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'AI request failed');
    return data;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

document.getElementById('ai-excerpt').addEventListener('click', async (e) => {
  try {
    const data = await callAi('excerpt', e.target);
    document.getElementById('excerpt').value = data.excerpt;
  } catch (err) { showError(err.message); }
});

document.getElementById('ai-summary').addEventListener('click', async (e) => {
  try {
    const data = await callAi('summary', e.target);
    document.getElementById('summary').value = data.summary;
  } catch (err) { showError(err.message); }
});

document.getElementById('ai-titles').addEventListener('click', async (e) => {
  try {
    const data = await callAi('titles', e.target);
    const box = document.getElementById('title-suggestions');
    box.innerHTML = '';
    data.titles.forEach((t) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost btn-sm';
      btn.textContent = t;
      btn.addEventListener('click', () => { titleInput.value = t; box.innerHTML = ''; });
      box.appendChild(btn);
    });
  } catch (err) { showError(err.message); }
});

document.getElementById('post-form').addEventListener('submit', () => {
  setContent(editorHost.innerHTML);
});
