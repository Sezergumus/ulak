# Session handoff

Updated on 2026-11-10 for continuation in a new conversation. The earlier phase and compact-layout results below retain their original scope.

## Latest request: plain English and simpler connections

### Superseding continuation: nearby selection, numeric approval, and keyboard access

The user rejected invitation copying as the normal pairing flow and requested a nearby-device list with pairing similar to familiar wireless-device setup, without using Bluetooth transport. They also requested a compact search-oriented command menu and asked for an application launch shortcut. This continuation started from clean `main` at `8780178`. Core pairing is committed in `669dcf2`, and desktop/command-menu/launch integration in `f52de06`; inspect Git for the current documentation commit and state.

The ordinary flow is now Connect a device → select a nearby computer → compare the same six-digit number → Match and pair on both computers. Initial Wi-Fi/Ethernet selection can enable nearby sharing with one explicit button in the dialog, using the real adapter subnet. No certificate text or invitation needs to be copied. Incoming requests bring a hidden window forward, and pending requests remain reachable across views. Device presence is freshly verified after pairing. The existing invitation and public-descriptor flows remain under Other ways to connect.

Nearby pairing uses a bounded, in-memory, two-minute signed commitment/reveal exchange, binds both full descriptors and random nonces, and persists trust only after both approvals. A separate untrusted TLS client retrieves only the public bootstrap descriptor; subsequent messages pin its CA and verify signatures, and file access remains unavailable without existing authorization. Requests are LAN-scoped, rate-limited, and replay-bounded. Discovery does not become authentication, and pairing changes no share audiences. See `docs/protocol.md` for exact guarantees, bootstrap limits, and the interrupted-confirmation case. This application-specific protocol has functional/security tests, but has not had independent cryptographic review. Pending sessions are not restored after restart.

Ctrl+K now opens a focused search menu with grouped results, icons, secondary descriptions, shortcut badges, and navigation/action hints. Empty groups are omitted. Ctrl+1/2/3 navigates the main views, and Ctrl+, opens connection settings. Ctrl+Alt+U shows, restores, and focuses the running desktop from any application. A registration conflict leaves the app running and is reported in Connection settings. Repeated launches focus the existing window; separate canonical data directories remain independent installations.

Workspace-local `Ulak.cmd` and generated `Ulak.lnk` launch the built desktop through `scripts/open.ps1` without leaving a debug console open. `scripts/create-shortcut.ps1` recreates the ignored shortcut. No Desktop/Start-menu installation, auto-start registration, firewall changes, or global settings were added. Ctrl+Alt+U requires Ulak to be running. The user's two current shares, persistent identity/name, permissions, and loopback network configuration were preserved. The normal app was reopened from `Ulak.lnk` and left open for review.

Measured validation:

- Frontend production build and all 18 frontend tests passed, including direct nearby selection, one-action network setup, numeric confirmation/waiting, and cancellation. Existing invitation and share-navigation regressions remain covered.
- `test --workspace`: 39 passed, one large-transfer test ignored. New tests exercise real-HTTPS nearby pairing, equal numbers, both approvals, rejection, selected-identity mismatch, network-scope denial, descriptor/nonce/approval tampering, expiration, rate limits, replay rejection, and prevention of revoked-trust restoration. Full-workspace Clippy with warnings denied, formatting, whitespace, JavaScript syntax, and PowerShell parser checks passed. Desktop and product CLI builds passed. No large fixture was rerun.
- `scripts/nearby-smoke.ps1`: two production WebViews verified matching displayed numbers, both approvals, continued private-share isolation, an explicitly granted paired download/content comparison, rejection, real Ctrl+Alt+U input from a hidden window, and repeated-launch activation. Default loopback artifacts: `.tools/nearby-smoke-a948bb5af3cc4b32a6326848b334fb5c`.
- With `ULAK_TEST_NEARBY_MULTICAST=1`, both fixture profiles bound to this workstation's active Ethernet adapter and discovered each other through mDNS. The actual nearby list was used to initiate pairing; both devices were verified online afterward. Final successful artifacts: `.tools/nearby-smoke-56ade68595b64e219194e448b1aa1dcf`; an earlier successful adapter run is `.tools/nearby-smoke-f4cc1b91e87c48eab295eac8c0093a48`. This establishes local adapter/multicast behavior on one workstation, not physical second-PC or firewall interoperability.
- `scripts/desktop-smoke.ps1` passed keyboard command selection, menu layout at 1080/820 pixels, network proposals and return navigation, share audiences, guest redemption/replay rejection, LAN-open browsing, browser setup code, verified CLI download, close-to-tray continuity, reopening, and explicit quit. Final artifacts: `.tools/desktop-smoke-e2209040cb63463b826d85a86b1502f6`. Final command-menu and discovery-list screenshots were inspected. `Ulak.lnk` startup and `Ulak.cmd` reactivation were exercised with the normal profile.

