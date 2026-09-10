import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@jot/tokens/generated';
import type { ListMode, NoteSort, SemanticPalette } from '@jot/ui-mobile';
import { editorBodySize, touchMin, uiFontFamily } from '../theme';

const MODES: readonly { readonly id: ListMode; readonly label: string }[] = [
  { id: 'notes', label: 'Notes' },
  { id: 'archive', label: 'Archive' },
  { id: 'trash', label: 'Trash' },
];

const SORTS: readonly NoteSort[] = ['modified', 'created', 'title', 'manual'];

const SORT_LABEL: Record<NoteSort, string> = {
  modified: 'Modified',
  created: 'Created',
  title: 'Title',
  manual: 'Manual',
};

type Props = {
  readonly palette: SemanticPalette;
  readonly mode: ListMode;
  readonly sort: NoteSort;
  readonly onMode: (mode: ListMode) => void;
  readonly onCycleSort: () => void;
};

export function ListControls({ palette, mode, sort, onMode, onCycleSort }: Props) {
  return (
    <View style={[styles.wrap, { borderBottomColor: palette.hairline }]}>
      <View style={styles.modes}>
        {MODES.map((item) => {
          const selected = item.id === mode;
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                onMode(item.id);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={item.label}
              style={styles.mode}
            >
              <Text
                style={[
                  styles.modeLabel,
                  {
                    color: selected ? palette.ink : palette.inkMuted,
                    fontWeight: selected ? '600' : '400',
                    fontFamily: uiFontFamily(),
                  },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        onPress={onCycleSort}
        accessibilityRole="button"
        accessibilityLabel={`Sort by ${SORT_LABEL[sort]}`}
        style={styles.sort}
      >
        <Text style={[styles.sortLabel, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>
          {SORT_LABEL[sort]}
        </Text>
      </Pressable>
    </View>
  );
}

export function nextSort(sort: NoteSort): NoteSort {
  const index = SORTS.indexOf(sort);
  const next = SORTS[(index + 1) % SORTS.length];
  return next ?? 'modified';
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: tokens.spacing.scale.space16,
    minHeight: touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modes: {
    flexDirection: 'row',
    gap: tokens.spacing.scale.space16,
  },
  mode: {
    minHeight: touchMin,
    justifyContent: 'center',
  },
  modeLabel: {
    fontSize: editorBodySize,
  },
  sort: {
    minHeight: touchMin,
    justifyContent: 'center',
  },
  sortLabel: {
    fontSize: editorBodySize,
  },
});
