use crate::{
    BUFFER_SIZE, Core, PROTOCOL_VERSION,
    auth::{self, LanPolicy, Principal},
    catalog, identity,
    model::*,
};
use anyhow::{Context, Result, ensure};
use axum::{
    Json, Router,
    body::Body,
    extract::{ConnectInfo, DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, Uri, header},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use std::{
    io::{Seek, SeekFrom},
    net::{IpAddr, SocketAddr},
    time::Duration,
};
use tokio::io::AsyncReadExt;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct Api {
    pub core: Core,
    pub lan: LanPolicy,
}

#[derive(Debug)]
pub struct ApiError(pub StatusCode);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.0,
            Json(
                serde_json::json!({"error": self.0.canonical_reason().unwrap_or("Request failed")}),
            ),
        )
            .into_response()
    }
}
type ApiResult<T> = std::result::Result<T, ApiError>;

fn principal(api: &Api, headers: &HeaderMap, uri: &Uri) -> ApiResult<Principal> {
    if !headers.contains_key(header::AUTHORIZATION)
        && !headers.contains_key("x-ulak-device")
        && let Some(token) = headers
            .get(header::COOKIE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| {
                v.split(';')
                    .map(str::trim)
                    .find_map(|v| v.strip_prefix("ulak_session="))
            })
    {
        let mut copy = headers.clone();
        if let Ok(value) = format!("Bearer {token}").parse() {
            copy.insert(header::AUTHORIZATION, value);
            // An expired browser session does not hide independently LAN-open shares.
            return Ok(
                auth::authenticate(&api.core, &copy, "GET", &uri.to_string())
                    .unwrap_or(Principal::Anonymous),
            );
        }
    }
    auth::authenticate(&api.core, headers, "GET", &uri.to_string())
        .map_err(|_| ApiError(StatusCode::UNAUTHORIZED))
}

fn share(api: &Api, id: &str, who: &Principal, address: IpAddr) -> ApiResult<Share> {
    api.core
        .accessible_share(id, who, address, &api.lan)
        .map_err(|_| ApiError(StatusCode::NOT_FOUND))
}

const FAVICON_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5.5" fill="#191A1D"/><path d="M6.5 5.2v8.4c0 3.2 2.2 5.2 5.5 5.2s5.5-2 5.5-5.2V5.2h-3.1v8.2c0 1.6-.9 2.6-2.4 2.6s-2.4-1-2.4-2.6V5.2Z" fill="#EFBD77"/></svg>"##;

pub fn router(core: Core, lan: LanPolicy) -> Router {
    Router::new()
        .route("/", get(|| async { Html(include_str!("../../../guest/index.html")) }))
        .route("/guest.js", get(|| async { ([(header::CONTENT_TYPE, "text/javascript; charset=utf-8")], include_str!("../../../guest/guest.js")) }))
        .route("/favicon.svg", get(|| async { ([(header::CONTENT_TYPE, "image/svg+xml; charset=utf-8")], FAVICON_SVG) }))
        .route("/favicon.ico", get(|| async { StatusCode::NO_CONTENT }))
        .route("/v1/hello", get(hello))
        .route("/v1/pair", post(pair))
        .route("/v1/pairing/identity", get(pairing_identity))
        .route("/v1/pairing/start", post(pairing_start))
        .route("/v1/pairing/reveal", post(pairing_reveal))
        .route("/v1/pairing/check", post(pairing_check))
        .route("/v1/guest/redeem", post(guest))
        .route("/v1/shares", get(shares))
        .route("/v1/shares/{id}/entries", get(entries))
        .route("/v1/shares/{id}/prepare", get(prepare))
        .route("/v1/shares/{id}/file", get(file))
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(axum::middleware::from_fn_with_state(
            std::sync::Arc::new(tokio::sync::Semaphore::new(64)),
            |State(slots): State<std::sync::Arc<tokio::sync::Semaphore>>, request: axum::extract::Request, next: axum::middleware::Next| async move {
                let Ok(_permit) = slots.try_acquire_owned() else { return StatusCode::SERVICE_UNAVAILABLE.into_response(); };
                next.run(request).await
            },
        ))
        .layer(axum::middleware::map_response(|mut response: Response| async {
            let headers = response.headers_mut();
            headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            headers.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
            headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
            headers.insert("content-security-policy", HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"));
            response
        }))
        .with_state(Api { core, lan })
}

#[derive(Default, Deserialize)]
struct HelloQuery {
    challenge: Option<String>,
}
async fn hello(State(api): State<Api>, Query(query): Query<HelloQuery>) -> ApiResult<Json<Hello>> {
    let challenge = query.challenge.unwrap_or_default();
    if challenge.len() > 128 {
        return Err(ApiError(StatusCode::BAD_REQUEST));
    }
    let state = api.core.read();
    let mut hello = Hello {
        protocol: PROTOCOL_VERSION,
        identity: state.identity.clone(),
        capabilities: vec![
            "native-download".into(),
            "ranges".into(),
            "blake3".into(),
            "lan-open".into(),
            "guest-session".into(),
        ],
        challenge,
        signature: String::new(),
    };
    hello.signature = identity::sign(
        &state,
        &crate::client::hello_message(&hello)
            .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR))?,
    )
    .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR))?;
    Ok(Json(hello))
}

