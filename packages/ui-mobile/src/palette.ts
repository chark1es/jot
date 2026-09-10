import { tokens } from '@jot/tokens/generated';

export type ColorSchemeName = 'light' | 'dark';

export type SemanticPalette = (typeof tokens.color)[ColorSchemeName];

export function paletteForScheme(scheme: ColorSchemeName): SemanticPalette {
  return scheme === 'dark' ? tokens.color.dark : tokens.color.light;
}
