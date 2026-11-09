use std::{
    collections::BTreeSet,
    io::Write,
    net::{Ipv4Addr, TcpListener},
    time::Duration,
};
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;
use ulak_core::{Core, auth::LanPolicy, client::NativeClient, model::*, server};

struct Host {
    _directory: TempDir,
    core: Core,
    remote: Remote,
    stop: CancellationToken,
    task: tokio::task::JoinHandle<anyhow::Result<()>>,
}
impl Host {
    async fn start() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let core = Core::open(directory.path().join("host"), "Host").unwrap();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let endpoint = format!("https://{}/", listener.local_addr().unwrap());
        let remote = core.descriptor(&endpoint).unwrap();
        let stop = CancellationToken::new();
        let task = tokio::spawn(server::serve_listener(
            core.clone(),
            listener,
            vec![Ipv4Addr::LOCALHOST.into()],
            LanPolicy {
                allowed: vec!["127.0.0.1/32".parse().unwrap()],
            },
            stop.clone(),
        ));
        let ready = NativeClient::new(core.clone(), remote.clone()).unwrap();
        let mut connected = false;
        for _ in 0..100 {
            if ready.verify().await.is_ok() {
                connected = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(connected, "HTTPS server did not start");
        Self {
            _directory: directory,
            core,
            remote,
            stop,
            task,
        }
    }
    fn source(&self, name: &str, bytes: &[u8], audience: Audience) -> Share {
        let source = self._directory.path().join(name);
        std::fs::write(&source, bytes).unwrap();
        self.core.add_share(&source, audience).unwrap()
    }
    async fn finish(self) {
        self.stop.cancel();
        self.task.await.unwrap().unwrap();
    }
}
fn recipient() -> (TempDir, Core) {
    let directory = tempfile::tempdir().unwrap();
    let core = Core::open(directory.path().join("recipient"), "Recipient").unwrap();
    (directory, core)
}
async fn metadata(client: &NativeClient, share: &Share) -> FileInfo {
    let page = client.entries(&share.id, None, None).await.unwrap();
    client.prepare(&share.id, &page.items[0].id).await.unwrap()
}

#[tokio::test]
async fn verified_https_pairing_and_restricted_catalog() {
    let host = Host::start().await;
    let (_directory, recipient) = recipient();
    let client = NativeClient::new(recipient.clone(), host.remote.clone()).unwrap();
    let public = host.source("public.txt", b"public", Audience::Lan);
    let restricted = host.source("restricted.txt", b"restricted", Audience::Private);
    let page = client.shares(None).await.unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].id, public.id);
    assert!(client.entries(&restricted.id, None, None).await.is_err());
    let invite = host.core.invite(&host.remote.endpoint, None).unwrap();
    NativeClient::pair(recipient.clone(), invite.clone(), "https://127.0.0.1:7444/")
        .await
        .unwrap();
    assert!(
        NativeClient::pair(recipient.clone(), invite, "https://127.0.0.1:7444/")
            .await
            .is_err()
    );
    host.core
        .set_audience(
            &restricted.id,
            Audience::Devices {
                devices: BTreeSet::from([recipient.read().identity.id]),
            },
        )
        .unwrap();
    assert_eq!(client.shares(None).await.unwrap().items.len(), 2);
    host.core
        .revoke_peer(&recipient.read().identity.id)
        .unwrap();
    assert!(client.entries(&restricted.id, None, None).await.is_err());
    host.finish().await;
}

