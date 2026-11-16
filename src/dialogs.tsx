import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { ErrorNotice } from "./components/ErrorNotice";
import { command, request, useStore } from "./store";
import { guestLink, readInvitation } from "./invitations";
import {
  localOnly,
  type Audience,
  type Discovered,
  type LocalShare,
  type Network,
  type NetworkChoice,
  type Remote,
} from "./types";
export function ShareDialog({
  sources,
  existing,
  online,
  onClose,
  onPairNew,
}: {
  sources: string[];
  existing?: LocalShare;
  online: string[];
  onClose: () => void;
  onPairNew: () => void;
}) {
  const { data, refresh } = useStore();
  const initial = existing?.share.audience;
  const [kind, setKind] = useState<Audience["kind"]>(
    initial?.kind ?? "private",
  );
  const [devices, setDevices] = useState<string[]>(
    initial?.kind === "devices" ? initial.devices : [],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string[]>([]);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const audience: Audience =
        kind === "devices" ? { kind, devices } : { kind };
      if (existing)
        await command("set_audience", { share: existing.share.id, audience });
      else {
        const completed = [...done];
        for (const source of sources.filter(
          (source) => !completed.includes(source),
        )) {
          await request({ command: "share", source, audience });
          completed.push(source);
          setDone([...completed]);
        }
      }
      await refresh();
      onClose();
    } catch (error) {
      setError(String(error));
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Who can access?"
      description={
        existing
          ? `Manage access to ${existing.share.name}`
          : `${sources.length} item${sources.length === 1 ? "" : "s"} selected. Files stay where they are.`
      }
    >
      {!existing && (
        <div className="source-preview">
          {sources.slice(0, 5).map((source) => (
            <small key={source}>
              {done.includes(source) ? "✓ " : ""}
              {source}
            </small>
          ))}
          {sources.length > 5 && <small>+{sources.length - 5} more</small>}
        </div>
      )}
      <fieldset disabled={busy} className="audience-options">
        <legend className="sr-only">Share audience</legend>
        <label className={kind === "private" ? "chosen" : ""}>
          <input
            type="radio"
            name="audience"
            checked={kind === "private"}
            onChange={() => setKind("private")}
          />
          <span>
            <b>Invitation only</b>
            <small>
              Only you can access this until you invite a browser guest.
            </small>
          </span>
        </label>
        <label className={kind === "devices" ? "chosen" : ""}>
          <input
            type="radio"
            name="audience"
            checked={kind === "devices"}
            onChange={() => setKind("devices")}
          />
          <span>
            <b>Choose devices</b>
            <small>
              Devices that are offline can download when they reconnect.
            </small>
          </span>
        </label>
        {kind === "devices" && (
          <div className="device-picker">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDevices(Object.keys(data?.peers ?? {}))}
            >
              Select all devices
            </Button>
            {Object.values(data?.peers ?? {}).map((peer) => (
              <label key={peer.remote.identity.id}>
                <input
                  type="checkbox"
                  checked={devices.includes(peer.remote.identity.id)}
                  onChange={(event) =>
                    setDevices((current) =>
                      event.target.checked
                        ? [...current, peer.remote.identity.id]
                        : current.filter(
                            (id) => id !== peer.remote.identity.id,
                          ),
                    )
                  }
                />
                <span>
                  {peer.remote.identity.name}
                  <small>
                    {online.includes(peer.remote.identity.id)
                      ? "Online"
                      : "Offline"}
                  </small>
                </span>
              </label>
            ))}
            {!Object.keys(data?.peers ?? {}).length && (
              <p className="hint">Connect a device to add it to this list.</p>
            )}
            <Button type="button" variant="ghost" onClick={onPairNew}>
              Connect a new device
            </Button>
          </div>
        )}
        <label className={kind === "lan" ? "chosen" : ""}>
          <input
            type="radio"
            name="audience"
            checked={kind === "lan"}
            onChange={() => setKind("lan")}
          />
          <span>
            <b>Everyone on the local network</b>
            <small>
              Anyone on your chosen network can browse and download these files.
            </small>
          </span>
        </label>
      </fieldset>
      {error && (
        <ErrorNotice
          error={error}
          message="Could not save sharing access. Check that the files are still available, then try again."
        />
      )}
      <div className="dialog-actions">
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="default"
          disabled={busy || (kind === "devices" && !devices.length)}
          onClick={() => void submit()}
        >
          {busy ? "Saving…" : existing ? "Save access" : "Start sharing"}
        </Button>
      </div>
    </Dialog>
  );
}

