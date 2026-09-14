import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@jot/tokens/generated';
import type { SemanticPalette } from '@jot/ui-mobile';
import { pressedStyle, touchMin, typeSize, uiFontFamily } from '../theme';
import { Glyph, type GlyphName } from './Glyph';
import { GlassSurface } from './GlassSurface';

export type TitleAction = {
  readonly label: string;
  readonly glyph: GlyphName;
  readonly onPress: () => void;
  readonly disabled?: boolean;
};

type Props = {
  readonly palette: SemanticPalette;
  readonly title: string;
  readonly leading?: TitleAction;
  readonly trailing?: readonly TitleAction[];
};

export function LargeTitle({ palette, title, leading, trailing = [] }: Props) {
  const hasToolbar = leading !== undefined || trailing.length > 0;
  return (
    <View style={styles.wrap}>
      {hasToolbar ? (
        <View style={styles.toolbar}>
          {leading !== undefined ? (
            <GlassSurface palette={palette} style={styles.glassGroup}>
              <IconHit palette={palette} action={leading} />
            </GlassSurface>
          ) : (
            <View style={styles.slot} />
          )}
          <GlassSurface palette={palette} style={styles.glassGroup}>
            <View style={styles.trailing}>
              {trailing.map((action) => (
                <IconHit key={action.label} palette={palette} action={action} />
              ))}
            </View>
          </GlassSurface>
        </View>
      ) : (
        <View style={styles.spacer} />
      )}
      <Text
        style={[styles.title, { color: palette.ink, fontFamily: uiFontFamily() }]}
        numberOfLines={2}
        accessibilityRole="header"
      >
        {title}
      </Text>
    </View>
  );
}

function IconHit({ palette, action }: { readonly palette: SemanticPalette; readonly action: TitleAction }) {
  return (
    <Pressable
      onPress={action.onPress}
      disabled={action.disabled}
      accessibilityRole="button"
      accessibilityLabel={action.label}
      accessibilityState={{ disabled: action.disabled === true }}
      hitSlop={tokens.spacing.scale.space4}
      style={({ pressed }) => [styles.hit, pressedStyle(pressed)]}
    >
      <Glyph name={action.glyph} color={action.disabled === true ? palette.inkFaint : palette.accent} size={25} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: tokens.spacing.scale.space4,
  },
  toolbar: {
    minHeight: touchMin,
    paddingHorizontal: tokens.spacing.scale.space8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  glassGroup: {
    borderRadius: tokens.radius.pill,
  },
  spacer: {
    height: tokens.spacing.scale.space12,
  },
  title: {
    fontSize: typeSize.largeTitle,
    fontWeight: '700',
    letterSpacing: 0.37,
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingBottom: tokens.spacing.scale.space4,
  },
  slot: {
    minWidth: touchMin,
    minHeight: touchMin,
  },
  hit: {
    minHeight: touchMin,
    minWidth: touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
