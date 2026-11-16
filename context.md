# ULAK - v1 Architecture & Implementation Specification

Implementation progress and executed checks are recorded in [docs/phase-status.md](docs/phase-status.md). Technical prototypes and manual validation procedures are documented in [docs/feasibility.md](docs/feasibility.md).

## 1. Product Goal and Release Scope

**Ulak** is an open-source, offline LAN file-sharing tool. A Windows agent exposes explicitly selected files and folders to selected paired PCs, temporary browser guests, or everyone on the local network, according to each share's audience. Recipients browse permitted shares and pull the files they choose. Both PCs can publish and receive.

### First Release

- **Windows agent:** paired-PC and explicitly LAN-open sharing, resumable native downloads, tray application, minimal CLI, and two-way drag-and-drop with Explorer.
- **Android/iOS browser guests:** a locally served, read-only interface for browsing folders and downloading individual files. No Ulak app installation is required, but certificate installation and trust setup may be required.
- **Offline operation:** no cloud account, hosted service, relay, CDN, or internet dependency at runtime. Devices must be able to reach each other on the local network.
- **Documentation:** keep project documentation in English.

### Deferred Features

Do not implement clipboard synchronization/history, secret detection/expiry, native Android/iOS apps, macOS/Linux agents, automatic folder synchronization, compression, guest uploads, guest whole-folder ZIP downloads, or dragging entire remote folders out to Explorer in v1. A separate quick-drop overlay is not required for v1.

---

## 2. Engineering Mandates

1. **Bounded-memory streaming:** never load an entire file into RAM, route file bytes through React/Tauri JSON messages, or create a source staging copy. Read the existing source with bounded buffers and stream directly to the recipient. Memory growth must be independent of file size, including a 50 GB transfer.
2. **Accurate terminology:** this is bounded-memory streaming without application-created source copies. `ReaderStream` does not guarantee zero allocations or a zero-copy disk-to-network path. Benchmark transfer memory separately from total application/WebView memory; remove the unverified 15–25 MB total-process requirement.
3. **No staging archives:** registering a share stores source references and metadata only. Do not copy files into application storage or create temporary ZIP files before serving them. v1 transfers are uncompressed.
4. **Bound all work:** limit concurrent transfers, queued buffers, metadata pages, hashing jobs, and recursive folder enumeration. Apply backpressure and cancellation throughout.
5. **Tauri v2 only:** use compatible `@tauri-apps/api` and `@tauri-apps/plugin-*` APIs. Do not introduce Tauri v1 or Electron patterns.
6. **Explicit audience authorization:** implement TLS, server identity verification, and server-enforced audience policies before exposing shared content. Restricted shares require paired-device authentication or a scoped guest session. An explicitly LAN-open share permits read-only access from the allowed local network without pairing or an invitation. Discovery is not authentication, and LAN-open access does not grant device-management privileges.
7. **Safe destinations:** Ulak-managed downloads use exclusively created partial files in the destination directory, verify content, and finalize without overwriting existing files.
8. **Platform-specific guarantees:** the native downloader, Explorer, and mobile browsers own different parts of destination handling. Do not promise identical resume, cleanup, save-location, or resource behavior across these paths.

---

## 3. Technology and Component Boundaries

### Reusable Rust Core (`crates/ulak-core`)

- **Runtime and transport:** Tokio, Axum, `tower-http`, and authenticated WebSocket control traffic where needed.
- **Streaming:** `tokio-util`, `futures-util`, and bounded readers/writers.
- **Discovery:** `mdns-sd`, using `_ulak._tcp.local.`.
- **TLS and certificates:** `rustls` and `rcgen`.
- **Integrity:** BLAKE3, computed with bounded reads and cached per source revision.
- **Responsibilities:** protocol/version negotiation, identity and trust, discovery, share catalog and permissions, guest sessions, transfers, integrity verification, and persistence.

### Windows Shell (`src-tauri`)

- Tauri v2 hosts the core and owns application/window lifecycle, tray behavior, dialogs, and frontend commands/events.
- Windows-specific adapters implement source file sharing modes, protected named-pipe IPC, and Explorer virtual-file drag-out.
- Use `clap` for minimal share/list/download CLI commands. Communicate with the running application through a Windows named pipe restricted to the current user. Do not expose CLI actions through LAN HTTP or an unauthenticated localhost endpoint.
- Add only plugins required by v1. Clipboard plugins and clipboard shortcuts are out of scope.

