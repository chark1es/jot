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
import { ActionSheet } from '../src/components/ActionSheet';
import { AppHeader } from '../src/components/AppHeader';
import { ErrorBanner } from '../src/components/ErrorBanner';
import { PromptModal } from '../src/components/PromptModal';
import { editorBodySize, touchMin, uiFontFamily, usePalette } from '../src/theme';
import { useVault } from '../src/vault-context';

export default function FoldersScreen() {
  const palette = usePalette();
  const vault = useVault();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [parentId, setParentId] = useState<FolderId | null>(null);
  const [activeId, setActiveId] = useState<FolderId | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);

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
  const tree = useMemo(() => flattenFolderTree(buildFolderTree(records)), [records]);
  const roots = useMemo(() => buildFolderTree(records), [records]);

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

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]} edges={['top', 'bottom']}>
      <StatusBar style={palette.ink === tokens.color.dark.ink ? 'light' : 'dark'} />
      <AppHeader
        palette={palette}
        title="Folders"
        leftLabel="Notes"
        onLeft={() => {
          router.back();
        }}
        rightLabel="New"
        onRight={() => {
          setParentId(null);
          setName('');
          setCreateOpen(true);
        }}
      />
      {error !== null ? (
        <ErrorBanner palette={palette} message={error} actionLabel="Dismiss" onAction={() => { setError(null); }} />
      ) : null}
      <FlatList
        data={tree}
        keyExtractor={(item) => item.folder.id}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>
            No folders yet. Nested folders can hold notes.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              setActiveId(item.folder.id as FolderId);
            }}
            accessibilityRole="button"
            accessibilityLabel={item.folder.name}
            style={[styles.row, { paddingLeft: tokens.spacing.scale.space16 + item.depth * tokens.spacing.scale.space16 }]}
          >
            <Text style={[styles.name, { color: palette.ink, fontFamily: uiFontFamily() }]}>
              {item.folder.name}
            </Text>
          </Pressable>
        )}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: palette.hairline }]} />
        )}
      />
      <ActionSheet
        palette={palette}
        visible={active !== undefined && !createOpen && !renameOpen && !moveOpen}
        title={active?.name ?? ''}
        actions={
          active === undefined
            ? []
            : [
                {
                  key: 'child',
                  label: 'New subfolder',
                  onPress: () => {
                    setParentId(active.id);
                    setName('');
                    setCreateOpen(true);
                  },
                },
                {
                  key: 'rename',
                  label: 'Rename',
                  onPress: () => {
                    setName(active.name);
                    setRenameOpen(true);
                  },
                },
                {
                  key: 'move',
                  label: 'Move',
                  onPress: () => {
                    setMoveOpen(true);
                  },
                },
              ]
        }
        onClose={() => {
          if (!createOpen && !renameOpen && !moveOpen) {
            setActiveId(null);
          }
        }}
      />
      <PromptModal
        palette={palette}
        visible={createOpen}
        title={parentId === null ? 'New folder' : 'New subfolder'}
        placeholder="Name"
        value={name}
        onChange={setName}
        confirmLabel="Create"
        onCancel={() => {
          setCreateOpen(false);
          setActiveId(null);
        }}
        onConfirm={() => {
          void (async () => {
            try {
              await vault.createFolder(name, parentId);
              setCreateOpen(false);
              setActiveId(null);
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : 'Could not create that folder.');
            }
          })();
        }}
      />
      <PromptModal
        palette={palette}
        visible={renameOpen}
        title="Rename folder"
        placeholder="Name"
        value={name}
        onChange={setName}
        confirmLabel="Rename"
        onCancel={() => {
          setRenameOpen(false);
          setActiveId(null);
        }}
        onConfirm={() => {
          if (activeId === null) {
            return;
          }
          void (async () => {
            try {
              await vault.renameFolder(activeId, name);
              setRenameOpen(false);
              setActiveId(null);
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : 'Could not rename that folder.');
            }
          })();
        }}
      />
      <ActionSheet
        palette={palette}
        visible={moveOpen}
        title="Move folder"
        actions={[
          {
            key: 'root',
            label: 'Top level',
            onPress: () => {
              if (activeId !== null) {
                void vault.moveFolder(activeId, null).catch((caught: unknown) => {
                  setError(caught instanceof Error ? caught.message : 'Could not move that folder.');
                });
              }
              setMoveOpen(false);
              setActiveId(null);
            },
          },
          ...tree
            .filter((node) => !blocked.has(node.folder.id))
            .map((node) => ({
              key: node.folder.id,
              label: `${'  '.repeat(node.depth)}${node.folder.name}`,
              onPress: () => {
                if (activeId !== null) {
                  void vault.moveFolder(activeId, node.folder.id as FolderId).catch((caught: unknown) => {
                    setError(caught instanceof Error ? caught.message : 'Could not move that folder.');
                  });
                }
                setMoveOpen(false);
                setActiveId(null);
              },
            })),
        ]}
        onClose={() => {
          setMoveOpen(false);
          setActiveId(null);
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
    minHeight: touchMin,
    justifyContent: 'center',
    paddingRight: tokens.spacing.scale.space16,
  },
  name: {
    fontSize: editorBodySize,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
  },
  empty: {
    fontSize: editorBodySize,
    padding: tokens.spacing.scale.space16,
  },
});
