use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use ipnet::IpNet;
use std::{
    collections::BTreeSet,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    time::Duration,
};
use tokio_util::sync::CancellationToken;
use ulak_core::{
    Core, auth::LanPolicy, client::NativeClient, discovery, identity, model::*, server,
};

#[derive(Parser)]
#[command(version, about = "Offline LAN sharing core and feasibility runner")]
struct Arguments {
    #[arg(long, default_value = ".ulak/agent")]
    data: PathBuf,
    #[arg(long, default_value = "Ulak PC")]
    name: String,
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    /// Run HTTPS; optional plaintext onboarding serves public setup materials only.
    Serve {
        #[arg(long, default_value = "127.0.0.1:7443")]
        bind: SocketAddr,
        #[arg(long, default_value = "https://127.0.0.1:7443/")]
        endpoint: String,
        #[arg(long)]
        certificate_ip: Vec<IpAddr>,
        #[arg(long)]
        lan: Vec<IpNet>,
        #[arg(long)]
        onboarding: Option<SocketAddr>,
        #[arg(long)]
        pair_invite: bool,
        #[arg(long)]
        advertise: bool,
    },
    /// Export a public descriptor for manual connections; it grants no private access.
    Descriptor {
        #[arg(long, default_value = "https://127.0.0.1:7443/")]
        endpoint: String,
        #[arg(long)]
        output: PathBuf,
    },
    ExportCa {
        output: PathBuf,
    },
    /// Local setup operation; stop the agent first or use the desktop commands.
    Share {
        source: PathBuf,
        #[arg(long)]
        lan_open: bool,
        #[arg(long)]
        device: Vec<String>,
    },
    Audience {
        share: String,
        #[arg(long)]
        lan_open: bool,
        #[arg(long)]
        device: Vec<String>,
    },
    RemoveShare {
        share: String,
    },
    Snapshot,
    Pair {
        invitation: String,
        #[arg(long, default_value = "https://127.0.0.1:7444/")]
        endpoint: String,
    },
    Invite {
        #[arg(long, default_value = "https://127.0.0.1:7443/")]
        endpoint: String,
        #[arg(long)]
        guest_share: Vec<String>,
    },
    Unpair {
        device: String,
    },
    RevokeGuest {
        session: String,
    },
    Discover {
        #[arg(long, default_value_t = 5)]
        seconds: u64,
    },
    Ping {
        remote: PathBuf,
    },
    Browse {
        remote: PathBuf,
        #[arg(long)]
        share: Option<String>,
        #[arg(long)]
        entry: Option<String>,
        #[arg(long)]
        cursor: Option<String>,
    },
    Download {
        remote: PathBuf,
        share: String,
        entry: String,
        destination: PathBuf,
    },
    DownloadFolder {
        remote: PathBuf,
        share: String,
        destination: PathBuf,
        #[arg(long)]
        entry: Option<String>,
    },
    Resume {
        remote: PathBuf,
        transfer: String,
    },
}
fn audience(lan: bool, devices: Vec<String>) -> Result<Audience> {
    if lan && !devices.is_empty() {
        bail!("Choose --lan-open or --device, not both");
    }
    Ok(if lan {
        Audience::Lan
    } else if devices.is_empty() {
        Audience::Private
    } else {
        Audience::Devices {
            devices: devices.into_iter().collect(),
        }
    })
}
fn print(value: &impl serde::Serialize) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}
fn remote(path: &PathBuf) -> Result<Remote> {
    anyhow::ensure!(
        std::fs::metadata(path)?.len() < 32 * 1024,
        "Descriptor too large"
    );
    Ok(serde_json::from_reader(std::fs::File::open(path)?)?)
}
fn cancellation() -> CancellationToken {
    let token = CancellationToken::new();
    let signal = token.clone();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        signal.cancel();
    });
    token
}
#[tokio::main]
async fn main() -> Result<()> {
    let arguments = Arguments::parse();
    let core = Core::open(&arguments.data, &arguments.name)?;
    match arguments.command {
        Command::Serve {
            bind,
            endpoint,
            mut certificate_ip,
            lan,
            onboarding,
            pair_invite,
            advertise,
        } => {
            let descriptor = core.descriptor(&endpoint)?;
            let url = reqwest::Url::parse(&endpoint)?;
            certificate_ip.push(url.host_str().unwrap().trim_matches(['[', ']']).parse()?);
            certificate_ip.push("127.0.0.1".parse()?);
            certificate_ip.sort();
            certificate_ip.dedup();
            // The data directory is owner-only; public export is an explicit action.
            ulak_core::storage::atomic_json(&core.0.directory.join("remote.json"), &descriptor)?;
            println!("HTTPS: {endpoint}");
            println!(
                "CA fingerprint: {}",
                identity::token_hash(&core.read().ca_pem)
            );
            if pair_invite {
                println!(
                    "Pair invitation (single use, 5 minutes): {}",
                    identity::encode_descriptor(&core.invite(&endpoint, None)?)?
                );
            }
            let _advertisement = if advertise {
                Some(discovery::Advertisement::start(
                    &core,
                    bind,
                    &certificate_ip,
                )?)
            } else {
                None
            };
            let stop = cancellation();
            let setup_task = if let Some(address) = onboarding {
                let listener = tokio::net::TcpListener::bind(address).await?;
                let router = server::onboarding_router(core.clone());
                let signal = stop.clone();
                println!("Public certificate setup only: http://{address}");
                Some(tokio::spawn(async move {
                    axum::serve(listener, router)
                        .with_graceful_shutdown(signal.cancelled_owned())
                        .await
                }))
            } else {
                None
            };
            let result = server::serve(
                core,
                bind,
                certificate_ip,
                LanPolicy { allowed: lan },
                stop.clone(),
            )
            .await;
            stop.cancel();
            if let Some(task) = setup_task {
                task.await??;
            }
            result?;
        }
        Command::Descriptor { endpoint, output } => {
            ulak_core::storage::atomic_json(&output, &core.descriptor(&endpoint)?)?
        }
        Command::ExportCa { output } => std::fs::write(output, core.read().ca_pem)?,
        Command::Share {
            source,
            lan_open,
            device,
        } => print(&core.add_share(&source, audience(lan_open, device)?)?)?,
        Command::Audience {
            share,
            lan_open,
            device,
        } => core.set_audience(&share, audience(lan_open, device)?)?,
        Command::RemoveShare { share } => core.remove_share(&share)?,
        Command::Snapshot => {
            let state = core.read();
            print(
                &serde_json::json!({"identity": state.identity, "peers": state.peers, "shares": state.shares, "transfers": core.checkpoints()?, "guest_sessions": state.sessions.values().map(|s| serde_json::json!({"id":s.id,"shares":s.shares,"last_used":s.last_used})).collect::<Vec<_>>()}),
            )?;
        }
        Command::Pair {
            invitation,
            endpoint,
        } => print(
            &NativeClient::pair(core, identity::decode_descriptor(&invitation)?, &endpoint).await?,
        )?,
        Command::Invite {
            endpoint,
            guest_share,
        } => {
            let shares =
                (!guest_share.is_empty()).then(|| guest_share.into_iter().collect::<BTreeSet<_>>());
            println!(
                "{}",
                identity::encode_descriptor(&core.invite(&endpoint, shares)?)?
            );
        }
        Command::Unpair { device } => core.revoke_peer(&device)?,
        Command::RevokeGuest { session } => core.revoke_session(&session)?,
        Command::Discover { seconds } => {
            print(&discovery::browse(&core, Duration::from_secs(seconds)).await?)?
        }
        Command::Ping { remote: path } => {
            print(&NativeClient::new(core, remote(&path)?)?.verify().await?)?
        }
        Command::Browse {
            remote: path,
            share,
            entry,
            cursor,
        } => {
            let client = NativeClient::new(core, remote(&path)?)?;
            client.verify().await?;
            if let Some(share) = share {
                print(
                    &client
                        .entries(&share, entry.as_deref(), cursor.as_deref())
                        .await?,
                )?;
            } else {
                print(&client.shares(cursor.as_deref()).await?)?;
            }
        }
        Command::Download {
            remote: path,
            share,
            entry,
            destination,
        } => {
            let client = NativeClient::new(core.clone(), remote(&path)?)?;
            client.verify().await?;
            let info = client.prepare(&share, &entry).await?;
            print(
                &core
                    .download(
                        client,
                        info,
                        &std::path::absolute(destination)?,
                        cancellation(),
                    )
                    .await?,
            )?;
        }
        Command::DownloadFolder {
            remote: path,
            share,
            destination,
            entry,
        } => {
            let client = NativeClient::new(core.clone(), remote(&path)?)?;
            client.verify().await?;
            let count = core
                .download_folder(
                    client,
                    &share,
                    entry.as_deref(),
                    &std::path::absolute(destination)?,
                    cancellation(),
                )
                .await?;
            println!("Downloaded and verified {count} files");
        }
        Command::Resume {
            remote: path,
            transfer,
        } => {
            let client = NativeClient::new(core.clone(), remote(&path)?)?;
            print(
                &core
                    .resume(client, &transfer, cancellation())
                    .await
                    .context("Cannot resume transfer")?,
            )?;
        }
    }
    Ok(())
}
