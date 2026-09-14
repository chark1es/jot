import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { tokens } from '@jot/tokens/generated';
import {
  buildFolderTree,
  flattenFolderTree,
  visibleNotes,
  type ListMode,
  type NoteSort,
  type SemanticPalette,
} from '@jot/ui-mobile';
import type { FolderId, TagId } from '@jot/schema';
import { ActionSheet, type ActionItem } from '../../src/components/ActionSheet';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { Glyph, type GlyphName } from '../../src/components/Glyph';
import { LargeTitle } from '../../src/components/LargeTitle';
import { ListControls, SORT_LABEL, SORTS } from '../../src/components/ListControls';
import { snippetFromBody } from '../../src/document-utils';
import { displayTitle, formatListDate } from '../../src/format';
import { pressedStyle, touchMin, typeSize, uiFontFamily, usePalette } from '../../src/theme';
import type { VaultNote } from '../../src/vault';
import { useVault } from '../../src/vault-context';

type Sheet =
  | { readonly kind: 'note'; readonly note: VaultNote }
  | { readonly kind: 'move'; readonly note: VaultNote }
  | { readonly kind: 'delete'; readonly note: VaultNote }
  | { readonly kind: 'sort' }
  | { readonly kind: 'emptyTrash' };

type RowAction = {
  readonly key: string;
  readonly label: string;
  readonly glyph: GlyphName;
  readonly color: string;
  readonly run: () => void;
};

/** The first line is the title, so the row preview starts after it. */
function previewText(note: VaultNote): string {
  const lines = note.plainBody.split('\n');
  const rest = lines[0]?.trim() === note.title.trim() ? lines.slice(1).join(' ') : note.plainBody;
  return snippetFromBody(rest);
}

