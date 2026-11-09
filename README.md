# Ulak

Offline file sharing between Windows PCs and local browser guests. Publishers select existing files or folders; recipients browse permitted shares and pull the files they choose. Sources stay in place and are streamed without staging copies or archives.

The implementation contract is [context.md](context.md). See [phase status](docs/phase-status.md), [protocol](docs/protocol.md), and [feasibility checks](docs/feasibility.md).

## Development

Requires Windows, Visual Studio C++ build tools with the Windows SDK, and Rust. The desktop shell also requires the WebView2 runtime. No Node dependency is required for the phase 2 development console; the React product interface belongs to phase 4.

The helper scripts keep the Rust toolchain, Cargo cache, temporary files, state, and build output inside this workspace. They do not modify the system PATH, install certificates, change firewall rules, or write global Git configuration.

```powershell
# Only needed when the workspace-local toolchain has not been initialized.
.\scripts\setup-rust.ps1

.\scripts\cargo.ps1 build --workspace
.\scripts\cargo.ps1 test --workspace
.\scripts\cargo.ps1 clippy --workspace --all-targets '--' -D warnings
.\scripts\cargo.ps1 fmt --all --check
.\scripts\smoke.ps1
```

The development and test profiles omit debug symbols and incremental caches to limit disk consumption. Cargo.lock is committed. Generated toolchain/cache files, application state, and target output are ignored by Git.

## Local sharing example

Run setup commands while that data directory's server is stopped. The diagnostic runner holds an exclusive lock on its state directory; it does not expose management commands over LAN HTTP. Live local management is available through the Tauri commands. The product CLI's named-pipe integration belongs to phase 4.

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

## Desktop development console

```powershell
.\scripts\cargo.ps1 run -p ulak-desktop
```

The Tauri v2 shell hosts the same core and provides a local command console for phases 1–3. It exposes snapshots, server startup, share/audience changes, invitations, pairing, remote browsing, downloads, cancellation, resume, and revocation through Tauri IPC. It is a development surface; sidebar layouts, native pickers, tray lifecycle, and polished product screens belong to phase 4.

Example `start_server` arguments:

```json
{"endpoint":"https://127.0.0.1:7443/","bind":"127.0.0.1:7443","lan":["127.0.0.1/32"]}
```

Example `add_share` arguments:

```json
{"source":"C:\\path\\to\\example.txt","audience":{"kind":"lan"}}
```

The window reads a fresh snapshot on demand and emits throttled transfer events. Persistent Rust state remains authoritative. Runtime state defaults to `.ulak/desktop` under the working directory, or the explicit `ULAK_DATA_DIR` path.

## Limits and guarantees

- Four concurrent served streams, four native downloads, two hash jobs, at most 64 active HTTP handlers, and at most 64 queued/running native download jobs.
- Directory pages inspect at most 100 immediate children per request. Up to 64 server-side directory cursors are kept for 120 seconds of inactivity; native folder traversal refreshes pending cursors during long downloads. Folder traversal uses a bounded stack rather than a complete manifest.
- State collections and transfer history are capped at 4,096 records, with a 32 MiB serialized metadata ceiling. Metadata responses and entry tokens are bounded independently of file size.
- File I/O uses 64 KiB buffers. Native downloads persist flushed offsets, validate byte ranges and source revisions, verify full BLAKE3 content, and finalize without replacing existing files. Explorer and browsers have their own destination and interruption behavior.
- Windows source handles deny concurrent writing/deletion while streaming or hashing. Reparse points and unsafe destination names are rejected. LAN APIs do not expose arbitrary disk paths or management actions.
- Whole-folder browser ZIPs, guest uploads, synchronization, clipboard features, native mobile apps, and other desktop operating systems are outside v1.

These implementation limits do not establish a measured total-process memory target. Real-phone, second-PC, interactive Explorer, disk-exhaustion, and 50 GB acceptance checks must be recorded independently.
