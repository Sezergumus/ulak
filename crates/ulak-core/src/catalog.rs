use crate::{
    BUFFER_SIZE, Core, MAX_PAGE_SIZE,
    auth::{self, LanPolicy, Principal},
    identity,
    model::*,
};
use anyhow::{Context, Result, bail, ensure};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit},
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::{
    fs::{File, Metadata, OpenOptions, ReadDir},
    io::Read,
    net::IpAddr,
    path::{Component, Path, PathBuf},
};

pub struct DirectoryCursor {
    reader: ReadDir,
    share_id: String,
    relative: PathBuf,
    principal: String,
    expires: u64,
    revision: String,
    _guards: Vec<File>,
}

#[derive(Serialize, Deserialize)]
struct EntryToken {
    share: String,
    relative: PathBuf,
}

pub fn safe_name(name: &str) -> bool {
    if name.is_empty()
        || name.len() > 255
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|ch| ch < ' ' || "<>:\"/\\|?*".contains(ch))
    {
        return false;
    }
    let stem = name.split('.').next().unwrap_or("").to_uppercase();
    !matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) && !(stem.len() == 4
        && (stem.starts_with("COM") || stem.starts_with("LPT"))
        && "123456789¹²³".contains(stem.chars().last().unwrap()))
}

pub fn safe_relative(path: &Path) -> Result<()> {
    ensure!(path.as_os_str().len() <= 8192, "Path too long");
    for component in path.components() {
        match component {
            Component::Normal(name) => {
                ensure!(name.to_str().is_some_and(safe_name), "Unsafe filename")
            }
            _ => bail!("Path must contain only relative filename components"),
        }
    }
    Ok(())
}

fn is_reparse(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

pub fn revision(metadata: &Metadata) -> String {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        identity::token_hash(&format!(
            "{}:{}:{}:{}",
            metadata.file_size(),
            metadata.creation_time(),
            metadata.last_write_time(),
            metadata.file_attributes()
        ))
    }
    #[cfg(not(windows))]
    {
        identity::token_hash(&format!(
            "{}:{:?}:{:?}",
            metadata.len(),
            metadata.modified(),
            metadata.created()
        ))
    }
}

pub(crate) fn open_locked(path: &Path, directory: bool) -> Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Files deny writes/deletion; directories allow child updates but deny relocation.
        options
            .share_mode(if directory { 3 } else { 1 })
            .custom_flags(if directory {
                0x02000000 | 0x00200000
            } else {
                0x00200000
            });
    }
    let file = options
        .open(path)
        .context("Source unavailable or cannot be locked against modification")?;
    ensure!(
        !is_reparse(&file.metadata()?),
        "Reparse points are not shared"
    );
    Ok(file)
}

#[cfg(windows)]
fn handle_path(file: &File) -> Result<PathBuf> {
    use std::os::windows::{ffi::OsStringExt, io::AsRawHandle};
    let mut buf = vec![0u16; 32768];
    let len = unsafe {
        windows_sys::Win32::Storage::FileSystem::GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            buf.as_mut_ptr(),
            buf.len() as u32,
            0,
        )
    };
    ensure!(
        len > 0 && (len as usize) < buf.len(),
        "Cannot resolve source handle"
    );
    Ok(PathBuf::from(std::ffi::OsString::from_wide(
        &buf[..len as usize],
    )))
}

pub fn checked_path(share: &Share, relative: &Path) -> Result<(PathBuf, Vec<File>)> {
    safe_relative(relative)?;
    ensure!(
        !is_reparse(&std::fs::symlink_metadata(&share.source)?),
        "Source became a reparse point"
    );
    ensure!(
        std::fs::canonicalize(&share.source)? == share.source,
        "Source location changed"
    );
    let mut current = share.source.clone();
    let mut guards = Vec::new();
    let root_meta = std::fs::symlink_metadata(&current)?;
    if root_meta.is_dir() {
        guards.push(open_locked(&current, true)?);
    }
    for component in relative.components() {
        current.push(component);
        let metadata = std::fs::symlink_metadata(&current)?;
        ensure!(!is_reparse(&metadata), "Reparse points are not shared");
        if metadata.is_dir() {
            guards.push(open_locked(&current, true)?);
        }
    }
    let canonical = std::fs::canonicalize(&current)?;
    ensure!(
        canonical.starts_with(&share.source),
        "Entry escaped the shared source"
    );
    Ok((canonical, guards))
}

pub fn open_source(share: &Share, relative: &Path) -> Result<(File, Vec<File>)> {
    let (path, guards) = checked_path(share, relative)?;
    let file = open_locked(&path, false)?;
    ensure!(file.metadata()?.is_file(), "Not a regular file");
    #[cfg(windows)]
    ensure!(
        handle_path(&file)?.starts_with(&share.source),
        "Opened file escaped the shared source"
    );
    Ok((file, guards))
}

