import type { Clock, LogicalTime, WallTime } from '@jolt/core';
import { nextLogicalTime } from '@jolt/core';
import type { DeviceId } from '@jolt/schema';

export class FakeClock implements Clock {
  private wallMs: number;

  constructor(startUnixMs = 0) {
    this.wallMs = startUnixMs;
  }

  setWallUnixMs(unixMs: number): void {
    this.wallMs = unixMs;
  }

  advanceMs(deltaMs: number): void {
    this.wallMs += deltaMs;
  }

  wallNow(): WallTime {
    return { unixMs: this.wallMs };
  }

  nextLogical(local: LogicalTime, observed: LogicalTime, deviceId: DeviceId): LogicalTime {
    return nextLogicalTime(local, observed, deviceId);
  }
}
