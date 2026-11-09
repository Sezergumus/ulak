$CargoArguments = $args
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$env:CARGO_HOME = Join-Path $workspace '.tools\cargo'
$env:RUSTUP_HOME = Join-Path $workspace '.tools\rustup'
$env:TEMP = Join-Path $workspace '.tools\tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
$env:PATH = (Join-Path $env:CARGO_HOME 'bin') + ';' + $env:PATH
$cargoExecutable = Join-Path $env:CARGO_HOME 'bin\cargo.exe'
if (!(Test-Path -LiteralPath $cargoExecutable)) {
    throw 'Install a workspace-local Rust toolchain under .tools first; see README.md.'
}
Push-Location $workspace
try { & $cargoExecutable @CargoArguments; $cargoExitCode = $LASTEXITCODE }
finally { Pop-Location }
exit $cargoExitCode

