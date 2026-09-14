import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@jot/tokens/generated';
import type { SemanticPalette } from '@jot/ui-mobile';
import { pressedStyle, touchMin, typeSize, uiFontFamily } from '../theme';
import { Glyph } from './Glyph';
import { GlassSurface } from './GlassSurface';

type Props = {
  readonly palette: SemanticPalette;
  readonly title: string;
  readonly leftLabel?: string;
  readonly leftGlyph?: 'back' | 'folders';
  readonly onLeft?: () => void;
  readonly rightLabel?: string;
  readonly rightGlyph?: 'new';
  readonly onRight?: () => void;
  readonly rightDisabled?: boolean;
};

export function AppHeader({
  palette,
  title,
  leftLabel,
  leftGlyph,
  onLeft,
  rightLabel,
  rightGlyph,
  onRight,
  rightDisabled,
}: Props) {
  return (
    <GlassSurface palette={palette} style={[styles.row, { borderBottomColor: palette.hairline }]}>
      <View style={styles.side}>
        {leftLabel !== undefined && onLeft !== undefined ? (
          <Pressable
            onPress={onLeft}
            accessibilityRole="button"
            accessibilityLabel={leftLabel}
            hitSlop={tokens.spacing.scale.space8}
            style={({ pressed }) => [styles.hit, styles.hitLeading, pressedStyle(pressed)]}
          >
            {leftGlyph !== undefined ? <Glyph name={leftGlyph} color={palette.accent} /> : null}
            {leftGlyph === 'back' || leftGlyph === undefined ? (
              <Text style={[styles.action, { color: palette.accent, fontFamily: uiFontFamily() }]}>
                {leftLabel}
              </Text>
            ) : null}
          </Pressable>
        ) : null}
      </View>
      {title.length > 0 ? (
        <Text
          style={[styles.title, { color: palette.ink, fontFamily: uiFontFamily() }]}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {title}
        </Text>
      ) : (
        <View style={styles.title} />
      )}
      <View style={[styles.side, styles.sideRight]}>
        {rightLabel !== undefined && onRight !== undefined ? (
          <Pressable
            onPress={onRight}
            disabled={rightDisabled}
            accessibilityRole="button"
            accessibilityLabel={rightLabel}
            hitSlop={tokens.spacing.scale.space8}
            style={({ pressed }) => [styles.hit, styles.hitTrailing, pressedStyle(pressed)]}
          >
            {rightGlyph === 'new' ? (
              <Glyph name="new" color={rightDisabled === true ? palette.inkFaint : palette.accent} />
            ) : (
              <Text
                style={[
                  styles.action,
                  {
                    color: rightDisabled === true ? palette.inkFaint : palette.accent,
                    fontFamily: uiFontFamily(),
                  },
                ]}
              >
                {rightLabel}
              </Text>
            )}
          </Pressable>
        ) : null}
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: touchMin,
    paddingHorizontal: tokens.spacing.scale.space16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: {
    flex: 1,
    minWidth: touchMin,
    justifyContent: 'center',
  },
  sideRight: {
    alignItems: 'flex-end',
  },
  hit: {
    minHeight: touchMin,
    minWidth: touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.scale.space4,
  },
  hitLeading: {
    alignSelf: 'flex-start',
  },
  hitTrailing: {
    alignSelf: 'flex-end',
    justifyContent: 'flex-end',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: typeSize.title,
    fontWeight: '600',
  },
  action: {
    fontSize: typeSize.body,
    fontWeight: '500',
  },
});