The isolated smoke windows were intentionally quit. Physical second-PC, phone, native picker, real Explorer, tray mouse/menu, separate-account, interruption/disk-exhaustion, and 50 GB acceptance remain open. Functional validation does not establish user visual acceptance. Phase 5 has not been requested. The older invitation-first record below is historical and is superseded by this continuation for ordinary desktop pairing.

The user asked whether local-network discovery is automatic, requested everyday English throughout the application and no Turkish project text, asked what the public CA fingerprint means, and requested easier device pairing. This continuation started from clean `main` at `9594daa`, with no remote. Implementation is committed in `a060cf3`; inspect Git for the current documentation commit and state.

- Discovery already ran at startup, on window focus, and every 30 seconds. The UI now explains this. It finds advertising Ulak devices, not every computer/phone or available Wi-Fi network. The initial saved configuration on this workstation remains loopback-only; no live network permissions or system settings were changed.
- Connection settings now offer active Windows Wi-Fi/Ethernet adapters. A bounded `GetAdaptersAddresses` query supplies each IPv4 address and actual prefix; selecting one proposes its address, subnet, and mDNS advertisement before Apply settings. Advanced settings retain custom/IPv6/VPN addresses, allowed ranges, certificate setup, public exports, and the discovery switch.
- Connect a device now includes I have an invitation / Create an invitation in one dialog, a copy action with manual-copy fallback, an expiry notice, and first-run network guidance. Discovered candidates carry their identity into the dialog, which rejects invitations/public connection records for another device. No discovery candidate is trusted automatically. Native TLS and identity verification and high-entropy single-use invitations are unchanged.
- Ordinary labels now use Saved devices, Choose devices, Invitation only, Start sharing, Checking file, Downloaded, Get ready to drag, and End access. Device IDs, connection internals, and diagnostic errors are expandable. Dates explicitly use English formatting. Comments, authored UI copy, and documentation remain English; a tracked/hidden-source scan excluding generated/runtime directories found no Turkish-character text. User-supplied names, paths, and operating-system data are not translated.
- The public CA fingerprint is called Security code for browser setup in the product. Guest instructions explain comparing that code before certificate installation. The public setup page and bundled browser page use plain English. Native PC pairing does not require manual fingerprint comparison. These are copy changes to existing guest capabilities, not completion of phase 5 or real-phone onboarding acceptance.

Measured validation for this change:

- Frontend production build and all 14 frontend tests passed. Seven new tests cover invitation creation/copy, native pairing dispatch, selected-device mismatch rejection, native invitation rejection, loopback setup guidance, applying the actual adapter subnet only after saving, and returning through network setup without losing the original share access dialog.
- `test -p ulak-desktop -p ulak-core`: 25 passed, one large-transfer test ignored. Includes the existing real-HTTPS pairing/security/transfer tests and a new subnet calculation test. The full workspace test suite and large-transfer fixture were not rerun for this change.
- `clippy -p ulak-desktop -p ulak-core --all-targets '--' -D warnings`, formatting, whitespace, JavaScript syntax, and `build -p ulak-desktop` passed.
- Native WebView smoke passed Windows adapter enumeration, proposed settings without applying them, the new connection dialogs and loopback guidance, returning to device connection from network settings, keyboard navigation, 1080/820-pixel list layouts, share audience changes, guest redemption/replay rejection, secure LAN-open browsing, matching browser setup code, verified CLI download, close-to-tray continuity, reopening, and explicit quit. Initial artifacts: `.tools/desktop-smoke-281675aba8304beea5ac15fff78f1c6f`; final run: `.tools/desktop-smoke-5a47fcf60d2a4b65860406e543d8cbae`. Connection settings, connection dialog, Devices, and audience screenshots were inspected. Invitation copy and join are covered by frontend tests; real two-PC pairing and interactive clipboard transfer remain unmeasured.
- The isolated smoke window was intentionally quit. The normal desktop was rebuilt and reopened using its existing `.ulak/desktop` state for review. Its original share, device name, permissions, and network configuration were preserved. Physical second-PC/multicast, real phones, native pickers, actual Explorer and tray interaction, and large-transfer acceptance remain open as listed below. User visual acceptance remains pending.

