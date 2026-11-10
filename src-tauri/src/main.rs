#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{collections::BTreeSet, path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use ulak_core::{Core, auth::LanPolicy, client::NativeClient, identity, model::*, server};

mod network;

#[tauri::command]
fn network_choices() -> CommandResult<Vec<network::NetworkChoice>> {
    network::choices()
}

struct Runtime {
    core: Core,
    stop: tokio_util::sync::CancellationToken,
    serving: Mutex<bool>,
    server_stop: Mutex<Option<tokio_util::sync::CancellationToken>>,
    network: Mutex<Network>,
    drag: Mutex<Option<(Remote, Vec<FileInfo>)>>,
    configuration: tokio::sync::Mutex<()>,
    notice: Mutex<Option<String>>,
    operations: std::sync::Arc<tokio::sync::Semaphore>,
    setup_serving: Mutex<bool>,
    shortcut_available: Mutex<bool>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Network {
    endpoint: String,
    bind: String,
    lan: Vec<String>,
    advertise: bool,
    #[serde(default)]
    onboarding: Option<String>,
}
impl Default for Network {
    fn default() -> Self {
        Self {
            endpoint: "https://127.0.0.1:7443/".into(),
            bind: "127.0.0.1:7443".into(),
            lan: vec!["127.0.0.1/32".into()],
            advertise: false,
            onboarding: None,
        }
    }
}
type CommandResult<T> = Result<T, String>;
fn error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
fn snapshot(runtime: State<Runtime>) -> CommandResult<serde_json::Value> {
    let mut value = ulak_local::snapshot(&runtime.core).map_err(error)?;
    value["serving"] = serde_json::json!(*runtime.serving.lock().unwrap());
    value["network"] =
        serde_json::to_value(runtime.network.lock().unwrap().clone()).map_err(error)?;
    value["ca_fingerprint"] = serde_json::json!(identity::token_hash(&runtime.core.read().ca_pem));
    value["pairings"] = serde_json::json!(runtime.core.pairing_views());
    value["shortcut_available"] = serde_json::json!(*runtime.shortcut_available.lock().unwrap());
    value["service_error"] = serde_json::json!(runtime.notice.lock().unwrap().clone());
    Ok(value)
}
#[tauri::command]
async fn start_server(
    runtime: State<'_, Runtime>,
    app: tauri::AppHandle,
    endpoint: String,
    bind: String,
    lan: Vec<String>,
    advertise: Option<bool>,
    onboarding: Option<String>,
) -> CommandResult<()> {
    validate_network(
        &runtime.core,
        &Network {
            endpoint: endpoint.clone(),
            bind: bind.clone(),
            lan: lan.clone(),
            advertise: advertise.unwrap_or(false),
            onboarding: onboarding.clone(),
        },
    )?;
    let mut serving = runtime.serving.lock().unwrap();
    if *serving {
        return Err("Server is already running".into());
    }
    let remote = runtime.core.descriptor(&endpoint).map_err(error)?;
    let address: std::net::SocketAddr = bind.parse().map_err(error)?;
    let url = reqwest::Url::parse(&remote.endpoint).map_err(error)?;
    let ip = url
        .host_str()
        .unwrap()
        .trim_matches(['[', ']'])
        .parse()
        .map_err(error)?;
    let allowed = lan
        .iter()
        .map(|v| v.parse())
        .collect::<Result<Vec<_>, _>>()
        .map_err(error)?;
    let core = runtime.core.clone();
    let signal = runtime.stop.child_token();
    let listener = std::net::TcpListener::bind(address).map_err(error)?;
    let setup_listener = onboarding
        .as_deref()
        .filter(|v| !v.is_empty())
        .map(std::net::TcpListener::bind)
        .transpose()
        .map_err(error)?;
    if let Some(listener) = &setup_listener {
        listener.set_nonblocking(true).map_err(error)?;
    }
    let advertisement = if advertise.unwrap_or(false) {
        Some(ulak_core::discovery::Advertisement::start(&core, address, &[ip]).map_err(error)?)
    } else {
        None
    };
    let network = Network {
        endpoint,
        bind,
        lan,
        advertise: advertise.unwrap_or(false),
        onboarding,
    };
    ulak_core::storage::atomic_json(&runtime.core.0.directory.join("network.json"), &network)
        .map_err(error)?;
    *runtime.network.lock().unwrap() = network;
    runtime
        .core
        .enable_nearby_pairing(&remote.endpoint)
        .map_err(error)?;
    *runtime.server_stop.lock().unwrap() = Some(signal.clone());
    *serving = true;
    *runtime.notice.lock().unwrap() = None;
    if let Some(listener) = setup_listener {
        *runtime.setup_serving.lock().unwrap() = true;
        let router = server::onboarding_router(core.clone());
        let stop = signal.clone();
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let result = async {
                let listener = tokio::net::TcpListener::from_std(listener)?;
                axum::serve(listener, router)
                    .with_graceful_shutdown(stop.cancelled_owned())
                    .await
            }
            .await;
            if let Err(error) = result {
                let _ = handle.emit(
                    "server-error",
                    format!("Certificate setup listener failed: {error}"),
                );
            }
            *handle.state::<Runtime>().setup_serving.lock().unwrap() = false;
        });
    }
    tauri::async_runtime::spawn(async move {
        let _advertisement = advertisement;
        let setup_stop = signal.clone();
        if let Err(failure) = server::serve_listener(
            core,
            listener,
            vec![ip, "127.0.0.1".parse().unwrap()],
            LanPolicy { allowed },
            signal,
        )
        .await
        {
            *app.state::<Runtime>().notice.lock().unwrap() = Some(failure.to_string());
            let _ = app.emit("server-error", failure.to_string());
        }
        setup_stop.cancel();
        app.state::<Runtime>().core.disable_nearby_pairing();
        *app.state::<Runtime>().serving.lock().unwrap() = false;
    });
    Ok(())
}

