use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio_util::sync::CancellationToken;
use ulak_core::{Core, client::NativeClient, model::*};

#[cfg(windows)]
mod pipe;
#[cfg(windows)]
pub use pipe::{connect, serve};

pub const MAX_REQUEST: usize = 1024 * 1024;
pub const MAX_RESPONSE: usize = 16 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    Snapshot,
    Share {
        source: PathBuf,
        audience: Audience,
    },
    Remove {
        share: String,
    },
    Audience {
        share: String,
        audience: Audience,
    },
    List {
        remote: Remote,
        share: Option<String>,
        entry: Option<String>,
        cursor: Option<String>,
    },
    Download {
        remote: Remote,
        share: String,
        entry: String,
        destination: PathBuf,
    },
    Folder {
        remote: Remote,
        share: String,
        entry: Option<String>,
        destination: PathBuf,
    },
    Resume {
        transfer: String,
    },
    Cancel {
        transfer: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Response {
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

pub fn snapshot(core: &Core) -> Result<serde_json::Value> {
    let state = core.read();
    let shares: Vec<_> = state.shares.values().map(|share| {
        serde_json::json!({"share": share, "available": share.source.exists(), "is_dir": share.source.is_dir()})
    }).collect();
    let sessions: Vec<_> = state.sessions.values().map(|session| serde_json::json!({
        "id":session.id, "shares":session.shares, "created_at":session.created_at,
        "last_used":session.last_used, "expires_at": (session.created_at + 28800).min(session.last_used + 1800)
    })).collect();
    Ok(
        serde_json::json!({"identity": state.identity, "peers":state.peers,
        "shares":shares, "sessions":sessions, "transfers":core.checkpoints()?}),
    )
}

pub async fn dispatch(
    core: &Core,
    request: Request,
    stop: CancellationToken,
) -> Result<serde_json::Value> {
    match request {
        Request::Snapshot => snapshot(core),
        Request::Share { source, audience } => {
            Ok(serde_json::to_value(core.add_share(&source, audience)?)?)
        }
        Request::Remove { share } => {
            core.remove_share(&share)?;
            Ok(serde_json::Value::Null)
        }
        Request::Audience { share, audience } => {
            core.set_audience(&share, audience)?;
            Ok(serde_json::Value::Null)
        }
        Request::Cancel { transfer } => {
            core.cancel_download(&transfer)?;
            Ok(serde_json::Value::Null)
        }
        Request::Resume { transfer } => {
            let checkpoint = core
                .checkpoints()?
                .into_iter()
                .find(|c| c.id == transfer)
                .context("Unknown transfer")?;
            let mut remote = checkpoint.remote;
            if let Some(peer) = core.read().peers.get(&remote.identity.id) {
                remote = peer.remote.clone();
            }
            let client = NativeClient::new(core.clone(), remote)?;
            // Let the core reconcile a finalized local file before requiring a reachable sender.
            Ok(serde_json::to_value(
                core.resume(client, &transfer, stop).await?,
            )?)
        }
        Request::List {
            remote,
            share,
            entry,
            cursor,
        } => {
            let client = NativeClient::new(core.clone(), remote)?;
            client.verify().await?;
            if let Some(share) = share {
                Ok(serde_json::to_value(
                    client
                        .entries(&share, entry.as_deref(), cursor.as_deref())
                        .await?,
                )?)
            } else {
                Ok(serde_json::to_value(
                    client.shares(cursor.as_deref()).await?,
                )?)
            }
        }
        Request::Download {
            remote,
            share,
            entry,
            destination,
        } => {
            let client = NativeClient::new(core.clone(), remote)?;
            client.verify().await?;
            let info = client.prepare(&share, &entry).await?;
            Ok(serde_json::to_value(
                core.download(client, info, &destination, stop).await?,
            )?)
        }
        Request::Folder {
            remote,
            share,
            entry,
            destination,
        } => {
            let client = NativeClient::new(core.clone(), remote)?;
            client.verify().await?;
            Ok(
                serde_json::json!({"files":core.download_folder(client, &share, entry.as_deref(), &destination, stop).await?}),
            )
        }
    }
}

pub fn data_directory() -> Result<PathBuf> {
    Ok(std::env::var_os("ULAK_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or(std::env::current_dir()?.join(".ulak/desktop")))
}

pub async fn read_frame(reader: &mut (impl AsyncRead + Unpin), limit: usize) -> Result<Vec<u8>> {
    let size = reader.read_u32_le().await? as usize;
    ensure!(
        size > 0 && size <= limit,
        "IPC frame exceeds its size limit"
    );
    let mut bytes = vec![0; size];
    reader.read_exact(&mut bytes).await?;
    Ok(bytes)
}

pub async fn write_frame(
    writer: &mut (impl AsyncWrite + Unpin),
    bytes: &[u8],
    limit: usize,
) -> Result<()> {
    ensure!(
        !bytes.is_empty() && bytes.len() <= limit,
        "IPC frame exceeds its size limit"
    );
    writer.write_u32_le(bytes.len() as u32).await?;
    writer.write_all(bytes).await?;
    writer.flush().await?;
    Ok(())
}

pub fn pipe_key(directory: &Path, sid: &str) -> Result<String> {
    let path = std::fs::canonicalize(directory)?;
    let key = format!("{}:{sid}", path.to_string_lossy().to_lowercase());
    Ok(format!(
        r"\\.\pipe\ulak-{}",
        blake3::hash(key.as_bytes()).to_hex()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn local_resume_recovers_a_finalized_file_without_a_reachable_sender() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::open(root.path().join("state"), "Recovery").unwrap();
        let directory = std::fs::canonicalize(root.path()).unwrap();
        let destination = directory.join("finished.txt");
        let bytes = b"already verified and renamed";
        std::fs::write(&destination, bytes).unwrap();
        let id = "00000000-0000-4000-8000-000000000001".to_string();
        core.save_checkpoint(&Checkpoint {
            id: id.clone(),
            remote: core.descriptor("https://127.0.0.1:1/").unwrap(),
            file: FileInfo {
                share_id: "unreachable".into(),
                entry_id: "entry".into(),
                name: "finished.txt".into(),
                size: bytes.len() as u64,
                revision: "revision".into(),
                digest: blake3::hash(bytes).to_hex().to_string(),
            },
            partial: directory.join(format!(".ulak-{id}.part")),
            destination,
            written: bytes.len() as u64,
            state: TransferState::Interrupted,
            error: None,
            bytes_per_second: 0,
        })
        .unwrap();
        let result = dispatch(
            &core,
            Request::Resume { transfer: id },
            CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(result["state"], "completed");
    }
    #[tokio::test]
    async fn rejects_oversized_frame_before_allocating_payload() {
        let mut frame = &u32::MAX.to_le_bytes()[..];
        assert!(read_frame(&mut frame, MAX_REQUEST).await.is_err());
    }

    #[tokio::test]
    async fn local_snapshot_and_share_keep_secrets_out_of_ipc() {
        let root = tempfile::tempdir().unwrap();
        let core = Core::open(root.path().join("state"), "Local").unwrap();
        let source = root.path().join("source.txt");
        std::fs::write(&source, "source content").unwrap();
        dispatch(
            &core,
            Request::Share {
                source: source.clone(),
                audience: Audience::Private,
            },
            CancellationToken::new(),
        )
        .await
        .unwrap();
        let value = snapshot(&core).unwrap();
        assert_eq!(
            value["shares"][0]["share"]["source"],
            std::fs::canonicalize(source)
                .unwrap()
                .to_string_lossy()
                .as_ref()
        );
        assert!(value.get("signing_seed").is_none());
        assert!(value.get("ca_key_pem").is_none());
        assert!(value.get("invitations").is_none());
    }
}