## Workspace and collaboration preferences

- Workspace: `D:\Antigravity Workspaces\ulak`; shell: PowerShell; user timezone: Europe/Istanbul.
- All changes must stay inside this workspace, including tooling, temporary files, test fixtures, caches, and build output. Do not install system software, change certificate trust/firewall rules, modify global Git settings, or write elsewhere as part of project work.
- The user installed system Rust during the session. A separate workspace-local Rust 1.99.1 toolchain is already available in `.tools`; continue using the wrapper scripts to contain generated files.
- All source comments, documentation, and commit messages must be English. Conversation with the user has been Turkish. Do not add tool/model or authoring-process attribution to project text or history.
- Git was initialized at the user's request. Commit meaningful verified chunks separately. The earlier specification title was corrected throughout local history; preserve the corrected wording when editing documents.
- Do not use third-party design-reference brand names in new commit messages or newly authored design descriptions. Describe the actual layout, typography, spacing, hierarchy, and interaction changes in product terms. Do not rewrite existing Git history for this preference.
- No remote was configured or publication performed. Inspect current Git status and remotes before assuming this remains true.

## Product and agreed design

Ulak is an open-source, offline local-network file-sharing application, initially for Windows. A publisher selects existing files/folders; recipients browse authorized content and pull selected files. Publishing is not a push, upload, copy, or synchronization operation.

The desktop implements the functional window structure: Devices, My shares, and Transfers occupy the narrow sidebar; Add share, native file/folder pickers, Explorer drop-in, `Ctrl+K` commands, and a persistent transfer status area are connected to the core. All frontend assets are bundled locally. The user rejected the previous visual direction and explicitly requested refinement in this continuation. The compact revision is implemented for review; functional implementation and passing tests do not establish visual acceptance.

### Desktop design refinement: ready for review

The user said the previous UI did not match the original compact desktop design direction. It used a dark palette, sidebar, rows, and command menu while missing the intended density, proportions, and visual hierarchy. Large promotional headings, slogans, generous empty space, an oversized brand area, large detail icons, and broad amber accents gave it a dashboard character. Do not claim visual acceptance without the user's review.

This continuation replaces promotional headings with a single 52 px toolbar and 14 px view titles. The sidebar is 176 px wide (164 px at compact widths); device/file rows are 52 px tall. Decorative icon tiles, slogans, broad amber selections, and the empty right panel are removed. Details appear only for a selected item and can be closed. Dialogs use smaller headings, closer spacing, and neutral selections. Devices includes quick access to up to three local shares. File sizes/types occupy an aligned column.

`Ctrl+K` opens commands and focuses its input; typing and Enter work without first clicking the search field. `Ctrl+F` focuses the current list filter outside dialogs. Arrow keys, Home, and End move through list actions; Enter opens a paired device's verified shares; Escape clears the filter or dismisses the list selection. Remote filtering applies to the loaded page and retains selected files for download. Existing audiences, offline identities, guest controls, native picker/drag commands, and transfer verification/cancel/resume remain connected to the same core.

The next step is the user's visual review of this revision. Keep further refinements compact, readable, and list-oriented; do not introduce promotional copy or decorative emphasis. Phase 5 has not been requested.

