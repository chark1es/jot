import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { tokens } from '@jot/tokens/generated';
import type { SemanticPalette } from '@jot/ui-mobile';
import { editorBodySize, touchMin, uiFontFamily } from '../theme';

type Props = {
  readonly palette: SemanticPalette;
  readonly visible: boolean;
  readonly title: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly keyboardType?: 'default' | 'url';
  readonly autoCapitalize?: 'none' | 'sentences';
};

export function PromptModal({
  palette,
  visible,
  title,
  placeholder,
  value,
  onChange,
  confirmLabel,
  onConfirm,
  onCancel,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
          <Text style={[styles.title, { color: palette.ink, fontFamily: uiFontFamily() }]}>{title}</Text>
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={palette.inkFaint}
            autoFocus
            autoCapitalize={autoCapitalize}
            autoCorrect={false}
            keyboardType={keyboardType}
            accessibilityLabel={title}
            style={[
              styles.input,
              {
                color: palette.ink,
                borderColor: palette.hairline,
                backgroundColor: palette.canvas,
                fontFamily: uiFontFamily(),
                fontSize: editorBodySize,
              },
            ]}
          />
          <View style={styles.actions}>
            <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel" style={styles.hit}>
              <Text style={[styles.action, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              style={styles.hit}
            >
              <Text style={[styles.action, { color: palette.accent, fontFamily: uiFontFamily() }]}>
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: tokens.spacing.scale.space24,
    backgroundColor: tokens.color.dark.canvas,
  },
  sheet: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: tokens.radius.sheet,
    padding: tokens.spacing.scale.space16,
    gap: tokens.spacing.scale.space12,
  },
  title: {
    fontSize: editorBodySize,
    fontWeight: '600',
  },
  input: {
    minHeight: touchMin,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: tokens.radius.control,
    paddingHorizontal: tokens.spacing.scale.space12,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: tokens.spacing.scale.space16,
  },
  hit: {
    minHeight: touchMin,
    justifyContent: 'center',
  },
  action: {
    fontSize: editorBodySize,
    fontWeight: '600',
  },
});
