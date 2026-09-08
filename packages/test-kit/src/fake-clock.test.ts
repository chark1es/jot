import { describe, expect, it } from 'vitest';
import { FakeClock } from './fake-clock.js';
import { createSeededPrng, nextBase32Id } from './prng.js';
import { nextDeviceId } from './ids.js';

describe('@jolt/test-kit', () => {
  it('FakeClock Lamport increments past max(local, observed)', () => {
    const clock = new FakeClock(1_700_000_000_000);
    const prng = createSeededPrng(1);
    const deviceId = nextDeviceId(prng);
    const observedDevice = nextDeviceId(prng);
    const next = clock.nextLogical(
      { counter: 4, deviceId },
      { counter: 7, deviceId: observedDevice },
      deviceId,
    );
    expect(next.counter).toBe(8);
    expect(next.deviceId).toBe(deviceId);
    expect(clock.wallNow().unixMs).toBe(1_700_000_000_000);
  });

  it('seeded PRNG is deterministic', () => {
    const a = createSeededPrng(42);
    const b = createSeededPrng(42);
    expect(nextBase32Id(a)).toBe(nextBase32Id(b));
    expect(nextBase32Id(a)).toHaveLength(26);
  });
});
