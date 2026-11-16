//! Nearby pairing uses signed nonce commitments and explicit numeric comparison.
//! Bootstrap identity retrieval is untrusted and cannot grant file access.
use crate::{
    Core,
    client::{NativeClient, bounded_json},
    identity,
    model::*,
};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, net::IpAddr, time::Duration};

const LIFETIME: u64 = 120;
const CLOCK_SKEW: u64 = 60;
const CAPACITY: usize = 16;

#[derive(Clone, Serialize, Deserialize)]
pub struct Start {
    pub requester: Remote,
    pub responder: Remote,
    pub commitment: String,
    pub timestamp: u64,
    pub signature: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Offer {
    pub id: String,
    pub commitment: String,
    pub expires_at: u64,
    pub signature: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Reveal {
    pub id: String,
    pub nonce: String,
    pub signature: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Check {
    pub id: String,
    pub challenge: String,
    pub accept: Option<bool>,
    pub signature: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Comparing,
    Waiting,
    Paired,
    Rejected,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Reply {
    pub state: Status,
    pub challenge: String,
    pub signature: String,
}
#[derive(Clone, Serialize)]
pub struct View {
    pub id: String,
    pub name: String,
    pub incoming: bool,
    pub code: Option<String>,
    pub state: Status,
    pub approved: bool,
    pub expires_at: u64,
}
#[derive(Clone)]
struct Session {
    start: Start,
    offer: Offer,
    own_nonce: String,
    other_nonce: Option<String>,
    incoming: bool,
    approved: bool,
    other_approved: bool,
    status: Status,
}
impl Session {
    fn remote(&self) -> &Remote {
        if self.incoming {
            &self.start.requester
        } else {
            &self.start.responder
        }
    }
    fn transcript(&self) -> Result<Vec<u8>> {
        transcript(&self.start, &self.offer)
    }
    fn code(&self) -> Option<String> {
        let other = self.other_nonce.as_ref()?;
        let (a, b) = if self.incoming {
            (other, &self.own_nonce)
        } else {
            (&self.own_nonce, other)
        };
        let bytes =
            serde_json::to_vec(&("ulak-nearby-code-v1", self.transcript().ok()?, a, b)).ok()?;
        let digest = blake3::hash(&bytes);
        let value = u32::from_be_bytes(digest.as_bytes()[..4].try_into().ok()?);
        Some(format!("{:06}", value % 1_000_000))
    }
}
#[derive(Default)]
pub struct Pairings {
    local: Option<Remote>,
    sessions: BTreeMap<String, Session>,
    rates: BTreeMap<IpAddr, (u64, u8)>,
    used: BTreeMap<String, u64>,
}
impl Pairings {
    fn prune(&mut self) {
        self.sessions
            .retain(|_, session| session.offer.expires_at > now());
        self.rates.retain(|_, (expires, _)| *expires > now());
        self.used.retain(|_, expires| *expires > now());
    }
}
fn start_message(start: &Start) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&(
        "ulak-nearby-start-v1",
        &start.requester,
        &start.responder,
        &start.commitment,
        start.timestamp,
    ))?)
}
fn transcript(start: &Start, offer: &Offer) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&(
        "ulak-nearby-offer-v1",
        start_message(start)?,
        &offer.id,
        &offer.commitment,
        offer.expires_at,
    ))?)
}
fn reveal_message(session: &Session, nonce: &str) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&(
        "ulak-nearby-reveal-v1",
        session.transcript()?,
        nonce,
    ))?)
}
fn check_message(check: &Check) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&(
        "ulak-nearby-check-v1",
        &check.id,
        &check.challenge,
        check.accept,
    ))?)
}
fn reply_message(session: &Session, reply: &Reply) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&(
        "ulak-nearby-reply-v1",
        session.transcript()?,
        reply.state,
        &reply.challenge,
    ))?)
}
fn validate_offer(offer: &Offer, current_time: u64) -> Result<()> {
    uuid::Uuid::parse_str(&offer.id)?;
    ensure!(
        offer.expires_at > current_time
            && offer.expires_at <= current_time + LIFETIME + CLOCK_SKEW
            && offer.commitment.len() == 64,
        "Invalid pairing offer"
    );
    Ok(())
}

