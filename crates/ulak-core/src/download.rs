use crate::{Core, BUFFER_SIZE, catalog, client::NativeClient, model::*};
use anyhow::{Context, Result, bail, ensure};
use futures_util::StreamExt;
use std::{fs::{File, OpenOptions}, io::{Read, Seek, SeekFrom}, path::{Path, PathBuf}, time::{Duration, Instant}};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

fn destination_directory(path: &Path) -> Result<(PathBuf, Vec<File>)> {
    ensure!(path.is_absolute(), "Destination must be an absolute local directory");
    std::fs::create_dir_all(path)?;
    // Reject reparse points in every existing destination component before use.
    let mut current = PathBuf::new();
    let mut guards = Vec::new();
    for component in path.components() {
        current.push(component);
        if current.is_dir() { guards.push(catalog::open_locked(&current, true)?); }
    }
    Ok((std::fs::canonicalize(path)?, guards))
}

fn candidate(directory: &Path, name: &str, index: u32) -> PathBuf {
    if index == 0 { return directory.join(name); }
    let path = Path::new(name);
    let stem = path.file_stem().unwrap().to_string_lossy();
    match path.extension() {
        Some(extension) => directory.join(format!("{stem} ({index}).{}", extension.to_string_lossy())),
        None => directory.join(format!("{stem} ({index})")),
    }
}

/// Windows rename without MOVEFILE_REPLACE_EXISTING. A collision is retried.
fn finalize(partial: &Path, destination: &Path) -> std::io::Result<()> {
    #[cfg(windows)] {
        use std::os::windows::ffi::OsStrExt;
        let from: Vec<_> = partial.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<_> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { windows_sys::Win32::Storage::FileSystem::MoveFileExW(from.as_ptr(), to.as_ptr(), 0) } == 0 { return Err(std::io::Error::last_os_error()); }
        Ok(())
    }
    #[cfg(not(windows))] {
        std::fs::hard_link(partial, destination)?;
        std::fs::remove_file(partial)
    }
}

fn partial_file(path: &Path, create: bool) -> Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(create);
    #[cfg(windows)] { use std::os::windows::fs::OpenOptionsExt; options.share_mode(1).custom_flags(0x00200000); }
    let file = options.open(path)?;
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        ensure!(file.metadata()?.file_attributes() & 0x400 == 0, "Partial file cannot be a reparse point");
    }
    ensure!(file.metadata()?.is_file(), "Invalid partial file");
    Ok(file)
}

struct ActiveGuard { core: Core, id: String }
impl Drop for ActiveGuard {
    fn drop(&mut self) { self.core.0.active_downloads.lock().unwrap().remove(&self.id); }
}

