import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@jot/tokens/generated';
import type { SemanticPalette } from '@jot/ui-mobile';
import { editorBodySize, touchMin, uiFontFamily } from '../theme';

export type ActionItem = {
  readonly key: string;
  readonly label: string;
  readonly destructive?: boolean;
  readonly onPress: () => void;
};

type Props = {
  readonly palette: SemanticPalette;
  readonly visible: boolean;
  readonly title: string;
  readonly actions: readonly ActionItem[];
  readonly onClose: () => void;
};

export function ActionSheet({ palette, visible, title, actions, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.frame}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
        <Text style={[styles.title, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>{title}</Text>
        {actions.map((action) => (
          <Pressable
            key={action.key}
            onPress={() => {
              onClose();
              action.onPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            style={[styles.row, { borderTopColor: palette.hairline }]}
          >
            <Text
              style={[
                styles.label,
                {
                  color: action.destructive === true ? palette.error : palette.ink,
                  fontFamily: uiFontFamily(),
                },
              ]}
            >
              {action.label}
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          style={[styles.row, { borderTopColor: palette.hairline }]}
        >
          <Text style={[styles.label, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>Cancel</Text>
        </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: tokens.color.dark.canvas,
  },
  sheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: tokens.spacing.scale.space16,
  },
  title: {
    fontSize: editorBodySize,
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingVertical: tokens.spacing.scale.space12,
  },
  row: {
    minHeight: touchMin,
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing.scale.space16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  label: {
    fontSize: editorBodySize,
  },
});
