import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@jot/tokens/generated';
import type { SemanticPalette } from '@jot/ui-mobile';
import { pressedStyle, touchMin, typeSize, uiFontFamily } from '../theme';

type Props = {
  readonly palette: SemanticPalette;
  readonly message: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
};

export function ErrorBanner({ palette, message, actionLabel, onAction }: Props) {
  return (
    <View
      style={[
        styles.box,
        { backgroundColor: palette.surface, borderBottomColor: palette.hairline },
      ]}
    >
      <Text style={[styles.text, { color: palette.error, fontFamily: uiFontFamily() }]}>{message}</Text>
      {actionLabel !== undefined && onAction !== undefined ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [styles.action, pressedStyle(pressed)]}
        >
          <Text style={[styles.actionLabel, { color: palette.accent, fontFamily: uiFontFamily() }]}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingVertical: tokens.spacing.scale.space12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: tokens.spacing.scale.space4,
  },
  text: {
    fontSize: typeSize.subhead,
  },
  action: {
    minHeight: touchMin,
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: typeSize.subhead,
    fontWeight: '600',
  },
});
