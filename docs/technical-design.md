# Jot technical design and master development plan

Status: proposed for approval  
Date: 2026-09-08  
Scope: iOS, Android, macOS, and Windows only

## Executive decision

The proposed system is feasible with a small content-blind relay and no Jot content backend. Expo development builds are the right mobile shell, Tauri v2 is the right desktop shell, and Metro plus Vite is the correct bundler split. The central architecture is one versioned document schema, one CRDT and sync engine, native editors on mobile, a ProseMirror editor on desktop, SQLite as the local source of truth, Google Drive as an untrusted file transport, and a replaceable relay that carries invalidation signals only.

I recommend Yjs as the CRDT, an append-only remote protocol with no shared mutable manifest, `expo-sqlite` on mobile, SQLite behind Tauri commands on desktop, one Rust cryptography core for every target, and Convex as the first relay adapter if its privacy and retention settings pass the Phase 2 review. Each note has its own Yjs document. Clients load notes on demand instead of holding a vault-sized CRDT in memory.

This is a large v1. One experienced engineer should plan for roughly 17 to 23 months, excluding an independent cryptographic review and unpredictable store review time. The native editor work is likely 35 to 45 percent of the engineering effort. The Phase 0.5 spike is a real go or no-go gate, not a demonstration that gets thrown away.

### Corrections and conflicts in the brief

1. **Bun is not the shipped application runtime.** Bun can run repository scripts, install packages, and execute tests. Hermes runs mobile JavaScript. JavaScriptCore or WebView2 runs the desktop frontend, and Rust runs the Tauri host. Calling Bun the package manager and development runtime is accurate. Calling it the application runtime is not.
2. **Installed-app OAuth still belongs on each device.** Desktop can use authorization code plus S256 PKCE, a loopback listener, and a locally stored refresh token. iOS can use Google's native SDK, which restores sign-in and refreshes tokens locally. Android should use Google's native Authorization API. Google no longer accepts custom URI schemes for Android OAuth clients, so a generic `expo-auth-session` flow is the wrong production choice there. Expo development builds support the native modules this requires. The relay does not improve or replace these flows.
3. **The relay is not a Drive data proxy.** A backend that receives unencrypted Drive payloads or holds a user's Drive token can read that user's notes, even if it never persists them. That contradicts "I never see their data." Clients must keep Drive credentials and transfer all user content directly to Drive. The relay receives empty change notifications and sends invalidation signals.
4. **Refresh tokens are durable, not immortal.** Users can revoke access, policies can invalidate grants, and time-based access can expire. Android's native SDK may retain and refresh credentials without exposing a raw refresh token to TypeScript. The product must handle reauthorization without treating it as data loss.
5. **The relay makes Drive push usable, but it does not make mobile background sync immediate.** Drive push channels call the relay's HTTPS webhook. The notification contains no changed file body, so the relay wakes devices and each client calls `changes.list` directly. APNs, FCM, and mobile operating systems can delay or discard background delivery. Foreground and periodic polling remain the correctness fallback.
6. **"Version history is close to free" is wrong.** CRDT merge metadata helps, but user-visible history needs retained snapshots, labels, pruning rules, and restore semantics. Yjs history examples keep deleted content or separate versions, which increases storage. Jot must budget and test this as a feature.
7. **The literal no-loss invariant is physically impossible.** Software cannot recover an edit that the input method has not committed, a write that has not reached stable storage, failed storage hardware, or a device destroyed before sync. This design gives a precise promise: once Jot acknowledges a committed edit, process kill and crash recovery preserve it. Phase 0.5 must measure the latency cost of that promise.
8. **A single command cannot launch all four targets on one computer.** iOS and macOS builds require macOS. Windows packaging requires Windows. One root command can run every platform-independent check and dispatch a CI matrix that builds all four targets. Local development commands can launch every target supported by the host.
9. **The requested phase order conflicts with mobile-first priority.** Deferring mobile share sheets, widgets, import, export, accessibility, and store submission until after desktop makes desktop block mobile. The plan adds a Phase 3.5 mobile ship gate before Phase 4.
10. **"Import from Apple Notes" has no clean cross-platform definition.** Apple exposes no supported bulk Notes export interface for third-party apps on all targets. A macOS importer can request Automation permission and read Notes through AppleScript, with known fidelity gaps. The share sheet can import one note at a time. Directly reading Apple's private Notes database is rejected.
11. **An iOS widget cannot host a normal keyboard text editor.** The widget can show pinned or recent notes and open the app directly into native quick capture. Android can do the same. Quick capture remains one tap, but it is not inline typing inside the iOS widget.
12. **Sharing is not technically impossible without a backend.** Drive permissions, exported bundles, or peer-to-peer transport could support limited sharing. Reliable identity, key distribution, access revocation, and product-quality collaboration would be a different system. Keeping all sharing out of v1 is still the right call.
13. **A visible Drive folder is user-owned and inspectable, but the sync representation is not the portable export.** CRDT packs and encrypted objects are protocol files. Jot will include a plain README in the folder and a separate Markdown export readable without Jot.
14. **Adding a relay changes the privacy claim.** Jot still has no content backend and no account system, but it now operates infrastructure that sees IP addresses, opaque device endpoints, and notification timing. Privacy copy must say that plainly. "No backend" is no longer accurate marketing. A public HTTPS host can also receive arbitrary bytes from a malicious caller before application code rejects them. The testable promise is that official clients never send content, the relay exposes no content-ingestion route, and it has no Drive credential.
15. **No browser app does not mean no web presence or cloud operations.** Google requires a public home page and privacy policy for a production OAuth application. Jot also needs a Google Cloud project, relay deployment, consent-screen verification, quota monitoring, push-provider credentials, and incident response. Those are operational systems, not a browser version of Jot.

Nothing in the explicit out-of-scope list should move into v1. Handwriting, scanning, and voice would each add new native capture and attachment lifecycles. Smart folders would add a second query language while search and sync are still settling. Collaboration and sharing need identity, permissions, and key-distribution design. The existing v1 is already at the practical limit.

## 1. Technical design document

### 1.1 System shape

```text
native mobile editor or ProseMirror
                 |
                 v
       durable edit journal
                 |
                 v
   schema validation and Yjs document
                 |
                 v
 SQLite transaction: CRDT update, projection, undo entry, outbox
                 |
                 v
                    sync coordinator
                    /              \
                   v                v
       StorageProvider       ChangeWakeup interface
          /       \               /          \
     memory     Google Drive    memory      relay client
                    |                          |
                    v                          v
             user content path       opaque invalidations only
```

The important seams are small:

- The editor interface exchanges schema documents, schema operations, stable selections, and acknowledgements. It never exposes `NSRange`, `Spannable`, or ProseMirror transactions to the rest of the product.
- `LocalStore` commits edits, projections, undo records, and sync work atomically. It has one Expo SQLite adapter and one Tauri SQLite adapter.
- `StorageProvider` exposes immutable object storage and a change cursor. The sync module knows nothing about Drive file IDs, HTTP status payloads, or OAuth.
- `ChangeWakeup` tells a provider adapter when checking its authoritative change cursor may be useful. It carries no user content and can disappear without affecting correctness.
- The crypto interface seals and opens versioned envelopes. The sync module does not choose algorithms or touch platform key stores.

This follows the deletion test. Removing any of these modules would spread meaningful complexity across several callers, so each earns its interface.

### 1.2 Application and bundler choices

Metro for Expo and Vite for Tauri is the clean split. React Native is not a DOM runtime, and forcing Vite into that toolchain would fight Expo, React Native transforms, native asset resolution, and over-the-air bundle conventions. There is no benefit once web is out of scope.

Expo must use development builds from the start. Expo Go cannot load the editor, crypto, database configuration, share extension, widget, or native Google authorization code. Native iOS and Android projects should be generated deterministically and committed once custom extension targets make continuous prebuild regeneration risky.

Tauri v2 mobile is rejected for v1. It is a real option and can target iOS and Android, but its frontend is still HTML, CSS, and JavaScript inside a WebView. Meeting the native editor decision would require embedding and coordinating a `UITextView` or `EditText` beside that WebView through custom Tauri plugins. Share extensions, widgets, camera and photo flows, keyboard insets, accessibility, and OS-specific navigation would still need native work. The apparent one-codebase saving disappears at the hardest part of the product. Expo has the stronger mobile module and application ecosystem, and the product explicitly values mobile before desktop.

### 1.3 OAuth and credential custody

Use one Google Cloud project with separate iOS, Android, macOS desktop, and Windows desktop client registrations.

| Target | Authorization implementation | Redirect and token handling |
| --- | --- | --- |
| iOS | Google Sign-In iOS SDK behind an Expo auth module | Reversed client-ID callback handled by the app. The SDK restores the prior sign-in and refreshes access tokens. |
| Android | Google Identity Services Authorization API behind the same Expo auth interface | Native pending-intent flow tied to package name and signing certificate. Do not use a custom URI scheme. The SDK refreshes cached authorization locally. |
| macOS | System browser launched by the Tauri Rust host | S256 PKCE and a random-port `127.0.0.1` loopback listener. Store the refresh token in Keychain. |
| Windows | System browser launched by the Tauri Rust host | S256 PKCE and a random-port `127.0.0.1` loopback listener. Store the refresh token in Credential Manager. |

Every client is public and has no meaningful client secret. The Rust and native adapters provide `authorize`, `freshAccessToken`, `revoke`, and `authorizationState`. TypeScript never receives a refresh token unless a platform SDK requires it. Tokens never enter SQLite, logs, crash reports, exports, or Drive.

The relay never participates in OAuth and never receives an authorization code, access token, refresh token, or resumable-upload URL. Those values grant access to user content. Moving them to the relay would turn a content-blind coordination system into a privileged Drive proxy.

This needs an early integration test. Confirm that files created under `drive.file` by one client ID in the Cloud project remain visible to the other platform client IDs. Google's wording is app-oriented, but this exact four-client arrangement should be proven before the Drive format is fixed. If it fails, the fallback is a user-mediated folder grant on each new platform, not a broader Drive scope.

