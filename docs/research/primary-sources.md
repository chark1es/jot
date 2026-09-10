# Jot primary-source research

Checked 2026-09-08. This is a research note for the technical design, not an implementation specification. Google, Expo, Tauri, and package behavior is date-sensitive. Recheck the linked pages and the actual Google Cloud quota console before release.

## Executive conclusions

1. The no-backend architecture is viable, but one premise needs correction. Tauri desktop can use Google's installed-app flow with PKCE, a random loopback port, no meaningful client secret, and a refresh token stored by the app. Google's iOS SDK also persists and refreshes tokens on-device. Current Android guidance is different: `AuthorizationClient` supplies short-lived access tokens and explicitly discourages keeping refresh tokens on-device. It can silently provide a new access token after a grant, so foreground on-device Drive sync remains viable, but Jot should not promise that its Android app owns a long-lived refresh token. Background and process-restart behavior must be proved in Phase 2.
2. `drive.file` is the right scope for an app-created, visible `Jot` folder. It grants access to files the app creates, opens, or that the user shares with it. It does not grant blanket access to every file a user later drops into that folder.
3. Drive has a change feed, resumable uploads, and useful integrity metadata. It does not document transactions, locks, a Cloud Storage-style generation precondition, or Drive-specific compare-and-swap behavior for `files.update`. A shared mutable manifest is therefore not a safe source of truth.
4. Store immutable CRDT update or snapshot objects and immutable blobs, with small per-device heads. Never require two devices to overwrite the same authoritative file. Treat any aggregate manifest as a rebuildable cache.
5. Yjs v13 is the lowest-risk v1 CRDT choice because its core is JavaScript and avoids WebAssembly under Hermes, and its stable ProseMirror binding is more mature than the alternatives. Loro deserves a Phase 0.5 challenger spike because it has strong rich-text, history, and shallow-snapshot primitives plus an official-organization React Native binding. That binding is young. Automerge currently has the weakest fit because its JavaScript package needs WebAssembly while Hermes still has no documented `global.WebAssembly`, and its ProseMirror binding calls itself beta.
6. Version history is not close to free. CRDTs provide causal operations and convergence, not a user-friendly version timeline, durable named checkpoints, or cheap indefinite retention. Jot needs an explicit checkpoint and retention model.
7. Use one native Rust cryptography core on all four platforms, with Argon2id and XChaCha20-Poly1305. This avoids relying on Web Crypto and avoids three subtly different file-format implementations. The FFI and mobile build chain are a real cost and need an early proof.
8. Use `expo-sqlite` with FTS5 first on mobile. Use a Rust-owned bundled SQLite build on desktop so the exact SQLite and FTS5 configuration is controlled. Share repository contracts, migrations, fixtures, and query semantics, not one concrete database driver.
9. A tokenless Convex relay can receive empty Drive webhooks and send opaque invalidations without receiving Jot content or Drive credentials. It improves freshness and reduces polling, but clients must renew their own Drive channels at least weekly. Relay loss must delay discovery only. It must never affect sync correctness.

## 1. Google OAuth on installed apps

### Facts from Google and Expo

Google's [OAuth 2.0 for iOS and desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app) says:

- Installed apps cannot keep a client secret confidential. The token endpoint lists `client_secret` as optional, and it is not applicable to Android, iOS, or Chrome client refresh requests.
- Google supports PKCE and recommends `S256`. PKCE still needs a cryptographically random `state` value and exact redirect URI validation.
- A successful installed-app authorization-code exchange returns an access token and refresh token. The page says refresh tokens are always returned for installed applications and must be stored securely. It also says refresh tokens can expire or be revoked.
- A random-port loopback redirect at `http://127.0.0.1:{port}` is the recommended mechanism for macOS, Linux, and Windows desktop apps. Loopback redirects are deprecated for Android and iOS OAuth client types.
- Embedded user agents are not the installed-app path. Authentication must open the system browser or provider SDK user agent.
- Custom URI schemes are no longer supported for Android OAuth clients. Google's mobile guidance points applications to platform SDKs.

Google's general [OAuth 2.0 documentation](https://developers.google.com/identity/protocols/oauth2) adds important operational limits:

- Refresh tokens can stop working because of revocation, six months of non-use, account or administrator policy, token-count limits, or time-based grants.
- An external OAuth consent screen left in `Testing` generally receives refresh tokens that expire after seven days when Drive scope is requested.
- There is currently a limit of 100 refresh tokens per Google Account per OAuth client ID. Issuing more invalidates older tokens.

