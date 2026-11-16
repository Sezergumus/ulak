import { ShareDialog, InviteDialog, NetworkDialog } from "./dialogs";
import { RemoteBrowser } from "./RemoteBrowser";
import { NearbyDialog, PairingDialog } from "./NearbyDialog";
import { CommandMenu, type MenuAction } from "./CommandMenu";
import { Radar } from "./Radar";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  File,
  Folder,
  FolderPlus,
  Link,
  LoaderCircle,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Upload,
  Users,
  Wifi,
  X,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { ErrorNotice } from "./components/ErrorNotice";
import { command, request, useStore } from "./store";
import {
  active,
  audienceLabel,
  localOnly,
  size,
  transferLabel,
  type Discovered,
  type LocalShare,
  type Peer,
  type Remote,
  type Transfer,
} from "./types";

type View = "devices" | "shares" | "transfers";
type ConnectModal = {
  kind: "connect";
  target?: Discovered;
  initialMode?: "receive" | "create";
};
type Modal =
  | { kind: "share"; sources: string[]; existing?: LocalShare }
  | ConnectModal
  | { kind: "invite"; share?: string }
  | { kind: "network"; returnTo?: ConnectModal }
  | { kind: "pairing"; id: string }
  | { kind: "remove"; share: LocalShare }
  | null;
const date = (timestamp: number | null) =>
  timestamp
    ? new Date(timestamp * 1000).toLocaleString("en-GB")
    : "Not connected yet";
