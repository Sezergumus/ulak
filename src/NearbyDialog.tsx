import { useEffect, useRef, useState } from "react";
import {
  Check,
  LoaderCircle,
  Monitor,
  RefreshCw,
  Search,
  Wifi,
} from "lucide-react";
import { Dialog } from "./components/ui/dialog";
import { Button } from "./components/ui/button";
import { ErrorNotice } from "./components/ErrorNotice";
import { ConnectDialog } from "./dialogs";
import { command, useStore } from "./store";
import {
  localOnly,
  type Discovered,
  type NetworkChoice,
  type Pairing,
  type Remote,
} from "./types";

export function NearbyDialog({
  found,
  scanning,
  onScan,
  onPair,
  onClose,
  onNetwork,
  onRemote,
  target,
  initialMode,
}: {
  found: Discovered[];
  scanning: boolean;
  onScan: () => Promise<void>;
  onPair: (device: Discovered) => Promise<void>;
  onClose: () => void;
  onNetwork: () => void;
  onRemote: (remote: Remote) => void;
  target?: Discovered;
  initialMode?: "receive" | "create";
}) {
  const { data, refresh } = useStore();
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<NetworkChoice[]>([]);
  const [loadingNetworks, setLoadingNetworks] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [manual, setManual] = useState(!!initialMode);
  const search = useRef<HTMLInputElement>(null);
  const needsNetwork = !data || localOnly(data.network);
  useEffect(() => {
    let active = true;
    void command<NetworkChoice[]>("network_choices")
      .then((items) => {
        if (active) setChoices(items ?? []);
      })
      .catch((error) => {
        if (active) setError(String(error));
      })
      .finally(() => {
        if (active) setLoadingNetworks(false);
      });
    void onScan();
    const interval = window.setInterval(() => {
      void onScan();
    }, 8000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [onScan]);
  const enable = async (choice: NetworkChoice) => {
    if (!data) return;
    setBusy(choice.address);
    setError("");
    try {
      const port = new URL(data.network.endpoint).port || "443";
      await command("apply_network", {
        name: data.identity.name,
        network: {
          ...data.network,
          endpoint: `https://${choice.address}:${port}/`,
          bind: `${choice.address}:${port}`,
          lan: [choice.range],
          advertise: true,
          onboarding: data.network.onboarding
            ? `${choice.address}:${data.network.onboarding.slice(data.network.onboarding.lastIndexOf(":") + 1)}`
            : null,
        },
      });
      await refresh();
      await onScan();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy("");
    }
  };
  const candidates = [
    ...new Map(
      [...(target ? [target] : []), ...found]
        .filter((device) => !device.paired && !data?.peers[device.id])
        .map((device) => [device.id, device]),
    ).values(),
  ].filter((device) => device.name.toLowerCase().includes(query.toLowerCase()));
  if (manual)
    return (
      <ConnectDialog
        target={target}
        initialMode={initialMode}
        onClose={onClose}
        onNetwork={onNetwork}
        onRemote={onRemote}
      />
    );
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a device"
      description={
        needsNetwork
          ? "Choose the network your other computer uses. Ulak will find devices there."
          : "Keep Ulak open on the other computer. Select it below to pair."
      }
      initialFocusRef={search}
    >
      {needsNetwork ? (
        <>
          <div className="nearby-list">
            {loadingNetworks && (
              <p className="quiet">
                <LoaderCircle className="spin" size={16} /> Looking for Wi-Fi
                and Ethernet…
              </p>
            )}
            {choices.map((choice) => (
              <Button
                key={choice.address}
                className="network-choice"
                disabled={!!busy}
                onClick={() => void enable(choice)}
              >
                <Wifi size={17} />
                <span>Use {choice.name}</span>
                {busy === choice.address && (
                  <LoaderCircle size={16} className="spin" />
                )}
              </Button>
            ))}
            {!loadingNetworks && !choices.length && (
              <p className="hint">
                Connect this computer to Wi-Fi or Ethernet, then try again.
              </p>
            )}
          </div>
          <Button variant="ghost" onClick={onNetwork}>
            Set up network sharing
          </Button>
        </>
      ) : (
        <>
          <label className="search nearby-search">
            <Search size={16} />
            <input
              ref={search}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a nearby device…"
              aria-label="Find a nearby device"
            />
          </label>
          <div className="nearby-heading">
            <span>{scanning ? "Looking for devices…" : "Nearby devices"}</span>
            <Button
              variant="ghost"
              disabled={scanning || !!busy}
              onClick={() => void onScan()}
            >
              <RefreshCw size={14} className={scanning ? "spin" : ""} />
              Search again
            </Button>
          </div>
          <div className="nearby-list">
            {candidates.map((device) => (
              <button
                className="nearby-device"
                key={device.id}
                disabled={!!busy}
                onClick={async () => {
                  setBusy(device.id);
                  setError("");
                  try {
                    await onPair(device);
                  } catch (error) {
                    setError(String(error));
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <Monitor size={22} />
                <span>
                  <b>{device.name}</b>
                  <small>Ready to pair</small>
                </span>
                {busy === device.id ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <span className="nearby-pair-label">Pair</span>
                )}
              </button>
            ))}
            {!candidates.length && (
              <p className="quiet">
                {query
                  ? "No devices match your search."
                  : "No devices found yet. Check that both computers use the same network and have nearby sharing turned on."}
              </p>
            )}
          </div>
        </>
      )}
      <details className="advanced">
        <summary>Other ways to connect</summary>
        <Button variant="ghost" onClick={() => setManual(true)}>
          Use an invitation instead
        </Button>
        {!needsNetwork && (
          <Button variant="ghost" onClick={onNetwork}>
            Choose another network
          </Button>
        )}
      </details>
      {error && (
        <ErrorNotice
          error={error}
          message="Could not connect. Keep Ulak open on both computers and try searching again."
        />
      )}
    </Dialog>
  );
}

export function PairingDialog({
  pairing,
  onClose,
}: {
  pairing?: Pairing;
  onClose: () => void;
}) {
  const { refresh } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const done = pairing?.state === "paired";
  const unavailable = !pairing || pairing.state === "rejected";
  const decide = async (accept: boolean) => {
    if (!pairing) return;
    setBusy(true);
    setError("");
    try {
      await command("decide_nearby_pairing", { id: pairing.id, accept });
      await refresh();
      if (!accept) onClose();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  const dismiss = () => {
    if (pairing && !done && !unavailable) void decide(false);
    else onClose();
  };
  return (
    <Dialog
      open
      onClose={dismiss}
      title={
        done
          ? `Connected to ${pairing.name}`
          : unavailable
            ? "Pairing ended"
            : `Pair with ${pairing.name}?`
      }
      description={
        done
          ? "Choose which files this device can access in My shares."
          : unavailable
            ? "Find the device again to start a new pairing request."
            : "Check that the same number appears on both computers."
      }
    >
      {done ? (
        <div className="pairing-result">
          <Check size={26} />
          Device saved
        </div>
      ) : (
        !unavailable && (
          <>
            <div className="pairing-code" aria-label="Pairing number">
              {pairing.code
                ? `${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}`
                : "…"}
            </div>
            <p className="hint">
              {pairing.approved
                ? "Waiting for the other computer to confirm…"
                : "If the numbers match, choose Match and pair on both computers."}
            </p>
          </>
        )
      )}
      {error && (
        <ErrorNotice
          error={error}
          message="Could not finish pairing. Find the device again and retry."
        />
      )}
      <div className="dialog-actions">
        {done || unavailable ? (
          <Button variant="default" onClick={onClose}>
            {done ? "Done" : "Close"}
          </Button>
        ) : (
          <>
            <Button disabled={busy} onClick={dismiss}>
              Cancel
            </Button>
            <Button
              variant="default"
              disabled={busy || pairing.approved || !pairing.code}
              onClick={() => void decide(true)}
            >
              {pairing.approved ? (
                <>
                  <LoaderCircle size={14} className="spin" />
                  Waiting for confirmation
                </>
              ) : (
                "Match and pair"
              )}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
