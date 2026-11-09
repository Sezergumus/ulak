$NpmArguments = $args
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$env:npm_config_cache = Join-Path $workspace '.tools\npm-cache'
$env:TEMP = Join-Path $workspace '.tools\tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
Push-Location $workspace
try { & npm.cmd @NpmArguments; $npmExitCode = $LASTEXITCODE }
finally { Pop-Location }
exit $npmExitCode
