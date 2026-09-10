#!/usr/bin/env bun

/**
 * Phase 0.5 native compile/test gate.
 *
 * iOS: `xcrun swiftc -parse` on Foundation sources (required on darwin).
 * Android: JVM JUnit for LinearModelTest when a JDK and kotlinc exist.
 * Missing Xcode on Linux, or missing Android SDK/kotlinc, is a skip (exit 0).
 * Parse or test failure is exit 1.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const IOS_DIR = join(ROOT, 'packages/editor-native/ios');
const ANDROID_DIR = join(ROOT, 'packages/editor-native/android');
const CACHE_DIR = join(ROOT, '.cache/native-editor-check');

const IOS_PARSE_FILES = [
  'JotIds.swift',
  'SchemaCodec.swift',
  'LinearModel.swift',
  'LinearCommands.swift',
  'Tests/LinearModelTests.swift',
  'CompositionSession.swift',
  'UndoStack.swift',
  'DurableJournal.swift',
] as const;

const IOS_UIKIT_SKIPPED = [
  'AttributedBridge.swift',
  'JotEditorView.swift',
  'JotEditorModule.swift',
  'JotTextView.swift',
  'TaskCheckboxAttachment.swift',
] as const;

const JUNIT_URL = 'https://repo1.maven.org/maven2/junit/junit/4.13.2/junit-4.13.2.jar';
const HAMCREST_URL =
  'https://repo1.maven.org/maven2/org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar';

type CheckStatus = 'ok' | 'skip' | 'fail';

type CheckResult = {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
};

function commandPath(command: string): string | undefined {
  const result = spawnSync(
    process.platform === 'win32' ? 'where' : 'command',
    [...(process.platform === 'win32' ? [] : ['-v']), command],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    return undefined;
  }
  const found = result.stdout.trim().split('\n')[0];
  if (found && existsSync(found)) {
    return found;
  }
  return undefined;
}

function resolveJavaHome(): string | undefined {
  const fromEnv = process.env.JAVA_HOME;
  if (fromEnv && existsSync(join(fromEnv, 'bin', 'java'))) {
    return fromEnv;
  }
  if (process.platform === 'darwin' && existsSync('/usr/libexec/java_home')) {
    for (const args of [['-v', '17'], []] as const) {
      const result = spawnSync('/usr/libexec/java_home', [...args], { encoding: 'utf8' });
      const home = result.stdout.trim();
      if (result.status === 0 && home && existsSync(join(home, 'bin', 'java'))) {
        return home;
      }
    }
  }
  const java = commandPath('java');
  if (java) {
    const home = join(dirname(java), '..');
    if (existsSync(join(home, 'bin', 'java'))) {
      return home;
    }
  }
  return undefined;
}

function findKotlinc(): { bin: string; libDir: string } | undefined {
  const fromPath = commandPath('kotlinc');
  if (fromPath) {
    return { bin: fromPath, libDir: join(dirname(fromPath), '..', 'lib') };
  }
  const studio = '/Applications/Android Studio.app/Contents/plugins/Kotlin/kotlinc/bin/kotlinc';
  if (existsSync(studio)) {
    return { bin: studio, libDir: join(dirname(studio), '..', 'lib') };
  }
  return undefined;
}

function run(
  command: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    env: env ? { ...process.env, ...env } : process.env,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
}

async function ensureJar(url: string, dest: string): Promise<boolean> {
  if (existsSync(dest)) {
    return true;
  }
  mkdirSync(dirname(dest), { recursive: true });
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return false;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(dest, bytes);
    return existsSync(dest);
  } catch {
    return false;
  }
}

function checkIos(): CheckResult {
  if (process.platform !== 'darwin') {
    return {
      name: 'ios-parse',
      status: 'skip',
      detail: `${process.platform} is not darwin; xcrun swiftc skipped`,
    };
  }
  const xcrun = commandPath('xcrun');
  if (!xcrun) {
    return {
      name: 'ios-parse',
      status: 'fail',
      detail: 'xcrun missing on darwin',
    };
  }
  const files = IOS_PARSE_FILES.map((rel) => join(IOS_DIR, rel));
  const missing = files.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    return {
      name: 'ios-parse',
      status: 'fail',
      detail: `missing ${missing.join(', ')}`,
    };
  }
  const result = run(xcrun, ['swiftc', '-parse', ...files]);
  if (result.status !== 0) {
    return {
      name: 'ios-parse',
      status: 'fail',
      detail:
        result.stderr.trim() ||
        result.stdout.trim() ||
        `swiftc -parse exited ${String(result.status)}`,
    };
  }
  return {
    name: 'ios-parse',
    status: 'ok',
    detail: `${String(files.length)} Foundation files. UIKit skipped: ${IOS_UIKIT_SKIPPED.join(', ')}`,
  };
}

async function checkAndroid(): Promise<CheckResult> {
  const testSrc = join(ANDROID_DIR, 'src/test/java/app/jot/editor/LinearModelTest.kt');
  const modelSrc = join(ANDROID_DIR, 'src/main/java/app/jot/editor/LinearModel.kt');
  const editsSrc = join(ANDROID_DIR, 'src/main/java/app/jot/editor/EditorEdits.kt');
  const parserSrc = join(ANDROID_DIR, 'src/main/java/app/jot/editor/JsonParser.kt');
  const gradle = join(ANDROID_DIR, 'build.gradle');
  const jvmSources = [modelSrc, editsSrc, parserSrc, testSrc];
  if (!existsSync(testSrc)) {
    return { name: 'android-linear', status: 'fail', detail: `missing ${testSrc}` };
  }
  if (!existsSync(modelSrc)) {
    return { name: 'android-linear', status: 'fail', detail: `missing ${modelSrc}` };
  }
  if (!existsSync(editsSrc)) {
    return { name: 'android-linear', status: 'fail', detail: `missing ${editsSrc}` };
  }
  if (!existsSync(parserSrc)) {
    return { name: 'android-linear', status: 'fail', detail: `missing ${parserSrc}` };
  }
  if (!existsSync(gradle)) {
    return { name: 'android-linear', status: 'fail', detail: `missing ${gradle}` };
  }

  const javaHome = resolveJavaHome();
  if (!javaHome) {
    return {
      name: 'android-linear',
      status: 'skip',
      detail: 'JAVA_HOME unset and java not found; LinearModelTest not executed',
    };
  }

  const kotlinc = findKotlinc();
  if (!kotlinc) {
    const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    return {
      name: 'android-linear',
      status: 'skip',
      detail: sdk
        ? 'kotlinc not on PATH; packages/editor-native/android has no Gradle wrapper. Prebuild editor-lab android for AGP tests, or install kotlinc'
        : 'Android SDK and kotlinc missing; LinearModelTest not executed',
    };
  }

  const stdlib = join(kotlinc.libDir, 'kotlin-stdlib.jar');
  if (!existsSync(stdlib)) {
    return {
      name: 'android-linear',
      status: 'skip',
      detail: `kotlin-stdlib.jar missing next to kotlinc (${stdlib})`,
    };
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const junitJar = join(CACHE_DIR, 'junit-4.13.2.jar');
  const hamcrestJar = join(CACHE_DIR, 'hamcrest-core-1.3.jar');
  const gotJunit = await ensureJar(JUNIT_URL, junitJar);
  const gotHamcrest = await ensureJar(HAMCREST_URL, hamcrestJar);
  const java = join(javaHome, 'bin', 'java');
  const env = { JAVA_HOME: javaHome };

  if (!gotJunit || !gotHamcrest) {
    const outDir = join(CACHE_DIR, 'model-out');
    mkdirSync(outDir, { recursive: true });
    const parse = run(kotlinc.bin, ['-d', outDir, modelSrc, editsSrc, parserSrc], env);
    if (parse.status !== 0) {
      return {
        name: 'android-linear',
        status: 'fail',
        detail: parse.stderr.trim() || parse.stdout.trim() || 'kotlinc LinearModel.kt failed',
      };
    }
    return {
      name: 'android-linear',
      status: 'skip',
      detail: 'JUnit jars unavailable; LinearModel.kt parsed, LinearModelTest not executed',
    };
  }

  const outDir = join(CACHE_DIR, 'linear-classes');
  mkdirSync(outDir, { recursive: true });
  const compileCp = [junitJar, hamcrestJar].join(delimiter);
  const compile = run(kotlinc.bin, ['-cp', compileCp, '-d', outDir, ...jvmSources], env);
  if (compile.status !== 0) {
    return {
      name: 'android-linear',
      status: 'fail',
      detail: compile.stderr.trim() || compile.stdout.trim() || 'kotlinc LinearModelTest failed',
    };
  }

  const runCp = [outDir, junitJar, hamcrestJar, stdlib].join(delimiter);
  const test = run(
    java,
    ['-cp', runCp, 'org.junit.runner.JUnitCore', 'app.jot.editor.LinearModelTest'],
    env,
  );
  const combined = `${test.stdout}\n${test.stderr}`;
  if (test.status !== 0 || combined.includes('FAILURES!!!')) {
    return {
      name: 'android-linear',
      status: 'fail',
      detail: combined.trim() || `JUnit exited ${String(test.status)}`,
    };
  }
  return {
    name: 'android-linear',
    status: 'ok',
    detail:
      'LinearModelTest JUnit (JVM). LinearModel.kt has no Android imports; this is not an AGP device test',
  };
}

const results: CheckResult[] = [checkIos(), await checkAndroid()];
let failed = 0;
for (const result of results) {
  const mark = result.status === 'ok' ? 'ok' : result.status === 'skip' ? 'skip' : 'FAIL';
  process.stdout.write(`${result.name.padEnd(18)} ${mark.padEnd(4)} ${result.detail}\n`);
  if (result.status === 'fail') {
    failed += 1;
  }
}
process.exit(failed === 0 ? 0 : 1);
