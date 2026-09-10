#!/usr/bin/env bun

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { replaceGradleWrapperJar } from './android-gradle-wrapper.ts';

const HOMEBREW_NODE = '/opt/homebrew/bin/node';
const HOMEBREW_BIN = '/opt/homebrew/bin';

const ROOT = join(import.meta.dirname, '..');
const STATE_DIR = join(ROOT, '.jot');
const STATE_PATH = join(STATE_DIR, 'selected-device.json');

type AppName = 'editor-lab' | 'mobile';
type Platform = 'ios' | 'android';

type Device = {
  readonly platform: Platform;
  readonly id: string;
  readonly name: string;
  readonly ready: boolean;
};

type Selection = {
  readonly platform: Platform;
  readonly id: string;
  readonly name: string;
  readonly app: AppName;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isAppName(value: string): value is AppName {
  return value === 'editor-lab' || value === 'mobile';
}

function isPlatform(value: string): value is Platform {
  return value === 'ios' || value === 'android';
}

function parseArgs(argv: readonly string[]): { command: string; app: AppName } {
  let command = 'install';
  let app: AppName = 'editor-lab';
  const rest = [...argv];
  const first = rest[0];
  if (first === 'install' || first === 'select' || first === 'list') {
    command = first;
    rest.shift();
  }
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] !== '--app') {
      continue;
    }
    const value = rest[i + 1];
    if (typeof value !== 'string' || !isAppName(value)) {
      throw new Error('Usage: --app editor-lab | mobile');
    }
    app = value;
    i += 1;
  }
  return { command, app };
}

function loadSelection(): Selection | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    if (!isRecord(raw)) {
      return undefined;
    }
    const { platform, id, name, app } = raw;
    if (
      typeof platform !== 'string' ||
      !isPlatform(platform) ||
      typeof id !== 'string' ||
      typeof name !== 'string' ||
      typeof app !== 'string' ||
      !isAppName(app)
    ) {
      return undefined;
    }
    return { platform, id, name, app };
  } catch {
    return undefined;
  }
}

function saveSelection(selection: Selection): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_PATH, `${JSON.stringify(selection, null, 2)}\n`);
}

