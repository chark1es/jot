# ADR 0003: Content-blind relay

Status: accepted  
Date: 2026-09-08

## Decision

Jot operates a `ChangeWakeup` relay that stores opaque notification metadata only. Official clients never send it user content, encryption keys, Google identity, or Drive credentials. Sync remains correct if the relay is deleted.

## Why

Drive push channels require a public HTTPS webhook. Putting Drive tokens or file bodies on that host would make Jot a content proxy. A wakeup can only say that a topic may be dirty. Clients always verify through Drive `changes.list`.

## Consequences

The privacy claim is no longer "no backend." The relay sees IP addresses, opaque device endpoints, and notification timing. Convex is the Phase 2 candidate, not a Phase 0 deployment.
