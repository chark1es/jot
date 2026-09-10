# Android LinearModel tests

`android/src/test/java/app/jot/editor/LinearModelTest.kt` is JUnit 4 against `LinearModel.kt`. That file has no Android imports, so the host gate runs it as a JVM test.

```sh
bun run test:native-editor
```

The script resolves `JAVA_HOME` (env, `/usr/libexec/java_home` on darwin, or `java` on PATH), finds `kotlinc` on PATH or Android Studio, compiles `LinearModel.kt`, `EditorEdits.kt`, `JsonParser.kt`, and `LinearModelTest.kt`, and runs `org.junit.runner.JUnitCore`.

Missing JDK, kotlinc, or Android SDK is a skip (exit 0). A kotlinc or JUnit failure is exit 1.

There is no Gradle wrapper inside `packages/editor-native/android`. AGP `testDebugUnitTest` still needs a prebuilt Expo android tree (`apps/editor-lab/android` after prebuild). Do not treat a skip on a machine without that SDK as a pass of the device journal.

DurableJournal.kt uses `android.database.sqlite` and is not in this JVM lane.