export default function NoteListScreen() {
  const palette = usePalette();
  const vault = useVault();
  const [mode, setMode] = useState<ListMode>('notes');
  const [sort, setSort] = useState<NoteSort>('modified');
  const [folderId, setFolderId] = useState<FolderId | null>(null);
  const [tagId, setTagId] = useState<TagId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);

  // Opening a folder from the Folders screen lands here with that folder selected.
  const folderParam = useLocalSearchParams<{ folder?: string }>().folder;
  useEffect(() => {
    if (folderParam !== undefined && folderParam.length > 0) {
      setMode('notes');
      setTagId(null);
      setFolderId(folderParam as FolderId);
    }
  }, [folderParam]);

  const tree = useMemo(
    () =>
      flattenFolderTree(
        buildFolderTree(
          vault.folders.map((folder) => ({
            id: folder.id,
            name: folder.name,
            parentId: folder.parentId,
            manualPosition: folder.manualPosition,
          })),
        ),
      ),
    [vault.folders],
  );

  const rows = useMemo(
    () => visibleNotes(vault.notes, { mode, sort, folderId, tagId }),
    [folderId, mode, sort, tagId, vault.notes],
  );

  const sections = useMemo(() => {
    const pinned = mode === 'notes' ? rows.filter((note) => note.pinned) : [];
    const rest = mode === 'notes' ? rows.filter((note) => !note.pinned) : rows;
    return [
      { key: 'pinned', title: 'Pinned', data: pinned },
      { key: 'notes', title: pinned.length > 0 ? 'Notes' : '', data: rest },
    ].filter((section) => section.data.length > 0);
  }, [mode, rows]);

  const run = useCallback(async (task: () => Promise<unknown>, failure: string) => {
    setError(null);
    try {
      await task();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : failure);
    }
  }, []);

  const create = useCallback(async () => {
    setBusy(true);
    await run(async () => {
      const id = await vault.createNote(folderId);
      router.push(`/note/${id}?new=1`);
    }, 'Jot could not create a note.');
    setBusy(false);
  }, [folderId, run, vault]);

  const move = useCallback(
    (note: VaultNote, direction: -1 | 1) => {
      const ordered = rows.map((entry) => entry.id);
      const index = ordered.indexOf(note.id);
      const target = index + direction;
      const neighbor = ordered[target];
      if (index === -1 || neighbor === undefined) {
        return;
      }
      ordered[target] = note.id;
      ordered[index] = neighbor;
      void run(() => vault.reorderNotes(ordered), 'Jot could not reorder notes.');
    },
    [rows, run, vault],
  );

  const rowActions = (note: VaultNote): RowAction[] =>
    mode === 'trash'
      ? [
          {
            key: 'restore',
            label: 'Restore',
            glyph: 'restore',
            color: palette.accent,
            run: () => {
              void run(
                () => vault.applyNoteCommand({ type: 'restore', noteId: note.id }),
                'Jot could not restore that note.',
              );
            },
          },
          {
            key: 'delete',
            label: 'Delete',
            glyph: 'trash',
            color: palette.error,
            run: () => {
              setSheet({ kind: 'delete', note });
            },
          },
        ]
      : [
          {
            key: 'pin',
            label: note.pinned ? 'Unpin' : 'Pin',
            glyph: 'pin',
            color: palette.accent,
            run: () => {
              void run(
                () =>
                  vault.applyNoteCommand({ type: 'pin', noteId: note.id, pinned: !note.pinned }),
                'Jot could not update that note.',
              );
            },
          },
          {
            key: 'trash',
            label: 'Trash',
            glyph: 'trash',
            color: palette.error,
            run: () => {
              void run(
                () => vault.applyNoteCommand({ type: 'trash', noteId: note.id }),
                'Jot could not move that note to the trash.',
              );
            },
          },
        ];

  const sheetContent = ((): {
    title: string;
    message?: string;
    align: 'center' | 'leading';
    actions: ActionItem[];
  } => {
    if (sheet === null) {
      return { title: '', align: 'center', actions: [] };
    }
    if (sheet.kind === 'sort') {
      return {
        title: 'Sort notes by',
        align: 'leading',
        actions: SORTS.map((id) => ({
          key: id,
          label: SORT_LABEL[id],
          selected: id === sort,
          onPress: () => {
            setSort(id);
          },
        })),
      };
    }
    if (sheet.kind === 'emptyTrash') {
      return {
        title: 'Delete every note in the trash?',
        message: 'This cannot be undone.',
        align: 'center',
        actions: [
          {
            key: 'empty',
            label: 'Delete all',
            destructive: true,
            onPress: () => {
              void run(() => vault.emptyTrash(), 'Jot could not empty the trash.');
            },
          },
        ],
      };
    }
    const { note } = sheet;
    if (sheet.kind === 'delete') {
      return {
        title: `Delete "${displayTitle(note.title)}"?`,
        message: 'This cannot be undone.',
        align: 'center',
        actions: [
          {
            key: 'delete',
            label: 'Delete note',
            destructive: true,
            onPress: () => {
              void run(
                () => vault.deleteNotePermanently(note.id),
                'Jot could not delete that note.',
              );
            },
          },
        ],
      };
    }
    if (sheet.kind === 'move') {
      const moveTo = (target: FolderId | null) => {
        void run(
          () => vault.applyNoteCommand({ type: 'move', noteId: note.id, folderId: target }),
          'Jot could not move that note.',
        );
      };
      return {
        title: 'Move to folder',
        align: 'leading',
        actions: [
          {
            key: 'none',
            label: 'No folder',
            selected: note.folderId === null,
            onPress: () => {
              moveTo(null);
            },
          },
          ...tree.map((node) => ({
            key: node.folder.id,
            label: `${'    '.repeat(node.depth)}${node.folder.name}`,
            selected: note.folderId === node.folder.id,
            onPress: () => {
              moveTo(node.folder.id as FolderId);
            },
          })),
        ],
      };
    }
    const index = rows.findIndex((entry) => entry.id === note.id);
    const manual = sort === 'manual';
    const actions: ActionItem[] =
      mode === 'trash'
        ? [
            {
              key: 'restore',
              label: 'Restore',
              onPress: () => {
                void run(
                  () => vault.applyNoteCommand({ type: 'restore', noteId: note.id }),
                  'Jot could not restore that note.',
                );
              },
            },
            {
              key: 'delete',
              label: 'Delete permanently',
              destructive: true,
              keepOpen: true,
              onPress: () => {
                setSheet({ kind: 'delete', note });
              },
            },
          ]
        : [
            {
              key: 'pin',
              label: note.pinned ? 'Unpin' : 'Pin',
              onPress: () => {
                void run(
                  () =>
                    vault.applyNoteCommand({ type: 'pin', noteId: note.id, pinned: !note.pinned }),
                  'Jot could not update that note.',
                );
              },
            },
            {
              key: 'move',
              label: 'Move to folder',
              keepOpen: true,
              onPress: () => {
                setSheet({ kind: 'move', note });
              },
            },
            ...(manual && index > 0
              ? [
                  {
                    key: 'up',
                    label: 'Move up',
                    onPress: () => {
                      move(note, -1);
                    },
                  },
                ]
              : []),
            ...(manual && index >= 0 && index < rows.length - 1
              ? [
                  {
                    key: 'down',
                    label: 'Move down',
                    onPress: () => {
                      move(note, 1);
                    },
                  },
                ]
              : []),
            {
              key: 'archive',
              label: note.archived ? 'Move out of archive' : 'Archive',
              onPress: () => {
                void run(
                  () =>
                    vault.applyNoteCommand({
                      type: 'archive',
                      noteId: note.id,
                      archived: !note.archived,
                    }),
                  'Jot could not update that note.',
                );
              },
            },
            {
              key: 'trash',
              label: 'Move to trash',
              destructive: true,
              onPress: () => {
                void run(
                  () => vault.applyNoteCommand({ type: 'trash', noteId: note.id }),
                  'Jot could not move that note to the trash.',
                );
              },
            },
          ];
    return { title: displayTitle(note.title), align: 'center', actions };
  })();

  const folderName = vault.folders.find((folder) => folder.id === folderId)?.name;
  const heading =
    mode === 'archive' ? 'Archive' : mode === 'trash' ? 'Trash' : (folderName ?? 'Notes');
  const hasFilters = tree.length > 0 || vault.tags.length > 0;
  const noNotesAtAll =
    vault.status === 'ready' &&
    mode === 'notes' &&
    vault.notes.every((note) => note.trashed || note.archived);

  const emptyCopy =
    mode === 'archive'
      ? 'Archived notes stay out of your main list until you need them.'
      : mode === 'trash'
        ? 'Notes you move to the trash wait here for 30 days.'
        : folderId !== null || tagId !== null
          ? 'No notes match this filter.'
          : '';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]} edges={['top']}>
      <StatusBar style={palette.ink === tokens.color.dark.ink ? 'light' : 'dark'} />
      <LargeTitle
        palette={palette}
        title={heading}
        leading={{
          label: 'Folders',
          glyph: 'folders',
          onPress: () => {
            router.push('/folders');
          },
        }}
        trailing={[
          {
            label: `Sort by ${SORT_LABEL[sort]}`,
            glyph: 'sort',
            onPress: () => {
              setSheet({ kind: 'sort' });
            },
          },
          {
            label: 'New note',
            glyph: 'compose',
            onPress: () => {
              void create();
            },
            disabled: busy || vault.status !== 'ready',
          },
        ]}
      />
      <ListControls palette={palette} mode={mode} onMode={setMode} />
      {vault.status === 'error' ? (
        <ErrorBanner
          palette={palette}
          message={vault.errorMessage ?? 'Jot could not open notes on this device.'}
          actionLabel="Try again"
          onAction={vault.retry}
        />
      ) : null}
      {error !== null ? (
        <ErrorBanner
          palette={palette}
          message={error}
          actionLabel="Dismiss"
          onAction={() => {
            setError(null);
          }}
        />
      ) : null}
      {vault.status === 'loading' ? (
        <Text style={[styles.status, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>
          Opening notes…
        </Text>
      ) : noNotesAtAll && folderId === null && tagId === null ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: palette.ink, fontFamily: uiFontFamily() }]}>
            No notes yet
          </Text>
          <Text style={[styles.emptyCopy, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>
            Notes stay on this device and save as you type.
          </Text>
          <Pressable
            onPress={() => {
              void create();
            }}
            accessibilityRole="button"
            accessibilityLabel="New note"
            style={({ pressed }) => [
              styles.emptyAction,
              { backgroundColor: palette.accent },
              pressedStyle(pressed),
            ]}
          >
            <Text
              style={[
                styles.emptyActionLabel,
                { color: palette.canvas, fontFamily: uiFontFamily() },
              ]}
            >
              New note
            </Text>
          </Pressable>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          style={styles.list}
          stickySectionHeadersEnabled={false}
          keyboardDismissMode="on-drag"
          contentContainerStyle={rows.length === 0 ? styles.listEmpty : styles.listContent}
          ListHeaderComponent={
            <View>
              {hasFilters && mode === 'notes' ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chips}
                >
                  <Chip
                    palette={palette}
                    label="All notes"
                    selected={folderId === null && tagId === null}
                    onPress={() => {
                      setFolderId(null);
                      setTagId(null);
                    }}
                  />
                  {tree.map((node) => (
                    <Chip
                      key={node.folder.id}
                      palette={palette}
                      label={node.folder.name}
                      selected={folderId === node.folder.id}
                      onPress={() => {
                        setFolderId((current) =>
                          current === node.folder.id ? null : (node.folder.id as FolderId),
                        );
                      }}
                    />
                  ))}
                  {vault.tags.map((tag) => (
                    <Chip
                      key={tag.id}
                      palette={palette}
                      label={`#${tag.name}`}
                      selected={tagId === tag.id}
                      onPress={() => {
                        setTagId((current) => (current === tag.id ? null : tag.id));
                      }}
                    />
                  ))}
                </ScrollView>
              ) : null}
              {mode === 'trash' && rows.length > 0 ? (
                <View style={styles.trashBar}>
                  <Text
                    style={[
                      styles.trashCopy,
                      { color: palette.inkMuted, fontFamily: uiFontFamily() },
                    ]}
                  >
                    Notes are deleted 30 days after they move here.
                  </Text>
                  <Pressable
                    onPress={() => {
                      setSheet({ kind: 'emptyTrash' });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Empty trash"
                    hitSlop={tokens.spacing.scale.space8}
                    style={({ pressed }) => pressedStyle(pressed)}
                  >
                    <Text
                      style={[
                        styles.trashAction,
                        { color: palette.error, fontFamily: uiFontFamily() },
                      ]}
                    >
                      Empty trash
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          }
          renderSectionHeader={({ section }) =>
            section.title.length > 0 ? (
              <Text
                style={[
                  styles.sectionHeader,
                  { color: palette.inkMuted, fontFamily: uiFontFamily() },
                ]}
              >
                {section.title}
              </Text>
            ) : null
          }
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: palette.hairline }]} />
          )}
          ListEmptyComponent={
            <Text
              style={[
                styles.status,
                styles.statusCentered,
                { color: palette.inkMuted, fontFamily: uiFontFamily() },
              ]}
            >
              {emptyCopy}
            </Text>
          }
          renderItem={({ item }) => (
            <NoteRow
              palette={palette}
              note={item}
              mode={mode}
              actions={rowActions(item)}
              onOpen={() => {
                router.push(`/note/${item.id}`);
              }}
              onMore={() => {
                setSheet({ kind: 'note', note: item });
              }}
            />
          )}
        />
      )}
      <ActionSheet
        palette={palette}
        visible={sheet !== null && sheetContent.actions.length > 0}
        title={sheetContent.title}
        {...(sheetContent.message === undefined ? {} : { message: sheetContent.message })}
        align={sheetContent.align}
        actions={sheetContent.actions}
        onClose={() => {
          setSheet(null);
        }}
      />
    </SafeAreaView>
  );
}

