'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';

const listEl = document.querySelector('#files');
const columnsEl = document.querySelector('#columns');
const colMetaLabelEl = document.querySelector('#col-meta-label');
const breadcrumbsEl = document.querySelector('#breadcrumbs');
const filterInput = document.querySelector('#filter');
const filterClearBtn = document.querySelector('#filter-clear');
const downloadFolderBtn = document.querySelector('#download-folder');
const itemCountEl = document.querySelector('#item-count');
const moreWrapEl = document.querySelector('#more-wrap');
const moreBtn = document.querySelector('#more');
const emptyEl = document.querySelector('#empty');
const emptyTitleEl = document.querySelector('#empty-title');
const emptyDescEl = document.querySelector('#empty-desc');
const emptyInviteBtn = document.querySelector('#empty-invite');
const statusBannerEl = document.querySelector('#status-banner');
const statusIconEl = document.querySelector('#status-icon');
const statusTextEl = document.querySelector('#status');
const statusDismissBtn = document.querySelector('#status-dismiss');
const invitePanelEl = document.querySelector('#invite-panel');
const inviteToggleBtn = document.querySelector('#invite-toggle');
const inviteCloseBtn = document.querySelector('#invite-close');
const inviteForm = document.querySelector('#invite');
const tokenInput = document.querySelector('#token');
const inviteSubmitBtn = document.querySelector('#invite-submit');
const refreshBtn = document.querySelector('#refresh');
const refreshIcon = document.querySelector('#refresh-icon');
const homeBtn = document.querySelector('#home');

let stack = [{ share: null, entry: null, name: 'Shares' }];
let loadedItems = [];
let nextCursor = null;
let preparingId = null;
let folderAbort = null;
let requestSeq = 0;
let inviteDismissed = false;
let reducedMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

function formatSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** unit).toFixed(1)} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
}

function createIcon(kind, size = 17, extraClass = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (extraClass) svg.setAttribute('class', extraClass);

  const add = (tag, attrs) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  };

  if (kind === 'folder') {
    add('path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' });
  } else if (kind === 'file') {
    add('path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' });
    add('path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' });
  } else if (kind === 'chevron') {
    add('path', { d: 'm9 18 6-6-6-6' });
  } else if (kind === 'download') {
    add('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' });
    add('polyline', { points: '7 10 12 15 17 10' });
    add('line', { x1: '12', x2: '12', y1: '15', y2: '3' });
  } else if (kind === 'spinner') {
    add('path', { d: 'M21 12a9 9 0 1 1-6.219-8.56' });
  } else if (kind === 'alert') {
    add('circle', { cx: '12', cy: '12', r: '10' });
    add('line', { x1: '12', x2: '12', y1: '8', y2: '12' });
    add('line', { x1: '12', x2: '12.01', y1: '16', y2: '16' });
  } else if (kind === 'check') {
    add('path', { d: 'M20 6 9 17l-5-5' });
  }
  return svg;
}

function setStatus(kind, content) {
  if (!content) {
    statusBannerEl.hidden = true;
    statusBannerEl.className = 'status-banner';
    statusTextEl.replaceChildren();
    statusIconEl.replaceChildren();
    return;
  }
  statusBannerEl.hidden = false;
  statusBannerEl.className = kind ? `status-banner ${kind}` : 'status-banner';
  statusIconEl.replaceChildren(
    createIcon(
      kind === 'error' ? 'alert' : kind === 'ready' ? 'check' : 'spinner',
      15,
      kind === 'loading' ? 'spin' : ''
    )
  );
  if (typeof content === 'string') {
    statusTextEl.textContent = content;
  } else {
    statusTextEl.replaceChildren(...content);
  }
}

function setInviteOpen(open, focusInput = false) {
  invitePanelEl.classList.toggle('open', open);
  invitePanelEl.setAttribute('aria-hidden', open ? 'false' : 'true');
  inviteToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open && focusInput) {
    setTimeout(() => tokenInput.focus(), 60);
  }
}

function renderBreadcrumbs() {
  breadcrumbsEl.replaceChildren();
  stack.forEach((crumb, index) => {
    if (index > 0) {
      const sep = createIcon('chevron', 13, 'crumb-sep');
      breadcrumbsEl.append(sep);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'crumb';
    const label = document.createElement('span');
    label.textContent = crumb.name;
    btn.append(label);
    const isLast = index === stack.length - 1;
    if (isLast) {
      btn.setAttribute('aria-current', 'page');
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => {
        stack = stack.slice(0, index + 1);
        filterInput.value = '';
        updateFilterClear();
        void loadCurrent(false, true);
      });
    }
    breadcrumbsEl.append(btn);
  });
}