fn check_origin(headers: &HeaderMap, uri: &Uri) -> ApiResult<()> {
    if let Some(origin) = headers.get(header::ORIGIN) {
        let authority = headers
            .get(header::HOST)
            .and_then(|v| v.to_str().ok())
            .or_else(|| uri.authority().map(axum::http::uri::Authority::as_str))
            .filter(|v| !v.is_empty())
            .ok_or(ApiError(StatusCode::FORBIDDEN))?;
        let expected = format!("https://{authority}");
        if origin.to_str().ok() != Some(expected.as_str()) {
            return Err(ApiError(StatusCode::FORBIDDEN));
        }
    }
    Ok(())
}

fn pairing_scope(api: &Api, address: SocketAddr, headers: &HeaderMap, uri: &Uri) -> ApiResult<()> {
    check_origin(headers, uri)?;
    if !api.lan.contains(address.ip()) {
        return Err(ApiError(StatusCode::FORBIDDEN));
    }
    Ok(())
}
async fn pairing_identity(
    State(api): State<Api>,
    ConnectInfo(address): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    uri: Uri,
) -> ApiResult<Json<Remote>> {
    pairing_scope(&api, address, &headers, &uri)?;
    api.core
        .pairing_identity()
        .map(Json)
        .map_err(|_| ApiError(StatusCode::NOT_FOUND))
}
async fn pairing_start(
    State(api): State<Api>,
    ConnectInfo(address): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    uri: Uri,
    Json(request): Json<crate::pairing::Start>,
) -> ApiResult<Json<crate::pairing::Offer>> {
    pairing_scope(&api, address, &headers, &uri)?;
    api.core
        .receive_pairing_start(request, address.ip())
        .map(Json)
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST))
}
async fn pairing_reveal(
    State(api): State<Api>,
    ConnectInfo(address): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    uri: Uri,
    Json(request): Json<crate::pairing::Reveal>,
) -> ApiResult<Json<crate::pairing::Reveal>> {
    pairing_scope(&api, address, &headers, &uri)?;
    api.core
        .receive_pairing_reveal(request)
        .map(Json)
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST))
}
async fn pairing_check(
    State(api): State<Api>,
    ConnectInfo(address): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    uri: Uri,
    Json(request): Json<crate::pairing::Check>,
) -> ApiResult<Json<crate::pairing::Reply>> {
    pairing_scope(&api, address, &headers, &uri)?;
    api.core
        .receive_pairing_check(request)
        .map(Json)
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST))
}

async fn pair(
    State(api): State<Api>,
    headers: HeaderMap,
    uri: Uri,
    Json(request): Json<PairRequest>,
) -> ApiResult<Json<DeviceIdentity>> {
    check_origin(&headers, &uri)?;
    auth::redeem_pair(&api.core, request)
        .map(Json)
        .map_err(|_| ApiError(StatusCode::UNAUTHORIZED))
}

async fn guest(
    State(api): State<Api>,
    headers: HeaderMap,
    uri: Uri,
    Json(request): Json<GuestRedemption>,
) -> ApiResult<Response> {
    check_origin(&headers, &uri)?;
    let grant = auth::redeem_guest(&api.core, &request.token)
        .map_err(|_| ApiError(StatusCode::UNAUTHORIZED))?;
    let cookie = format!(
        "ulak_session={}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800",
        grant.token
    );
    Ok((
        [(header::SET_COOKIE, cookie)],
        Json(serde_json::json!({"session_id": grant.session_id})),
    )
        .into_response())
}

#[derive(Default, Deserialize)]
struct BrowseQuery {
    entry: Option<String>,
    cursor: Option<String>,
    #[serde(default)]
    touch: bool,
}

