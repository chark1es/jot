import { Platform, useColorScheme } from 'react-native';
import { tokens } from '@jot/tokens/generated';
import { paletteForScheme, type SemanticPalette } from '@jot/ui-mobile';

export function usePalette(): SemanticPalette {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return paletteForScheme(scheme);
}

export function uiFontFamily(): string | undefined {
  return Platform.select({
    ios: tokens.type.ui.fontFamily.apple,
    android: tokens.type.ui.fontFamily.android,
    default: tokens.type.ui.fontFamily.windows,
  });
}

export function editorFontFamily(): string | undefined {
  return Platform.select({
    ios: tokens.type.editor.fontFamily.apple,
    android: tokens.type.editor.fontFamily.android,
    default: tokens.type.editor.fontFamily.windows,
  });
}

export const typeSize = tokens.type.ui.size;
export const touchMin = tokens.spacing.scale.space48;
export const editorBodySize = tokens.type.editor.body.size;

export function pressedStyle(pressed: boolean): { opacity: number } {
  return { opacity: pressed ? 0.58 : 1 };
}
