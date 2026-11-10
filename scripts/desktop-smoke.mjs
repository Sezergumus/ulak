import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import https from "node:https";
import net from "node:net";

const [port, fixture, executable] = process.argv.slice(2);
const state = join(fixture, "state");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let page;
for (let attempt = 0; attempt < 80; attempt++) {
  try {
    page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(
      (page) => page.type === "page",
    );
    if (page) break;
  } catch {}
  await delay(250);
}
assert.ok(page, "WebView debug target did not appear");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
let sequence = 0;
const pending = new Map();
const errors = [];
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown")
    errors.push(message.params.exceptionDetails.text);
  const item = pending.get(message.id);
  if (item) {
    pending.delete(message.id);
    clearTimeout(item.timer);
    message.error
      ? item.reject(new Error(message.error.message))
      : item.resolve(message.result);
  }
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 20000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const value = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (value.exceptionDetails)
    throw new Error(
      value.exceptionDetails.exception?.description ??
        value.exceptionDetails.text,
    );
  return value.result.value;
}
const invoke = async (name, args = {}) => {
  const value = await evaluate(
    `window.__TAURI__.core.invoke(${JSON.stringify(name)}, ${JSON.stringify(args)}).then(result => ({result}), error => ({error:String(error)}))`,
  );
  if (value.error) throw new Error(value.error);
  return value.result;
};
const cli = (args) =>
  JSON.parse(
    execFileSync(executable, ["--data", state, ...args], { encoding: "utf8" }),
  );
