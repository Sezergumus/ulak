'use strict';
const output = document.querySelector('#output');
async function run(command, args = {}) {
  try { output.textContent = JSON.stringify(await window.__TAURI__.core.invoke(command, args), null, 2); }
  catch (error) { output.textContent = String(error); }
}
document.querySelector('#refresh').onclick = () => run('snapshot');
document.querySelector('#run').onclick = () => {
  try { run(document.querySelector('#command').value, JSON.parse(document.querySelector('#arguments').value)); }
  catch (error) { output.textContent = error.message; }
};
window.__TAURI__.event.listen('transfer', event => { output.textContent = JSON.stringify(event.payload, null, 2); });
window.__TAURI__.event.listen('server-error', event => { output.textContent = event.payload; });
run('snapshot');