function updateFilterClear() {
  filterClearBtn.hidden = filterInput.value.length === 0;
}

function renderList(animateEnter = false) {
  const current = stack[stack.length - 1];
  const atRoot = current.share === null;
  const query = filterInput.value.trim().toLocaleLowerCase();
  const visible = query
    ? loadedItems.filter(item => item.name.toLocaleLowerCase().includes(query))
    : loadedItems;

  colMetaLabelEl.textContent = atRoot ? 'Type' : 'Size';
  columnsEl.hidden = visible.length === 0;
  downloadFolderBtn.hidden = atRoot || loadedItems.length === 0;
  downloadFolderBtn.disabled = Boolean(folderAbort || preparingId);
  listEl.replaceChildren();

  itemCountEl.textContent =
    loadedItems.length === 0
      ? ''
      : query
        ? `${visible.length} of ${loadedItems.length}`
        : `${loadedItems.length} ${loadedItems.length === 1 ? 'item' : 'items'}`;

  if (visible.length === 0) {
    emptyEl.hidden = false;
    if (loadedItems.length > 0 && query) {
      emptyTitleEl.textContent = `No matches for "${filterInput.value.trim()}"`;
      emptyDescEl.textContent = 'Try a different search term or clear the filter.';
      emptyInviteBtn.hidden = true;
    } else if (atRoot) {
      emptyTitleEl.textContent = 'No shared files available';
      emptyDescEl.textContent = 'Shares open to everyone on the local network appear automatically. Private shares require an invitation code.';
      emptyInviteBtn.hidden = false;
    } else {
      emptyTitleEl.textContent = 'This folder is empty';
      emptyDescEl.textContent = 'There are no files or subfolders inside this share.';
      emptyInviteBtn.hidden = true;
    }
  } else {
    emptyEl.hidden = true;
  }

  for (const item of visible) {
    const li = document.createElement('li');
    li.className = 'file-item';

    const row = document.createElement('button');
    row.type = 'button';
    const unavailable = item.available === false;
    const isPreparing = preparingId === item.id;
    row.className = unavailable ? 'list-row unavailable' : 'list-row';
    row.disabled = unavailable || isPreparing || Boolean(folderAbort);

    const iconWrap = document.createElement('span');
    iconWrap.className = isPreparing
      ? 'row-icon preparing'
      : item.is_dir
        ? 'row-icon folder'
        : 'row-icon';
    iconWrap.append(
      createIcon(
        isPreparing ? 'spinner' : item.is_dir ? 'folder' : 'file',
        18,
        isPreparing ? 'spin' : ''
      )
    );

    const main = document.createElement('span');
    main.className = 'row-main';
    const title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = item.name;
    const sub = document.createElement('span');
    sub.className = isPreparing ? 'row-sub accent' : 'row-sub';
    if (isPreparing) {
      sub.textContent = 'Preparing download…';
    } else if (unavailable) {
      sub.textContent = 'Source currently unavailable';
    } else if (atRoot) {
      sub.textContent = item.is_dir ? 'Shared folder' : 'Shared file';
    } else {
      sub.textContent = item.is_dir ? 'Folder' : 'Tap to download';
    }
    main.append(title, sub);

    const meta = document.createElement('span');
    meta.className = 'row-meta';
    if (unavailable) {
      meta.textContent = '—';
    } else if (item.is_dir) {
      meta.textContent = 'Folder';
    } else if (typeof item.size === 'number') {
      meta.textContent = formatSize(item.size);
    } else {
      meta.textContent = 'File';
    }

    const action = document.createElement('span');
    action.className = 'row-action';
    action.append(createIcon(atRoot || item.is_dir ? 'chevron' : 'download', 15));

    row.append(iconWrap, main, meta, action);
    row.addEventListener('click', () => {
      if (atRoot) {
        stack.push({ share: item.id, entry: null, name: item.name });
        filterInput.value = '';
        updateFilterClear();
        void loadCurrent(false, true);
      } else if (item.is_dir) {
        stack.push({ share: current.share, entry: item.id, name: item.name });
        filterInput.value = '';
        updateFilterClear();
        void loadCurrent(false, true);
      } else {
        void download(current.share, item);
      }
    });

    li.append(row);
    if (item.is_dir && !unavailable) {
      const dlBtn = document.createElement('button');
      dlBtn.type = 'button';
      dlBtn.className = 'row-dl-btn';
      dlBtn.disabled = Boolean(folderAbort || preparingId);
      dlBtn.setAttribute('aria-label', `Download folder ${item.name}`);
      dlBtn.title = `Download folder ${item.name}`;
      dlBtn.append(createIcon('download', 15));
      dlBtn.addEventListener('click', () => {
        const shareId = atRoot ? item.id : current.share;
        const entryId = atRoot ? null : item.id;
        void downloadFolder(shareId, entryId, item.name);
      });
      li.append(dlBtn);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'row-dl-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      li.append(spacer);
    }
    listEl.append(li);
  }

  moreWrapEl.hidden = !nextCursor;

  if (animateEnter && !(reducedMotionQuery && reducedMotionQuery.matches)) {
    listEl.classList.add('entering');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        listEl.classList.remove('entering');
      });
    });
  } else {
    listEl.classList.remove('entering');
  }
}

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const error = new Error(
      response.status === 401 || response.status === 403
        ? 'Access is unavailable. Enter a valid invitation code or ask the owner for permission.'
        : 'Could not open these files. Check that Ulak is still open on the host computer, then try again.'
    );
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function loadCurrent(append = false, animateEnter = false) {
  const current = stack[stack.length - 1];
  const seq = ++requestSeq;
  renderBreadcrumbs();
  refreshIcon.classList.add('spin');
  moreBtn.disabled = true;

  try {
    const query = new URLSearchParams();
    if (current.entry) query.set('entry', current.entry);
    if (append && nextCursor) query.set('cursor', nextCursor);
    const base = current.share
      ? `/v1/shares/${encodeURIComponent(current.share)}/entries`
      : '/v1/shares';
    const qs = query.toString();
    const data = await api(qs ? `${base}?${qs}` : base);
    if (seq !== requestSeq) return;

    loadedItems = append ? loadedItems.concat(data.items) : data.items;
    nextCursor = data.next_cursor;
    renderList(animateEnter && !append);

    if (current.share === null && loadedItems.length === 0 && !inviteDismissed) {
      setInviteOpen(true, false);
    }
  } catch (error) {
    if (seq !== requestSeq) return;
    setStatus('error', error.message);
    if (error.status === 401 || error.status === 403) {
      setInviteOpen(true, true);
    }
  } finally {
    if (seq === requestSeq) {
      refreshIcon.classList.remove('spin');
      moreBtn.disabled = false;
    }
  }
}