fn validate_secret(value: &str) -> Result<()> {
    ensure!(
        identity::decode(value)?.len() == 32,
        "Invalid pairing nonce"
    );
    Ok(())
}
fn persist_peer(core: &Core, remote: &Remote) -> Result<()> {
    core.update(|state| {
        if let Some(existing) = state.peers.get(&remote.identity.id) {
            ensure!(
                existing.remote.ca_pem == remote.ca_pem
                    && existing.remote.identity.public_key == remote.identity.public_key,
                "Existing device trust cannot be replaced by discovery"
            );
        }
        state.peers.insert(
            remote.identity.id.clone(),
            Peer {
                remote: remote.clone(),
                last_connected: Some(now()),
            },
        );
        Ok(())
    })
}

impl Core {
    pub fn enable_nearby_pairing(&self, endpoint: &str) -> Result<()> {
        let local = self.descriptor(endpoint)?;
        let mut pairings = self.0.pairing.lock().unwrap();
        pairings.local = Some(local);
        pairings.sessions.clear();
        Ok(())
    }
    pub fn disable_nearby_pairing(&self) {
        let mut guard = self.0.pairing.lock().unwrap();
        guard.local = None;
        guard.sessions.clear();
    }
    pub fn pairing_identity(&self) -> Result<Remote> {
        self.0
            .pairing
            .lock()
            .unwrap()
            .local
            .clone()
            .ok_or_else(|| anyhow::anyhow!("Nearby pairing is unavailable"))
    }
    pub fn pairing_views(&self) -> Vec<View> {
        let mut guard = self.0.pairing.lock().unwrap();
        guard.prune();
        guard
            .sessions
            .values()
            .map(|s| View {
                id: s.offer.id.clone(),
                name: s.remote().identity.name.clone(),
                incoming: s.incoming,
                code: s.code(),
                state: s.status,
                approved: s.approved,
                expires_at: s.offer.expires_at,
            })
            .collect()
    }
    pub fn receive_pairing_start(&self, start: Start, address: IpAddr) -> Result<Offer> {
        identity::validate_remote(&start.requester)?;
        identity::validate_remote(&start.responder)?;
        ensure!(
            start.commitment.len() == 64 && start.commitment.bytes().all(|b| b.is_ascii_hexdigit()),
            "Invalid pairing commitment"
        );
        ensure!(
            start.timestamp.abs_diff(now()) <= CLOCK_SKEW,
            "Pairing request expired"
        );
        identity::verify(
            &start.requester.identity,
            &start_message(&start)?,
            &start.signature,
        )?;
        let stored = self.read();
        ensure!(
            start.requester.identity.id != stored.identity.id
                && !stored.peers.contains_key(&start.requester.identity.id),
            "Device is already paired or is this computer"
        );
        let mut guard = self.0.pairing.lock().unwrap();
        guard.prune();
        let local = guard
            .local
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Nearby pairing is off"))?;
        ensure!(
            serde_json::to_vec(local)? == serde_json::to_vec(&start.responder)?,
            "Pairing target changed"
        );
        ensure!(
            guard.sessions.len() < CAPACITY && guard.used.len() < 128,
            "Too many pairing requests; try again shortly"
        );
        ensure!(
            guard.rates.contains_key(&address) || guard.rates.len() < 64,
            "Pairing request limit reached"
        );
        let rate = guard.rates.entry(address).or_insert((now() + 60, 0));
        ensure!(rate.1 < 5, "Too many pairing attempts; wait a minute");
        rate.1 += 1;
        let replay = identity::token_hash(&identity::encode(&start_message(&start)?));
        ensure!(
            !guard.used.contains_key(&replay),
            "Repeated pairing request"
        );
        guard.used.insert(replay, now() + 180);
        let nonce = identity::secret();
        let mut offer = Offer {
            id: uuid::Uuid::new_v4().to_string(),
            commitment: identity::token_hash(&nonce),
            expires_at: now() + LIFETIME,
            signature: String::new(),
        };
        offer.signature = identity::sign(&stored, &transcript(&start, &offer)?)?;
        guard.sessions.insert(
            offer.id.clone(),
            Session {
                start,
                offer: offer.clone(),
                own_nonce: nonce,
                other_nonce: None,
                incoming: true,
                approved: false,
                other_approved: false,
                status: Status::Comparing,
            },
        );
        Ok(offer)
    }
    pub fn receive_pairing_reveal(&self, reveal: Reveal) -> Result<Reveal> {
        validate_secret(&reveal.nonce)?;
        let mut guard = self.0.pairing.lock().unwrap();
        guard.prune();
        let session = guard
            .sessions
            .get_mut(&reveal.id)
            .ok_or_else(|| anyhow::anyhow!("Pairing request expired"))?;
        ensure!(
            session.incoming && session.status != Status::Rejected,
            "Pairing request unavailable"
        );
        identity::verify(
            &session.start.requester.identity,
            &reveal_message(session, &reveal.nonce)?,
            &reveal.signature,
        )?;
        ensure!(
            identity::token_hash(&reveal.nonce) == session.start.commitment,
            "Pairing commitment mismatch"
        );
        session.other_nonce = Some(reveal.nonce);
        Ok(Reveal {
            id: reveal.id,
            nonce: session.own_nonce.clone(),
            signature: identity::sign(&self.read(), &reveal_message(session, &session.own_nonce)?)?,
        })
    }
    pub fn receive_pairing_check(&self, check: Check) -> Result<Reply> {
        validate_secret(&check.challenge)?;
        let mut guard = self.0.pairing.lock().unwrap();
        guard.prune();
        let session = guard
            .sessions
            .get_mut(&check.id)
            .ok_or_else(|| anyhow::anyhow!("Pairing request expired"))?;
        ensure!(
            session.incoming && session.code().is_some(),
            "Pairing comparison is not ready"
        );
        identity::verify(
            &session.start.requester.identity,
            &check_message(&check)?,
            &check.signature,
        )?;
        if let Some(accept) = check.accept
            && !matches!(session.status, Status::Rejected | Status::Paired)
        {
            if accept {
                session.other_approved = true;
            } else {
                session.status = Status::Rejected;
            }
        }
        if session.approved
            && session.other_approved
            && !matches!(session.status, Status::Rejected | Status::Paired)
        {
            persist_peer(self, session.remote())?;
            session.status = Status::Paired;
        }
        let mut reply = Reply {
            state: session.status,
            challenge: check.challenge,
            signature: String::new(),
        };
        reply.signature = identity::sign(&self.read(), &reply_message(session, &reply)?)?;
        Ok(reply)
    }
    pub fn decide_pairing(&self, id: &str, accept: bool) -> Result<()> {
        let mut guard = self.0.pairing.lock().unwrap();
        guard.prune();
        let session = guard
            .sessions
            .get_mut(id)
            .ok_or_else(|| anyhow::anyhow!("Pairing request expired. Find the device again."))?;
        ensure!(
            session.code().is_some()
                && !matches!(session.status, Status::Rejected | Status::Paired),
            "Pairing request unavailable"
        );
        if !accept {
            session.status = Status::Rejected;
            return Ok(());
        }
        session.approved = true;
        session.status = Status::Waiting;
        if session.incoming && session.other_approved {
            persist_peer(self, session.remote())?;
            session.status = Status::Paired;
        }
        Ok(())
    }
}

