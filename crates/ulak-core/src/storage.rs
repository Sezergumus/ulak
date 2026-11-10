use crate::{MAX_HASH_JOBS, MAX_RECORDS, MAX_TRANSFERS, identity, model::*};
use anyhow::{Context, Result, ensure};
use fs2::FileExt;
use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tokio::sync::{Semaphore, broadcast};

pub struct Inner {
    pub directory: PathBuf,
    pub state: Mutex<Stored>,
    pub transfers: Arc<Semaphore>,
    pub hashes: Arc<Semaphore>,
    pub downloads: Arc<Semaphore>,
    pub queued_downloads: Arc<Semaphore>,
    pub active_downloads: Mutex<HashMap<String, tokio_util::sync::CancellationToken>>,
    pub events: broadcast::Sender<Checkpoint>,
    pub replay: Mutex<HashMap<String, u64>>,
    pub digest_cache: Mutex<HashMap<String, String>>,
    pub directories: Mutex<HashMap<String, crate::catalog::DirectoryCursor>>,
    pub checkpoint_lock: Mutex<()>,
    pub pairing: Mutex<crate::pairing::Pairings>,
    pub pairing_slots: Semaphore,
    _lock: File,
}

#[derive(Clone)]
pub struct Core(pub Arc<Inner>);

pub fn atomic_json(path: &Path, value: &impl serde::Serialize) -> Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    serde_json::to_writer(tmp.as_file_mut(), value)?;
    ensure!(
        tmp.as_file().metadata()?.len() <= 32 * 1024 * 1024,
        "Metadata state capacity reached"
    );
    tmp.as_file_mut().flush()?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|error| error.error)?;
    Ok(())
}