async function until(expression) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await evaluate(expression)) return;
    await delay(150);
  }
  throw new Error(`Condition did not become true: ${expression}`);
}
async function click(text) {
  assert.ok(
    await evaluate(
      `(() => { const scope = document.querySelector('[role=dialog]') ?? document; const button = [...scope.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!button) return false; button.click(); return true; })()`,
    ),
    `Missing button: ${text}`,
  );
  await delay(150);
}
async function screenshot(name) {
  const result = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(fixture, name), Buffer.from(result.data, "base64"));
}
async function key(key, code, modifiers = 0) {
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code,
    modifiers,
  });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
}
async function checkLayout() {
  const metrics = await evaluate(`(() => {
    const main = document.querySelector('main');
    const details = document.querySelector('.details');
    const row = main.querySelector('.list-row');
    return {
      pageFits: document.documentElement.scrollWidth <= innerWidth,
      listFits: main.scrollWidth <= main.clientWidth,
      detailsFit: !details || details.scrollWidth <= details.clientWidth,
      actionsFit: document.querySelector('.topbar .actions').getBoundingClientRect().right <= innerWidth,
      titleSize: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
      rowHeight: row?.getBoundingClientRect().height ?? 0,
    };
  })()`);
  assert.equal(metrics.pageFits, true);
  assert.equal(metrics.listFits, true);
  assert.equal(metrics.detailsFit, true);
  assert.equal(metrics.actionsFit, true);
  assert.ok(metrics.titleSize <= 16, "View title must remain compact");
  assert.ok(metrics.rowHeight <= 56, "List rows must remain compact");
}
function httpsJson(url, ca, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { ca, ...options }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () =>
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}
try {
  await send("Runtime.enable");
  await until(`document.querySelector('.brand')?.textContent.includes('ulak')`);
  await until(`window.__TAURI__.core.invoke('snapshot').then(s => s.serving)`);
  const snapshot = await invoke("snapshot");
  assert.equal(snapshot.service_error, null);
  await assert.rejects(
    invoke("apply_network", {
      network: { ...snapshot.network, bind: "127.0.0.1:0" },
      name: snapshot.identity.name,
    }),
  );
  assert.equal((await invoke("snapshot")).serving, true);
  const occupied = net.createServer();
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  try {
    const port = occupied.address().port;
    await assert.rejects(
      invoke("apply_network", {
        network: {
          ...snapshot.network,
          endpoint: `https://127.0.0.1:${port}/`,
          bind: `127.0.0.1:${port}`,
        },
        name: "Temporary name",
      }),
      /Previous connection settings restored/,
    );
    assert.equal(
      (await invoke("snapshot")).identity.name,
      snapshot.identity.name,
    );
    await until(
      `window.__TAURI__.core.invoke('snapshot').then(s => s.serving)`,
    );
  } finally {
    occupied.close();
  }
  await click("Connection settings");
  await until(`!!document.querySelector('.dialog select:not(:disabled)')`);
  assert.equal(
    await evaluate(`document.querySelector('.dialog .advanced').open`),
    false,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.dialog').textContent.includes('Public CA fingerprint')`,
    ),
    false,
  );
  await screenshot("connection-settings.png");
  const networks = await invoke("network_choices");
  assert.ok(Array.isArray(networks));
  if (networks.length) {
    const choice = networks[0];
    assert.match(choice.range, /^\d+\.\d+\.\d+\.\d+\/\d+$/);
    await evaluate(`(() => {
      const select = document.querySelector('.dialog select');
      select.value = ${JSON.stringify(choice.address)};
      select.dispatchEvent(new Event('change', {bubbles: true}));
    })()`);
    await until(
      `document.querySelector('.dialog').textContent.includes(${JSON.stringify(`https://${choice.address}:`)})`,
    );
    assert.equal(
      (await invoke("snapshot")).network.endpoint,
      snapshot.network.endpoint,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('input[placeholder="192.168.1.0/24"]').value`,
      ),
      choice.range,
    );
  }
  await evaluate(
    `document.querySelector('[aria-label="Close dialog"]').click()`,
  );
  await click("Connect a device");
  assert.equal(
    await evaluate(
      `document.querySelector('.dialog').textContent.includes('Discovery alone')`,
    ),
    false,
  );
  await screenshot("connect-device.png");
  await click("Create an invitation");
  assert.equal(
    await evaluate(
      `[...document.querySelectorAll('.dialog button')].find(button => button.textContent === 'Create invitation').disabled`,
    ),
    true,
  );
  await screenshot("create-invitation-network-setup.png");
  await click("Set up network sharing");
  await until(`!!document.querySelector('.dialog select:not(:disabled)')`);
  await click("Close");
  await until(
    `document.querySelector('[role=dialog] h2')?.textContent === 'Connect a device'`,
  );
  await evaluate(
    `document.querySelector('[aria-label="Close dialog"]').click()`,
  );
  await screenshot("devices.png");
  await checkLayout();
  await key("f", "KeyF", 2);
  assert.equal(
    await evaluate(`document.activeElement?.getAttribute('aria-label')`),
    "Filter current list",
  );
  await key("k", "KeyK", 2);
  await until(
    `document.querySelector('[role=dialog]')?.textContent.includes('Commands')`,
  );
  await until(`document.activeElement?.hasAttribute('cmdk-input')`);
  await send("Input.insertText", { text: "Transfers" });
  await until(
    `document.querySelector('[cmdk-item][data-selected=true]')?.textContent === 'Transfers'`,
  );
  await key("Enter", "Enter");
  await until(
    `document.querySelector('h1')?.textContent === 'Transfers' && !document.querySelector('[role=dialog]')`,
  );
  const source = join(fixture, "sample.txt");
  const content = "Ulak desktop and local CLI verified transfer.\n";
  await writeFile(source, content);
  const share = cli(["share", source]);
  assert.equal(share.audience.kind, "private");
  await evaluate(`document.querySelectorAll('nav button')[1].click()`);
  await until(
    `document.querySelector('main')?.textContent.includes('sample.txt')`,
  );
  await evaluate(`document.querySelector('main .list-row').click()`);
  await click("Manage access");
  await screenshot("audience.png");
  await evaluate(
    `document.querySelectorAll('input[name=audience]')[2].click()`,
  );
  await click("Save access");
  await until(`!document.querySelector('[role=dialog]')`);
  assert.equal((await invoke("snapshot")).shares[0].share.audience.kind, "lan");
  await screenshot("shares.png");
  await checkLayout();
  await send("Emulation.setDeviceMetricsOverride", {
    width: 820,
    height: 560,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await delay(150);
  await checkLayout();
  await screenshot("shares-compact.png");
  await send("Emulation.clearDeviceMetricsOverride");
  await click("Guest invitation");
  await click("Create invitation");
  await until(
    `[...document.querySelectorAll('.dialog textarea')].some(area => area.value.includes('#invite='))`,
  );
  const link = await evaluate(
    `[...document.querySelectorAll('.dialog textarea')].find(area => area.value.includes('#invite=')).value`,
  );
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get("invite");
  const descriptor = await invoke("connection_descriptor", {
    endpoint: snapshot.network.endpoint,
  });
  const redemption = await httpsJson(
    new URL("/v1/guest/redeem", descriptor.endpoint),
    descriptor.ca_pem,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    },
  );
  assert.equal(redemption.status, 200);
  const replay = await httpsJson(
    new URL("/v1/guest/redeem", descriptor.endpoint),
    descriptor.ca_pem,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    },
  );
  assert.equal(replay.status, 401);
  await evaluate(
    `document.querySelector('[aria-label="Close dialog"]').click()`,
  );
  await evaluate(`document.querySelectorAll('nav button')[0].click()`);
  await click("Connect a device");
  await evaluate(`document.querySelector('.dialog details summary').click()`);
  await evaluate(`document.querySelector('.dialog details textarea').focus()`);
  await send("Input.insertText", { text: JSON.stringify(descriptor) });
  await click("Browse shared files");
  await until(
    `document.querySelector('.remote-browser .row-link')?.textContent.includes('sample.txt')`,
  );
  await evaluate(`document.querySelector('.remote-browser .row-link').click()`);
  await until(`!!document.querySelector('[aria-label="Select sample.txt"]')`);
  await checkLayout();
  await screenshot("remote-browser.png");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 820,
    height: 560,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await delay(150);
  await checkLayout();
  await screenshot("remote-browser-compact.png");
  await send("Emulation.clearDeviceMetricsOverride");
  const config = await (
    await fetch(`http://${snapshot.network.onboarding}/`)
  ).text();
  assert.ok(config.includes(snapshot.ca_fingerprint));
  const descriptorPath = join(fixture, "remote.json");
  await writeFile(descriptorPath, JSON.stringify(descriptor));
  const entries = cli([
    "list",
    "--remote",
    descriptorPath,
    "--share",
    share.id,
  ]);
  const download = cli([
    "download",
    "--remote",
    descriptorPath,
    "--share",
    share.id,
    "--entry",
    entries.items[0].id,
    "--destination",
    join(fixture, "downloads"),
  ]);
  assert.equal(download.state, "completed");
  assert.equal(await readFile(download.destination, "utf8"), content);
  await evaluate(`document.querySelectorAll('nav button')[2].click()`);
  await until(
    `document.querySelector('main')?.textContent.includes('sample.txt')`,
  );
  await screenshot("transfers.png");
  await invoke("plugin:window|close", { label: "main" });
  assert.equal(
    await invoke("plugin:window|is_visible", { label: "main" }),
    false,
  );
  assert.equal(cli(["status"]).transfers[0].state, "completed");
  await invoke("plugin:window|show", { label: "main" });
  assert.equal(
    await invoke("plugin:window|is_visible", { label: "main" }),
    true,
  );
  assert.deepEqual(errors, []);
  await invoke("quit_app");
  console.log(
    "PASS: native WebView, network adapter choices and unapplied settings, simplified connection dialogs, keyboard shortcuts/command navigation, compact share/browser layout at 1080 and 820 pixels, share audience UI, guest invitation/redemption, LAN-open browsing, certificate setup, live CLI download, close-to-tray service continuity, window reopening, explicit quit.",
  );
} catch (error) {
  await screenshot("failure.png").catch(() => {});
  throw error;
} finally {
  socket.close();
}
