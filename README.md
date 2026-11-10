# Ulak

Offline file sharing between Windows PCs and local browser guests. Publishers select existing files or folders; recipients browse permitted shares and pull the files they choose. Sources stay in place and are streamed without staging copies or archives.

The implementation contract is [context.md](context.md). See [phase status](docs/phase-status.md), [protocol](docs/protocol.md), and [feasibility checks](docs/feasibility.md).

## Development

Requires Windows, Visual Studio C++ build tools with the Windows SDK, Rust, and Node.js 22.12 or newer. The desktop shell also requires the WebView2 runtime. The desktop uses React 19, TypeScript, Vite, Tailwind, Radix-based UI controls, Lucide, Zustand, and locally bundled QR rendering.

The helper scripts keep the Rust toolchain, Cargo cache, temporary files, state, and build output inside this workspace. They do not modify the system PATH, install certificates, change firewall rules, or write global Git configuration.

```powershell
# Only needed when the workspace-local toolchain has not been initialized.
.\scripts\setup-rust.ps1

.\scripts\npm.ps1 ci
.\scripts\npm.ps1 run build
.\scripts\npm.ps1 test
.\scripts\cargo.ps1 build --workspace
.\scripts\cargo.ps1 test --workspace
.\scripts\cargo.ps1 clippy --workspace --all-targets '--' -D warnings
.\scripts\cargo.ps1 fmt --all --check
.\scripts\smoke.ps1
.\scripts\desktop-smoke.ps1
```

The development and test profiles omit debug symbols and incremental caches to limit disk consumption. Both dependency lockfiles are committed. The npm and Rust wrappers keep caches and temporary files inside the workspace. WebView data is stored inside the selected state directory. Generated caches, application state, frontend assets, and target output are ignored by Git. Rebuild the frontend before compiling the desktop; the normal executable embeds the production assets and needs no development server.

## Local sharing example

Run these diagnostic setup commands while that data directory's server is stopped. The diagnostic runner holds an exclusive lock on its state directory; it does not expose management commands over LAN HTTP. Use the desktop or product CLI below for live local management.

```powershell
# Use two different state directories to simulate two PCs on this machine.
$agent = '.\target\debug\ulak-agent.exe'
& $agent --data .ulak/host share C:\path\to\example.txt --lan-open
& $agent --data .ulak/host descriptor --endpoint https://127.0.0.1:7443/ --output .\host-remote.json
& $agent --data .ulak/host serve --bind 127.0.0.1:7443 --endpoint https://127.0.0.1:7443/ --lan 127.0.0.1/32

# In a second terminal:
& $agent --data .ulak/recipient ping --remote .\host-remote.json
& $agent --data .ulak/recipient browse --remote .\host-remote.json
& $agent --data .ulak/recipient browse --remote .\host-remote.json --share SHARE_ID
& $agent --data .ulak/recipient download --remote .\host-remote.json SHARE_ID ENTRY_ID .\downloads
& $agent --data .ulak/recipient snapshot
& $agent --data .ulak/recipient resume --remote .\host-remote.json TRANSFER_ID
```

Replace example source paths with files explicitly selected for sharing. A remote descriptor contains public connection information and the host's public CA, and must be obtained from the intended host through a trusted exchange. It grants no restricted-share permission.

For actual LAN use, bind to the intended interface, advertise its reachable HTTPS origin, include its address with `--certificate-ip`, and explicitly set the permitted network with `--lan`, for example `192.168.1.0/24`. `--advertise` enables mDNS. LAN-open access is denied when no allowed LAN ranges are configured. Loopback ranges in examples are test configuration, not automatic production defaults.

## Restricted devices and guests

`serve --pair-invite` prints a five-minute, single-use pairing descriptor. On the recipient, run `pair INVITATION --endpoint RECIPIENT_HTTPS_ORIGIN`. This proves the recipient's identity, records mutual trust, and does not automatically grant access to every share. Grant a share to persisted peer IDs with `audience SHARE_ID --device DEVICE_ID`; offline peers remain valid recipients.

`invite --guest-share SHARE_ID` creates an invitation scoped to the listed shares. Its descriptor contains the single-use token. The browser feasibility page accepts that token and stores the redeemed session in a Secure, HttpOnly, SameSite cookie. Sessions expire after 30 minutes of inactivity or eight hours total and can be revoked by the publisher. LAN-open shares need neither pairing nor invitation.

Optional `serve --onboarding ADDRESS:PORT` runs a separate plaintext setup server exposing only instructions and the public CA certificate. Compare the displayed CA fingerprint against the host before installing it. Shared content is available only over trusted HTTPS. Device certificate installation is manual; a QR code or invitation cannot bypass it.

## Desktop application

```powershell
.\scripts\desktop.ps1
```

The compact desktop opens on Devices, with My shares and Transfers in the sidebar, a selected-item detail panel, and a persistent transfer status area. `Ctrl+K` opens contextual commands. Paired devices remain visible and selectable while offline; live discovery appears separately and does not establish trust. Reachability is checked through signed identity verification, including stored endpoints when multicast is unavailable.

For first-time desktop setup:

1. Open **Connection settings**, choose the Wi-Fi or Ethernet connection under **Share over**, and select **Apply settings**. Windows supplies the actual address and subnet; the application does not assume a `/24` network. Each share keeps its own access permissions.
2. On one computer, open **Connect a device → Create an invitation**, then copy the invitation directly to the intended computer.
3. On the other computer, open **Connect a device → I have an invitation**, paste it, and select **Connect**. Invitations work once and expire after five minutes. Native certificate and identity verification remain automatic.
4. In **My shares**, choose the files and devices that can access them. Connecting a device does not automatically grant it access to private shares.

