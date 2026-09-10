import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { tokens } from '@jot/tokens/generated';
import {
  buildFolderTree,
  flattenFolderTree,
  visibleNotes,
  type ListMode,
  type NoteSort,
} from '@jot/ui-mobile';
import type { FolderId } from '@jot/schema';
import { ActionSheet, type ActionItem } from '../src/components/ActionSheet';
import { AppHeader } from '../src/components/AppHeader';
import { ErrorBanner } from '../src/components/ErrorBanner';
import { ListControls, nextSort } from '../src/components/ListControls';
import { PromptModal } from '../src/components/PromptModal';
import { snippetFromBody } from '../src/document-utils';
import { editorBodySize, touchMin, uiFontFamily, usePalette } from '../src/theme';
import { useVault } from '../src/vault-context';
import type { VaultNote } from '../src/vault';

function formatWhen(ms: number): string {
  if (ms <= 0) {
    return '';
  }
  const date = new Date(ms);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function NoteListScreen() {
  const palette = usePalette();
  const vault = useVault();
  const [mode, setMode] = useState<ListMode>('notes');
  const [sort, setSort] = useState<NoteSort>('modified');
  const [folderId, setFolderId] = useState<FolderId | null>(null);
  const [tagId, setTagId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<VaultNote | null>(null);
  const [rename, setRename] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

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
    () =>
      visibleNotes(vault.notes, {
        mode,
        sort,
        folderId,
        tagId,
      }),
    [folderId, mode, sort, tagId, vault.notes],
  );

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await vault.createNote(folderId);
      router.push(`/note/${id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create a note.');
    } finally {
      setBusy(false);
    }
  }, [folderId, vault]);

  const runCommand = useCallback(
    async (note: VaultNote, action: 'pin' | 'archive' | 'trash' | 'restore') => {
      setError(null);
      try {
        if (action === 'pin') {
          await vault.applyNoteCommand({ type: 'pin', noteId: note.id, pinned: !note.pinned });
          return;
        }
        if (action === 'archive') {
          await vault.applyNoteCommand({ type: 'archive', noteId: note.id, archived: !note.archived });
          return;
        }
        if (action === 'restore') {
          await vault.applyNoteCommand({ type: 'restore', noteId: note.id });
          return;
        }
        await vault.applyNoteCommand({ type: 'trash', noteId: note.id });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not update that note.');
      }
    },
    [vault],
  );

  const actions: ActionItem[] = active
    ? [
        {
          key: 'pin',
          label: active.pinned ? 'Unpin' : 'Pin',
          onPress: () => {
            void runCommand(active, 'pin');
          },
        },
        ...(mode === 'trash'
          ? [
              {
                key: 'restore',
                label: 'Restore',
                onPress: () => {
                  void runCommand(active, 'restore');
                },
              },
            ]
          : [
              {
                key: 'archive',
                label: active.archived ? 'Move to notes' : 'Archive',
                onPress: () => {
                  void runCommand(active, 'archive');
                },
              },
              {
                key: 'trash',
                label: 'Move to trash',
                destructive: true,
                onPress: () => {
                  void runCommand(active, 'trash');
                },
              },
            ]),
        {
          key: 'rename',
          label: 'Rename',
          onPress: () => {
            setRename(active.title);
            setRenameOpen(true);
          },
        },
        {
          key: 'move',
          label: 'Move to folder',
          onPress: () => {
            setMoveOpen(true);
          },
        },
      ]
    : [];

  const empty =
    vault.status === 'ready' && rows.length === 0 && mode === 'notes' && vault.notes.length === 0;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]} edges={['top', 'bottom']}>
      <StatusBar style={palette.ink === tokens.color.dark.ink ? 'light' : 'dark'} />
      <AppHeader
        palette={palette}
        title="Jot"
        leftLabel="Search"
        onLeft={() => {
          router.push('/search');
        }}
        rightLabel={busy ? '…' : 'New'}
        onRight={() => {
          void create();
        }}
        rightDisabled={busy || vault.status !== 'ready'}
      />
      {vault.status === 'loading' ? (
        <Text style={[styles.status, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>
          Opening local notes.
        </Text>
      ) : null}
      {vault.status === 'error' ? (
        <ErrorBanner
          palette={palette}
          message={vault.errorMessage ?? 'Jot could not open local notes.'}
          actionLabel="Try again"
          onAction={vault.retry}
        />
      ) : null}
      {error !== null ? (
        <ErrorBanner palette={palette} message={error} actionLabel="Dismiss" onAction={() => { setError(null); }} />
      ) : null}
      <View style={styles.navRow}>
        <Pressable
          onPress={() => {
            router.push('/folders');
          }}
          accessibilityRole="button"
          accessibilityLabel="Folders"
          style={styles.navHit}
        >
          <Text style={[styles.navLabel, { color: palette.accent, fontFamily: uiFontFamily() }]}>Folders</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            router.push('/settings');
          }}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          style={styles.navHit}
        >
          <Text style={[styles.navLabel, { color: palette.accent, fontFamily: uiFontFamily() }]}>Settings</Text>
        </Pressable>
      </View>
      <ListControls
        palette={palette}
        mode={mode}
        sort={sort}
        onMode={setMode}
        onCycleSort={() => {
          setSort(nextSort(sort));
        }}
      />
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        <Chip
          palette={palette}
          label="All"
          selected={folderId === null}
          onPress={() => {
            setFolderId(null);
          }}
        />
        {tree.map((node) => (
          <Chip
            key={node.folder.id}
            palette={palette}
            label={`${'  '.repeat(node.depth)}${node.folder.name}`}
            selected={folderId === node.folder.id}
            onPress={() => {
              setFolderId(node.folder.id as FolderId);
            }}
          />
        ))}
        {vault.tags.map((tag) => (
          <Chip
            key={tag.id}
            palette={palette}
            label={tag.name}
            selected={tagId === tag.id}
            onPress={() => {
              setTagId((current) => (current === tag.id ? null : tag.id));
            }}
          />
        ))}
      </ScrollView>
      {empty ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: palette.ink, fontFamily: uiFontFamily() }]}>Jot</Text>
          <Text style={[styles.emptyCopy, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>
            Local notes. No account.
          </Text>
          <Pressable
            onPress={() => {
              void create();
            }}
            accessibilityRole="button"
            accessibilityLabel="New note"
            style={[styles.emptyAction, { borderColor: palette.hairline }]}
          >
            <Text style={[styles.emptyActionLabel, { color: palette.accent, fontFamily: uiFontFamily() }]}>
              New note
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={rows.length === 0 ? styles.listEmpty : undefined}
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: palette.hairline }]} />
          )}
          ListEmptyComponent={
            <Text style={[styles.status, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>
              {mode === 'archive'
                ? 'Archive is empty.'
                : mode === 'trash'
                  ? 'Trash is empty.'
                  : 'No notes in this folder.'}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                router.push(`/note/${item.id}`);
              }}
              onLongPress={() => {
                setActive(item);
              }}
              delayLongPress={350}
              accessibilityRole="button"
              accessibilityLabel={item.title.trim() === '' ? 'Untitled note' : item.title}
              style={styles.row}
            >
              <View style={styles.rowText}>
                <Text
                  numberOfLines={1}
                  style={[styles.rowTitle, { color: palette.ink, fontFamily: uiFontFamily() }]}
                >
                  {item.title.trim() === '' ? 'Untitled' : item.title}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.rowMeta, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}
                >
                  {[item.pinned ? 'Pinned' : undefined, formatWhen(item.modifiedMs), snippetFromBody(item.plainBody)]
                    .filter((part): part is string => part !== undefined && part.length > 0)
                    .join('  ·  ')}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
      <ActionSheet
        palette={palette}
        visible={active !== null && !renameOpen && !moveOpen}
        title={active?.title.trim() === '' ? 'Untitled' : (active?.title ?? '')}
        actions={actions}
        onClose={() => {
          if (!renameOpen && !moveOpen) {
            setActive(null);
          }
        }}
      />
      <PromptModal
        palette={palette}
        visible={renameOpen}
        title="Rename note"
        placeholder="Title"
        value={rename}
        onChange={setRename}
        confirmLabel="Rename"
        onCancel={() => {
          setRenameOpen(false);
          setActive(null);
        }}
        onConfirm={() => {
          if (active !== null) {
            void vault.applyNoteCommand({
              type: 'renameTitle',
              noteId: active.id,
              title: rename.trim(),
            });
          }
          setRenameOpen(false);
          setActive(null);
        }}
      />
      <ActionSheet
        palette={palette}
        visible={moveOpen}
        title="Move to folder"
        actions={[
          {
            key: 'root',
            label: 'No folder',
            onPress: () => {
              if (active !== null) {
                void vault.applyNoteCommand({ type: 'move', noteId: active.id, folderId: null });
              }
              setMoveOpen(false);
              setActive(null);
            },
          },
          ...tree.map((node) => ({
            key: node.folder.id,
            label: `${'  '.repeat(node.depth)}${node.folder.name}`,
            onPress: () => {
              if (active !== null) {
                void vault.applyNoteCommand({
                  type: 'move',
                  noteId: active.id,
                  folderId: node.folder.id as FolderId,
                });
              }
              setMoveOpen(false);
              setActive(null);
            },
          })),
        ]}
        onClose={() => {
          setMoveOpen(false);
          setActive(null);
        }}
      />
    </SafeAreaView>
  );
}

function Chip({
  palette,
  label,
  selected,
  onPress,
}: {
  readonly palette: ReturnType<typeof usePalette>;
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label.trim()}
      style={[
        styles.chip,
        {
          borderColor: selected ? palette.accent : palette.hairline,
          backgroundColor: selected ? palette.accentMuted : palette.canvas,
        },
      ]}
    >
      <Text style={[styles.chipLabel, { color: palette.ink, fontFamily: uiFontFamily() }]}>{label.trim()}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: tokens.spacing.scale.space16,
  },
  navHit: {
    minHeight: touchMin,
    justifyContent: 'center',
  },
  navLabel: {
    fontSize: editorBodySize,
    fontWeight: '500',
  },
  chips: {
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingVertical: tokens.spacing.scale.space8,
    gap: tokens.spacing.scale.space8,
    alignItems: 'center',
  },
  chip: {
    minHeight: touchMin,
    paddingHorizontal: tokens.spacing.scale.space12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: tokens.radius.pill,
    justifyContent: 'center',
  },
  chipLabel: {
    fontSize: editorBodySize,
  },
  row: {
    minHeight: touchMin + tokens.spacing.scale.space16,
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingVertical: tokens.spacing.scale.space12,
    justifyContent: 'center',
  },
  rowText: {
    gap: tokens.spacing.scale.space4,
  },
  rowTitle: {
    fontSize: editorBodySize,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: editorBodySize,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: tokens.spacing.scale.space16,
  },
  status: {
    fontSize: editorBodySize,
    padding: tokens.spacing.scale.space16,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing.scale.space24,
    gap: tokens.spacing.scale.space8,
  },
  emptyTitle: {
    fontSize: editorBodySize,
    fontWeight: '600',
  },
  emptyCopy: {
    fontSize: editorBodySize,
    textAlign: 'center',
  },
  emptyAction: {
    minHeight: touchMin,
    minWidth: touchMin,
    paddingHorizontal: tokens.spacing.scale.space16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: tokens.radius.compact,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: tokens.spacing.scale.space8,
  },
  emptyActionLabel: {
    fontSize: editorBodySize,
    fontWeight: '600',
  },
  listEmpty: {
    flexGrow: 1,
  },
});
