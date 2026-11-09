$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $workspace 'target\debug\ulak-desktop.exe'
$cli = Join-Path $workspace 'target\debug\ulak.exe'
if (!(Test-Path -LiteralPath $desktop) -or !(Test-Path -LiteralPath $cli)) { throw 'Build the frontend and Rust workspace first.' }
$fixture = Join-Path $workspace ('.tools\desktop-smoke-' + [guid]::NewGuid().ToString('N'))
$stateDirectory = Join-Path $fixture 'state'
New-Item -ItemType Directory -Force $stateDirectory | Out-Null
function Free-Port {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = $listener.LocalEndpoint.Port
    $listener.Stop()
    return $port
}
$httpsPort = Free-Port
$setupPort = Free-Port
$debugPort = Free-Port
$config = @{ endpoint = "https://127.0.0.1:$httpsPort/"; bind = "127.0.0.1:$httpsPort"; lan = @('127.0.0.1/32'); advertise = $false; onboarding = "127.0.0.1:$setupPort" }
[System.IO.File]::WriteAllText((Join-Path $stateDirectory 'network.json'), ($config | ConvertTo-Json))
$previousData = $env:ULAK_DATA_DIR
$previousBrowserArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
$appProcess = $null
try {
    $env:ULAK_DATA_DIR = $stateDirectory
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$debugPort"
    $env:TEMP = Join-Path $workspace '.tools\tmp'
    $env:TMP = $env:TEMP
    $appProcess = Start-Process -FilePath $desktop -WorkingDirectory $workspace -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $fixture 'stdout.log') -RedirectStandardError (Join-Path $fixture 'stderr.log')
    $null = $appProcess.Handle
    & node (Join-Path $PSScriptRoot 'desktop-smoke.mjs') $debugPort $fixture $cli
    if ($LASTEXITCODE -ne 0) { throw "Desktop smoke failed. See $fixture" }
    if (!$appProcess.WaitForExit(10000)) { throw 'Desktop did not quit after the explicit quit command.' }
    if ($appProcess.ExitCode -ne 0) { throw "Desktop exited with code $($appProcess.ExitCode)." }
    Write-Output "Artifacts: $fixture"
} finally {
    if ($appProcess -and !$appProcess.HasExited) { Stop-Process -Id $appProcess.Id }
    $env:ULAK_DATA_DIR = $previousData
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousBrowserArguments
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
}