function NoteRow({
  palette,
  note,
  mode,
  actions,
  onOpen,
  onMore,
}: {
  readonly palette: SemanticPalette;
  readonly note: VaultNote;
  readonly mode: ListMode;
  readonly actions: readonly RowAction[];
  readonly onOpen: () => void;
  readonly onMore: () => void;
}) {
  const swipeable = useRef<SwipeableMethods>(null);
  const preview = previewText(note);
  const date = formatListDate(note.modifiedMs);
  return (
    <Swipeable
      ref={swipeable}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <View style={styles.swipeActions}>
          {actions.map((action) => (
            <Pressable
              key={action.key}
              onPress={() => {
                swipeable.current?.close();
                action.run();
              }}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={({ pressed }) => [
                styles.swipeAction,
                { backgroundColor: action.color },
                pressedStyle(pressed),
              ]}
            >
              <Glyph name={action.glyph} color={palette.canvas} size={22} />
              <Text
                style={[styles.swipeLabel, { color: palette.canvas, fontFamily: uiFontFamily() }]}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    >
      <Pressable
        onPress={onOpen}
        onLongPress={onMore}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={`${displayTitle(note.title)}, edited ${date}`}
        accessibilityHint="Swipe left or touch and hold for actions."
        accessibilityActions={[
          ...actions.map((action) => ({ name: action.key, label: action.label })),
          { name: 'more', label: 'More actions' },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'more') {
            onMore();
            return;
          }
          actions.find((action) => action.key === event.nativeEvent.actionName)?.run();
        }}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: pressed ? palette.surface : palette.canvas },
        ]}
      >
        <View style={styles.rowText}>
          <Text
            numberOfLines={1}
            style={[styles.rowTitle, { color: palette.ink, fontFamily: uiFontFamily() }]}
          >
            {displayTitle(note.title)}
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.rowMeta, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}
          >
            <Text style={[styles.rowDate, { color: palette.ink }]}>{date}</Text>
            {'  '}
            {preview.length > 0 ? preview : 'No additional text'}
          </Text>
        </View>
        {note.pinned && mode !== 'trash' ? (
          <Glyph name="pin" color={palette.inkFaint} size={16} focused />
        ) : null}
      </Pressable>
    </Swipeable>
  );
}

