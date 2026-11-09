# Feasibility prototypes

## Offline trusted HTTPS

The agent can expose a standalone public certificate-onboarding listener and an HTTPS-only read interface with locally bundled HTML/JavaScript. The HTTPS prototype supports LAN-open shares, guest invitation redemption, paginated folder browsing, and ordinary browser-managed individual file downloads. It never buffers entire files into JavaScript Blobs and makes no external asset requests.

Run a host on the intended LAN interface:

```powershell
.\target\debug\ulak-agent.exe --data .ulak/host serve --bind 192.168.1.10:7443 --endpoint https://192.168.1.10:7443/ --certificate-ip 192.168.1.10 --lan 192.168.1.0/24 --onboarding 192.168.1.10:7442 --advertise
```

Use actual reachable host/network addresses. Open the public setup page from a phone, compare the public CA fingerprint with the host, install the certificate manually, and then open the HTTPS origin. On iOS, explicitly enable full certificate trust after profile installation. The prototype does not install trust, alter firewall settings, or bypass browser warnings automatically.

Record the phone model, OS/browser versions, Wi-Fi configuration, whether internet was disabled, certificate steps, folder browsing, individual downloads, invitation redemption/revocation, and interruption behavior. Verify that the plaintext server never serves share content.

References: [Apple certificate trust instructions](https://support.apple.com/en-us/102390), [rcgen](https://docs.rs/rcgen/0.13.2/rcgen/), [axum-server TLS](https://docs.rs/axum-server/0.7.3/axum_server/tls_rustls/).

## Windows Explorer virtual-file streaming

The separate `ulak-drag-probe` executable exposes `FileGroupDescriptorW` metadata through `IDataObject` and one lazy `IStream` per selected remote file through `FileContents`. Reads use authenticated HTTPS ranges of at most 64 KiB with revision/response validation. Seeking and cloning do not stage files. The source is not fully downloaded before drag initiation.

```powershell
.\target\debug\ulak-drag-probe.exe --data .ulak/probe --remote .\host-remote.json --share SHARE_ID --entry ENTRY_ID --entry ANOTHER_ENTRY_ID
```

This explicit command opens an interactive test window. Drag from its client area into an Explorer folder. Explorer owns target writing, naming, progress, and cleanup. Escape cancels the initial drag; COM read failures report network/source errors. Browser-style full-file integrity finalization and checkpointed native resume are not claimed for Explorer.

Automated COM tests validate metadata size, lazy stream creation, invalid indices, independent clone positions, seeking, and actual HTTPS range reads including source-change rejection. They do not establish Explorer interoperability.

Interactive checks still require a human-operated Explorer drop: one file, multiple files, a large file, destination collision, seeking, cancelling the Explorer copy after drop, losing the network mid-copy, and changing the source between requests. Record whether Explorer requests asynchronous operation support and its observed progress/error/cleanup behavior. Product drag integration is phase 4; this executable is the phase 1 feasibility surface.

Reference: [Microsoft Shell clipboard formats and virtual-file transfer](https://learn.microsoft.com/en-us/windows/win32/shell/clipboard).

## Large-transfer acceptance

Use actual files and destinations on appropriate storage. Run the ignored large-transfer test with `ULAK_LARGE_TEST_BYTES=50000000000` only when at least 100 GB of workspace storage is available for generated source and destination. The fixture is generated with bounded writes; native transfer adds no staging copy. Measure core transfer process memory separately from WebView/desktop memory and compare multiple source sizes. Record concurrency and cancellation behavior.

```powershell
$env:ULAK_LARGE_TEST_BYTES = '50000000000'
.\scripts\cargo.ps1 test -p ulak-core --test transfers large_transfer_uses_bounded_generation_and_streaming '--' --ignored --nocapture
```

Do not label a 50 GB transfer, physical second-PC connectivity, or phone compatibility passed based solely on localhost tests or code review.
