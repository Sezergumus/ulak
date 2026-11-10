import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const [senderPort, receiverPort, fixture, desktop] = process.argv.slice(2);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function connect(port) {
  let target;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      target = (
        await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      ).find((page) => page.type === "page");
      if (target) break;
    } catch {}
    await delay(150);
  }
  assert.ok(target, "WebView target did not appear");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
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
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out: ${method}`));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    return result.result.value;
  };
  const invoke = async (name, args = {}) => {
    const value = await evaluate(
      `window.__TAURI__.core.invoke(${JSON.stringify(name)}, ${JSON.stringify(args)}).then(result => ({result}), error => ({error:String(error)}))`,
    );
    if (value.error) throw new Error(value.error);
    return value.result;
  };
  const until = async (expression) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Condition did not become true: ${expression}`);
  };
  const click = async (label) => {
    await until(
      `(() => { const scope = document.querySelector('[role=dialog]') ?? document; const button = [...scope.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(label)}); if (!button || button.disabled) return false; button.click(); return true; })()`,
    );
    await delay(100);
  };
  const screenshot = async (name) => {
    const image = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(fixture, name), Buffer.from(image.data, "base64"));
  };
  await send("Runtime.enable");
  await until(
    `window.__TAURI__?.core.invoke('snapshot').then(snapshot => snapshot.serving)`,
  );
  return {
    invoke,
    evaluate,
    until,
    click,
    screenshot,
    errors,
    close: () => socket.close(),
  };
}
let sender, receiver;
try {
  sender = await connect(senderPort);
  receiver = await connect(receiverPort);
  const first = await sender.invoke("snapshot");
  const second = await receiver.invoke("snapshot");
  const multicast = process.env.ULAK_TEST_NEARBY_MULTICAST === "1";
  const choices = multicast ? await sender.invoke("network_choices") : [];
  if (multicast)
    assert.ok(
      choices.length,
      "An active network adapter is required for the multicast check",
    );
  const network = (current) =>
    multicast
      ? {
          ...current,
          endpoint: `https://${choices[0].address}:${new URL(current.endpoint).port}/`,
          bind: `${choices[0].address}:${new URL(current.endpoint).port}`,
          lan: [choices[0].range],
          advertise: true,
        }
      : current;
  const senderNetwork = network(first.network);
  await sender.invoke("apply_network", {
    network: senderNetwork,
    name: "Office PC",
  });
  await receiver.invoke("apply_network", {
    network: network(second.network),
    name: "Studio PC",
  });
  const host = await sender.invoke("connection_descriptor", {
    endpoint: senderNetwork.endpoint,
  });
  const source = join(fixture, "private.txt");
  const content = "Nearby pairing verified file content.\n";
  await writeFile(source, content);
  const share = await sender.invoke("add_share", {
    source,
    audience: { kind: "private" },
  });
  let request;
  if (multicast) {
    await receiver.until(
      `window.__TAURI__.core.invoke('snapshot').then(snapshot => snapshot.network.endpoint === ${JSON.stringify(network(second.network).endpoint)})`,
    );
    await receiver.click("Connect a device");
    await receiver.until(
      `[...document.querySelectorAll('.nearby-device')].some(device => device.textContent.includes('Office PC'))`,
    );
    await receiver.screenshot("discovered-devices.png");
    await receiver.until(
      `(() => { const device = [...document.querySelectorAll('.nearby-device')].find(device => device.textContent.includes('Office PC')); if (!device || device.disabled) return false; device.click(); return true; })()`,
    );
    await receiver.until(
      `window.__TAURI__.core.invoke('snapshot').then(snapshot => snapshot.pairings.some(pairing => !pairing.incoming))`,
    );
    request = (await receiver.invoke("snapshot")).pairings.find(
      (pairing) => !pairing.incoming,
    );
  } else {
    // The default mode keeps both listeners loopback-only and starts via the native command.
    request = await receiver.invoke("start_nearby_pairing", {
      device: first.identity.id,
      endpoints: [senderNetwork.endpoint],
    });
    await receiver.until(
      `document.querySelector('.pairing-banner')?.textContent.includes('Office PC')`,
    );
    await receiver.click("Review");
  }
  await sender.until(
    `document.querySelector('[role=dialog] h2')?.textContent === 'Pair with Studio PC?'`,
  );
  await receiver.until(
    `document.querySelector('[role=dialog] h2')?.textContent === 'Pair with Office PC?'`,
  );
  const left = await sender.evaluate(
    `document.querySelector('.pairing-code').textContent`,
  );
  const right = await receiver.evaluate(
    `document.querySelector('.pairing-code').textContent`,
  );
  assert.equal(left, right);
  assert.match(left, /^\d{3} \d{3}$/);
  await sender.screenshot("incoming-pairing.png");
  await receiver.screenshot("outgoing-pairing.png");
  await sender.click("Match and pair");
  assert.deepEqual((await sender.invoke("snapshot")).peers, {});
  assert.deepEqual((await receiver.invoke("snapshot")).peers, {});
  await receiver.click("Match and pair");
  await sender.until(
    `window.__TAURI__.core.invoke('snapshot').then(snapshot => snapshot.peers[${JSON.stringify(second.identity.id)}])`,
  );
  await receiver.until(
    `window.__TAURI__.core.invoke('snapshot').then(snapshot => snapshot.peers[${JSON.stringify(first.identity.id)}])`,
  );
  await sender.click("Done");
  await receiver.click("Done");
  await receiver.until(
    `[...document.querySelectorAll('main .list-row')].some(row => row.textContent.includes('Office PC') && row.querySelector('.status')?.textContent.includes('Online'))`,
  );
  await sender.until(
    `[...document.querySelectorAll('main .list-row')].some(row => row.textContent.includes('Studio PC') && row.querySelector('.status')?.textContent.includes('Online'))`,
  );
  const list = () =>
    receiver.invoke("local_request", {
      request: {
        command: "list",
        remote: host,
        share: null,
        entry: null,
        cursor: null,
      },
    });
  assert.equal(
    (await list()).items.length,
    0,
    "Pairing alone must not expose private shares",
  );
  await sender.invoke("set_audience", {
    share: share.id,
    audience: { kind: "devices", devices: [second.identity.id] },
  });
  assert.equal((await list()).items[0].id, share.id);
  const entries = await receiver.invoke("local_request", {
    request: {
      command: "list",
      remote: host,
      share: share.id,
      entry: null,
      cursor: null,
    },
  });
  const download = await receiver.invoke("local_request", {
    request: {
      command: "download",
      remote: host,
      share: share.id,
      entry: entries.items[0].id,
      destination: join(fixture, "downloads"),
    },
  });
  assert.equal(download.state, "completed");
  assert.equal(await readFile(download.destination, "utf8"), content);
  await sender.invoke("unpair", { device: second.identity.id });
  await receiver.invoke("unpair", { device: first.identity.id });
  const declined = await receiver.invoke("start_nearby_pairing", {
    device: first.identity.id,
    endpoints: [senderNetwork.endpoint],
  });
  assert.notEqual(declined.id, request.id);
  await sender.until(
    `document.querySelector('[role=dialog] h2')?.textContent === 'Pair with Studio PC?'`,
  );
  await sender.click("Cancel");
  await receiver.until(
    `window.__TAURI__.core.invoke('snapshot').then(snapshot => snapshot.pairings.find(pairing => pairing.id === ${JSON.stringify(declined.id)})?.state === 'rejected')`,
  );
  assert.deepEqual((await sender.invoke("snapshot")).peers, {});
  assert.deepEqual((await receiver.invoke("snapshot")).peers, {});
  assert.equal((await sender.invoke("snapshot")).shortcut_available, true);
  await sender.invoke("plugin:window|close", { label: "main" });
  assert.equal(
    await sender.invoke("plugin:window|is_visible", { label: "main" }),
    false,
  );
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(New-Object -ComObject WScript.Shell).SendKeys('^%u')",
    ],
    { windowsHide: true, timeout: 10000 },
  );
  await sender.until(
    `window.__TAURI__.core.invoke('plugin:window|is_visible', {label:'main'})`,
  );
  await sender.invoke("plugin:window|close", { label: "main" });
  execFileSync(desktop, [], {
    windowsHide: true,
    timeout: 10000,
    env: { ...process.env, ULAK_DATA_DIR: join(fixture, "sender") },
  });
  await sender.until(
    `window.__TAURI__.core.invoke('plugin:window|is_visible', {label:'main'})`,
  );
  assert.equal(
    (await sender.invoke("snapshot")).identity.id,
    first.identity.id,
  );
  assert.deepEqual(sender.errors, []);
  assert.deepEqual(receiver.errors, []);
  await sender.invoke("quit_app");
  await receiver.invoke("quit_app");
  console.log(
    "PASS: two native WebViews, equal pairing numbers, both approvals, private-share isolation, explicitly granted paired download/content check, rejection, global Ctrl+Alt+U, and second-launch reopening. Discovery on a physical network remains unmeasured.",
  );
  if (multicast)
    console.log(
      "PASS: mDNS discovery and selection from the nearby-device list on this workstation's active adapter. This is not a physical second-PC test.",
    );
} catch (error) {
  await sender?.screenshot("sender-failure.png").catch(() => {});
  await receiver?.screenshot("receiver-failure.png").catch(() => {});
  throw error;
} finally {
  sender?.close();
  receiver?.close();
}
