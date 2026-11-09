# Protocol v1

All content and native control endpoints use HTTPS. Requests are served directly from existing sources. The optional plaintext listener has a separate router containing only public CA setup material.

## Identity and connection trust

Each state directory owns a persistent Ed25519 signing key and local certificate authority. The device ID is BLAKE3 of the Ed25519 public key. Names and IP addresses do not establish identity. A public connection descriptor includes the identity, reachable HTTPS origin, and public CA certificate. Native clients accept only that CA, disable redirects and proxies, verify the TLS server name/IP, and verify a fresh signed identity challenge from the server.

mDNS uses `_ulak._tcp.local.` and supplies untrusted endpoint candidates. Discovery does not create pairing, grant access, or mark a device verified online. Reconnecting to a known device at a changed address must reuse its trusted CA and verify its persistent identity before updating the saved endpoint. Paired records and grants survive discovery expiry and offline periods.

## Endpoints

| Method and route | Purpose |
| --- | --- |
| `GET /v1/hello?challenge=...` | Protocol version, capabilities, identity, signed caller challenge |
| `POST /v1/pair` | Redeem single-use pairing invitation with recipient identity proof |
| `POST /v1/guest/redeem` | Redeem a single-use scoped guest token for a secure cookie |
| `GET /v1/shares?cursor=...` | Page through authorized shares |
| `GET /v1/shares/{id}/entries?entry=...&cursor=...` | Page immediate directory children; entry omitted for share root |
| `GET /v1/shares/{id}/entries?cursor=...&touch=true` | Refresh an authorized directory cursor without consuming entries |
| `GET /v1/shares/{id}/prepare?entry=...` | Source size, revision, and lazily computed BLAKE3 digest |
| `GET /v1/shares/{id}/file?entry=...&revision=...` | Stream a complete file or a single HTTP byte range |

Catalog entry IDs are randomized XChaCha20-Poly1305 tokens bound to their share. Clients cannot supply arbitrary filesystem paths. Native downloads negotiate protocol/capabilities before accessing content. Folder downloads enumerate incrementally on the recipient.

## Authentication and authorization

Restricted device reads carry `X-Ulak-Device`, `X-Ulak-Time`, `X-Ulak-Nonce`, and `X-Ulak-Signature`. The signed UTF-8 payload is `ulak-v1`, method, exact path/query target, timestamp, and nonce separated by newlines. The server verifies the paired identity, allows 60 seconds of clock skew, and keeps a bounded replay cache for 120 seconds. This signed-read mechanism does not expose mutations or management endpoints. Pairing has its own signature covering the complete token and recipient descriptor.

Guest sessions use a Secure, HttpOnly, SameSite=Strict cookie or a bearer token for core clients. Invitations are stored as hashed credentials, expire after five minutes, and are consumed transactionally with creation of the peer/session. Guest sessions are scoped to share IDs, expire after 30 minutes of inactivity or eight hours total, and can be revoked locally. Session status, share audiences, and pairing trust are persisted atomically under an exclusive process lock.

The LAN-open policy permits anonymous reads only for shares explicitly marked `lan`, and only when the socket's source address is in a configured allowed range. Forwarded headers do not establish LAN membership. Listing, metadata, and byte-range requests all apply the same policy. A LAN-open reader cannot manage shares, pair itself without an invitation, or access restricted content.

## Transfer behavior

The server locks each source against concurrent writes and deletion on Windows, validates its opaque entry and revision, and streams bounded chunks with backpressure. `ETag` identifies the revision. Downloads validate `If-Match`, requested revision, response length, and `Content-Range`. Unsatisfiable ranges return 416 with `Content-Range: bytes */SIZE`; changed revisions return 412. Multiple ranges are rejected.

The native downloader exclusively creates a randomized partial file in the selected destination directory. It records only flushed progress, truncates uncheckpointed tails before resuming, verifies the complete file including previously downloaded bytes, closes it, and renames without replacement. Filename collisions receive numbered names. A crash between final rename and checkpoint completion can be reconciled by verifying the persisted final target without contacting the sender.

Transfer lifecycle states are queued, preparing, transferring, interrupted, verifying, completed, cancelled, and failed. Snapshots survive application restarts; active-state records become interrupted at startup. Broadcast progress is throttled to roughly 100 ms and must not replace persistent state. Folder jobs currently compose per-file checkpoints; recovery resumes individual file transfers rather than automatically restarting an entire folder job.
