import {
  COLOR_ROLES,
  ELEVATION_ROLES,
  PLATFORMS,
  REQUIRED_FAMILIES,
  SYNC_STATUS_ROLES,
  type ColorRole,
  type ElevationKind,
  type ElevationRole,
  type ElevationRoleName,
  type SemanticColorPalette,
  type SpacingScale,
  type SyncStatusRole,
  type TokensDocument,
} from './types.js';

export {
  COLOR_ROLES,
  ELEVATION_ROLES,
  PLATFORMS,
  REQUIRED_FAMILIES,
  SYNC_STATUS_ROLES,
  type ColorRole,
  type ElevationKind,
  type ElevationRole,
  type ElevationRoleName,
  type Platform,
  type SemanticColorPalette,
  type SyncStatusRole,
  type TokensDocument,
} from './types.js';

const HEX = /^#[0-9a-f]{6}$/;

const COLOR_ROLE_SET: ReadonlySet<string> = new Set(COLOR_ROLES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`tokens.json ${path} must be an object`);
  }
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new Error(`tokens.json ${path} must be a string`);
  }
  return value;
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`tokens.json ${path} must be a finite number`);
  }
  return value;
}

function expectLiteral<T>(value: unknown, expected: T, path: string): T {
  if (value !== expected) {
    throw new Error(`tokens.json ${path} must be ${JSON.stringify(expected)}`);
  }
  return expected;
}

function expectKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
  const missing = keys.filter((key) => !(key in record));
  if (missing.length > 0) {
    throw new Error(
      `tokens.json ${path.length > 0 ? path : '<root>'} missing ${missing.join(', ')}`,
    );
  }
}

function parsePlatformStrings(
  value: unknown,
  path: string,
): { readonly apple: string; readonly android: string; readonly windows: string } {
  const record = expectRecord(value, path);
  expectKeys(record, PLATFORMS, path);
  const apple = expectString(record.apple, `${path}.apple`);
  const android = expectString(record.android, `${path}.android`);
  const windows = expectString(record.windows, `${path}.windows`);
  return { apple, android, windows };
}

function parseColorPalette(value: unknown, path: string): SemanticColorPalette {
  const record = expectRecord(value, path);
  expectKeys(record, COLOR_ROLES, path);
  const palette = {} as { -readonly [K in ColorRole]: string };
  for (const role of COLOR_ROLES) {
    const hex = expectString(record[role], `${path}.${role}`);
    if (!HEX.test(hex)) {
      throw new Error(`tokens.json ${path}.${role} must be a lowercase #rrggbb value`);
    }
    palette[role] = hex;
  }
  return palette;
}

function parseSpacingScale(value: unknown, path: string): SpacingScale {
  const record = expectRecord(value, path);
  return {
    space2: expectLiteral(record.space2, 2, `${path}.space2`),
    space4: expectLiteral(record.space4, 4, `${path}.space4`),
    space8: expectLiteral(record.space8, 8, `${path}.space8`),
    space12: expectLiteral(record.space12, 12, `${path}.space12`),
    space16: expectLiteral(record.space16, 16, `${path}.space16`),
    space24: expectLiteral(record.space24, 24, `${path}.space24`),
    space32: expectLiteral(record.space32, 32, `${path}.space32`),
    space48: expectLiteral(record.space48, 48, `${path}.space48`),
    space64: expectLiteral(record.space64, 64, `${path}.space64`),
  };
}

function parseElevationKind(value: unknown, path: string): ElevationKind {
  if (value === 'none' || value === 'separator' || value === 'elevated') {
    return value;
  }
  throw new Error(`tokens.json ${path} must be none, separator, or elevated`);
}

function parseElevationRole(value: unknown, path: string): ElevationRole {
  const record = expectRecord(value, path);
  return {
    kind: parseElevationKind(record.kind, `${path}.kind`),
    androidDp: expectNumber(record.androidDp, `${path}.androidDp`),
    cssLight: expectString(record.cssLight, `${path}.cssLight`),
    cssDark: expectString(record.cssDark, `${path}.cssDark`),
    osSemantic: parsePlatformStrings(record.osSemantic, `${path}.osSemantic`),
  };
}

function isColorRole(value: string): value is ColorRole {
  return COLOR_ROLE_SET.has(value);
}

function parseColorRole(value: unknown, path: string): ColorRole {
  const role = expectString(value, path);
  if (!isColorRole(role)) {
    throw new Error(`tokens.json ${path} is not a color role`);
  }
  return role;
}

function parseEasing(value: unknown, path: string): readonly [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error(`tokens.json ${path} must be a 4-number array`);
  }
  const x1 = expectNumber(value[0], `${path}[0]`);
  const y1 = expectNumber(value[1], `${path}[1]`);
  const x2 = expectNumber(value[2], `${path}[2]`);
  const y2 = expectNumber(value[3], `${path}[3]`);
  return [x1, y1, x2, y2];
}