Sources: [Google OAuth for installed apps](https://developers.google.com/identity/protocols/oauth2/native-app), [Google iOS API access](https://developers.google.com/identity/sign-in/ios/api-access), [Expo Google authentication](https://docs.expo.dev/guides/google-authentication/), and [Drive scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

### 1.4 Document model and conflict resolution

#### Choice

Choose Yjs 13 for the first production prototype, behind a narrow `CrdtDocument` interface. Do not let Yjs types escape `packages/core` and `packages/editor-web`.

| Option | Package and runtime cost | Mobile fit | Rich structure and editor fit | Long-term concern | Verdict |
| --- | --- | --- | --- | --- | --- |
| Yjs | Current npm tarball is about 436 KB and the CommonJS distribution is about 304 KB before app bundling. It is pure JavaScript. Final Metro and Vite sizes must be measured. | Best of the three for Hermes because it avoids a WASM bootstrap. React Native still needs release-build tests and secure random initialization. | `Y.XmlFragment` holds structured rich text directly. `y-prosemirror` is mature and schema-aware. | Tombstones and retained history grow. Persistent native-editor bindings are custom work. | Recommend. |
| Loro | Current npm tarball is about 5.9 MB and includes a roughly 3.1 MB WASM binary before compression. | Weak today. Its documented JavaScript path initializes WASM, which remains an integration and startup risk under Hermes. Native Swift exists, but Kotlin parity would create a split implementation. | Strong text, tree, version-control, and shallow-snapshot ideas. ProseMirror integration is less established than Yjs. | Promising enough to benchmark during Phase 0.5, not mature enough to anchor v1 mobile. | Rejected for v1. |
| Automerge | Current npm tarball is about 14 MB and includes a roughly 3.4 MB WASM binary, plus base64 builds. Final bundle size varies by entry point. | Newer packages describe React Native loading options, but WASM packaging and memory remain higher-risk than pure JS. | It now has marks and block markers for rich text. ProseMirror bindings and Jot's exact schema need more proof. | Full history is valuable but expensive. Mobile memory and startup are the concern. | Rejected for v1. |

The package figures above were measured from npm packages on 2026-09-08. They are not installed-app size claims. Phase 0.5 must record Hermes heap, cold-open time, update size, and final binary contribution for pinned versions.

Yjs gives Jot direct structured state, not an opaque JSON or Markdown blob. Each note owns one Yjs document with a `Y.Text` title, a `Y.XmlFragment` document, and small metadata types. Folder and tag entities use separate small CRDT documents. Only open notes and entities touched by the current sync batch enter memory. SQLite stores projections for lists and search.

The canonical schema remains authoritative. Yjs is a merge representation, not permission to store arbitrary XML nodes. Every local or remote transaction validates node names, attributes, nesting, limits, and schema version before it can update projections.

#### Concurrent editing

Each installation gets a random device ID for remote ownership and acknowledgement. Each loaded Yjs document keeps Yjs's own randomly generated client ID. Jot does not derive it from the device ID, persist it for reuse after restoring a document, or set it manually. Local edit transactions carry a stable transaction ID. Duplicate delivery is harmless because the journal and sync ledger reject an already applied transaction ID, and Yjs updates are idempotent.

Two devices that edit offline create independent Yjs updates. When either device reconnects, it downloads missing immutable packs, applies valid updates to the local document, recomputes the canonical projection, and publishes any missing local packs. No client replaces its local document with a remote snapshot. A merge can change visible order, but it cannot discard either sequence of body edits.

Concurrent metadata needs explicit semantics:

- Title is collaborative `Y.Text`, so simultaneous title edits merge as text.
- Tags use an observed-remove set. A concurrent add survives a remove that did not observe it.
- Pin, archive, trash, folder placement, and manual-order changes are immutable events. A deterministic Lamport order selects current state, while the losing event remains in diagnostic history.
- Folder cycle resolution removes the newest parent edge involved in a cycle and records a repair event. It never deletes a folder or its notes.
- Restoring a version writes a new CRDT transaction. It never rewinds the CRDT clock.

#### Growth and compaction

CRDT storage is not bounded. Sequential Yjs structs can merge, deleted content can be garbage-collected in some cases, and compact checkpoints reduce update-log overhead. A heavily edited note still grows over time because identity and deletion information cannot all disappear without harming late merges.

Locally, create a checkpoint after either 500 committed transactions or 1 MiB of incremental updates, then keep later updates separate. Remote sync aggregates transactions into immutable packs capped at 256 KiB or two seconds of edits. A compactor can load a note, apply all covered packs with Yjs garbage collection enabled, and publish a new checkpoint plus state vector.

Compaction never renumbers Yjs clocks. An older client that supports the same remote and schema versions can merge changes against a compact checkpoint. Jot retains covered packs until every active device acknowledges the checkpoint or 180 days pass. A device absent longer than 180 days must rebootstrap before it may publish. Its unsynced local changes are imported as recovered edits or recovered copies instead of being dropped.

User-visible versions are separate canonical document snapshots. Keep manual versions until deletion and automatic versions according to a retention policy. A suggested default is hourly for 24 hours, daily for 30 days, and weekly for one year. This policy is an open product decision.

Sources: [Yjs shared types and update model](https://github.com/yjs/yjs), [Yjs ProseMirror versions caveats](https://docs.yjs.dev/ecosystem/editor-bindings/prosemirror), [Loro JavaScript and WASM setup](https://www.loro.dev/docs/tutorial/get_started), and [Automerge rich text](https://automerge.org/docs/reference/documents/rich-text/).

### 1.5 Google Drive as a sync transport

Drive is treated as an eventually consistent object store with a change log. File names, modification times, and folder listings are never concurrency control.

#### Remote protocol

Jot does not have a shared mutable manifest. This removes the simultaneous-manifest-write race from the protocol.

```text
Jot/
  README.txt
  vaults/
    <zero-padded-epoch>-<hash>.jvault
  devices/
    <device-id>/
      heads/
        <zero-padded-sequence>-<hash>.jhead
      catalogs/
        <zero-padded-sequence>-<hash>.jcat
  objects/
    <first-two-object-id-chars>/
      <object-id>.jobj
  quarantine/
```

Each `.jvault` descriptor is a small immutable bootstrap record. It contains the vault ID, remote format version, minimum reader and writer versions, encryption mode, KDF parameters, wrapped keys, and the hashes of descriptors it supersedes. It contains no note titles or bodies. Device heads announce the active descriptor. Fresh installs list descriptors and heads, then follow the validated supersession graph. Passphrase changes publish a new descriptor. Old wrappers remain readable until conservative deletion, so changing a passphrase cannot revoke an attacker who already copied an older wrapper.

All `.jobj`, `.jhead`, and `.jcat` files are immutable and self-validating. Object IDs derive from the ciphertext hash, except deduplicated attachment IDs as described below. Each device writes only its own monotonically numbered head and catalog records. If two devices publish at the same time, both heads remain valid. A later client merges their announced objects.

A head references only objects whose uploads completed and whose returned size and downloaded or provider checksum match. A failed object upload creates no head. A failed head upload leaves unreferenced objects, which garbage collection can remove later. A reader validates magic bytes, length, SHA-256, format version, schema gates, and AEAD authentication before applying anything. A duplicate object name with identical bytes is harmless. A duplicate name with different bytes is quarantined and reported.

Drive may preserve prior file revisions, but the sync protocol does not depend on revision retention. It also does not assume an overwrite is atomic. Protocol-level commit occurs when a valid immutable head references valid immutable objects.

The visible folder is intentionally subject to user action. Renaming or moving it does not break identity because Jot locates its recorded folder ID and `appProperties`. Deleting it never deletes local notes; sync stops with a "Drive folder missing" state and offers to recreate an empty remote namespace or relink a folder the user explicitly selects. Manually edited protocol files fail validation and enter quarantine. Files a user drops into the folder are not implicitly imported because `drive.file` may not grant Jot access to them.

#### Change detection

On first authorization, get and persist a Drive start page token before the initial inventory. Complete the inventory, then drain `changes.list` from that earlier token so changes made during the scan cannot fall into a gap. On every later sync pass, call `changes.list` with the saved token, `pageSize=1000`, and a narrow `fields` projection. Follow `nextPageToken` until the server returns `newStartPageToken`. Persist the new token in the same local transaction that records all processed remote file metadata. Current Drive documentation says these page tokens do not expire.

Do not poll `modifiedTime`. It is vulnerable to clock assumptions, expensive listing, and same-timestamp ambiguity. Modification time is display and diagnostic data only.

`StorageProvider.watchChanges` means an async stream of validated provider change batches, not raw wakeup messages. The Drive adapter drains `changes.list` after any relay signal, app foreground, network restoration, explicit retry, local publication, or fallback timer. The relay signal contains only an opaque topic and monotonically increasing dirty epoch. It never contains a Drive cursor, file ID, object ID, or note ID.

To create a channel, the client first gets an opaque channel ID, random validation token, and callback URL from the relay. The client then calls Drive `changes.watch` directly with its local access token and current page token. The relay validates Google's channel headers and token, increments the topic's dirty epoch, and sends an empty invalidation through the Expo Push Service to APNs or FCM, or through an active desktop subscription. The device still calls `changes.list` directly and persists its own cursor.

Google can deliver the initial `sync` notification before the client receives the watch response. The relay therefore creates a pending record before the watch call and may bind its opaque resource ID from the first valid webhook. The client confirms the response and expiration afterward. A `changes` channel lasts at most one week and cannot renew itself. Clients create an overlapping replacement before expiry because the relay has no Drive credential with which to renew or stop it.

Push is an optimization. Poll immediately on foreground and after local publication. While a desktop app is active without a healthy relay subscription, poll every 30 seconds for five minutes after an edit, then every two minutes. Slow to 15 minutes when idle. Mobile uses foreground checks and permitted background work. Full jitter and server `Retry-After` govern backoff. A lost notification, expired channel, relay outage, or delayed silent push changes latency only. It cannot change convergence or durability.

#### Fresh install

1. Authorize, locate the Jot root by `appProperties`, and validate the newest supported vault-descriptor graph.
2. List device directories, then request only the newest few heads and catalogs for each device by ordered name.
3. Choose the compatible catalog with the greatest CRDT state-vector coverage. If catalogs are incomparable, merge them locally.
4. Download catalog shards containing folder, tag, note metadata, title, plaintext search projection, and object references. Encrypted vaults encrypt these shards.
5. Hydrate full note checkpoints and delta packs in the background, prioritizing pinned, recent, and opened notes.
6. Download attachment bytes only when opened, exported, or pinned for offline use.

The note list becomes usable before attachment and history hydration. Full-text search shows an honest indexing state until all text shards arrive. "Avoid downloading everything" cannot mean "offer complete offline full-text search without downloading the text." It means bootstrap metadata first and defer CRDT history and attachment bytes.

#### Attachments

Hash plaintext attachment bytes with SHA-256 while importing. In an unencrypted vault, the content ID is that digest. In an encrypted vault, the remote content ID is `HMAC-SHA-256(dedup-key, plaintext-digest)`, which supports within-vault deduplication without publishing the raw plaintext digest.

Encrypted attachment bytes must also be deterministic within one vault, or two offline devices importing the same file would choose the same content ID but upload different ciphertext. Derive a per-attachment data key and stream nonce from separate VMK subkeys plus the plaintext digest, with explicit HKDF domain labels. Because an immutable digest gets a unique derived key, nonce reuse does not occur across different plaintexts. Identical bytes in one vault produce identical authenticated ciphertext; identical bytes in different vaults do not. This leaks equality of attachments within one vault, which is the deliberate cost of deduplication. A random-key alternative is simpler cryptographically but cannot provide reliable cross-device deduplication, so it is rejected.

Large attachments use the crypto core's authenticated stream format with 1 MiB chunks and resumable Drive upload. Chunk nonces derive from the per-attachment stream nonce and checked chunk index. Note documents reference attachment ID, expected MIME type, byte length, and pixel dimensions where relevant. The encrypted attachment record retains the plaintext digest needed for key derivation after the VMK is unlocked. Captions and alt text belong to the note document so one attachment can appear differently in different notes.

Garbage collection is mark and sweep:

- Mark every attachment reachable from live notes, recoverable trash, retained versions, unsynced local work, and active catalogs.
- Add an unreferenced timestamp after a complete scan.
- Delete only after a 30-day grace period, two complete scans, and the device-acknowledgement or 180-day stale-device rule.
- Never let a single client delete an object that it cannot decrypt or validate.

User-visible trash recovery lasts 30 days. Sync tombstones live for 180 days. These are different clocks. The longer tombstone window prevents an old offline device from resurrecting deleted notes.

#### Quota budget

Google changed Drive quota accounting in 2026. Current published limits for newer projects are 1,000,000 quota units per project per minute, 325,000 per user per project per minute, 400,000,000 units per project per day before the announced billing threshold, and 1 TB of egress per project per day. Example costs include 100 units for list calls, 5 for item reads, 200 for downloads, and 50 for edits. These numbers are date-sensitive and must remain configuration and operations documentation, not constants in sync logic.

Without relay delivery, Jot should target fewer than 500 change-list calls and 75,000 total quota units per active device per day. Healthy push delivery should cut routine change-list calls to actual change events, foreground checks, and a low-frequency safety poll. Coalesce edits, batch note deltas across the vault into small packs, use partial responses, avoid polling while mobile is suspended, cache file IDs, and never list the full Drive root during routine sync. At 75,000 units, the 400 million daily project threshold supports only about 5,300 equally active users before headroom. A successful product will need quota monitoring and a new budget calculation.

Installed-app client IDs are public. The relay can rate-limit its own registrations and notifications, but it cannot stop modified clients from calling Drive directly with Jot's public OAuth client ID. Per-user limits contain a single account, but project-wide exhaustion remains an operational risk. Restrict and verify each OAuth client, alert on quota use in Google Cloud, keep polling conservative, and rehearse a client-rotation response.

On 403 quota and 429 rate responses, retain every local outbox item, show the next retry time, and use truncated exponential backoff with full jitter. An expired grant changes sync state to `authorizationRequired`; it never changes local note state.

Sources: [Drive changes](https://developers.google.com/workspace/drive/api/guides/manage-changes), [Drive change-list reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list), [Drive push requirements](https://developers.google.com/workspace/drive/api/guides/push), [Drive upload behavior](https://developers.google.com/workspace/drive/api/guides/manage-uploads), and [Drive usage limits](https://developers.google.com/workspace/drive/api/guides/limits).

### 1.6 Storage provider abstraction

The sync module depends on this conceptual interface:

```text
StorageProvider
  identifyNamespace(vaultId) -> namespace or notFound
  createNamespace(vaultBootstrap) -> namespace
  list(namespace, prefix, cursor, limit) -> page of ObjectMetadata
  stat(objectRef) -> ObjectMetadata or notFound
  read(objectRef, optionalRange) -> byte stream
  writeImmutable(namespace, key, byte stream, expectedLength, expectedHash) -> ObjectRef
  delete(objectRef, expectedProviderVersion) -> deleted or conflict
  getChangeCursor(namespace) -> ChangeCursor
  watchChanges(namespace, cursor, abortSignal) -> async change batches
  capabilities() -> limits and supported optimizations
```

The interface includes behavior, not only method names:

- `writeImmutable` may return an existing object only if length and hash match.
- `read` can stream and must identify the provider version read.
- `watchChanges` may poll and may emit duplicates. The caller must checkpoint its cursor.
- `delete` is always best-effort cleanup. Correctness cannot depend on it.
- Object keys are logical. Provider file IDs remain inside the adapter.
- The minimum required provider capability is list, streaming read, immutable create, delete, and a repeatable change cursor or complete relist fallback.

The Drive adapter accepts a `TokenSource` dependency. It maps logical keys to Drive IDs, uses resumable upload, stores `vaultId`, `kind`, and protocol version in private `appProperties`, and translates HTTP failures into typed provider errors.

It may also accept a `ChangeWakeup` adapter. That adapter can reduce polling latency, but it cannot provide change contents or replace the provider cursor. This keeps relay choice outside the sync protocol.

The in-memory adapter ships in Phase 2 at the same time as the interface. It models delayed visibility, duplicate changes, reordered listings, partial reads, quota faults, and process restarts. A perfectly synchronous map would be too weak to test the sync engine.

Future iCloud Drive, Dropbox, WebDAV, and local-folder adapters can satisfy this interface. The core protocol does not assume Drive revisions, Drive folders, ETags, or Google timestamps. A capability flag can enable range reads or provider checksums without making them correctness requirements.

### 1.7 Content-blind relay

The relay is a control-plane optimization. It is not a `StorageProvider`, not a source of truth, and not part of a commit. Deleting the entire relay database must leave every vault recoverable from local state and Drive. This is the deletion test for the module.

Its interface has three jobs:

```text
ChangeWakeup
  registerDevice(opaqueTopic, enrollmentCapability, notificationEndpoint) -> deviceCapability
  prepareDriveChannel(opaqueTopic, deviceCapability) -> channelId, channelToken, callbackUrl
  observeDirtyEpoch(opaqueTopic, afterEpoch, deviceCapability, abortSignal) -> dirtyEpoch
```

Each vault generates a random 256-bit relay-only enrollment capability and opaque topic ID. Clients share the capability through the vault's Drive bootstrap data, encrypted under the VMK when vault encryption is enabled. The relay stores only its SHA-256 verifier. Successful registration returns a separate random device capability whose verifier is stored with that endpoint. These capabilities authorize notification routing only. They are not encryption keys and grant no Drive access.

All calls use TLS, fixed routes, closed request schemas, and idempotency keys. Removing a device endpoint invalidates its device capability. A device that still holds the vault enrollment capability can register again, so revoking a lost device requires rotating the enrollment capability and revoking its Google grant. The relay is not an access-control system. A public-key registration scheme would keep even the enrollment secret out of the relay runtime, but it adds a cross-runtime signature protocol to protect a channel that carries no authority over content. The random-capability design is the smaller v1 choice.

The relay may store only:

- opaque topic, device, channel, and Drive resource identifiers
- notification endpoints and platform kind
- enrollment and device capability verifiers
- channel-token hashes, expiry times, dirty epochs, delivery state, and rate-limit counters
- coarse operational timestamps needed for expiry and abuse handling

It must reject arbitrary byte payloads, titles, file names, Drive IDs for Jot objects, Drive cursors, Google account identifiers, OAuth material, encryption keys, CRDT state, attachment metadata, and diagnostic logs. Registration routes accept closed, size-limited schemas. The Google webhook rejects declared nonempty bodies and never calls a body-reading method. Convex still terminates the connection before application code runs and permits HTTP requests far larger than this protocol needs, so Jot cannot claim that the host is physically incapable of receiving malicious bytes. Logs record route, status class, latency, and opaque truncated correlation IDs only. Notification payloads say only that a topic may be dirty.

This metadata is still privacy-sensitive. Push endpoints can identify an app installation, IP logs and timestamps expose usage patterns, and the hosting provider processes them. Expired Drive channels disappear promptly. Inactive device endpoints expire after a documented interval, proposed at 90 days. The privacy policy names Convex, Expo Push Service, APNs, and FCM and explains this processing.

Convex is a plausible first adapter because it supplies an HTTPS endpoint, transactional metadata mutations, scheduled cleanup, and live WebSocket subscriptions. The application must depend on `ChangeWakeup`, not Convex calls. A deterministic in-memory adapter remains the test implementation. Use a small direct Expo Push API action with a short-lived receipt ledger. Do not adopt the current beta Convex Expo push module without a separate review. If Convex cannot meet the required log controls, retention, regional, or deletion terms, replace it with a small purpose-built relay without changing sync logic.

Convex encrypts its database at rest, but deployed functions and authorized operators can access plaintext metadata. Function execution also produces platform logs. Configured daily backups retain rows for seven days and weekly backups for fourteen days. The relay does not need backups for correctness, so do not enable application-managed backups. Obtain written terms for Convex's internal backup deletion, ordinary log retention, data region, support access, and deletion timing before launch. A 24-hour table cleanup promise is not a 24-hour physical erasure promise unless those terms support it.

Do not put Google tokens in Convex. Do not proxy Drive uploads or downloads through it, even transiently. That would expose unencrypted vaults to Jot and would make relay availability, bandwidth, and compromise part of the content path. Encrypted payload proxying is also rejected because encryption is optional and two code paths would invite privacy mistakes.

The relay can suppress, delay, duplicate, or forge wakeups if compromised. Capability checks limit unauthorized subscription changes, but a wakeup is never trusted as proof of a Drive change. Clients always verify through Drive. Fallback polling handles suppression. Spam wakeups cost battery and quota, so clients coalesce signals and enforce local rate limits.

Sources: [Google Drive push notifications](https://developers.google.com/workspace/drive/api/guides/push), [Convex HTTP actions](https://docs.convex.dev/functions/http-actions), [Convex scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions), [Convex realtime](https://docs.convex.dev/realtime), [Convex backup retention](https://docs.convex.dev/database/backup-restore), [Convex security](https://www.convex.dev/security), and [Expo Push Service](https://docs.expo.dev/push-notifications/sending-notifications/).

### 1.8 Cryptography

#### Threat model

Vault encryption protects note contents, titles, tags, folder names, attachment bytes, catalog projections, and CRDT updates stored on Drive. It protects against Google reading those bytes and against someone who obtains only the Drive folder.

It does not hide the Jot folder, vault format version, approximate device count, object count, file sizes, upload cadence, modification times, or total storage. Note count remains inferable from encrypted catalog and object patterns. Deduplicated attachments reveal equality within the same vault. Google or an attacker controlling Drive can delete data, withhold updates, duplicate old objects, or attempt rollback. Authenticated heads detect modification, and local state detects some rollback. The Drive-plus-relay architecture cannot guarantee remote availability or a globally fresh view.

#### Keys and envelopes

- Generate a random 256-bit vault master key, or VMK, on the device.
- Derive a 256-bit passphrase key-encryption key with Argon2id v1.3, a random 128-bit salt, and serialized parameters.
- Default to 64 MiB memory, three passes, and four lanes, matching RFC 9106's memory-constrained recommendation. Benchmark at setup. Target 500 to 1,000 ms without memory pressure.
- If 64 MiB fails on a low-memory Android device, offer a clearly disclosed 32 MiB, four-pass profile. Do not silently weaken an existing vault. The weakest stored wrapper sets the offline attack cost, so Jot must not add a low-memory wrapper merely for convenience.
- Use the derived key only to wrap the VMK. Changing a passphrase creates a new salt and wrapper. It does not re-encrypt notes or attachments.
- Derive independent encryption, authentication, deduplication, and catalog subkeys from the VMK with HKDF-SHA-256 and fixed context labels.

Use XChaCha20-Poly1305 for small objects. Its 192-bit nonce makes accidental collision far less likely than AES-GCM's 96-bit nonce, and the shared Rust core implements it consistently on every target. Use a fresh random 24-byte nonce for every ordinary envelope and authenticate the versioned header as associated data. Deduplicated attachment objects are the documented exception: their unique per-content key and base nonce derive from separate VMK subkeys and the plaintext digest. AES-256-GCM is faster on hardware with AES instructions, but its nonce discipline and inconsistent mobile interfaces are worse for this protocol.

Use the RustCrypto AEAD stream interface with XChaCha20-Poly1305 for large attachments and export archives. Export streams use a random stream nonce; deduplicated attachment streams use the derived base nonce described above. Every stream has authenticated 1 MiB chunks, a final marker, expected length, and an outer ciphertext SHA-256. The file-format specification owns the framing and includes negative tests for reordering, truncation, duplication, and missing final chunks.

Build one small `jot-crypto-core` Rust library from pinned RustCrypto `argon2`, `chacha20poly1305`, `aead`, `hkdf`, `hmac`, `sha2`, `getrandom`, and `zeroize` crates:

- iOS links a reproducibly built static library or XCFramework and calls it through generated Swift bindings.
- Android links the same Rust source through JNI or UniFFI and calls it from Kotlin.
- Tauri calls the crate directly from Rust.
- TypeScript sees only the `CryptoEngine` interface and opaque byte buffers. No pure JavaScript cryptography and no assumed Web Crypto.

This native build work is heavier than a React Native crypto package. It keeps serialization and algorithm behavior in one implementation and allows the exact Argon2 lane count to remain part of the format. Libsodium is the fallback. It is mature and supplies both required algorithms, but its high-level password-hashing interface does not expose the full RFC parameter set, and using separate Swift, Kotlin, and Rust wrappers would add more integration seams. Phase 0 must prove the Rust artifact build on iOS and Android before the format is approved.

#### Local encryption, locked notes, and app lock

Phase 3 migrates the local database to SQLCipher on all platforms. The database key lives in Keychain, Android Keystore-wrapped storage, macOS Keychain, or Windows Credential Manager. Whole-vault Drive encryption and local database encryption are separate settings. I recommend local database encryption by default once Phase 3 ships because a plaintext FTS table would otherwise defeat a meaningful app lock.

Each locked note has a random 256-bit note-lock key. The note payload and its local search projection are encrypted under that key. A per-note passphrase can create an Argon2id-derived wrapper. A VMK wrapper lets another authorized device recover the note-lock key, and a device-local biometric key wraps it for convenient local unlock. Normal UI requires the selected passphrase or biometric factor even when the vault is open. Biometrics are an unlock factor, not a portable key and not a backup. If vault encryption is off, enabling the first synced locked note must create the VMK recovery setup so Google cannot obtain the note-lock key from a plaintext wrapper.

Once the vault is unlocked, Jot's own process can technically access keys. Per-note lock protects against casual access, exports, search leakage, and at-rest database inspection. It does not defend against a compromised running process. State that in security documentation.

App lock gates database-key release on cold start and after the configured timeout. Background previews, widgets, search results, notifications, and app-switcher snapshots redact locked content. A share extension can append encrypted intake records but cannot display locked vault content unless the user authenticates.

#### Recovery experience

Encryption setup cannot complete until the user confirms a recovery code. Generate 256 bits of random recovery entropy, encode it as a 24-word mnemonic with a checksum, and use an HKDF-derived recovery key to wrap the VMK. The user can print it or save it outside Jot. Jot asks for three randomly selected words before enabling encryption.

The setup copy should say: "Jot has no account and cannot reset this passphrase. If you lose the passphrase, this recovery code, and every unlocked device, your encrypted notes are permanently unreadable." Do not hide this behind legal copy. The recovery screen should show whether at least one verified recovery method exists. Passphrase change and device enrollment require an unlocked VMK and only add or replace wrappers.

Sources: [RFC 9106 Argon2id parameters](https://www.rfc-editor.org/rfc/rfc9106.html), [RustCrypto Argon2](https://github.com/RustCrypto/password-hashes), [RustCrypto XChaCha20-Poly1305](https://docs.rs/chacha20poly1305/latest/chacha20poly1305/), and [libsodium XChaCha20-Poly1305](https://doc.libsodium.org/secret-key_cryptography/aead).

### 1.9 Native mobile editor and editor parity

The mobile-native decision is right. A WebView editor would reproduce the keyboard avoidance, native selection, autocorrect, IME, scroll, and long-note failures named in the brief. Those are not cosmetic defects. They sit on the primary input path, and no wrapper library removes the two text systems involved. Desktop is different because the WebView already owns the window's text-input environment and ProseMirror has mature browser selection behavior there.

The risk is the capability ceiling of `UITextView` and `EditText`. Both handle attributed linear text well. Tables, nested interactive attachments, block math, and sophisticated image layout do not fit naturally. v1 should keep those as atomic block nodes inside the main editor. A table opens a dedicated native table-editing sheet on mobile and renders as a native preview block in the document. This is less seamless than desktop, but it preserves native keyboard behavior. Trying to place a grid of child text editors inside one scrolling text editor is a worse v1 bet.

#### Shared schema first

`packages/schema` is complete before either editor. It declares node and mark names, allowed children, attributes, defaults, validation, normalization, schema migrations, input-rule intent, and canonical serialization. It permits only integer numeric attributes and valid Unicode scalar strings. Canonical JSON uses UTF-8, LF line endings, lexicographically sorted keys, no insignificant whitespace, and stable array order. Each fixture has a byte-exact canonical result.

Neither editor may add a platform-only node or mark. A feature may have a different interaction on mobile and desktop, but both must load, preserve, render, edit, and export the same schema value before the feature is declared complete.

#### Native module interface

The Expo module exports one native view and one durability helper. The conceptual editor interface is:

```text
loadDocument(documentId, canonicalDocument, schemaVersion, revision)
applyTransactions(documentId, baseRevision, transactions, origin)
dispatchCommand(command, optionalValue)
setSelection(schemaSelection)
getDocumentSnapshot() -> canonicalDocument plus revision
focus(), blur(), undo(), redo()

events:
  ready(capabilities, schemaVersion)
  committedTransaction(transactionId, baseRevision, operations, selection)
  selectionChanged(schemaSelection, activeMarks)
  compositionChanged(active)
  contentSizeChanged(height)
  recoverableError(code, context)
```

A schema selection uses stable block or inline-node IDs, UTF-16 text offsets, affinity, and the document revision. It never exposes `NSRange`, Android span indices, or ProseMirror positions. UTF-16 matches native mobile indexing and JavaScript strings. Schema validation rejects unpaired surrogates. The CRDT adapter converts schema positions to Yjs relative positions before applying a transaction.

Operations are schema terms:

- `insertText(position, text, storedMarks)`
- `deleteRange(from, to, deletedSlice)`
- `replaceRange(from, to, slice, deletedSlice)`
- `addMark(range, mark)` and `removeMark(range, markType)`
- `setNodeAttributes(nodeId, patch, priorValues)`
- `insertNode(parentId, index, node)` and `deleteNode(nodeId, deletedNode)`

`deletedSlice` and prior values make local persistent undo deterministic. Remote input is canonical operations or a canonical snapshot diff, not a Yjs binary update. TypeScript owns the Yjs mapping. The native implementations own text-system reconciliation and durable intake.

#### Edit conversion

| Native action | Schema transaction | Yjs application |
| --- | --- | --- |
| Insert | `insertText(p, text, marks)` | Resolve `p` at `baseRevision` to a Yjs relative position, insert text into the corresponding XML text node, and set only schema-valid marks. |
| Delete | `deleteRange(a, b, deletedSlice)` | Resolve both positions, delete the covered XML text or nodes in one Yjs transaction, and retain the slice only in the local undo journal. |
| Replace or autocorrect | One `replaceRange(a, b, committedSlice, deletedSlice)` | Delete and insert inside one Yjs transaction with one transaction ID. Never model autocorrect as unrelated delete and insert transactions. |
| Mark toggle | `addMark` or `removeMark` over the normalized selection | Apply or remove the corresponding Yjs text formatting attribute. A collapsed selection changes stored marks only and creates no CRDT update until text is inserted. |

During IME composition, iOS marked text and Android composing spans stay entirely native. Jot records the pre-composition range and text, queues remote operations for that note, and emits no CRDT operation for intermediate candidates. On commit, it emits one replace transaction from the original range to the committed text. On cancellation, it emits nothing. It then applies queued remote operations and restores the selection through Yjs relative positions. If the process dies during composition, the uncommitted candidate may be lost and is outside the committed-edit promise.

Every committed native transaction first enters a small native durable journal with `synchronous=FULL`. The iOS adapter must intercept committed mutations before applying them through the text-storage delegate path. The Android adapter must wrap `InputConnection` commit, delete, composing-finish, and programmatic replacement paths rather than relying on an after-change `TextWatcher`. Only after the append succeeds may the committed mutation be treated as durable and the module emit `committedTransaction`. Intermediate marked or composing text remains the stated exception. If either platform exposes a committed-input path that cannot be journaled before visible acceptance, the zero-window promise fails the Phase 0.5 gate.

The materializer applies the journaled transaction to Yjs, then commits the Yjs update, note projection, undo entry, and outbox item together and marks the intake record applied. On recovery, unapplied intake records replay by transaction ID. Phase 0.5 must prove that this does not cause typing latency on low-end hardware. If per-transaction fsync misses the input-latency budget, the product owner must choose between a bounded durability window and a heavier native write-ahead strategy. The design will not pretend both guarantees are free.

Persistent undo is Jot-owned, not a promise delegated to `UndoManager` or Android's process-local stack. Each local origin transaction stores its inverse slice and Yjs relative anchors in a bounded device-local undo group. Remote transactions never enter that stack. After restart, undo resolves surviving anchors against the current merged document and writes a new forward CRDT transaction; redo does the same for the original operation. If concurrent deletion removed both anchors, recovery inserts the preserved slice into the nearest surviving parent or a clearly labeled recovered block instead of discarding it.

#### Preventing editor drift

The schema conformance corpus includes every node, every mark, malformed input, nested combinations, Unicode grapheme cases, RTL text, CJK, emoji, combining marks, long paragraphs, 5,000-word notes, and migrations. It produces:

- canonical JSON fixtures
- linearized native attributed-text fixtures
- operation traces and expected documents
- HTML for ProseMirror
- Markdown export expectations
- accessibility labels for non-text nodes

CI runs TypeScript tests on every change, an iOS simulator test lane, an Android emulator test lane, and ProseMirror tests. Both native editors must round-trip each supported fixture to byte-identical canonical JSON. Both apply the same randomized operation trace and match after every committed transaction. A schema capability manifest generated from the source lists every node and mark. A feature flag becomes shippable only when iOS, Android, desktop, import, export, and migration handlers report support.

#### Highlighting and math

Use `lowlight` with the highlight.js core and an explicit language allowlist for mobile code tokenization. It is pure JavaScript and returns a syntax tree without a DOM or WASM requirement. Flatten that tree into UTF-16 ranges, debounce by 150 ms, cache by code hash, and apply presentation-only native spans. Token colors never enter the document schema. Very large code blocks fall back to plain monospace until idle. Shiki is excellent on desktop but its grammar and WASM payload are a poor Phase 1 Hermes risk.

Use SwiftMath on iOS and JLaTeXMath-Android on Android behind a shared supported-command subset. Render inline and block formulas to cached native images or attachment views keyed by formula, theme, scale, and renderer version. Store the LaTeX source and an accessibility label in the schema. If native renderers cannot converge on the required subset, use an isolated, non-interactive KaTeX rasterizer outside the editor and cache its output. A live WebView never joins the input hierarchy.

#### Feature staging

Phase 0.5 proves paragraphs, headings, bold, italic, lists, checklists, code blocks, selection, IME, autocorrect, durable undo, and 5,000-word scrolling. Phase 1 ships those plus underline, strikethrough, inline code, links, blockquotes, dividers, paste, basic images, Markdown input rules, and persistent undo and redo.

The following are deferred from Phase 1, not cut from v1: tables, text color, highlight, inline and block LaTeX, image resizing and captions, drag and drop, file attachments, and the complete language picker. They must pass the same mobile conformance and performance gate before the mobile release. Shipping approximate tables or math merely to check a feature box is rejected.

### 1.10 Local persistence and search

Use SQLite in WAL mode on every target. Choose `expo-sqlite`, not `op-sqlite`, for mobile because Expo maintains it, its config plugin enables FTS5 and SQLCipher, and 10,000 notes do not require a more speculative JSI database dependency. Benchmark it under release Hermes before finalizing. Use SQLite through Tauri Rust commands on desktop. Do not issue arbitrary SQL from React.

One runtime implementation cannot sensibly serve both targets. The platform-neutral `LocalStore` interface and migration SQL are shared. `local-store-expo` uses `expo-sqlite`; `local-store-tauri` uses Rust SQLite. Contract tests run against both adapters and the same fixtures.

The write transaction stores the CRDT update or checkpoint, normalized note projection, attachment references, undo metadata, and sync outbox row. Search has an external-content FTS5 table over title, plain body, tag names, and image captions. Attachment binary content is not indexed in v1. Filename indexing is optional and separate from the stated search requirement.

Use the Unicode tokenizer with diacritic removal. Rank with BM25 weights favoring title, then tags, then body. Return escaped snippets from FTS5 `highlight` or `snippet` and render them as text, never HTML. Search executes on the database queue, cancels stale queries, limits initial results to 50, and pages more.

Performance gates on a mid-range supported phone with a synthetic 10,000-note vault:

- top-50 search p95 under 100 ms after database open
- note-list open p95 under 150 ms
- open a 5,000-word note p95 under 300 ms from a local checkpoint
- index a normal committed edit without blocking an input frame
- keep only the active note CRDT and a small LRU cache in memory

These are proposed engineering budgets, not current product claims. Locked notes are absent from FTS until unlocked. Whole-database SQLCipher keeps unlocked search projections encrypted at rest.

Source: [Expo SQLite FTS and SQLCipher configuration](https://docs.expo.dev/versions/latest/sdk/sqlite/).

### 1.11 Design system and application UI

The design mode is Operate. Familiar platform behavior outranks brand expression. Jot's character comes from editorial restraint, careful type, and a small amber signal color, not from decorative containers.

`packages/tokens/src/tokens.json` is the only authored token source. A generator emits typed TypeScript, Tailwind and NativeWind theme variables, CSS custom properties, Swift values, and Kotlin resources. Generated outputs are checked for drift in CI. Raw color, spacing, radius, shadow, duration, or easing values outside the token package fail lint, except OS-provided semantic values explicitly mapped by the generator.

Proposed token direction:

| Family | Direction |
| --- | --- |
| Type | Semantic roles rather than fixed cross-platform font sizes. UI uses SF Pro on Apple, Roboto on Android, Segoe UI on Windows. Editor body maps to the platform reading face, 17 pt or sp at default mobile size and 17 px with 1.6 line height on desktop. Desktop measure caps at 72 characters. |
| Spacing | A 4-unit base with 2, 4, 8, 12, 16, 24, 32, 48, and 64 steps. Editor paragraph spacing gets its own semantic tokens. |
| Color | Warm paper and graphite neutrals, near-black dark surfaces, one restrained signal-amber accent, and semantic error, warning, success, selection, focus, link, and sync roles. No gradients. Android Dynamic Color stays off in v1 so the four clients share one authored palette. |
| Radius | 4 for compact controls, 8 for menus and fields, 12 for sheets, and full only for pills or circular controls. Notes and panes are not floating cards. |
| Elevation | Flat by default. Hairline separators organize panes. Elevation exists only for menus, sheets, and drag previews, using platform-native material or shadow tokens. |
| Motion | 120 ms fast, 180 ms standard, and 260 ms deliberate transitions. Mobile gestures use interruptible Reanimated springs. Desktop uses matched timing curves. Reduced motion removes spatial travel. |

Desktop can use shadcn/ui source components for Radix behavior and Tailwind structure, then restyle them to Jot's tokens. Mobile should use a small hand-built NativeWind primitive set over React Native and platform controls. I reject a wholesale react-native-reusables dependency for v1 because a DOM-inspired component inventory encourages false parity and adds dependencies around controls that should differ between iOS and Android. Shared tokens and semantic component names provide consistency. Native behavior remains native.

Icons use semantic names mapped to SF Symbols on Apple, Material Symbols on Android, and Lucide on desktop. There are no emoji icons. The mobile editor is one uninterrupted writing surface with a compact, keyboard-aware formatting bar. Desktop uses a resizable folder, note-list, and editor layout. Chrome recedes as soon as typing begins. Sync has explicit states: local only, synced with time, pending count, syncing stage, offline, retry scheduled, authorization required, upgrade required, and error with an action. No state is an endless spinner.

The 21st.dev and shadcn MCP servers requested in the brief were not available in this environment. The design uses official shadcn, Radix, NativeWind, and platform guidance as references. No component code is being selected or copied before design approval.

### 1.12 Import, export, and platform integration

The portable export is a directory or zip with one UTF-8 Markdown file per note, relative attachment files, folder directories, YAML front matter for IDs, dates, tags, pin and archive state, and a JSON manifest. Tables use GitHub-flavored Markdown where possible. LaTeX uses dollar delimiters. Underline, text color, and highlight use documented inline HTML. A static index HTML file can improve browsing but is not required to recover the Markdown. Exporting never requires sync and is reachable from Settings and the sync-error screen.

Apple Notes import has two supported paths:

- On macOS, a guided importer requests Automation permission, reads the public AppleScript dictionary exposed by Notes, converts available HTML and attachments, and reports unsupported constructs per note.
- On iOS and macOS, the share target accepts one or more shared Notes items when the system supplies text, HTML, images, or files.

Do not read Apple's private Notes SQLite database or request Full Disk Access. Locked notes must be unlocked in Notes first. Scans, drawings, internal links, and some checklists may degrade to attachments or plain text. This needs a fixture study before it can be promised as "bulk import with high fidelity."

The iOS share extension and widgets write small intake records to an App Group container using coordinated SQLite access. They do not initialize the entire React Native app. The main app materializes intake records through the same transaction pipeline. Android uses an intent receiver or small activity and the shared local-store adapter.

Desktop global hotkeys and tray behavior need explicit enablement and conflict handling. Multi-window uses one database writer coordinator in Rust and independent editor sessions. A note can be open in two windows, but both sessions have different transaction origins and merge locally through Yjs.

### 1.13 Reliability and data integrity

#### Defended invariants

1. **Every acknowledged committed edit survives a process crash or OS kill.** The native or Rust intake journal reaches stable storage before acknowledgement. Uncommitted IME composition and catastrophic storage failure are excluded and documented.
2. **Local state is authoritative.** Sync only adds validated remote changes to local CRDT state. It never replaces a local database with a remote file and never clears an outbox because of a remote error.
3. **Sync is idempotent and resumable.** Transaction IDs, Yjs update idempotency, content-addressed objects, saved upload sessions, and durable change cursors make retries safe.
4. **Readers see an atomic protocol commit.** Writers upload immutable objects first and publish an immutable head last. Readers ignore unreferenced objects and invalid heads.
5. **Corruption is contained.** A bad length, hash, AEAD tag, schema value, or CRDT update moves the object to a local quarantine record. Jot skips it, preserves local data, and reports the file ID and recovery action without logging content.
6. **Versions gate reads and writes.** Every bootstrap, head, object, catalog, schema document, and envelope declares its format. An older client that sees an unsupported minimum reader does not parse it. One that sees an unsupported minimum writer keeps local edits and stops remote publication until upgrade.
7. **Deletion is monotonic within its retention horizon.** Deletion creates a tombstone event. Garbage collection waits for grace periods and device acknowledgement. A stale device reboots from a current checkpoint before publishing.
8. **Exports do not depend on remote health.** Jot can export all locally available, unlocked data while signed out, offline, rate-limited, or facing corrupt remote objects.
9. **The relay is never authoritative.** Losing its database, receiving a forged wakeup, or missing every notification can delay sync but cannot lose, alter, decrypt, or falsely commit user content. The next successful Drive cursor check recovers.

#### Local write protocol

1. The native editor or desktop durability coordinator assigns a transaction ID and appends the schema operation to the intake journal.
2. SQLite or the native journal fsync completes, then the editor receives a committed acknowledgement.
3. The materializer validates and applies the operation to Yjs.
4. One SQLite transaction stores the Yjs update, projection, undo entry, attachment-reference changes, outbox row, and applied-intake marker.
5. Checkpointing happens later and cannot delete the only durable copy of any update.

On startup, run WAL recovery, replay valid unapplied intake records, verify the newest checkpoint, and apply later updates. If the newest checkpoint fails, fall back to the prior checkpoint and update log. Keep at least two verified local checkpoints per active note.

#### Verification program

- Property-based CRDT tests generate inserts, deletes, replacements, mark changes, node moves, device partitions, duplicate delivery, and arbitrary merge order. Every replica must produce byte-identical canonical state.
- A deterministic sync simulator runs the real sync coordinator against the in-memory provider with network cuts, partial uploads, stale listings, duplicate heads, reordered changes, 403, 429, 5xx, clock skew, token expiry, corruption, and process restart.
- Relay tests drop, delay, duplicate, replay, and forge invalidations; expire channels during edits; delete all relay state; rotate enrollment capabilities; and deliver notification storms. Replicas must still converge after direct Drive polling, and local rate limits must contain battery and quota cost.
- Crash-consistency tests kill the process after every named persistence step. Recovery must contain each acknowledged transaction exactly once and never contain a partially materialized projection.
- Restore drills create a synthetic encrypted and unencrypted vault, delete the local store, bootstrap a fresh device, hydrate everything, and compare canonical documents, metadata, and attachment hashes byte for byte.
- Every schema, local database, remote format, and crypto-envelope version gets fixtures for upgrade, downgrade refusal, and interrupted migration. "Backward migration" means a tested export or rollback path where safe, not pretending all destructive migrations can reverse.
- Native editor CI runs Apple marked-text tests, Android composing-span tests, autocorrect replacements, RTL, emoji, hardware-keyboard input, accessibility, and 5,000-word scroll benchmarks on release builds.
- Faulted export tests prove that "export everything now" works with sync disabled and reports any locked or locally absent attachment before writing the archive.

#### Operational behavior

The local diagnostic log is structured, bounded, content-free, and user-viewable. It records timestamps, state transitions, provider status classes, object IDs, format versions, duration, and retry decisions. It redacts titles, text, paths containing user names, tokens, keys, and request bodies. Users can export it deliberately.

The relay has separate operational metrics for route counts, webhook validation failures, delivery status classes, queue depth, latency, and expired-record cleanup. It has no client diagnostic upload endpoint. Relay logs must never contain notification endpoints, raw capabilities, channel tokens, request bodies, Drive resource identifiers, IP addresses beyond the hosting provider's minimum security retention, or any field derived from user content.

Sync errors always include the retained local state, plain cause, last successful sync time, pending item count, and next action. Examples include "Google access expired. Reconnect Drive," "Drive is rate-limiting Jot. Retrying at 14:32," and "One remote object failed integrity checks. Your local note was not changed."

The relay reveals aggregate notification health, but it cannot reveal editor, persistence, merge, migration, or export failures. The team will not know those field failure rates unless users export logs. That is consistent with the privacy promise, but it raises the value of user-initiated diagnostics and pre-release test cohorts.

## 2. Monorepo layout

```text
jot/
├── .github/
│   └── workflows/
│       ├── ci.yml                     # shared lint, type, schema, sync, and format checks
│       ├── mobile.yml                 # iOS simulator and Android emulator matrix
│       └── desktop.yml                # macOS and Windows build and test matrix
├── apps/
│   ├── mobile/
│   │   ├── app/                       # Expo Router routes
│   │   ├── src/                       # mobile application composition
│   │   ├── ios/                       # generated then owned native project and extensions
│   │   ├── android/                   # generated then owned native project and widgets
│   │   ├── app.config.ts
│   │   └── metro.config.cjs
│   ├── editor-lab/
│   │   ├── app/                       # Phase 0.5 editor-only screen and toolbar
│   │   ├── fixtures/                  # stress notes and manual test scripts
│   │   └── benchmarks/                # input, scroll, memory, and durability results
│   └── desktop/
│       ├── src/                       # Vite and React application
│       ├── src-tauri/
│       │   ├── src/                   # Rust commands, windows, menus, auth, database
│       │   ├── capabilities/          # least-privilege Tauri capability files
│       │   └── migrations/            # desktop SQLite migrations from shared sources
│       ├── index.html
│       └── vite.config.ts
├── services/
│   └── relay/
│       ├── convex/
│       │   ├── schema.ts              # metadata-only tables with size and retention limits
│       │   ├── http.ts                # Drive webhook and capability-authenticated routes
│       │   ├── channels.ts            # opaque channel lifecycle and dirty epochs
│       │   ├── notifications.ts       # empty APNs and FCM invalidations
│       │   └── maintenance.ts         # expiry, abuse limits, and scheduled deletion
│       └── README.md                  # forbidden data, threat model, and operator runbook
├── packages/
│   ├── schema/                        # platform-neutral schema, canonical form, migrations
│   │   ├── src/
│   │   ├── fixtures/
│   │   └── generated/                 # Swift, Kotlin, and ProseMirror schema declarations
│   ├── core/                          # platform-neutral note rules, CRDT adapter, commands
│   ├── sync/                          # platform-neutral sync state machine and compaction
│   ├── storage/                       # platform-neutral StorageProvider and memory adapter
│   ├── storage-google-drive/          # Drive adapter, independent of platform token storage
│   ├── change-wakeup/                 # platform-neutral wakeup interface, capabilities, memory adapter
│   ├── change-wakeup-relay/           # relay client behind the ChangeWakeup interface
│   ├── crypto/                        # platform-neutral envelope rules and CryptoEngine seam
│   ├── crypto-native/                 # Expo adapter to the Rust core and native key stores
│   │   ├── ios/
│   │   └── android/
│   ├── crypto-tauri/                  # Tauri adapter to the Rust core and desktop key stores
│   ├── local-store/                   # platform-neutral LocalStore interface and contracts
│   ├── local-store-expo/              # expo-sqlite adapter
│   ├── local-store-tauri/             # typed TypeScript client for Tauri SQLite commands
│   ├── editor-native/                 # one Expo editor contract, implemented twice
│   │   ├── src/                       # typed React Native view and schema operation types
│   │   ├── ios/                       # Swift, UITextView, TextKit 2, native durability
│   │   └── android/                   # Kotlin, EditText, Spannable, native durability
│   ├── editor-web/                    # TipTap, ProseMirror, y-prosemirror, desktop toolbar
│   ├── tokens/                        # single authored token source and generators
│   │   ├── src/tokens.json
│   │   └── generated/                 # TS, CSS, Swift, Kotlin outputs
│   ├── ui-mobile/                     # NativeWind and platform-control wrappers
│   ├── ui-desktop/                    # shadcn, Radix, and Tailwind components
│   ├── import-export/                 # Markdown, Apple Notes conversion, portable archive
│   └── test-kit/                      # fixtures, fake clocks, random operations, fault plans
├── crates/
│   └── crypto-core/                   # one RustCrypto implementation linked on all targets
├── tooling/
│   ├── eslint-config/                 # shared type-aware flat ESLint configuration
│   ├── prettier-config/               # TS, JSON, YAML, and Markdown formatting
│   ├── tsconfig/                      # base, React Native, browser, and library configs
│   ├── swift/                         # SwiftFormat and SwiftLint configuration
│   ├── kotlin/                        # ktlint and detekt configuration
│   └── rust/                          # rustfmt and Clippy policy
├── docs/
│   ├── adr/                           # accepted architectural decisions, created on approval
│   ├── research/                      # dated primary-source notes
│   ├── runbooks/                      # recovery, restore, quota, and release drills
│   └── technical-design.md
├── scripts/                           # repository orchestration only, run by Bun
├── CONTEXT.md                         # domain glossary
├── PRODUCT.md                         # durable product constraints
├── package.json                       # Bun version, workspaces, root commands
├── bun.lock
├── turbo.json
├── tsconfig.json                      # project-reference root
├── eslint.config.mjs
├── prettier.config.mjs
└── .gitattributes
```

### 2.1 Dependency direction

`schema`, `tokens`, `storage`, `change-wakeup`, `crypto`, `local-store`, `core`, and `sync` are platform-agnostic. Their TypeScript cannot import React, React Native, Expo, Tauri, browser globals, Swift, Kotlin, or Rust bindings.

`editor-native`, `crypto-native`, `local-store-expo`, `ui-mobile`, and `apps/mobile` are mobile-bound. `editor-web`, `crypto-tauri`, `local-store-tauri`, `ui-desktop`, and `apps/desktop` are desktop-bound. `storage-google-drive` is platform-neutral because it receives a token source and fetch transport through its constructor. `services/relay` is backend-bound and may import only the relay protocol, cryptographic verification helpers, and notification-provider adapters. It cannot import `schema`, `core`, `sync`, `storage-google-drive`, or any content format.

Keep the package graph directed:

```text
schema   tokens   storage   crypto   local-store   change-wakeup
   \        |        |         |          /              /
                              core
                               |
                              sync
                    /                         \
          mobile adapters and app      desktop adapters and app

change-wakeup protocol ----------------------> relay implementation
```

`sync` may depend on `core`, `schema`, `storage`, `crypto`, and `local-store`. It may not import either app or editor. Editors depend on `schema` and expose operations to `core`; they do not call providers.

### 2.2 Workspace and task configuration

The root `package.json` declares `apps/*`, `services/*`, `packages/*`, and `tooling/*` workspaces and pins Bun through `packageManager`. Every internal dependency uses `workspace:*`. The lockfile is committed. Dependency versions are exact for native, CRDT, crypto, persistence, schema, and relay packages. Automated updates open reviewable pull requests and never merge themselves.

The Turborepo task graph should contain:

| Task | Dependency and cache rule |
| --- | --- |
| `generate` | Token and schema generation. Cached from the authored JSON and generator sources. |
| `build` | Depends on ancestor `generate` and `build`. Caches TypeScript declarations and Vite output, not signed native artifacts. |
| `lint` | Depends on ancestor `generate`. Cached. |
| `typecheck` | Depends on ancestor `generate` and `build:types`. Cached. |
| `test` | Depends on ancestor `build:types`. Cached by source and fixtures. |
| `test:conformance` | Depends on `generate`. Runs platform-neutral corpus locally and native lanes in CI. |
| `test:integration` | Includes sync simulator, restore drill, and migration suites. Cached only when deterministic. |
| `test:relay` | Exercises capability registration, webhook validation, expiry, notification coalescing, forbidden-field rejection, and relay-loss fallback. |
| `dev` | Persistent, interactive, and never cached. |
| `clean` | Never cached and scoped to each workspace. |

The root `tsconfig.json` contains project references rather than source options. Shared libraries use `composite`, declaration output, strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, and `verbatimModuleSyntax`. Mobile and desktop extend separate environment configs so DOM types never leak into mobile packages. Tests get their own reference and types.

ESLint uses the type-checked `typescript-eslint` rules, bans explicit and implicit `any` in committed source, rejects unsafe assignment and calls, requires handled promises, and enforces package dependency direction. Prettier formats TypeScript, JSON, YAML, and Markdown. SwiftFormat plus SwiftLint, ktlint plus detekt, and rustfmt plus Clippy cover native code. Generated files carry headers and are compared, not hand-formatted.

Root commands:

- `bun run dev:mobile` starts Metro for a development build and selects iOS or Android.
- `bun run dev:desktop` starts Vite and the local Tauri host for the current desktop OS.
- `bun run check` runs generation drift, lint, types, unit tests, schema conformance, and deterministic integration tests.
- `bun run verify:platforms` dispatches or reproduces the CI matrix. It cannot build Windows locally on macOS.

Phase 0 can add a convenience `bun run dev` selector, but an interactive selector is more honest than pretending four native applications can launch on one host.

## 3. Data model

All IDs are random 128-bit values encoded in lowercase base32. User clocks are never ordering authority. Logical time uses a Lamport counter plus device ID. Wall-clock timestamps remain useful for display and retention, with clock-skew guards.

### 3.1 Domain schemas

#### Note

| Field | Type and rule |
| --- | --- |
| `id` | Immutable `NoteId`. |
| `schemaVersion` | Positive integer checked before decoding the document. |
| `title` | Collaborative Unicode text. Empty is allowed and the UI may derive a display title without mutating it. |
| `document` | Root schema document, stored as structured Yjs XML and projected to canonical JSON. |
| `folderPlacement` | Event-selected optional `FolderId`. Orphans appear in a recovery view. |
| `tags` | Observed-remove set of `TagId`. |
| `pinned`, `archived` | Event-selected booleans. A note cannot be both visible-trash and archived in projections. |
| `trashedAt` | Optional deletion event with logical and wall time. User restoration clears it with a later event. |
| `manualPosition` | Fractional ordering string scoped to a folder and selected by event order. Rebalancing writes a batch with one transaction ID. |
| `created` | Original logical event and display timestamp. Immutable after import normalization. |
| `modified` | Greatest applied logical event plus display timestamp. Never used for merge correctness. |
| `attachments` | Derived set of attachment references in the document. |
| `versionRefs` | User-visible retained snapshot references. Not embedded in the active Yjs document. |

#### Folder

| Field | Type and rule |
| --- | --- |
| `id` | Immutable `FolderId`. |
| `name` | Non-empty trimmed display string, stored through rename events. Duplicate sibling names are allowed. |
| `parentPlacement` | Optional `FolderId` event. Cycle repair is deterministic. |
| `manualPosition` | Fractional ordering string within its parent. |
| `created`, `modified`, `trashedAt` | Logical events plus display timestamps. Trashing a folder does not immediately trash its notes. |

#### Tag

| Field | Type and rule |
| --- | --- |
| `id` | Immutable `TagId`. |
| `name` | Non-empty normalized display string. Case-insensitive uniqueness is a UI warning, not an identity rule. |
| `colorRole` | Optional token palette ID, never an arbitrary UI hex in core data. |
| `created`, `modified`, `trashedAt` | Logical events plus display timestamps. |

#### Attachment

| Field | Type and rule |
| --- | --- |
| `id` | Vault-scoped content ID derived from the plaintext digest as specified in the crypto section. |
| `plaintextSha256` | Stored locally and inside encrypted catalog metadata so an authorized fresh device can derive the attachment key. Never exposed in an encrypted routing header or filename. |
| `byteLength` | Unsigned integer verified before open and export. |
| `mimeType` | Validated MIME string with `application/octet-stream` fallback. |
| `originalName` | Sanitized display name. Never used as a filesystem path. |
| `pixelSize` | Optional integer width and height for raster images. |
| `localState` | Available, evicted, importing, corrupt, or absent. |
| `remoteRefs` | Validated immutable object references and encryption-suite metadata. Encrypted attachment keys are derived, not wrapped per reference. |
| `created` | Logical event and display timestamp. |

Captions, alt text, crop, and displayed width belong to each image node, not the attachment entity.

### 3.2 Rich document schema version 1

The root node is `doc`. It contains block nodes only.

| Kind | Nodes and attributes |
| --- | --- |
| Text blocks | `paragraph`, `heading(level 1..6)`, `blockquote`, `codeBlock(languageId)`, `horizontalRule` |
| Lists | `bulletList`, `orderedList(start)`, `listItem`, `taskList`, `taskItem(checked)` |
| Rich blocks | `table`, `tableRow`, `tableCell(header, colspan, rowspan)`, `image(attachmentId, widthBasisPoints, alt)`, `caption`, `fileAttachment(attachmentId)`, `mathBlock(latex, alt)` |
| Inline | `text`, `hardBreak`, `mathInline(latex, alt)` |
| Marks | `bold`, `italic`, `underline`, `strikethrough`, `inlineCode`, `link(href, title)`, `textColor(paletteId)`, `highlight(paletteId)` |

Every structural node has a stable node ID. Image width uses integer basis points from 1 to 10,000, which avoids cross-language floating-point canonicalization. URLs allow `https`, `http`, `mailto`, and explicit user-approved custom schemes. Canonicalization removes unknown attributes, rejects unknown node types, normalizes illegal nesting through versioned rules, and never silently drops user text.

Markdown input rules create schema transactions only after a terminating space or Enter confirms the pattern. Backspace at the start of the converted block can undo the rule as one persistent undo group.

### 3.3 CRDT shape

Each note Yjs document contains:

```text
note
  title: Y.Text
  body: Y.XmlFragment
  metadata: Y.Map
    tagAdds and tagRemoves
    stateEvents
    folderEvents
    manualOrderEvents
  attachmentRefs: Y.Map
  schemaVersion: Y.Map entry
```

Schema block and inline nodes map to `Y.XmlElement` and text to `Y.XmlText`. Marks map to formatting attributes. No canonical document is stored as one opaque string inside Yjs. The `schema` package owns conversion in both directions and validates every result.

Folder and tag CRDT documents store rename, placement, and tombstone events. Catalogs are derived projections. They are never merge authority.

### 3.4 Local SQLite model

| Table group | Purpose |
| --- | --- |
| `notes`, `folders`, `tags`, `note_tags` | Fast normalized projections for lists and organization. |
| `documents`, `crdt_checkpoints`, `crdt_updates` | Canonical projection, Yjs checkpoints, state vectors, and ordered updates. |
| `attachments`, `attachment_refs`, `local_files` | Metadata, reachability, local cache state, and safe paths. |
| `editor_intake`, `applied_transactions` | Durable native operations and exactly-once materialization ledger. |
| `undo_entries`, `version_snapshots` | Device-local persistent undo and user-visible history. |
| `outbox`, `remote_objects`, `remote_heads` | Pending publication, validated remote metadata, and coverage. |
| `sync_cursors`, `sync_runs`, `device_records`, `relay_state` | Provider cursors, state-machine diagnostics, acknowledgement, stale-device rules, relay capabilities, dirty epoch, and channel expiry. |
| `notes_fts` | FTS5 external-content index over title, body projection, tags, and captions. |
| `quarantine`, `migration_log`, `diagnostic_log` | Contained failures, resumable migration, and exportable diagnostics. |

Schema migrations run in transactions where SQLite permits. Long data rewrites use versioned shadow tables and resumable batches. The old copy stays until the new copy validates. Never delete the pre-migration database until a post-migration checkpoint and export smoke test succeed.

### 3.5 Remote formats

Every remote file begins with or contains these fields from the first commit:

| Field | Meaning |
| --- | --- |
| `magic` | Fixed Jot file marker and kind. |
| `remoteFormatVersion` | Exact container encoding version, initially 1. |
| `minReaderVersion`, `minWriterVersion` | Compatibility gates. |
| `vaultId`, `objectId`, `kind` | Namespace, identity, and payload kind. |
| `createdByDeviceId`, `deviceSequence` | Provenance and per-device ordering. |
| `schemaVersion` | Document schema needed for decoded payloads. |
| `encryption` | None or named suite, nonce or stream header, and wrapped-key or key-derivation descriptor. |
| `plaintextLength`, `ciphertextLength` | Bounds checked before allocation and after streaming. Plaintext length may be bucketed later, but v1 leaks it. |
| `payloadSha256` | Ciphertext hash for transport and torn-write detection. |

Object kinds are CRDT delta pack, CRDT checkpoint, attachment, version snapshot, catalog shard, tombstone pack, and device acknowledgement. A head contains the prior head hash, a list of newly announced object descriptors, checkpoint coverage vectors, and an authentication tag when the vault uses encryption. A catalog contains derived entity projections and references, split into bounded shards.

The unencrypted representation uses deterministic canonical JSON for small records and length-prefixed binary payloads for Yjs updates and attachments. The encrypted representation preserves only the routing header and encrypts the payload. The format specification and golden files live beside `packages/sync`, independent of Drive.

### 3.6 Relay metadata

The relay database has no foreign key to a Google account, Drive folder, note, or remote object. Its records are deliberately disposable:

| Record | Permitted fields |
| --- | --- |
| `topics` | Opaque topic ID, enrollment-capability verifier, dirty epoch, created time, last activity, expiry policy. |
| `devices` | Opaque device ID, topic ID, device-capability verifier, platform, encrypted notification endpoint, last delivery status, expiry. |
| `channels` | Random channel ID, topic ID, channel-token hash, opaque Drive change-feed resource ID, expiration, last notification time. |
| `rate_limits` | Hashed abuse key, time bucket, count, and expiry. |

No record accepts free-form user text or arbitrary bytes. Field lengths and enumerations are fixed. Expired channels are removed from live tables within 24 hours. Inactive device records expire after 90 days unless the product chooses a shorter disclosed period. Topic deletion removes every device and channel record from live tables. Provider backup and log retention can extend physical deletion and must be disclosed separately. A relay export is not a vault export because it contains no recoverable user content.

## 4. Phased development plan

The estimates below are engineer-weeks for one senior engineer already comfortable with React Native, Swift, Kotlin, Rust, SQLite, and editor internals. Calendar time will be longer when specialist knowledge is missing. Each phase ends with a runnable artifact.

### Phase 0: repository, schema, and four shells

Estimate: 3 to 5 weeks.

Runnable result: a root command runs shared checks and launches an Expo development build or current-host Tauri app. CI builds hello-world artifacts for iOS, Android, macOS, and Windows.

Work:

- Create Bun workspaces, Turborepo tasks, project references, lint, format, dependency-direction checks, and CI matrices.
- Build the authored token source and generation drift test.
- Define schema version 1, canonical serializer, validators, migrations, generated Swift, Kotlin, and ProseMirror declarations, and the initial conformance corpus.
- Establish the local-store, crypto, storage-provider, editor, and clock interfaces without production implementations.
- Establish the `ChangeWakeup` interface and a machine-checked relay data policy that cannot express user content or Drive credentials.
- Create Expo development builds and Tauri shells. Record native toolchain versions.

Exit criteria:

- `bun run check` is green on macOS, Windows, and Linux CI for shared code.
- CI installs and launches an iOS simulator build, Android emulator build, macOS app, and Windows app.
- Canonical schema fixtures match byte for byte in TypeScript, Swift, Kotlin, and Rust.
- Generated tokens match on all platforms and raw design values fail lint.
- No DOM types enter a mobile package and no platform package enters `core` or `sync`.
- Dependency rules prevent the relay implementation from importing document schemas, Drive adapters, or content formats.

Risky unknowns:

- Bun and Metro workspace resolution with the pinned Expo SDK.
- Deterministic native code generation and checked-in native projects.
- Cross-language canonical JSON edge cases.

Safe cuts:

- A polished shell, real navigation, and all product features.
- A deployed relay. The interface and forbidden-data checks remain.
- A single-host "launch all four" command. CI coverage is mandatory.

### Phase 0.5: native editor go or no-go spike

Estimate: 8 to 12 weeks. Add four weeks if one engineer is learning both text systems.

Runnable result: the editor lab shows one native editor and formatting toolbar on iOS and Android with the same fixtures and command contract.

Work:

- Implement TextKit 2 and Spannable models for paragraphs, headings, bold, italic, lists, checklists, and code blocks.
- Implement selections, stored marks, keyboard insets, Markdown input rules, paste, native undo groups, durable intake, and recovery.
- Prove IME composition on Apple and Google keyboards plus representative Chinese, Japanese, Korean, Hindi, Arabic, Hebrew, emoji, autocorrect, dictation, and hardware keyboards.
- Benchmark 5,000-word scroll, typing, large paste, repeated undo, rotation, background and foreground, and process kill.
- Run a small Yjs, Loro, and Automerge release-build benchmark under Hermes. Yjs remains the default unless evidence overturns it.

Exit criteria:

- No intermediate IME state enters the CRDT operation trace.
- Insert, delete, replace, mark toggle, list split and join, and checklist toggle round-trip to identical canonical form.
- Every acknowledged edit survives kill tests at all injected persistence points.
- Typing and selection meet a 60 fps interaction budget on the lowest supported devices, with documented p95 and p99 durability latency.
- A 5,000-word note scrolls, selects, autocorrects, and undoes without jumps or memory growth.
- VoiceOver and TalkBack can read and navigate the supported blocks.

Risky unknowns:

- `EditText` span mutation during complex IME composition.
- TextKit 2 attachment and selection behavior around block nodes.
- Synchronous durable journal latency on low-end Android storage.
- Yjs behavior and memory under the pinned Hermes release.

Safe cuts:

- Tables, math, color, highlight, images, files, and syntax colors.
- Application chrome, sync, auth, folders, and search.

Do not cut IME, autocorrect, selection, undo, 5,000-word performance, release hardware tests, or crash recovery. If this phase fails, stop. Options are a smaller plain-text-plus-light-marks product, a funded native-editor team, or a different mobile stack. A WebView editor is not the fallback.

### Phase 1: useful local-only mobile app

Estimate: 12 to 16 weeks.

Runnable result: a person can use Jot every day on one iOS or Android device without an account.

Work:

- Complete the Phase 1 native feature set described in section 1.9.
- Add notes, nested folders, tags, pin, archive, 30-day trash, manual order, sorting by created time, modified time, title, or manual position, autosave, persistent undo and redo, and local version snapshots.
- Implement SQLite WAL persistence, projections, migrations, FTS5 ranking and snippets, attachment import, and local diagnostics.
- Add empty, loading, error, recovery, and large-text accessibility states.
- Add local portable export now as a safety mechanism, even though full import and export polish remains later.

Exit criteria:

- A 10,000-note synthetic vault meets the search and open-time budgets.
- Crash tests preserve all acknowledged edits and recover projections.
- Folders survive cycle, rename, delete, restore, and manual-reorder edge cases.
- Undo and redo survive restart for at least 100 local transactions per note.
- "Export everything now" produces readable Markdown and every local attachment while offline.
- Both mobile platforms pass the same editor and migration corpus.

Risky unknowns:

- Long-note native layout with mixed code and image attachments.
- FTS update cost under rapid edits and SQLCipher migration preparation.
- Durable undo semantics after normalization and imported content.

Safe cuts from this phase, but not from v1:

- Tables, LaTeX, color, highlight, image resize and captions, file attachments, drag and drop, and broad language highlighting.
- Automatic version pruning UI. The underlying snapshots and restore operation remain.

### Phase 2: Drive sync, relay, and CRDT merge

Estimate: 15 to 22 weeks.

Runnable result: two mobile devices can edit the same note offline, reconnect in either order, and converge through the user's Drive. When the relay is healthy they receive fast invalidations. When it is deleted or offline they still converge through polling.

Work:

- Implement native Google authorization, secure token storage, `drive.file`, and consent-error states.
- Ship the `StorageProvider` interface, adversarial in-memory adapter, and Drive adapter together.
- Ship the `ChangeWakeup` interface, adversarial memory adapter, content-blind Convex relay adapter, capability-authenticated anonymous device registration, one Drive changes channel per device, webhook validation, a direct Expo Push Service action, active desktop subscriptions, expiry cleanup, and local fallback timers.
- Implement immutable packs, device heads, catalogs, checkpoints, change tokens, outbox, resumable attachments, bootstrap, deduplication, stale-device handling, and garbage collection dry runs.
- Build sync status UI and the deterministic failure simulator.
- Add remote format version 1 golden fixtures and restore drills.

Exit criteria:

- Random multi-device partitions converge without lost document edits.
- Interrupted uploads never create a readable commit and resume or leave a safe orphan.
- Two simultaneous head publications merge without a manifest conflict.
- A fresh install restores exact normalized state and lazy-loads attachments.
- 403, 429, 5xx, expired authorization, corrupt files, duplicate files, clock skew, and app kill retain local work and produce actionable status.
- Deleting the relay database and blocking its network path does not change restored state or convergence. It only changes detection latency.
- Relay schema and route tests prove that user content, Drive credentials, cursors, and object identifiers have no accepted field or log path.
- Spoofed, replayed, duplicated, expired, and stormed notifications cannot make a client trust false content or exceed its local polling cap.
- The same Google Cloud project and `drive.file` grant work across all registered mobile client IDs, or the user-mediated grant fallback is accepted.

Risky unknowns:

- Cross-client visibility under `drive.file`.
- Drive listing and change behavior with 10,000-note synthetic vaults and many packs.
- Background scheduling limits and user expectations for sync delay.
- Drive channel expiry, renewal races, and silent-push throttling.
- Convex log retention, metadata deletion, regional processing, cost, and incident behavior.
- Anonymous relay abuse without a Jot account, especially on desktop where strong app attestation is unavailable.
- Safe compaction when a device returns after months offline.

Safe cuts:

- Remote garbage deletion can ship as report-only until confidence is high.
- Active desktop subscriptions and aggressive background cadence can fall back to polling.
- If the Convex privacy review fails, omit the production relay and ship direct polling. Do not weaken credential custody or proxy content to preserve push delivery.
- No part of the in-memory provider, merge tests, status UI, restore drill, or format gate is cuttable.

### Phase 3: encryption and locks

Estimate: 9 to 13 weeks, plus external review time.

Runnable result: an encrypted Drive vault syncs between two mobile devices, recovers with its code, changes passphrase without rewriting content, and locks locally.

Work:

- Integrate the pinned Rust cryptography core and shared vectors.
- Implement VMK envelopes, Argon2id calibration, XChaCha20-Poly1305 objects, authenticated stream attachments, key rotation, and encrypted catalogs.
- Migrate local databases to SQLCipher.
- Add per-note lock, biometric wrappers, app lock timeout, redaction, recovery code confirmation, and recovery drill.
- Commission an independent design and implementation review before enabling encryption by default.

Exit criteria:

- Cross-platform crypto fixtures are byte-identical and negative tests reject every modified byte and header.
- Passphrase change only rewraps the VMK.
- Low-memory devices either complete the stored KDF profile or refuse clearly. They never weaken it silently.
- Recovery code restores a fresh install. Loss copy is shown and confirmed during setup.
- Locked content never appears in FTS, widget, preview, log, export, or app-switcher snapshot while locked.
- Encrypted sync passes the entire Phase 2 failure suite.

Risky unknowns:

- Rust mobile-library packaging and secure memory behavior across four targets.
- Argon2 latency and memory on the lowest Android tier.
- SQLCipher FTS performance and migration disk-space needs.
- Product comprehension of recovery and permanent loss.

Safe cuts:

- Multiple passphrases, hardware security keys, decoy vaults, and advanced key-management UI.
- Biometric unlock is not cuttable because it is an explicit v1 feature. Recovery confirmation and negative crypto tests are not cuttable.

### Phase 3.5: mobile integration and mobile ship gate

Estimate: 8 to 12 weeks.

This phase is added to honor the stated platform priority. Waiting for desktop before mobile integration would make the priority meaningless.

Runnable result: iOS and Android release candidates with the complete mobile v1 scope.

Work:

- Finish deferred mobile editor nodes: tables, LaTeX, colors, highlight, image resize and captions, drag and drop where the OS supports it, files, and language selection.
- Add share targets, quick-capture deep links, widgets, camera, photo library, app shortcuts, import, and final portable export.
- Run accessibility, localization readiness, battery, memory, cold-start, low-storage, and store-policy passes.
- Conduct TestFlight and Play closed testing with user-initiated diagnostic export.

Exit criteria:

- Every essential mobile feature in the brief is present and passes schema conformance.
- Widget quick capture opens the native editor at a new note in one interaction. The widget itself does not host a keyboard.
- Share extension intake survives host-app absence, process kill, and locked-vault states.
- Mobile restore, export, recovery, and 10,000-note performance drills pass on release hardware.
- Store submissions contain accurate privacy nutrition labels and Google OAuth disclosures.

Risky unknowns:

- Mobile table editing quality.
- Apple Notes import fidelity and Automation or share-sheet limitations.
- Extension access to encrypted shared state under device lock.

Safe cuts:

- No essential feature listed in the brief is cuttable without product-owner approval.
- Optional widget display variants, decorative motion, and nonessential import-source polish can wait.

### Phase 4: desktop application

Estimate: 13 to 18 weeks.

Runnable result: local and synced Jot vaults open on macOS and Windows with the ProseMirror editor and complete desktop workflows.

Work:

- Build the Tauri shell, Rust durability and SQLite adapters, desktop auth, secure key storage, and encrypted sync.
- Implement TipTap and ProseMirror against the generated schema and y-prosemirror.
- Add complete keyboard shortcuts, native menus, global quick capture, tray or menu-bar item, drag and drop, and multi-window coordination.
- Pass the mobile corpus plus desktop-specific clipboard, HTML, Markdown, selection, and accessibility tests.

Exit criteria:

- All schema fixtures round-trip byte-identically on mobile and desktop.
- Two desktop windows and one mobile device can edit one note and converge.
- Native menus and shortcuts follow macOS and Windows conventions and expose no WebView-only dead ends.
- Global hotkey conflicts are detected and configurable.
- Desktop restore, export, encryption recovery, and 10,000-note tests pass.

Risky unknowns:

- Exact ProseMirror to canonical-schema normalization around tables and marks.
- Windows Credential Manager, WebView2 IME, and multi-window database coordination.
- macOS sandbox Automation permission for Apple Notes import.

Safe cuts:

- Extra tray actions, custom title bars, and visual flourishes.
- Multi-window, native menus, global quick capture, and full shortcuts remain v1 requirements.

### Phase 5: cross-platform hardening and desktop ship

Estimate: 8 to 12 weeks.

Runnable result: signed macOS and Windows releases, plus one shared v1 format and support package across all targets.

Work:

- Close platform conformance gaps, migration paths, accessibility findings, and performance regressions.
- Run month-long offline and stale-device simulations, quota budgets, restore drills, downgrade refusal, and corrupt-remote recovery.
- Finalize local diagnostic export, user recovery documentation, Drive-folder README, privacy policy, OAuth verification, relay retention and deletion runbooks, push credential rotation, signing, notarization, installers, and store submissions.
- Freeze schema version 1 and remote format version 1. New features wait until the migration and compatibility policy is exercised in production.

Exit criteria:

- All four release builds pass the same normalized restore corpus.
- No known issue can lose acknowledged local work or overwrite it from remote state.
- Independent crypto findings are resolved or explicitly block encrypted-vault release.
- Support can diagnose auth, quota, corruption, migration, and export failures using user-provided local logs.
- Relay dashboards prove notification health and record expiry without ingesting client diagnostics or user content.
- Mobile remains format-compatible with desktop and can refuse a newer writer safely.

Risky unknowns:

- Real-world long-lived Drive quota patterns without product telemetry.
- Relay cost, notification abuse, vendor outages, and APNs or FCM credential incidents.
- Signing, notarization, antivirus, and store-review behavior.
- Migration and stale-device behavior after a real release interval.

Safe cuts:

- Marketing surfaces, extra themes, animation polish, and providers beyond Drive.
- None of the reliability gates, portable export, local logs, recovery documentation, or compatibility tests are cuttable.

### 4.1 Overall effort and staffing

The phase ranges total 76 to 110 engineer-weeks before external review and release variance. A single founding engineer should assume 17 to 23 months of focused work. Two senior engineers with one owning native editors and one owning storage, sync, relay, and application flows might reach mobile release in 10 to 14 months, then desktop in another 4 to 6 months. Adding engineers does not divide the schedule evenly because schema, editor, remote-format, and privacy decisions serialize much of the early work.

Native editing spans Phase 0.5, Phase 1, and Phase 3.5. Counting schema work, native implementations, IME testing, advanced blocks, and conformance, it consumes about 35 to 45 percent of v1 engineering. Treating it as a normal React Native view would be the fastest way to miss the schedule and quality bar.

## 5. Open questions before Phase 1

Phase 0 and Phase 0.5 can start with the recommendations above. These decisions must be resolved before Phase 1 scope locks:

1. **Durability versus input latency.** Approve the "acknowledged committed edit" definition and the Phase 0.5 benchmark gate. If synchronous stable writes miss the frame budget, choose a maximum uncommitted window, such as 50 ms, or fund a more complex native journal. An absolute zero-window promise without measurement is not credible.
2. **Minimum operating systems.** Recommended starting points are iOS 17, Android 10 with API 29, macOS 13, and Windows 10 version 1903 with Evergreen WebView2. Older support raises editor, crypto, and background-work cost.
3. **Advanced mobile editing interaction.** Approve atomic table blocks that open a dedicated native table editor on mobile. Requiring desktop-style inline table cell editing changes the native editor estimate materially.
4. **Local encryption promise.** Approve SQLCipher by default in Phase 3. Encrypting only the Drive copy while leaving FTS plaintext weakens app lock and per-note lock expectations.
5. **Recovery policy.** Approve mandatory recovery-code confirmation before enabling vault encryption or the first synced locked note. There is no reset path.
6. **Version retention.** Approve or replace the proposed hourly, daily, and weekly automatic history schedule. Storage cost and CRDT compaction depend on it.
7. **Apple Notes import.** Decide whether the proposed macOS Automation importer plus share-sheet import satisfies v1. "Bulk, perfect, all-platform Apple Notes import" is not supportable with public interfaces.
8. **Text colors.** Approve a fixed accessible palette stored by semantic palette ID. Arbitrary RGB colors will produce poor dark-mode and import behavior unless the editor also stores light and dark variants.
9. **Vault count and Google accounts.** Recommend one active vault per installation for v1, with an explicit disconnect and replace flow. Multiple simultaneous vaults or accounts multiply every sync, lock, widget, and share-extension state.
10. **Mobile release sequencing.** Approve Phase 3.5 as the mobile ship gate before desktop. If the original Phase 4 then Phase 5 order is mandatory, the stated mobile-first priority should be revised.
11. **Security review budget.** Decide who performs the external cryptographic and data-loss review and reserve schedule for it. Self-review is not enough for a new encrypted file format.
12. **Relay hosting and metadata policy.** Approve Convex as the Phase 2 candidate, subject to a privacy and retention review, or require a purpose-built host. Approve the proposed 24-hour expired-channel cleanup and 90-day inactive-device expiry. The relay still processes installation identifiers and usage timing.
13. **Anonymous abuse posture.** Decide whether mobile app attestation is acceptable and whether IP-based rate limits are compatible with the privacy position. Without accounts or strong desktop attestation, the relay cannot eliminate fake registrations.
14. **Content transit promise.** This design preserves the original statement that the operator never sees user content. If "does not store notes" is meant to allow a proxy to process unencrypted note bytes or hold Drive tokens transiently, that is a different and weaker privacy promise. I recommend retaining the stronger promise and using the relay only for notifications.
15. **Relay consent.** Decide whether generic wakeups are default-on with disclosure, explicitly opt-in, or disabled by default. I recommend default-on during Drive setup with a "Direct Drive polling only" setting because the relay stores activity metadata and sync remains correct without it.

### Decisions that do not need product input

The following are engineering validation gates rather than preference questions:

- Prove cross-platform `drive.file` visibility across the Cloud project's client IDs in Phase 2.
- Re-measure Drive quotas before implementation and before launch.
- Benchmark all three CRDTs in the Phase 0.5 release app, while keeping Yjs as the proposed choice.
- Confirm the supported LaTeX subset with renderer fixtures.
- Confirm that every checked-in dependency has a maintainer, license, release cadence, security policy where available, and a reason to exist.

## Source index

- [Expo Modules overview](https://docs.expo.dev/modules/overview/)
- [Expo authentication and development-build redirects](https://docs.expo.dev/guides/authentication/)
- [Tauri frontend model](https://v2.tauri.app/start/frontend/)
- [Google OAuth for installed applications](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google Drive scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Drive changes](https://developers.google.com/workspace/drive/api/guides/manage-changes)
- [Google Drive push notifications](https://developers.google.com/workspace/drive/api/guides/push)
- [Google Drive usage limits](https://developers.google.com/workspace/drive/api/guides/limits)
- [Convex HTTP actions](https://docs.convex.dev/functions/http-actions)
- [Convex scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions)
- [Convex React Native client](https://docs.convex.dev/client/react-native)
- [Convex realtime subscriptions](https://docs.convex.dev/realtime)
- [Convex security](https://www.convex.dev/security)
- [Convex self-hosting](https://docs.convex.dev/self-hosting)
- [Convex backup and restore](https://docs.convex.dev/database/backup-restore)
- [Expo Push Service](https://docs.expo.dev/push-notifications/sending-notifications/)
- [Yjs repository and format notes](https://github.com/yjs/yjs)
- [Yjs ProseMirror binding](https://github.com/yjs/y-prosemirror)
- [Loro JavaScript documentation](https://www.loro.dev/docs/tutorial/get_started)
- [Automerge rich text](https://automerge.org/docs/reference/documents/rich-text/)
- [RFC 9106 Argon2](https://www.rfc-editor.org/rfc/rfc9106.html)
- [RustCrypto password hashing](https://github.com/RustCrypto/password-hashes)
- [RustCrypto XChaCha20-Poly1305](https://docs.rs/chacha20poly1305/latest/chacha20poly1305/)
- [libsodium authenticated encryption](https://doc.libsodium.org/secret-key_cryptography/aead)
- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [React Native Reanimated accessibility](https://docs.swmansion.com/react-native-reanimated/docs/guides/accessibility/)
- [Apple shared app and extension data](https://developer.apple.com/documentation/technologyoverviews/shared-data)
- [Apple interactive widgets](https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities)