### Frontends

- **Desktop:** React 19, TypeScript, Vite, Tailwind CSS, Shadcn UI, Lucide icons, Zustand, and `qrcode.react`. Use a dark-first, keyboard-accessible UI.
- **Guest:** lightweight HTML/JavaScript with all scripts, styles, fonts, and assets bundled locally. No external service or asset requests.
- Rust remains authoritative. Zustand holds a view of state; reconnecting/reopening the frontend obtains a fresh snapshot instead of relying exclusively on progress events.
- Guest downloads use ordinary browser-managed downloads, not complete-file JavaScript `Blob` buffering.

---

## 4. Sharing Model and User Flows

### Publishing

1. The user selects a local file/folder or drops it from Explorer into Ulak.
2. The core registers its existing source location under an opaque share ID. File content stays at the original location.
3. The user chooses an audience: selected paired devices (including offline devices), selected guest sessions, or **Everyone on the local network**. The rest of the filesystem remains private.
4. Removing a share prevents new listings and downloads. Missing sources appear unavailable rather than being silently recreated or served from staged copies.

### Share Audiences

- **Selected devices:** choose from all persistently paired devices, including those currently offline. Store grants against verified device identities, never IP addresses. A bulk **Select all paired devices** action selects the current list; it does not make the share LAN-open or automatically grant future pairings access.
- **Guest access:** explicitly include shares in a scoped browser invitation/session. Keep the invitation and revocation flow available for restricted guest access.
- **Everyone on the local network:** provide this as a first-class audience option. Any device within the server's allowed LAN scope may browse and download these shares without pairing, a guest invitation, or per-download approval. This includes devices that join the LAN later while the share remains open. Browser access remains read-only; native clients may use the native download flow.
- LAN-open access applies only to shares explicitly marked with that audience. Enforce the allowed LAN interfaces/address ranges on the server for listing, metadata, and file/range requests; network reachability alone must not make an Internet or out-of-scope request eligible. TLS and server certificate/identity verification still apply.
- Show the current audience on every share row and in its details. Changing a LAN-open share to a restricted audience immediately prevents new unauthorized listings and download/range requests. LAN-open readers cannot change shares, permissions, pairing, or application settings.
- Granting access to an offline device publishes a permission; it does not push, queue, or copy files to that device. The recipient can browse and pull later when both agents are reachable and the source remains available. Automatic synchronization remains out of scope.

### Paired-PC Browsing and Pull Downloads

1. Discover another agent using mDNS or enter its address manually.
2. Pair and authenticate before exposing the authorized catalog.
3. Browse permitted shares, select content, and choose a destination on the recipient PC.
4. Start the download on the recipient. Publication permissions replace repeated sender approval prompts for each transfer.
5. Either PC can publish and receive through the same flow. Source changes are not automatically synchronized to other devices.

For LAN-open shares, recipients discover the host or enter its address, verify the server through the applicable TLS/identity trust flow, and browse only LAN-open content without pairing. Pairing remains necessary to access shares granted specifically to that device. Browser recipients use the guest web interface with the access rules in section 8.

### Catalog and Folder Handling

- Enforce the same audience permissions on listing, metadata, and download requests.
- Folder browsing returns paginated immediate children. Enumerate trees incrementally for native folder downloads rather than building an unbounded manifest.
- Use opaque entry IDs over the network. Do not accept arbitrary client-supplied disk paths or disclose absolute source paths in the remote catalog.
- Reject traversal, absolute paths, reserved Windows names, and reparse-point escapes from an authorized root. Validate destination paths independently.
- Native folder downloads preserve the selected hierarchy and use a destination picker. Guests browse folders and download individual files; archive generation is deferred.

---

## 5. Identity, Discovery, and Network Interfaces

### Persistent Identity and Pairing

