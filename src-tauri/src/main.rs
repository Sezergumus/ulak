#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{collections::BTreeSet, path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager, State};
use ulak_core::{Core, auth::LanPolicy, client::NativeClient, identity, model::*, server};

struct Runtime {
    core: Core,
    stop: tokio_util::sync::CancellationToken,
    serving: Mutex<bool>,
}
type CommandResult<T> = Result<T, String>;
fn error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command]
fn snapshot(runtime: State<Runtime>) -> CommandResult<serde_json::Value> {
    let state = runtime.core.read();
    Ok(
        serde_json::json!({"identity":state.identity,"peers":state.peers,"shares":state.shares,"transfers":runtime.core.checkpoints().map_err(error)?,"serving":*runtime.serving.lock().unwrap()}),
    )
}
#[tauri::command]
async fn start_server(
    runtime: State<'_, Runtime>,
    app: tauri::AppHandle,
    endpoint: String,
    bind: String,
    lan: Vec<String>,
    advertise: Option<bool>,
) -> CommandResult<()> {
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
    let advertisement = if advertise.unwrap_or(false) {
        Some(ulak_core::discovery::Advertisement::start(&core, address, &[ip]).map_err(error)?)
    } else {
        None
    };
    *serving = true;
    tauri::async_runtime::spawn(async move {
        let _advertisement = advertisement;
        if let Err(failure) = server::serve_listener(
            core,
            listener,
            vec![ip, "127.0.0.1".parse().unwrap()],
            LanPolicy { allowed },
            signal,
        )
        .await
        {
            let _ = app.emit("server-error", failure.to_string());
        }
        *app.state::<Runtime>().serving.lock().unwrap() = false;
    });
    Ok(())
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
fn revoke_guest(runtime: State<Runtime>, session: String) -> CommandResult<()> {
    runtime.core.revoke_session(&session).map_err(error)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let directory = std::env::var_os("ULAK_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(std::env::current_dir()?.join(".ulak/desktop"));
            let core = Core::open(directory, "Ulak PC")?;
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
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            discover,
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
            revoke_guest
        ])
        .build(tauri::generate_context!())
        .expect("Failed to initialize Ulak")
        .run(|handle, event| {
            if let tauri::RunEvent::Exit = event {
                handle.state::<Runtime>().stop.cancel();
            }
        });
}
