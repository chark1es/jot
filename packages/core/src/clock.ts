import type { DeviceId, LogicalTime } from '@jolt/schema';

export type { LogicalTime };

/**
 * User clocks are never ordering authority. Wall time is display and retention only.
 * Logical time is a Lamport counter plus Device ID.
 */
export type WallTime = {
  readonly unixMs: number;
};

export interface Clock {
  wallNow(): WallTime;
  nextLogical(local: LogicalTime, observed: LogicalTime, deviceId: DeviceId): LogicalTime;
}

export function compareLogicalTime(a: LogicalTime, b: LogicalTime): number {
  if (a.counter !== b.counter) {
    return a.counter < b.counter ? -1 : 1;
  }
  if (a.deviceId < b.deviceId) {
    return -1;
  }
  if (a.deviceId > b.deviceId) {
    return 1;
  }
  return 0;
}

export function nextLogicalTime(
  local: LogicalTime,
  observed: LogicalTime,
  deviceId: DeviceId,
): LogicalTime {
  const counter = Math.max(local.counter, observed.counter) + 1;
  return { counter, deviceId };
}