Discovery runs when the desktop opens, when its window regains focus, and every 30 seconds. It looks for Ulak advertisements on the local network, rather than scanning all computers, phones, or Wi-Fi networks. The initial loopback configuration cannot be reached by other devices; a first-run notice explains this and opens network setup. Selecting a connection proposes interface-specific listening, the real subnet, and mDNS advertising; nothing changes until Apply settings. IPv6, VPN, and other custom connections remain configurable through Advanced settings.

Use Add share, Add folder, or an Explorer drop to select sources, then explicitly choose Invitation only, Choose devices, or Everyone on the local network. The audience picker keeps offline peers enabled. Share details offer guest invitations, QR codes, security certificate export/code comparison, ending guest access, audience changes, and removal. Each multi-source publication is persisted independently; a failure shows the error and preserves the successful subset for retry.

Connection settings offer a network picker, device name, and optional browser setup page. Advanced settings retain the advertised HTTPS origin, listen address, allowed network ranges, public certificate setup listener, and mDNS preference. The initial service binds only to `127.0.0.1:7443`. Invalid settings are rejected before stopping the listener; bind failures attempt to restore the previous configuration. No firewall or certificate trust settings are changed automatically. The certificate fingerprint is called **Security code for browser setup** in the product and is needed for manual browser trust setup, rather than native PC pairing.

Browse a paired device, or use **Connect a device → Browse without adding a device** and paste trusted connection details to browse LAN-open shares. The host saves those details from Connection settings → Advanced settings. Selecting a discovered device carries its identity into the dialog; an invitation or public connection record for a different identity is rejected before any connection attempt. Discovery still does not establish trust. Remote directory pages remain bounded. Native downloads use the destination picker; folders preserve their hierarchy. Select up to four files per desktop batch. Preparation occurs before a per-file checkpoint exists, then core-owned queue/state snapshots and events expose progress, verification, completion, cancellation, and explicit resume. Closing or reloading the view does not become transfer authority. Folder orchestration is not persisted as a separate job; per-file checkpoints remain resumable.

For Explorer drag-out, select remote files, choose **Get ready to drag**, then drag from the displayed handle while holding the left button. This prepares metadata and lazily supplies range-backed COM streams without downloading complete files first. Folders use the native downloader instead. Actual Explorer copy/progress/cancellation interoperability still needs interactive acceptance testing.

Closing the main window hides it while the service remains active. Use the tray's Open Ulak action to reopen it and Quit Ulak to stop it. The command menu also provides Hide to tray and Quit Ulak. Runtime state defaults to `.ulak/desktop` under the working directory, or the explicit `ULAK_DATA_DIR` path. Keep project runs and their selected test destinations inside this workspace.

`scripts/desktop-smoke.ps1` starts an isolated real WebView instance with temporary local debugging, exercises the production UI and live CLI, captures screenshots under `.tools`, checks close-to-tray service continuity and programmatic reopening, and explicitly quits its own process. It also tests invalid network settings and rollback after an occupied-port failure. This does not exercise native picker interactions, actual Explorer drops, or clicking the tray icon/menu.

## Live local CLI

The `ulak` product CLI connects to the running desktop through a Windows named pipe scoped to the canonical data directory and current-user SID. Its protected DACL grants only that user access; remote pipe clients are rejected. The server accepts at most eight live requests, limits request/response frames, and exposes no LAN or localhost management endpoint. The CLI does not open or lock the desktop's private state.

```powershell
$ulak = '.\target\debug\ulak.exe'
& $ulak status
& $ulak share '.\selected-file.txt' --lan
& $ulak share '.\selected-folder' --device PAIRED_DEVICE_ID
& $ulak list --remote '.\trusted-connection.json'
& $ulak list --remote '.\trusted-connection.json' --share SHARE_ID
& $ulak download --remote '.\trusted-connection.json' --share SHARE_ID --entry ENTRY_ID --destination '.\downloads'
& $ulak download-folder --remote '.\trusted-connection.json' --share SHARE_ID --destination '.\downloads\folder'
& $ulak cancel TRANSFER_ID
& $ulak resume TRANSFER_ID
& $ulak remove SHARE_ID
```

Without `--lan` or `--device`, a new share is private. Use `--data` before the subcommand when the desktop uses a different workspace-contained state directory. Download commands wait for their verified result. Closing the CLI alone does not cancel a dispatched transfer; use the explicit cancel command. Export a public connection descriptor from Connection settings and exchange it with the intended recipient through a trusted channel.

## Limits and guarantees

- Four concurrent served streams, four native downloads, two hash jobs, at most 64 active HTTP handlers, and at most 64 queued/running native download jobs.
- Directory pages inspect at most 100 immediate children per request. Up to 64 server-side directory cursors are kept for 120 seconds of inactivity; native folder traversal refreshes pending cursors during long downloads. Folder traversal uses a bounded stack rather than a complete manifest.
- State collections and transfer history are capped at 4,096 records, with a 32 MiB serialized metadata ceiling. Metadata responses and entry tokens are bounded independently of file size.
- File I/O uses 64 KiB buffers. Native downloads persist flushed offsets, validate byte ranges and source revisions, verify full BLAKE3 content, and finalize without replacing existing files. Explorer and browsers have their own destination and interruption behavior.
- Windows source handles deny concurrent writing/deletion while streaming or hashing. Reparse points and unsafe destination names are rejected. LAN APIs do not expose arbitrary disk paths or management actions.
- Whole-folder browser ZIPs, guest uploads, synchronization, clipboard features, native mobile apps, and other desktop operating systems are outside v1.

These implementation limits do not establish a measured total-process memory target. Real-phone, second-PC, interactive Explorer, disk-exhaustion, and 50 GB acceptance checks must be recorded independently.
