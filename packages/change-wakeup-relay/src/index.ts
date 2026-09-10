import type { ChangeWakeup } from '@jot/change-wakeup';

export class RelayNotConfiguredError extends Error {
  override readonly name = 'RelayNotConfiguredError';
}

export type RelayClientConfig = {
  readonly baseUrl: string;
  readonly timeoutMs: number;
};

class UnconfiguredRelayChangeWakeup implements ChangeWakeup {
  constructor(private readonly baseUrl: string) {}

  registerDevice(): Promise<never> {
    return Promise.reject(
      new RelayNotConfiguredError(
        `Relay is not configured (${this.baseUrl}); registerDevice cannot run`,
      ),
    );
  }

  prepareDriveChannel(): Promise<never> {
    return Promise.reject(
      new RelayNotConfiguredError(
        `Relay is not configured (${this.baseUrl}); prepareDriveChannel cannot run`,
      ),
    );
  }

  observeDirtyEpoch(): Promise<never> {
    return Promise.reject(
      new RelayNotConfiguredError(
        `Relay is not configured (${this.baseUrl}); observeDirtyEpoch cannot run`,
      ),
    );
  }
}

export function createRelayChangeWakeup(config: RelayClientConfig): ChangeWakeup {
  return new UnconfiguredRelayChangeWakeup(config.baseUrl);
}
