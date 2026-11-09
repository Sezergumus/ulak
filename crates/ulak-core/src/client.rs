use crate::{Core, PROTOCOL_VERSION, auth, identity, model::*};
use anyhow::{Context, Result, ensure};
use reqwest::{Client, Method, Url, header::HeaderMap};
use serde::de::DeserializeOwned;
use std::time::Duration;

#[derive(Clone)]
pub struct NativeClient {
    pub http: Client,
    pub remote: Remote,
    pub core: Core,
}

pub fn hello_message(hello: &Hello) -> Result<Vec<u8>> {
    Ok(serde_json::to_vec(&(
        "ulak-hello-v1",
        hello.protocol,
        &hello.identity,
        &hello.capabilities,
        &hello.challenge,
    ))?)
}

impl NativeClient {
    pub fn new(core: Core, remote: Remote) -> Result<Self> {
        identity::validate_remote(&remote)?;
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .tls_built_in_root_certs(false)
            .add_root_certificate(reqwest::Certificate::from_pem(remote.ca_pem.as_bytes())?)
            .connect_timeout(Duration::from_secs(5))
            .build()?;
        Ok(Self { http, remote, core })
    }
    pub fn url(&self, path: &str, query: &[(&str, &str)]) -> Result<Url> {
        let mut url = Url::parse(&self.remote.endpoint)?.join(path)?;
        if !query.is_empty() {
            url.query_pairs_mut().extend_pairs(query.iter().copied());
        }
        Ok(url)
    }
    pub fn headers(&self, url: &Url) -> Result<HeaderMap> {
        if self
            .core
            .read()
            .peers
            .contains_key(&self.remote.identity.id)
        {
            let target = match url.query() {
                Some(query) => format!("{}?{query}", url.path()),
                None => url.path().into(),
            };
            auth::request_headers(&self.core, "GET", &target)
        } else {
            Ok(HeaderMap::new())
        }
    }
    pub async fn get<T: DeserializeOwned>(&self, path: &str, query: &[(&str, &str)]) -> Result<T> {
        let url = self.url(path, query)?;
        let response = self
            .http
            .get(url.clone())
            .headers(self.headers(&url)?)
            .timeout(Duration::from_secs(3600))
            .send()
            .await?
            .error_for_status()?;
        bounded_json(response, 2 * 1024 * 1024).await
    }
    pub async fn verify(&self) -> Result<Hello> {
        let challenge = identity::secret();
        let url = self.url("/v1/hello", &[("challenge", &challenge)])?;
        let response = self
            .http
            .request(Method::GET, url)
            .timeout(Duration::from_secs(10))
            .send()
            .await?
            .error_for_status()?;
        let hello: Hello = bounded_json(response, 16 * 1024).await?;
        ensure!(
            hello.protocol == PROTOCOL_VERSION
                && hello.identity.id == self.remote.identity.id
                && hello.identity.public_key == self.remote.identity.public_key
                && hello.challenge == challenge,
            "Peer identity or protocol mismatch"
        );
        identity::verify(&hello.identity, &hello_message(&hello)?, &hello.signature)?;
        self.core.update(|state| {
            if let Some(peer) = state.peers.get_mut(&hello.identity.id) {
                peer.remote.endpoint = self.remote.endpoint.clone();
                peer.remote.identity.name = hello.identity.name.clone();
                peer.last_connected = Some(now());
            }
            Ok(())
        })?;
        Ok(hello)
    }
    pub async fn pair(core: Core, invitation: Invitation, local_endpoint: &str) -> Result<Peer> {
        ensure!(invitation.expires_at > now(), "Invitation expired");
        let client = Self::new(core.clone(), invitation.host.clone())?;
        client.verify().await?;
        let mut request = PairRequest {
            token: invitation.token,
            remote: core.descriptor(local_endpoint)?,
            signature: String::new(),
        };
        request.signature = identity::sign(&core.read(), &auth::pair_message(&request)?)?;
        let response = client
            .http
            .post(client.url("/v1/pair", &[])?)
            .json(&request)
            .timeout(Duration::from_secs(10))
            .send()
            .await?
            .error_for_status()?;
        let response: DeviceIdentity = bounded_json(response, 16 * 1024).await?;
        ensure!(
            response == invitation.host.identity,
            "Pairing identity mismatch"
        );
        let peer = Peer {
            remote: invitation.host,
            last_connected: Some(now()),
        };
        core.update(|state| {
            state
                .peers
                .insert(peer.remote.identity.id.clone(), peer.clone());
            Ok(())
        })?;
        Ok(peer)
    }
    pub async fn shares(&self, cursor: Option<&str>) -> Result<Page<ShareView>> {
        let query: Vec<_> = cursor
            .map(|cursor| ("cursor", cursor))
            .into_iter()
            .collect();
        self.get("/v1/shares", &query).await
    }
    pub async fn entries(
        &self,
        share: &str,
        entry: Option<&str>,
        cursor: Option<&str>,
    ) -> Result<Page<Entry>> {
        uuid::Uuid::parse_str(share)?;
        let mut query = Vec::new();
        if let Some(entry) = entry {
            query.push(("entry", entry));
        }
        if let Some(cursor) = cursor {
            query.push(("cursor", cursor));
        }
        self.get(&format!("/v1/shares/{share}/entries"), &query)
            .await
    }
    pub async fn prepare(&self, share: &str, entry: &str) -> Result<FileInfo> {
        uuid::Uuid::parse_str(share)?;
        let info: FileInfo = self
            .get(&format!("/v1/shares/{share}/prepare"), &[("entry", entry)])
            .await?;
        ensure!(
            info.share_id == share
                && info.entry_id == entry
                && crate::catalog::safe_name(&info.name),
            "Invalid file metadata"
        );
        ensure!(
            info.revision.len() == 64
                && info.digest.len() == 64
                && info.digest.bytes().all(|c| c.is_ascii_hexdigit()),
            "Invalid source revision or digest"
        );
        Ok(info)
    }
    pub async fn file_response(&self, info: &FileInfo, offset: u64) -> Result<reqwest::Response> {
        let url = self.url(
            &format!("/v1/shares/{}/file", info.share_id),
            &[("entry", &info.entry_id), ("revision", &info.revision)],
        )?;
        let mut request = self
            .http
            .get(url.clone())
            .headers(self.headers(&url)?)
            .header(reqwest::header::IF_MATCH, format!("\"{}\"", info.revision));
        if offset > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={offset}-"));
        }
        Ok(
            tokio::time::timeout(Duration::from_secs(30), request.send())
                .await
                .context("Source response timed out")??,
        )
    }
}

async fn bounded_json<T: DeserializeOwned>(response: reqwest::Response, limit: usize) -> Result<T> {
    use futures_util::StreamExt;
    let mut stream = response.error_for_status()?.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        ensure!(
            bytes.len() + chunk.len() <= limit,
            "Metadata response too large"
        );
        bytes.extend_from_slice(&chunk);
    }
    Ok(serde_json::from_slice(&bytes)?)
}
