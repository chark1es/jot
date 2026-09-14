import { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import BottomSheet, {
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetMethods,
} from '@expo/ui/community/bottom-sheet';
import { tokens } from '@jot/tokens/generated';
import type { SemanticPalette } from '@jot/ui-mobile';
import { pressedStyle, touchMin, typeSize, uiFontFamily } from '../theme';
import { Glyph } from './Glyph';

export type ActionItem = {
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
  readonly destructive?: boolean;
  readonly selected?: boolean;
  /** Keeps the sheet open, for pickers that toggle several rows. */
  readonly keepOpen?: boolean;
  readonly onPress: () => void;
};

type Props = {
  readonly palette: SemanticPalette;
  readonly visible: boolean;
  readonly title: string;
  readonly message?: string;
  readonly actions: readonly ActionItem[];
  /** Pickers read better with leading labels; short command lists stay centered. */
  readonly align?: 'center' | 'leading';
  readonly cancelLabel?: string;
  readonly onClose: () => void;
};

export function ActionSheet({
  palette,
  visible,
  title,
  message,
  actions,
  align = 'center',
  cancelLabel = 'Cancel',
  onClose,
}: Props) {
  const sheetRef = useRef<BottomSheetMethods>(null);
  const pendingAction = useRef<(() => void) | null>(null);
  const { height } = useWindowDimensions();
  const leading = align === 'leading';

  const dismiss = useCallback(() => {
    sheetRef.current?.close();
  }, []);

  const finishDismiss = useCallback(() => {
    onClose();
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  }, [onClose]);

  return (
    <BottomSheet
      ref={sheetRef}
      index={visible ? 0 : -1}
      enableDynamicSizing
      enablePanDownToClose
      backgroundStyle={{ backgroundColor: palette.surface }}
      onClose={finishDismiss}
    >
      <BottomSheetView style={styles.content}>
        <View style={styles.sheet}>
          {title.length > 0 || message !== undefined ? (
            <View style={styles.header}>
              {title.length > 0 ? (
                <Text
                  numberOfLines={2}
                  style={[styles.title, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}
                >
                  {title}
                </Text>
              ) : null}
              {message !== undefined ? (
                <Text
                  style={[styles.message, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}
                >
                  {message}
                </Text>
              ) : null}
            </View>
          ) : null}
          <BottomSheetScrollView
            bounces={false}
            style={[styles.list, { maxHeight: height * 0.62 }]}
          >
            {actions.map((action) => (
              <Pressable
                key={action.key}
                onPress={() => {
                  if (action.keepOpen === true) {
                    action.onPress();
                    return;
                  }
                  pendingAction.current = action.onPress;
                  dismiss();
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  action.detail === undefined ? action.label : `${action.label}, ${action.detail}`
                }
                accessibilityState={
                  action.selected === undefined ? undefined : { selected: action.selected }
                }
                style={({ pressed }) => [
                  styles.row,
                  leading ? styles.rowLeading : null,
                  { borderTopColor: palette.hairline },
                  pressedStyle(pressed),
                ]}
              >
                <View style={leading ? styles.rowText : styles.rowTextCentered}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.label,
                      leading ? styles.labelLeading : null,
                      {
                        color: action.destructive === true ? palette.error : palette.ink,
                        fontFamily: uiFontFamily(),
                      },
                    ]}
                  >
                    {action.label}
                  </Text>
                  {action.detail !== undefined ? (
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.detail,
                        leading ? styles.labelLeading : null,
                        { color: palette.inkMuted, fontFamily: uiFontFamily() },
                      ]}
                    >
                      {action.detail}
                    </Text>
                  ) : null}
                </View>
                {action.selected === true ? (
                  <Glyph name="check" color={palette.accent} size={20} />
                ) : null}
              </Pressable>
            ))}
          </BottomSheetScrollView>
        </View>
        <Pressable
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          style={({ pressed }) => [
            styles.cancel,
            { borderTopColor: palette.hairline },
            pressedStyle(pressed),
          ]}
        >
          <Text style={[styles.cancelLabel, { color: palette.accent, fontFamily: uiFontFamily() }]}>
            {cancelLabel}
          </Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    width: '100%',
  },
  sheet: {
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingVertical: tokens.spacing.scale.space12,
    gap: tokens.spacing.scale.space4,
  },
  title: {
    fontSize: typeSize.footnote,
    fontWeight: '600',
    textAlign: 'center',
  },
  message: {
    fontSize: typeSize.footnote,
    textAlign: 'center',
  },
  list: {
    flexGrow: 0,
  },
  row: {
    minHeight: touchMin + tokens.spacing.scale.space4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingVertical: tokens.spacing.scale.space8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: tokens.spacing.scale.space8,
  },
  rowLeading: {
    justifyContent: 'space-between',
  },
  rowText: {
    flex: 1,
    gap: tokens.spacing.scale.space2,
  },
  rowTextCentered: {
    alignItems: 'center',
    gap: tokens.spacing.scale.space2,
  },
  label: {
    fontSize: typeSize.body,
    textAlign: 'center',
  },
  labelLeading: {
    textAlign: 'left',
  },
  detail: {
    fontSize: typeSize.footnote,
    textAlign: 'center',
  },
  cancel: {
    minHeight: touchMin + tokens.spacing.scale.space4,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelLabel: {
    fontSize: typeSize.body,
    fontWeight: '600',
  },
});
