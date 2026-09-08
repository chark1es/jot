export const REQUIRED_FAMILIES = [
  'type',
  'spacing',
  'color',
  'radius',
  'elevation',
  'motion',
  'syncStatus',
] as const;

export type TokenFamily = (typeof REQUIRED_FAMILIES)[number];

export const COLOR_ROLES = [
  'canvas',
  'surface',
  'ink',
  'inkMuted',
  'inkFaint',
  'hairline',
  'accent',
  'accentMuted',
  'error',
  'warning',
  'success',
  'selection',
  'focus',
  'link',
  'sync',
] as const;

export type ColorRole = (typeof COLOR_ROLES)[number];

export const SYNC_STATUS_ROLES = [
  'localOnly',
  'synced',
  'pending',
  'syncing',
  'offline',
  'retry',
  'authRequired',
  'upgradeRequired',
  'error',
] as const;

export type SyncStatusRole = (typeof SYNC_STATUS_ROLES)[number];

export const ELEVATION_ROLES = ['flat', 'hairline', 'menu', 'sheet', 'drag'] as const;

export type ElevationRoleName = (typeof ELEVATION_ROLES)[number];

export const PLATFORMS = ['apple', 'android', 'windows'] as const;

export type Platform = (typeof PLATFORMS)[number];

export interface PlatformFontFamily {
  readonly apple: string;
  readonly android: string;
  readonly windows: string;
}

export interface EditorBodyTokens {
  readonly size: 17;
  readonly desktopLineHeight: 1.6;
  readonly desktopMeasure: '72ch';
}

export interface TypeTokens {
  readonly ui: {
    readonly fontFamily: PlatformFontFamily;
  };
  readonly editor: {
    readonly fontFamily: PlatformFontFamily;
    readonly body: EditorBodyTokens;
  };
}

export interface SpacingScale {
  readonly space2: 2;
  readonly space4: 4;
  readonly space8: 8;
  readonly space12: 12;
  readonly space16: 16;
  readonly space24: 24;
  readonly space32: 32;
  readonly space48: 48;
  readonly space64: 64;
}

export interface EditorSpacing {
  readonly paragraphGap: number;
  readonly headingBefore: number;
  readonly headingAfter: number;
  readonly listItemGap: number;
  readonly listIndent: number;
}

export interface SpacingTokens {
  readonly base: 4;
  readonly scale: SpacingScale;
  readonly editor: EditorSpacing;
}

export type SemanticColorPalette = {
  readonly [K in ColorRole]: string;
};

export interface ColorTokens {
  readonly light: SemanticColorPalette;
  readonly dark: SemanticColorPalette;
}

export interface RadiusTokens {
  readonly compact: 4;
  readonly control: 8;
  readonly sheet: 12;
  readonly pill: 9999;
}

export type ElevationKind = 'none' | 'separator' | 'elevated';

export interface ElevationRole {
  readonly kind: ElevationKind;
  readonly androidDp: number;
  readonly cssLight: string;
  readonly cssDark: string;
  readonly osSemantic: PlatformFontFamily;
}

export type ElevationTokens = {
  readonly [K in ElevationRoleName]: ElevationRole;
};

export interface MotionTokens {
  readonly duration: {
    readonly fast: 120;
    readonly standard: 180;
    readonly deliberate: 260;
  };
  readonly easing: {
    readonly standard: readonly [number, number, number, number];
  };
  readonly reducedMotion: {
    readonly honorPrefersReducedMotion: true;
    readonly spatialTravel: false;
  };
}

export type SyncStatusTokens = {
  readonly [K in SyncStatusRole]: {
    readonly colorRole: ColorRole;
  };
};

export interface TokensDocument {
  readonly type: TypeTokens;
  readonly spacing: SpacingTokens;
  readonly color: ColorTokens;
  readonly radius: RadiusTokens;
  readonly elevation: ElevationTokens;
  readonly motion: MotionTokens;
  readonly syncStatus: SyncStatusTokens;
}
