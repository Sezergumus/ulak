$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $workspace 'target\debug\ulak-desktop.exe'
$cli = Join-Path $workspace 'target\debug\ulak.exe'
$fixture = Join-Path $workspace ('.tools\nearby-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $fixture | Out-Null
function Free-Port {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = $listener.LocalEndpoint.Port
    $listener.Stop()
    return $port
}
$previousData = $env:ULAK_DATA_DIR
$previousArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
$processes = @()
$debugPorts = @()
try {
    $env:TEMP = Join-Path $workspace '.tools\tmp'
    $env:TMP = $env:TEMP
    foreach ($role in @('sender', 'receiver')) {
        $directory = Join-Path $fixture $role
        New-Item -ItemType Directory -Force $directory | Out-Null
        $port = Free-Port
        $debugPort = Free-Port
        $debugPorts += $debugPort
        $network = @{ endpoint = "https://127.0.0.1:$port/"; bind = "127.0.0.1:$port"; lan = @('127.0.0.1/32'); advertise = $false; onboarding = $null }
        [System.IO.File]::WriteAllText((Join-Path $directory 'network.json'), ($network | ConvertTo-Json))
        $env:ULAK_DATA_DIR = $directory
        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$debugPort"
        $process = Start-Process -FilePath $executable -WorkingDirectory $workspace -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $fixture "$role.stdout.log") -RedirectStandardError (Join-Path $fixture "$role.stderr.log")
        $processes += $process
        $ready = $false
        for ($attempt = 0; $attempt -lt 80; $attempt++) {
            try {
                $null = & $cli --data $directory status 2>$null
                if ($LASTEXITCODE -eq 0) { $ready = $true; break }
            } catch { }
            Start-Sleep -Milliseconds 150
        }
        if (!$ready) { throw "$role did not start." }
    }
    & node (Join-Path $PSScriptRoot 'nearby-smoke.mjs') $debugPorts[0] $debugPorts[1] $fixture $executable
    if ($LASTEXITCODE -ne 0) { throw "Nearby pairing smoke failed. See $fixture" }
    Write-Output "Artifacts: $fixture"
} finally {
    foreach ($process in $processes) { if (!$process.HasExited) { Stop-Process -Id $process.Id } }
    $env:ULAK_DATA_DIR = $previousData
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousArguments
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
}
