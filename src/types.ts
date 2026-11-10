export type Identity = { id: string; name: string; public_key: string };
export type Remote = { identity: Identity; endpoint: string; ca_pem: string };
export type Peer = { remote: Remote; last_connected: number | null };
export type Audience =
  | { kind: "private" }
  | { kind: "lan" }
  | { kind: "devices"; devices: string[] };
export type Share = {
  id: string;
  name: string;
  source: string;
  audience: Audience;
};
export type LocalShare = { share: Share; available: boolean; is_dir: boolean };
export type Session = {
  id: string;
  shares: string[];
  created_at: number;
  last_used: number;
  expires_at: number;
};
export type Network = {
  endpoint: string;
  bind: string;
  lan: string[];
  advertise: boolean;
  onboarding: string | null;
};
export type NetworkChoice = { name: string; address: string; range: string };
export const localOnly = (network: Network) => {
  try {
    const host = new URL(network.endpoint).hostname;
    return /^127\./.test(host) || ["[::1]", "localhost"].includes(host);
  } catch {
    return false;
  }
};
export type TransferState =
  | "queued"
  | "preparing"
  | "transferring"
  | "interrupted"
  | "verifying"
  | "completed"
  | "cancelled"
  | "failed";
export type Transfer = {
  id: string;
  remote: Remote;
  file: { name: string; size: number };
  destination: string;
  written: number;
  state: TransferState;
  error: string | null;
  bytes_per_second: number;
};
export type Snapshot = {
  identity: Identity;
  peers: Record<string, Peer>;
  shares: LocalShare[];
  sessions: Session[];
  transfers: Transfer[];
  serving: boolean;
  network: Network;
  ca_fingerprint: string;
  service_error?: string | null;
  pairings?: Pairing[];
  shortcut_available?: boolean;
};
export type Pairing = {
  id: string;
  name: string;
  incoming: boolean;
  code: string | null;
  state: "comparing" | "waiting" | "paired" | "rejected";
  approved: boolean;
  expires_at: number;
};
export type Discovered = {
  id: string;
  name: string;
  endpoints: string[];
  paired: boolean;
  verified: boolean;
};
export type Entry = {
  id: string;
  name: string;
  is_dir: boolean;
  size?: number;
  available?: boolean;
};
export type Page = { items: Entry[]; next_cursor: string | null };
export const active = (state: TransferState) =>
  ["queued", "preparing", "transferring", "verifying"].includes(state);
export function size(value = 0): string {
  if (value < 1024) return `${value} B`;
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  return `${(value / 1024 ** unit).toFixed(1)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}
export const audienceLabel = (audience: Audience) =>
  audience.kind === "lan"
    ? "Everyone on the local network"
    : audience.kind === "devices"
      ? `${audience.devices.length} device${audience.devices.length === 1 ? "" : "s"}`
      : "Invitation only";

export const transferLabel: Record<TransferState, string> = {
  queued: "Waiting",
  preparing: "Getting ready",
  transferring: "Downloading",
  interrupted: "Download interrupted",
  verifying: "Checking file",
  completed: "Downloaded",
  cancelled: "Cancelled",
  failed: "Could not download",
};