fn validate_network(core: &Core, network: &Network) -> CommandResult<()> {
    core.descriptor(&network.endpoint).map_err(error)?;
    let url = reqwest::Url::parse(&network.endpoint).map_err(error)?;
    let ip: std::net::IpAddr = url
        .host_str()
        .unwrap()
        .trim_matches(['[', ']'])
        .parse()
        .map_err(error)?;
    let bind: std::net::SocketAddr = network.bind.parse().map_err(error)?;
    if bind.port() == 0
        || Some(bind.port()) != url.port_or_known_default()
        || (!bind.ip().is_unspecified() && bind.ip() != ip)
    {
        return Err("Listen address must match the advertised HTTPS address and port, or bind to an unspecified address on that port".into());
    }
    if network.lan.len() > 256 {
        return Err("At most 256 allowed ranges are supported".into());
    }
    let _policy = LanPolicy {
        allowed: network
            .lan
            .iter()
            .map(|value| value.parse())
            .collect::<Result<Vec<_>, _>>()
            .map_err(error)?,
    };
    if let Some(address) = network
        .onboarding
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        let address: std::net::SocketAddr = address.parse().map_err(error)?;
        if address.port() == 0 {
            return Err("Certificate setup needs an explicit port".into());
        }
    }
    Ok(())
}

#[tauri::command]
async fn apply_network(
    runtime: State<'_, Runtime>,
    app: tauri::AppHandle,
    network: Network,
    name: String,
) -> CommandResult<()> {
    let _configuration = runtime.configuration.lock().await;
    validate_network(&runtime.core, &network)?;
    let name = name.trim().to_string();
    if name.is_empty() || name.len() > 128 {
        return Err("Device name must contain 1–128 bytes".into());
    }
    let previous = runtime.network.lock().unwrap().clone();
    let old_name = runtime.core.read().identity.name;
    stop_server(app.state::<Runtime>()).await?;
    runtime
        .core
        .update(|state| {
            state.identity.name = name;
            Ok(())
        })
        .map_err(error)?;
    let result = start_server(
        app.state::<Runtime>(),
        app.clone(),
        network.endpoint,
        network.bind,
        network.lan,
        Some(network.advertise),
        network.onboarding,
    )
    .await;
    if let Err(failure) = result {
        runtime
            .core
            .update(|state| {
                state.identity.name = old_name;
                Ok(())
            })
            .map_err(error)?;
        let restored = start_server(
            app.state::<Runtime>(),
            app.clone(),
            previous.endpoint,
            previous.bind,
            previous.lan,
            Some(previous.advertise),
            previous.onboarding,
        )
        .await;
        return Err(match restored {
            Ok(()) => format!("{failure}. Previous connection settings restored."),
            Err(error) => format!("{failure}. Previous listener could not restart: {error}"),
        });
    }
    Ok(())
}

