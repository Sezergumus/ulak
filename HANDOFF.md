# Session handoff

Recorded on 2026-11-09 for continuation in a new conversation.

## Workspace and collaboration preferences

- Workspace: `D:\Antigravity Workspaces\ulak`; shell: PowerShell; user timezone: Europe/Istanbul.
- All changes must stay inside this workspace, including tooling, temporary files, test fixtures, caches, and build output. Do not install system software, change certificate trust/firewall rules, modify global Git settings, or write elsewhere as part of project work.
- The user installed system Rust during the session. A separate workspace-local Rust 1.99.1 toolchain is already available in `.tools`; continue using the wrapper scripts to contain generated files.
- All source comments, documentation, and commit messages must be English. Conversation with the user has been Turkish. Do not add tool/model or authoring-process attribution to project text or history.
- Git was initialized at the user's request. Commit meaningful verified chunks separately. The earlier specification title was corrected throughout local history; preserve the corrected wording when editing documents.
- No remote was configured or publication performed. Inspect current Git status and remotes before assuming this remains true.

## Product and agreed design

Ulak is an open-source, offline local-network file-sharing application, initially for Windows. A publisher selects existing files/folders; recipients browse authorized content and pull selected files. Publishing is not a push, upload, copy, or synchronization operation.

The desktop now implements the agreed Raycast-inspired direction: compact resizable dark window, graphite surfaces, off-white text, restrained amber accent, thin borders, aligned list rows, and a selected-item detail panel. Devices, My shares, and Transfers occupy the narrow sidebar; Add share, native file/folder pickers, Explorer drop-in, `Ctrl+K` commands, and a persistent transfer status area are connected to the core. All frontend assets are bundled locally.

Devices are persistent paired identities, not IP addresses. Offline paired PCs remain visible with last connection information and remain selectable as share recipients. Newly discovered unpaired devices appear separately. Display Offline rather than claiming to know a PC is powered off. An Ethernet cable alone does not make a powered-off, sleeping, or stopped peer reachable. A changed IP/interface must update the same verified identity, preserving trust and permissions; lost installation identity keys require pairing again.

Share access includes selected paired devices, scoped guest sessions, and the user's explicitly requested **Everyone on the local network** option. LAN-open shares permit unpaired native/browser readers within configured allowed network ranges without invitations. They do not grant access to private shares or management operations. Selecting all currently paired devices is distinct from opening a share to the LAN. Offline grants persist until the recipient and publisher are reachable; they do not queue automatic delivery.

## Scope and phase status

The user explicitly requested phase 4 in this continuation after the first three phases. Code for phases 1–4 is present; hardware-dependent validation remains open. Do not describe the whole application or all acceptance criteria as completed.

1. Feasibility: bundled browser HTTPS/public-CA onboarding prototype and Windows OLE virtual-file drag probe are implemented. Phone trust/onboarding and actual Explorer drops still need testing.
2. Trusted core: Rust workspace, Tauri v2 development shell, persistent identity/local CA, authenticated pairing/revocation, signed challenge verification, mDNS candidates/advertisement, verified known-peer endpoint refresh, manual connection descriptors, and protocol negotiation are implemented.
3. Sharing/downloads: explicit audiences, guest sessions, opaque entries, bounded directory pages and native folder traversal, locked source streaming, HTTP ranges, durable download checkpoints, cancellation/resume, BLAKE3 verification, no-replace finalization, and recovery after a rename/checkpoint crash are implemented.
4. Desktop integration: the React product UI, offline device audience picker, native picker commands, transfer snapshots/events, guest controls, persistent network settings, close-to-tray lifecycle, Explorer drag handle using the shared COM implementation, and protected named-pipe CLI are implemented. Real WebView/CLI smoke checks passed. Native dialog interactions, actual Explorer drops, and tray mouse/menu checks remain pending.
5. Guest release polish and release validation remain later work and have not been requested. The guest interface supports fragment-based invitation links from the desktop, but phone trust/onboarding and offline browser acceptance remain open.

Deferred v1 features remain deferred: clipboard functionality, automatic synchronization, compression/ZIP creation, guest uploads, whole-folder browser downloads, native mobile apps, non-Windows desktop agents, and dragging complete remote folders into Explorer.

## Repository map

