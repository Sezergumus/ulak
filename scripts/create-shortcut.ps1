$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$target = Join-Path $workspace 'target\debug\ulak-desktop.exe'
if (!(Test-Path -LiteralPath $target)) { throw 'Build Ulak before creating its shortcut.' }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $workspace 'Ulak.lnk'))
$shortcut.TargetPath = (Get-Command powershell.exe).Source
$shortcut.Arguments = '-NoProfile -WindowStyle Hidden -File "' + (Join-Path $workspace 'scripts\open.ps1') + '"'
$shortcut.WindowStyle = 7
$shortcut.WorkingDirectory = $workspace
$shortcut.IconLocation = (Join-Path $workspace 'src-tauri\icons\icon.ico')
$shortcut.Description = 'Open Ulak'
$shortcut.Save()
Write-Output (Join-Path $workspace 'Ulak.lnk')