fn request_quit(app: tauri::AppHandle) {
    app.state::<Runtime>().stop.cancel();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        app.exit(0);
    });
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    request_quit(app);
}

#[tauri::command]
async fn stop_server(runtime: State<'_, Runtime>) -> CommandResult<()> {
    runtime.core.disable_nearby_pairing();
    if let Some(stop) = runtime.server_stop.lock().unwrap().take() {
        stop.cancel();
    }
    for _ in 0..100 {
        if !*runtime.serving.lock().unwrap() && !*runtime.setup_serving.lock().unwrap() {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    Err("Server is still stopping; try again shortly".into())
}

#[tauri::command]
async fn local_request(
    runtime: State<'_, Runtime>,
    request: ulak_local::Request,
) -> CommandResult<serde_json::Value> {
    let _permit = if matches!(request, ulak_local::Request::Cancel { .. }) {
        None
    } else {
        Some(
            runtime
                .operations
                .clone()
                .try_acquire_owned()
                .map_err(|_| "Local operation queue is full; try again shortly")?,
        )
    };
    ulak_local::dispatch(&runtime.core, request, runtime.stop.child_token())
        .await
        .map_err(error)
}

#[tauri::command]
async fn pick_sources(app: tauri::AppHandle, folder: bool) -> CommandResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths = if folder {
            app.dialog()
                .file()
                .set_title("Choose a folder to share")
                .blocking_pick_folders()
        } else {
            app.dialog()
                .file()
                .set_title("Choose files to share")
                .blocking_pick_files()
        };
        let paths = paths.unwrap_or_default();
        if paths.len() > 64 {
            return Err("Select at most 64 sources at a time".into());
        }
        paths
            .into_iter()
            .map(|p| {
                p.into_path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(error)
            })
            .collect()
    })
    .await
    .map_err(error)?
}

#[tauri::command]
async fn pick_destination(app: tauri::AppHandle) -> CommandResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Choose download destination")
            .blocking_pick_folder()
            .map(|p| {
                p.into_path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(error)
            })
            .transpose()
    })
    .await
    .map_err(error)?
}

#[tauri::command]
async fn save_public(
    runtime: State<'_, Runtime>,
    app: tauri::AppHandle,
    certificate: bool,
) -> CommandResult<()> {
    let endpoint = runtime.network.lock().unwrap().endpoint.clone();
    let bytes = if certificate {
        runtime.core.read().ca_pem.into_bytes()
    } else {
        serde_json::to_vec_pretty(&runtime.core.descriptor(&endpoint).map_err(error)?)
            .map_err(error)?
    };
    tauri::async_runtime::spawn_blocking(move || -> CommandResult<()> {
        if let Some(path) = app
            .dialog()
            .file()
            .set_file_name(if certificate {
                "ulak-ca.pem"
            } else {
                "ulak-connection.json"
            })
            .blocking_save_file()
        {
            std::fs::write(path.into_path().map_err(error)?, bytes).map_err(error)?;
        }
        Ok(())
    })
    .await
    .map_err(error)?
}

#[tauri::command]
async fn verify_peer(runtime: State<'_, Runtime>, remote: Remote) -> CommandResult<()> {
    NativeClient::new(runtime.core.clone(), remote)
        .map_err(error)?
        .verify()
        .await
        .map_err(error)?;
    Ok(())
}

