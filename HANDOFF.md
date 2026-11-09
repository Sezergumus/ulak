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

The agreed desktop direction is Raycast-inspired: compact resizable dark window, graphite surfaces, off-white text, restrained amber accent, thin borders, modest rounding, aligned list rows, and a selected-item detail panel. Use a narrow sidebar with Devices, My shares, and Transfers. Keep Add share and drag-in accessible, offer `Ctrl+K` contextual commands, and retain a compact active-transfer status area across views. The actual polished React interface is not implemented yet.

Devices are persistent paired identities, not IP addresses. Offline paired PCs remain visible with last connection information and remain selectable as share recipients. Newly discovered unpaired devices appear separately. Display Offline rather than claiming to know a PC is powered off. An Ethernet cable alone does not make a powered-off, sleeping, or stopped peer reachable. A changed IP/interface must update the same verified identity, preserving trust and permissions; lost installation identity keys require pairing again.

Share access includes selected paired devices, scoped guest sessions, and the user's explicitly requested **Everyone on the local network** option. LAN-open shares permit unpaired native/browser readers within configured allowed network ranges without invitations. They do not grant access to private shares or management operations. Selecting all currently paired devices is distinct from opening a share to the LAN. Offline grants persist until the recipient and publisher are reachable; they do not queue automatic delivery.

## Scope and phase status

The user requested implementation of the first three phases. Code and prototypes are present; hardware-dependent validation remains open. Do not describe the whole application or all acceptance criteria as completed.

1. Feasibility: bundled browser HTTPS/public-CA onboarding prototype and Windows OLE virtual-file drag probe are implemented. Phone trust/onboarding and actual Explorer drops still need testing.
2. Trusted core: Rust workspace, Tauri v2 development shell, persistent identity/local CA, authenticated pairing/revocation, signed challenge verification, mDNS candidates/advertisement, verified known-peer endpoint refresh, manual connection descriptors, and protocol negotiation are implemented.
3. Sharing/downloads: explicit audiences, guest sessions, opaque entries, bounded directory pages and native folder traversal, locked source streaming, HTTP ranges, durable download checkpoints, cancellation/resume, BLAKE3 verification, no-replace finalization, and recovery after a rename/checkpoint crash are implemented.
4. Next proposed milestone: product desktop UI, native pickers, tray lifecycle, product drag-and-drop, protected named-pipe CLI integration. This was recommended, but the user has not explicitly requested starting it yet.
5. Guest release polish and release validation remain later work. The existing guest interface is a functional feasibility surface.

Deferred v1 features remain deferred: clipboard functionality, automatic synchronization, compression/ZIP creation, guest uploads, whole-folder browser downloads, native mobile apps, non-Windows desktop agents, and dragging complete remote folders into Explorer.

## Repository map

- `context.md`: architecture and UX implementation contract.
- `README.md`: development setup, commands, examples, limits.
- `docs/phase-status.md`: executed validation versus pending physical checks.
- `docs/protocol.md`: TLS/identity, API, audience rules, download lifecycle.
- `docs/feasibility.md`: phone certificate setup, Explorer probe, large-file test procedures.
- `crates/ulak-core`: reusable Rust identity, persistence, auth, catalog, TLS server, native client, discovery, download engine.
- `crates/ulak-agent`: diagnostic executable and local setup/transfer commands.
- `crates/ulak-drag-probe`: separate Windows OLE interactive feasibility executable.
- `src-tauri`: Tauri v2 shell and local core IPC commands.
- `desktop`: static development console; this is not the planned React product UI.
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
- The diagnostic CLI locks its state directory; run its setup mutations with that server stopped. Live local management uses Tauri IPC. The full current-user-only named-pipe CLI remains phase 4.

## Executed checks

- `build --workspace`: passed, including all three executables and the Tauri shell.
- `test --workspace`: 27 passed, one disk-intensive test ignored by default.
- Separate execution of the ignored large-transfer test with 268,435,456 bytes: passed with full content verification.
- `scripts/smoke.ps1`: separate host/client processes verified HTTPS identity, browsed a LAN-open share, downloaded and compared content successfully.
- `clippy --workspace --all-targets '--' -D warnings`: passed.
- `fmt --all --check`: passed.
- Node syntax checks for `guest/guest.js` and `desktop/console.js`: passed.
- COM tests cover descriptors, invalid indices, lazy streams, sizes, seeking/cloning, real HTTPS range reads, and rejection after source changes. They do not establish real Explorer interoperability.

Pending: real iOS/Android trusted HTTPS with internet disconnected; physical second Windows PC and multicast/interface behavior; interactive Explorer single/multiple/large copies, progress/cancellation/failure cleanup; true network interruption; disk exhaustion; 50 GB transfer and sustained-memory measurement. A 256 MiB localhost test does not satisfy these checks.

## Commands

Run from the workspace root:

```powershell
.\scripts\cargo.ps1 build --workspace
.\scripts\cargo.ps1 test --workspace
.\scripts\cargo.ps1 clippy --workspace --all-targets '--' -D warnings
.\scripts\cargo.ps1 fmt --all --check
.\scripts\smoke.ps1
.\scripts\cargo.ps1 run -p ulak-desktop
```

Quote `'--'` when forwarding the compiler/test separator through the PowerShell wrapper. The runner sets workspace-local Cargo/Rustup/TEMP/TMP paths.

Disk-intensive test with a manageable fixture:

```powershell
$env:ULAK_LARGE_TEST_BYTES = '268435456'
.\scripts\cargo.ps1 test -p ulak-core --test transfers large_transfer_uses_bounded_generation_and_streaming '--' --ignored --nocapture
```

The original full-debug build exhausted this workspace volume. `cargo clean` removed generated artifacts, and dev/test profiles now disable debug symbols and incremental caches; builds subsequently passed. Keep this disk constraint in mind. Do not run the default 50 GB fixture without at least roughly 100 GB plus headroom on the workspace volume. Do not use another volume without the user's authorization to leave the workspace.

## Git handoff

Before this handoff note, HEAD was `97e078f` (`docs: document phase implementations and outstanding hardware validation`) and the working tree was clean. The continuation notes themselves are committed afterward. Inspect `git log`/`git status` for the actual current state. No further application changes were requested or performed during the handoff turn.
