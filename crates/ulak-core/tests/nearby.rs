use std::{
    net::{Ipv4Addr, TcpListener},
    time::Duration,
};
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;
use ulak_core::{
    Core,
    auth::LanPolicy,
    client::NativeClient,
    pairing::{self, Status},
    server,
};

struct Host {
    _directory: TempDir,
    core: Core,
    endpoint: String,
    stop: CancellationToken,
    task: tokio::task::JoinHandle<anyhow::Result<()>>,
}
impl Host {
    async fn start(allowed: bool) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let core = Core::open(directory.path().join("state"), "Office PC").unwrap();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let endpoint = format!("https://{}/", listener.local_addr().unwrap());
        core.enable_nearby_pairing(&endpoint).unwrap();
        let stop = CancellationToken::new();
        let task = tokio::spawn(server::serve_listener(
            core.clone(),
            listener,
            vec![Ipv4Addr::LOCALHOST.into()],
            LanPolicy {
                allowed: if allowed {
                    vec!["127.0.0.1/32".parse().unwrap()]
                } else {
                    vec![]
                },
            },
            stop.clone(),
        ));
        let client = NativeClient::new(core.clone(), core.descriptor(&endpoint).unwrap()).unwrap();
        let mut ready = false;
        for _ in 0..100 {
            if client.verify().await.is_ok() {
                ready = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(ready);
        Self {
            _directory: directory,
            core,
            endpoint,
            stop,
            task,
        }
    }
    async fn finish(self) {
        self.stop.cancel();
        self.task.await.unwrap().unwrap();
    }
}
fn recipient() -> (TempDir, Core) {
    let directory = tempfile::tempdir().unwrap();
    let core = Core::open(directory.path().join("state"), "Studio PC").unwrap();
    core.enable_nearby_pairing("https://127.0.0.1:7444/")
        .unwrap();
    (directory, core)
}

#[tokio::test]
async fn nearby_pairing_requires_matching_comparison_and_both_local_approvals() {
    let host = Host::start(true).await;
    let (_directory, client) = recipient();
    let host_id = host.core.read().identity.id;
    let view = pairing::start(&client, &host.endpoint, &host_id)
        .await
        .unwrap();
    let incoming = host.core.pairing_views().pop().unwrap();
    assert_eq!(view.code, incoming.code);
    assert_eq!(view.code.as_ref().unwrap().len(), 6);
    assert!(!view.incoming && incoming.incoming);
    assert!(host.core.read().peers.is_empty() && client.read().peers.is_empty());
    host.core.decide_pairing(&view.id, true).unwrap();
    pairing::refresh(&client).await;
    assert!(host.core.read().peers.is_empty() && client.read().peers.is_empty());
    client.decide_pairing(&view.id, true).unwrap();
    pairing::refresh(&client).await;
    assert_eq!(client.pairing_views()[0].state, Status::Paired);
    assert_eq!(host.core.pairing_views()[0].state, Status::Paired);
    assert!(client.read().peers.contains_key(&host_id));
    assert!(
        host.core
            .read()
            .peers
            .contains_key(&client.read().identity.id)
    );
    let remote = client.read().peers[&host_id].remote.clone();
    NativeClient::new(client.clone(), remote)
        .unwrap()
        .verify()
        .await
        .unwrap();
    host.finish().await;
}

#[tokio::test]
async fn declining_on_either_computer_is_terminal_and_grants_no_access() {
    for decline_incoming in [false, true] {
        let host = Host::start(true).await;
        let (_directory, client) = recipient();
        let view = pairing::start(&client, &host.endpoint, &host.core.read().identity.id)
            .await
            .unwrap();
        if decline_incoming {
            host.core.decide_pairing(&view.id, false).unwrap();
            client.decide_pairing(&view.id, true).unwrap();
        } else {
            host.core.decide_pairing(&view.id, true).unwrap();
            client.decide_pairing(&view.id, false).unwrap();
        }
        pairing::refresh(&client).await;
        assert_eq!(host.core.pairing_views()[0].state, Status::Rejected);
        assert_eq!(client.pairing_views()[0].state, Status::Rejected);
        assert!(client.decide_pairing(&view.id, true).is_err());
        assert!(host.core.read().peers.is_empty() && client.read().peers.is_empty());
        host.finish().await;
    }
}

#[tokio::test]
async fn discovery_cannot_substitute_identity_and_out_of_scope_requests_cannot_pair() {
    let host = Host::start(true).await;
    let (_directory, client) = recipient();
    assert!(
        pairing::start(&client, &host.endpoint, "wrong-device")
            .await
            .is_err()
    );
    assert!(host.core.pairing_views().is_empty() && client.read().peers.is_empty());
    host.finish().await;
    let host = Host::start(false).await;
    assert!(
        pairing::start(&client, &host.endpoint, &host.core.read().identity.id)
            .await
            .is_err()
    );
    assert!(host.core.pairing_views().is_empty());
    host.finish().await;
}
