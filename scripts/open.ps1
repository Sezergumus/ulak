$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $workspace 'target\debug\ulak-desktop.exe'
if (!(Test-Path -LiteralPath $executable)) { throw 'Build Ulak first with scripts\desktop.ps1.' }
Start-Process -FilePath $executable -WorkingDirectory $workspace -WindowStyle Hidden
