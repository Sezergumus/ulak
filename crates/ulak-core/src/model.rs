use serde::{Deserialize, Serialize};
use std::{collections::{BTreeMap, BTreeSet}, path::PathBuf};

pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceIdentity {
    pub id: String,
    pub name: String,
    pub public_key: String,
}

/// Public connection descriptor. Possession grants no restricted-share access.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Remote {
    pub identity: DeviceIdentity,
    pub endpoint: String,
    pub ca_pem: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Peer {
    pub remote: Remote,
    pub last_connected: Option<u64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Audience {
    #[default]
    Private,
    Devices { devices: BTreeSet<String> },
    Lan,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Share {
    pub id: String,
    pub name: String,
    pub source: PathBuf,
    pub audience: Audience,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ShareView {
    pub id: String,
    pub name: String,
    pub is_dir: bool,
    pub available: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub share_id: String,
    pub entry_id: String,
    pub name: String,
    pub size: u64,
    pub revision: String,
    pub digest: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Invitation {
    pub host: Remote,
    pub token: String,
    pub expires_at: u64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PendingInvitation {
    pub token_hash: String,
    pub expires_at: u64,
    pub shares: Option<BTreeSet<String>>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct GuestSession {
    pub id: String,
    pub token_hash: String,
    pub shares: BTreeSet<String>,
    pub created_at: u64,
    pub last_used: u64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Stored {
    pub schema: u32,
    pub signing_seed: String,
    pub identity: DeviceIdentity,
    pub ca_key_pem: String,
    pub ca_pem: String,
    pub peers: BTreeMap<String, Peer>,
    pub shares: BTreeMap<String, Share>,
    pub invitations: BTreeMap<String, PendingInvitation>,
    pub sessions: BTreeMap<String, GuestSession>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransferState {
    Queued,
    Preparing,
    Transferring,
    Interrupted,
    Verifying,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Checkpoint {
    pub id: String,
    pub remote: Remote,
    pub file: FileInfo,
    pub partial: PathBuf,
    pub destination: PathBuf,
    pub written: u64,
    pub state: TransferState,
    pub error: Option<String>,
    pub bytes_per_second: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Hello {
    pub protocol: u32,
    pub identity: DeviceIdentity,
    pub capabilities: Vec<String>,
    pub challenge: String,
    pub signature: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PairRequest {
    pub token: String,
    pub remote: Remote,
    pub signature: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GuestRedemption {
    pub token: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GuestGrant {
    pub session_id: String,
    pub token: String,
}
