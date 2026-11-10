# Implementation status

Recorded on 2026-11-09. Automated results below were obtained on Windows using workspace-local Rust 1.99.1. Hardware-dependent checks are listed separately and are not marked passed by implementation alone.

## Plain-English connection revision — 2026-11-10

The desktop now explains automatic Ulak discovery, offers an explicit Wi-Fi/Ethernet picker using Windows adapter addresses and actual subnets, keeps custom fields under Advanced settings, and combines invitation creation/copy and joining in Connect a device. Discovery candidates remain untrusted, and a connection record for a different selected device is rejected. Initial loopback defaults and server-authoritative share permissions are preserved. The certificate fingerprint is presented as Security code for browser setup with comparison instructions in the existing guest flow; native pairing does not require entering it. Authored product strings are plain English, technical errors are expandable, and transfer labels still distinguish checking a file from successful completion.

Validation for this revision: frontend production build and 13 frontend tests passed; targeted desktop/core Rust tests passed 25 tests with the large fixture ignored; targeted desktop/core Clippy, formatting, whitespace, and JavaScript syntax checks passed; the production desktop executable built successfully. Existing full-workspace results below belong to the earlier validation.

The real WebView smoke passed adapter enumeration and unapplied network proposals, connection dialogs and loopback guidance, keyboard navigation, 1080/820-pixel layouts, audience changes, guest redemption/replay rejection, verified LAN-open browsing, the browser setup security code, live CLI download/content comparison, close-to-tray continuity, reopening, and explicit quit. Screenshots were inspected under `.tools/desktop-smoke-281675aba8304beea5ac15fff78f1c6f`. Invitation creation/copy/join and wrong-device rejection were tested in the frontend with mocked native commands; the existing core tests exercise real HTTPS pairing. Actual two-PC pairing, cross-device clipboard exchange, and phone certificate setup were not exercised. Hardware, Explorer, native picker, tray interaction, and large-transfer acceptance remain pending. Visual acceptance belongs to the user.

| Phase | Implemented | Validation status |
| --- | --- | --- |
| 1: Feasibility | HTTPS/public-CA setup listeners, bundled browser file-access prototype, Windows OLE virtual-file drag executable with lazy range-backed streams | Local HTTPS and COM metadata/read/seek/clone tests passed. Real iOS/Android trust setup and interactive Explorer drops remain pending. |
| 2: Trusted core | Rust workspace, Tauri v2 development shell, persisted identity and local CA, signed challenge verification, single-use pairing, revocation, mDNS advertisements/candidates, verified known-peer reconnection, manual connection descriptors, protocol negotiation | Workspace build passed. Tests cover persistent identity, state locking, pairing proof/replay rejection, revocation, and reconnecting the same peer through a changed endpoint. Physical second-PC and multicast/interface checks remain pending. |
| 3: Sharing and native downloads | Identity grants including offline peers, scoped guest sessions, explicit LAN-open access, opaque entry IDs, bounded pagination/folder traversal, source locking, byte ranges, checkpoints, cancellation/resume, BLAKE3 verification, no-replace finalization, post-rename crash recovery | Automated authorization/transfer/recovery tests and a separate-process localhost smoke test passed. A 256 MiB generated-file transfer passed. Real 50 GB, disk-exhaustion, physical network interruption, and sustained-memory acceptance remain pending. |
| 4: Desktop integration | Compact React product window, persistent Devices/My shares/Transfers views, offline audience picker, keyboard command menu and list navigation, native picker commands, Explorer drop-in, reusable OLE drag-out integration, tray lifecycle, core transfer snapshots/events, persistent network settings, guest invitation/session controls, protected named-pipe CLI | Frontend production build and seven interaction/state tests passed. Earlier validation passed all 33 Rust tests. Expanded native WebView smoke passed keyboard commands, compact share/file layouts, source/audience UI, guest redemption/replay rejection, public setup materials, CLI transfer verification, listener rollback, close-to-tray continuity, programmatic reopening, and explicit quit; an earlier intermittent download error is recorded below. Visual review, native picker interactions, actual Explorer drops, and tray mouse/menu interactions remain open. |

## Checks executed

Visual acceptance is separate from functional validation. The user rejected the previous desktop design and requested a compact revision. That revision is now implemented for review: a single toolbar, smaller headings, 52 px rows, neutral selections, conditional item details, aligned file sizes, compact dialogs, and keyboard filtering/navigation replace the promotional layout. User visual acceptance remains pending.