export function ConnectDialog({
  onClose,
  onRemote,
  target,
  initialMode = "receive",
  onNetwork,
}: {
  onClose: () => void;
  onRemote: (remote: Remote) => void;
  target?: Discovered;
  initialMode?: "receive" | "create";
  onNetwork: () => void;
}) {
  const { data, refresh } = useStore();
  const [mode, setMode] = useState(initialMode);
  const [text, setText] = useState("");
  const [invitation, setInvitation] = useState("");
  const [createdAt, setCreatedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [publicText, setPublicText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const needsNetwork = !!data && localOnly(data.network);
  useEffect(() => {
    if (!invitation) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [invitation]);
  const expired = !!invitation && now - createdAt >= 5 * 60_000;
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const value = await command<string>("invitation", {
        endpoint: data?.network.endpoint,
      });
      setInvitation(value);
      setCreatedAt(Date.now());
      setNow(Date.now());
      setCopied(false);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      let host: Remote;
      try {
        host = readInvitation(text.trim()).host;
      } catch {
        throw new Error(
          "This invitation could not be read. Paste the full invitation from the other computer.",
        );
      }
      if (target && host.identity.id !== target.id) {
        throw new Error(
          `This invitation belongs to a different device. Ask ${target.name} for a new invitation.`,
        );
      }
      await command("pair", {
        invitation: text.trim(),
        endpoint: data?.network.endpoint,
      });
      await refresh();
      onClose();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  const browse = async () => {
    setBusy(true);
    setError("");
    try {
      let remote: Remote;
      try {
        remote = JSON.parse(publicText);
      } catch {
        throw new Error(
          "These connection details could not be read. Copy them again from the other computer.",
        );
      }
      if (target && remote?.identity?.id !== target.id)
        throw new Error(
          "These connection details belong to a different device.",
        );
      await command("verify_peer", { remote });
      onRemote(remote);
      onClose();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={target ? `Connect to ${target.name}` : "Connect a device"}
      description="Keep Ulak open on both computers and connect them to the same Wi-Fi or Ethernet network."
    >
      {needsNetwork && (
        <div className="setup-notice">
          <p>
            This computer is set to work on its own. Choose a network before
            connecting another device.
          </p>
          <Button onClick={onNetwork}>Set up network sharing</Button>
        </div>
      )}
      <div className="tabs">
        <Button
          variant={mode === "receive" ? "default" : "ghost"}
          onClick={() => {
            setMode("receive");
            setError("");
          }}
        >
          I have an invitation
        </Button>
        <Button
          variant={mode === "create" ? "default" : "ghost"}
          onClick={() => {
            setMode("create");
            setError("");
          }}
        >
          Create an invitation
        </Button>
      </div>
      {mode === "receive" ? (
        <>
          <ol className="steps">
            <li>
              On the other computer, open{" "}
              <b>Connect a device → Create an invitation</b>.
            </li>
            <li>
              Copy the invitation and paste it below. Only accept invitations
              from a computer you know.
            </li>
          </ol>
          <label className="field">
            Invitation from the other computer
            <textarea
              rows={3}
              value={text}
              maxLength={65_536}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste invitation here"
            />
          </label>
          <Button
            variant="default"
            disabled={busy || !text.trim() || needsNetwork || !data?.serving}
            onClick={() => void connect()}
          >
            {busy
              ? "Connecting…"
              : target
                ? `Connect to ${target.name}`
                : "Connect"}
          </Button>
        </>
      ) : (
        <>
          <p className="hint">
            Send this invitation directly to the other computer. There, open{" "}
            <b>Connect a device → I have an invitation</b> and paste it. It
            works once and expires in five minutes.
          </p>
          <Button
            variant="default"
            disabled={busy || needsNetwork || !data?.serving}
            onClick={() => void create()}
          >
            {busy
              ? "Creating…"
              : invitation
                ? "Create a new invitation"
                : "Create invitation"}
          </Button>
          {invitation && (
            <>
              <label className="field">
                Your invitation
                <textarea
                  rows={3}
                  readOnly
                  value={invitation}
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <Button
                disabled={expired}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(invitation);
                    setCopied(true);
                  } catch {
                    setError(
                      "Could not copy automatically. Select the invitation above and press Ctrl+C.",
                    );
                  }
                }}
              >
                {copied ? "Copied" : "Copy invitation"}
              </Button>
              <p className="hint" role="status">
                {expired
                  ? "This invitation has expired. Create a new one to connect."
                  : "After connecting, the other computer appears in Devices. Choose which files it can access in My shares."}
              </p>
            </>
          )}
        </>
      )}
      <details className="advanced">
        <summary>Browse without adding a device</summary>
        <p className="hint">
          For files shared with everyone on the network, paste connection
          details obtained directly from the owner. They can save these from
          Connection settings → Advanced settings.
        </p>
        <label className="field">
          Connection details
          <textarea
            rows={3}
            value={publicText}
            maxLength={65_536}
            onChange={(event) => setPublicText(event.target.value)}
          />
        </label>
        <Button
          disabled={busy || !publicText.trim()}
          onClick={() => void browse()}
        >
          Browse shared files
        </Button>
      </details>
      {error && (
        <ErrorNotice
          error={error}
          message={
            /^(This invitation|These connection details|Could not copy automatically)/.test(
              error.replace(/^Error:\s*/, ""),
            )
              ? error.replace(/^Error:\s*/, "")
              : "Could not connect. Check that both computers use the same network. If the invitation has expired, create a new one."
          }
        />
      )}
    </Dialog>
  );
}

export function InviteDialog({
  share,
  onClose,
}: {
  share?: string;
  onClose: () => void;
}) {
  const { data } = useStore();
  const [value, setValue] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const encoded = await command<string>("invitation", {
        endpoint: data?.network.endpoint,
        guestShares: share ? [share] : null,
      });
      if (share) {
        setValue(guestLink(encoded));
      } else setValue(encoded);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  const setupUrl = (() => {
    if (!data?.network.onboarding || !data?.network.endpoint) return "";
    try {
      const url = new URL(data.network.endpoint);
      url.protocol = "http:";
      url.port = data.network.onboarding.slice(
        data.network.onboarding.lastIndexOf(":") + 1,
      );
      return url.toString();
    } catch {
      return "";
    }
  })();
  return (
    <Dialog
      open
      onClose={onClose}
      title={share ? "Share with a browser guest" : "Connect another computer"}
      description={
        share
          ? "Create a one-time link or QR code to open this share in any browser."
          : "Each invitation works once and expires in five minutes."
      }
    >
      <p className="hint">
        {share
          ? "Unused links expire after five minutes. Once opened, guest access stays active for up to eight hours (or 30 minutes without activity)."
          : "Create an invitation, then paste it into Connect a device on the other computer. Choose which files it can access in My shares."}
      </p>
      <div className="invite-actions">
        <Button
          disabled={busy || !data?.serving}
          variant="default"
          onClick={() => void create()}
        >
          {value ? "Create another invitation" : "Create invitation"}
        </Button>
        {share && (
          <Button
            variant="ghost"
            aria-expanded={showSetup}
            onClick={() => setShowSetup((open) => !open)}
          >
            Browser security warning?
          </Button>
        )}
      </div>
      {share && showSetup && (
        <div className="invite-help">
          <p className="hint">
            Because Ulak works offline on your local network, browsers do not
            recognize its security certificate automatically. On a computer you
            can usually continue past the warning, or install the certificate
            once on devices you control (recommended for iPhone and iPad).
          </p>
          <ol className="steps">
            <li>
              {setupUrl
                ? `Open ${setupUrl} on the guest device.`
                : "Enable the browser setup page in Connection settings, or save the certificate below and transfer it to the guest device."}
            </li>
            <li>
              Compare the security code shown there with this one so you know it
              came from this computer:
            </li>
          </ol>
          <label className="field">
            Security code for browser setup
            <textarea
              rows={2}
              className="mono"
              readOnly
              value={data?.ca_fingerprint ?? ""}
            />
          </label>
          <p className="hint">
            Install the certificate only on a device you control. On iPhone or
            iPad, also turn on full trust in Settings → General → About →
            Certificate Trust Settings.
          </p>
          <Button
            onClick={() =>
              command("save_public", { certificate: true }).catch((error) =>
                setError(String(error)),
              )
            }
          >
            Save security certificate
          </Button>
        </div>
      )}
      {value && (
        <>
          <div className="qr">
            <QRCodeSVG value={value} size={176} level="L" />
          </div>
          <label className="field">
            {share ? "Guest link" : "Pairing invitation"}
            <textarea
              readOnly
              rows={4}
              value={value}
              onFocus={(event) => event.target.select()}
            />
          </label>
          {share && (
            <label className="field">
              Invitation code
              <input
                readOnly
                className="mono"
                value={
                  new URLSearchParams(new URL(value).hash.slice(1)).get(
                    "invite",
                  ) ?? ""
                }
                onFocus={(event) => event.target.select()}
              />
            </label>
          )}
        </>
      )}
      {error && (
        <ErrorNotice
          error={error}
          message="Could not prepare guest access. Check the connection settings, then try again."
        />
      )}
    </Dialog>
  );
}

export function NetworkDialog({
  network,
  onClose,
}: {
  network: Network;
  onClose: () => void;
}) {
  const { data, refresh } = useStore();
  const [name, setName] = useState(data?.identity.name ?? "Ulak PC");
  const [value, setValue] = useState(network);
  const [ranges, setRanges] = useState(network.lan.join(", "));
  const [choices, setChoices] = useState<NetworkChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNetwork, setSelectedNetwork] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    void command<NetworkChoice[]>("network_choices")
      .then((items) => {
        if (!disposed) setChoices(items ?? []);
      })
      .catch((error) => {
        if (!disposed) setError(String(error));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);
  const chooseNetwork = (address: string) => {
    setSelectedNetwork(address);
    const choice = choices.find((item) => item.address === address);
    if (!choice) return;
    let port = "7443";
    try {
      port = new URL(value.endpoint).port || "443";
    } catch {
      /* Replace invalid manual settings with the selected connection. */
    }
    setValue({
      ...value,
      endpoint: `https://${choice.address}:${port}/`,
      bind: `${choice.address}:${port}`,
      lan: [choice.range],
      advertise: true,
      onboarding: value.onboarding
        ? `${choice.address}:${value.onboarding.slice(value.onboarding.lastIndexOf(":") + 1)}`
        : null,
    });
    setRanges(choice.range);
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await command("apply_network", {
        name,
        network: {
          ...value,
          lan: ranges
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        },
      });
      await refresh();
      onClose();
    } catch (error) {
      setError(String(error));
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Connection settings"
      description="Choose how other devices find this computer. Your choices are saved for next time."
    >
      {typeof data?.shortcut_available === "boolean" && (
        <p className="hint">
          {data.shortcut_available
            ? "Press Ctrl+Alt+U from any app to open Ulak while it is running."
            : "Ctrl+Alt+U is unavailable. You can open Ulak from the tray or the Ulak shortcut."}
        </p>
      )}
      <label className="field">
        Device name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">
        Share over
        <select
          value={selectedNetwork}
          onChange={(event) => chooseNetwork(event.target.value)}
          disabled={loading || busy}
        >
          <option value="" disabled>
            {loading ? "Looking for networks…" : "Choose a connection…"}
          </option>
          {choices.map((choice) => (
            <option key={choice.address} value={choice.address}>
              {choice.name} · {choice.address}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        Select the Wi-Fi or Ethernet connection your other devices use. This
        makes Ulak discoverable there. Each share still has its own access
        settings.
      </p>
      {!loading && !choices.length && (
        <p className="hint">
          No active Wi-Fi or Ethernet connection was found. Connect to a
          network, then reopen settings, or use Advanced settings.
        </p>
      )}
      <p className="hint">
        {localOnly(value)
          ? "Current connection: this computer only."
          : `Connection address: ${value.endpoint}`}
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={!!value.onboarding}
          onChange={(event) => {
            try {
              const host = new URL(value.endpoint).hostname;
              setValue({
                ...value,
                onboarding: event.target.checked ? `${host}:7080` : null,
              });
            } catch {
              setError(
                "Choose a network or enter a valid connection address first.",
              );
            }
          }}
        />
        Enable browser setup page
      </label>
      <p className="hint">
        Turn this on when setting up access from a phone or web browser. It
        provides setup instructions and a security certificate.
      </p>
      <details className="advanced">
        <summary>Advanced settings</summary>
        <label className="field">
          Secure connection address (HTTPS)
          <input
            value={value.endpoint}
            onChange={(event) =>
              setValue({ ...value, endpoint: event.target.value })
            }
          />
        </label>
        <label className="field">
          Local listening address
          <input
            value={value.bind}
            onChange={(event) =>
              setValue({ ...value, bind: event.target.value })
            }
          />
        </label>
        <label className="field">
          Networks allowed to read public shares (comma separated)
          <input
            placeholder="192.168.1.0/24"
            value={ranges}
            onChange={(event) => setRanges(event.target.value)}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={value.advertise}
            onChange={(event) =>
              setValue({ ...value, advertise: event.target.checked })
            }
          />
          Let other Ulak devices find this computer automatically
        </label>
        <label className="field">
          Browser setup address (HTTP, optional)
          <input
            placeholder="192.168.1.10:7080"
            value={value.onboarding ?? ""}
            onChange={(event) =>
              setValue({ ...value, onboarding: event.target.value || null })
            }
          />
        </label>
        <p className="hint">
          This address serves setup instructions and the security certificate.
          Files use the secure connection above.
        </p>
        <label className="field">
          Security code for browser setup
          <textarea
            className="mono"
            rows={2}
            readOnly
            value={data?.ca_fingerprint ?? ""}
          />
        </label>
        <p className="hint">
          Compare this code on the guest device before installing this
          computer's certificate.
        </p>
        <div className="actions">
          <Button
            onClick={() =>
              command("save_public", { certificate: false }).catch((error) =>
                setError(String(error)),
              )
            }
          >
            Save connection details
          </Button>
          <Button
            onClick={() =>
              command("save_public", { certificate: true }).catch((error) =>
                setError(String(error)),
              )
            }
          >
            Save security certificate
          </Button>
        </div>
      </details>
      <p className="hint">
        Applying connection changes may interrupt downloads from this computer.
      </p>
      {error && (
        <ErrorNotice
          error={error}
          message="Could not apply these settings. Check the selected connection and try again."
        />
      )}
      <div className="dialog-actions">
        <Button onClick={onClose}>Close</Button>
        <Button variant="default" disabled={busy} onClick={() => void save()}>
          {busy ? "Applying…" : "Apply settings"}
        </Button>
      </div>
    </Dialog>
  );
}