#[tauri::command]
async fn presence(runtime: State<'_, Runtime>) -> CommandResult<Vec<String>> {
    use futures_util::{StreamExt, stream};
    let peers: Vec<_> = runtime.core.read().peers.into_values().collect();
    let core = runtime.core.clone();
    let mut checks = stream::iter(peers.into_iter().map(|peer| {
        let core = core.clone();
        async move {
            let id = peer.remote.identity.id.clone();
            match NativeClient::new(core, peer.remote) {
                Ok(client) if client.verify().await.is_ok() => Some(id),
                _ => None,
            }
        }
    }))
    .buffer_unordered(4);
    let deadline = tokio::time::sleep(std::time::Duration::from_secs(8));
    tokio::pin!(deadline);
    let mut online = Vec::new();
    loop {
        tokio::select! {
            _ = &mut deadline => break,
            result = checks.next() => match result { Some(Some(id)) => online.push(id), Some(None) => {}, None => break },
        }
    }
    Ok(online)
}

#[tauri::command]
async fn prepare_drag(
    runtime: State<'_, Runtime>,
    remote: Remote,
    share: String,
    entries: Vec<String>,
) -> CommandResult<()> {
    if entries.is_empty() || entries.len() > 64 {
        return Err("Select between 1 and 64 remote files".into());
    }
    *runtime.drag.lock().unwrap() = None;
    let client = NativeClient::new(runtime.core.clone(), remote.clone()).map_err(error)?;
    client.verify().await.map_err(error)?;
    let mut infos = Vec::new();
    for entry in entries {
        infos.push(client.prepare(&share, &entry).await.map_err(error)?);
    }
    *runtime.drag.lock().unwrap() = Some((remote, infos));
    Ok(())
}

#[tauri::command]
async fn drag_out(runtime: State<'_, Runtime>, app: tauri::AppHandle) -> CommandResult<bool> {
    let (remote, infos) = runtime
        .drag
        .lock()
        .unwrap()
        .take()
        .ok_or("Prepare the selected files before dragging")?;
    let core = runtime.core.clone();
    let (send, receive) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        #[cfg(windows)]
        let result = ulak_drag_probe::drag_files(core, remote, infos).map_err(error);
        #[cfg(not(windows))]
        let result = {
            let _ = (core, remote, infos);
            Err("Explorer drag requires Windows".into())
        };
        let _ = send.send(result);
    })
    .map_err(error)?;
    receive.await.map_err(error)?
}

#[tauri::command]
async fn discover(
    runtime: State<'_, Runtime>,
) -> CommandResult<Vec<ulak_core::discovery::Discovered>> {
    ulak_core::discovery::browse_verified(&runtime.core, std::time::Duration::from_secs(5))
        .await
        .map_err(error)
}

#[tauri::command]
async fn start_nearby_pairing(
    runtime: State<'_, Runtime>,
    device: String,
    endpoints: Vec<String>,
) -> CommandResult<ulak_core::pairing::View> {
    let network = runtime.network.lock().unwrap().clone();
    let policy = LanPolicy {
        allowed: network
            .lan
            .iter()
            .map(|range| range.parse())
            .collect::<Result<Vec<_>, _>>()
            .map_err(error)?,
    };
    let mut failure =
        "This device is unavailable. Keep Ulak open on both computers and search again."
            .to_string();
    for endpoint in endpoints.into_iter().take(4) {
        let address = reqwest::Url::parse(&endpoint).ok().and_then(|url| {
            url.host_str()
                .and_then(|host| host.trim_matches(['[', ']']).parse().ok())
        });
        if !address.is_some_and(|ip| policy.contains(ip)) {
            continue;
        }
        match ulak_core::pairing::start(&runtime.core, &endpoint, &device).await {
            Ok(view) => return Ok(view),
            Err(error) => failure = error.to_string(),
        }
    }
    Err(failure)
}

#[tauri::command]
fn decide_nearby_pairing(runtime: State<Runtime>, id: String, accept: bool) -> CommandResult<()> {
    runtime.core.decide_pairing(&id, accept).map_err(error)
}

#[tauri::command]
fn connection_descriptor(runtime: State<Runtime>, endpoint: String) -> CommandResult<Remote> {
    runtime.core.descriptor(&endpoint).map_err(error)
}