- `npm run build` through `scripts/npm.ps1`: strict TypeScript and bundled Vite production build passed; no runtime asset requests to external services are required.
- `npm test` through the wrapper: seven tests passed, covering keyboard filtering/device browsing, remote selection/download while filtering, command input focus and Enter navigation, offline audience grants, visible verification state across views, snapshot/event races, and guest-link encoding.
- `build --workspace`: all four executables compiled, including the Tauri desktop and live CLI.
- `test --workspace`: 33 tests passed; one disk-intensive large-transfer test is ignored by default.
- The ignored large-transfer test was separately executed with `ULAK_LARGE_TEST_BYTES=268435456`; 268,435,456 bytes were downloaded and fully verified successfully.
- `scripts/smoke.ps1`: separate host and recipient processes successfully verified HTTPS identity, listed a LAN-open share, downloaded the file, and compared its content.
- `scripts/desktop-smoke.ps1`: the real production WebView loaded successfully, changed a share audience, created/redeemed a scoped guest invitation, rejected invitation replay, served the matching public CA fingerprint, and observed a verified download started by the separate CLI. Invalid listener settings left the service running; an occupied-port failure restored the previous configuration/name. Closing the window hid it while local IPC remained available; programmatic reopening and explicit quit passed. Screenshots and isolated state remain under `.tools/desktop-smoke-*`.
- Named-pipe tests rejected an anonymous impersonation token with access denied, rejected a second first-instance owner and oversized input, and confirmed subsequent legitimate requests still work. A separate Windows account has not been tested interactively.
- JavaScript syntax checks passed for the bundled browser and desktop development-console scripts.
- `clippy --workspace --all-targets '--' -D warnings` and `fmt --all --check` passed.

The 256 MiB test does not establish the 50 GB criterion or a measured total-process memory target. COM tests do not establish actual Explorer copy/progress/cancellation behavior. Loopback connections do not establish phone or physical LAN compatibility.

### Compact UI revision validation

The frontend production build, seven interaction/state tests, and `build -p ulak-desktop` passed after the UI changes. Formatting, smoke-script syntax, and whitespace checks passed. The Rust core and IPC implementation were unchanged; the full Rust test/lint results above belong to the earlier phase 4 validation.

The expanded native WebView smoke passed `Ctrl+F`, `Ctrl+K` input focus, typing and Enter navigation, LAN-open file browsing, share access changes, guest invitation redemption/replay rejection, CLI content verification, listener rollback, and tray lifecycle checks. Share details and remote file lists had no horizontal overflow at 1080×720 and an emulated 820×560 viewport. Screenshots of Devices, share details, the audience dialog, remote browsing, and Transfers were inspected. Final successful artifacts are `.tools/desktop-smoke-ddc0eb7dcaa34593b6746d9e68b0691f` and `.tools/desktop-smoke-df2ee5e9bd6447c08073ba570440e35f`.

One earlier run (`.tools/desktop-smoke-0c5e847f7a434ebfbe0acd5ef5e63cf3`) returned Windows error 5 during CLI download and retained an interrupted checkpoint with zero bytes. Two subsequent complete runs passed without in-test retries. Its cause remains unisolated; no transfer-engine fix is claimed by this UI change. Hardware and native interaction checks below remain open.

## Important behavior

- IP addresses are connection endpoints, not device identities. Known peers are verified with persisted trust before their endpoint and last-connection time are updated.
- Offline paired devices remain stored and can receive share grants. Grants do not push files; recipients pull when both agents are reachable.
- LAN-open shares are accessible without pairing or an invitation from explicitly allowed source ranges. This does not expose private shares or management APIs.
- Cancelling a native download preserves its partial file and checkpoint for explicit resume. Folder downloads currently preserve per-file checkpoints; complete folder-job orchestration is not persisted as a separate resumable job.
- Browser and Explorer destination handling remains owned by those applications. Native downloader guarantees do not automatically apply to them.
- The diagnostic runner performs local setup while its state owner is stopped. The desktop and product CLI manage the running core through local IPC. The CLI never takes a second state lock or exposes network management routes.
- The initial desktop listener is loopback only; real LAN operation requires explicit reachable addresses and allowed ranges in Connection settings. The desktop also supports the public HTTP certificate setup listener without exposing shared content there.
- Per-file transfer snapshots survive view changes and restart. The desktop sends at most four selected files per batch, bounds pending local operations, and leaves completion to core verification/finalization. Preparation can precede a checkpoint; whole-folder orchestration is not a separately persisted job.
- Explorer drag-out reuses the tested virtual-file stream implementation. Wiring it to a product drag handle is implementation evidence, not a passed Explorer acceptance test.

## Remaining release checks

Use the procedures in [feasibility.md](feasibility.md) to record real-phone trusted HTTPS with internet disconnected, interactive Explorer copies, and large transfers. Also exercise native file/folder/destination pickers, real Explorer drop-in/out, tray icon/menu actions, CLI rejection from a separate Windows account, permission changes between range requests, real network loss and recovery, destination disk exhaustion, firewall/multicast restrictions, multiple network interfaces, and peer certificate renewal/restart on actual PCs. Phase 5 guest release polish has not been requested.
