#!/usr/bin/env bun

/**
 * Native editor gate.
 *
 * iOS: compiles the Foundation-only editor sources with `xcrun swiftc`, runs the Swift model tests,
 * and runs the shared editor corpus (required on darwin).
 * Android: compiles the Kotlin model, planner, JUnit tests, and corpus runner with kotlinc, then
 * runs both on the JVM when a JDK and kotlinc exist.
 * Corpus: every native output is checked against TypeScript `applyOperations` and Yjs, and the two
 * platforms against each other (scripts/editor-corpus-verify.ts).
 * Missing Xcode on Linux, or a missing JDK or kotlinc, is a skip (exit 0). Any failure is exit 1.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { CORPUS_PATH, FIXTURES_DIR, verifyCorpus } from './editor-corpus-verify.ts';
import type { CorpusOutput } from './editor-corpus-verify.ts';

const ROOT = join(import.meta.dirname, '..');
const IOS_DIR = join(ROOT, 'packages/editor-native/ios');
const ANDROID_DIR = join(ROOT, 'packages/editor-native/android');
const CACHE_DIR = join(ROOT, '.cache/native-editor-check');

const IOS_HOST_FILES = [
  'JotIds.swift',
  'SchemaCodec.swift',
  'LinearModel.swift',
  'LinearCommands.swift',
  'EditPlanner.swift',
  'CompositionSession.swift',
  'UndoStack.swift',
  'DurableJournal.swift',
  'Tests/LinearModelTests.swift',
  'Tests/EditorCorpusRunner.swift',
  'Tests/HostMain/main.swift',
] as const;

const IOS_UIKIT_SKIPPED = [
  'AttributedBridge.swift',
  'EditorPerformanceLog.swift',
  'JotEditorView.swift',
  'JotEditorModule.swift',
  'JotTextView.swift',
  'TaskCheckboxAttachment.swift',
] as const;

const ANDROID_MAIN = [
  'SchemaCodec.kt',
  'JotIds.kt',
  'LinearModel.kt',
  'LinearCommands.kt',
  'EditPlanner.kt',
  'UndoStack.kt',
  'JsonParser.kt',
] as const;

const ANDROID_TESTS = ['LinearModelTest.kt', 'EditorCorpusRunner.kt'] as const;

const JUNIT_URL = 'https://repo1.maven.org/maven2/junit/junit/4.13.2/junit-4.13.2.jar';
const HAMCREST_URL =
  'https://repo1.maven.org/maven2/org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar';

type CheckStatus = 'ok' | 'skip' | 'fail';

type CheckResult = {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
  /** Corpus output written by this platform, when it ran. */
  readonly corpusOutput?: string;
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
  const studioJbr = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
  if (process.platform === 'darwin' && existsSync(join(studioJbr, 'bin', 'java'))) {
    return studioJbr;
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
    maxBuffer: 64 * 1024 * 1024,
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
      name: 'ios-host',
      status: 'skip',
      detail: `${process.platform} is not darwin; xcrun swiftc skipped`,
    };
  }
  const xcrun = commandPath('xcrun');
  if (!xcrun) {
    return { name: 'ios-host', status: 'fail', detail: 'xcrun missing on darwin' };
  }
  const files = IOS_HOST_FILES.map((rel) => join(IOS_DIR, rel));
  const missing = files.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    return { name: 'ios-host', status: 'fail', detail: `missing ${missing.join(', ')}` };
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  const binary = join(CACHE_DIR, 'swift-host');
  const compile = run(xcrun, ['swiftc', '-o', binary, ...files]);
  if (compile.status !== 0) {
    return {
      name: 'ios-host',
      status: 'fail',
      detail: compile.stderr.trim() || compile.stdout.trim() || `swiftc exited ${String(compile.status)}`,
    };
  }
  const output = join(CACHE_DIR, 'corpus-swift.json');
  const test = run(binary, [CORPUS_PATH, FIXTURES_DIR, output]);
  if (test.status !== 0) {
    return {
      name: 'ios-host',
      status: 'fail',
      detail: `${test.stdout}\n${test.stderr}`.trim() || `host tests exited ${String(test.status)}`,
    };
  }
  return {
    name: 'ios-host',
    status: 'ok',
    detail: `LinearModelTests and corpus on ${String(files.length)} Foundation files. UIKit not compiled here: ${IOS_UIKIT_SKIPPED.join(', ')}`,
    corpusOutput: output,
  };
}

