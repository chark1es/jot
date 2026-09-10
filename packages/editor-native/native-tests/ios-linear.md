# iOS LinearModel tests

`ios/Tests/LinearModelTests.swift` is compilable Swift. It does not need an Xcode project checked in.

`LinearModelTests.runAll()` round-trips Phase 0.5 linearization (paragraph + bold, headings, nested lists and tasks, codeBlock `languageId`, unknown-block placeholders, UTF-16 emoji, insertText) plus Phase 1 underline marks, blockquotes, and horizontal rules. It applies a serialized unapplied journal payload, splits/joins a list item, fires heading-1, bullet, and `>` blockquote input rules, toggles underline, inserts a divider, and checks that `CompositionSession` begin/end does not produce operations.

## CI lane

When editor-lab has a native test target, compile iOS 17+ against the Expo module and call `LinearModelTests.runAll()` from an XCTest case (the `#if canImport(XCTest)` wrapper is already in the file).

Until that target exists, a host macOS/iOS compile of the Foundation files plus the test file is enough. Include `CompositionSession.swift`, `UndoStack.swift`, `DurableJournal.swift`, and `LinearCommands.swift` (Foundation + SQLite3, no UIKit).

```sh
bun run test:native-editor
```

That is `xcrun swiftc -parse` on darwin for:

```sh
xcrun swiftc -parse \
  packages/editor-native/ios/JotIds.swift \
  packages/editor-native/ios/SchemaCodec.swift \
  packages/editor-native/ios/LinearModel.swift \
  packages/editor-native/ios/CompositionSession.swift \
  packages/editor-native/ios/UndoStack.swift \
  packages/editor-native/ios/DurableJournal.swift \
  packages/editor-native/ios/LinearCommands.swift \
  packages/editor-native/ios/Tests/LinearModelTests.swift
```

Linux skips this lane. Missing Xcode on Linux is not a failure.

UIKit files stay off this parse: `AttributedBridge.swift`, `JotTextView.swift`, `JotEditorView.swift`, `JotEditorModule.swift`, `TaskCheckboxAttachment.swift`. Do not `pod install` for this lane. Do not commit `Pods`.