function Chip({
  palette,
  label,
  selected,
  onPress,
}: {
  readonly palette: SemanticPalette;
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? palette.accentMuted : palette.surface },
        pressedStyle(pressed),
      ]}
    >
      <Text
        style={[
          styles.chipLabel,
          { color: selected ? palette.ink : palette.inkMuted, fontFamily: uiFontFamily() },
          selected ? styles.chipLabelSelected : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: tokens.spacing.scale.space24,
  },
  listEmpty: {
    flexGrow: 1,
  },
  chips: {
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingBottom: tokens.spacing.scale.space8,
    gap: tokens.spacing.scale.space8,
    alignItems: 'center',
  },
  chip: {
    minHeight: touchMin,
    paddingHorizontal: tokens.spacing.scale.space12,
    borderRadius: tokens.radius.pill,
    justifyContent: 'center',
  },
  chipLabel: {
    fontSize: typeSize.subhead,
  },
  chipLabelSelected: {
    fontWeight: '600',
  },
  trashBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacing.scale.space12,
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingBottom: tokens.spacing.scale.space8,
  },
  trashCopy: {
    flex: 1,
    fontSize: typeSize.footnote,
  },
  trashAction: {
    fontSize: typeSize.subhead,
    fontWeight: '600',
  },
  sectionHeader: {
    fontSize: typeSize.footnote,
    fontWeight: '600',
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingTop: tokens.spacing.scale.space16,
    paddingBottom: tokens.spacing.scale.space4,
  },
  row: {
    minHeight: touchMin + tokens.spacing.scale.space16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingVertical: tokens.spacing.scale.space12,
    gap: tokens.spacing.scale.space8,
  },
  rowText: {
    flex: 1,
    gap: tokens.spacing.scale.space2,
  },
  rowTitle: {
    fontSize: typeSize.body,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: typeSize.subhead,
  },
  rowDate: {
    fontVariant: ['tabular-nums'],
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: tokens.spacing.scale.space16,
  },
  swipeActions: {
    flexDirection: 'row',
  },
  swipeAction: {
    width: tokens.spacing.scale.space64 + tokens.spacing.scale.space12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacing.scale.space4,
  },
  swipeLabel: {
    fontSize: typeSize.caption,
    fontWeight: '600',
  },
  status: {
    fontSize: typeSize.subhead,
    padding: tokens.spacing.scale.space16,
  },
  statusCentered: {
    textAlign: 'center',
    marginTop: tokens.spacing.scale.space48,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing.scale.space32,
    gap: tokens.spacing.scale.space8,
    paddingBottom: tokens.spacing.scale.space64,
  },
  emptyTitle: {
    fontSize: typeSize.title + tokens.spacing.scale.space4,
    fontWeight: '600',
  },
  emptyCopy: {
    fontSize: typeSize.subhead,
    textAlign: 'center',
  },
  emptyAction: {
    minHeight: touchMin,
    paddingHorizontal: tokens.spacing.scale.space24,
    borderRadius: tokens.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: tokens.spacing.scale.space12,
  },
  emptyActionLabel: {
    fontSize: typeSize.body,
    fontWeight: '600',
  },
});
