use crate::{Core, PROTOCOL_VERSION, identity};
use anyhow::{Result, ensure};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    net::{IpAddr, SocketAddr},
    time::{Duration, Instant},
};

pub const SERVICE: &str = "_ulak._tcp.local.";

pub struct Advertisement {
    daemon: ServiceDaemon,
    fullname: String,
}
impl Advertisement {
    pub fn start(core: &Core, address: SocketAddr, addresses: &[IpAddr]) -> Result<Self> {
        let state = core.read();
        let daemon = ServiceDaemon::new()?;
        let short = &state.identity.id[..16];
        let host = format!("ulak-{short}.local.");
        let properties = [
            ("id", state.identity.id.as_str()),
            ("name", state.identity.name.as_str()),
            ("public_key", state.identity.public_key.as_str()),
            ("version", "1"),
        ];
        let ip_addresses = addresses
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let service = ServiceInfo::new(
            SERVICE,
            short,
            &host,
            ip_addresses.as_str(),
            address.port(),
            &properties[..],
        )?;
        let fullname = service.get_fullname().to_string();
        daemon.register(service)?;
        Ok(Self { daemon, fullname })
    }
}
impl Drop for Advertisement {
    fn drop(&mut self) {
        let _ = self.daemon.unregister(&self.fullname);
        let _ = self.daemon.shutdown();
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Discovered {
    pub id: String,
    pub name: String,
    pub endpoints: Vec<String>,
    pub paired: bool,
    pub verified: bool,
}

/// Returns untrusted candidates only; NativeClient::verify establishes presence.
pub async fn browse(core: &Core, duration: Duration) -> Result<Vec<Discovered>> {
    ensure!(
        duration <= Duration::from_secs(60),
        "Discovery scan is limited to 60 seconds"
    );
    let daemon = ServiceDaemon::new()?;
    let receiver = daemon.browse(SERVICE)?;
    let deadline = Instant::now() + duration;
    let state = core.read();
    let mut found = BTreeMap::new();
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let event = match tokio::time::timeout(remaining, receiver.recv_async()).await {
            Ok(Ok(event)) => event,
            _ => break,
        };
        match event {
            ServiceEvent::ServiceResolved(service) => {
                let Some(id) = service.get_property_val_str("id") else {
                    continue;
                };
                let Some(public_key) = service.get_property_val_str("public_key") else {
                    continue;
                };
                if identity::device_id(public_key).ok().as_deref() != Some(id)
                    || id == state.identity.id
                {
                    continue;
                }
                if service
                    .get_property_val_str("version")
                    .and_then(|v| v.parse::<u32>().ok())
                    != Some(PROTOCOL_VERSION)
                {
                    continue;
                }
                if found.len() >= 128 && !found.contains_key(id) {
                    continue;
                }
                let endpoints = service
                    .get_addresses()
                    .iter()
                    .take(16)
                    .map(|ip| {
                        format!(
                            "https://{}/",
                            SocketAddr::new(ip.to_ip_addr(), service.get_port())
                        )
                    })
                    .collect();
                found.insert(
                    id.to_string(),
                    Discovered {
                        id: id.into(),
                        name: service
                            .get_property_val_str("name")
                            .unwrap_or("Ulak device")
                            .chars()
                            .take(128)
                            .collect(),
                        endpoints,
                        paired: state.peers.contains_key(id),
                        verified: false,
                    },
                );
            }
            ServiceEvent::ServiceRemoved(_, fullname) => {
                if let Some(short) = fullname.split('.').next() {
                    found.retain(|id, _| !id.starts_with(short));
                }
            }
            _ => {}
        }
    }
    let _ = daemon.stop_browse(SERVICE);
    let _ = daemon.shutdown();
    Ok(found.into_values().collect())
}

/// Verify discovered endpoints against already persisted peer trust, with bounded
/// concurrency and a fixed extra time budget. Unknown devices remain unverified.
pub async fn browse_verified(core: &Core, duration: Duration) -> Result<Vec<Discovered>> {
    use futures_util::{StreamExt, stream};
    let mut found = browse(core, duration).await?;
    let state = core.read();
    let candidates = found
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            state
                .peers
                .get(&item.id)
                .cloned()
                .map(|peer| (index, peer, item.endpoints.clone()))
        })
        .collect::<Vec<_>>();
    let mut checks = stream::iter(candidates.into_iter().map(|(index, peer, endpoints)| {
        let core = core.clone();
        async move {
            for endpoint in endpoints.into_iter().take(4) {
                let mut remote = peer.remote.clone();
                remote.endpoint = endpoint;
                let Ok(client) = crate::client::NativeClient::new(core.clone(), remote) else {
                    continue;
                };
                if tokio::time::timeout(Duration::from_secs(2), client.verify())
                    .await
                    .is_ok_and(|result| result.is_ok())
                {
                    return (index, true);
                }
            }
            (index, false)
        }
    }))
    .buffer_unordered(4);
    let deadline = tokio::time::sleep(Duration::from_secs(8));
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _ = &mut deadline => break,
            result = checks.next() => match result { Some((index, verified)) => found[index].verified = verified, None => break },
        }
    }
    Ok(found)
}
