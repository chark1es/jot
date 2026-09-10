# Editor lab manual checks

This is a device script. Do not treat bun CRDT bench numbers as Hermes or on-device results. `apps/editor-lab/benchmarks/results/latest.json` is bun-local.

Header fields used below: fixture id, short last committed `transactionId`, Yjs applied-transaction count, `ime` while composition is active.

## Setup

1. Build a dev client (`bun --cwd apps/editor-lab ios` or `android`). Expo Go cannot load `JotEditor`.
2. Open the lab. Confirm the native view mounts (not only the placeholder).
3. Load each fixture: Bold para, Lists, Headings, 5k words. Switching chips is the only time the canonical Document reloads. Re-renders must not wipe the writing surface.

## IME

1. Note the header `applied N` before composing.
2. Apple keyboard: compose a CJK or accented candidate. Header shows `ime`. `applied` must not increment while composing.
3. Commit the candidate. `ime` clears. `applied` increments by one. One replace, not per-keystroke CRDT ops. Header shows a new short `transactionId`.
4. Cancel composition (dismiss candidate). No CRDT op. `applied` stays put.
5. Google keyboard / Gboard: same commit and cancel.
6. Hindi, Arabic, Hebrew, emoji, dictation, hardware keyboard: commit path only.
7. Autocorrect: one replaceRange from the original range to the committed word. `applied` increments by one.

If the process dies during composition, the uncommitted candidate may be lost. That is outside the committed-edit promise.

## Kill and resume

1. Type a committed paragraph (not composing). Header shows a short `transactionId` and `applied` at least 1.
2. Kill the app from the app switcher.
3. Relaunch. The paragraph is still on the writing surface.
4. After recover, the header still shows a committed `transactionId` (from unapplied journal replay into Yjs). `applied` is not zero if that edit was still unapplied at kill.
5. Repeat with a 5k-word fixture after a short scroll and an insert.

## Phase 0.5 measurement (Hermes release on device)

Bun benches are not this section. `benchmarks/results/latest.json` and `durability-latest.json` are host bun. Do not paste them into the device file or into product docs.

Copy `apps/editor-lab/benchmarks/results/device-template.json` and fill the copy on hardware. Leave the committed template as nulls with `"status": "not-run"`.

1. Build **release**, not debug. Debug FPS does not count. Record the device model.
2. Load the 5,000-word fixture. Scroll. Record jank yes/no and a memory note. Subjective is fine until Instruments/systrace is wired.
3. Type with the native journal enabled (`synchronous=FULL` before ack). Device p50/p95/p99 of that append path is the durability gate, not bun sqlite.
4. Re-run IME commit and cancel from the IME section. Record pass/fail.
5. Re-run kill/relaunch from the section above. Record pass/fail.
6. Re-run VoiceOver or TalkBack from the section below. Record pass/fail.
7. CRDT under Hermes is still required before the engine choice is closed. Do not add Loro/Automerge WASM to the Expo app to fake that lane.

## Rotation

1. Type with a visible selection.
2. Rotate to landscape and back.
3. Selection, scroll offset, and keyboard avoidance still work. Toolbar stays above the keyboard.

## Undo / redo

1. Type a committed insert. Undo. The insert leaves the writing surface and Yjs `applied` increments (undo is a committed edit).
2. Redo. The insert returns.

## VoiceOver / TalkBack

1. Enable VoiceOver (iOS) or TalkBack (Android).
2. Focus the editor. The writing surface is reachable.
3. Move to a heading, list item, and task. Labels describe the block, not a dump of spans.
4. Toggle bold from the toolbar. The control has a text name (B, I, H1, ...), not an unlabeled graphic.
5. Task items expose checked state.

## Out of scope for this bun host

Filling p95/p99, 60 fps, or Hermes CRDT numbers. That is a filled copy of `benchmarks/results/device-template.json` on a release build. `benchmarks/results/latest.json` is bun-local.
