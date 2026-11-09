use std::{
    net::{Ipv4Addr, TcpListener},
    time::Duration,
};
use tokio_util::sync::CancellationToken;
use ulak_core::{Core, auth::LanPolicy, client::NativeClient, model::*, server};

#[tokio::test]
async fn post_rename_crash_recovers_without_a_reachable_sender() {
    let directory = tempfile::tempdir().unwrap();
    let core = Core::open(directory.path().join("state"), "Recipient").unwrap();
    let target = std::fs::canonicalize(directory.path()).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let remote = core.descriptor("https://127.0.0.1:1/").unwrap();
    let destination = target.join("final (1).txt");
    std::fs::write(&destination, b"already verified").unwrap();
    let info = FileInfo {
        share_id: uuid::Uuid::new_v4().to_string(),
        entry_id: "opaque-entry".into(),
        name: "final.txt".into(),
        size: 16,
        revision: "revision".into(),
        digest: blake3::hash(b"already verified").to_hex().to_string(),
    };
    core.save_checkpoint(&Checkpoint {
        id: id.clone(),
        remote: remote.clone(),
        file: info,
        partial: target.join(format!(".ulak-{id}.part")),
        destination: destination.clone(),
        written: 16,
        state: TransferState::Verifying,
        error: None,
        bytes_per_second: 0,
    })
    .unwrap();
    let client = NativeClient::new(core.clone(), remote).unwrap();
    let result = core
        .resume(client, &id, CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(result.state, TransferState::Completed);
    assert_eq!(result.destination, destination);
}

#[tokio::test]
async fn empty_files_complete_with_the_empty_blake3_digest() {
    let directory = tempfile::tempdir().unwrap();
    let host = Core::open(directory.path().join("host"), "Host").unwrap();
    let source = directory.path().join("empty.txt");
    std::fs::write(&source, []).unwrap();
    let share = host.add_share(&source, Audience::Lan).unwrap();
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let remote = host
        .descriptor(&format!("https://{}/", listener.local_addr().unwrap()))
        .unwrap();
    let stop = CancellationToken::new();
    let task = tokio::spawn(server::serve_listener(
        host,
        listener,
        vec![Ipv4Addr::LOCALHOST.into()],
        LanPolicy {
            allowed: vec!["127.0.0.1/32".parse().unwrap()],
        },
        stop.clone(),
    ));
    let recipient = Core::open(directory.path().join("recipient"), "Recipient").unwrap();
    let client = NativeClient::new(recipient.clone(), remote).unwrap();
    for _ in 0..100 {
        if client.verify().await.is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let entry = client
        .entries(&share.id, None, None)
        .await
        .unwrap()
        .items
        .remove(0);
    let info = client.prepare(&share.id, &entry.id).await.unwrap();
    let result = recipient
        .download(
            client,
            info,
            &directory.path().join("downloads"),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result.state, TransferState::Completed);
    assert_eq!(std::fs::metadata(result.destination).unwrap().len(), 0);
    stop.cancel();
    task.await.unwrap().unwrap();
}

#[cfg(windows)]
#[test]
fn junctions_cannot_escape_a_share_or_be_published_as_roots() {
    let directory = tempfile::tempdir().unwrap();
    let core = Core::open(directory.path().join("state"), "Host").unwrap();
    let folder = directory.path().join("shared");
    let secret = directory.path().join("outside");
    std::fs::create_dir(&folder).unwrap();
    std::fs::create_dir(&secret).unwrap();
    std::fs::write(secret.join("secret.txt"), b"private").unwrap();
    let link = folder.join("escape");
    junction::create(&secret, &link).unwrap();
    assert!(core.add_share(&link, Audience::Lan).is_err());
    let share = core.add_share(&folder, Audience::Lan).unwrap();
    assert!(
        ulak_core::catalog::checked_path(&share, std::path::Path::new("escape/secret.txt"))
            .is_err()
    );
    let page = core
        .list_entries(&share, None, None, &ulak_core::auth::Principal::Anonymous)
        .unwrap();
    assert!(page.items.is_empty());
    junction::delete(&link).unwrap();
}