- `context.md`: architecture and UX implementation contract.
- `README.md`: development setup, commands, examples, limits.
- `docs/phase-status.md`: executed validation versus pending physical checks.
- `docs/protocol.md`: TLS/identity, API, audience rules, download lifecycle.
- `docs/feasibility.md`: phone certificate setup, Explorer probe, large-file test procedures.
- `crates/ulak-core`: reusable Rust identity, persistence, auth, catalog, TLS server, native client, discovery, download engine.
- `crates/ulak-agent`: diagnostic executable and local setup/transfer commands.
- `crates/ulak-local`: shared local request dispatcher, secret-free snapshots, bounded frame codec, and current-user-only Windows named-pipe server/client.
- `crates/ulak-cli`: product `ulak` executable; manages the running desktop without taking its state lock.
- `crates/ulak-drag-probe`: separate Windows OLE interactive feasibility executable.
- `crates/ulak-drag-probe/src/virtual_files.rs`: shared virtual-file implementation used by both the probe and desktop, including existing COM tests.
- `src-tauri`: Tauri v2 shell, protected local management service, native dialogs, tray lifecycle, and product drag integration.
- `src`: React 19 desktop, Radix-based controls, Tailwind styles, Zustand snapshot/event state, QR rendering, and interaction tests.
- `desktop`: historical static console; no longer loaded by the application.
- `guest`: bundled local-only HTML/JavaScript browser prototype.
- `scripts`: workspace-contained Rust setup/runner and process-level smoke test.
- `.tools`, `target`, `.ulak`: ignored local tooling, build output, runtime/test state. No file content is staged for publication there.

## Implementation details to preserve

- Persistent Ed25519 identity is independent of IP/name. Native clients trust the explicitly exchanged host CA, verify TLS/IP and fresh signed server challenges, and use signed read requests with bounded replay protection. Discovery alone is untrusted.
- State is owner-protected, exclusively process-locked, and atomically persisted. Restricted device grants and guest sessions are server-authoritative; no network management API is exposed.
- LAN-open access uses actual socket source addresses and explicit allowed ranges, not forwarded headers or mere reachability. TLS/server verification still applies. Plain HTTP exposes public certificate setup only.
- Catalog entries are encrypted opaque tokens bound to shares. Reject path traversal, unsafe Windows names, and reparse-point escapes. Remote catalog responses do not expose absolute source paths.
- Fixed 64 KiB I/O buffers, four served streams, four native downloads, two hashing jobs, 64 queued/running downloads, 64 active HTTP handlers, and bounded metadata/history collections. Do not claim a measured total-process RAM target.
- Windows source file handles deny writes/deletion. Directory handles allow child updates while denying directory relocation; denying directory writes previously broke final rename and was fixed/tested.
- Resume uses flushed checkpoint offsets, truncates uncheckpointed tails, checks source revision/range responses, verifies the complete file, and finalizes without overwriting. Persist the selected final target before rename to support post-rename crash recovery.
- Native folder traversal refreshes pending directory cursors during long file downloads and preserves empty directories. Per-file checkpoints persist; an entire folder job is not separately persisted for automatic orchestration recovery.
- Browser downloads are browser-managed, with no whole-file Blob buffering. Explorer uses lazy range-backed COM streams, supports seeking/cloning, and owns destination handling. Neither path inherits all native downloader guarantees.
- The diagnostic CLI still locks its state directory; run its setup mutations with that server stopped. The product CLI connects to the running desktop over a named pipe keyed by canonical data path and current-user SID. A protected current-user DACL, remote-client rejection, eight live-request slots, bounded frames, and read/write deadlines protect local management. No network management route was added.
- The desktop starts with loopback-only HTTPS on port 7443. Connection settings persist the device name, advertised IP origin, bind address, allowed ranges, mDNS, and optional public HTTP trust-setup listener. Applying invalid settings preserves the listener; a failed bind attempts to restore prior settings. Private keys and invitation/session hashes are excluded from frontend/CLI snapshots.
- Desktop transfer views refresh from core snapshots and subscribe to throttled events. A newer event wins over an older in-flight snapshot. Preparation precedes per-file checkpoints; folder orchestration remains in memory. The desktop submits up to four selected files per batch and bounds pending local operations. Explicit cancellation preserves checkpoints; closing the CLI alone does not cancel a request already dispatched.
- Explorer drag-out has a separate metadata preparation action and a native drag handle. It supplies lazy range-backed streams and reports failures; actual Explorer interaction is still unverified. Explorer remains responsible for destination writing, naming, and cleanup.
- The WebView profile, npm cache, Node test cache, and native runtime fixtures stay in workspace-contained paths. The production desktop embeds `dist`; build the frontend before Rust. It does not need a Vite server to run.

