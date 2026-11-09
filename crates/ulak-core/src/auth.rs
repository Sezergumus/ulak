use crate::{Core, MAX_RECORDS, identity, model::*};
use anyhow::{Result, bail, ensure};
use axum::http::HeaderMap;
use ipnet::IpNet;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, net::IpAddr};

#[derive(Clone, Debug)]
pub enum Principal {
    Anonymous,
    Device(String),
    Guest {
        id: String,
        shares: BTreeSet<String>,
    },
}
impl Principal {
    pub fn scope(&self) -> String {
        match self {
            Self::Anonymous => "anonymous".into(),
            Self::Device(id) => format!("device:{id}"),
            Self::Guest { id, .. } => format!("guest:{id}"),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct LanPolicy {
    pub allowed: Vec<IpNet>,
}
impl LanPolicy {
    pub fn contains(&self, ip: IpAddr) -> bool {
        let ip = match ip {
            IpAddr::V6(ip) => ip
                .to_ipv4_mapped()
                .map(IpAddr::V4)
                .unwrap_or(IpAddr::V6(ip)),
            ip => ip,
        };
        self.allowed.iter().any(|network| network.contains(&ip))
    }
}

pub fn canonical(method: &str, target: &str, timestamp: &str, nonce: &str) -> Vec<u8> {
    format!("ulak-v1\n{method}\n{target}\n{timestamp}\n{nonce}").into_bytes()
}

pub fn request_headers(core: &Core, method: &str, target: &str) -> Result<HeaderMap> {
    let state = core.read();
    let timestamp = now().to_string();
    let nonce = identity::secret();
    let signature = identity::sign(&state, &canonical(method, target, &timestamp, &nonce))?;
    let mut headers = HeaderMap::new();
    headers.insert("x-ulak-device", state.identity.id.parse()?);
    headers.insert("x-ulak-time", timestamp.parse()?);
    headers.insert("x-ulak-nonce", nonce.parse()?);
    headers.insert("x-ulak-signature", signature.parse()?);
    Ok(headers)
}

pub fn authenticate(
    core: &Core,
    headers: &HeaderMap,
    method: &str,
    target: &str,
) -> Result<Principal> {
    if let Some(value) = headers.get("authorization") {
        let value = value.to_str()?;
        let token = value
            .strip_prefix("Bearer ")
            .ok_or_else(|| anyhow::anyhow!("Invalid authorization"))?;
        ensure!(token.len() <= 128, "Invalid session token");
        let hash = identity::token_hash(token);
        return core.update(|state| {
            let Some(session) = state.sessions.get_mut(&hash) else {
                bail!("Unknown session")
            };
            ensure!(
                now().saturating_sub(session.last_used) < 1800
                    && now().saturating_sub(session.created_at) < 8 * 3600,
                "Session expired"
            );
            session.last_used = now();
            Ok(Principal::Guest {
                id: session.id.clone(),
                shares: session.shares.clone(),
            })
        });
    }
    let get = |name: &str| -> Result<&str> {
        Ok(headers
            .get(name)
            .ok_or_else(|| anyhow::anyhow!("Missing authentication"))?
            .to_str()?)
    };
    if !headers.contains_key("x-ulak-device") {
        ensure!(
            !headers.contains_key("x-ulak-signature"),
            "Incomplete authentication"
        );
        return Ok(Principal::Anonymous);
    }
    // Signed authentication is intentionally limited to read-only methods. Pairing
    // has a separate proof that binds its complete request body.
    ensure!(
        method == "GET" || method == "HEAD",
        "Signed control mutations are not exposed over LAN"
    );
    let id = get("x-ulak-device")?;
    let timestamp = get("x-ulak-time")?;
    let nonce = get("x-ulak-nonce")?;
    ensure!(
        nonce.len() <= 64 && now().abs_diff(timestamp.parse::<u64>()?) <= 60,
        "Stale request"
    );
    let state = core.read();
    let peer = state
        .peers
        .get(id)
        .ok_or_else(|| anyhow::anyhow!("Device is not paired"))?;
    identity::verify(
        &peer.remote.identity,
        &canonical(method, target, timestamp, nonce),
        get("x-ulak-signature")?,
    )?;
    let mut replay = core.0.replay.lock().unwrap();
    replay.retain(|_, expires| *expires > now());
    let key = format!("{id}:{nonce}");
    ensure!(
        !replay.contains_key(&key) && replay.len() < MAX_RECORDS,
        "Replayed request or request capacity reached"
    );
    replay.insert(key, now() + 120);
    Ok(Principal::Device(id.into()))
}

pub fn authorized(share: &Share, principal: &Principal, ip: IpAddr, lan: &LanPolicy) -> bool {
    match principal {
        Principal::Guest { shares, .. } if shares.contains(&share.id) => true,
        Principal::Device(id) if matches!(&share.audience, Audience::Devices { devices } if devices.contains(id)) => {
            true
        }
        _ => matches!(share.audience, Audience::Lan) && lan.contains(ip),
    }
}

pub fn pair_message(request: &PairRequest) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&(
        "ulak-pair-v1",
        &request.token,
        &request.remote,
    ))?)
}

pub fn redeem_pair(core: &Core, request: PairRequest) -> Result<DeviceIdentity> {
    identity::validate_remote(&request.remote)?;
    identity::verify(
        &request.remote.identity,
        &pair_message(&request)?,
        &request.signature,
    )?;
    core.update(|state| {
        ensure!(
            request.remote.identity.id != state.identity.id,
            "Cannot pair with yourself"
        );
        let key = identity::token_hash(&request.token);
        let invite = state
            .invitations
            .get(&key)
            .ok_or_else(|| anyhow::anyhow!("Invalid invitation"))?;
        ensure!(
            invite.expires_at > now() && invite.shares.is_none(),
            "Invitation expired or wrong kind"
        );
        state.invitations.remove(&key);
        state.peers.insert(
            request.remote.identity.id.clone(),
            Peer {
                remote: request.remote,
                last_connected: None,
            },
        );
        Ok(state.identity.clone())
    })
}

pub fn redeem_guest(core: &Core, token: &str) -> Result<GuestGrant> {
    ensure!(token.len() <= 128, "Invalid invitation");
    let session_token = identity::secret();
    let session_id = uuid::Uuid::new_v4().to_string();
    core.update(|state| {
        state.sessions.retain(|_, session| {
            now().saturating_sub(session.last_used) < 1800
                && now().saturating_sub(session.created_at) < 8 * 3600
        });
        let key = identity::token_hash(token);
        let invite = state
            .invitations
            .get(&key)
            .ok_or_else(|| anyhow::anyhow!("Invalid invitation"))?;
        ensure!(invite.expires_at > now(), "Invitation expired");
        let shares = invite
            .shares
            .clone()
            .ok_or_else(|| anyhow::anyhow!("Not a guest invitation"))?;
        state.invitations.remove(&key);
        let token_hash = identity::token_hash(&session_token);
        state.sessions.insert(
            token_hash.clone(),
            GuestSession {
                id: session_id.clone(),
                token_hash,
                shares,
                created_at: now(),
                last_used: now(),
            },
        );
        Ok(())
    })?;
    Ok(GuestGrant {
        session_id,
        token: session_token,
    })
}