function capture(command: string, args: readonly string[]): string {
  const result = spawnSync(command, [...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function parseSimctl(jsonText: string): Device[] {
  const parsed: unknown = JSON.parse(jsonText);
  if (!isRecord(parsed) || !isRecord(parsed.devices)) {
    return [];
  }
  const devices: Device[] = [];
  for (const runtimeDevices of Object.values(parsed.devices)) {
    if (!Array.isArray(runtimeDevices)) {
      continue;
    }
    for (const entry of runtimeDevices) {
      if (!isRecord(entry)) {
        continue;
      }
      const udid = entry.udid;
      const name = entry.name;
      const state = entry.state;
      const available = entry.isAvailable;
      if (typeof udid !== 'string' || typeof name !== 'string' || available === false) {
        continue;
      }
      devices.push({
        platform: 'ios',
        id: udid,
        name,
        ready: state === 'Booted',
      });
    }
  }
  return devices;
}

function parseAdb(output: string): Device[] {
  const devices: Device[] = [];
  for (const line of output.split('\n')) {
    if (line.length === 0 || line.startsWith('List of devices')) {
      continue;
    }
    const parts = line.split(/\s+/);
    const serial = parts[0];
    const status = parts[1];
    if (typeof serial !== 'string' || serial.length === 0 || status !== 'device') {
      continue;
    }
    const modelToken = parts.find((part) => part.startsWith('model:'));
    const name = modelToken === undefined ? serial : modelToken.slice('model:'.length);
    devices.push({
      platform: 'android',
      id: serial,
      name,
      ready: true,
    });
  }
  return devices;
}

function listDevices(): Device[] {
  const found: Device[] = [];
  try {
    found.push(...parseSimctl(capture('xcrun', ['simctl', 'list', 'devices', 'available', '-j'])));
  } catch {
    // No Xcode / simctl on this host.
  }
  try {
    found.push(...parseAdb(capture('adb', ['devices', '-l'])));
  } catch {
    // adb missing or daemon down.
  }
  return found;
}

function formatDevice(device: Device): string {
  const flag = device.ready ? 'ready' : 'cold';
  return `${device.platform}  ${device.name}  ${device.id}  (${flag})`;
}

function pickUnique(devices: readonly Device[]): Device | undefined {
  return devices.length === 1 ? devices[0] : undefined;
}

function resolveInstallTarget(devices: readonly Device[], app: AppName): Selection {
  const saved = loadSelection();
  if (saved !== undefined) {
    const stillThere = devices.find((device) => device.id === saved.id);
    if (stillThere !== undefined) {
      return { ...saved, app, name: stillThere.name, platform: stillThere.platform };
    }
  }
  const bootedIos = devices.filter((device) => device.platform === 'ios' && device.ready);
  const android = devices.filter((device) => device.platform === 'android' && device.ready);
  const uniqueIos = pickUnique(bootedIos);
  if (uniqueIos !== undefined) {
    return { platform: uniqueIos.platform, id: uniqueIos.id, name: uniqueIos.name, app };
  }
  const uniqueAndroid = pickUnique(android);
  if (bootedIos.length === 0 && uniqueAndroid !== undefined) {
    return {
      platform: uniqueAndroid.platform,
      id: uniqueAndroid.id,
      name: uniqueAndroid.name,
      app,
    };
  }
  const ready = [...bootedIos, ...android];
  if (ready.length === 0) {
    throw new Error(
      'No booted simulator or connected device. Boot one, or run bun run devices:select.',
    );
  }
  throw new Error(
    `Multiple ready devices. Run bun run devices:select.\n${ready.map((device) => `  ${formatDevice(device)}`).join('\n')}`,
  );
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

async function selectDevice(devices: readonly Device[], app: AppName): Promise<Selection> {
  if (devices.length === 0) {
    throw new Error('No simulators or adb devices found.');
  }
  process.stdout.write('Devices:\n');
  devices.forEach((device, index) => {
    process.stdout.write(`  ${String(index + 1)}. ${formatDevice(device)}\n`);
  });
  const answer = await ask('Select device number: ');
  const index = Number.parseInt(answer, 10) - 1;
  const device = Number.isInteger(index) ? devices.at(index) : undefined;
  if (device === undefined) {
    throw new Error('Invalid selection.');
  }
  return { platform: device.platform, id: device.id, name: device.name, app };
}

function resolveJavaHome(): string | undefined {
  const existing = process.env.JAVA_HOME;
  if (typeof existing === 'string' && existing.length > 0) {
    return existing;
  }
  try {
    const home = capture('/usr/libexec/java_home', ['-v', '17']).trim();
    return home.length > 0 ? home : undefined;
  } catch {
    return undefined;
  }
}

function androidInstallEnv(serial: string): NodeJS.ProcessEnv {
  const pathParts = (process.env.PATH ?? '')
    .split(':')
    .filter((part) => part.length > 0 && part !== HOMEBREW_BIN);
  const javaHome = resolveJavaHome();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ANDROID_SERIAL: serial,
    PATH: [HOMEBREW_BIN, ...pathParts].join(':'),
  };
  if (javaHome !== undefined) {
    env.JAVA_HOME = javaHome;
  }
  delete env.NODE_COMPILE_CACHE;
  return env;
}

function install(selection: Selection): Promise<void> {
  const appDir = join(ROOT, 'apps', selection.app);
  if (selection.platform === 'android') {
    replaceGradleWrapperJar(appDir);
  }
  // iOS: Expo matches udid. Android: Expo matches adb `model:` (SM_S948U1), not the serial.
  const expoDevice = selection.platform === 'ios' ? selection.id : selection.name;
  const expoArgs =
    selection.platform === 'ios'
      ? (['run:ios', '--device', expoDevice, '--no-bundler'] as const)
      : (['run:android', '--device', expoDevice, '--no-bundler'] as const);
  process.stdout.write(
    `Installing ${selection.app} on ${selection.platform} ${selection.name} (${selection.id})\n`,
  );
  const env =
    selection.platform === 'android' ? androidInstallEnv(selection.id) : process.env;
  const expoCli = createRequire(join(appDir, 'package.json')).resolve('expo/bin/cli');
  const node = existsSync(HOMEBREW_NODE) ? HOMEBREW_NODE : 'node';
  return new Promise((resolve, reject) => {
    const child = spawn(node, [expoCli, ...expoArgs], {
      cwd: appDir,
      env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      process.exit(code ?? 1);
    });
  });
}

async function main(): Promise<void> {
  const { command, app } = parseArgs(process.argv.slice(2));
  const devices = listDevices();

  if (command === 'list') {
    if (devices.length === 0) {
      process.stdout.write('No simulators or adb devices found.\n');
      return;
    }
    const saved = loadSelection();
    for (const device of devices) {
      const mark = saved?.id === device.id ? '*' : ' ';
      process.stdout.write(`${mark} ${formatDevice(device)}\n`);
    }
    return;
  }

  if (command === 'select') {
    const selection = await selectDevice(devices, app);
    saveSelection(selection);
    process.stdout.write(`Selected ${selection.name} (${selection.id}) for ${selection.app}\n`);
    return;
  }

  const target = resolveInstallTarget(devices, app);
  saveSelection(target);
  await install(target);
}

await main();
