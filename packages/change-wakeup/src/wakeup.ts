import type {
  DeviceCapability,
  DirtyEpoch,
  DriveChannelPrep,
  EnrollmentCapability,
  NotificationEndpoint,
  OpaqueTopicId,
} from './types.js';

/**
 * Content-blind wakeup seam. Carries no User content and is not a commit path.
 * Deleting the Relay leaves every Vault recoverable from local state and remote objects.
 */
export interface ChangeWakeup {
  registerDevice(
    opaqueTopic: OpaqueTopicId,
    enrollmentCapability: EnrollmentCapability,
    notificationEndpoint: NotificationEndpoint,
  ): Promise<DeviceCapability>;

  prepareDriveChannel(
    opaqueTopic: OpaqueTopicId,
    deviceCapability: DeviceCapability,
  ): Promise<DriveChannelPrep>;

  observeDirtyEpoch(
    opaqueTopic: OpaqueTopicId,
    afterEpoch: DirtyEpoch,
    deviceCapability: DeviceCapability,
    abortSignal: AbortSignal,
  ): Promise<DirtyEpoch>;
}