#[tokio::test]
async fn native_download_verifies_bytes_and_never_overwrites() {
    let host = Host::start().await;
    let (directory, core) = recipient();
    let bytes = (0..512_000)
        .map(|index| (index % 251) as u8)
        .collect::<Vec<_>>();
    let share = host.source("payload.bin", &bytes, Audience::Lan);
    let client = NativeClient::new(core.clone(), host.remote.clone()).unwrap();
    let info = metadata(&client, &share).await;
    let target = directory.path().join("downloads");
    std::fs::create_dir(&target).unwrap();
    std::fs::write(target.join("payload.bin"), b"keep original").unwrap();
    let result = core
        .download(client, info, &target, CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(result.state, TransferState::Completed);
    assert_eq!(result.destination.file_name().unwrap(), "payload (1).bin");
    assert_eq!(std::fs::read(result.destination).unwrap(), bytes);
    assert_eq!(
        std::fs::read(target.join("payload.bin")).unwrap(),
        b"keep original"
    );
    assert!(!result.partial.exists());
    host.finish().await;
}

#[tokio::test]
async fn durable_partial_resumes_after_restart_and_discards_uncheckpointed_tail() {
    let host = Host::start().await;
    let (directory, core) = recipient();
    let bytes = (0..300_000)
        .map(|index| (index % 239) as u8)
        .collect::<Vec<_>>();
    let share = host.source("resume.bin", &bytes, Audience::Lan);
    let client = NativeClient::new(core.clone(), host.remote.clone()).unwrap();
    let info = metadata(&client, &share).await;
    let target = std::fs::canonicalize(directory.path()).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let partial = target.join(format!(".ulak-{id}.part"));
    let mut file = std::fs::File::create(&partial).unwrap();
    file.write_all(&bytes[..123_456]).unwrap();
    file.write_all(b"uncheckpointed tail").unwrap();
    drop(file);
    core.save_checkpoint(&Checkpoint {
        id: id.clone(),
        remote: host.remote.clone(),
        file: info,
        partial,
        destination: target.join("resume.bin"),
        written: 123_456,
        state: TransferState::Transferring,
        error: None,
        bytes_per_second: 0,
    })
    .unwrap();
    drop(client);
    drop(core);
    let core = Core::open(directory.path().join("recipient"), "Ignored").unwrap();
    assert_eq!(
        core.checkpoints().unwrap()[0].state,
        TransferState::Interrupted
    );
    let client = NativeClient::new(core.clone(), host.remote.clone()).unwrap();
    let result = core
        .resume(client, &id, CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(result.state, TransferState::Completed);
    assert_eq!(std::fs::read(result.destination).unwrap(), bytes);
    host.finish().await;
}

#[tokio::test]
async fn source_revision_changes_are_rejected_before_resuming() {
    let host = Host::start().await;
    let (directory, core) = recipient();
    let share = host.source("changed.bin", b"original bytes", Audience::Lan);
    let client = NativeClient::new(core.clone(), host.remote.clone()).unwrap();
    let info = metadata(&client, &share).await;
    std::fs::write(&share.source, b"replacement bytes of another size").unwrap();
    let response = client.file_response(&info, 3).await.unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::PRECONDITION_FAILED);
    assert!(
        core.download(client, info, directory.path(), CancellationToken::new())
            .await
            .is_err()
    );
    assert_eq!(
        core.checkpoints().unwrap()[0].state,
        TransferState::Interrupted
    );
    host.finish().await;
}

#[tokio::test]
async fn corrupt_existing_partial_fails_full_file_verification() {
    let host = Host::start().await;
    let (directory, core) = recipient();
    let share = host.source("integrity.txt", b"the correct content", Audience::Lan);
    let client = NativeClient::new(core.clone(), host.remote.clone()).unwrap();
    let info = metadata(&client, &share).await;
    let target = std::fs::canonicalize(directory.path()).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let partial = target.join(format!(".ulak-{id}.part"));
    std::fs::write(&partial, b"bad").unwrap();
    core.save_checkpoint(&Checkpoint {
        id: id.clone(),
        remote: host.remote.clone(),
        file: info,
        partial,
        destination: target.join("integrity.txt"),
        written: 3,
        state: TransferState::Interrupted,
        error: None,
        bytes_per_second: 0,
    })
    .unwrap();
    assert!(
        core.resume(client, &id, CancellationToken::new())
            .await
            .is_err()
    );
    assert_eq!(core.checkpoints().unwrap()[0].state, TransferState::Failed);
    assert!(!target.join("integrity.txt").exists());
    host.finish().await;
}

#[tokio::test]
async fn ranges_permissions_and_guest_cookies_are_enforced_over_https() {
    let host = Host::start().await;
    let (_directory, core) = recipient();
    let share = host.source("range.txt", b"0123456789", Audience::Lan);
    let client = NativeClient::new(core, host.remote.clone()).unwrap();
    let info = metadata(&client, &share).await;
    let response = client.file_response(&info, 4).await.unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.headers()["content-range"], "bytes 4-9/10");
    assert_eq!(response.bytes().await.unwrap().as_ref(), b"456789");
    assert_eq!(
        client.file_response(&info, 10).await.unwrap().status(),
        reqwest::StatusCode::RANGE_NOT_SATISFIABLE
    );
    host.core
        .set_audience(&share.id, Audience::Private)
        .unwrap();
    assert_eq!(
        client.file_response(&info, 0).await.unwrap().status(),
        reqwest::StatusCode::NOT_FOUND
    );
    let invite = host
        .core
        .invite(
            &host.remote.endpoint,
            Some(BTreeSet::from([share.id.clone()])),
        )
        .unwrap();
    let response = client
        .http
        .post(client.url("/v1/guest/redeem", &[]).unwrap())
        .json(&GuestRedemption {
            token: invite.token,
        })
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    let cookie = response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let body: serde_json::Value = response.json().await.unwrap();
    let response = client
        .http
        .get(client.url("/v1/shares", &[]).unwrap())
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    let page: Page<ShareView> = response.json().await.unwrap();
    assert_eq!(page.items.len(), 1);
    host.core
        .revoke_session(body["session_id"].as_str().unwrap())
        .unwrap();
    let page: Page<ShareView> = client
        .http
        .get(client.url("/v1/shares", &[]).unwrap())
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(page.items.is_empty());
    host.finish().await;
}

#[tokio::test]
async fn folder_download_preserves_nested_hierarchy_without_a_manifest() {
    let host = Host::start().await;
    let (directory, core) = recipient();
    let folder = host._directory.path().join("folder");
    std::fs::create_dir_all(folder.join("nested/deeper")).unwrap();
    std::fs::write(folder.join("root.txt"), b"root").unwrap();
    std::fs::write(folder.join("nested/deeper/leaf.txt"), b"leaf").unwrap();
    let share = host.core.add_share(&folder, Audience::Lan).unwrap();
    let client = NativeClient::new(core.clone(), host.remote.clone()).unwrap();
    let target = directory.path().join("folder-copy");
    let count = core
        .download_folder(client, &share.id, None, &target, CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(count, 2);
    assert_eq!(
        std::fs::read(target.join("nested/deeper/leaf.txt")).unwrap(),
        b"leaf"
    );
    host.finish().await;
}

#[tokio::test]
async fn cancellation_remains_resumable_and_never_finalizes_early() {
    let host = Host::start().await;
    let (directory, core) = recipient();
    let share = host.source("cancel.txt", b"not completed", Audience::Lan);
    let client = NativeClient::new(core.clone(), host.remote.clone()).unwrap();
    let info = metadata(&client, &share).await;
    let stop = CancellationToken::new();
    stop.cancel();
    assert!(
        core.download(client.clone(), info, directory.path(), stop)
            .await
            .is_err()
    );
    let checkpoint = core.checkpoints().unwrap().remove(0);
    assert_eq!(checkpoint.state, TransferState::Cancelled);
    assert!(!checkpoint.destination.exists());
    let result = core
        .resume(client, &checkpoint.id, CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(result.state, TransferState::Completed);
    host.finish().await;
}
