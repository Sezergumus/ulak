$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$agent = Join-Path $workspace 'target\debug\ulak-agent.exe'
if (!(Test-Path -LiteralPath $agent)) { throw 'Build ulak-agent first.' }
$fixture = Join-Path $workspace ('.tools\smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $fixture | Out-Null
$hostData = Join-Path $fixture 'host'
$clientData = Join-Path $fixture 'client'
$source = Join-Path $fixture 'sample.txt'
$descriptor = Join-Path $fixture 'remote.json'
[System.IO.File]::WriteAllText($source, 'Ulak process-to-process HTTPS smoke test.')
$share = & $agent --data $hostData share $source --lan-open | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Share setup failed.' }
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
$endpoint = "https://127.0.0.1:$port/"
& $agent --data $hostData descriptor --endpoint $endpoint --output $descriptor
if ($LASTEXITCODE -ne 0) { throw 'Descriptor export failed.' }
$serverProcess = Start-Process -FilePath $agent -ArgumentList @('--data', "`"$hostData`"", 'serve', '--bind', "127.0.0.1:$port", '--endpoint', $endpoint, '--lan', '127.0.0.1/32') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $fixture 'server.log') -RedirectStandardError (Join-Path $fixture 'server-error.log')
try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        $ErrorActionPreference = 'Continue'
        $null = & $agent --data $clientData ping --remote $descriptor 2>&1
        $probeExitCode = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
        if ($probeExitCode -eq 0) { $ready = $true; break }
        Start-Sleep -Milliseconds 100
    }
    if (!$ready) { throw 'HTTPS server did not become ready.' }
    $entries = & $agent --data $clientData browse --remote $descriptor --share $share.id | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Catalog request failed.' }
    $download = & $agent --data $clientData download --remote $descriptor $share.id $entries.items[0].id (Join-Path $fixture 'downloads') | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $download.state -ne 'completed') { throw 'Download failed.' }
    if ([System.IO.File]::ReadAllText($download.destination) -ne [System.IO.File]::ReadAllText($source)) { throw 'Content mismatch.' }
    Write-Output 'PASS: separate host/client processes, verified HTTPS, LAN-open catalog, streamed download, integrity verification.'
    Write-Output "Artifacts: $fixture"
} finally {
    if (!$serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force }
}