Devices are persistent paired identities, not IP addresses. Offline paired PCs remain visible with last connection information and remain selectable as share recipients. Newly discovered unpaired devices appear separately. Display Offline rather than claiming to know a PC is powered off. An Ethernet cable alone does not make a powered-off, sleeping, or stopped peer reachable. A changed IP/interface must update the same verified identity, preserving trust and permissions; lost installation identity keys require pairing again.

Share access includes selected paired devices, scoped guest sessions, and the user's explicitly requested **Everyone on the local network** option. LAN-open shares permit unpaired native/browser readers within configured allowed network ranges without invitations. They do not grant access to private shares or management operations. Selecting all currently paired devices is distinct from opening a share to the LAN. Offline grants persist until the recipient and publisher are reachable; they do not queue automatic delivery.

## Scope and phase status

The user explicitly requested phase 4 in this continuation after the first three phases. Code for phases 1–4 is present; hardware-dependent validation remains open. Do not describe the whole application or all acceptance criteria as completed.

1. Feasibility: bundled browser HTTPS/public-CA onboarding prototype and Windows OLE virtual-file drag probe are implemented. Phone trust/onboarding and actual Explorer drops still need testing.
2. Trusted core: Rust workspace, Tauri v2 development shell, persistent identity/local CA, authenticated pairing/revocation, signed challenge verification, mDNS candidates/advertisement, verified known-peer endpoint refresh, manual connection descriptors, and protocol negotiation are implemented.
3. Sharing/downloads: explicit audiences, guest sessions, opaque entries, bounded directory pages and native folder traversal, locked source streaming, HTTP ranges, durable download checkpoints, cancellation/resume, BLAKE3 verification, no-replace finalization, and recovery after a rename/checkpoint crash are implemented.
4. Desktop integration: the React product UI, offline device audience picker, native picker commands, transfer snapshots/events, guest controls, persistent network settings, close-to-tray lifecycle, Explorer drag handle using the shared COM implementation, and protected named-pipe CLI are implemented. The compact UI revision is ready for visual review. Real WebView/CLI smoke checks passed, including keyboard command navigation and share/file layouts at 1080×720 and 820×560. Native dialog interactions, actual Explorer drops, and tray mouse/menu checks remain pending.
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
- Frontend tests: seven passed, covering keyboard filtering/device browsing, remote file selection/download while filtering, command input focus and Enter navigation, offline audience grants, visible verification, snapshot/event races, and guest invitation links.
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

UI refinement validation: strict frontend production build, seven frontend tests, `build -p ulak-desktop`, formatting, script syntax, and the expanded native WebView smoke passed. The smoke exercises `Ctrl+F`, command input focus and Enter navigation, LAN-open browsing, and absence of horizontal overflow at 1080×720 and an emulated 820×560 viewport. Screenshots were visually inspected; final successful runs are `.tools/desktop-smoke-ddc0eb7dcaa34593b6746d9e68b0691f` and `.tools/desktop-smoke-df2ee5e9bd6447c08073ba570440e35f`. Rust core/IPC code did not change; the earlier full Rust test/lint results above were not rerun for this UI revision.

One preceding smoke run (`.tools/desktop-smoke-0c5e847f7a434ebfbe0acd5ef5e63cf3`) returned Windows error 5 during a CLI download and left an interrupted checkpoint at zero bytes. Two subsequent full runs passed without retries inside the test. The cause has not been isolated; do not describe transfer validation as consistently failure-free or claim this was fixed by the UI work.

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

The UI refinement continuation started from clean `main` at `5864c96`, with no remote configured. Phase 4 had already been implemented in separate verified commits for local CLI/IPC, shared Explorer streams, desktop integration, and validation/documentation. The compact UI and its measured validation are committed separately from these updated handoff records. Inspect `git log` and `git status` for the actual final state; do not infer HEAD from this note. No remote or publication was added.

The user noticed a smoke-test window closing and asked to continue if work was unfinished. Explain when an isolated test window is intentionally quit. A separately opened idle desktop can hold the executable during rebuilding; inspect active transfers before stopping it. Leave the normal updated desktop open for review at the end of this continuation. The user has not requested phase 5.
