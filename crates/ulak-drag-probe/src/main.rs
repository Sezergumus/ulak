#[cfg(windows)]
mod windows_probe;
use anyhow::Result;
use clap::Parser;
use std::path::PathBuf;

#[derive(Parser)]
#[command(about = "Windows virtual-file drag feasibility probe; no source staging")]
struct Arguments {
    #[arg(long, default_value = ".ulak/probe")]
    data: PathBuf,
    #[arg(long)]
    remote: PathBuf,
    #[arg(long)]
    share: String,
    #[arg(long, required = true)]
    entry: Vec<String>,
}
fn main() -> Result<()> {
    let arguments = Arguments::parse();
    #[cfg(windows)]
    {
        windows_probe::run(arguments)
    }
    #[cfg(not(windows))]
    {
        let _ = arguments;
        anyhow::bail!("This feasibility probe requires Windows")
    }
}