#[tauri::command]
fn export_ca(runtime: State<Runtime>, destination: String) -> CommandResult<()> {
    std::fs::write(destination, runtime.core.read().ca_pem).map_err(error)
}
#[tauri::command]
fn add_share(runtime: State<Runtime>, source: String, audience: Audience) -> CommandResult<Share> {
    runtime
        .core
        .add_share(&PathBuf::from(source), audience)
        .map_err(error)
}
#[tauri::command]
fn set_audience(runtime: State<Runtime>, share: String, audience: Audience) -> CommandResult<()> {
    runtime.core.set_audience(&share, audience).map_err(error)
}
#[tauri::command]
fn remove_share(runtime: State<Runtime>, share: String) -> CommandResult<()> {
    runtime.core.remove_share(&share).map_err(error)
}
#[tauri::command]
fn invitation(
    runtime: State<Runtime>,
    endpoint: String,
    guest_shares: Option<BTreeSet<String>>,
) -> CommandResult<String> {
    identity::encode_descriptor(
        &runtime
            .core
            .invite(&endpoint, guest_shares)
            .map_err(error)?,
    )
    .map_err(error)
}
#[tauri::command]
async fn pair(
    runtime: State<'_, Runtime>,
    invitation: String,
    endpoint: String,
) -> CommandResult<Peer> {
    NativeClient::pair(
        runtime.core.clone(),
        identity::decode_descriptor(&invitation).map_err(error)?,
        &endpoint,
    )
    .await
    .map_err(error)
}
#[tauri::command]
async fn browse(
    runtime: State<'_, Runtime>,
    remote: Remote,
    share: Option<String>,
    entry: Option<String>,
    cursor: Option<String>,
) -> CommandResult<serde_json::Value> {
    let client = NativeClient::new(runtime.core.clone(), remote).map_err(error)?;
    client.verify().await.map_err(error)?;
    if let Some(share) = share {
        serde_json::to_value(
            client
                .entries(&share, entry.as_deref(), cursor.as_deref())
                .await
                .map_err(error)?,
        )
        .map_err(error)
    } else {
        serde_json::to_value(client.shares(cursor.as_deref()).await.map_err(error)?).map_err(error)
    }
}
#[tauri::command]
async fn download(
    runtime: State<'_, Runtime>,
    remote: Remote,
    share: String,
    entry: String,
    destination: String,
) -> CommandResult<Checkpoint> {
    let client = NativeClient::new(runtime.core.clone(), remote).map_err(error)?;
    client.verify().await.map_err(error)?;
    let info = client.prepare(&share, &entry).await.map_err(error)?;
    runtime
        .core
        .download(
            client,
            info,
            &PathBuf::from(destination),
            runtime.stop.child_token(),
        )
        .await
        .map_err(error)
}
#[tauri::command]
fn cancel(runtime: State<Runtime>, transfer: String) -> CommandResult<()> {
    runtime.core.cancel_download(&transfer).map_err(error)
}
#[tauri::command]
async fn resume(
    runtime: State<'_, Runtime>,
    remote: Remote,
    transfer: String,
) -> CommandResult<Checkpoint> {
    let client = NativeClient::new(runtime.core.clone(), remote).map_err(error)?;
    runtime
        .core
        .resume(client, &transfer, runtime.stop.child_token())
        .await
        .map_err(error)
}
#[tauri::command]
fn unpair(runtime: State<Runtime>, device: String) -> CommandResult<()> {
    runtime.core.revoke_peer(&device).map_err(error)
}

#[tauri::command]
fn rename_device(runtime: State<Runtime>, name: String) -> CommandResult<()> {
    let name = name.trim().to_string();
    if name.is_empty() || name.len() > 128 {
        return Err("Device name must contain 1–128 bytes".into());
    }
    runtime
        .core
        .update(|state| {
            state.identity.name = name;
            Ok(())
        })
        .map_err(error)
}
#[tauri::command]
fn revoke_guest(runtime: State<Runtime>, session: String) -> CommandResult<()> {
    runtime.core.revoke_session(&session).map_err(error)
}

