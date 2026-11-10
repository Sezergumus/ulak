import {
  ShareDialog,
  ConnectDialog,
  InviteDialog,
  NetworkDialog,
} from "./dialogs";
import { RemoteBrowser } from "./RemoteBrowser";
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
import { Command } from "cmdk";
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
  Radio,
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
  | { kind: "remove"; share: LocalShare }
  | null;
const date = (timestamp: number | null) =>
  timestamp
    ? new Date(timestamp * 1000).toLocaleString("en-GB")
    : "Not connected yet";

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
  const commandInputRef = useRef<HTMLInputElement>(null);
  const scanLock = useRef(false);
  const suspendedShare = useRef<Modal>(null);
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
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
  }, []);
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
  const peers = Object.values(data?.peers ?? {}).sort(
    (a, b) =>
      Number(online.includes(b.remote.identity.id)) -
        Number(online.includes(a.remote.identity.id)) ||
      a.remote.identity.name.localeCompare(b.remote.identity.name),
  );
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
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <Radio size={17} />
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
                  {scanning ? "Scanning" : "Scan network"}
                </Button>
              ) : null}
            </div>
            {view === "devices" && !remote && (
              <>
                {data && localOnly(data.network) && (
                  <div className="setup-notice">
                    <p>Other devices cannot reach this computer yet.</p>
                    <Button onClick={() => setModal({ kind: "network" })}>
                      Set up network sharing
                    </Button>
                  </div>
                )}
                <SectionLabel
                  label="Saved devices"
                  extra={`${peers.filter((peer) => online.includes(peer.remote.identity.id)).length} online · ${peers.length} saved`}
                />
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
                          ? "Connected securely"
                          : `Last connected: ${date(peer.last_connected)}`}
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
                {!peers.length && (
                  <Empty
                    icon={<Monitor size={30} />}
                    title="No saved devices"
                    text="Connect a computer to browse its shares."
                    action={
                      <Button onClick={() => setModal({ kind: "connect" })}>
                        <Link size={15} />
                        Connect a device
                      </Button>
                    }
                  />
                )}
                {peers.length > 0 && !visiblePeers.length && (
                  <p className="quiet">No saved devices match “{query}”.</p>
                )}
                <SectionLabel
                  label="Found on the network"
                  extra="Updates automatically"
                />
                {visibleFound.map((item) => (
                  <div className="list-row" key={item.id}>
                    <span className="item-icon">
                      <Wifi size={21} />
                    </span>
                    <span className="row-name">
                      {item.name}
                      <small>
                        Connect using an invitation from this computer
                      </small>
                    </span>
                    <Button
                      data-list-item
                      onClick={() =>
                        setModal({ kind: "connect", target: item })
                      }
                    >
                      Connect
                    </Button>
                  </div>
                ))}
                {!visibleFound.length && (
                  <p className="quiet">
                    {scanning
                      ? "Looking for Ulak devices on your network…"
                      : query
                        ? `No discovered devices match “${query}”.`
                        : "No new devices found. Keep Ulak open on the other computer. This list refreshes every 30 seconds."}
                  </p>
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
        <footer className="transfer-dock">
          {tasks.length ? (
            <>
              <LoaderCircle size={17} className="spin" />
              <span>
                <b>{tasks[0].file.name}</b>
                <small>
                  {transferLabel[tasks[0].state]} ·{" "}
                  {size(tasks[0].bytes_per_second)}/s
                  {tasks.length > 1 ? ` · +${tasks.length - 1} more` : ""}
                </small>
              </span>
              <Progress transfer={tasks[0]} />
              <Button
                variant="ghost"
                onClick={() =>
                  run(() =>
                    request({ command: "cancel", transfer: tasks[0].id }),
                  )
                }
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <span className={`dot ${data?.serving ? "green" : ""}`} />
              <span>
                {preparing ? "Preparing download…" : "No active transfers"}
              </span>
            </>
          )}
          <Button variant="ghost" onClick={() => navigate("transfers")}>
            Transfers <ArrowRight size={14} />
          </Button>
        </footer>
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
        <ConnectDialog
          target={modal.target}
          initialMode={modal.initialMode}
          onNetwork={() => setModal({ kind: "network", returnTo: modal })}
          onClose={() => {
            setModal(suspendedShare.current);
            suspendedShare.current = null;
          }}
          onRemote={(value) => {
            setRemote(value);
            setView("devices");
          }}
        />
      )}
      {modal?.kind === "invite" && (
        <InviteDialog share={modal.share} onClose={() => setModal(null)} />
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
      <Dialog
        open={palette}
        onClose={() => setPalette(false)}
        title="Commands"
        description="Find a device, open a share, or choose an action."
        initialFocusRef={commandInputRef}
      >
        <Command className="command-menu">
          <Command.Input ref={commandInputRef} placeholder="Type a command…" />
          <Command.List>
            <Command.Empty>No matching commands.</Command.Empty>
            {[
              ["Devices", () => navigate("devices")],
              ["My shares", () => navigate("shares")],
              ["Transfers", () => navigate("transfers")],
              ["Add share", () => run(() => pick(false))],
              ["Add folder", () => run(() => pick(true))],
              ["Connect a device", () => setModal({ kind: "connect" })],
              [
                "Create invitation",
                () => setModal({ kind: "connect", initialMode: "create" }),
              ],
              ["Connection settings", () => setModal({ kind: "network" })],
              ["Hide to tray", () => run(() => getCurrentWindow().close())],
              ["Quit Ulak", () => run(() => command("quit_app"))],
            ].map(([label, action]) => (
              <Command.Item
                key={String(label)}
                onSelect={() => {
                  setPalette(false);
                  (action as () => void)();
                }}
              >
                {String(label)}
              </Command.Item>
            ))}
            {peers.map((peer) => (
              <Command.Item
                key={peer.remote.identity.id}
                value={`device ${peer.remote.identity.name}`}
                onSelect={() => {
                  navigate("devices");
                  choosePeer(peer);
                  setPalette(false);
                }}
              >
                Device · {peer.remote.identity.name}
              </Command.Item>
            ))}
            {data?.shares.map((item) => (
              <Command.Item
                key={item.share.id}
                value={`share ${item.share.name}`}
                onSelect={() => {
                  navigate("shares");
                  setSelected(item.share.id);
                  setPalette(false);
                }}
              >
                Share · {item.share.name}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </Dialog>
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
      <span style={{ width: `${percent}%` }} />
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
