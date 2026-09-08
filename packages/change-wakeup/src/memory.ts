import type { ChangeWakeup } from './wakeup.js';
import type {
  Brand,
  DeviceCapability,
  DirtyEpoch,
  DriveChannelPrep,
  EnrollmentCapability,
  NotificationEndpoint,
  OpaqueTopicId,
} from './types.js';

type TopicState = {
  enrollment: EnrollmentCapability;
  epoch: DirtyEpoch;
  devices: Map<DeviceCapability, NotificationEndpoint>;
  waiters: Array<() => void>;
};

function hexPad(seq: number): string {
  return seq.toString(16).padStart(64, '0');
}

/**
 * In-process ChangeWakeup for tests. Deterministic IDs. No network.
 */
export class MemoryChangeWakeup implements ChangeWakeup {
  private seq = 0;
  private readonly topics = new Map<OpaqueTopicId, TopicState>();

  private nextHex<B extends string>(): Brand<string, B> {
    this.seq += 1;
    return hexPad(this.seq) as Brand<string, B>;
  }

  private topic(id: OpaqueTopicId, enrollment: EnrollmentCapability | null): TopicState {
    const existing = this.topics.get(id);
    if (existing) {
      if (enrollment !== null && existing.enrollment !== enrollment) {
        throw new Error('enrollment capability mismatch');
      }
      return existing;
    }
    if (enrollment === null) {
      throw new Error('unknown topic');
    }
    const created: TopicState = {
      enrollment,
      epoch: 0n,
      devices: new Map(),
      waiters: [],
    };
    this.topics.set(id, created);
    return created;
  }

  registerDevice(
    opaqueTopic: OpaqueTopicId,
    enrollmentCapability: EnrollmentCapability,
    notificationEndpoint: NotificationEndpoint,
  ): Promise<DeviceCapability> {
    const state = this.topic(opaqueTopic, enrollmentCapability);
    const cap = this.nextHex<'DeviceCapability'>();
    state.devices.set(cap, notificationEndpoint);
    return Promise.resolve(cap);
  }

  prepareDriveChannel(
    opaqueTopic: OpaqueTopicId,
    deviceCapability: DeviceCapability,
  ): Promise<DriveChannelPrep> {
    const state = this.topic(opaqueTopic, null);
    if (!state.devices.has(deviceCapability)) {
      throw new Error('unknown device capability');
    }
    return Promise.resolve({
      channelId: this.nextHex<'ChannelId'>(),
      channelToken: this.nextHex<'ChannelToken'>(),
      callbackUrl: `https://relay.invalid/push/${hexPad(this.seq)}` as Brand<string, 'CallbackUrl'>,
    });
  }

  observeDirtyEpoch(
    opaqueTopic: OpaqueTopicId,
    afterEpoch: DirtyEpoch,
    deviceCapability: DeviceCapability,
    abortSignal: AbortSignal,
  ): Promise<DirtyEpoch> {
    const state = this.topic(opaqueTopic, null);
    if (!state.devices.has(deviceCapability)) {
      return Promise.reject(new Error('unknown device capability'));
    }

    if (state.epoch > afterEpoch) {
      return Promise.resolve(state.epoch);
    }

    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        cleanup();
        reject(new Error('aborted'));
      };
      const onBump = (): void => {
        if (state.epoch > afterEpoch) {
          cleanup();
          resolve(state.epoch);
        }
      };
      const cleanup = (): void => {
        abortSignal.removeEventListener('abort', onAbort);
        state.waiters = state.waiters.filter((waiter) => waiter !== onBump);
      };
      if (abortSignal.aborted) {
        onAbort();
        return;
      }
      abortSignal.addEventListener('abort', onAbort);
      state.waiters.push(onBump);
    });
  }

  /** Test helper: advance the topic epoch and wake observers. */
  markDirty(opaqueTopic: OpaqueTopicId): DirtyEpoch {
    const state = this.topics.get(opaqueTopic);
    if (!state) {
      throw new Error('unknown topic');
    }
    state.epoch += 1n;
    const waiters = [...state.waiters];
    for (const waiter of waiters) {
      waiter();
    }
    return state.epoch;
  }
}
