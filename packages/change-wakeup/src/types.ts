export type Brand<T, B extends string> = T & { readonly __brand: B };

/** 256-bit opaque topic, hex-encoded. */
export type OpaqueTopicId = Brand<string, 'OpaqueTopicId'>;

/** Vault enrollment capability. Authorizes notification routing only. */
export type EnrollmentCapability = Brand<string, 'EnrollmentCapability'>;

/** Per-device capability returned at registration. */
export type DeviceCapability = Brand<string, 'DeviceCapability'>;

export type ChannelId = Brand<string, 'ChannelId'>;

export type ChannelToken = Brand<string, 'ChannelToken'>;

export type CallbackUrl = Brand<string, 'CallbackUrl'>;

/** Monotonic dirty epoch. A wakeup is never proof of a remote change. */
export type DirtyEpoch = bigint;

export type NotificationPlatform = 'apns' | 'fcm' | 'desktop';

export type NotificationEndpoint = {
  readonly platform: NotificationPlatform;
  readonly encryptedEndpoint: Brand<string, 'EncryptedEndpoint'>;
};

export type DriveChannelPrep = {
  readonly channelId: ChannelId;
  readonly channelToken: ChannelToken;
  readonly callbackUrl: CallbackUrl;
};