impl Core {
    pub fn cancel_download(&self, id: &str) -> Result<()> {
        let active = self.0.active_downloads.lock().unwrap();
        let token = active.get(id).context("Transfer is not active")?;
        token.cancel();
        Ok(())
    }
    pub async fn download(&self, client: NativeClient, info: FileInfo, directory: &Path, cancellation: CancellationToken) -> Result<Checkpoint> {
        ensure!(catalog::safe_name(&info.name), "Unsafe destination name");
        let _slot = self.0.queued_downloads.clone().try_acquire_owned().context("Download queue is full")?;
        let (directory, guards) = destination_directory(directory)?;
        let id = uuid::Uuid::new_v4().to_string();
        let partial = directory.join(format!(".ulak-{id}.part"));
        drop(partial_file(&partial, true)?);
        let mut checkpoint = Checkpoint { id, remote: client.remote.clone(), destination: directory.join(&info.name), partial, file: info, written: 0, state: TransferState::Queued, error: None, bytes_per_second: 0 };
        self.save_checkpoint(&checkpoint)?;
        self.run_download(client, &mut checkpoint, cancellation, guards).await?;
        Ok(checkpoint)
    }
    pub async fn resume(&self, client: NativeClient, id: &str, cancellation: CancellationToken) -> Result<Checkpoint> {
        let _slot = self.0.queued_downloads.clone().try_acquire_owned().context("Download queue is full")?;
        let mut checkpoint = self.checkpoints()?.into_iter().find(|c| c.id == id).context("Unknown transfer")?;
        ensure!(!matches!(checkpoint.state, TransferState::Completed), "Transfer already completed");
        ensure!(checkpoint.remote.identity == client.remote.identity, "Cannot resume from another device");
        let parent = checkpoint.destination.parent().context("Missing destination directory")?;
        let (directory, guards) = destination_directory(parent)?;
        ensure!(checkpoint.partial == directory.join(format!(".ulak-{id}.part")), "Invalid partial-file location");
        ensure!(checkpoint.destination.parent() == Some(directory.as_path()) && checkpoint.destination.file_name().and_then(|v| v.to_str()).is_some_and(catalog::safe_name), "Invalid destination location");
        checkpoint.remote = client.remote.clone();
        checkpoint.state = TransferState::Queued;
        checkpoint.error = None;
        self.run_download(client, &mut checkpoint, cancellation, guards).await?;
        Ok(checkpoint)
    }
    async fn run_download(&self, client: NativeClient, checkpoint: &mut Checkpoint, cancellation: CancellationToken, guards: Vec<File>) -> Result<()> {
        {
            let mut active = self.0.active_downloads.lock().unwrap();
            ensure!(!active.contains_key(&checkpoint.id), "Transfer is already active");
            active.insert(checkpoint.id.clone(), cancellation.clone());
        }
        let _active = ActiveGuard { core: self.clone(), id: checkpoint.id.clone() };
        let _guards = guards;
        let result = self.transfer_inner(&client, checkpoint, &cancellation).await;
        if let Err(error) = &result {
            checkpoint.state = if cancellation.is_cancelled() { TransferState::Cancelled } else if matches!(checkpoint.state, TransferState::Verifying) { TransferState::Failed } else { TransferState::Interrupted };
            checkpoint.error = Some(error.to_string());
            checkpoint.bytes_per_second = 0;
            self.save_checkpoint(checkpoint)?;
        }
        result
    }
    async fn transfer_inner(&self, client: &NativeClient, checkpoint: &mut Checkpoint, cancellation: &CancellationToken) -> Result<()> {
        let _permit = tokio::select! {
            _ = cancellation.cancelled() => bail!("Transfer cancelled"),
            permit = self.0.downloads.clone().acquire_owned() => permit?,
        };
        checkpoint.state = TransferState::Preparing;
        self.save_checkpoint(checkpoint)?;
        let current = tokio::select! {
            _ = cancellation.cancelled() => bail!("Transfer cancelled"),
            current = async { client.verify().await?; client.prepare(&checkpoint.file.share_id, &checkpoint.file.entry_id).await } => current?,
        };
        ensure!(current.revision == checkpoint.file.revision && current.digest == checkpoint.file.digest && current.size == checkpoint.file.size, "Source changed; start a new download");
        ensure!(checkpoint.written <= checkpoint.file.size, "Invalid checkpoint offset");
        let mut file = partial_file(&checkpoint.partial, false)?;
        ensure!(file.metadata()?.len() >= checkpoint.written, "Partial file is shorter than its durable checkpoint");
        // Discard bytes written after the last durable checkpoint, never infer
        // resumable progress from a preallocated or logical file length.
        file.set_len(checkpoint.written)?;
        file.seek(SeekFrom::Start(checkpoint.written))?;
        let mut file = tokio::fs::File::from_std(file);
        if checkpoint.written < checkpoint.file.size {
            let response = tokio::select! {
                _ = cancellation.cancelled() => bail!("Transfer cancelled"),
                response = client.file_response(&checkpoint.file, checkpoint.written) => response?,
            };
            let expected = if checkpoint.written > 0 { reqwest::StatusCode::PARTIAL_CONTENT } else { reqwest::StatusCode::OK };
            ensure!(response.status() == expected, "Server rejected download or resume ({})", response.status());
            ensure!(response.headers().get(reqwest::header::ETAG).and_then(|v| v.to_str().ok()) == Some(format!("\"{}\"", checkpoint.file.revision).as_str()), "Source revision mismatch");
            ensure!(response.content_length() == Some(checkpoint.file.size - checkpoint.written), "Unexpected response length");
            if checkpoint.written > 0 {
                let expected = format!("bytes {}-{}/{}", checkpoint.written, checkpoint.file.size - 1, checkpoint.file.size);
                ensure!(response.headers().get(reqwest::header::CONTENT_RANGE).and_then(|v| v.to_str().ok()) == Some(expected.as_str()), "Invalid partial-content response");
            }
            checkpoint.state = TransferState::Transferring;
            self.save_checkpoint(checkpoint)?;
            let mut stream = response.bytes_stream();
            let mut durable = checkpoint.written;
            let mut last_checkpoint = Instant::now();
            let mut last_event = Instant::now();
            let mut last_event_bytes = checkpoint.written;
            let streaming_result: Result<()> = async {
                loop {
                    let chunk = tokio::select! {
                        _ = cancellation.cancelled() => bail!("Transfer cancelled"),
                        next = stream.next() => match next { Some(chunk) => chunk?, None => break },
                    };
                    ensure!(checkpoint.written + chunk.len() as u64 <= checkpoint.file.size, "Server sent excess file bytes");
                    // Network chunks are consumed in bounded writes without
                    // collecting the response or staging the source.
                    for buffer in chunk.chunks(BUFFER_SIZE) {
                        file.write_all(buffer).await?;
                        checkpoint.written += buffer.len() as u64;
                    }
                    if last_event.elapsed() >= Duration::from_millis(100) {
                        checkpoint.bytes_per_second = ((checkpoint.written - last_event_bytes) as f64 / last_event.elapsed().as_secs_f64()) as u64;
                        let _ = self.0.events.send(checkpoint.clone());
                        last_event = Instant::now(); last_event_bytes = checkpoint.written;
                    }
                    if last_checkpoint.elapsed() >= Duration::from_secs(1) {
                        file.flush().await?; file.sync_data().await?;
                        self.save_checkpoint(checkpoint)?;
                        durable = checkpoint.written;
                        last_checkpoint = Instant::now();
                    }
                }
                ensure!(checkpoint.written == checkpoint.file.size, "Download interrupted before the expected end");
                Ok(())
            }.await;
            // Only offsets confirmed written and flushed are persisted.
            if file.flush().await.is_ok() && file.sync_data().await.is_ok() {
                self.save_checkpoint(checkpoint)?;
            } else { checkpoint.written = durable; }
            streaming_result?;
        }
        file.flush().await?;
        file.sync_all().await?;
        file.seek(SeekFrom::Start(0)).await?;
        checkpoint.state = TransferState::Verifying;
        checkpoint.bytes_per_second = 0;
        self.save_checkpoint(checkpoint)?;
        let mut file = file.into_std().await;
        let expected = checkpoint.file.digest.clone();
        let stop = cancellation.clone();
        let _hash_permit = self.0.hashes.clone().acquire_owned().await?;
        tokio::task::spawn_blocking(move || -> Result<()> {
            let mut hasher = blake3::Hasher::new();
            let mut buffer = [0; BUFFER_SIZE];
            loop {
                ensure!(!stop.is_cancelled(), "Transfer cancelled");
                let length = file.read(&mut buffer)?;
                if length == 0 { break; }
                hasher.update(&buffer[..length]);
            }
            ensure!(hasher.finalize().to_hex().as_str() == expected, "File integrity verification failed; start a new download");
            Ok(())
        }).await??;
        ensure!(!cancellation.is_cancelled(), "Transfer cancelled");
        let directory = checkpoint.destination.parent().unwrap();
        let mut finalized = false;
        for index in 0..10_000 {
            let target = candidate(directory, &checkpoint.file.name, index);
            match finalize(&checkpoint.partial, &target) {
                Ok(()) => { checkpoint.destination = target; finalized = true; break; }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists || target.exists() => continue,
                Err(error) => return Err(error.into()),
            }
        }
        ensure!(finalized, "Too many conflicting destination filenames");
        checkpoint.state = TransferState::Completed;
        checkpoint.error = None;
        self.save_checkpoint(checkpoint)?;
        Ok(())
    }

    /// Depth-first, paginated traversal with a bounded stack, no full-tree manifest.
    pub async fn download_folder(&self, client: NativeClient, share: &str, entry: Option<&str>, directory: &Path, cancellation: CancellationToken) -> Result<u64> {
        let (directory, _guards) = destination_directory(directory)?;
        let mut stack = vec![(entry.map(str::to_string), directory, None::<String>)];
        let mut count = 0;
        while let Some((entry, target, cursor)) = stack.pop() {
            ensure!(!cancellation.is_cancelled(), "Folder download cancelled");
            let page = client.entries(share, entry.as_deref(), cursor.as_deref()).await?;
            if let Some(cursor) = page.next_cursor { stack.push((entry, target.clone(), Some(cursor))); }
            for item in page.items {
                ensure!(catalog::safe_name(&item.name), "Unsafe remote filename");
                if item.is_dir {
                    ensure!(stack.len() < 4096, "Folder traversal capacity reached");
                    stack.push((Some(item.id), target.join(item.name), None));
                } else {
                    let info = client.prepare(share, &item.id).await?;
                    self.download(client.clone(), info, &target, cancellation.child_token()).await?;
                    count += 1;
                }
            }
        }
        Ok(count)
    }
}
