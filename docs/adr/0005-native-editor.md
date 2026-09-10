# ADR 0005: Native editors on mobile

Status: accepted  
Date: 2026-09-08

## Decision

Phase 0.5 implements one Expo native module, `JotEditor`, twice: TextKit 2 `UITextView` on iOS and `EditText` plus `Spannable` on Android. The TypeScript `EditorHost` and linearized attributed model are the seam. Yjs stays behind `CrdtDocument` in `@jot/core`.

## Why

A WebView editor on mobile would recreate the keyboard, IME, and selection failures the product forbids. Desktop keeps ProseMirror because the WebView already owns that window's text input.

## Consequences

IME composition stays native and never enters the CRDT trace. A committed edit is journaled with `synchronous=FULL` before acknowledgement. Tables and math remain atomic blocks later; this spike proves paragraphs, headings, bold, italic, lists, checklists, code blocks, selection, undo groups, and 5,000-word scrolling.