fn protect_directory(path: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let user = format!(
            "{}\\{}:(OI)(CI)F",
            std::env::var("USERDOMAIN")?,
            std::env::var("USERNAME")?
        );
        let output = std::process::Command::new("icacls.exe")
            .arg(path)
            .args(["/inheritance:r", "/grant:r", &user, "/Q"])
            .creation_flags(0x08000000)
            .output()?;
        ensure!(
            output.status.success(),
            "Could not protect private state directory"
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

impl Core {
    pub fn open(directory: impl AsRef<Path>, name: &str) -> Result<Self> {
        std::fs::create_dir_all(&directory)?;
        let directory = std::fs::canonicalize(directory)?;
        protect_directory(&directory)?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(directory.join("agent.lock"))?;
        lock.try_lock_exclusive()
            .context("This state directory is already in use by another Ulak process")?;
        let path = directory.join("state.json");
        let state: Stored = if path.exists() {
            ensure!(
                std::fs::metadata(&path)?.len() <= 32 * 1024 * 1024,
                "State file too large"
            );
            serde_json::from_reader(File::open(path)?)?
        } else {
            let state = identity::create(name)?;
            atomic_json(&path, &state)?;
            state
        };
        ensure!(state.schema == 1, "Unsupported state schema");
        ensure!(
            identity::device_id(&state.identity.public_key)? == state.identity.id,
            "Corrupt identity"
        );
        ensure!(
            identity::encode(&identity::signing_key(&state)?.verifying_key().to_bytes())
                == state.identity.public_key,
            "Identity key mismatch"
        );
        std::fs::create_dir_all(directory.join("transfers"))?;
        let (events, _) = broadcast::channel(128);
        let core = Self(Arc::new(Inner {
            directory,
            state: Mutex::new(state),
            transfers: Arc::new(Semaphore::new(MAX_TRANSFERS)),
            hashes: Arc::new(Semaphore::new(MAX_HASH_JOBS)),
            downloads: Arc::new(Semaphore::new(MAX_TRANSFERS)),
            queued_downloads: Arc::new(Semaphore::new(64)),
            active_downloads: Default::default(),
            events,
            replay: Default::default(),
            digest_cache: Default::default(),
            directories: Default::default(),
            checkpoint_lock: Default::default(),
            pairing: Default::default(),
            pairing_slots: Semaphore::new(2),
            _lock: lock,
        }));
        for mut checkpoint in core.checkpoints()? {
            if matches!(
                checkpoint.state,
                TransferState::Queued
                    | TransferState::Preparing
                    | TransferState::Transferring
                    | TransferState::Verifying
            ) {
                checkpoint.state = TransferState::Interrupted;
                checkpoint.error = Some("Application stopped; ready to resume".into());
                core.save_checkpoint(&checkpoint)?;
            }
        }
        Ok(core)
    }
    pub fn read(&self) -> Stored {
        self.0.state.lock().unwrap().clone()
    }
    pub fn update<T>(&self, operation: impl FnOnce(&mut Stored) -> Result<T>) -> Result<T> {
        let mut guard = self.0.state.lock().unwrap();
        let mut next = guard.clone();
        let result = operation(&mut next)?;
        ensure!(
            next.peers.len() <= MAX_RECORDS
                && next.shares.len() <= MAX_RECORDS
                && next.invitations.len() <= MAX_RECORDS
                && next.sessions.len() <= MAX_RECORDS,
            "State capacity reached"
        );
        atomic_json(&self.0.directory.join("state.json"), &next)?;
        *guard = next;
        Ok(result)
    }
    pub fn descriptor(&self, endpoint: &str) -> Result<Remote> {
        let state = self.read();
        let remote = Remote {
            identity: state.identity,
            endpoint: endpoint.into(),
            ca_pem: state.ca_pem,
        };
        identity::validate_remote(&remote)?;
        Ok(remote)
    }
    pub fn invite(
        &self,
        endpoint: &str,
        shares: Option<std::collections::BTreeSet<String>>,
    ) -> Result<Invitation> {
        let token = identity::secret();
        let token_hash = identity::token_hash(&token);
        let expires_at = now() + 300;
        self.update(|state| {
            state
                .invitations
                .retain(|_, invite| invite.expires_at > now());
            if let Some(shares) = &shares {
                ensure!(
                    shares.iter().all(|id| state.shares.contains_key(id)),
                    "Unknown share"
                );
            }
            state.invitations.insert(
                token_hash.clone(),
                PendingInvitation {
                    token_hash,
                    expires_at,
                    shares,
                },
            );
            Ok(())
        })?;
        Ok(Invitation {
            host: self.descriptor(endpoint)?,
            token,
            expires_at,
        })
    }
    pub fn revoke_peer(&self, id: &str) -> Result<()> {
        self.update(|state| {
            state.peers.remove(id);
            for share in state.shares.values_mut() {
                if let Audience::Devices { devices } = &mut share.audience {
                    devices.remove(id);
                }
            }
            Ok(())
        })
    }
    pub fn revoke_session(&self, id: &str) -> Result<()> {
        self.update(|state| {
            state.sessions.retain(|_, session| session.id != id);
            Ok(())
        })
    }
    pub fn save_checkpoint(&self, checkpoint: &Checkpoint) -> Result<()> {
        let _guard = self.0.checkpoint_lock.lock().unwrap();
        uuid::Uuid::parse_str(&checkpoint.id)?;
        let dir = self.0.directory.join("transfers");
        if !dir.join(format!("{}.json", checkpoint.id)).exists() {
            ensure!(
                std::fs::read_dir(&dir)?.take(MAX_RECORDS + 1).count() < MAX_RECORDS,
                "Transfer history capacity reached"
            );
        }
        atomic_json(&dir.join(format!("{}.json", checkpoint.id)), checkpoint)?;
        let _ = self.0.events.send(checkpoint.clone());
        Ok(())
    }
    pub fn checkpoints(&self) -> Result<Vec<Checkpoint>> {
        let mut result = Vec::new();
        for entry in std::fs::read_dir(self.0.directory.join("transfers"))?.take(MAX_RECORDS + 1) {
            let path = entry?.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                ensure!(
                    std::fs::metadata(&path)?.len() < 64 * 1024,
                    "Checkpoint too large"
                );
                result.push(serde_json::from_reader(File::open(path)?)?);
            }
        }
        ensure!(
            result.len() <= MAX_RECORDS,
            "Transfer history capacity reached"
        );
        Ok(result)
    }
}
