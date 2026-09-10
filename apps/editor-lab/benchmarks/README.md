# Editor lab benches

Bun host timings. They are not Hermes, not a release build, and not the Phase 0.5 gate.

Phase 0.5 still needs a Hermes **release** build on hardware for 60 fps, p95/p99 journal latency, 5,000-word scroll, and the Yjs/Loro/Automerge CRDT comparison. Loro and Automerge stay challenger benches (ADR 0001). Their WASM packages must not enter `@jot/core` or the Expo app graph.

Do not copy numbers from `results/latest.json` or `results/durability-latest.json` into PRODUCT.md or technical-design.md.

## CRDT (bun)

```sh
bun apps/editor-lab/benchmarks/crdt-bench.ts
bun apps/editor-lab/benchmarks/crdt-bench.ts --engines yjs
bun apps/editor-lab/benchmarks/crdt-bench.ts --engines all
```

Default `--engines yjs`. Yjs runs in-process through `YjsCrdtDocument`. Loro and Automerge are optional dynamic imports. This repo does not depend on them.

To exercise those engines under bun:

```sh
bun add -d loro-crdt @automerge/automerge --cwd apps/editor-lab
bun apps/editor-lab/benchmarks/crdt-bench.ts --engines all
```

If import or WASM init fails, the JSON records `status: "skipped"` plus the error. A yjs-only run keeps previously recorded Loro/Automerge bun rows in `results/latest.json` so a default run does not wipe them. Those retained rows are still bun, still not Hermes.

The committed `results/latest.json` sample was produced on bun. Loro and Automerge ran in that bun process when those packages were installed for the harness, then removed so the Expo app does not ship WASM.

## Durability (bun, not the gate)

Production journal is native SQLite with `synchronous=FULL`. You cannot fsync iOS or Android from bun.

```sh
bun apps/editor-lab/benchmarks/durability-bench.ts
```

Writes `results/durability-latest.json`. `MemoryDurableIntake.append` is a baseline. `bun:sqlite` with `synchronous=FULL` is host SQLite. The file sets `"notHermes": true` and `"notDeviceJournal": true`. If `bun:sqlite` is missing, that case is `skipped`.

## Device protocol (Hermes release)

Copy `results/device-template.json` and fill it on hardware. Leave the template as nulls. Record:

- build type (release vs debug). Release is required for the gate. Debug FPS does not count.
- device model and OS version
- 5,000-word scroll: jank yes/no (subjective until we wire Instruments/systrace), memory note
- typing with the native journal enabled
- IME commit and cancel (see the manual script)
- kill / relaunch of a committed edit
- VoiceOver / TalkBack
- p50/p95/p99 durability latency from the **device** journal, not from bun sqlite
- Yjs (and optional Loro/Automerge) under Hermes if you actually run those packages in a release binary. Do not install WASM into the Expo graph to get those numbers.

`device-template.json` stays `"status": "not-run"` until a person fills a copy. Empty JSON with nulls is the honest state.

See `apps/editor-lab/fixtures/manual-test-script.md` for the click-by-click script.
