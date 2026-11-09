use anyhow::{Result, ensure};
use clap::{Parser, Subcommand};
use std::{collections::BTreeSet, path::PathBuf};
use ulak_core::model::{Audience, Remote};
use ulak_local::Request;

#[derive(Parser)]
#[command(about = "Manage the running Ulak desktop through current-user-only local IPC")]
struct Arguments {
    #[arg(long)]
    data: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    Status,
    Share {
        source: PathBuf,
        #[arg(long, conflicts_with = "device")]
        lan: bool,
        #[arg(long)]
        device: Vec<String>,
    },
    Remove {
        share: String,
    },
    List {
        #[arg(long)]
        remote: PathBuf,
        #[arg(long)]
        share: Option<String>,
        #[arg(long)]
        entry: Option<String>,
        #[arg(long)]
        cursor: Option<String>,
    },
    Download {
        #[arg(long)]
        remote: PathBuf,
        #[arg(long)]
        share: String,
        #[arg(long)]
        entry: String,
        #[arg(long)]
        destination: PathBuf,
    },
    DownloadFolder {
        #[arg(long)]
        remote: PathBuf,
        #[arg(long)]
        share: String,
        #[arg(long)]
        entry: Option<String>,
        #[arg(long)]
        destination: PathBuf,
    },
    Resume {
        transfer: String,
    },
    Cancel {
        transfer: String,
    },
}
fn remote(path: &PathBuf) -> Result<Remote> {
    ensure!(
        std::fs::metadata(path)?.len() <= 64 * 1024,
        "Descriptor too large"
    );
    Ok(serde_json::from_reader(std::fs::File::open(path)?)?)
}
#[tokio::main]
async fn main() -> Result<()> {
    let arguments = Arguments::parse();
    let directory = arguments.data.unwrap_or(ulak_local::data_directory()?);
    let request = match arguments.command {
        Command::Status => Request::Snapshot,
        Command::Share {
            source,
            lan,
            device,
        } => Request::Share {
            source: std::fs::canonicalize(source)?,
            audience: if lan {
                Audience::Lan
            } else if device.is_empty() {
                Audience::Private
            } else {
                Audience::Devices {
                    devices: device.into_iter().collect::<BTreeSet<_>>(),
                }
            },
        },
        Command::Remove { share } => Request::Remove { share },
        Command::List {
            remote: path,
            share,
            entry,
            cursor,
        } => Request::List {
            remote: remote(&path)?,
            share,
            entry,
            cursor,
        },
        Command::Download {
            remote: path,
            share,
            entry,
            destination,
        } => Request::Download {
            remote: remote(&path)?,
            share,
            entry,
            destination: std::path::absolute(destination)?,
        },
        Command::DownloadFolder {
            remote: path,
            share,
            entry,
            destination,
        } => Request::Folder {
            remote: remote(&path)?,
            share,
            entry,
            destination: std::path::absolute(destination)?,
        },
        Command::Resume { transfer } => Request::Resume { transfer },
        Command::Cancel { transfer } => Request::Cancel { transfer },
    };
    #[cfg(windows)]
    println!(
        "{}",
        serde_json::to_string_pretty(&ulak_local::connect(&directory, request).await?)?
    );
    #[cfg(not(windows))]
    {
        let _ = (directory, request);
        anyhow::bail!("Local CLI IPC requires Windows");
    }
    Ok(())
}