- Persist device identity keys, paired-peer trust, share references/permissions, and native transfer checkpoints. Certificate renewal must not silently replace a paired identity.
- Identify a device by its persistent cryptographic identity, not its IP address, hostname, or display name. After DHCP changes or switching between Ethernet and Wi-Fi, verify the identity at the new endpoint and update the existing device record. Preserve its pairing, audience grants, and history; do not create a duplicate solely because the address changed.
- Discovery advertisements supply candidate endpoints only. A claimed name or device ID cannot replace identity verification. A fresh installation that has lost its identity keys is a new identity and requires pairing again for restricted access.
- Pair PCs by selecting a discovered device and explicitly confirming the same short comparison number on both computers. Bind the comparison to signed full descriptors and committed random nonces; discovery alone must never establish trust. Keep expiring, single-use links with a high-entropy credential as a manual alternative. Authenticate subsequent native connections against the paired identity.
- Support unpairing/revocation and manual connections when multicast discovery fails.
- mDNS may advertise device ID/name, protocol version, addresses, port, and fingerprint. Treat advertisements as untrusted until authenticated.
- Prefer reachable interfaces using connection attempts and observed performance. Interface type may be a hint; do not infer guaranteed transport or throughput from an IP subnet.

### Device Presence and Persistence

- Keep paired devices in the device list across application restarts and periods of unavailability. Persist their identity, user-facing name, last-known endpoints, and last successful connection time.
- Show paired devices as online only after a successful verified connection. An advertisement alone is not proof of availability or identity. Show unreachable paired devices as **Offline**, retaining their last successful connection time; do not claim to know that they are powered off.
- A powered-off or sleeping PC, disconnected network, stopped agent, or blocked connection may all make a device unavailable. An Ethernet cable alone does not make the peer reachable. Closing the Ulak window to the tray leaves the agent running.
- Show newly discovered, unpaired Ulak agents separately under **Found on the network** while discovery information is fresh. This is not an inventory of every computer or phone on the LAN. Offer pairing and, where available, browsing the host's LAN-open shares.
- Reconnect a known device under the same record after verifying its identity at its current address. Do not erase an offline device or its share grants when discovery expires.

### API and State Boundaries

- Separate authenticated native APIs from browser guest APIs. Guests must not gain native pairing, share-management, CLI, or unrestricted filesystem access.
- Restricted native access uses paired-device authentication. Restricted browser access uses scoped, expiring guest sessions over trusted local HTTPS. LAN-open access uses a separate read-only policy that checks the request's allowed LAN scope and exposes only LAN-open shares without requiring pairing or an invitation.
- Keep LAN-open catalog/download access separate from privileged native control operations. An unpaired native client may download LAN-open content but cannot claim a paired identity, access restricted shares, or manage the host. Server TLS/identity verification must not silently trust unverified discovery data.
- Negotiate protocol version and capabilities before native operations.
- Introduce versioned interfaces for pairing/revocation; share publication/removal and audiences; authorized catalog and paginated directory browsing; download preparation and source revision metadata; range streaming and integrity metadata; transfer lifecycle; and guest invitation/session lifecycle.
- Use explicit states such as queued, preparing, transferring, interrupted, verifying, completed, cancelled, and failed. Expose recoverable errors to the UI and CLI.
- File bytes travel over streaming HTTP connections. Control messages/frontend events carry metadata, state changes, and throttled progress only.
- Download authorization belongs to the server providing the bytes. Do not trust a recipient-generated token without explicit server-side registration and validation.

---

## 6. Reliable Native Transfer Pipeline

1. **Prepare:** authorize the request, resolve the selected entry, and identify its source revision. Revalidate before starting or resuming. Changed revisions require restarting rather than mixing file versions.
2. **Protect the source:** hold Windows source handles that prevent writes/deletion during active transfers. Report inability to obtain a suitable handle as an explicit error.
3. **Choose the destination:** exclusively create a `.part` file inside the requested destination directory. Default collisions to a numbered filename; never silently overwrite.
4. **Stream:** read the existing source with bounded buffers and write directly to the partial file. Propagate backpressure, cancellation, network failures, and disk/write errors.
5. **Checkpoint:** persist the peer/source revision, destination information, and actual written offset required for restart recovery. Logical file length is not a substitute for written progress.
6. **Resume:** validate HTTP ranges and the source revision. Implement correct partial-content and unsatisfiable-range responses; advertising `Accept-Ranges` alone is not resume support.
7. **Verify:** expose a lazily computed, cached BLAKE3 digest per source revision. Verify the complete native download, including resumed content, before finalization. Hashing uses bounded reads and creates no file copy.
8. **Finalize:** close the verified partial file and rename it without replacing an existing destination. Mark completion only after successful finalization.