async function download(shareId, item) {
  if (preparingId || folderAbort) return;
  preparingId = item.id;
  renderList(false);
  setStatus('loading', `Preparing ${item.name}…`);

  try {
    const query = new URLSearchParams({ entry: item.id });
    const info = await api(`/v1/shares/${encodeURIComponent(shareId)}/prepare?${query}`);
    query.set('revision', info.revision);

    const link = document.createElement('a');
    link.href = `/v1/shares/${encodeURIComponent(shareId)}/file?${query}`;
    link.download = item.name;
    link.textContent = 'Download again';

    const lead = document.createTextNode(`Download started for ${item.name} · `);
    setStatus('ready', [lead, link]);
    link.click();
  } catch (error) {
    setStatus('error', error.message);
  } finally {
    preparingId = null;
    renderList(false);
  }
}

function safeName(name) {
  const cleaned = String(name || 'file')
    .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_')
    .trim()
    .replace(/[.\s]+$/, '');
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'item';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(cleaned) ? `_${cleaned}` : cleaned;
}

function isDisallowedNameError(error) {
  if (!error) return false;
  return (
    error.name === 'TypeError' ||
    error.name === 'SecurityError' ||
    /name is not allowed/i.test(error.message || '')
  );
}

function triggerBrowserDownload(shareId, entryId, fileName, revision) {
  const query = new URLSearchParams({ entry: entryId, revision });
  const link = document.createElement('a');
  link.href = `/v1/shares/${encodeURIComponent(shareId)}/file?${query}`;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
}

function waitAbortable(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Cancelled', 'AbortError'));
      },
      { once: true }
    );
  });
}

async function listAllEntries(shareId, entryId, signal) {
  const items = [];
  let cursor = null;
  do {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const query = new URLSearchParams();
    if (entryId) query.set('entry', entryId);
    if (cursor) query.set('cursor', cursor);
    const qs = query.toString();
    const data = await api(
      `/v1/shares/${encodeURIComponent(shareId)}/entries${qs ? `?${qs}` : ''}`,
      { signal }
    );
    items.push(...data.items);
    cursor = data.next_cursor;
  } while (cursor);
  return items;
}

function makeCancelButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'status-action';
  btn.textContent = 'Cancel';
  btn.addEventListener('click', () => {
    if (folderAbort) folderAbort.abort();
  });
  return btn;
}

async function downloadFolder(shareId, entryId, folderName) {
  if (preparingId || folderAbort) return;
  const controller = new AbortController();
  folderAbort = controller;
  renderList(false);

  try {
    if (typeof window.showDirectoryPicker === 'function') {
      const picked = await window.showDirectoryPicker({ mode: 'readwrite' });
      let targetRoot = null;
      try {
        targetRoot = await picked.getDirectoryHandle(safeName(folderName), { create: true });
      } catch (err) {
        if (!isDisallowedNameError(err)) throw err;
      }
      const dirs = [{ entry: entryId, dirHandle: targetRoot }];
      let saved = 0;
      let fallbackCount = 0;

      while (dirs.length > 0) {
        const next = dirs.shift();
        const entries = await listAllEntries(shareId, next.entry, controller.signal);
        for (const item of entries) {
          if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
          if (item.is_dir) {
            let subHandle = null;
            if (next.dirHandle) {
              try {
                subHandle = await next.dirHandle.getDirectoryHandle(safeName(item.name), { create: true });
              } catch (err) {
                if (!isDisallowedNameError(err)) throw err;
              }
            }
            dirs.push({ entry: item.id, dirHandle: subHandle });
          } else {
            setStatus('loading', [
              document.createTextNode(
                `Saving ${folderName}: ${item.name} (${saved + fallbackCount} processed)`
              ),
              makeCancelButton(),
            ]);
            const query = new URLSearchParams({ entry: item.id });
            const info = await api(
              `/v1/shares/${encodeURIComponent(shareId)}/prepare?${query}`,
              { signal: controller.signal }
            );
            query.set('revision', info.revision);

            let fileHandle = null;
            if (next.dirHandle) {
              try {
                fileHandle = await next.dirHandle.getFileHandle(safeName(item.name), { create: true });
              } catch (err) {
                if (!isDisallowedNameError(err)) throw err;
              }
            }

            if (!fileHandle) {
              triggerBrowserDownload(shareId, item.id, item.name, info.revision);
              fallbackCount += 1;
              await waitAbortable(350, controller.signal);
              continue;
            }

            const response = await fetch(
              `/v1/shares/${encodeURIComponent(shareId)}/file?${query}`,
              { signal: controller.signal }
            );
            if (!response.ok || !response.body) {
              throw new Error(`Could not download ${item.name}.`);
            }
            const writable = await fileHandle.createWritable();
            try {
              await response.body.pipeTo(writable, { signal: controller.signal });
            } catch (err) {
              await writable.abort().catch(() => {});
              throw err;
            }
            saved += 1;
          }
        }
      }

      if (saved === 0 && fallbackCount === 0) {
        setStatus('ready', `${folderName} is empty (0 files).`);
      } else if (fallbackCount > 0 && saved === 0) {
        setStatus(
          'ready',
          `Sent ${fallbackCount} ${fallbackCount === 1 ? 'file' : 'files'} from ${folderName} to browser Downloads (blocked from direct folder writes).`
        );
      } else if (fallbackCount > 0) {
        setStatus(
          'ready',
          `Saved ${saved} ${saved === 1 ? 'file' : 'files'} to ${folderName}; sent ${fallbackCount} browser-restricted ${fallbackCount === 1 ? 'file' : 'files'} to Downloads.`
        );
      } else {
        setStatus('ready', `Saved ${folderName} (${saved} ${saved === 1 ? 'file' : 'files'}).`);
      }
      return;
    }

    // Fallback for browsers without directory picker support: stream individual downloads sequentially.
    const dirs = [entryId];
    const files = [];
    setStatus('loading', [
      document.createTextNode(`Scanning ${folderName}…`),
      makeCancelButton(),
    ]);
    while (dirs.length > 0) {
      const nextEntry = dirs.shift();
      const entries = await listAllEntries(shareId, nextEntry, controller.signal);
      for (const item of entries) {
        if (item.is_dir) dirs.push(item.id);
        else files.push(item);
      }
    }
    if (files.length === 0) {
      setStatus('ready', `${folderName} is empty (0 files).`);
      return;
    }
    let started = 0;
    for (const file of files) {
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      setStatus('loading', [
        document.createTextNode(`Downloading ${started + 1} of ${files.length}: ${file.name}`),
        makeCancelButton(),
      ]);
      const query = new URLSearchParams({ entry: file.id });
      const info = await api(
        `/v1/shares/${encodeURIComponent(shareId)}/prepare?${query}`,
        { signal: controller.signal }
      );
      triggerBrowserDownload(shareId, file.id, file.name, info.revision);
      started += 1;
      if (started < files.length) {
        await waitAbortable(350, controller.signal);
      }
    }
    setStatus(
      'ready',
      `Started ${started} ${started === 1 ? 'file download' : 'file downloads'} from ${folderName}.`
    );
  } catch (error) {
    if (error && error.name === 'AbortError') {
      setStatus('', null);
    } else {
      setStatus('error', error?.message || 'Could not download this folder.');
    }
  } finally {
    folderAbort = null;
    renderList(false);
  }
}

