$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'npm.ps1') run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $PSScriptRoot 'cargo.ps1') run -p ulak-desktop
exit $LASTEXITCODE