async fn shares(
    State(api): State<Api>,
    ConnectInfo(address): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    uri: Uri,
    Query(query): Query<BrowseQuery>,
) -> ApiResult<Json<Page<ShareView>>> {
    let who = principal(&api, &headers, &uri)?;
    Ok(Json(api.core.list_shares(
        &who,
        address.ip(),
        &api.lan,
        query.cursor.as_deref(),
    )))
}
async fn entries(
    State(api): State<Api>,
    ConnectInfo(address): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    headers: HeaderMap,
    uri: Uri,
    Query(query): Query<BrowseQuery>,
) -> ApiResult<Json<Page<Entry>>> {
    let who = principal(&api, &headers, &uri)?;
    let share = share(&api, &id, &who, address.ip())?;
    if query.touch {
        let cursor = query.cursor.ok_or(ApiError(StatusCode::BAD_REQUEST))?;
        api.core
            .touch_directory(&id, &cursor, &who)
            .map_err(|_| ApiError(StatusCode::CONFLICT))?;
        return Ok(Json(Page {
            items: Vec::new(),
            next_cursor: Some(cursor),
        }));
    }
    api.core
        .list_entries(
            &share,
            query.entry.as_deref(),
            query.cursor.as_deref(),
            &who,
        )
        .map(Json)
        .map_err(|_| ApiError(StatusCode::CONFLICT))
}
async fn prepare(
    State(api): State<Api>,
    ConnectInfo(address): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    headers: HeaderMap,
    uri: Uri,
    Query(query): Query<BrowseQuery>,
) -> ApiResult<Json<FileInfo>> {
    let who = principal(&api, &headers, &uri)?;
    let current_share = share(&api, &id, &who, address.ip())?;
    let entry = query.entry.ok_or(ApiError(StatusCode::BAD_REQUEST))?;
    let result = api
        .core
        .prepare_file(current_share, entry)
        .await
        .map_err(|_| ApiError(StatusCode::CONFLICT))?;
    // A long hash may outlast a permission grant. Recheck before returning metadata.
    share(&api, &id, &who, address.ip())?;
    Ok(Json(result))
}

#[derive(Deserialize)]
struct FileQuery {
    entry: String,
    revision: String,
}

/// Single byte ranges only. The end is inclusive; suffix ranges are supported.
pub fn byte_range(value: Option<&str>, length: u64) -> Result<(u64, u64, bool)> {
    let Some(value) = value else {
        return Ok((0, length, false));
    };
    let value = value
        .strip_prefix("bytes=")
        .context("Unsupported range unit")?;
    ensure!(!value.contains(',') && length > 0, "Unsatisfiable range");
    let (start, end) = value.split_once('-').context("Malformed range")?;
    if start.is_empty() {
        let suffix: u64 = end.parse()?;
        ensure!(suffix > 0, "Empty suffix range");
        return Ok((length.saturating_sub(suffix), length, true));
    }
    let start: u64 = start.parse()?;
    ensure!(start < length, "Unsatisfiable range");
    let end = if end.is_empty() {
        length
    } else {
        end.parse::<u64>()?.saturating_add(1).min(length)
    };
    ensure!(end > start, "Unsatisfiable range");
    Ok((start, end, true))
}

async fn file(
    State(api): State<Api>,
    ConnectInfo(address): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    headers: HeaderMap,
    uri: Uri,
    Query(query): Query<FileQuery>,
) -> ApiResult<Response> {
    let who = principal(&api, &headers, &uri)?;
    let current_share = share(&api, &id, &who, address.ip())?;
    // Reject excess requests instead of creating an unbounded queue of open sources.
    let permit = api
        .core
        .0
        .transfers
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE))?;
    let relative = api
        .core
        .entry_path(&id, &query.entry)
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST))?;
    let (mut source, guards) = catalog::open_source(&current_share, &relative)
        .map_err(|_| ApiError(StatusCode::CONFLICT))?;
    let metadata = source
        .metadata()
        .map_err(|_| ApiError(StatusCode::CONFLICT))?;
    let revision = catalog::revision(&metadata);
    let etag = format!("\"{revision}\"");
    if revision != query.revision
        || headers
            .get(header::IF_MATCH)
            .is_some_and(|v| v.to_str().ok() != Some(etag.as_str()))
    {
        return Err(ApiError(StatusCode::PRECONDITION_FAILED));
    }
    if headers
        .get(header::IF_RANGE)
        .is_some_and(|v| v.to_str().ok() != Some(etag.as_str()))
    {
        return Err(ApiError(StatusCode::PRECONDITION_FAILED));
    }
    let length = metadata.len();
    let range = headers
        .get(header::RANGE)
        .map(|v| v.to_str())
        .transpose()
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST))?;
    let (start, end, partial) = match byte_range(range, length) {
        Ok(range) => range,
        Err(_) => {
            return Ok((
                StatusCode::RANGE_NOT_SATISFIABLE,
                [(header::CONTENT_RANGE, format!("bytes */{length}"))],
            )
                .into_response());
        }
    };
    source
        .seek(SeekFrom::Start(start))
        .map_err(|_| ApiError(StatusCode::CONFLICT))?;
    let stream: std::pin::Pin<
        Box<dyn futures_util::Stream<Item = std::io::Result<bytes::Bytes>> + Send>,
    > = Box::pin(async_stream::try_stream! {
        let _permit = permit;
        let _guards = guards;
        let mut source = tokio::fs::File::from_std(source).take(end - start);
        let mut buffer = vec![0; BUFFER_SIZE];
        loop {
            let read = source.read(&mut buffer).await?;
            if read == 0 { break; }
            yield bytes::Bytes::copy_from_slice(&buffer[..read]);
        }
    });
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = if partial {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(
        header::CONTENT_LENGTH,
        (end - start).to_string().parse().unwrap(),
    );
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(header::ETAG, etag.parse().unwrap());
    let name = relative
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or(&current_share.name);
    let encoded: String = name
        .as_bytes()
        .iter()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || b"-._".contains(byte) {
                (*byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect();
    headers.insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"download\"; filename*=UTF-8''{encoded}")
            .parse()
            .unwrap(),
    );
    if partial {
        headers.insert(
            header::CONTENT_RANGE,
            format!("bytes {start}-{}/{length}", end - 1)
                .parse()
                .unwrap(),
        );
    }
    Ok(response)
}

