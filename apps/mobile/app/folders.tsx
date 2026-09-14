import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { tokens } from '@jot/tokens/generated';
import {
  buildFolderTree,
  descendantIds,
  findSubtree,
  flattenFolderTree,
  type FolderTreeNode,
} from '@jot/ui-mobile';
import type { FolderId } from '@jot/schema';
import { ActionSheet, type ActionItem } from '../src/components/ActionSheet';
import { AppHeader } from '../src/components/AppHeader';
import { ErrorBanner } from '../src/components/ErrorBanner';
import { Glyph } from '../src/components/Glyph';
import { PromptModal } from '../src/components/PromptModal';
import { pressedStyle, touchMin, typeSize, uiFontFamily, usePalette } from '../src/theme';
import { useVault } from '../src/vault-context';

type Sheet = 'actions' | 'move' | 'delete';
type Prompt =
  { readonly kind: 'create'; readonly parentId: FolderId | null } | { readonly kind: 'rename' };

export default function FoldersScreen() {
  const palette = usePalette();
  const vault = useVault();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [activeId, setActiveId] = useState<FolderId | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const records = useMemo(
    () =>
      vault.folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        manualPosition: folder.manualPosition,
      })),
    [vault.folders],
  );
  const roots = useMemo(() => buildFolderTree(records), [records]);
  const tree = useMemo(() => flattenFolderTree(roots), [roots]);
  const counts = useMemo(() => {
    const byFolder = new Map<string, number>();
    for (const note of vault.notes) {
      if (note.folderId !== null && !note.trashed && !note.archived) {
        byFolder.set(note.folderId, (byFolder.get(note.folderId) ?? 0) + 1);
      }
    }
    return byFolder;
  }, [vault.notes]);

  const active = vault.folders.find((folder) => folder.id === activeId);

  const blocked = useMemo(() => {
    if (activeId === null) {
      return new Set<string>();
    }
    const subtree = findSubtree(roots, activeId);
    const ids = new Set<string>([activeId]);
    if (subtree !== undefined) {
      for (const id of descendantIds([subtree] as readonly FolderTreeNode[])) {
        ids.add(id);
      }
    }
    return ids;
  }, [activeId, roots]);

  const run = async (task: () => Promise<unknown>, failure: string): Promise<boolean> => {
    setError(null);
    try {
      await task();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : failure);
      return false;
    }
  };

  const openPrompt = (next: Prompt, initial: string) => {
    setName(initial);
    setPrompt(next);
  };

  const sheetContent = ((): {
    title: string;
    message?: string;
    align: 'center' | 'leading';
    actions: ActionItem[];
  } => {
    if (active === undefined || sheet === null) {
      return { title: '', align: 'center', actions: [] };
    }
    if (sheet === 'move') {
      return {
        title: `Move "${active.name}"`,
        align: 'leading',
        actions: [
          {
            key: 'root',
            label: 'Top level',
            selected: active.parentId === null,
            onPress: () => {
              void run(() => vault.moveFolder(active.id, null), 'Jot could not move that folder.');
            },
          },
          ...tree
            .filter((node) => !blocked.has(node.folder.id))
            .map((node) => ({
              key: node.folder.id,
              label: `${'    '.repeat(node.depth)}${node.folder.name}`,
              selected: active.parentId === node.folder.id,
              onPress: () => {
                void run(
                  () => vault.moveFolder(active.id, node.folder.id as FolderId),
                  'Jot could not move that folder.',
                );
              },
            })),
        ],
      };
    }
    if (sheet === 'delete') {
      return {
        title: `Delete "${active.name}"?`,
        message: 'Its subfolders are deleted too. The notes inside move to No folder.',
        align: 'center',
        actions: [
          {
            key: 'delete',
            label: 'Delete folder',
            destructive: true,
            onPress: () => {
              void run(() => vault.deleteFolder(active.id), 'Jot could not delete that folder.');
            },
          },
        ],
      };
    }
    return {
      title: active.name,
      align: 'center',
      actions: [
        {
          key: 'child',
          label: 'New subfolder',
          onPress: () => {
            openPrompt({ kind: 'create', parentId: active.id }, '');
          },
        },
        {
          key: 'rename',
          label: 'Rename',
          onPress: () => {
            openPrompt({ kind: 'rename' }, active.name);
          },
        },
        {
          key: 'move',
          label: 'Move',
          keepOpen: true,
          onPress: () => {
            setSheet('move');
          },
        },
        {
          key: 'delete',
          label: 'Delete folder',
          destructive: true,
          keepOpen: true,
          onPress: () => {
            setSheet('delete');
          },
        },
      ],
    };
  })();

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: palette.canvas }]}
      edges={['top', 'bottom']}
    >
      <StatusBar style={palette.ink === tokens.color.dark.ink ? 'light' : 'dark'} />
      <AppHeader
        palette={palette}
        title="Folders"
        leftLabel="Notes"
        leftGlyph="back"
        onLeft={() => {
          router.back();
        }}
        rightLabel="New folder"
        rightGlyph="new"
        onRight={() => {
          setName('');
          setPrompt({ kind: 'create', parentId: null });
        }}
      />
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
      <FlatList
        data={tree}
        keyExtractor={(item) => item.folder.id}
        contentContainerStyle={tree.length === 0 ? styles.listEmpty : undefined}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: palette.ink, fontFamily: uiFontFamily() }]}>
              No folders
            </Text>
            <Text
              style={[styles.emptyCopy, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}
            >
              Folders keep related notes together. They can hold other folders.
            </Text>
            <Pressable
              onPress={() => {
                setName('');
                setPrompt({ kind: 'create', parentId: null });
              }}
              accessibilityRole="button"
              accessibilityLabel="New folder"
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
                New folder
              </Text>
            </Pressable>
          </View>
        }
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: palette.hairline }]} />
        )}
        renderItem={({ item }) => {
          const count = counts.get(item.folder.id) ?? 0;
          return (
            <View
              style={[
                styles.row,
                {
                  paddingLeft:
                    tokens.spacing.scale.space16 + item.depth * tokens.spacing.scale.space24,
                },
              ]}
            >
              <Pressable
                onPress={() => {
                  router.navigate({ pathname: '/', params: { folder: item.folder.id } });
                }}
                onLongPress={() => {
                  setActiveId(item.folder.id as FolderId);
                  setSheet('actions');
                }}
                accessibilityRole="button"
                accessibilityLabel={`${item.folder.name}, ${String(count)} ${count === 1 ? 'note' : 'notes'}`}
                accessibilityHint="Opens the notes in this folder."
                style={({ pressed }) => [styles.rowMain, pressedStyle(pressed)]}
              >
                <Glyph name="folders" color={palette.accent} size={22} />
                <Text
                  numberOfLines={1}
                  style={[styles.name, { color: palette.ink, fontFamily: uiFontFamily() }]}
                >
                  {item.folder.name}
                </Text>
                <Text
                  style={[styles.count, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}
                >
                  {count}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setActiveId(item.folder.id as FolderId);
                  setSheet('actions');
                }}
                accessibilityRole="button"
                accessibilityLabel={`${item.folder.name} options`}
                style={({ pressed }) => [styles.more, pressedStyle(pressed)]}
              >
                <Glyph name="more" color={palette.inkMuted} size={22} />
              </Pressable>
            </View>
          );
        }}
      />
      <ActionSheet
        palette={palette}
        visible={sheetContent.actions.length > 0}
        title={sheetContent.title}
        {...(sheetContent.message === undefined ? {} : { message: sheetContent.message })}
        align={sheetContent.align}
        actions={sheetContent.actions}
        onClose={() => {
          setSheet(null);
        }}
      />
      <PromptModal
        palette={palette}
        visible={prompt !== null}
        title={
          prompt?.kind === 'rename'
            ? 'Rename folder'
            : prompt?.parentId === null
              ? 'New folder'
              : 'New subfolder'
        }
        placeholder="Name"
        value={name}
        onChange={setName}
        confirmLabel={prompt?.kind === 'rename' ? 'Rename' : 'Create'}
        onCancel={() => {
          setPrompt(null);
        }}
        onConfirm={() => {
          const current = prompt;
          if (current === null) {
            return;
          }
          void (async () => {
            const ok =
              current.kind === 'create'
                ? await run(
                    () => vault.createFolder(name, current.parentId),
                    'Jot could not create that folder.',
                  )
                : activeId === null
                  ? false
                  : await run(
                      () => vault.renameFolder(activeId, name),
                      'Jot could not rename that folder.',
                    );
            if (ok) {
              setPrompt(null);
            }
          })();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: tokens.spacing.scale.space4,
  },
  rowMain: {
    flex: 1,
    minHeight: touchMin + tokens.spacing.scale.space4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.scale.space12,
  },
  name: {
    flex: 1,
    fontSize: typeSize.body,
  },
  count: {
    fontSize: typeSize.subhead,
    fontVariant: ['tabular-nums'],
  },
  more: {
    minWidth: touchMin,
    minHeight: touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: tokens.spacing.scale.space48 + tokens.spacing.scale.space2,
  },
  listEmpty: {
    flexGrow: 1,
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