fn main() {
    // Each data directory is a separate installation, including isolated test peers.
    let mut context = tauri::generate_context!();
    if let Ok(directory) = ulak_local::data_directory() {
        let _ = std::fs::create_dir_all(&directory);
        if let Ok(directory) = std::fs::canonicalize(directory) {
            let key = identity::token_hash(&directory.to_string_lossy().to_lowercase());
            context.config_mut().identifier = format!("dev.ulak.desktop.{}", &key[..16]);
        }
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main(app)
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        show_main(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            let directory = ulak_local::data_directory()?;
            let core = Core::open(directory, "Ulak PC")?;
            let network_path = core.0.directory.join("network.json");
            let network = if network_path.exists() {
                if std::fs::metadata(&network_path)?.len() > 65536 {
                    return Err("Network configuration too large".into());
                }
                serde_json::from_reader(std::fs::File::open(network_path)?)?
            } else {
                Network::default()
            };
            let mut events = core.0.events.subscribe();
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    match events.recv().await {
                        Ok(event) => {
                            let _ = handle.emit("transfer", &event);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            });
            app.manage(Runtime {
                core,
                stop: tokio_util::sync::CancellationToken::new(),
                serving: Mutex::new(false),
                server_stop: Mutex::new(None),
                network: Mutex::new(network),
                drag: Mutex::new(None),
                configuration: tokio::sync::Mutex::new(()),
                notice: Mutex::new(None),
                operations: std::sync::Arc::new(tokio::sync::Semaphore::new(64)),
                setup_serving: Mutex::new(false),
                shortcut_available: Mutex::new(false),
            });
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut notified = BTreeSet::new();
                loop {
                    let runtime = handle.state::<Runtime>();
                    if runtime.stop.is_cancelled() {
                        break;
                    }
                    ulak_core::pairing::refresh(&runtime.core).await;
                    let views = runtime.core.pairing_views();
                    notified.retain(|id| views.iter().any(|view| &view.id == id));
                    for view in &views {
                        if view.incoming
                            && view.code.is_some()
                            && view.state == ulak_core::pairing::Status::Comparing
                            && notified.insert(view.id.clone())
                        {
                            show_main(&handle);
                        }
                    }
                    let _ = handle.emit("pairing-changed", ());
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            });
            let runtime = app.state::<Runtime>();
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Ulak")
            .inner_size(1080.0, 720.0)
            .min_inner_size(820.0, 560.0)
            .data_directory(runtime.core.0.directory.join("webview"))
            .build()?;
            use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyU);
            *runtime.shortcut_available.lock().unwrap() =
                app.global_shortcut().register(shortcut).is_ok();
            use tauri::{
                menu::{Menu, MenuItem},
                tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
            };
            let show = MenuItem::with_id(app, "show", "Open Ulak", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Ulak", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .ok_or("Missing application icon")?
                        .clone(),
                )
                .tooltip("Ulak · Local file sharing")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        request_quit(app.clone());
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) && let Some(window) = tray.app_handle().get_webview_window("main")
                    {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                })
                .build(app)?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let runtime = handle.state::<Runtime>();
                match ulak_local::serve(runtime.core.clone(), runtime.stop.clone()) {
                    Ok(task) => {
                        let app = handle.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Ok(Err(error)) = task.await {
                                let _ = app.emit(
                                    "server-error",
                                    format!("Local CLI unavailable: {error:#}"),
                                );
                            }
                        });
                    }
                    Err(error) => {
                        let _ = handle
                            .emit("server-error", format!("Local CLI unavailable: {error:#}"));
                    }
                }
                let config = runtime.network.lock().unwrap().clone();
                if let Err(error) = start_server(
                    runtime,
                    handle.clone(),
                    config.endpoint,
                    config.bind,
                    config.lan,
                    Some(config.advertise),
                    config.onboarding,
                )
                .await
                {
                    *handle.state::<Runtime>().notice.lock().unwrap() = Some(error.clone());
                    let _ = handle.emit("server-error", error);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            local_request,
            pick_sources,
            pick_destination,
            save_public,
            verify_peer,
            presence,
            prepare_drag,
            drag_out,
            stop_server,
            apply_network,
            network_choices,
            quit_app,
            discover,
            start_nearby_pairing,
            decide_nearby_pairing,
            connection_descriptor,
            export_ca,
            start_server,
            add_share,
            set_audience,
            remove_share,
            invitation,
            pair,
            browse,
            download,
            cancel,
            resume,
            unpair,
            rename_device,
            revoke_guest
        ])
        .build(context)
        .expect("Failed to initialize Ulak")
        .run(|handle, event| {
            if let tauri::RunEvent::Exit = event {
                handle.state::<Runtime>().stop.cancel();
            }
        });
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