pub async fn serve(
    core: Core,
    address: SocketAddr,
    certificate_addresses: Vec<IpAddr>,
    lan: LanPolicy,
    stop: CancellationToken,
) -> Result<()> {
    let listener = std::net::TcpListener::bind(address)?;
    serve_listener(core, listener, certificate_addresses, lan, stop).await
}

pub async fn serve_listener(
    core: Core,
    listener: std::net::TcpListener,
    certificate_addresses: Vec<IpAddr>,
    lan: LanPolicy,
    stop: CancellationToken,
) -> Result<()> {
    listener.set_nonblocking(true)?;
    let _ = rustls::crypto::ring::default_provider().install_default();
    let (cert, key) = identity::server_certificate(&core.read(), &certificate_addresses)?;
    let config =
        axum_server::tls_rustls::RustlsConfig::from_pem(cert.into_bytes(), key.into_bytes())
            .await?;
    let handle = axum_server::Handle::new();
    let signal = handle.clone();
    let waiter = tokio::spawn(async move {
        stop.cancelled().await;
        signal.graceful_shutdown(Some(Duration::from_secs(5)));
    });
    let result = axum_server::from_tcp_rustls(listener, config)
        .handle(handle)
        .serve(router(core, lan).into_make_service_with_connect_info::<SocketAddr>())
        .await;
    waiter.abort();
    Ok(result?)
}

/// Plain HTTP exposes only public trust-setup materials, never a share catalog.
pub fn onboarding_router(core: Core) -> Router {
    let certificate = core.read().ca_pem;
    let fingerprint = identity::token_hash(&certificate);
    let page = format!(
        "<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content=width=device-width,initial-scale=1><link rel=icon href=/favicon.svg type=image/svg+xml><title>Ulak browser setup</title><h1>Set up a secure connection</h1><p>This one-time setup lets your browser open files shared by this computer. Only install this certificate on a device you control.</p><h2>1. Check the security code</h2><p>On the sharing computer, open the guest invitation in Ulak. Compare its security code with this one. Continue only if they match:</p><pre style=white-space:pre-wrap;overflow-wrap:anywhere>{fingerprint}</pre><h2>2. Install the security certificate</h2><p><a href=/ulak-ca.crt>Download security certificate</a></p><p>iPhone or iPad: install the downloaded profile in Settings, then enable full trust in Settings → General → About → Certificate Trust Settings. Android: install it as a CA certificate in security settings. Remove the certificate when you no longer need access.</p><h2>3. Open your invitation</h2><p>Return to the invitation link from the sharing computer, or its secure HTTPS address. Files are available through that secure connection.</p></html>"
    );
    Router::new()
        .route(
            "/favicon.svg",
            get(|| async {
                (
                    [(header::CONTENT_TYPE, "image/svg+xml; charset=utf-8")],
                    FAVICON_SVG,
                )
            }),
        )
        .route(
            "/",
            get(move || {
                let page = page.clone();
                async move { Html(page) }
            }),
        )
        .route(
            "/ulak-ca.crt",
            get(move || {
                let certificate = certificate.clone();
                async move {
                    (
                        [
                            (header::CONTENT_TYPE, "application/x-x509-ca-cert"),
                            (
                                header::CONTENT_DISPOSITION,
                                "attachment; filename=ulak-ca.crt",
                            ),
                        ],
                        certificate,
                    )
                }
            }),
        )
}
