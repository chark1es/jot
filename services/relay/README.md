# Relay

Jot operates a content-blind change-wakeup relay. Official clients never send it note text, titles, CRDT bytes, encryption keys, Google account ids, file names, OAuth codes, or Drive tokens. This package is the Phase 0 interface and policy check, not a deployed Convex app.

## Forbidden data

Live tables may store only:

- `topics`: opaque topic id, enrollment-capability verifier, dirty epoch, created time, last activity, expiry policy
- `devices`: opaque device id, topic id, device-capability verifier, platform, encrypted notification endpoint, last delivery status, expiry
- `channels`: random channel id, topic id, channel-token hash, opaque Drive change-feed resource id, expiration, last notification time
- `rate_limits`: hashed abuse key, time bucket, count, expiry

No free-form user text. No arbitrary bytes. Field lengths and enumerations stay fixed. A relay export is not a vault export. There is nothing here you can turn back into a note.

`assertNoUserContent` rejects the forbidden keys, including nested ones. `bun run test:relay` is the check.

## Threat model

The relay is a public HTTPS host. That is a backend. Do not market this as "no backend."

The operator can see:

- client IP addresses
- notification timing
- opaque topic and device identifiers
- encrypted push endpoints
- Drive webhook metadata (channel ids, resource ids, expiry)
- rate-limit counters

The operator cannot see note bodies, titles, folder names, CRDT payloads, attachments, encryption keys, Google identity, or Drive credentials, as long as official clients keep that contract and this schema stays metadata-only. A malicious caller can still POST arbitrary bytes at the HTTP edge. Application code must reject them, and they must never land in tables or application logs.

Sync stays correct if this service is down or deleted. Clients write to the user's Google Drive and poll `changes.list` when wakeup is missing.

Phase 2 may put this schema on Convex. Phase 0 does not deploy it.
