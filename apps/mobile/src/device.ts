import { createId, isId, parseId } from '@jot/schema';
import type { DeviceId } from '@jot/schema';
import { nextLogicalTime } from '@jot/core';
import type { ClockEvent } from '@jot/schema';
import { readJsonFile, writeJsonFile } from './persist';

const DEVICE_FILE = 'jot-device.json';

export type DeviceClockState = {
  readonly deviceId: DeviceId;
  readonly counter: number;
};

type DeviceFile = {
  readonly deviceId: string;
  readonly counter: number;
};

function isDeviceFile(value: unknown): value is DeviceFile {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.deviceId === 'string' && typeof record.counter === 'number';
}

export async function loadDeviceClock(): Promise<DeviceClockState> {
  const stored = await readJsonFile(DEVICE_FILE);
  if (isDeviceFile(stored) && isId(stored.deviceId) && Number.isSafeInteger(stored.counter)) {
    return {
      deviceId: parseId<DeviceId>(stored.deviceId),
      counter: Math.max(0, stored.counter),
    };
  }
  const fresh: DeviceClockState = { deviceId: createId<DeviceId>(), counter: 0 };
  await writeJsonFile(DEVICE_FILE, fresh);
  return fresh;
}

export async function persistDeviceClock(state: DeviceClockState): Promise<void> {
  await writeJsonFile(DEVICE_FILE, state);
}

export function tickClock(state: DeviceClockState): {
  readonly clock: ClockEvent;
  readonly next: DeviceClockState;
} {
  const logical = nextLogicalTime(
    { counter: state.counter, deviceId: state.deviceId },
    { counter: state.counter, deviceId: state.deviceId },
    state.deviceId,
  );
  return {
    clock: { logical, wallMs: Date.now() },
    next: { deviceId: state.deviceId, counter: logical.counter },
  };
}
