# Phase 0 shells

Local launch is one host, one target. CI builds the four native artifacts.

## Mobile

Development build only. Expo Go will not load later native modules.

```sh
bun run dev:mobile
```

Then `i` or `a` in the Expo CLI, or `bun run ios` / `bun run android` from `apps/mobile`. First device or simulator run needs a development build (`expo run:ios` / `expo run:android` or EAS). Phase 0 CI prebuilds. Do not commit `ios/` or `android/` until CNG ownership is an explicit later decision.

Editor lab is the same SDK, different app:

```sh
bun run dev:editor-lab
```

## Desktop

Needs Rust on PATH.

```sh
bun run dev:desktop
```

That is `tauri dev` for the current OS. `bun run build` inside `apps/desktop` is `tauri build`.

## Four platforms

You cannot launch iOS, Android, macOS, and Windows from one machine in one command. `bun run verify:platforms` only points at CI:

- `.github/workflows/ci.yml` shared lint, types, schema, tests, `crates/crypto-core`
- `.github/workflows/mobile.yml` iOS simulator and Android compile
- `.github/workflows/desktop.yml` macOS and Windows Tauri builds

`bun run check` is the host-local shared gate. It skips the native app packages.
