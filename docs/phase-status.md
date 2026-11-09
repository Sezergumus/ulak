# Implementation status

Recorded on 2026-11-09. Automated results below were obtained on Windows using workspace-local Rust 1.99.1. Hardware-dependent checks are listed separately and are not marked passed by implementation alone.

| Phase | Implemented | Validation status |
| --- | --- | --- |
| 1: Feasibility | HTTPS/public-CA setup listeners, bundled browser file-access prototype, Windows OLE virtual-file drag executable with lazy range-backed streams | Local HTTPS and COM metadata/read/seek/clone tests passed. Real iOS/Android trust setup and interactive Explorer drops remain pending. |
| 2: Trusted core | Rust workspace, Tauri v2 development shell, persisted identity and local CA, signed challenge verification, single-use pairing, revocation, mDNS advertisements/candidates, verified known-peer reconnection, manual connection descriptors, protocol negotiation | Workspace build passed. Tests cover persistent identity, state locking, pairing proof/replay rejection, revocation, and reconnecting the same peer through a changed endpoint. Physical second-PC and multicast/interface checks remain pending. |
| 3: Sharing and native downloads | Identity grants including offline peers, scoped guest sessions, explicit LAN-open access, opaque entry IDs, bounded pagination/folder traversal, source locking, byte ranges, checkpoints, cancellation/resume, BLAKE3 verification, no-replace finalization, post-rename crash recovery | Automated authorization/transfer/recovery tests and a separate-process localhost smoke test passed. A 256 MiB generated-file transfer passed. Real 50 GB, disk-exhaustion, physical network interruption, and sustained-memory acceptance remain pending. |
| 4: Desktop integration | React product window, persistent Devices/My shares/Transfers views, offline audience picker, command menu, native picker commands, Explorer drop-in, reusable OLE drag-out integration, tray lifecycle, core transfer snapshots/events, persistent network settings, guest invitation/session controls, protected named-pipe CLI | Frontend production build and five interaction/state tests passed. All 33 Rust tests passed, including anonymous pipe rejection and a separate-process live CLI download. Native WebView smoke passed for source/audience UI, guest redemption/replay rejection, public setup materials, CLI transfer verification, listener rollback, close-to-tray continuity, programmatic reopening, and explicit quit. Native picker interactions, actual Explorer drops, and tray mouse/menu interactions remain manual checks. |

## Checks executed

- `npm run build` through `scripts/npm.ps1`: strict TypeScript and bundled Vite production build passed; no runtime asset requests to external services are required.
- `npm test` through the wrapper: five tests passed, covering offline audience grants, command-menu navigation, visible verification state across views, snapshot/event races, and guest-link encoding.
- `build --workspace`: all four executables compiled, including the Tauri desktop and live CLI.
- `test --workspace`: 33 tests passed; one disk-intensive large-transfer test is ignored by default.
- The ignored large-transfer test was separately executed with `ULAK_LARGE_TEST_BYTES=268435456`; 268,435,456 bytes were downloaded and fully verified successfully.
- `scripts/smoke.ps1`: separate host and recipient processes successfully verified HTTPS identity, listed a LAN-open share, downloaded the file, and compared its content.
- `scripts/desktop-smoke.ps1`: the real production WebView loaded successfully, changed a share audience, created/redeemed a scoped guest invitation, rejected invitation replay, served the matching public CA fingerprint, and observed a verified download started by the separate CLI. Invalid listener settings left the service running; an occupied-port failure restored the previous configuration/name. Closing the window hid it while local IPC remained available; programmatic reopening and explicit quit passed. Screenshots and isolated state remain under `.tools/desktop-smoke-*`.
- Named-pipe tests rejected an anonymous impersonation token with access denied, rejected a second first-instance owner and oversized input, and confirmed subsequent legitimate requests still work. A separate Windows account has not been tested interactively.
- JavaScript syntax checks passed for the bundled browser and desktop development-console scripts.
- `clippy --workspace --all-targets '--' -D warnings` and `fmt --all --check` passed.

The 256 MiB test does not establish the 50 GB criterion or a measured total-process memory target. COM tests do not establish actual Explorer copy/progress/cancellation behavior. Loopback connections do not establish phone or physical LAN compatibility.

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