async function checkAndroid(): Promise<CheckResult> {
  const mainDir = join(ANDROID_DIR, 'src/main/java/app/jot/editor');
  const testDir = join(ANDROID_DIR, 'src/test/java/app/jot/editor');
  const sources = [...ANDROID_MAIN.map((name) => join(mainDir, name)), ...ANDROID_TESTS.map((name) => join(testDir, name))];
  const missing = sources.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    return { name: 'android-jvm', status: 'fail', detail: `missing ${missing.join(', ')}` };
  }

  const javaHome = resolveJavaHome();
  if (!javaHome) {
    return {
      name: 'android-jvm',
      status: 'skip',
      detail: 'JAVA_HOME unset and java not found; Kotlin tests not executed',
    };
  }
  const kotlinc = findKotlinc();
  if (!kotlinc) {
    return {
      name: 'android-jvm',
      status: 'skip',
      detail: 'kotlinc not found (PATH or Android Studio); Kotlin tests not executed',
    };
  }
  const stdlib = join(kotlinc.libDir, 'kotlin-stdlib.jar');
  if (!existsSync(stdlib)) {
    return {
      name: 'android-jvm',
      status: 'skip',
      detail: `kotlin-stdlib.jar missing next to kotlinc (${stdlib})`,
    };
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const junitJar = join(CACHE_DIR, 'junit-4.13.2.jar');
  const hamcrestJar = join(CACHE_DIR, 'hamcrest-core-1.3.jar');
  if (!(await ensureJar(JUNIT_URL, junitJar)) || !(await ensureJar(HAMCREST_URL, hamcrestJar))) {
    return {
      name: 'android-jvm',
      status: 'skip',
      detail: 'JUnit jars unavailable offline; Kotlin tests not executed',
    };
  }
  const env = { JAVA_HOME: javaHome };
  const java = join(javaHome, 'bin', 'java');
  const outDir = join(CACHE_DIR, 'kotlin-classes');
  mkdirSync(outDir, { recursive: true });
  const testCp = [junitJar, hamcrestJar].join(delimiter);
  const compile = run(kotlinc.bin, ['-cp', testCp, '-d', outDir, ...sources], env);
  if (compile.status !== 0) {
    return {
      name: 'android-jvm',
      status: 'fail',
      detail: compile.stderr.trim() || compile.stdout.trim() || 'kotlinc failed',
    };
  }
  const runCp = [outDir, junitJar, hamcrestJar, stdlib].join(delimiter);
  const test = run(java, ['-cp', runCp, 'org.junit.runner.JUnitCore', 'app.jot.editor.LinearModelTest'], env);
  const combined = `${test.stdout}\n${test.stderr}`;
  if (test.status !== 0 || combined.includes('FAILURES!!!')) {
    return {
      name: 'android-jvm',
      status: 'fail',
      detail: combined.trim() || `JUnit exited ${String(test.status)}`,
    };
  }
  const output = join(CACHE_DIR, 'corpus-kotlin.json');
  const corpus = run(java, ['-cp', runCp, 'app.jot.editor.EditorCorpusRunner', CORPUS_PATH, FIXTURES_DIR, output], env);
  if (corpus.status !== 0) {
    return {
      name: 'android-jvm',
      status: 'fail',
      detail: `${corpus.stdout}\n${corpus.stderr}`.trim() || 'corpus runner failed',
    };
  }
  const passed = /OK \((\d+) tests?\)/.exec(combined)?.[1] ?? '?';
  return {
    name: 'android-jvm',
    status: 'ok',
    detail: `LinearModelTest (${passed} JUnit tests) and corpus on the JVM. The EditText view is exercised on a device, not here`,
    corpusOutput: output,
  };
}

function checkCorpus(results: readonly CheckResult[]): CheckResult {
  const outputs = results
    .map((result) => result.corpusOutput)
    .filter((path): path is string => path !== undefined)
    .map((path) => JSON.parse(readFileSync(path, 'utf8')) as CorpusOutput);
  if (outputs.length === 0) {
    return { name: 'editor-corpus', status: 'skip', detail: 'no native platform ran the corpus' };
  }
  const report = verifyCorpus(outputs);
  const platforms = outputs.map((output) => output.platform).join(' + ');
  if (report.failures.length > 0) {
    return { name: 'editor-corpus', status: 'fail', detail: report.failures.join('\n') };
  }
  return {
    name: 'editor-corpus',
    status: 'ok',
    detail: `${platforms}: ${String(report.scenarios)} scenarios, ${String(report.operations)} operations through TypeScript and Yjs, ${String(report.fixtures)} fixture round trips${outputs.length > 1 ? ', platforms identical' : ''}`,
  };
}

const native: CheckResult[] = [checkIos(), await checkAndroid()];
const results: CheckResult[] = [...native, checkCorpus(native)];
let failed = 0;
for (const result of results) {
  const mark = result.status === 'ok' ? 'ok' : result.status === 'skip' ? 'skip' : 'FAIL';
  process.stdout.write(`${result.name.padEnd(14)} ${mark.padEnd(4)} ${result.detail}\n`);
  if (result.status === 'fail') {
    failed += 1;
  }
}
process.exit(failed === 0 ? 0 : 1);
