import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@jot/tokens/generated';
import type { SemanticPalette } from '@jot/ui-mobile';
import { editorBodySize, touchMin, uiFontFamily } from '../theme';

type Props = {
  readonly palette: SemanticPalette;
  readonly title: string;
  readonly leftLabel?: string;
  readonly onLeft?: () => void;
  readonly rightLabel?: string;
  readonly onRight?: () => void;
  readonly rightDisabled?: boolean;
};

export function AppHeader({
  palette,
  title,
  leftLabel,
  onLeft,
  rightLabel,
  onRight,
  rightDisabled,
}: Props) {
  return (
    <View style={[styles.row, { borderBottomColor: palette.hairline }]}>
      <View style={styles.side}>
        {leftLabel !== undefined && onLeft !== undefined ? (
          <Pressable
            onPress={onLeft}
            accessibilityRole="button"
            accessibilityLabel={leftLabel}
            hitSlop={tokens.spacing.scale.space8}
            style={styles.hit}
          >
            <Text style={[styles.action, { color: palette.accent, fontFamily: uiFontFamily() }]}>
              {leftLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Text
        style={[styles.title, { color: palette.ink, fontFamily: uiFontFamily() }]}
        numberOfLines={1}
        accessibilityRole="header"
      >
        {title}
      </Text>
      <View style={[styles.side, styles.sideRight]}>
        {rightLabel !== undefined && onRight !== undefined ? (
          <Pressable
            onPress={onRight}
            disabled={rightDisabled}
            accessibilityRole="button"
            accessibilityLabel={rightLabel}
            hitSlop={tokens.spacing.scale.space8}
            style={styles.hit}
          >
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
          </Pressable>
        ) : null}
      </View>
    </View>
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
    width: tokens.spacing.scale.space64 + tokens.spacing.scale.space16,
    justifyContent: 'center',
  },
  sideRight: {
    alignItems: 'flex-end',
  },
  hit: {
    minHeight: touchMin,
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: editorBodySize,
    fontWeight: '600',
  },
  action: {
    fontSize: editorBodySize,
    fontWeight: '500',
  },
});