/// The insecure client is used for this one public bootstrap route only.
/// Every later message uses the offered CA and verifies signed transcript proofs.
pub async fn start(core: &Core, endpoint: &str, expected_id: &str) -> Result<View> {
    let _slot =
        core.0.pairing_slots.try_acquire().map_err(|_| {
            anyhow::anyhow!("Another connection is being prepared. Try again shortly.")
        })?;
    let local = core.pairing_identity()?;
    let mut candidate = local.clone();
    candidate.endpoint = endpoint.into();
    identity::validate_remote(&candidate)?;
    let known = core.read();
    ensure!(
        !known.peers.contains_key(expected_id) && expected_id != local.identity.id,
        "This device is already saved"
    );
    let bootstrap = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .danger_accept_invalid_certs(true)
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(5))
        .build()?;
    let url = reqwest::Url::parse(endpoint)?.join("/v1/pairing/identity")?;
    let remote: Remote = bounded_json(bootstrap.get(url).send().await?, 16 * 1024).await?;
    identity::validate_remote(&remote)?;
    ensure!(
        remote.identity.id == expected_id && remote.endpoint == endpoint,
        "The discovered device changed. Search again."
    );
    let client = NativeClient::new(core.clone(), remote.clone())?;
    client.verify().await?;
    let nonce = identity::secret();
    let mut request = Start {
        requester: local,
        responder: remote,
        commitment: identity::token_hash(&nonce),
        timestamp: now(),
        signature: String::new(),
    };
    request.signature = identity::sign(&core.read(), &start_message(&request)?)?;
    let offer: Offer = post(&client, "/v1/pairing/start", &request).await?;
    validate_offer(&offer, now())?;
    identity::verify(
        &client.remote.identity,
        &transcript(&request, &offer)?,
        &offer.signature,
    )?;
    let mut session = Session {
        start: request,
        offer,
        own_nonce: nonce,
        other_nonce: None,
        incoming: false,
        approved: false,
        other_approved: false,
        status: Status::Comparing,
    };
    let reveal = Reveal {
        id: session.offer.id.clone(),
        nonce: session.own_nonce.clone(),
        signature: identity::sign(&core.read(), &reveal_message(&session, &session.own_nonce)?)?,
    };
    let proof: Reveal = post(&client, "/v1/pairing/reveal", &reveal).await?;
    validate_secret(&proof.nonce)?;
    ensure!(
        proof.id == session.offer.id
            && identity::token_hash(&proof.nonce) == session.offer.commitment,
        "Pairing commitment mismatch"
    );
    identity::verify(
        &client.remote.identity,
        &reveal_message(&session, &proof.nonce)?,
        &proof.signature,
    )?;
    session.other_nonce = Some(proof.nonce);
    let id = session.offer.id.clone();
    {
        let mut guard = core.0.pairing.lock().unwrap();
        guard.prune();
        ensure!(guard.sessions.len() < CAPACITY, "Too many pairing requests");
        ensure!(
            guard
                .local
                .as_ref()
                .is_some_and(|local| local.endpoint == session.start.requester.endpoint),
            "Connection settings changed. Find the device again."
        );
        guard.sessions.insert(id.clone(), session);
    }
    core.pairing_views()
        .into_iter()
        .find(|view| view.id == id)
        .ok_or_else(|| anyhow::anyhow!("Pairing request expired"))
}
async fn post<T: serde::de::DeserializeOwned>(
    client: &NativeClient,
    path: &str,
    body: &impl Serialize,
) -> Result<T> {
    bounded_json(
        client
            .http
            .post(client.url(path, &[])?)
            .json(body)
            .timeout(Duration::from_secs(5))
            .send()
            .await?,
        16 * 1024,
    )
    .await
}
pub async fn refresh(core: &Core) {
    use futures_util::{StreamExt, stream};
    let sessions: Vec<_> = {
        let mut guard = core.0.pairing.lock().unwrap();
        guard.prune();
        guard
            .sessions
            .values()
            .filter(|s| !s.incoming && s.status != Status::Paired)
            .cloned()
            .collect()
    };
    stream::iter(sessions)
        .for_each_concurrent(4, |session| async move {
            let _ = poll(core, session).await;
        })
        .await;
}
async fn poll(core: &Core, session: Session) -> Result<()> {
    let client = NativeClient::new(core.clone(), session.remote().clone())?;
    let mut check = Check {
        id: session.offer.id.clone(),
        challenge: identity::secret(),
        accept: if session.status == Status::Rejected {
            Some(false)
        } else if session.approved {
            Some(true)
        } else {
            None
        },
        signature: String::new(),
    };
    check.signature = identity::sign(&core.read(), &check_message(&check)?)?;
    let reply: Reply = post(&client, "/v1/pairing/check", &check).await?;
    ensure!(reply.challenge == check.challenge, "Stale pairing response");
    identity::verify(
        &client.remote.identity,
        &reply_message(&session, &reply)?,
        &reply.signature,
    )?;
    let mut guard = core.0.pairing.lock().unwrap();
    guard.prune();
    let Some(current) = guard.sessions.get_mut(&session.offer.id) else {
        return Ok(());
    };
    if reply.state == Status::Paired {
        ensure!(
            current.approved && current.status != Status::Rejected,
            "Pairing was not approved on this computer"
        );
        persist_peer(core, current.remote())?;
        current.status = Status::Paired;
    } else if reply.state == Status::Rejected {
        current.status = Status::Rejected;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> (
        tempfile::TempDir,
        Core,
        tempfile::TempDir,
        Core,
        Start,
        String,
    ) {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let client = Core::open(a.path().join("state"), "Client").unwrap();
        let host = Core::open(b.path().join("state"), "Host").unwrap();
        host.enable_nearby_pairing("https://127.0.0.1:7443/")
            .unwrap();
        let nonce = identity::secret();
        let mut start = Start {
            requester: client.descriptor("https://127.0.0.1:7444/").unwrap(),
            responder: host.pairing_identity().unwrap(),
            commitment: identity::token_hash(&nonce),
            timestamp: now(),
            signature: String::new(),
        };
        start.signature = identity::sign(&client.read(), &start_message(&start).unwrap()).unwrap();
        (a, client, b, host, start, nonce)
    }
    #[test]
    fn proofs_bind_both_descriptors_and_nonce_commitments() {
        let (_a, client, _b, host, start, nonce) = setup();
        let mut changed = start.clone();
        changed.requester.endpoint = "https://127.0.0.1:9999/".into();
        assert!(
            host.receive_pairing_start(changed, "127.0.0.1".parse().unwrap())
                .is_err()
        );
        let offer = host
            .receive_pairing_start(start.clone(), "127.0.0.1".parse().unwrap())
            .unwrap();
        assert!(
            host.receive_pairing_start(start, "127.0.0.1".parse().unwrap())
                .is_err()
        );
        let session = host.0.pairing.lock().unwrap().sessions[&offer.id].clone();
        let mut reveal = Reveal {
            id: offer.id.clone(),
            nonce: identity::secret(),
            signature: String::new(),
        };
        reveal.signature = identity::sign(
            &client.read(),
            &reveal_message(&session, &reveal.nonce).unwrap(),
        )
        .unwrap();
        assert!(host.receive_pairing_reveal(reveal).is_err());
        assert!(host.decide_pairing(&offer.id, true).is_err());
        let reveal = Reveal {
            id: offer.id.clone(),
            signature: identity::sign(&client.read(), &reveal_message(&session, &nonce).unwrap())
                .unwrap(),
            nonce,
        };
        host.receive_pairing_reveal(reveal).unwrap();
        host.decide_pairing(&offer.id, true).unwrap();
        let mut check = Check {
            id: offer.id.clone(),
            challenge: identity::secret(),
            accept: Some(true),
            signature: String::new(),
        };
        check.signature = identity::sign(&client.read(), &check_message(&check).unwrap()).unwrap();
        let mut forged = check.clone();
        forged.accept = Some(false);
        assert!(host.receive_pairing_check(forged).is_err());
        host.receive_pairing_check(check.clone()).unwrap();
        host.revoke_peer(&client.read().identity.id).unwrap();
        host.receive_pairing_check(check).unwrap();
        assert!(
            host.read().peers.is_empty(),
            "A replay cannot restore revoked trust"
        );
    }
    #[test]
    fn expiration_cancels_approval_and_requests_are_rate_limited() {
        let (_a, client, _b, host, start, _) = setup();
        let offer = host
            .receive_pairing_start(start.clone(), "127.0.0.1".parse().unwrap())
            .unwrap();
        host.0
            .pairing
            .lock()
            .unwrap()
            .sessions
            .get_mut(&offer.id)
            .unwrap()
            .offer
            .expires_at = now() - 1;
        assert!(host.decide_pairing(&offer.id, true).is_err());
        for _ in 0..4 {
            let mut request = start.clone();
            request.commitment = identity::token_hash(&identity::secret());
            request.signature =
                identity::sign(&client.read(), &start_message(&request).unwrap()).unwrap();
            host.receive_pairing_start(request, "127.0.0.1".parse().unwrap())
                .unwrap();
        }
        let mut request = start;
        request.commitment = identity::token_hash(&identity::secret());
        request.signature =
            identity::sign(&client.read(), &start_message(&request).unwrap()).unwrap();
        assert!(
            host.receive_pairing_start(request, "127.0.0.1".parse().unwrap())
                .is_err()
        );
        assert!(host.read().peers.is_empty());
    }
    #[test]
    fn offer_validation_tolerates_responder_clock_skew() {
        let now_sec = 1_700_000_000;
        let base_offer = Offer {
            id: uuid::Uuid::new_v4().to_string(),
            commitment: "0".repeat(64),
            expires_at: now_sec + LIFETIME,
            signature: String::new(),
        };
        assert!(validate_offer(&base_offer, now_sec).is_ok());

        let ahead_offer = Offer {
            expires_at: now_sec + LIFETIME + CLOCK_SKEW,
            ..base_offer.clone()
        };
        assert!(validate_offer(&ahead_offer, now_sec).is_ok());

        let too_far_ahead = Offer {
            expires_at: now_sec + LIFETIME + CLOCK_SKEW + 1,
            ..base_offer.clone()
        };
        assert!(validate_offer(&too_far_ahead, now_sec).is_err());

        let expired_offer = Offer {
            expires_at: now_sec,
            ..base_offer
        };
        assert!(validate_offer(&expired_offer, now_sec).is_err());
    }
}