function extractInviteToken(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.includes('#invite=')) {
    const hash = trimmed.slice(trimmed.indexOf('#') + 1);
    return new URLSearchParams(hash).get('invite')?.trim() || '';
  }
  if (trimmed.startsWith('invite=')) {
    return new URLSearchParams(trimmed).get('invite')?.trim() || '';
  }
  return trimmed;
}

async function redeemToken(rawToken) {
  const token = extractInviteToken(rawToken);
  if (!token) {
    setStatus('error', 'Paste an invitation code or guest link first.');
    tokenInput.focus();
    return;
  }

  inviteSubmitBtn.disabled = true;
  inviteSubmitBtn.textContent = 'Opening…';
  try {
    await api('/v1/guest/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    tokenInput.value = '';
    setInviteOpen(false, false);
    setStatus('ready', 'Invitation accepted. Showing your shared files.');
    stack = [{ share: null, entry: null, name: 'Shares' }];
    filterInput.value = '';
    updateFilterClear();
    await loadCurrent(false, true);
  } catch (error) {
    setStatus('error', error.message);
  } finally {
    inviteSubmitBtn.disabled = false;
    inviteSubmitBtn.textContent = 'Open invitation';
  }
}

inviteForm.addEventListener('submit', event => {
  event.preventDefault();
  void redeemToken(tokenInput.value);
});

inviteToggleBtn.addEventListener('click', () => {
  const isOpen = invitePanelEl.classList.contains('open');
  if (isOpen) inviteDismissed = true;
  setInviteOpen(!isOpen, !isOpen);
});

inviteCloseBtn.addEventListener('click', () => {
  inviteDismissed = true;
  setInviteOpen(false, false);
});

emptyInviteBtn.addEventListener('click', () => {
  setInviteOpen(true, true);
});

statusDismissBtn.addEventListener('click', () => {
  setStatus('', null);
});

homeBtn.addEventListener('click', () => {
  stack = [{ share: null, entry: null, name: 'Shares' }];
  filterInput.value = '';
  updateFilterClear();
  void loadCurrent(false, true);
});

refreshBtn.addEventListener('click', () => {
  setStatus('', null);
  void loadCurrent(false, false);
});

moreBtn.addEventListener('click', () => {
  void loadCurrent(true, false);
});

filterInput.addEventListener('input', () => {
  updateFilterClear();
  renderList(false);
});

filterClearBtn.addEventListener('click', () => {
  filterInput.value = '';
  updateFilterClear();
  renderList(false);
  filterInput.focus();
});

downloadFolderBtn.addEventListener('click', () => {
  const current = stack[stack.length - 1];
  if (current.share) {
    void downloadFolder(current.share, current.entry, current.name);
  }
});

document.addEventListener('keydown', event => {
  const inInput = document.activeElement === tokenInput || document.activeElement === filterInput;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    filterInput.focus();
    filterInput.select();
  } else if (event.key === '/' && !inInput) {
    event.preventDefault();
    filterInput.focus();
  } else if (event.key === 'Escape') {
    if (document.activeElement === filterInput && filterInput.value) {
      filterInput.value = '';
      updateFilterClear();
      renderList(false);
    } else if (invitePanelEl.classList.contains('open')) {
      inviteDismissed = true;
      setInviteOpen(false, false);
    }
  }
});

const invitationToken = new URLSearchParams(location.hash.slice(1)).get('invite');
if (invitationToken) {
  history.replaceState(null, '', location.pathname + location.search);
  void redeemToken(invitationToken);
} else {
  void loadCurrent(false, false);
}
