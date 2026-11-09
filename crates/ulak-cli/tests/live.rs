#![cfg(windows)]
use std::{
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use tokio_util::sync::CancellationToken;
use ulak_core::{Core, auth::LanPolicy, model::Audience, server};

async fn cli(directory: &Path, arguments: Vec<String>) -> serde_json::Value {
    let directory = directory.to_path_buf();
    let output = tokio::task::spawn_blocking(move || {
        Command::new(env!("CARGO_BIN_EXE_ulak"))
            .arg("--data")
            .arg(directory)
            .args(arguments)
            .output()
            .unwrap()
    })
    .await
    .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn live_cli_shares_lists_and_downloads_without_opening_owned_state() {
    let root = tempfile::tempdir().unwrap();
    let host = Core::open(root.path().join("host"), "Publisher").unwrap();
    let recipient = Core::open(root.path().join("recipient"), "Desktop").unwrap();
    let source = root.path().join("sample.bin");
    let bytes: Vec<_> = (0..180_000).map(|i| (i % 251) as u8).collect();
    std::fs::write(&source, &bytes).unwrap();
    let share = host.add_share(&source, Audience::Lan).unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let remote = host
        .descriptor(&format!("https://{}/", listener.local_addr().unwrap()))
        .unwrap();
    let descriptor = root.path().join("remote.json");
    std::fs::write(&descriptor, serde_json::to_vec(&remote).unwrap()).unwrap();
    let stop = CancellationToken::new();
    let tls = tokio::spawn(server::serve_listener(
        host,
        listener,
        vec!["127.0.0.1".parse().unwrap()],
        LanPolicy {
            allowed: vec!["127.0.0.1/32".parse().unwrap()],
        },
        stop.clone(),
    ));
    let pipe = ulak_local::serve(recipient.clone(), stop.clone()).unwrap();
    let client = ulak_core::client::NativeClient::new(recipient.clone(), remote).unwrap();
    for _ in 0..100 {
        if client.verify().await.is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let directory = &recipient.0.directory;
    let local_share = cli(
        directory,
        vec!["share".into(), source.to_string_lossy().into_owned()],
    )
    .await;
    assert_eq!(local_share["audience"]["kind"], "private");
    let state = cli(directory, vec!["status".into()]).await;
    assert_eq!(state["shares"].as_array().unwrap().len(), 1);
    let path = descriptor.to_string_lossy().into_owned();
    let catalog = cli(
        directory,
        vec!["list".into(), "--remote".into(), path.clone()],
    )
    .await;
    assert_eq!(catalog["items"][0]["id"], share.id);
    let entries = cli(
        directory,
        vec![
            "list".into(),
            "--remote".into(),
            path.clone(),
            "--share".into(),
            share.id.clone(),
        ],
    )
    .await;
    let result = cli(
        directory,
        vec![
            "download".into(),
            "--remote".into(),
            path,
            "--share".into(),
            share.id,
            "--entry".into(),
            entries["items"][0]["id"].as_str().unwrap().into(),
            "--destination".into(),
            root.path().join("downloads").to_string_lossy().into_owned(),
        ],
    )
    .await;
    assert_eq!(result["state"], "completed");
    assert_eq!(
        std::fs::read(PathBuf::from(result["destination"].as_str().unwrap())).unwrap(),
        bytes
    );
    cli(
        directory,
        vec!["remove".into(), local_share["id"].as_str().unwrap().into()],
    )
    .await;
    assert!(recipient.read().shares.is_empty());
    stop.cancel();
    pipe.await.unwrap().unwrap();
    tls.await.unwrap().unwrap();
}
