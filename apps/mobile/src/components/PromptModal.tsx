import { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetMethods,
} from '@expo/ui/community/bottom-sheet';
import { tokens } from '@jot/tokens/generated';
import type { SemanticPalette } from '@jot/ui-mobile';
import { pressedStyle, touchMin, typeSize, uiFontFamily } from '../theme';

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
  const sheetRef = useRef<BottomSheetMethods>(null);
  const dismiss = useCallback(() => {
    sheetRef.current?.close();
  }, []);

  return (
    <BottomSheet
      ref={sheetRef}
      index={visible ? 0 : -1}
      enableDynamicSizing
      enablePanDownToClose
      keyboardBehavior="interactive"
      backgroundStyle={{ backgroundColor: palette.surface }}
      onClose={onCancel}
    >
      <BottomSheetView style={styles.sheet}>
        <Text style={[styles.title, { color: palette.ink, fontFamily: uiFontFamily() }]}>
          {title}
        </Text>
        <BottomSheetTextInput
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
              fontSize: typeSize.body,
            },
          ]}
        />
        <View style={[styles.actions, { borderTopColor: palette.hairline }]}>
          <Pressable
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={({ pressed }) => [styles.hit, pressedStyle(pressed)]}
          >
            <Text style={[styles.action, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>
              Cancel
            </Text>
          </Pressable>
          <View style={[styles.actionSplit, { backgroundColor: palette.hairline }]} />
          <Pressable
            onPress={onConfirm}
            accessibilityRole="button"
            accessibilityLabel={confirmLabel}
            style={({ pressed }) => [styles.hit, pressedStyle(pressed)]}
          >
            <Text
              style={[
                styles.action,
                styles.confirm,
                { color: palette.accent, fontFamily: uiFontFamily() },
              ]}
            >
              {confirmLabel}
            </Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    width: '100%',
    paddingTop: tokens.spacing.scale.space16,
  },
  title: {
    fontSize: typeSize.title,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: tokens.spacing.scale.space16,
  },
  input: {
    minHeight: touchMin,
    marginHorizontal: tokens.spacing.scale.space16,
    marginTop: tokens.spacing.scale.space12,
    marginBottom: tokens.spacing.scale.space8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: tokens.radius.control,
    paddingHorizontal: tokens.spacing.scale.space12,
  },
  actions: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  hit: {
    flex: 1,
    minHeight: touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionSplit: {
    width: StyleSheet.hairlineWidth,
  },
  action: {
    fontSize: typeSize.body,
    fontWeight: '500',
  },
  confirm: {
    fontWeight: '600',
  },
});