const lastSeen = (timestamp: number | null) => {
  if (!timestamp) return "Not connected yet";
  const minutes = Math.max(0, (Date.now() / 1000 - timestamp) / 60);
  if (minutes < 2) return "Last seen just now";
  if (minutes < 60) return `Last seen ${Math.round(minutes)} minutes ago`;
  const hours = minutes / 60;
  if (hours < 24)
    return `Last seen ${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `Last seen ${days} day${days === 1 ? "" : "s"} ago`;
  return `Last seen ${new Date(timestamp * 1000).toLocaleDateString("en-GB")}`;
};

export function App() {
  const { data, error, refresh, report, transfer } = useStore();
  const [view, setView] = useState<View>("devices");
  const [selected, setSelected] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");
  const [online, setOnline] = useState<string[]>([]);
  const [found, setFound] = useState<Discovered[]>([]);
  const [scanning, setScanning] = useState(false);
  const [drop, setDrop] = useState(false);
  const [remote, setRemote] = useState<Remote | null>(null);
  const [preparing, setPreparing] = useState(0);
  const filterRef = useRef<HTMLInputElement>(null);
  const noticedPairings = useRef(new Set<string>());
  const scanLock = useRef(false);
  const suspendedShare = useRef<Modal>(null);
  const pairedSessions =
    data?.pairings
      ?.filter((pairing) => pairing.state === "paired")
      .map((pairing) => pairing.id)
      .sort()
      .join(",") ?? "";
  useEffect(() => {
    if (!pairedSessions) return;
    let active = true;
    void command<string[]>("presence")
      .then((devices) => {
        if (active) setOnline(devices);
      })
      .catch(report);
    return () => {
      active = false;
    };
  }, [pairedSessions, report]);
  const pendingPairings =
    data?.pairings?.filter(
      (pairing) =>
        pairing.code &&
        (pairing.state === "comparing" || pairing.state === "waiting"),
    ) ?? [];
  useEffect(() => {
    for (const id of noticedPairings.current) {
      if (!data?.pairings?.some((pairing) => pairing.id === id))
        noticedPairings.current.delete(id);
    }
    if (modal || palette) return;
    const incoming = data?.pairings?.find(
      (pairing) =>
        pairing.incoming &&
        pairing.code &&
        pairing.state === "comparing" &&
        !pairing.approved &&
        !noticedPairings.current.has(pairing.id),
    );
    if (incoming) {
      noticedPairings.current.add(incoming.id);
      setModal({ kind: "pairing", id: incoming.id });
    }
  }, [data?.pairings, modal, palette]);
  useEffect(() => {
    if (data?.service_error) report(data.service_error);
  }, [data?.service_error, report]);
  const run = useCallback(
    async (operation: () => Promise<unknown>) => {
      try {
        await operation();
        await refresh();
      } catch (error) {
        report(error);
      }
    },
    [refresh, report],
  );
  const scan = useCallback(async () => {
    if (scanLock.current) return;
    scanLock.current = true;
    setScanning(true);
    const checks = await Promise.allSettled([
      command<string[]>("presence"),
      command<Discovered[]>("discover"),
    ]);
    if (checks[0].status === "fulfilled") setOnline(checks[0].value);
    else {
      setOnline([]);
      report(checks[0].reason);
    }
    if (checks[1].status === "fulfilled") {
      setFound(checks[1].value);
      const verified = checks[1].value
        .filter((item) => item.verified)
        .map((item) => item.id);
      setOnline((current) => [...new Set([...current, ...verified])]);
    } else {
      setFound([]);
      report(checks[1].reason);
    }
    await refresh().catch(report);
    setScanning(false);
    scanLock.current = false;
  }, [refresh, report]);
  useEffect(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];
    const retain = (promise: Promise<() => void>) => {
      void promise
        .then((cleanup) => (disposed ? cleanup() : cleanups.push(cleanup)))
        .catch(report);
    };
    retain(listen<Transfer>("transfer", (event) => transfer(event.payload)));
    retain(listen<string>("server-error", (event) => report(event.payload)));
    retain(
      listen("pairing-changed", () => {
        void refresh().catch(report);
      }),
    );
    retain(
      getCurrentWebview().onDragDropEvent((event) => {
        setDrop(
          event.payload.type === "over" || event.payload.type === "enter",
        );
        if (event.payload.type === "drop") {
          if (event.payload.paths.length > 64)
            report("Choose up to 64 files or folders at a time.");
          else setModal({ kind: "share", sources: event.payload.paths });
        }
      }),
    );
    void refresh()
      .then(() => {
        if (!disposed) void scan();
      })
      .catch(report);
    const snapshots = window.setInterval(() => {
      void refresh().catch(report);
    }, 3000);
    const presence = window.setInterval(() => {
      void scan();
    }, 30000);
    const onFocus = () => {
      void refresh().catch(report);
      void scan();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
      clearInterval(snapshots);
      clearInterval(presence);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, report, scan, transfer]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        (!document.querySelector('[role="dialog"]') || palette)
      ) {
        const targetView = (
          { "1": "devices", "2": "shares", "3": "transfers" } as const
        )[event.key as "1" | "2" | "3"];
        if (targetView) {
          event.preventDefault();
          setPalette(false);
          setView(targetView);
          setSelected("");
          setRemote(null);
          setQuery("");
          return;
        }
        if (event.key === ",") {
          event.preventDefault();
          setPalette(false);
          setModal({ kind: "network" });
          return;
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        if (document.querySelector('[role="dialog"]') && !palette) return;
        event.preventDefault();
        setPalette((value) => !value);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        if (document.querySelector('[role="dialog"]')) return;
        event.preventDefault();
        filterRef.current?.focus();
        filterRef.current?.select();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [palette]);
  const pick = async (folder: boolean) => {
    const sources = await command<string[]>("pick_sources", { folder });
    if (sources.length) setModal({ kind: "share", sources });
  };
  const navigate = (view: View) => {
    setView(view);
    setSelected("");
    setRemote(null);
    setQuery("");
  };
  const tasks = data?.transfers.filter((item) => active(item.state)) ?? [];
  const finished = useFinished(data?.transfers ?? [], tasks);
  const peers = Object.values(data?.peers ?? {}).sort(
    (a, b) =>
      Number(online.includes(b.remote.identity.id)) -
        Number(online.includes(a.remote.identity.id)) ||
      a.remote.identity.name.localeCompare(b.remote.identity.name),
  );
  const onlineCount = peers.filter((peer) =>
    online.includes(peer.remote.identity.id),
  ).length;
  const selectedPeer = data?.peers[selected];
  const selectedShare = data?.shares.find((item) => item.share.id === selected);
  const selectedTransfer = data?.transfers.find((item) => item.id === selected);
  const includes = (name: string) =>
    name.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const visiblePeers = peers.filter((peer) =>
    includes(peer.remote.identity.name),
  );
  const visibleFound = found.filter(
    (item) => !item.paired && includes(item.name),
  );
  const visibleShares =
    data?.shares.filter((item) => includes(item.share.name)) ?? [];
  const visibleTransfers =
    data?.transfers.filter((item) => includes(item.file.name)) ?? [];
  const hasDetails = Boolean(
    (view === "devices" && selectedPeer) ||
    (view === "shares" && selectedShare) ||
    (view === "transfers" && selectedTransfer),
  );
  const listKeys = (event: ReactKeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const inFilter = target === filterRef.current;
    if (!inFilter && !target.matches("[data-list-item]")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (query) setQuery("");
      else {
        setSelected("");
        filterRef.current?.focus();
      }
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (inFilter && event.key !== "ArrowDown" && event.key !== "ArrowUp")
      return;
    const rows = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "[data-list-item]:not(:disabled)",
      ),
    );
    if (!rows.length) return;
    event.preventDefault();
    const current = rows.indexOf(target as HTMLButtonElement);
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : current < 0
            ? event.key === "ArrowUp"
              ? rows.length - 1
              : 0
            : Math.max(
                0,
                Math.min(
                  rows.length - 1,
                  current + (event.key === "ArrowDown" ? 1 : -1),
                ),
              );
    rows[index].focus();
  };
  const choosePeer = (peer: Peer) => {
    setSelected(peer.remote.identity.id);
    setRemote(null);
  };
  const openPeer = async (peer: Peer) => {
    await command("verify_peer", { remote: peer.remote });
    setOnline((current) => [...new Set([...current, peer.remote.identity.id])]);
    setRemote(peer.remote);
    setSelected(peer.remote.identity.id);
    setQuery("");
  };
  const pairNearby = async (device: Discovered) => {
    if (data && localOnly(data.network)) {
      setModal({ kind: "connect", target: device });
      return;
    }
    const pairing = await command<{ id: string }>("start_nearby_pairing", {
      device: device.id,
      endpoints: device.endpoints,
    });
    await refresh();
    setModal({ kind: "pairing", id: pairing.id });
  };
  const closeConnection = () => {
    setModal(suspendedShare.current);
    suspendedShare.current = null;
  };
  const menuActions: MenuAction[] = [
    {
      id: "nav-devices",
      label: "Devices",
      description: "Find and browse your computers",
      group: "Suggestions",
      icon: <Monitor size={17} />,
      shortcut: "Ctrl 1",
      action: () => navigate("devices"),
    },
    {
      id: "nav-shares",
      label: "My shares",
      description: "Manage files shared from this computer",
      group: "Suggestions",
      icon: <Folder size={17} />,
      shortcut: "Ctrl 2",
      action: () => navigate("shares"),
    },
    {
      id: "nav-transfers",
      label: "Transfers",
      description: "View downloads and resume interrupted files",
      group: "Suggestions",
      icon: <ArrowDownToLine size={17} />,
      shortcut: "Ctrl 3",
      action: () => navigate("transfers"),
    },
    {
      id: "add-share",
      label: "Add share",
      description: "Choose files to share",
      group: "Actions",
      icon: <Plus size={17} />,
      action: () => void run(() => pick(false)),
      verb: "Choose",
    },
    {
      id: "add-folder",
      label: "Add folder",
      description: "Choose a folder to share",
      group: "Actions",
      icon: <FolderPlus size={17} />,
      action: () => void run(() => pick(true)),
      verb: "Choose",
    },
    {
      id: "find-devices",
      label: "Find nearby devices",
      description: "Select a computer and pair",
      group: "Actions",
      icon: <Wifi size={17} />,
      keywords: ["connect", "pair", "add device"],
      action: () => setModal({ kind: "connect" }),
    },
    {
      id: "settings",
      label: "Connection settings",
      description: "Network, device name, and browser access",
      group: "Actions",
      icon: <Settings2 size={17} />,
      shortcut: "Ctrl ,",
      action: () => setModal({ kind: "network" }),
    },
    {
      id: "manual-connect",
      label: "Connect with an invitation",
      description: "An alternative when discovery is unavailable",
      group: "Actions",
      icon: <Link size={17} />,
      action: () => setModal({ kind: "connect", initialMode: "receive" }),
    },
    {
      id: "hide",
      label: "Hide to tray",
      description: "Keep sharing in the background",
      group: "Actions",
      icon: <Monitor size={17} />,
      action: () => void run(() => getCurrentWindow().close()),
      verb: "Hide",
    },
    {
      id: "quit",
      label: "Quit Ulak",
      description: "Stop sharing and close the application",
      group: "Actions",
      icon: <X size={17} />,
      action: () => void run(() => command("quit_app")),
      verb: "Quit",
    },
    ...peers.map((peer): MenuAction => ({
      id: `peer-${peer.remote.identity.id}`,
      label: peer.remote.identity.name,
      description: online.includes(peer.remote.identity.id)
        ? "Online · browse shared files"
        : "Offline · view device details",
      group: "Devices",
      icon: <Monitor size={17} />,
      action: () => {
        navigate("devices");
        choosePeer(peer);
        if (online.includes(peer.remote.identity.id))
          void run(() => openPeer(peer));
      },
    })),
    ...found
      .filter((device) => !device.paired)
      .map((device): MenuAction => ({
        id: `nearby-${device.id}`,
        label: device.name,
        description: "Nearby · pair this device",
        group: "Devices",
        icon: <Wifi size={17} />,
        action: () => void run(() => pairNearby(device)),
        verb: "Pair",
      })),
    ...(data?.shares ?? []).map((item): MenuAction => ({
      id: `share-${item.share.id}`,
      label: item.share.name,
      description: audienceLabel(item.share.audience),
      group: "Shares",
      icon: item.is_dir ? <Folder size={17} /> : <File size={17} />,
      action: () => {
        navigate("shares");
        setSelected(item.share.id);
      },
    })),
  ];
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <strong>ulak</strong>
        </div>
        <button
          className="command-trigger"
          aria-keyshortcuts="Control+k"
          onClick={() => setPalette(true)}
        >
          <Search size={14} />
          <span>Commands</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav aria-label="Main navigation">
          <Nav
            selected={view === "devices"}
            onClick={() => navigate("devices")}
            icon={<Monitor size={17} />}
            label="Devices"
            count={peers.length}
          />
          <Nav
            selected={view === "shares"}
            onClick={() => navigate("shares")}
            icon={<Folder size={17} />}
            label="My shares"
            count={data?.shares.length ?? 0}
          />
          <Nav
            selected={view === "transfers"}
            onClick={() => navigate("transfers")}
            icon={<ArrowDownToLine size={17} />}
            label="Transfers"
            count={tasks.length}
          />
        </nav>
        <div className="sidebar-bottom">
          <Button variant="ghost" onClick={() => setModal({ kind: "network" })}>
            <Settings2 size={16} />
            Connection settings
          </Button>
          <div className="self">
            <span className={`dot ${data?.serving ? "green" : ""}`} />
            <span>
              {data?.identity.name ?? "Connecting…"}
              <small>
                {data?.serving ? "Ready to share" : "Sharing is stopped"}
              </small>
            </span>
          </div>
          {data?.shortcut_available && (
            <div className="global-shortcut-hint">
              <kbd>Ctrl Alt U</kbd>
              <span>Open Ulak</span>
            </div>
          )}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <h1>
            {view === "devices"
              ? "Devices"
              : view === "shares"
                ? "My shares"
                : "Transfers"}
          </h1>
          {data &&
            (() => {
              const isLocal = localOnly(data.network);
              const stopped = !data.serving;
              const pillClass =
                stopped || isLocal
                  ? "warn"
                  : onlineCount || data.network.advertise
                    ? "good"
                    : "";
              const pillText = stopped
                ? "Sharing is stopped"
                : isLocal
                  ? "Not visible to other devices"
                  : onlineCount
                    ? `Connected · ${onlineCount} device${onlineCount === 1 ? "" : "s"} online`
                    : data.network.advertise
                      ? "Visible on your network"
                      : "Reachable by link only";
              const handlePillClick = () => {
                if (stopped || (!isLocal && !onlineCount && !data.network.advertise)) {
                  setModal({ kind: "network" });
                } else if (isLocal) {
                  setModal({ kind: "connect" });
                } else {
                  navigate("devices");
                }
              };
              return (
                <button
                  className={`status-pill ${pillClass}`}
                  onClick={handlePillClick}
                >
                  <span className="dot" />
                  {pillText}
                </button>
              );
            })()}
          <div className="actions">
            {view === "devices" && (
              <Button
                variant="ghost"
                onClick={() => setModal({ kind: "connect" })}
              >
                <Plus size={14} /> Connect a device
              </Button>
            )}
            <Button variant="ghost" onClick={() => run(() => pick(true))}>
              <FolderPlus size={16} />
              Add folder
            </Button>
            <Button variant="default" onClick={() => run(() => pick(false))}>
              <Plus size={17} />
              Add share
            </Button>
          </div>
        </header>
        {error && (
          <div className="error-banner">
            <ErrorNotice
              error={error}
              message="Something went wrong. Check your connection and try again."
            />
            <Button
              variant="ghost"
              aria-label="Dismiss error"
              onClick={() => useStore.setState({ error: "" })}
            >
              <X size={16} />
            </Button>
          </div>
        )}
        {pendingPairings.map((pairing) => (
          <div key={pairing.id} className="pairing-banner">
            <Monitor size={17} />
            <span>
              {pairing.incoming
                ? `${pairing.name} wants to pair`
                : `Pairing with ${pairing.name}`}
            </span>
            <Button
              onClick={() => setModal({ kind: "pairing", id: pairing.id })}
            >
              Review
            </Button>
          </div>
        ))}
        <div className={`content-grid ${hasDetails ? "with-details" : ""}`}>
          <main onKeyDown={listKeys}>
            <div className="list-toolbar">
              <label className="search">
                <Search size={16} />
                <input
                  ref={filterRef}
                  aria-label="Filter current list"
                  aria-keyshortcuts="Control+f"
                  placeholder={
                    remote
                      ? "Filter files…"
                      : view === "devices"
                        ? "Find a device…"
                        : "Filter by name…"
                  }
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <kbd className="filter-shortcut">Ctrl F</kbd>
              {view === "devices" ? (
                <Button
                  variant="ghost"
                  disabled={scanning}
                  onClick={() => void scan()}
                >
                  <RefreshCw size={15} className={scanning ? "spin" : ""} />
                  {scanning ? "Searching…" : "Search again"}
                </Button>
              ) : null}
            </div>
            {view === "devices" && !remote && (
              <>
                {data && localOnly(data.network) && (
                  <div className="setup-notice">
                    <Wifi size={18} />
                    <p>
                      <b>Only this computer can see Ulak right now.</b>
                      <small>
                        Turn on network sharing so your other computers can find
                        it.
                      </small>
                    </p>
                    <Button
                      variant="default"
                      onClick={() => setModal({ kind: "connect" })}
                    >
                      Turn on
                    </Button>
                  </div>
                )}
                {!peers.length && !query && (
                  <Radar
                    devices={visibleFound}
                    scanning={scanning}
                    dimmed={!!data && localOnly(data.network)}
                    label="Nearby devices"
                    onSelect={(device) => {
                      const item = visibleFound.find((d) => d.id === device.id);
                      if (item) void run(() => pairNearby(item));
                    }}
                    status={
                      data && localOnly(data.network)
                        ? "Turn on network sharing to look for nearby computers."
                        : scanning
                          ? "Looking for nearby computers…"
                          : visibleFound.length
                            ? "Choose a computer to pair with it."
                            : "No computers nearby yet. Open Ulak on another computer on the same network."
                    }
                  />
                )}
                {(peers.length > 0 || !!query) && (
                  <SectionLabel
                    label="Your devices"
                    extra={`${onlineCount} of ${peers.length} online`}
                  />
                )}
                {visiblePeers.map((peer) => (
                  <button
                    key={peer.remote.identity.id}
                    className={`list-row ${selected === peer.remote.identity.id ? "selected" : ""} ${online.includes(peer.remote.identity.id) ? "" : "offline"}`}
                    data-list-item
                    aria-pressed={selected === peer.remote.identity.id}
                    onFocus={() => choosePeer(peer)}
                    onClick={() => choosePeer(peer)}
                    onDoubleClick={() => run(() => openPeer(peer))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void run(() => openPeer(peer));
                      }
                    }}
                  >
                    <span
                      className={`item-icon ${online.includes(peer.remote.identity.id) ? "warm" : ""}`}
                    >
                      <Monitor size={22} />
                    </span>
                    <span className="row-name">
                      {peer.remote.identity.name}
                      <small>
                        {online.includes(peer.remote.identity.id)
                          ? "Ready to browse"
                          : lastSeen(peer.last_connected)}
                      </small>
                    </span>
                    <span className="status">
                      <span
                        className={`dot ${online.includes(peer.remote.identity.id) ? "green" : ""}`}
                      />
                      {online.includes(peer.remote.identity.id)
                        ? "Online"
                        : "Offline"}
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
                {peers.length > 0 && !visiblePeers.length && (
                  <p className="quiet">No saved devices match “{query}”.</p>
                )}
                {(peers.length > 0 || !!query) && (
                  <>
                    <SectionLabel
                      label="Nearby"
                      extra="New computers you can pair"
                    />
                    {visibleFound.map((item) => (
                      <div className="list-row" key={item.id}>
                        <span className="item-icon">
                          <Wifi size={21} />
                        </span>
                        <span className="row-name">
                          {item.name}
                          <small>Ready to pair</small>
                        </span>
                        <Button
                          data-list-item
                          onClick={() => void run(() => pairNearby(item))}
                        >
                          Pair
                        </Button>
                      </div>
                    ))}
                    {!visibleFound.length && (
                      <p className="quiet">
                        {scanning
                          ? "Looking for Ulak devices on your network…"
                          : query
                            ? `No discovered devices match “${query}”.`
                            : "Nothing new nearby. Open Ulak on another computer and it appears here."}
                      </p>
                    )}
                  </>
                )}
                {!!data?.shares.length && !query && (
                  <div className="recent-shares">
                    <SectionLabel label="My shares" extra="Quick access" />
                    {data.shares
                      .slice(-3)
                      .reverse()
                      .map((item) => (
                        <button
                          key={item.share.id}
                          className="list-row"
                          data-list-item
                          onClick={() => {
                            navigate("shares");
                            setSelected(item.share.id);
                          }}
                        >
                          <span className="item-icon">
                            {item.is_dir ? (
                              <Folder size={18} />
                            ) : (
                              <File size={18} />
                            )}
                          </span>
                          <span className="row-name">
                            {item.share.name}
                            <small>{audienceLabel(item.share.audience)}</small>
                          </span>
                          <ChevronRight size={14} />
                        </button>
                      ))}
                  </div>
                )}
                <button
                  className="drop-target"
                  onClick={() => run(() => pick(false))}
                >
                  <Upload size={19} />
                  <span>
                    Drop files or folders{" "}
                    <small>Choose who can access them next</small>
                  </span>
                  <Plus size={17} />
                </button>
              </>
            )}
            {view === "devices" && remote && (
              <RemoteBrowser
                remote={remote}
                onBack={() => {
                  setRemote(null);
                  setQuery("");
                }}
                run={run}
                setPreparing={setPreparing}
                query={query}
              />
            )}
            {view === "shares" && (
              <>
                <SectionLabel
                  label="Shared files and folders"
                  extra={`${data?.shares.length ?? 0} share${data?.shares.length === 1 ? "" : "s"}`}
                />
                {visibleShares.map((item) => (
                  <button
                    className={`list-row ${selected === item.share.id ? "selected" : ""}`}
                    key={item.share.id}
                    data-list-item
                    aria-pressed={selected === item.share.id}
                    onFocus={() => setSelected(item.share.id)}
                    onClick={() => setSelected(item.share.id)}
                  >
                    <span className="item-icon warm">
                      {item.is_dir ? <Folder size={22} /> : <File size={22} />}
                    </span>
                    <span className="row-name">
                      {item.share.name}
                      <small>
                        {audienceLabel(item.share.audience)}
                        {data?.sessions.some(
                          (s) =>
                            s.shares.includes(item.share.id) &&
                            s.expires_at > Date.now() / 1000,
                        )
                          ? " · guest session"
                          : ""}
                      </small>
                    </span>
                    <span className={`badge ${item.available ? "" : "bad"}`}>
                      {item.available ? "Available" : "Unavailable"}
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
                {!data?.shares.length && (
                  <Empty
                    icon={<FolderPlus size={30} />}
                    title="No shares yet"
                    text="Choose files or folders, then set who can access them."
                    action={
                      <Button onClick={() => run(() => pick(false))}>
                        Choose files
                      </Button>
                    }
                  />
                )}
                {!!data?.shares.length && !visibleShares.length && (
                  <p className="quiet">No shares match “{query}”.</p>
                )}
                <button
                  className="drop-target"
                  onClick={() => run(() => pick(true))}
                >
                  <Upload size={19} />
                  <span>
                    Drop files or folders{" "}
                    <small>Choose who can access them before sharing</small>
                  </span>
                </button>
              </>
            )}
            {view === "transfers" && (
              <>
                <SectionLabel
                  label="Downloads"
                  extra={`${tasks.length} active`}
                />
                {preparing > 0 && (
                  <p className="quiet">
                    <LoaderCircle className="spin" size={16} />
                    Getting {preparing} download{preparing === 1 ? "" : "s"}{" "}
                    ready…
                  </p>
                )}
                {visibleTransfers.map((item) => (
                  <button
                    key={item.id}
                    className={`list-row transfer-row ${selected === item.id ? "selected" : ""}`}
                    data-list-item
                    aria-pressed={selected === item.id}
                    onFocus={() => setSelected(item.id)}
                    onClick={() => setSelected(item.id)}
                  >
                    <span className="item-icon">
                      {item.state === "completed" ? (
                        <Check size={21} />
                      ) : (
                        <ArrowDownToLine size={21} />
                      )}
                    </span>
                    <span className="row-name">
                      {item.file.name}
                      <small>
                        {item.remote.identity.name} · {size(item.written)} /{" "}
                        {size(item.file.size)}
                      </small>
                      <Progress transfer={item} />
                    </span>
                    <span
                      className={`badge ${item.state === "failed" || item.state === "interrupted" ? "bad" : ""}`}
                    >
                      {transferLabel[item.state]}
                    </span>
                  </button>
                ))}
                {!data?.transfers.length && !preparing && (
                  <Empty
                    icon={<ArrowDownToLine size={30} />}
                    title="No downloads yet"
                    text="Open a device, browse its shares, and choose files to download."
                  />
                )}
                {!!data?.transfers.length && !visibleTransfers.length && (
                  <p className="quiet">No downloads match “{query}”.</p>
                )}
              </>
            )}
          </main>
          {hasDetails && (
            <aside className="details" aria-label="Selected item details">
              <div className="details-heading">
                <span>Details</span>
                <Button
                  variant="ghost"
                  aria-label="Close details"
                  onClick={() => {
                    setSelected("");
                    filterRef.current?.focus();
                  }}
                >
                  <X size={14} />
                </Button>
              </div>
              {view === "devices" && selectedPeer ? (
                <>
                  <h2>{selectedPeer.remote.identity.name}</h2>
                  <span className="badge">
                    {online.includes(selected)
                      ? "Online · secure connection"
                      : "Offline"}
                  </span>
                  <dl>
                    <dt>Last connected</dt>
                    <dd>{date(selectedPeer.last_connected)}</dd>
                  </dl>
                  <details className="advanced">
                    <summary>Connection details</summary>
                    <dl>
                      <dt>Device ID</dt>
                      <dd className="mono">{selected}</dd>
                      <dt>Last known address</dt>
                      <dd className="mono">{selectedPeer.remote.endpoint}</dd>
                    </dl>
                  </details>
                  <Button
                    variant="default"
                    onClick={() => run(() => openPeer(selectedPeer))}
                  >
                    <Folder size={16} />
                    {online.includes(selected)
                      ? "Browse shares"
                      : "Try connecting"}
                  </Button>
                  {!online.includes(selected) && (
                    <p className="hint">
                      This device is offline. Share permissions are kept until
                      it reconnects.
                    </p>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() =>
                      run(async () => {
                        await command("unpair", { device: selected });
                        setSelected("");
                        setRemote(null);
                      })
                    }
                  >
                    Forget device
                  </Button>
                </>
              ) : view === "shares" && selectedShare ? (
                <>
                  <h2>{selectedShare.share.name}</h2>
                  <span className="badge">
                    {selectedShare.available
                      ? "Available"
                      : "File or folder unavailable"}
                  </span>
                  <dl>
                    <dt>Original location</dt>
                    <dd className="mono">{selectedShare.share.source}</dd>
                    <dt>Who can access?</dt>
                    <dd>{audienceLabel(selectedShare.share.audience)}</dd>
                    {selectedShare.share.audience.kind === "devices" && (
                      <dd>
                        {selectedShare.share.audience.devices
                          .map(
                            (id) => data?.peers[id]?.remote.identity.name ?? id,
                          )
                          .join(", ")}
                      </dd>
                    )}
                  </dl>
                  <Button
                    variant="default"
                    onClick={() =>
                      setModal({
                        kind: "share",
                        sources: [],
                        existing: selectedShare,
                      })
                    }
                  >
                    <Users size={16} />
                    Manage access
                  </Button>
                  <Button
                    onClick={() =>
                      setModal({ kind: "invite", share: selected })
                    }
                  >
                    <Link size={16} />
                    Guest invitation
                  </Button>
                  <div className="guest-sessions">
                    <SectionLabel label="Browser guests" />
                    {data?.sessions
                      .filter((session) => session.shares.includes(selected))
                      .map((session) => (
                        <div key={session.id}>
                          <small>
                            {session.expires_at > Date.now() / 1000
                              ? `Expires ${date(session.expires_at)}`
                              : "Expired"}
                            <span className="mono">
                              {session.id.slice(0, 12)}
                            </span>
                          </small>
                          <Button
                            variant="ghost"
                            onClick={() =>
                              run(() =>
                                command("revoke_guest", {
                                  session: session.id,
                                }),
                              )
                            }
                          >
                            End access
                          </Button>
                        </div>
                      ))}
                    {!data?.sessions.some((session) =>
                      session.shares.includes(selected),
                    ) && <p className="hint">No browser guests yet.</p>}
                  </div>
                  <Button
                    variant="destructive"
                    onClick={() =>
                      setModal({ kind: "remove", share: selectedShare })
                    }
                  >
                    Remove share
                  </Button>
                </>
              ) : view === "transfers" && selectedTransfer ? (
                <>
                  <h2>{selectedTransfer.file.name}</h2>
                  <span className="badge">
                    {transferLabel[selectedTransfer.state]}
                  </span>
                  <Progress transfer={selectedTransfer} />
                  <dl>
                    <dt>Destination</dt>
                    <dd className="mono">{selectedTransfer.destination}</dd>
                    <dt>Progress</dt>
                    <dd>
                      {size(selectedTransfer.written)} of{" "}
                      {size(selectedTransfer.file.size)}
                    </dd>
                    <dt>Speed</dt>
                    <dd>{size(selectedTransfer.bytes_per_second)}/s</dd>
                  </dl>
                  {selectedTransfer.error && (
                    <ErrorNotice
                      error={selectedTransfer.error}
                      message="This download stopped. Check the connection and save location, then try resuming."
                    />
                  )}
                  <TransferActions transfer={selectedTransfer} run={run} />
                  <p className="hint">
                    Ulak checks the whole file before marking it downloaded. If
                    you cancel, you can resume later from Transfers.
                  </p>
                </>
              ) : null}
            </aside>
          )}
        </div>
        <TransferDock
          tasks={tasks}
          finished={finished}
          preparing={preparing}
          serving={!!data?.serving}
          onOpen={() => navigate("transfers")}
          onCancel={(id) =>
            run(() => request({ command: "cancel", transfer: id }))
          }
        />
      </div>
      {drop && (
        <div className="drop-overlay">
          <Upload size={44} />
          <h2>Add to My shares</h2>
          <p>Choose who can access these files next.</p>
        </div>
      )}
      {modal?.kind === "share" && (
        <ShareDialog
          key={modal.existing?.share.id ?? modal.sources.join("|")}
          sources={modal.sources}
          existing={modal.existing}
          online={online}
          onClose={() => setModal(null)}
          onPairNew={() => {
            suspendedShare.current = modal;
            setModal({ kind: "connect" });
          }}
        />
      )}
      {modal?.kind === "connect" && (
        <NearbyDialog
          found={found}
          scanning={scanning}
          onScan={scan}
          onPair={pairNearby}
          target={modal.target}
          initialMode={modal.initialMode}
          onNetwork={() => setModal({ kind: "network", returnTo: modal })}
          onClose={closeConnection}
          onRemote={(value) => {
            setRemote(value);
            setView("devices");
          }}
        />
      )}
      {modal?.kind === "invite" && (
        <InviteDialog share={modal.share} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "pairing" && (
        <PairingDialog
          pairing={data?.pairings?.find((pairing) => pairing.id === modal.id)}
          onClose={closeConnection}
        />
      )}
      {modal?.kind === "network" && data && (
        <NetworkDialog
          network={data.network}
          onClose={() => setModal(modal.returnTo ?? null)}
        />
      )}
      {modal?.kind === "remove" && (
        <Dialog
          open
          onClose={() => setModal(null)}
          title="Remove this share?"
          description="Other devices will no longer be able to browse or download it. Your original files stay where they are."
        >
          <p>{modal.share.share.name}</p>
          <Button
            variant="destructive"
            onClick={() =>
              run(async () => {
                await request({
                  command: "remove",
                  share: modal.share.share.id,
                });
                setModal(null);
                setSelected("");
              })
            }
          >
            Remove share
          </Button>
        </Dialog>
      )}
      <CommandMenu
        open={palette}
        onClose={() => setPalette(false)}
        actions={menuActions}
      />
    </div>
  );
}

function Nav({
  selected,
  icon,
  label,
  count,
  onClick,
}: {
  selected: boolean;
  icon: ReactNode;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={selected ? "page" : undefined}
      className={selected ? "nav-item current" : "nav-item"}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      <small>{count}</small>
    </button>
  );
}
function SectionLabel({ label, extra }: { label: string; extra?: string }) {
  return (
    <div className="section-label">
      <span>{label}</span>
      <small>{extra}</small>
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div>{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Progress({ transfer }: { transfer: Transfer }) {
  const percent =
    transfer.state === "completed"
      ? 100
      : transfer.file.size
        ? Math.min(100, (100 * transfer.written) / transfer.file.size)
        : 0;
  return (
    <div
      className={`progress ${transfer.state}`}
      role="progressbar"
      aria-label={`${transfer.file.name}: ${transferLabel[transfer.state]}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.floor(percent)}
    >
      <span style={{ transform: `scaleX(${percent / 100})` }} />
    </div>
  );
}
function TransferActions({
  transfer,
  run,
}: {
  transfer: Transfer;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  return active(transfer.state) ? (
    <Button
      onClick={() =>
        run(() => request({ command: "cancel", transfer: transfer.id }))
      }
    >
      Cancel download
    </Button>
  ) : transfer.state !== "completed" ? (
    <Button
      onClick={() =>
        run(() => request({ command: "resume", transfer: transfer.id }))
      }
    >
      Resume download
    </Button>
  ) : (
    <p className="verified">
      <ShieldCheck size={16} />
      File checked and saved
    </p>
  );
}

// Remember a download that just finished in this window, so the dock can
// briefly confirm it instead of silently returning to idle.
function useFinished(transfers: Transfer[], tasks: Transfer[]) {
  const watched = useRef(new Set<string>());
  const [finished, setFinished] = useState<Transfer | null>(null);
  const activeIds = tasks.map((item) => item.id).join(",");
  useEffect(() => {
    for (const id of watched.current) {
      const item = transfers.find((transfer) => transfer.id === id);
      if (item && !active(item.state)) {
        watched.current.delete(id);
        if (item.state === "completed") setFinished(item);
      }
    }
    for (const task of tasks) watched.current.add(task.id);
  }, [activeIds, transfers]);
  useEffect(() => {
    if (!finished) return;
    const timer = window.setTimeout(() => setFinished(null), 5000);
    return () => clearTimeout(timer);
  }, [finished]);
  return tasks.length ? null : finished;
}

function remaining(transfer: Transfer) {
  if (transfer.state !== "transferring" || transfer.bytes_per_second <= 0)
    return "";
  const seconds =
    Math.max(0, transfer.file.size - transfer.written) /
    transfer.bytes_per_second;
  if (seconds < 10) return "a few seconds left";
  if (seconds < 60) return `${Math.round(seconds)} seconds left`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60)
    return `about ${minutes} minute${minutes === 1 ? "" : "s"} left`;
  return `about ${Math.round(minutes / 60)} h left`;
}