export function parseTokens(jsonText: string): TokensDocument {
  const parsed: unknown = JSON.parse(jsonText) as unknown;
  const root = expectRecord(parsed, '');
  expectKeys(root, REQUIRED_FAMILIES, '');

  const type = expectRecord(root.type, 'type');
  const ui = expectRecord(type.ui, 'type.ui');
  const editor = expectRecord(type.editor, 'type.editor');
  const editorBody = expectRecord(editor.body, 'type.editor.body');
  const uiFontFamily = parsePlatformStrings(ui.fontFamily, 'type.ui.fontFamily');
  expectLiteral(uiFontFamily.apple, 'SF Pro', 'type.ui.fontFamily.apple');
  expectLiteral(uiFontFamily.android, 'Roboto', 'type.ui.fontFamily.android');
  expectLiteral(uiFontFamily.windows, 'Segoe UI', 'type.ui.fontFamily.windows');
  const uiSize = expectRecord(ui.size, 'type.ui.size');

  const spacing = expectRecord(root.spacing, 'spacing');
  const editorSpacing = expectRecord(spacing.editor, 'spacing.editor');
  const color = expectRecord(root.color, 'color');
  const radius = expectRecord(root.radius, 'radius');
  const elevationRoot = expectRecord(root.elevation, 'elevation');
  const motion = expectRecord(root.motion, 'motion');
  const duration = expectRecord(motion.duration, 'motion.duration');
  const easing = expectRecord(motion.easing, 'motion.easing');
  const reducedMotion = expectRecord(motion.reducedMotion, 'motion.reducedMotion');
  const syncStatusRoot = expectRecord(root.syncStatus, 'syncStatus');

  const elevation = {} as { -readonly [K in ElevationRoleName]: ElevationRole };
  for (const name of ELEVATION_ROLES) {
    elevation[name] = parseElevationRole(elevationRoot[name], `elevation.${name}`);
  }

  const syncStatus = {} as {
    -readonly [K in SyncStatusRole]: { readonly colorRole: ColorRole };
  };
  for (const name of SYNC_STATUS_ROLES) {
    const entry = expectRecord(syncStatusRoot[name], `syncStatus.${name}`);
    syncStatus[name] = {
      colorRole: parseColorRole(entry.colorRole, `syncStatus.${name}.colorRole`),
    };
  }

  return {
    type: {
      ui: {
        fontFamily: uiFontFamily,
        size: {
          largeTitle: expectLiteral(uiSize.largeTitle, 34, 'type.ui.size.largeTitle'),
          title: expectLiteral(uiSize.title, 17, 'type.ui.size.title'),
          body: expectLiteral(uiSize.body, 17, 'type.ui.size.body'),
          subhead: expectLiteral(uiSize.subhead, 15, 'type.ui.size.subhead'),
          footnote: expectLiteral(uiSize.footnote, 13, 'type.ui.size.footnote'),
          caption: expectLiteral(uiSize.caption, 12, 'type.ui.size.caption'),
          desktop: expectLiteral(uiSize.desktop, 13, 'type.ui.size.desktop'),
          desktopSecondary: expectLiteral(
            uiSize.desktopSecondary,
            11,
            'type.ui.size.desktopSecondary',
          ),
        },
      },
      editor: {
        fontFamily: parsePlatformStrings(editor.fontFamily, 'type.editor.fontFamily'),
        body: {
          size: expectLiteral(editorBody.size, 17, 'type.editor.body.size'),
          desktopLineHeight: expectLiteral(
            editorBody.desktopLineHeight,
            1.6,
            'type.editor.body.desktopLineHeight',
          ),
          desktopMeasure: expectLiteral(
            editorBody.desktopMeasure,
            '72ch',
            'type.editor.body.desktopMeasure',
          ),
        },
      },
    },
    spacing: {
      base: expectLiteral(spacing.base, 4, 'spacing.base'),
      scale: parseSpacingScale(spacing.scale, 'spacing.scale'),
      editor: {
        paragraphGap: expectNumber(editorSpacing.paragraphGap, 'spacing.editor.paragraphGap'),
        headingBefore: expectNumber(editorSpacing.headingBefore, 'spacing.editor.headingBefore'),
        headingAfter: expectNumber(editorSpacing.headingAfter, 'spacing.editor.headingAfter'),
        listItemGap: expectNumber(editorSpacing.listItemGap, 'spacing.editor.listItemGap'),
        listIndent: expectNumber(editorSpacing.listIndent, 'spacing.editor.listIndent'),
      },
    },
    color: {
      light: parseColorPalette(color.light, 'color.light'),
      dark: parseColorPalette(color.dark, 'color.dark'),
    },
    radius: {
      compact: expectLiteral(radius.compact, 4, 'radius.compact'),
      control: expectLiteral(radius.control, 8, 'radius.control'),
      sheet: expectLiteral(radius.sheet, 12, 'radius.sheet'),
      pill: expectLiteral(radius.pill, 9999, 'radius.pill'),
    },
    elevation,
    motion: {
      duration: {
        fast: expectLiteral(duration.fast, 120, 'motion.duration.fast'),
        standard: expectLiteral(duration.standard, 180, 'motion.duration.standard'),
        deliberate: expectLiteral(duration.deliberate, 260, 'motion.duration.deliberate'),
      },
      easing: {
        standard: parseEasing(easing.standard, 'motion.easing.standard'),
      },
      reducedMotion: {
        honorPrefersReducedMotion: expectLiteral(
          reducedMotion.honorPrefersReducedMotion,
          true,
          'motion.reducedMotion.honorPrefersReducedMotion',
        ),
        spatialTravel: expectLiteral(
          reducedMotion.spatialTravel,
          false,
          'motion.reducedMotion.spatialTravel',
        ),
      },
    },
    syncStatus,
  };
}

export function collectOsSemanticValues(tokens: TokensDocument): readonly string[] {
  const names = new Set<string>();
  for (const role of ELEVATION_ROLES) {
    const os = tokens.elevation[role].osSemantic;
    for (const platform of PLATFORMS) {
      names.add(os[platform]);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