Expo's [AuthSession documentation](https://docs.expo.dev/versions/latest/sdk/auth-session/) confirms that AuthSession supports browser-based OAuth and native custom-scheme redirects, with PKCE enabled by default. It also explicitly recommends using an identity-provider library for Google rather than the generic AuthSession path. Expo's [Google authentication guide](https://docs.expo.dev/guides/google-authentication/) points developers toward native Google sign-in integrations and notes that Google's legacy Android sign-in SDK is deprecated in favor of Credential Manager.

### Platform decision

| Target | Recommended flow | Refresh behavior | Design consequence |
| --- | --- | --- | --- |
| iOS, Expo dev client | Native Google Sign-In SDK through an Expo native module | `GIDGoogleUser` exposes token refresh behavior and restores prior sign-in state | No backend is required for Drive calls. Store SDK state in Keychain and expose access-token acquisition, not raw refresh-token handling, to TypeScript. See [Google's iOS API access guide](https://developers.google.com/identity/sign-in/ios/api-access) and [GIDGoogleUser reference](https://developers.google.com/identity/sign-in/ios/reference/Classes/GIDGoogleUser.html). |
| Android, Expo dev client | Sign-in through Credential Manager, then Google Identity Services `AuthorizationClient` through an Expo native module | One-hour access token; a later `authorize()` can return a fresh token without interaction while the grant remains | No backend is needed for interactive or foreground sync, but this is not an app-owned refresh token. Google [strongly discourages on-device refresh-token storage](https://developer.android.com/identity/authorization). Prove headless and background refresh behavior on real devices. |
| macOS and Windows, Tauri | Desktop OAuth client, system browser, PKCE S256, random IPv4 loopback listener in Rust | App-held refresh token in platform secure storage | Fully compatible with a zero-backend desktop client. The Tauri frontend should never receive the refresh token. |

This rejects one raw `expo-auth-session` Google implementation shared across iOS and Android. Expo can deep-link back to a custom app scheme, but Google does not support custom-scheme redirects for Android OAuth clients. A native Google authorization module is the supported route.

For Tauri, use the system browser and a short-lived loopback listener in the Rust process. The [Tauri deep-link plugin](https://v2.tauri.app/plugin/deep-linking/) works on macOS and Windows, but it is not needed for the recommended Google desktop flow. Deep links also have spoofing considerations, which Tauri itself calls out. The loopback handler must bind only to loopback, select a random available port, accept one request, verify `state`, exchange the code with the PKCE verifier, return a simple completion page, and close. Opening the authorization URL can use Tauri's [opener plugin](https://v2.tauri.app/plugin/opener/).

### Challenge to the product premise

The statement that every installed client receives a real long-lived refresh token is too broad. It holds for Google's generic iOS and desktop installed-app documentation and is visible in Google's current iOS SDK. Current Android authorization guidance says a refresh token is for backend offline access and strongly discourages storing it on-device. Android still appears able to reauthorize silently and keep the zero-backend design, but Google has not given Jot a contractual guarantee that this works for every OS-managed background execution case.

Phase 2 must test these cases on Android release builds: process death, reboot, access-token expiry, revoked grant, Credential Manager update, Doze, scheduled background work, and a device offline longer than the access-token lifetime. The honest UI fallback is "Sign in again to resume sync," never silent data loss.

### Security notes

- Store desktop refresh tokens in macOS Keychain and Windows Credential Manager. Keep them out of the WebView, logs, crash exports, and SQLite.
- Let Google's native iOS SDK own its persisted credential state.
- On Android, ask the native authorization API for an access token when needed and do not invent a local refresh-token flow that contradicts the platform guidance.
- Google now documents optional DPoP for installed-app token exchanges. It is worth evaluating after the basic flow works, but it adds nonce, hardware-key, and refresh-exchange state. It should not block Phase 2 unless threat modeling makes bearer-token theft the leading risk.
- Publish the OAuth consent screen before production. Drive's `drive.file` scope is non-sensitive, but brand verification and accurate disclosures still apply. The seven-day testing token lifetime will otherwise look like a sync reliability defect.

## 2. Google Drive v3 as a transport

### Scope and visible folder

Google classifies [`drive.file` as non-sensitive, per-file access](https://developers.google.com/workspace/drive/api/guides/api-specific-auth). It permits creation of new files and modification of files opened with or shared with the app. It works with all Drive REST resources. This is sufficient for a visible `Jot` folder and all files Jot itself creates within it. The standard [folder guide](https://developers.google.com/workspace/drive/api/guides/folder) covers creating a regular folder in My Drive.

Do not use `appDataFolder`. The visible folder satisfies user ownership and inspection. With encryption enabled, users can inspect the files and export them, but their content will intentionally be ciphertext.

Use private `appProperties` for machine-readable type, vault ID, object ID, format version, device ID, and logical epoch. Google documents `appProperties` as private to the requesting app and searchable through authenticated requests in the [File resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files) and [file search guide](https://developers.google.com/workspace/drive/api/guides/search-files). Do not place secrets or plaintext note titles there.

One boundary matters: `drive.file` does not imply access to arbitrary files merely because the user manually places them under the Jot folder. Import should use the platform picker or a local file import path. Restore must depend only on Jot-created files.

### Remote change detection

Use the [Drive changes collection](https://developers.google.com/workspace/drive/api/guides/manage-changes), not periodic `files.list` sorted by `modifiedTime`.

The safe cursor sequence is:

1. Obtain and persist `changes.getStartPageToken` before the initial inventory.
2. Complete the inventory, then call `changes.list` with the saved earlier token so changes made during the scan are replayed.
3. Process changes in chronological order. Resolve each relevant file to a local, idempotent inbox record.
4. Follow `nextPageToken` until the last page.
5. Persist `newStartPageToken` only in the same local transaction that records successful processing of the final page.

Polling `modifiedTime` risks clock-skew assumptions, pagination gaps, and missed deletions. The changes feed is explicitly designed to track changes and reports removals.

Drive push notifications need a public HTTPS webhook endpoint, per Google's [push notification guide](https://developers.google.com/workspace/drive/api/guides/push). A fully backend-free build therefore polls the changes feed when the app is foregrounded, on reconnect, when background execution is granted, and with adaptive idle intervals. The revised constraint permits an optional metadata-only invalidation relay. Section 7 defines one without putting OAuth tokens or Drive bytes on that relay. Do not promise immediate background sync on mobile in either design.

### Recommended on-Drive layout

The layout should avoid an authoritative file that every device overwrites:

```text
Jot/
  vaults/
    vault-<epoch>-<opaque-id>.json
  devices/
    <device-id>/head-<sequence>.jot
  objects/
    docs/<opaque-content-id>.jot
    indexes/<opaque-content-id>.jot
    blobs/<opaque-content-id>.jot
  gc/
    marks/<device-id>-<sequence>.jot
    tombstones/<opaque-content-id>.jot
```

This tree describes a file protocol, not implementation code.

- Each vault descriptor is an immutable bootstrap record with format version, vault ID, encryption/KDF envelope metadata, and feature epoch. Fresh clients select a valid, supported descriptor by an explicit supersession chain, not by file timestamp. A newer unsupported epoch makes an old client read-only. Passphrase changes publish a new descriptor and do not overwrite the old one until conservative GC.
- Each device publishes immutable, monotonically sequenced head records. A head references immutable CRDT chunks or snapshots that are already fully uploaded. Devices never overwrite each other's head.
- Document objects and attachment blobs are immutable. Re-upload is idempotent by opaque content ID.
- Optional index shards contain encrypted note summaries and current object references. They accelerate fresh install but remain rebuildable.

This borrows the immutable change and snapshot approach described by [Automerge's storage model](https://automerge.org/docs/reference/under-the-hood/storage), without depending on Automerge itself.

### Simultaneous manifest writes

Two devices writing one manifest at once is an avoidable design error. Drive documents neither locking nor multi-file transactions. The Drive v3 `files.update` reference does not document a Drive-specific content compare-and-swap precondition. The File resource exposes `version`, but it is output-only, not an update precondition. No Cloud Storage-style `generation` or `metageneration` field exists.

Therefore:

- No shared manifest may be the source of truth.
- If an aggregate manifest is retained for faster startup, concurrent writers may overwrite it. It must be disposable and reconstructable from immutable objects and per-device heads.
- A device must upload immutable objects first, validate the completed response, then publish a new immutable head. A crash can leave unreachable objects, never a head pointing at a partial object.
- Readers authenticate and validate every object. An invalid length, format, checksum, authentication tag, or reference means skip and report. It never means delete local data.

Uncertainty: standard HTTP APIs often support entity tags and conditional requests, but no current Drive v3 primary documentation found in this review promises content CAS semantics for `files.update`. Do not design around `If-Match` unless an integration test and a current Google contract establish it. Even then, immutable multi-writer objects are simpler.

### Upload completeness and integrity

Google's [resumable upload guide](https://developers.google.com/workspace/drive/api/guides/manage-uploads) specifies:

- Non-final chunks must be multiples of 256 KiB.
- `308 Resume Incomplete` reports accepted progress. The client must honor the server's `Range` and not assume all sent bytes arrived.
- An empty `PUT` with `Content-Range` can query session status.
- `200 OK` or `201 Created` means complete. `404 Not Found` means the upload session expired and must restart.
- Sessions expire after one week of inactivity.

Use resumable upload for large attachments and snapshots. Small immutable CRDT chunks can use multipart upload. Never publish a head until the object upload is complete.

The [Drive File resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files) exposes:

- A monotonically increasing output-only `version` for every server-side change.
- `headRevisionId` for binary Drive content.
- Output-only MD5, SHA-1, and SHA-256 checksums where available for binary stored content.

Drive checksums help confirm transport, but they are not the vault's trust boundary. The Jot envelope should authenticate format version, object type, vault ID, object ID, plaintext length, and content hash as AEAD associated data. Encrypted objects then detect both truncation and substitution independently of Drive metadata.

### Fresh install

A fresh install should not eagerly download attachments or historical operation logs:

1. Locate the app-created Jot folder and list only Jot files, requesting minimal fields and filtering by `appProperties`.
2. Load the newest supported valid vault descriptor by its signed supersession chain, then load per-device heads and the newest valid encrypted index shards.
3. Reconstruct current note and organization metadata.
4. Fetch the latest state needed for visible notes first, then hydrate all current note documents in the background so offline completeness eventually becomes true.
5. Fetch attachment bytes on demand, with a user setting to download all attachments for offline use.
6. Fetch older history only when version history is opened or a repair requires it.

"Fully functional offline" needs a precise bootstrap state. A newly installed client cannot be offline-complete before it downloads data. The UI must distinguish metadata ready, current notes cached, and all attachments cached.

### Blob deduplication and garbage collection

Deduplicate attachments locally before upload using a plaintext cryptographic hash. Under encryption, do not expose the raw plaintext hash as a Drive filename because it enables dictionary guesses and cross-vault equality checks. Derive the remote object ID from a keyed construction such as HMAC under a vault-specific naming key.

Cross-device deduplication also requires identical encrypted bytes for identical attachments. If each importer chooses a random data key, two offline devices can select the same logical object ID but produce conflicting ciphertext. The protocol therefore needs vault-keyed, domain-separated derivation of the per-content encryption key and stream nonce from the plaintext digest. This deliberately reveals equality inside one vault while hiding cross-vault equality and resisting offline dictionary tests by a Drive-only observer. It requires focused cryptographic review.

Garbage collection must be conservative because offline devices can reintroduce old references:

- Mark reachability from every valid device head, retained snapshot, history checkpoint, trash entry within retention, and pending local upload.
- Write a GC mark or tombstone first. Do not delete during the same scan.
- Delete only after a long grace period and after every non-retired known device has published a head causally beyond the mark.
- Require explicit device retirement. A device that has been offline indefinitely cannot be distinguished from an abandoned device.
- Keep "optimize remote storage" user-visible and report reclaimed candidates before irreversible deletion.

Until these rules are proven by the deterministic simulator, leaving orphaned ciphertext costs storage but protects data. That is the correct failure direction.

### Quota and polling budget

Google changed Drive quota accounting on 2026-05-01. The current [usage limits page](https://developers.google.com/workspace/drive/api/guides/limits), checked 2026-09-08, lists:

| Limit | Current documented value |
| --- | --- |
| Per minute per project | 1,000,000 quota units |
| Per minute per user per project | 325,000 quota units |
| Per day per project before the announced billing threshold | 400,000,000 quota units |
| Project egress per 24 hours before charges | 1 TB |
| Read item action | 5 units |
| List item action | 100 units |
| Download item action | 200 units |
| Edit item action | 50 units |
| Other listed action | 5 units |
| User upload cap | 750 GB per day |
| Maximum uploaded file | 5 TB |

The page says standard use remains free and that billing details for exceeding thresholds will be announced later in 2026. These numbers and classifications are unusually new and must be rechecked in the project's Cloud console.

If `changes.list` is charged as a list action, one poll every 30 seconds costs about 200 units per device per minute. Ten simultaneously active devices for one account cost about 2,000 units per minute, far under the current per-user limit. That classification is an inference, not stated for `changes.list` on the limits page. Measure actual quota consumption.

Use foreground polling around 15 to 30 seconds during active editing, immediate sync on app foreground and connectivity restoration, progressively slower polling while idle, no polling while offline, and platform background tasks only when scheduled. Coalesce local changes into bounded immutable chunks. Apply jittered, truncated exponential backoff for 403 rate limits, 429, and retryable 5xx responses, as required by Google's [Drive error guide](https://developers.google.com/workspace/drive/api/guides/handle-errors).

## 3. CRDT evaluation

### Comparison

| Criterion | Yjs | Loro | Automerge |
| --- | --- | --- | --- |
| Core runtime | JavaScript with `Uint8Array` binary updates | Rust core distributed to JS as WebAssembly; separate native React Native binding exists | Rust core compiled to WebAssembly for JavaScript |
| Hermes risk | Lowest of the three because core does not require WASM | High with `loro-crdt` JS build; potentially avoided by young `loro-react-native` binding | High. Official docs require WASM initialization and Hermes still lacks documented `global.WebAssembly` |
| Rich-text structure | `Y.Text` has marks; `Y.XmlFragment`, `Y.XmlElement`, and `Y.XmlText` hold structured rich text | `LoroText` holds marks and Loro offers tree/container types, time travel, and version vectors/frontiers | Text has marks and block markers directly |
| ProseMirror binding | Stable `y-prosemirror` v1 exists; v2 rewrite is prerelease | `loro-prosemirror` supports sync and collaborative undo | Official binding describes itself as beta and requires a constrained schema mapping |
| Persistence | Commutative, associative, idempotent incremental updates; state vectors and compact binary state | Checksummed updates, full snapshots, and shallow snapshots | Immutable changes and heads, snapshots, storage compaction designed without backend transactions |
| History | Snapshot/version examples exist, but retaining restorable deleted content requires disabling GC | Strong built-in checkout/time-travel model with optional timestamps | History follows immutable change graph and heads |
| Safe aggressive compaction with long-offline peers | Needs careful application policy; merging updates alone does not GC deleted content | Shallow snapshot explicitly cannot accept peers before or concurrent with its start frontier | Storage compaction combines known changes into snapshots while retaining head-addressed safety |
| Ecosystem maturity for Jot | Best current fit | Promising, but React Native bridge is early | Good core project, weak current Expo/Hermes and ProseMirror fit |

### Yjs evidence and recommendation

Yjs [document updates](https://docs.yjs.dev/api/document-updates) are commutative, associative, and idempotent. State vectors can encode only missing operations. `mergeUpdates` removes duplicates without loading a full document, but the docs explicitly say it does not garbage-collect deleted content. A full `Y.Doc` must be loaded for size reduction.

Rich text is not an opaque serialized blob. [`Y.Text`](https://docs.yjs.dev/api/shared-types/y.text) supports formatting attributes over ranges. [`Y.XmlFragment`](https://docs.yjs.dev/api/shared-types/y.xmlfragment), XML elements, and XML text provide a structured tree suitable for ProseMirror. The [ProseMirror integration](https://docs.yjs.dev/ecosystem/editor-bindings/prosemirror) maintains schema conformance and supplies collaborative undo and snapshot examples. The [binding repository](https://github.com/yjs/y-prosemirror) warns that the next-generation `@y/prosemirror` line is still a rewrite, so Jot should pin the stable Yjs v13 and `y-prosemirror` v1 combination until the new line is stable.

Yjs is recommended for v1 because it avoids the WASM-on-Hermes problem. This is still an inference from its JavaScript implementation, not an official React Native support guarantee. Phase 0.5 must prove it in an Expo release build under Hermes, including random IDs, binary update storage, thousands of edit operations, a 5,000-word native editor document, process restart, and memory reclamation.

Only load CRDT state for open notes, sync work, and a small hot cache. Ten thousand simultaneous CRDT document objects are unnecessary. SQLite holds note summaries, FTS rows, state vectors, update inventory, and durable outbox records.

### Loro

Loro has the most attractive explicit history and compaction APIs. Its [persistence guide](https://loro.dev/docs/tutorial/persistence) recommends frequent updates plus periodic snapshots and says snapshot and update headers carry checksums. Its [encoding guide](https://www.loro.dev/docs/tutorial/encoding) says the 1.0 data format is stable. [Time travel](https://www.loro.dev/docs/tutorial/time_travel) can check out causal frontiers and optionally record timestamps.

The tradeoff is runtime maturity. The normal [JavaScript getting-started path](https://loro.dev/docs/tutorial/get_started) is WebAssembly and even desktop Vite needs WASM and top-level-await plugins. The official-organization [loro-react-native repository](https://github.com/loro-dev/loro-react-native) uses UniFFI and has Swift, Kotlin/Android, C++, and Rust sources, but on the check date it had only 51 commits, 22 stars, and no displayed GitHub releases. The published native binding also lagged the core package version observed during research. Those are not quality judgments, but they are poor risk signals for the data-loss-critical center of v1.

Run Loro as the challenger in Phase 0.5. It wins only if the native binding passes the same crash, convergence, schema round-trip, upgrade, and editor-latency tests and the team is willing to maintain or fork the binding. Its [ProseMirror binding](https://github.com/loro-dev/loro-prosemirror) is useful but smaller and younger than Yjs's.

Loro shallow snapshots are not transparent compaction. The [shallow snapshot documentation](https://www.loro.dev/docs/concepts/shallow_snapshots) says peers can sync only if their versions are after the shallow start point and advises coordinating before trimming. With devices that can remain offline for years, Jot needs either a known causal horizon across every active device or a versioned epoch reset that makes old clients refuse writes and rebootstrap.

### Automerge

Automerge has direct [rich-text marks and block markers](https://automerge.org/docs/reference/documents/rich-text/) and an excellent [immutable storage and compaction model](https://automerge.org/docs/reference/under-the-hood/storage). Those ideas fit Drive well.

The blocker is the actual runtime and editor integration. Automerge's [library initialization guide](https://automerge.org/docs/reference/library-initialization/) says its JavaScript implementation is Rust compiled to WebAssembly. It documents a React Native Metro exports setting and manual base64 WASM initialization, but that does not make a WASM engine appear in Hermes. The Hermes project's still-open [WASM support issue](https://github.com/facebook/hermes/issues/429) says there is no `global.WebAssembly`. Automerge would need a proved native binding or another runtime, not a bundler tweak. Its [ProseMirror binding](https://github.com/automerge/automerge-prosemirror) also labels itself beta.

Reject Automerge for v1 unless the Phase 0.5 experiment unexpectedly proves a boring, supported native path.

### Bundle-size observations

Registry metadata observed on 2026-09-08 reported roughly 2.3 MB unpacked for `yjs` 13.6.32, 19.8 MB for `loro-crdt` 1.16.0, and 46.5 MB for `@automerge/automerge` 3.4.1. These are not application bundle sizes. Loro and Automerge packages contain multiple target artifacts, source, and base64 or binary WASM variants, so unpacked package size overstates what a production bundler may ship. Measure release APK, IPA, and desktop bundles in the spike. Package versions and registry sizes are date-sensitive: [Yjs](https://www.npmjs.com/package/yjs), [Loro](https://www.npmjs.com/package/loro-crdt), [Automerge](https://www.npmjs.com/package/@automerge/automerge).

### Growth, compaction, and history

All three CRDTs retain causality beyond the visible text, so years of editing can make stored state larger than the current document. The rules should be:

- Persist each committed local editor transaction durably as an append-only update before acknowledging autosave.
- Periodically load the note, verify the full update set, and emit a compact snapshot or state update.
- Never delete old remote chunks in the same operation that publishes a snapshot. Publish snapshot, publish a head that references it, observe it from another simulated client, then let conservative GC remove unreachable chunks later.
- Do not remove causal information that an older active client needs. If a compaction changes compatibility, increment a format epoch. Older clients must refuse writes and rebootstrap.
- Keep product version checkpoints separately from raw CRDT updates. Suggested checkpoints are explicit user restore points plus periodic coalesced snapshots before risky transforms, with retention limits visible in the product.

With Yjs, `mergeUpdates` is not sufficient compaction because it retains deleted content. `Y.Doc.gc` is enabled by default; [Y.Doc documentation](https://docs.yjs.dev/api/y.doc) says disabling it is necessary to restore old content. Therefore indefinite version history and maximum compaction conflict. Jot must retain selected checkpoints and accept their storage cost, rather than promising every keystroke forever.

## 4. Cryptography

### KDF

Use Argon2id version 1.3. [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106.html) gives 64 MiB, three passes, four lanes, a 128-bit salt, and a 256-bit output as its second recommended, memory-constrained profile. Its first profile uses 2 GiB and is not appropriate for a cross-platform notes app.

Proposed portable baseline:

| Parameter | Value |
| --- | --- |
| Algorithm | Argon2id v1.3 |
| Memory | 64 MiB |
| Passes | 3 |
| Lanes | 4 |
| Salt | 16 random bytes per envelope |
| Output | 32 bytes |

Run it off the UI thread and benchmark unlock on the lowest supported Android hardware. The envelope records algorithm, version, memory, passes, lanes, and salt. Parameters cannot silently vary during unlock.

If 64 MiB allocation fails, offer an explicit compatibility profile, likely 32 MiB with more passes and a clear security warning. This is a product proposal, not an RFC-recommended profile. It is weaker because more CPU does not fully replace memory hardness. Any compatibility wrapper stored with the vault reduces the vault to the strength of its weakest passphrase wrapper. A better option is to set minimum device requirements if tests show 64 MiB is unreliable.

Do not tune each device to a stronger, incompatible envelope unless the format supports multiple wrappers for the same master key. Even then, an attacker can attack the weakest wrapper present.

### Cipher

Use XChaCha20-Poly1305 with a 32-byte key, 24-byte random nonce per encrypted object, and a 16-byte authentication tag. Libsodium's [XChaCha20-Poly1305 documentation](https://doc.libsodium.org/doc/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction) says random nonces are safe with its extended nonce and recommends it where interoperability is not a concern. The RustCrypto [chacha20poly1305 crate](https://docs.rs/chacha20poly1305/latest/chacha20poly1305/) provides XChaCha20-Poly1305 and reports an NCC Group audit with no significant findings.

Reject AES-256-GCM for the vault format. AES-GCM is widely standardized and fast with hardware support, but a repeated 96-bit nonce under one key is catastrophic. XChaCha's 192-bit nonce makes independently generated random nonces an ordinary and robust file-store strategy across devices. The cost is that XChaCha is not the NIST AES-GCM default and some platform frameworks do not expose it directly, which is why Jot needs its own native crypto core.

### One implementation on all platforms

Build a small, native Rust cryptography core using the RustCrypto [Argon2 crate](https://github.com/RustCrypto/password-hashes) and `chacha20poly1305`, plus audited random-number and zeroization crates. Tauri calls it inside Rust. iOS links it as a native library called only by the Swift Expo module. Android calls it through a narrow JNI or UniFFI boundary from the Kotlin Expo module. TypeScript receives opaque results and errors, never raw long-lived master keys.

This is preferable to three wrappers around three crypto stacks because canonical byte encoding, authenticated headers, nonce rules, and migration behavior are identical on every platform. It is not free. Cross-compilation, symbols, release reproducibility, and secure memory behavior must be tested in Phase 0 or early Phase 3.

The rejected alternative is libsodium on every target. Libsodium directly provides Argon2id and XChaCha and has excellent [password hashing](https://doc.libsodium.org/password_hashing/default_phf) and AEAD documentation. Its iOS, Android, and Rust wrapper situation would still introduce multiple wrapper projects or C FFI paths. It remains the fallback if the shared RustCrypto mobile artifact cannot be made reliable.

### Envelope scheme

- Generate a random 256-bit vault master key.
- Derive a 256-bit key-encryption key from the passphrase using the recorded Argon2id profile.
- Wrap the vault master key with XChaCha20-Poly1305. Authenticate the vault format version, vault ID, KDF parameters, envelope purpose, and creation epoch as associated data.
- Changing the passphrase creates a new salt and wrapper. It does not re-encrypt note or attachment content.
- Derive domain-separated subkeys from the vault key for document encryption, attachment encryption, opaque remote naming, and metadata authentication.
- Encrypt note contents, titles, tags, folder names and relationships, CRDT bytes, attachment bytes and metadata, search/index shards, and meaningful sync metadata in the Drive copy.
- Keep only the minimum bootstrap and routing fields outside encryption: file protocol version, opaque vault/object/device IDs, object kind, ciphertext length, and encryption suite/KDF parameters.

Google still sees the visible Jot folder, account identity, number of files, approximate note and attachment count, exact ciphertext sizes unless padded, file creation and modification times, access patterns, device activity timing, and deletion timing. Random opaque filenames prevent semantic leakage, not traffic analysis. State this in setup and security help.

### Per-note lock semantics

There is a product decision hidden inside "per-note lock."

If each note has a random content key wrapped by the vault key, the Drive ciphertext is secure from Google and the note can be hidden behind biometric or passphrase UI. However, code holding the unlocked vault key can decrypt every locked note. That is access control, not cryptographic isolation inside an unlocked vault.

True per-note cryptographic isolation requires the note key to be wrapped only by a note passphrase-derived key and by explicitly enrolled device biometric or OS-keystore keys. A new device then needs the note passphrase or a deliberate transfer/enrollment flow. Wrapping the note key under the vault recovery key makes recovery possible but weakens strict isolation.

Recommendation for v1: define per-note lock as local access control plus at-rest key gating, not protection from a compromised process after vault unlock. Use a random note data key, a synced vault-key wrapper for recoverability, and a local biometric-gated wrapper for convenience. Make the threat model explicit. If the product requires strict isolation, it needs its own recovery and multi-device UX and should be separately scoped.

### Recovery

Generate an independent random 256-bit recovery key and use it to create a second wrapper around the same vault master key. Encode it for humans with strong error detection, such as numbered grouped characters or a fixed word list with checksum. Do not derive it from the passphrase.

Setup is incomplete until the user saves and verifies the recovery code. Show, in plain language, before encryption is enabled:

> Jot has no account and no server. Jot cannot reset this passphrase. If you lose both the passphrase and recovery code, the encrypted Drive data is permanently unreadable.

Require confirmation of randomly selected groups or words. Offer print, save to a user-selected file, and password-manager copy. Never upload a plaintext recovery code into the Jot Drive folder. Allow regeneration only while the vault is unlocked, which replaces the recovery wrapper without re-encrypting the vault.

## 5. SQLite persistence and search

### Mobile

Expo's current [`expo-sqlite` documentation](https://docs.expo.dev/versions/latest/sdk/sqlite/) says its config plugin enables FTS3, FTS4, and FTS5 by default. SQLCipher is optional and disabled by default. These compile-time settings require a rebuilt native app, which fits the dev-client requirement.

Choose `expo-sqlite` first. It is first-party to Expo and FTS5 is enough for 10,000 notes if indexes and queries are designed correctly. OP-SQLite's JSI path may benchmark faster, but speed has not yet been shown to be a product constraint and it adds another native and migration dependency.

At startup, assert `sqlite_compileoption_used('ENABLE_FTS5')` and run a tiny FTS fixture. Treat failure as a diagnosable build error. Use WAL mode, explicit transactions, foreign keys, durable outbox records, and regular integrity checks. Exact durability pragmas need crash testing on real devices rather than claims based only on SQLite defaults.

### Desktop

Tauri's official [SQL plugin](https://v2.tauri.app/plugin/sql/) uses `sqlx`, supports SQLite, and executes its migration set in a transaction. It exposes SQL operations to the frontend through permissions.

For Jot, prefer a Rust-owned data access layer using [`rusqlite` with its `bundled` feature](https://github.com/rusqlite/rusqlite). The bundled feature compiles and links a controlled SQLite version instead of depending on an old or differently configured system library. SQLite's [FTS5 documentation](https://www.sqlite.org/fts5.html) says FTS5 is present in the amalgamation but controlled by build configuration, so explicitly compile with FTS5 and assert it at runtime.

The reasons to reject the generic Tauri SQL plugin as the main boundary are architectural, not because it is defective:

- Persistence invariants and transactions belong in trusted Rust commands, not arbitrary WebView SQL.
- A bundled SQLite version makes FTS behavior and migration testing consistent across macOS and Windows.
- The API can expose domain operations and typed errors rather than a general database capability.

### Shared layer and search shape

One concrete data-access implementation cannot serve both runtimes cleanly. Expo talks to native SQLite from TypeScript, while Tauri should own SQLite in Rust. Share:

- Domain repository interfaces and transaction semantics.
- Versioned SQL migrations where dialect-compatible.
- Canonical normalization rules.
- FTS schema and tokenizer expectations.
- Query fixtures, ranking assertions, highlighted-match fixtures, migration corpora, and crash-recovery scenarios.

Provide mobile and desktop adapters behind the shared repository contract.

FTS5 should index normalized plaintext title, body text extracted from the canonical document, and tag names. Use FTS5 ranking and highlight/snippet support, but define stable weighting in application tests. Keep attachment bytes outside SQLite in content-addressed local files; store their metadata and verified hashes in SQLite. Do not index attachment binary contents for v1 unless product scope explicitly adds extraction.

Whole-vault encryption as currently worded protects the Drive copy, not necessarily the local SQLite database. Without SQLCipher or application-level field encryption, local titles, text, tags, and FTS terms remain plaintext under OS file protection. This is a significant security distinction. App lock and biometrics do not, by themselves, encrypt the local database against a filesystem-level attacker. The product owner must decide whether v1 promises encrypted local storage.

## 6. Open uncertainties that need spikes or decisions

1. Android background sync: prove whether `AuthorizationClient` can supply a fresh Drive access token during permitted background work without user interaction after process death and reboot.
2. Google OAuth configuration: create production-like iOS, Android, and Desktop client IDs early. Testing mode's seven-day token expiry otherwise invalidates longevity tests.
3. Drive conditional update semantics: no current Drive v3 primary source found here guarantees `If-Match` content CAS. Keep the protocol correct without it.
4. CRDT choice: default to Yjs v13, but require the same Expo/Hermes release-mode and native-editor bridge benchmark against Loro's native binding before locking the file format.
5. Yjs GC with very old peers: property-test convergence across compacted snapshots and updates held by a device offline before compaction. Do not delete pre-snapshot remote objects until proven safe.
6. Per-note lock: decide whether it is a user-interface gate within an unlocked vault or true cryptographic isolation with separate recovery consequences.
7. Local encryption: decide whether the security promise covers only the Drive copy or also local SQLite and FTS. The latter materially changes persistence, search, and key-management work.
8. KDF floor: test the 64 MiB RFC profile on the lowest supported Android devices. If it fails, decide between a weaker compatibility profile and a higher minimum device requirement.
9. Desktop SQLite: pin the exact `rusqlite`, SQLite, and FTS build configuration and verify byte-compatible migrations across macOS and Windows.
10. Quotas and pricing: the standardized quota-unit model and announced billing threshold changed in 2026. Recheck before beta and before public launch.
11. Cross-client Drive identity: verify with real iOS, Android, and Desktop OAuth client IDs in one Cloud project that `drive.file` authorization and private `appProperties` are mutually visible across all three client types. Google describes visibility as private to the requesting app but does not define this cross-client boundary clearly enough for the file protocol to assume it without a test.

## 7. Metadata-only Drive invalidation relay

Checked 2026-09-08. Google Drive notification rules, Convex capabilities, service limits, and retention policies are date-sensitive. Recheck them before Phase 2 and before launch.

### Concrete recommendation

Use Convex only as an optional invalidation relay. Every client authenticates with Google and transfers vault files directly between that client and Drive. A client creates a Drive `changes.watch` channel whose callback is the relay. Google sends an empty webhook when something changes. The relay authenticates the opaque channel, increments an opaque vault generation, and wakes registered devices. Each device then calls `changes.list` directly with its own local page token and retrieves relevant files directly from Drive.

Do not call this service a Drive proxy or put it in the sync data path. It must not hold a Google access token, refresh token, server authorization code, Drive page token, folder ID, file ID, note identifier, encryption key, CRDT update, attachment, or content metadata. It must not expose a generic fetch or upload endpoint. Its outage must reduce freshness only. Direct polling on launch, reconnect, and periodic permitted background work remains the correctness path.

This design preserves the meaningful zero-access property: neither Jot's application code on the relay nor a compromise of its database gives an attacker a capability to read Drive files. It does not preserve the literal statement that an internet server can never receive arbitrary note bytes. Any caller can send bytes to a public HTTPS endpoint, and the hosting provider terminates TLS before application code can reject them. The supportable promise is narrower and testable: "Jot clients never send note content or Drive file bytes to the relay; Drive sends empty notification bodies; the relay has no Drive credential or content-ingestion API."

### OAuth and token custody

The recommended custody model remains device-owned:

| Target | Drive credential custody | Relay involvement |
| --- | --- | --- |
| iOS | Google Sign-In restores the user and refreshes tokens on-device. | The app uses its current access token to create and renew its own watch. No Google token reaches Convex. |
| Android | `AuthorizationClient.authorize()` obtains a short-lived access token again without interaction while the grant remains. Google's current guide says backend offline access uses a server authorization code and refresh token, and strongly discourages storing refresh tokens on-device. | The app creates or renews a watch while it can obtain an access token. The relay never receives the token or server authorization code. |
| macOS and Windows | The Tauri Rust process runs the installed-app PKCE loopback flow and stores its refresh token in Keychain or Windows Credential Manager. | The Rust process creates and renews its own watch. The WebView and relay never receive the refresh token. |

Google's [Android authorization guide](https://developer.android.com/identity/authorization) explicitly supports a backend pattern: request offline access, send the returned server authorization code to the backend, exchange it there, and keep the refresh token there. Convex could technically store such a token and use an action to call Google. Reject that pattern for Jot. A `drive.file` bearer token is a capability to read Jot-created Drive files, not a watch-only capability. At-rest database encryption does not prevent Convex functions, a malicious deployment, an administrator with sufficient access, or a compromised runtime from using it.

Encrypting a refresh token before storing it on the relay does not solve renewal. If the relay has the decryption key, the same capability risk remains. If only devices have the key, the relay cannot renew a watch while all devices are offline. An OAuth code broker also receives a credential or authorization code that can become that capability. It fails the same threat goal.

There is a real requirement conflict here. Uninterrupted server-managed watch renewal while every client is offline requires the server to have Google authorization. A relay that cannot access Drive cannot provide that. Choose zero access and accept possible notification gaps. The gaps do not lose changes because devices retain their Drive change cursors and catch up with `changes.list`.

### Drive notification protocol and lifecycle

Google's current [Drive push notification guide](https://developers.google.com/workspace/drive/api/guides/push) and [`changes.watch` reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/watch) establish these properties:

- A device calls `POST /drive/v3/changes/watch` with its current Google bearer token and a page token. The method supports `drive.file`.
- The channel ID is caller-selected, must be unique within the Google Cloud project, and is at most 64 characters. The callback must be HTTPS with a valid certificate.
- A caller-selected channel token, at most 256 characters, is echoed in `X-Goog-Channel-Token`. Google recommends it for routing and spoofing checks and warns not to put OAuth tokens or other sensitive data in it.
- `changes` channels last at most one week. The default is one hour when expiration is omitted. Renewal is not automatic. The creator must make a new watch with a new channel ID, and old and new channels can overlap.
- A `sync` notification can arrive before the watch call returns. Subsequent message numbers increase but are not sequential.
- Both file and changes notifications always have an empty body and carry no resource metadata, content, or folder path. They are hints that the authorized client must follow with a Drive API call.
- Google documents successful responses as `200`, `201`, `202`, `204`, or `102`. If the Google client library is in use, `500`, `502`, `503`, and `504` can be retried with exponential backoff. Handlers must be idempotent.
- Google documents `X-Goog-Channel-Token` as the source-verification mechanism. The reviewed documentation does not specify a Google-signed webhook body or signature header. `User-Agent: APIs-Google` is not authentication.
- [`channels.stop`](https://developers.google.com/workspace/drive/api/reference/rest/v3/channels/stop) requires channel ID, resource ID, and OAuth. For a user-created channel, only the same user through the same OAuth client ID can stop it. A desktop client therefore cannot stop a channel created under the iOS client ID. Let unreachable channels expire after at most one week.

Recommended lifecycle:

1. The device generates a random channel ID and independent high-entropy channel token. It sends the relay the channel ID, a hash of the token, the opaque relay vault ID, expected expiration, and its authenticated relay installation ID before calling Drive. Pre-registration handles the early `sync` race.
2. The device creates `changes.watch` directly. It then stores the returned resource ID locally for a later stop request and updates the relay with the actual expiration and, if wanted as an extra opaque check, the resource ID.
3. The webhook accepts only `POST`, requires the known channel ID, hashes and compares the channel token, bounds every header, and rejects a nonempty or streamed body without reading it. It treats unknown future resource states as ignorable. A durable mutation increments the vault invalidation generation and schedules generic fan-out before the handler returns success.
4. Active desktop and mobile clients subscribe to the generation. Suspended mobile clients may receive a generic data-only push such as `syncAvailable: true`. No note title, count, ID, timestamp, or error detail belongs in the push payload.
5. A device that observes a new generation calls `changes.list` with its locally stored cursor. Duplicate or skipped invalidation numbers do not matter.
6. Each device renews its own channel before expiration, preferably with at least a 24-hour margin and whenever the app foregrounds. Multiple devices and overlap can produce duplicate notifications, so all operations remain idempotent.
7. If every device is inactive for more than a week, the channel lapses. The next device launch runs `changes.list` first, catches up, and creates a new watch. The UI may say live wakeups were unavailable, but must not report a sync conflict or data loss.

One channel per device is simpler than electing a permanent owner. It also respects Google's same-user, same-OAuth-client stop rule. It costs duplicate opaque invalidations when several devices watch the same account, which is acceptable at v1 scale. If quota measurements later justify leader election, the lease must remain advisory because an offline leader cannot renew.

### Minimum relay state

The backend needs state to fan out to a changing set of installations. A genuinely stateless relay cannot do this unless it embeds the entire destination set in Google's channel token. That token is limited to 256 characters, would leak routing data to Google, and cannot handle device rotation cleanly.

Store only:

| Record | Permitted fields |
| --- | --- |
| Vault route | Random `relayVaultId`, a verifier for a relay-only enrollment capability, invalidation generation, last invalidation time, retention deadline |
| Watch channel | Channel ID, channel-token hash, expiration, last accepted message number, owning installation ID, and optional opaque resource ID |
| Installation | Random installation ID, relay authentication verifier or public key, platform, push token if enabled, last-seen time, disabled time |
| Push delivery | Opaque delivery ID, attempt count, next retry time, Expo receipt ID, terminal status, short deletion deadline |
| Abuse control | Opaque bucket key, counter or token balance, window timestamp |

Do not store Google account ID or email, Drive folder or file IDs, Drive change page tokens, note or attachment IDs, note count, filenames, CRDT state, encryption material, recovery material, or user-visible notification text. Use a random relay-only enrollment capability shared through the Drive vault bootstrap, not the vault encryption key. The server should store only its verifier. Rotation and installation revocation need a small, versioned protocol.

The relay still learns metadata. It can observe IP addresses at ingress, platform, push token, installation activity, approximate vault activity times, number of registered installations, and watch expirations. Convex and any push provider are processors of that metadata. A generic invalidation reveals activity, even when it reveals no note contents or exact note count. Product privacy copy must say so.

### Convex suitability

Convex is suitable for this narrow relay, with explicit exclusions:

| Capability | Finding |
| --- | --- |
| Webhook endpoint | Suitable. [HTTP actions](https://docs.convex.dev/functions/http-actions) expose public HTTPS endpoints and are intended for webhooks. They receive a raw `Request`; argument validation is entirely application-owned. Request and response bodies can be up to 20 MB, so the handler and provider ingress can technically receive unwanted bytes even though Jot rejects them. |
| Metadata store and fan-out | Suitable. Mutations are transactional, and [reactive queries](https://docs.convex.dev/realtime) push changed results over WebSockets to connected clients. Store only an opaque generation, not a Drive change. |
| Google token storage | Technically possible, architecturally rejected. Convex [encrypts data at rest](https://www.convex.dev/security), but its own [encryption explanation](https://www.convex.dev/can-do/encryption) says functions access decrypted data by default. A bearer refresh token would make the service capable of reading Jot Drive files. |
| Watch renewal | Suitable only if a token is stored, which Jot must not do. [Scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions) and [cron jobs](https://docs.convex.dev/scheduling/cron-jobs) can clean expired registrations, schedule push receipt checks, or remind connected clients. They cannot create a Drive watch without user authorization. |
| Reliable jobs | Adequate with a ledger. Scheduling from a mutation is atomic. Scheduled mutations execute exactly once after internal retries, while actions with external side effects execute at most once and are not automatically retried. Push delivery therefore needs explicit retry state and idempotency. Completed scheduled-function records remain available for seven days, so scheduled arguments must contain only opaque IDs. |
| Rate limiting | Suitable for application abuse controls. Convex's official [rate limiter component](https://github.com/get-convex/rate-limiter) provides transactional token-bucket and fixed-window limits, but its documentation explicitly says application-layer limiting is not the first defense against a sophisticated DDoS attack. Confirm edge abuse protection and spending caps separately. |
| Mobile push | Suitable through a small action calling the [Expo Push Service](https://docs.expo.dev/push-notifications/sending-notifications/). Expo routes through FCM and APNs, has no SLA, requires retries for `429` and `5xx`, and requires receipt checks. Its documented project limit is 600 notifications per second and payload limit is about 4 KiB. Jot needs only a tiny generic collapsed invalidation. |

Do not adopt the current [`@convex-dev/expo-push-notifications`](https://github.com/get-convex/expo-push-notifications) component in v1 without a specific review. Its repository package is currently `0.4.1-beta.3`, and its documented design inserts each notification into a table and retains delivery state. That is useful generally but expands stored metadata and supply-chain surface for a one-bit signal. A small direct Expo Push API action with a short-lived receipt ledger is easier to audit. Enable Expo's enhanced push security. If minimizing processors matters more than convenience, call APNs and FCM directly, at higher operational cost.

### Logging, retention, and administrative access

Convex does not provide a zero-knowledge boundary for relay metadata:

- Convex's [security page](https://www.convex.dev/security), last updated 2024-09-24, says customer data is encrypted at rest with AES-256, protected in transit, and accessible to limited necessary personnel under audited controls. This protects stored metadata but does not make it unreadable to the service.
- Convex automatically logs successful executions and errors. Its [debugging documentation](https://docs.convex.dev/functions/debugging) says the platform retains only a limited number of logs and can erase them during maintenance, but gives no exact ordinary log retention duration. [Log streams](https://docs.convex.dev/production/integrations/log-streams) can export console and execution events to third parties. Do not enable them for the relay without a privacy review. Never log webhook headers, channel tokens, push tokens, registration arguments, or exception text derived from a request.
- [Role permissions](https://docs.convex.dev/team-management/role-actions) separately grant access to deployment data, logs, environment variables, internal functions, and downloadable backups. Use a dedicated production project, the smallest possible team, MFA, and custom least-privilege roles.
- Manual backups last seven days. Periodic daily backups last seven days and weekly backups last fourteen days, according to [Convex backup documentation](https://docs.convex.dev/database/backup-restore). Backups include every database document. Deleted relay identifiers can therefore persist until backup expiry.
- Convex's [DPA](https://www.convex.dev/legal/dpa) says customer personal data is deleted at agreement expiry or termination except backup or archival copies, which are deleted according to Convex's retention schedule. The public DPA reviewed here does not state that schedule. Its [subprocessor list](https://www.convex.dev/legal/subprocessors) includes infrastructure, database, observability, and support vendors. Get written answers about standard log retention, internal backup retention, region, deletion latency, and support access before making a launch privacy claim.

For the relay, use no Convex file storage, search, analytics export, error-reporting integration, or application console logs. Give metadata rows explicit expiry and deletion jobs. Treat push tokens as personal data. Keep the Expo service access token in an environment variable, but remember that Convex roles can permit viewing environment variables. Never place per-user Google credentials there or in database rows.

### Enforcing the no-content boundary

The property should be enforced by topology, interfaces, and tests, not a comment:

- Put the relay in a separate package and deployment with no Drive SDK, Google OAuth client secret, Drive hostname helper, general proxy route, file storage, text-search table, or note-domain import.
- Make client storage-provider code the only code allowed to call Drive content endpoints. Add dependency-boundary checks and a source audit in CI.
- Give registration APIs closed schemas with exact field allowlists and small byte limits. Convex HTTP actions do not provide argument validation automatically, so validate every header and registration request before invoking a mutation.
- For the Google callback, require the documented empty body, reject `Transfer-Encoding` and any declared nonzero `Content-Length`, and never call `request.text()`, `json()`, `blob()`, or `arrayBuffer()`. Bound header lengths before hashing. Return fixed error messages that do not echo input. Do not reject an otherwise valid HTTP/2 request solely because it omits `Content-Length`.
- Generate at least 256 bits of entropy for the channel token. Store its hash, compare in constant time where the runtime permits, and keep the raw token only in the device's local channel record and Google's header. Do not rely on the `APIs-Google` user agent or IP allowlists.
- Test that every public endpoint rejects unknown keys, oversized fields, and nonempty bodies; snapshot the deployed database schema; inspect exports for forbidden fields; scan logs; and run a canary request containing a unique marker that must never appear in tables or application logs.
- Make every invalidation operation idempotent. Duplicate webhooks, overlapping watches, Expo retries, and repeated device registration must not grow unbounded rows or trigger unbounded pushes.
- Document the one unavoidable limit: the cloud host still receives transport bytes and network metadata before user code rejects a malicious request. No application architecture can prove otherwise for a public endpoint.

The reviewed Convex documentation does not describe per-function outbound-domain allowlists. Do not claim the deployment is technically unable to contact Drive. The stronger control is that it never possesses a Google token. A future malicious relay deployment could still ask a compromised client to upload data, so clients must pin the relay protocol: only fixed opaque invalidations are accepted, and no relay response can instruct a client to upload content anywhere except the configured Google Drive API origin.

### Smaller edge-worker alternative

A small Cloudflare Worker is a reasonable alternative ingress, but it is not stateless once it must fan out. A plain Worker can reject bodies and validate headers. A per-vault [Durable Object](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/) adds private, transactional, strongly consistent state and WebSocket coordination. [Queues](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) provide at-least-once delivery for push jobs, so consumers still need idempotency. [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) can clean expired routes, but cannot renew Drive watches without a token.

Cloudflare gives more direct control over the small protocol and avoids adopting Convex as an application backend. It also requires Jot to build authentication, schema validation, fan-out, retry, receipt cleanup, migration, admin tooling, and realtime client behavior. Workers accept request bodies much larger than this protocol needs, depending on plan, and newly created Workers have observability enabled by default with up to seven days of log retention, according to the current [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) pages. It does not remove the cloud processor or metadata-leakage issue.

Choose Convex for v1 if the team accepts it as a metadata processor because its transactional mutations and realtime subscriptions remove useful infrastructure work. Hide it behind a `SyncInvalidationRelay` client interface so a Worker, self-hosted service, or no-relay polling implementation can replace it without touching Drive sync logic. If the product promise evolves from "we never receive note content" to "we operate no persistent user metadata service," omit the relay entirely and accept polling latency.

### Threat and availability tradeoffs

| Design | Privacy and compromise impact | Availability behavior | Decision |
| --- | --- | --- | --- |
| Direct client polling only | No Jot-operated service sees activity or device metadata. Google still sees Drive traffic. | No immediate wakeup. Mobile background work is OS-limited. Correct on next poll. | Supported fallback and user opt-out. |
| Tokenless invalidation relay | Relay sees opaque device and activity metadata but has no credential or bytes that can read a vault. Push adds Expo, APNs, and FCM as metadata processors. | Relay or push outage delays discovery only. A one-week watch lapse is repaired from the local Drive cursor. | Recommended optional default, subject to privacy review. |
| Token-holding relay | A backend compromise can use `drive.file` credentials to read every Jot-created Drive object, including plaintext vaults and ciphertext vaults. | Can renew watches when all devices are offline and can orchestrate more background work. | Reject. It conflicts with the intended zero-access claim. |
| Drive-byte proxy | The proxy and host receive every byte even if they stream it without storage. Encryption may hide plaintext but does not mean the service never receives note data. | Adds a central dependency to every sync and increases blast radius. | Reject. Clients must transfer directly with Drive. |

Open uncertainties for the design document:

1. Google documents a channel token but no signed webhook mechanism. Confirm behavior with production OAuth clients and decide whether the token plus random channel ID meets the threat model.
2. Prove watch creation and renewal from release builds on all four targets. Android background access remains the largest uncertainty.
3. Decide whether relay wakeups are default-on, opt-in, or omitted from v1. This is a privacy-product decision, not only infrastructure.
4. Get contractual answers from Convex on log retention, internal backup deletion, subprocessors, data region, incident access, and deletion SLAs. The public sources do not answer all of them precisely.
5. Prove Expo silent or data-only notification behavior on supported iOS and Android versions. Expo explicitly provides no SLA, and OS delivery is not guaranteed.
6. Set explicit TTLs for installations, channel records, push receipts, rate-limit rows, and inactive vault routes. The public Convex documentation does not supply Jot-specific retention defaults.

## Source index

### Google identity and Expo

- [OAuth 2.0 for iOS and desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google OAuth 2.0 overview and refresh-token expiration](https://developers.google.com/identity/protocols/oauth2)
- [Android authorization and AuthorizationClient](https://developer.android.com/identity/authorization)
- [Google API access from iOS](https://developers.google.com/identity/sign-in/ios/api-access)
- [GIDGoogleUser reference](https://developers.google.com/identity/sign-in/ios/reference/Classes/GIDGoogleUser.html)
- [Expo AuthSession](https://docs.expo.dev/versions/latest/sdk/auth-session/)
- [Expo Google authentication](https://docs.expo.dev/guides/google-authentication/)
- [Tauri deep linking](https://v2.tauri.app/plugin/deep-linking/)
- [Tauri opener](https://v2.tauri.app/plugin/opener/)

### Google Drive

- [Drive scope selection](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Drive changes feed](https://developers.google.com/workspace/drive/api/guides/manage-changes)
- [Drive push notifications](https://developers.google.com/workspace/drive/api/guides/push)
- [Drive uploads and resumable uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Drive File resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
- [Drive file search](https://developers.google.com/workspace/drive/api/guides/search-files)
- [Drive usage limits](https://developers.google.com/workspace/drive/api/guides/limits)
- [Drive error handling](https://developers.google.com/workspace/drive/api/guides/handle-errors)
- [Drive changes.watch reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/watch)
- [Drive channels.stop reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/channels/stop)

### CRDTs

- [Yjs repository](https://github.com/yjs/yjs)
- [Yjs document updates](https://docs.yjs.dev/api/document-updates)
- [Yjs Y.Text](https://docs.yjs.dev/api/shared-types/y.text)
- [Yjs Y.XmlFragment](https://docs.yjs.dev/api/shared-types/y.xmlfragment)
- [Yjs Y.Doc and GC](https://docs.yjs.dev/api/y.doc)
- [Yjs ProseMirror integration](https://docs.yjs.dev/ecosystem/editor-bindings/prosemirror)
- [y-prosemirror repository](https://github.com/yjs/y-prosemirror)
- [Loro persistence](https://loro.dev/docs/tutorial/persistence)
- [Loro encoding and shallow snapshots](https://loro.dev/docs/tutorial/encoding)
- [Loro shallow-snapshot limits](https://www.loro.dev/docs/concepts/shallow_snapshots)
- [Loro time travel](https://www.loro.dev/docs/tutorial/time_travel)
- [Loro React Native binding](https://github.com/loro-dev/loro-react-native)
- [Loro ProseMirror binding](https://github.com/loro-dev/loro-prosemirror)
- [Automerge initialization and React Native notes](https://automerge.org/docs/reference/library-initialization/)
- [Automerge rich text](https://automerge.org/docs/reference/documents/rich-text/)
- [Automerge storage](https://automerge.org/docs/reference/under-the-hood/storage)
- [Automerge ProseMirror binding](https://github.com/automerge/automerge-prosemirror)
- [Hermes WASM support issue](https://github.com/facebook/hermes/issues/429)

### Cryptography and SQLite

- [RFC 9106: Argon2](https://www.rfc-editor.org/rfc/rfc9106.html)
- [Libsodium password hashing](https://doc.libsodium.org/password_hashing/default_phf)
- [Libsodium XChaCha20-Poly1305](https://doc.libsodium.org/doc/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction)
- [RustCrypto password hashes](https://github.com/RustCrypto/password-hashes)
- [RustCrypto XChaCha20-Poly1305](https://docs.rs/chacha20poly1305/latest/chacha20poly1305/)
- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [Tauri SQL plugin](https://v2.tauri.app/plugin/sql/)
- [Rusqlite](https://github.com/rusqlite/rusqlite)
- [SQLite FTS5](https://www.sqlite.org/fts5.html)

### Relay, Convex, and push

- [Convex HTTP actions](https://docs.convex.dev/functions/http-actions)
- [Convex realtime subscriptions](https://docs.convex.dev/realtime)
- [Convex scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions)
- [Convex cron jobs](https://docs.convex.dev/scheduling/cron-jobs)
- [Convex rate limiter component](https://github.com/get-convex/rate-limiter)
- [Convex Expo push component](https://github.com/get-convex/expo-push-notifications)
- [Convex platform security](https://www.convex.dev/security)
- [Convex encryption boundary](https://www.convex.dev/can-do/encryption)
- [Convex function logging](https://docs.convex.dev/functions/debugging)
- [Convex log streams](https://docs.convex.dev/production/integrations/log-streams)
- [Convex role actions](https://docs.convex.dev/team-management/role-actions)
- [Convex backups](https://docs.convex.dev/database/backup-restore)
- [Convex DPA](https://www.convex.dev/legal/dpa)
- [Convex subprocessors](https://www.convex.dev/legal/subprocessors)
- [Expo Push Service](https://docs.expo.dev/push-notifications/sending-notifications/)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)
- [Cloudflare Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
