# Jolt

Jolt is a local-first personal notes product. This glossary fixes the language used by the schema, sync protocol, UI, and tests.

## Language

**Vault**:
One user's complete Jolt data set, including notes, organization, attachments, cryptographic configuration, device records, and sync metadata.
_Avoid_: Account, workspace

**Note**:
A rich-text document and its metadata, identified by an immutable note ID.
_Avoid_: File, page

**Document**:
The schema-valid rich-text value inside a note.
_Avoid_: Body, content blob

**Folder**:
A named organizational entity that may contain notes and other folders.
_Avoid_: Notebook, directory

**Tag**:
A named label that can belong to many notes.
_Avoid_: Label, category

**Attachment**:
A binary object referenced by a note, including images and general files.
_Avoid_: Asset, blob

**Device**:
One Jolt installation with its own stable ID and remote head namespace. Yjs generates document client IDs independently.
_Avoid_: Client, peer

**Remote object**:
An immutable, validated file in a storage provider namespace.
_Avoid_: Drive file, blob

**Head**:
A device-owned record that announces the immutable remote objects published by that device.
_Avoid_: Manifest, latest file

**Catalog**:
A compact snapshot of vault metadata and object references used to bootstrap a device without downloading every note and attachment.
_Avoid_: Manifest, index database

**Checkpoint**:
A compact CRDT state plus state vector that covers a known set of prior changes.
_Avoid_: Backup, version

**Version**:
A user-visible historical document snapshot that can be previewed or restored by creating a new edit.
_Avoid_: Checkpoint, revision

**Committed edit**:
An editor transaction that the local durability module has written to stable storage and acknowledged.
_Avoid_: Keystroke, autosave event

**User content**:
The information a person entrusts to Jolt, including note text, titles, folder and tag names, CRDT payloads, attachment bytes and descriptive metadata, imports, exports, and encryption keys.
_Avoid_: Notes data, payload

**Relay**:
The Jolt-operated system that receives opaque Drive change notifications and wakes subscribed devices. Official clients never send it user content or Google Drive credentials, it stores neither, and sync remains correct without it.
_Avoid_: Sync server, Drive proxy, backend

**Relay metadata**:
Opaque notification-topic identifiers, device notification endpoints, Drive channel identifiers, expiry times, delivery state, and rate-limit counters held by the relay. It can reveal device and usage timing even though it contains no user content.
_Avoid_: User content, note metadata

**Locked note**:
A note whose local content requires an explicit biometric or passphrase unlock before Jolt loads it.
_Avoid_: Encrypted vault
