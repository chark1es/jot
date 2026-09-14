import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@jot/tokens/generated';
import type { ListMode, NoteSort, SemanticPalette } from '@jot/ui-mobile';
import { pressedStyle, touchMin, typeSize, uiFontFamily } from '../theme';
import { GlassSurface } from './GlassSurface';

const MODES: readonly { readonly id: ListMode; readonly label: string }[] = [
  { id: 'notes', label: 'Notes' },
  { id: 'archive', label: 'Archive' },
  { id: 'trash', label: 'Trash' },
];

export const SORTS: readonly NoteSort[] = ['modified', 'created', 'title', 'manual'];

export const SORT_LABEL: Record<NoteSort, string> = {
  modified: 'Date edited',
  created: 'Date created',
  title: 'Title',
  manual: 'Custom order',
};

type Props = {
  readonly palette: SemanticPalette;
  readonly mode: ListMode;
  readonly onMode: (mode: ListMode) => void;
};

/** A segmented control: one choice among three views of the same notes. */
export function ListControls({ palette, mode, onMode }: Props) {
  return (
    <View style={styles.wrap}>
      <GlassSurface palette={palette} style={[styles.control, { borderColor: palette.hairline }]}>
        {MODES.map((item) => {
          const selected = item.id === mode;
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                onMode(item.id);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.segment,
                selected ? { backgroundColor: palette.accentMuted } : null,
                pressedStyle(pressed),
              ]}
            >
              <Text
                style={[
                  styles.label,
                  selected ? styles.labelSelected : null,
                  { color: selected ? palette.ink : palette.inkMuted, fontFamily: uiFontFamily() },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingTop: tokens.spacing.scale.space4,
    paddingBottom: tokens.spacing.scale.space8,
  },
  control: {
    width: '100%',
    minHeight: touchMin,
    borderRadius: tokens.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    padding: tokens.spacing.scale.space4,
    flexDirection: 'row',
  },
  segment: {
    flex: 1,
    minHeight: touchMin,
    borderRadius: tokens.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: typeSize.subhead,
    fontWeight: '500',
  },
  labelSelected: {
    fontWeight: '700',
  },
});