## Executed checks

- Frontend strict TypeScript/Vite production build: passed.
- Frontend tests: five passed, covering command navigation, offline audience grants, visible verification, snapshot/event races, and guest invitation links.
- `build --workspace`: passed, including all four executables and the Tauri shell.
- `test --workspace`: 33 passed, one disk-intensive test ignored by default.
- Separate execution of the ignored large-transfer test with 268,435,456 bytes: passed with full content verification.
- `scripts/smoke.ps1`: separate host/client processes verified HTTPS identity, browsed a LAN-open share, downloaded and compared content successfully.
- `clippy --workspace --all-targets '--' -D warnings`: passed.
- `fmt --all --check`: passed.
- `scripts/desktop-smoke.ps1`: real production WebView, share audience changes, guest invitation redemption/replay rejection, public trust setup/fingerprint, live CLI download/content comparison, network validation/rollback, close-to-tray service continuity, programmatic reopening, and explicit quit passed. Screenshots and state remain under `.tools/desktop-smoke-*`. This does not cover tray mouse/menu interaction or native dialogs.
- Named-pipe tests passed for legitimate requests, first-instance protection, oversized-frame rejection, and access denial under an anonymous impersonation token. A separate-account interactive check remains open.
- Local resume also reconciles an already-renamed verified file without a reachable sender; the core owns the decision to contact the sender.
- Node syntax check for `guest/guest.js`: passed. The previous session also checked the historical console.
- COM tests cover descriptors, invalid indices, lazy streams, sizes, seeking/cloning, real HTTPS range reads, and rejection after source changes. They do not establish real Explorer interoperability.

Pending: native file/folder/destination picker interaction; real Explorer drop-in and single/multiple/large drag-out copies, progress/cancellation/failure cleanup; tray icon/menu interaction; a separate Windows account's CLI rejection; real iOS/Android trusted HTTPS with internet disconnected; physical second Windows PC and multicast/interface behavior; true network interruption; disk exhaustion; 50 GB transfer and sustained-memory measurement. A 256 MiB localhost test does not satisfy these checks.

## Commands

Run from the workspace root:

```powershell
.\scripts\npm.ps1 ci
.\scripts\npm.ps1 run build
.\scripts\npm.ps1 test
.\scripts\cargo.ps1 build --workspace
.\scripts\cargo.ps1 test --workspace
.\scripts\cargo.ps1 clippy --workspace --all-targets '--' -D warnings
.\scripts\cargo.ps1 fmt --all --check
.\scripts\smoke.ps1
.\scripts\desktop-smoke.ps1
.\scripts\desktop.ps1
```

Quote `'--'` when forwarding the compiler/test separator through the PowerShell wrapper. The runner sets workspace-local Cargo/Rustup/TEMP/TMP paths.

Disk-intensive test with a manageable fixture:

```powershell
$env:ULAK_LARGE_TEST_BYTES = '268435456'
.\scripts\cargo.ps1 test -p ulak-core --test transfers large_transfer_uses_bounded_generation_and_streaming '--' --ignored --nocapture
```

The original full-debug build exhausted this workspace volume. `cargo clean` removed generated artifacts, and dev/test profiles now disable debug symbols and incremental caches; builds subsequently passed. Keep this disk constraint in mind. Do not run the default 50 GB fixture without at least roughly 100 GB plus headroom on the workspace volume. Do not use another volume without the user's authorization to leave the workspace.

## Git handoff

This continuation started from clean `main` at `e053408`. Phase 4 was explicitly requested and implemented in separate verified commits for local CLI/IPC, shared Explorer streams, desktop integration, and validation/documentation. Inspect `git log` and `git status` for the actual final state; do not infer HEAD from this note. No remote or publication was added.

The user noticed a smoke-test window closing and asked to continue if work was unfinished. Explain when an isolated test window is intentionally quit. A separately opened idle desktop can hold the executable during rebuilding; inspect active transfers before stopping it. Leave the normal updated desktop open for review at the end of this continuation. The user has not requested phase 5.
