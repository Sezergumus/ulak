# Implementation status

Recorded on 2026-11-09. Automated results below were obtained on Windows using workspace-local Rust 1.99.1. Hardware-dependent checks are listed separately and are not marked passed by implementation alone.

| Phase | Implemented | Validation status |
| --- | --- | --- |
| 1: Feasibility | HTTPS/public-CA setup listeners, bundled browser file-access prototype, Windows OLE virtual-file drag executable with lazy range-backed streams | Local HTTPS and COM metadata/read/seek/clone tests passed. Real iOS/Android trust setup and interactive Explorer drops remain pending. |
| 2: Trusted core | Rust workspace, Tauri v2 development shell, persisted identity and local CA, signed challenge verification, single-use pairing, revocation, mDNS advertisements/candidates, verified known-peer reconnection, manual connection descriptors, protocol negotiation | Workspace build passed. Tests cover persistent identity, state locking, pairing proof/replay rejection, revocation, and reconnecting the same peer through a changed endpoint. Physical second-PC and multicast/interface checks remain pending. |
| 3: Sharing and native downloads | Identity grants including offline peers, scoped guest sessions, explicit LAN-open access, opaque entry IDs, bounded pagination/folder traversal, source locking, byte ranges, checkpoints, cancellation/resume, BLAKE3 verification, no-replace finalization, post-rename crash recovery | Automated authorization/transfer/recovery tests and a separate-process localhost smoke test passed. A 256 MiB generated-file transfer passed. Real 50 GB, disk-exhaustion, physical network interruption, and sustained-memory acceptance remain pending. |

## Checks executed

- `build --workspace`: all three executables compiled, including the Tauri desktop shell.
- `test --workspace`: 27 tests passed; one disk-intensive large-transfer test is ignored by default.
- The ignored large-transfer test was separately executed with `ULAK_LARGE_TEST_BYTES=268435456`; 268,435,456 bytes were downloaded and fully verified successfully.
- `scripts/smoke.ps1`: separate host and recipient processes successfully verified HTTPS identity, listed a LAN-open share, downloaded the file, and compared its content.
- JavaScript syntax checks passed for the bundled browser and desktop development-console scripts.
- `clippy --workspace --all-targets '--' -D warnings` and `fmt --all --check` passed.

The 256 MiB test does not establish the 50 GB criterion or a measured total-process memory target. COM tests do not establish actual Explorer copy/progress/cancellation behavior. Loopback connections do not establish phone or physical LAN compatibility.

## Important behavior

- IP addresses are connection endpoints, not device identities. Known peers are verified with persisted trust before their endpoint and last-connection time are updated.
- Offline paired devices remain stored and can receive share grants. Grants do not push files; recipients pull when both agents are reachable.
- LAN-open shares are accessible without pairing or an invitation from explicitly allowed source ranges. This does not expose private shares or management APIs.
- Cancelling a native download preserves its partial file and checkpoint for explicit resume. Folder downloads currently preserve per-file checkpoints; complete folder-job orchestration is not persisted as a separate resumable job.
- Browser and Explorer destination handling remains owned by those applications. Native downloader guarantees do not automatically apply to them.
- The diagnostic runner performs local setup while its state owner is stopped. Live management is available through Tauri IPC; a current-user-only named-pipe CLI, tray lifecycle, Explorer integration in the product, and polished React screens belong to phase 4.

## Remaining release checks

Use the procedures in [feasibility.md](feasibility.md) to record real-phone trusted HTTPS with internet disconnected, interactive Explorer copies, and large transfers. Also exercise permission changes between range requests, real network loss and recovery, destination disk exhaustion, firewall/multicast restrictions, multiple network interfaces, and peer certificate renewal/restart on actual PCs.
