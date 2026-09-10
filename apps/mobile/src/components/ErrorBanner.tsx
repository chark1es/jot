import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@jot/tokens/generated';
import type { SemanticPalette } from '@jot/ui-mobile';
import { editorBodySize, touchMin, uiFontFamily } from '../theme';

type Props = {
  readonly palette: SemanticPalette;
  readonly message: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
};

export function ErrorBanner({ palette, message, actionLabel, onAction }: Props) {
  return (
    <View style={[styles.box, { backgroundColor: palette.surface, borderColor: palette.error }]}>
      <Text style={[styles.text, { color: palette.error, fontFamily: uiFontFamily() }]}>{message}</Text>
      {actionLabel !== undefined && onAction !== undefined ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={styles.action}
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
    marginHorizontal: tokens.spacing.scale.space16,
    marginTop: tokens.spacing.scale.space8,
    padding: tokens.spacing.scale.space12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: tokens.radius.compact,
    gap: tokens.spacing.scale.space8,
  },
  text: {
    fontSize: editorBodySize,
  },
  action: {
    minHeight: touchMin,
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: editorBodySize,
    fontWeight: '600',
  },
});
