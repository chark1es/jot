# ADR 0004: Canonical schema version 1

Status: accepted  
Date: 2026-09-08

## Decision

`packages/schema` owns node names, attributes, nesting, validation, normalization, migrations, and canonical JSON. Numeric attributes are integers. Canonical JSON is UTF-8, LF, lexicographically sorted keys, no insignificant whitespace. TypeScript, Swift, Kotlin, and Rust must match fixtures byte for byte.

## Why

Mobile and desktop editors cannot drift. Yjs is a merge representation, not permission to store arbitrary XML. A feature is incomplete until every platform loads, preserves, renders, edits, and exports the same schema value.

## Consequences

Generators emit Swift, Kotlin, and ProseMirror declarations from one source. Unknown node types are rejected. Illegal nesting is normalized through versioned rules. User text is never dropped silently.
