# Phase 1 mobile app

How to build the iOS and Android apps, run the editor gates, and what to check by hand before calling a change done. The automated gates are `bun run check` for shared TypeScript and `bun run test:native-editor` for the Swift and Kotlin editors.

## Build and run

The editor is a native module, so JavaScript reloads are not enough after a Swift or Kotlin change.

iOS:

```sh
cd apps/mobile
bunx expo run:ios --device "iPhone 17"   # rebuilds pods and native code, installs, opens
bunx expo start --dev-client             # later sessions, when only TypeScript changed
```

After adding a Swift file to `packages/editor-native/ios`, run `pod install` in `apps/mobile/ios` first. Without it the build fails with "cannot find ... in scope".

Android:

```sh
cd apps/mobile/android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081
```

## Editor gate

`bun run test:native-editor` runs three checks:

1. `ios-host`: compiles the Foundation-only Swift sources (model, commands, `EditPlanner`, undo, journal) and runs `LinearModelTests` and the corpus runner. UIKit files are compiled only by the app build.
2. `android-jvm`: compiles the Kotlin model, commands, `EditPlanner`, and tests with the kotlinc bundled in Android Studio, then runs `LinearModelTest` (JUnit) and the corpus runner.
3. `editor-corpus`: applies every scenario's operations with TypeScript `applyOperations` and with Yjs, checks that each native inverse restores the previous document, checks the expected outline, round-trips the schema fixtures, and requires Swift and Kotlin to emit the same operations.

The corpus is `packages/editor-native/corpus/editing.json`. Steps address editor characters, where list markers, checkboxes, quote bars, and newlines each count as one: `caret`, `select`, `marks`, `type`, `key` (enter, backspace, undo, redo), and `command`. To add a case, add a scenario with an `expect` outline and run the gate.

Keystroke planning lives in `EditPlanner.swift` and `EditPlanner.kt`, not in the views, so the corpus exercises the code the app runs.

## Benchmarks

Storage, 10,000 synthetic notes through the real store:

```sh
cd packages/local-store && bun run bench:vault
```

Typing: each committed edit logs timings at debug level.

- iOS: `xcrun simctl spawn booted log stream --level debug --predicate 'subsystem == "app.jot.editor"'`
- Android: `adb shell setprop log.tag.JotEditor DEBUG`, then `adb logcat -s JotEditor`

Results on an M-series Mac, simulator and emulator. The design's budgets are for a mid-range phone, so these are lower bounds, not a pass.

| Measurement | p50 | p95 |
| --- | --- | --- |
| Note list, 10,000 notes (host) | 30 ms | 53 ms |
| Search top 50, 10,000 notes (host) | 19 ms | 34 ms |
| Open a 5,000-word note (host) | 0.3 ms | 0.8 ms |
| iOS keystroke commit, 5,000-word note | 15 ms | 43 ms |
| Android keystroke redraw, 5,000-word note | 1 ms | 7 ms |
| Android journal write per keystroke (emulator disk) | 6 ms | 33 ms |

On iOS nearly all of a keystroke is `UITextView` placing the caret after the storage change; building and swapping the paragraph takes under 1 ms.

## Where the data lives

| Data | Location in the iOS app container |
| --- | --- |
| Notes, documents, undo history, versions, attachment bytes | `Documents/SQLite/jot.sqlite` |
| Image files the editor draws | `Documents/attachments/<attachment id>` |
| Per-note editor journal | `Library/Application Support/jot-editor-intake/<note id>.sqlite` |

On Android the per-note journal is `databases/jot_editor_intake_<note id>.db` in the app's data directory.

`xcrun simctl get_app_container booted app.jot.mobile data` prints the iOS container path. A journal row with `applied = 0` is an edit the editor accepted that the database has not confirmed; opening the note replays it, and rows the database already committed are skipped.

## Manual checks

Run on both platforms.

1. Create a note. The keyboard opens and "Start writing" shows. Leave it empty and go back: the note is removed.
2. Type `# ` then text for a title, `- ` for a list, `[ ] ` for a checklist, `> ` for a quote, `---` then Return for a divider. An empty list item shows its marker.
3. Type `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, and `[site](https://example.com)`. The delimiters disappear as the closing character is typed.
4. Paste several lines of Markdown. Each line becomes a block.
5. Add an image from the toolbar. Tap it to pick a size, or pinch it. Undo restores the previous size. Tapping an image does not move the caret into it.
6. Type a few words, force-quit the app, reopen the note, and press Undo. The words go away.
7. Move a note to the trash, restore it, then delete it permanently from the trash.
8. Export everything from Settings. The zip holds Markdown files and an `attachments/` folder.
9. Reload JavaScript from the dev menu with a note open. The app reloads without crashing.

## Known gaps

- Pinch resizing is not driven by automation on either platform. The width command is covered by tests; the gesture code is checked by hand.
- On Android, keyboard composition was exercised with injected keys, not a composing soft keyboard such as Gboard word suggestions. Composition is deferred until it finishes, so a word being composed is not journaled until then.
- Timings above come from a Mac. Phone measurements, and a decision on the Android journal write cost against the durability window in the technical design, are still needed before release.
