import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { command, request, useStore } from "./store";
import { guestLink } from "./invitations";
import type { Audience, LocalShare, Network, Remote } from "./types";
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
          : `${sources.length} selected source(s). Files stay at their original locations.`
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
            <b>Private / guest access</b>
            <small>Create a scoped guest invitation from share details.</small>
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
            <b>Selected paired devices</b>
            <small>Offline devices can receive access for later.</small>
          </span>
        </label>
        {kind === "devices" && (
          <div className="device-picker">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDevices(Object.keys(data?.peers ?? {}))}
            >
              Select all paired devices
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
              <p className="hint">
                No paired devices yet. Close this dialog and use Connect a
                device.
              </p>
            )}
            <Button type="button" variant="ghost" onClick={onPairNew}>
              Pair a new device
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
              Any device in the configured allowed network can read this share
              without an invitation.
            </small>
          </span>
        </label>
      </fieldset>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
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
          {busy ? "Saving…" : existing ? "Save access" : "Publish share"}
        </Button>
      </div>
    </Dialog>
  );
}

export function ConnectDialog({
  onClose,
  onRemote,
}: {
  onClose: () => void;
  onRemote: (remote: Remote) => void;
}) {
  const { data, refresh } = useStore();
  const [mode, setMode] = useState<"pair" | "public">("pair");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      if (mode === "pair") {
        await command("pair", {
          invitation: text.trim(),
          endpoint: data?.network.endpoint,
        });
        await refresh();
      } else {
        const remote: Remote = JSON.parse(text);
        await command("verify_peer", { remote });
        onRemote(remote);
      }
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
      title="Connect a device"
      description="Exchange connection information directly with the intended computer. Discovery alone does not establish trust."
    >
      <div className="tabs">
        <Button
          variant={mode === "pair" ? "default" : "ghost"}
          onClick={() => setMode("pair")}
        >
          Pair a computer
        </Button>
        <Button
          variant={mode === "public" ? "default" : "ghost"}
          onClick={() => setMode("public")}
        >
          Browse LAN-open shares
        </Button>
      </div>
      <label className="field">
        {mode === "pair"
          ? "Single-use pairing invitation"
          : "Public connection descriptor (JSON)"}
        <textarea
          rows={6}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={
            mode === "pair"
              ? "Paste the invitation from the other computer"
              : "Paste the descriptor exported by the host"
          }
        />
      </label>
      <p className="hint">
        {mode === "pair"
          ? "On the other computer: Commands → Create pairing invitation. Configure reachable addresses on both PCs first."
          : "Obtain the descriptor through a trusted exchange. It verifies the host and grants no access to restricted shares."}
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <Button
        variant="default"
        disabled={busy || !text.trim()}
        onClick={() => void connect()}
      >
        {busy ? "Verifying identity…" : "Connect"}
      </Button>
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
  return (
    <Dialog
      open
      onClose={onClose}
      title={share ? "Invite a browser guest" : "Pair another computer"}
      description="Invitations are single use and expire after five minutes."
    >
      <p className="hint">
        {share
          ? "The guest must first install and trust this host’s public CA. On iOS, also enable SSL trust in Certificate Trust Settings. Compare the CA fingerprint before installation. The resulting session expires after 30 minutes of inactivity or eight hours total."
          : "Create an invitation, then paste it into Connect a device on the recipient computer. Pairing does not grant access to private shares automatically."}
      </p>
      {share && (
        <>
          <label className="field">
            Compare this public CA fingerprint with the guest device
            <textarea
              rows={2}
              className="mono"
              readOnly
              value={data?.ca_fingerprint ?? ""}
            />
          </label>
          {data?.network.onboarding && (
            <p className="hint">
              Certificate setup:{" "}
              {(() => {
                const url = new URL(data.network.endpoint);
                url.protocol = "http:";
                url.port = data.network.onboarding.slice(
                  data.network.onboarding.lastIndexOf(":") + 1,
                );
                return url.toString();
              })()}
            </p>
          )}
        </>
      )}
      <Button
        disabled={busy || !data?.serving}
        variant="default"
        onClick={() => void create()}
      >
        {value ? "Create another invitation" : "Create invitation"}
      </Button>
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
        </>
      )}
      {share && (
        <Button
          onClick={() =>
            command("save_public", { certificate: true }).catch((error) =>
              setError(String(error)),
            )
          }
        >
          Export public CA certificate
        </Button>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
      description="Use your reachable local IP address for other devices. Settings persist across restarts."
    >
      <label className="field">
        Device name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="field">
        HTTPS address
        <input
          value={value.endpoint}
          onChange={(event) =>
            setValue({ ...value, endpoint: event.target.value })
          }
        />
      </label>
      <label className="field">
        Listen address
        <input
          value={value.bind}
          onChange={(event) => setValue({ ...value, bind: event.target.value })}
        />
      </label>
      <label className="field">
        Allowed LAN ranges (comma separated)
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
        Advertise this device with mDNS
      </label>
      <label className="field">
        Public certificate setup listener (optional HTTP address)
        <input
          placeholder="192.168.1.10:7080"
          value={value.onboarding ?? ""}
          onChange={(event) =>
            setValue({ ...value, onboarding: event.target.value || null })
          }
        />
      </label>
      <p className="hint">
        The setup listener serves only trust instructions and the public
        certificate. Shared content requires HTTPS.
      </p>
      <label className="field">
        Public CA fingerprint
        <textarea
          className="mono"
          rows={2}
          readOnly
          value={data?.ca_fingerprint ?? ""}
        />
      </label>
      <p className="hint">
        The initial loopback address is reachable only on this PC. LAN-open
        shares remain limited to the ranges above. Applying settings restarts
        the sharing listener and may interrupt active readers.
      </p>
      <div className="actions">
        <Button
          onClick={() =>
            command("save_public", { certificate: false }).catch((error) =>
              setError(String(error)),
            )
          }
        >
          Export connection descriptor
        </Button>
        <Button
          onClick={() =>
            command("save_public", { certificate: true }).catch((error) =>
              setError(String(error)),
            )
          }
        >
          Export public CA
        </Button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
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