function TransferDock({
  tasks,
  finished,
  preparing,
  serving,
  onOpen,
  onCancel,
}: {
  tasks: Transfer[];
  finished: Transfer | null;
  preparing: number;
  serving: boolean;
  onOpen: () => void;
  onCancel: (id: string) => void;
}) {
  const current = tasks[0];
  if (current) {
    const percent = current.file.size
      ? Math.min(100, Math.floor((100 * current.written) / current.file.size))
      : 0;
    const left = remaining(current);
    return (
      <footer className="transfer-dock card">
        <span className="dock-file">
          <File size={18} />
        </span>
        <div className="dock-body">
          <div className="dock-title">
            <span>
              <small>
                {transferLabel[current.state]} from{" "}
                {current.remote.identity.name}
              </small>
              <b>{current.file.name}</b>
            </span>
            {current.state === "transferring" &&
              current.bytes_per_second > 0 && (
                <span className="dock-speed">
                  {size(current.bytes_per_second)}/s
                </span>
              )}
          </div>
          <Progress transfer={current} />
          <div className="dock-meta">
            <span>
              <em>{percent}%</em> · {size(current.written)} of{" "}
              {size(current.file.size)}
              {left ? ` · ${left}` : ""}
            </span>
            {tasks.length > 1 && (
              <button className="dock-more" onClick={onOpen}>
                +{tasks.length - 1} more
              </button>
            )}
          </div>
        </div>
        <Button variant="ghost" onClick={() => onCancel(current.id)}>
          Cancel
        </Button>
      </footer>
    );
  }
  return (
    <footer className={`transfer-dock ${finished ? "done" : ""}`}>
      {finished ? (
        <>
          <span className="dock-check">
            <Check size={14} />
          </span>
          <span>
            <b>{finished.file.name}</b> downloaded and checked
          </span>
        </>
      ) : (
        <>
          <span className={`dot ${serving ? "green" : ""}`} />
          <span>
            {preparing ? "Preparing download…" : "No active transfers"}
          </span>
        </>
      )}
      <Button variant="ghost" onClick={onOpen}>
        Transfers <ArrowRight size={14} />
      </Button>
    </footer>
  );
}
