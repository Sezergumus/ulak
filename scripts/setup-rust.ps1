$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $workspace '.tools'
$env:CARGO_HOME = Join-Path $tools 'cargo'
$env:RUSTUP_HOME = Join-Path $tools 'rustup'
$env:TEMP = Join-Path $tools 'tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $tools, $env:TEMP | Out-Null
$installer = Join-Path $tools 'rustup-init.exe'
if (!(Test-Path -LiteralPath $installer)) {
    Invoke-WebRequest -Uri 'https://win.rustup.rs/x86_64' -OutFile $installer
}
& $installer -y --no-modify-path --profile minimal --default-toolchain stable
if ($LASTEXITCODE -ne 0) { throw 'Workspace Rust setup failed.' }
& (Join-Path $env:CARGO_HOME 'bin\rustup.exe') component add rustfmt clippy
if ($LASTEXITCODE -ne 0) { throw 'Rust component setup failed.' }