impl Core {
    pub fn add_share(&self, source: &Path, audience: Audience) -> Result<Share> {
        ensure!(
            !is_reparse(&std::fs::symlink_metadata(source)?),
            "Cannot publish a reparse point"
        );
        let source = std::fs::canonicalize(source)?;
        let name = source
            .file_name()
            .and_then(|v| v.to_str())
            .context("Select a named file or folder, not a drive root")?
            .to_string();
        ensure!(safe_name(&name), "Unsupported source name");
        let metadata = std::fs::metadata(&source)?;
        ensure!(
            metadata.is_file() || metadata.is_dir(),
            "Unsupported source type"
        );
        let share = Share {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            source,
            audience,
        };
        checked_path(&share, Path::new(""))?;
        self.update(|state| {
            validate_audience(state, &share.audience)?;
            state.shares.insert(share.id.clone(), share.clone());
            Ok(())
        })?;
        Ok(share)
    }
    pub fn set_audience(&self, id: &str, audience: Audience) -> Result<()> {
        self.update(|state| {
            validate_audience(state, &audience)?;
            state.shares.get_mut(id).context("Unknown share")?.audience = audience;
            Ok(())
        })
    }
    pub fn remove_share(&self, id: &str) -> Result<()> {
        self.update(|state| {
            state.shares.remove(id);
            Ok(())
        })
    }
    pub fn entry_id(&self, share_id: &str, relative: &Path) -> Result<String> {
        safe_relative(relative)?;
        let seed = identity::decode(&self.read().signing_seed)?;
        let key = blake3::derive_key("Ulak v1 opaque catalog entries", &seed);
        let cipher = XChaCha20Poly1305::new((&key).into());
        let mut nonce = [0; 24];
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        let value = serde_json::to_vec(&EntryToken {
            share: share_id.into(),
            relative: relative.into(),
        })?;
        let encrypted = cipher
            .encrypt(XNonce::from_slice(&nonce), value.as_slice())
            .map_err(|_| anyhow::anyhow!("Entry encryption failed"))?;
        Ok(identity::encode(&[nonce.as_slice(), &encrypted].concat()))
    }
    pub fn entry_path(&self, share_id: &str, entry_id: &str) -> Result<PathBuf> {
        ensure!(entry_id.len() <= 16_384, "Entry token too long");
        let bytes = identity::decode(entry_id)?;
        ensure!(bytes.len() >= 40, "Invalid entry token");
        let seed = identity::decode(&self.read().signing_seed)?;
        let key = blake3::derive_key("Ulak v1 opaque catalog entries", &seed);
        let cipher = XChaCha20Poly1305::new((&key).into());
        let plaintext = cipher
            .decrypt(XNonce::from_slice(&bytes[..24]), &bytes[24..])
            .map_err(|_| anyhow::anyhow!("Invalid entry token"))?;
        let entry: EntryToken = serde_json::from_slice(&plaintext)?;
        ensure!(
            entry.share == share_id,
            "Entry does not belong to this share"
        );
        safe_relative(&entry.relative)?;
        Ok(entry.relative)
    }
    pub fn accessible_share(
        &self,
        id: &str,
        principal: &Principal,
        ip: IpAddr,
        lan: &LanPolicy,
    ) -> Result<Share> {
        let state = self.read();
        let share = state.shares.get(id).context("Share unavailable")?;
        ensure!(
            auth::authorized(share, principal, ip, lan),
            "Share unavailable"
        );
        Ok(share.clone())
    }
    pub fn list_shares(
        &self,
        principal: &Principal,
        ip: IpAddr,
        lan: &LanPolicy,
        after: Option<&str>,
    ) -> Page<ShareView> {
        let state = self.read();
        let mut items = Vec::new();
        let mut next_cursor = None;
        for (id, share) in &state.shares {
            if after.is_some_and(|after| id.as_str() <= after)
                || !auth::authorized(share, principal, ip, lan)
            {
                continue;
            }
            if items.len() == MAX_PAGE_SIZE {
                next_cursor = items.last().map(|v: &ShareView| v.id.clone());
                break;
            }
            let metadata = checked_path(share, Path::new(""))
                .ok()
                .and_then(|(path, _)| std::fs::metadata(path).ok());
            items.push(ShareView {
                id: id.clone(),
                name: share.name.clone(),
                is_dir: metadata.as_ref().is_some_and(|m| m.is_dir()),
                available: metadata.is_some(),
            });
        }
        Page { items, next_cursor }
    }
    pub fn list_entries(
        &self,
        share: &Share,
        entry: Option<&str>,
        cursor: Option<&str>,
        principal: &Principal,
    ) -> Result<Page<Entry>> {
        let relative = entry
            .map(|entry| self.entry_path(&share.id, entry))
            .transpose()?
            .unwrap_or_default();
        let (path, guards) = checked_path(share, &relative)?;
        if path.is_file() {
            ensure!(cursor.is_none(), "Invalid file cursor");
            return Ok(Page {
                items: vec![Entry {
                    id: self.entry_id(&share.id, &relative)?,
                    name: share.name.clone(),
                    is_dir: false,
                    size: std::fs::metadata(path)?.len(),
                }],
                next_cursor: None,
            });
        }
        let mut cursors = self.0.directories.lock().unwrap();
        cursors.retain(|_, value| value.expires > now());
        let key = cursor
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        if cursor.is_none() {
            ensure!(
                cursors.len() < 64,
                "Too many directory browsing sessions; retry later"
            );
            cursors.insert(
                key.clone(),
                DirectoryCursor {
                    reader: std::fs::read_dir(&path)?,
                    share_id: share.id.clone(),
                    relative: relative.clone(),
                    principal: principal.scope(),
                    expires: now() + 120,
                    revision: revision(&std::fs::metadata(&path)?),
                    _guards: guards,
                },
            );
        }
        let session = cursors
            .get_mut(&key)
            .context("Directory cursor expired; reopen the folder")?;
        ensure!(
            session.share_id == share.id
                && session.relative == relative
                && session.principal == principal.scope(),
            "Invalid cursor scope"
        );
        ensure!(
            session.revision == revision(&std::fs::metadata(&path)?),
            "Directory changed; reopen the folder"
        );
        session.expires = now() + 120;
        let mut items = Vec::new();
        let mut exhausted = false;
        for _ in 0..MAX_PAGE_SIZE {
            let Some(item) = session.reader.next() else {
                exhausted = true;
                break;
            };
            let item = item?;
            let name = item.file_name();
            let Some(name) = name.to_str().filter(|name| safe_name(name)) else {
                continue;
            };
            let metadata = std::fs::symlink_metadata(item.path())?;
            if is_reparse(&metadata) || !(metadata.is_file() || metadata.is_dir()) {
                continue;
            }
            let relative = relative.join(name);
            items.push(Entry {
                id: self.entry_id(&share.id, &relative)?,
                name: name.into(),
                is_dir: metadata.is_dir(),
                size: metadata.len(),
            });
        }
        if exhausted {
            cursors.remove(&key);
        }
        Ok(Page {
            items,
            next_cursor: (!exhausted).then_some(key),
        })
    }
    pub async fn prepare_file(&self, share: Share, entry: String) -> Result<FileInfo> {
        let permit = self
            .0
            .hashes
            .clone()
            .try_acquire_owned()
            .context("Hash capacity reached; retry later")?;
        let cancellation = tokio_util::sync::CancellationToken::new();
        let _cancel_on_drop = cancellation.clone().drop_guard();
        let core = self.clone();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let relative = core.entry_path(&share.id, &entry)?;
            let (mut file, _guards) = open_source(&share, &relative)?;
            let metadata = file.metadata()?;
            let revision = revision(&metadata);
            let key = format!("{}:{}:{revision}", share.id, relative.display());
            let cached = core.0.digest_cache.lock().unwrap().get(&key).cloned();
            let digest = match cached {
                Some(digest) => digest,
                None => {
                    let mut hasher = blake3::Hasher::new();
                    let mut buffer = [0; BUFFER_SIZE];
                    loop {
                        ensure!(!cancellation.is_cancelled(), "Hashing cancelled");
                        let read = file.read(&mut buffer)?;
                        if read == 0 {
                            break;
                        }
                        hasher.update(&buffer[..read]);
                    }
                    ensure!(
                        revision == self::revision(&file.metadata()?),
                        "Source changed while hashing"
                    );
                    let digest = hasher.finalize().to_hex().to_string();
                    let mut cache = core.0.digest_cache.lock().unwrap();
                    if cache.len() >= 1024 {
                        cache.clear();
                    }
                    cache.insert(key, digest.clone());
                    digest
                }
            };
            Ok(FileInfo {
                share_id: share.id,
                entry_id: entry,
                name: relative
                    .file_name()
                    .and_then(|v| v.to_str())
                    .unwrap_or(&share.name)
                    .into(),
                size: metadata.len(),
                revision,
                digest,
            })
        })
        .await?
    }

    pub fn touch_directory(
        &self,
        share_id: &str,
        cursor: &str,
        principal: &Principal,
    ) -> Result<()> {
        let mut cursors = self.0.directories.lock().unwrap();
        let session = cursors
            .get_mut(cursor)
            .context("Directory cursor expired")?;
        ensure!(
            session.expires > now()
                && session.share_id == share_id
                && session.principal == principal.scope(),
            "Invalid directory cursor"
        );
        session.expires = now() + 120;
        Ok(())
    }
}

fn validate_audience(state: &Stored, audience: &Audience) -> Result<()> {
    if let Audience::Devices { devices } = audience {
        ensure!(
            devices.iter().all(|id| state.peers.contains_key(id)),
            "Audience contains an unpaired device"
        );
    }
    Ok(())
}