### Allocation and Telemetry

- Disk-space allocation is platform-specific and best effort. `set_len()` changes logical length; it does not guarantee reserved space or contiguous blocks.
- Check available space where useful and handle disk exhaustion throughout writing and finalization.
- Use a core-owned transfer manager with concurrency limits, bounded queues, cancellation, and persisted checkpoints.
- Emit throttled progress/speed updates, approximately every 100 ms during active transfers, along with lifecycle events and recoverable state snapshots.

---

## 7. Windows Drag-and-Drop

### Explorer to Ulak

Accept local files and folders dropped into the UI and register them as shares through the normal audience-selection flow. Dropping a source does not copy it into application storage.

### Ulak to Explorer

- Allow selected remote files to be dragged into an Explorer folder without downloading complete files before the drag begins.
- Implement Windows virtual-file descriptors and streamed `IStream` content, including range-backed seeking and source revision validation.
- Support multiple files, progress, cancellation, and explicit network/source failure reporting. Do not stage complete local files to simulate drag-out.
- Explorer owns destination writing, naming, and cleanup. Checkpointed resume is guaranteed for Ulak-managed downloads; Explorer drag-out supports cancellation and explicit failure/retry.
- Download entire remote folders through the native destination picker in v1; dragging them out is deferred.

Reference: [Windows Shell virtual-file streaming](https://learn.microsoft.com/en-us/windows/win32/shell/clipboard).

---

## 8. Offline Browser Guest Mode

### Certificate Onboarding

- Generate a persistent local certificate authority and guest-server certificates covering advertised local addresses. Protect private keys; export only the public certificate required for trust setup.
- Provide certificate export and a local onboarding page serving only setup instructions and the public certificate. Shared content requires trusted HTTPS and authorization under the selected share audience.
- Explain certificate verification against the host and manual trust installation. A QR code cannot bypass browser certificate validation.
- On iOS, installing a certificate profile does not automatically enable SSL trust; the user must explicitly enable it in Certificate Trust Settings.
- After trust setup, guests connect to local HTTPS. No internet, hosted infrastructure, or Ulak app installation is required.

Reference: [Apple instructions for manually trusted certificates](https://support.apple.com/en-us/102390).

### Sessions and Downloads

- The browser interface supports both invitation-scoped restricted access and **Everyone on the local network** access. After certificate onboarding, a visitor within the allowed LAN scope may browse LAN-open shares without redeeming an invitation. A plain local link or QR code can open this view; it does not grant access to restricted shares.
- The host selects the shares available to an invitation and displays its QR code.
- Exchange the expiring, single-use invitation credential for a secure session scoped to those shares. Avoid retaining credentials in URLs or logs after redemption.
- Default sessions to **30 minutes of inactivity** and an **eight-hour maximum lifetime**. Enforce expiry server-side and support immediate host revocation; tab closure is not a reliable expiry mechanism.
- Offer read-only folder browsing and individual file downloads in both access modes. Apply the relevant guest-session or LAN-open audience policy to listing, metadata, and download requests, including range requests. An expired guest session cannot authorize restricted content; independently LAN-open shares remain accessible to eligible LAN visitors.
- Stream responses from the existing source. Use ordinary browser downloads rather than accumulating the response in JavaScript.
- Save location, partial-file cleanup, interrupted-download recovery, and browser resource usage are browser-dependent. Do not claim native downloader guarantees for guests.
- Guest upload, clipboard operations, and whole-folder ZIP generation remain out of scope.

---

## 9. Repository Layout and Desktop UX

```text
ulak/
|-- context.md                  # Current architecture and implementation contract
|-- Cargo.toml                  # Rust workspace
|-- crates/
|   `-- ulak-core/              # Reusable protocol, trust, catalog, and transfer core
|-- src-tauri/                  # Windows shell, CLI IPC, and OS integrations
|-- src/                        # React desktop UI
|-- guest/                      # Embedded offline guest UI and onboarding assets
|-- tests/                      # Cross-component and acceptance test support
`-- package.json
```

- Provide local shares/audiences, discovered/paired peers, remote browsing, a transfer queue, guest invitation management, and clear error/retry actions.
- Closing the main window hides it to the tray while the core continues running. Provide an explicit quit action.
- Support keyboard navigation and a native destination picker alongside drag-and-drop.
- The frontend never becomes authoritative for permissions, checkpoints, or transfer completion.

### Design Direction and Window Structure

- Prioritize compact desktop presentation, keyboard access, and contextual actions, with disciplined spacing, readable typography, and a clear hierarchy centered on device/file rows and search. Use structured lists and a detail panel for file browsing and longer tasks. The main application is a compact, resizable window with enough room to inspect folders and transfers; it is not limited to a command palette.
- The previous desktop visual implementation was rejected. The compact revision removes large promotional headings, slogans, decorative icon areas, excess framing, and broad accent fills; it is ready for user review. Preserve readable density, disciplined proportions, and contextual actions. A dark palette and sidebar alone do not satisfy this direction, and passing tests do not establish visual acceptance.
- Use a dark-first graphite background, subtly lighter panels, off-white text, and a restrained amber accent. Reserve status colors for meaningful states. Prefer thin borders, 8–12 px corner radii, readable typography, short transitions, and limited blur on small surfaces.
- Use a narrow sidebar with **Devices**, **My shares**, and **Transfers**. Make guest invitations and sessions reachable from share details and the share-management view. Open on Devices, with quick access to recent shares.
- Prefer aligned rows over large cards for devices and files. Show details and actions in a right-side panel only when an item is selected; allow closing it to restore list space. Keep filenames, size, availability, and share audience easy to scan.
- Keep a primary **Add share** action and an obvious Explorer drop target. Follow source selection with **Who can access?**, offering selected paired devices, guest access, and **Everyone on the local network**. Use publication and download terminology that matches the pull model.
- Provide a `Ctrl+K` command menu for finding devices, opening shares, and invoking actions. Keep the same actions accessible through visible controls and support complete keyboard navigation.
- Focus the command input when its menu opens. `Ctrl+F` focuses the current list filter outside dialogs; Arrow keys, Home, and End navigate list actions, Enter opens a device's verified shares, and Escape clears the filter or list selection. Remote filtering applies to the loaded bounded page and preserves file selections.
- While transfers are active, keep a compact status area visible across views with filename, progress, speed, and pause/cancel actions as supported by the transfer state. Show preparation, interruption, verification, and completion distinctly; do not mark a download complete before verification and finalization.

### Devices Screen and Audience Picker

- Treat Devices as a persistent address book of paired computers with changing availability, plus a separate live discovery section. List online paired devices first and offline paired devices below with subdued styling and last successful connection time. Keep offline entries selectable for inspection and share permission changes.
- Selecting a reachable device opens its permitted shares and folder browser. Selecting an offline device opens its identity, last connection, and permission details with a clear unavailable state. Do not imply its remote files can currently be fetched.
- The audience picker lists all paired devices with checkboxes and online/offline status, and offers **Pair a new device**. Offline status does not disable granting access. Newly discovered devices must be paired before receiving identity-specific grants; LAN-open access remains a separate audience choice.
- Show access information directly on share rows, such as **2 devices**, **1 guest session**, or **Everyone on the local network**, and expose the actual recipients in details. Keep device identity and access scope visible without requiring users to understand IP addresses.
- Provide step-by-step guest certificate onboarding, invitation/QR display, and session revocation within the guest-access flow. Keep browser onboarding accurate about certificate trust requirements.
- Use plain English throughout authored product text, source comments, and documentation. Describe downloads as Waiting, Getting ready, Downloading, Checking file, and Downloaded while preserving the underlying core state distinctions. Put diagnostic errors and connection internals in expandable details.
- Make the ordinary connection flow a live nearby-device list followed by the same six-digit number on both computers and **Match and pair**. Display incoming requests across views, bring a hidden window forward for an incoming comparison, wait for both approvals, and refresh verified presence after pairing. Retain invitation creation/pasting under Other ways to connect, with mismatched discovery identities rejected.
- Provide an explicit Wi-Fi/Ethernet choice using active Windows adapter addresses and their real prefixes. The Add a device dialog can enable a selected connection in one explicit action. Connection settings retain a separate preview/Apply flow and custom fields under Advanced settings. Keep the loopback default until the user chooses a connection. Explain automatic Ulak discovery and distinguish it from an inventory of the whole network.
- The command menu provides a focused search input, grouped actions/devices/shares, compact icon rows, secondary descriptions, shortcut badges, and navigation/action hints. Enter opens or runs the highlighted result; Escape closes it; reopening clears the prior search. Support Ctrl+1/2/3 for main views, Ctrl+, for connection settings, and Ctrl+Alt+U to reopen the running desktop from another app. Repeated launches of the same data directory focus the existing window, while isolated data directories remain independent.
- Call the public certificate fingerprint **Security code for browser setup** in the product. Explain its comparison step where browser guests install the certificate; native PC pairing does not require users to handle this code.

---

## 10. Implementation Order

1. **Feasibility prototypes:** validate offline trusted HTTPS on Safari/iOS and Chrome/Android, and Windows remote-file drag-out into Explorer without staging. Record actual device-dependent results and limitations.
2. **Trusted core:** initialize the Rust workspace and Windows shell; implement persistent identities, TLS, pairing/revocation, discovery, manual connection, and authenticated versioned interfaces.
3. **Sharing and reliable downloads:** implement identity-based grants, scoped guest access and the explicit LAN-open audience policy, catalog browsing, incremental folder enumeration, bounded streaming, revision checks, integrity verification, cancellation, collision handling, and restart recovery.
4. **Desktop integration:** implement the compact desktop layout, persistent device list and offline audience picker, command menu, two-way drag-and-drop, tray lifecycle, transfer queue/state snapshots, and the minimal share/list/download CLI through protected named-pipe IPC.
5. **Guest release:** finish offline assets, certificate onboarding, scoped invitations, browser browsing/downloads, expiry, and revocation.

Do not reintroduce deferred clipboard, compression, native mobile, or cross-platform agent work during these phases.

---

## 11. Acceptance Criteria

- A paired PC sees and downloads only authorized shares into a selected directory. Both PCs can publish and receive.
- A paired device remains listed while offline and can be selected as a share recipient. When both agents are reachable again, it can browse and pull authorized content without a new grant or automatic file push.
- A paired PC that changes IP address or network interface is recognized by its verified persistent identity, retaining the same device entry, trust, and permissions. A peer claiming the same name or ID without the identity keys cannot inherit that trust.
- An unpaired native client or browser on the allowed LAN can browse and download explicitly LAN-open shares without pairing or an invitation, including after joining the LAN later. Restricted shares and management APIs remain inaccessible without their required authorization. Requests outside the allowed LAN scope cannot use the LAN-open policy.
- Restricting or removing a LAN-open share prevents subsequent unauthorized listings, metadata requests, downloads, and range requests. TLS/server verification and browser certificate onboarding still apply to LAN-open access.
- The Devices screen distinguishes persistent paired entries from transient unpaired discovery results. The audience picker includes offline paired devices and the **Everyone on the local network** option. Active transfer status remains visible across views, including verification.
- Share registration retains source references without copying content. Missing sources appear unavailable.
- A 50 GB transfer completes with memory consumption independent of file size. Concurrent transfers and large directory trees remain bounded.
- Interrupted Ulak-managed downloads resume correctly after application restart without treating preallocated logical file length as progress.
- Source changes, disk exhaustion, collisions, invalid ranges, and integrity failures produce explicit recoverable errors rather than silent completion or overwrite.
- Native downloads finalize only after successful complete-file verification.
- Adding shares and starting Explorer drag-out create no application staging copies.
- Explorer drag-out supports multiple remote files, range-backed seeking, cancellation, and network-failure reporting. Explorer-to-Ulak drops publish local files and folders.
- Android/iOS guests browse and download with internet disconnected after certificate onboarding. Guest pages make no external asset or service requests.
- Unpaired peers, unauthorized paired devices, expired/replayed invitations, expired/revoked sessions, malicious paths, and reparse-point escapes cannot access content outside their permissions.
- CLI IPC rejects other users and is not exposed through LAN HTTP routes.
- Report automated checks and manual hardware tests separately. Second-PC, real-phone, Explorer, and 50 GB acceptance tests are passed only after actually exercising them.
