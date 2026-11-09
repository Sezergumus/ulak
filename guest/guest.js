'use strict';
const list = document.querySelector('#files');
const status = document.querySelector('#status');
const more = document.querySelector('#more');
let locationState = { share: null, entry: null, cursor: null };
async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`Request failed (${response.status}). Check access or reopen the folder.`);
  return response.json();
}
async function browse(share = null, entry = null, append = false) {
  try {
    const query = new URLSearchParams();
    if (entry) query.set('entry', entry);
    if (append && locationState.cursor) query.set('cursor', locationState.cursor);
    const data = await api((share ? `/v1/shares/${encodeURIComponent(share)}/entries` : '/v1/shares') + '?' + query);
    if (!append) list.replaceChildren();
    locationState = { share, entry, cursor: data.next_cursor };
    for (const item of data.items) {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.textContent = `${item.is_dir ? 'Folder · ' : ''}${item.name}${item.available === false ? ' · Unavailable' : ''}`;
      button.disabled = item.available === false;
      button.onclick = () => !share ? browse(item.id) : item.is_dir ? browse(share, item.id) : download(share, item);
      row.append(button); list.append(row);
    }
    more.hidden = !data.next_cursor;
    status.textContent = list.children.length ? '' : 'No accessible shares or files.';
  } catch (error) { status.textContent = error.message; }
}
async function download(share, item) {
  try {
    status.textContent = 'Preparing and verifying source metadata…';
    const query = new URLSearchParams({ entry: item.id });
    const info = await api(`/v1/shares/${encodeURIComponent(share)}/prepare?${query}`);
    query.set('revision', info.revision);
    const link = document.createElement('a');
    link.href = `/v1/shares/${encodeURIComponent(share)}/file?${query}`;
    link.download = item.name; link.textContent = `Download ${item.name}`;
    status.replaceChildren(link);
    link.click();
  } catch (error) { status.textContent = error.message; }
}
document.querySelector('#invite').onsubmit = async event => {
  event.preventDefault();
  try {
    await api('/v1/guest/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: document.querySelector('#token').value.trim() }) });
    document.querySelector('#token').value = '';
    await browse();
  } catch (error) { status.textContent = error.message; }
};
document.querySelector('#home').onclick = () => browse();
more.onclick = () => browse(locationState.share, locationState.entry, true);
browse();
