import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { tokens } from '@jot/tokens/generated';
import { EditMaterializer, YjsCrdtDocument } from '@jot/core';
import {
  JotEditorView,
  createNativeIntakeLedger,
  documentDiffOperations,
  parseSchemaOperations,
  type DocumentRevision,
  type EditorCommand,
  type EditorEvent,
  type JotEditorNativeHandle,
  type NativeIntakeClient,
} from '@jot/editor-native';
import { markdownToBlocks } from '@jot/import-export';
import type { HistoryStep, VersionSnapshot } from '@jot/local-store';
import { createId, isAllowedHref, parseId, SCHEMA_VERSION } from '@jot/schema';
import type {
  Document,
  FolderId,
  NodeId,
  NoteId,
  SchemaOperation,
  TransactionId,
} from '@jot/schema';
import { buildFolderTree, flattenFolderTree } from '@jot/ui-mobile';
import { ActionSheet, type ActionItem } from '../../src/components/ActionSheet';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { EMPTY_FORMAT_STATE, FormatBar, type FormatState } from '../../src/components/FormatBar';
import { GlassSurface } from '../../src/components/GlassSurface';
import { Glyph, type GlyphName } from '../../src/components/Glyph';
import { PromptModal } from '../../src/components/PromptModal';
import { isBlankDocument, withEditableBody } from '../../src/document-utils';
import { formatFullDate } from '../../src/format';
import { pressedStyle, touchMin, typeSize, uiFontFamily, usePalette } from '../../src/theme';
import type { ImageAsset } from '../../src/vault';
import { useVault } from '../../src/vault-context';

const ZERO_REVISION = 0 as DocumentRevision;

const IMAGE_SIZES = [
  { label: 'Small', widthBasisPoints: 3300 },
  { label: 'Medium', widthBasisPoints: 5000 },
  { label: 'Large', widthBasisPoints: 7500 },
  { label: 'Full width', widthBasisPoints: 10000 },
] as const;

type EditorSession = {
  readonly noteId: NoteId;
  readonly crdt: YjsCrdtDocument;
  readonly materializer: EditMaterializer;
};

type Sheet = 'menu' | 'tags' | 'folder' | 'versions' | 'restore' | 'image';

type NativeEvent<T extends EditorEvent['type']> = {
  readonly nativeEvent: Extract<EditorEvent, { type: T }>;
};

function asIntakeClient(handle: JotEditorNativeHandle | null): NativeIntakeClient | null {
  return handle;
}

function noteIdFromParam(value: string | undefined): NoteId | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  try {
    return parseId<NoteId>(value);
  } catch {
    return undefined;
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

/** Empty means "remove the link". Null means the address cannot be a link. */
function normalizeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return '';
  }
  let candidate = trimmed;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    candidate = /^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(trimmed)
      ? `mailto:${trimmed}`
      : `https://${trimmed}`;
  }
  return isAllowedHref(candidate) ? candidate : null;
}

export default function NoteEditorScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const vault = useVault();
  const vaultRef = useRef(vault);
  vaultRef.current = vault;
  const params = useLocalSearchParams<{ id: string }>();
  const noteId = noteIdFromParam(typeof params.id === 'string' ? params.id : undefined);
  const note = vault.notes.find((entry) => entry.id === noteId);

  const nativeRef = useRef<JotEditorNativeHandle>(null);
  const sessionRef = useRef<EditorSession | undefined>(undefined);
  const attachedRef = useRef<NoteId | undefined>(undefined);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const latestDocumentRef = useRef<Document | undefined>(undefined);
  const revisionRef = useRef<DocumentRevision>(ZERO_REVISION);

  const [nativeReady, setNativeReady] = useState(false);
  const [nativeMissing, setNativeMissing] = useState(false);
  const [loaded, setLoaded] = useState<Document | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [format, setFormat] = useState<FormatState>(EMPTY_FORMAT_STATE);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [imageTarget, setImageTarget] = useState<{
    nodeId: NodeId;
    widthBasisPoints: number;
  } | null>(null);
  const [tagPromptOpen, setTagPromptOpen] = useState(false);
  const [tagName, setTagName] = useState('');
  const [versions, setVersions] = useState<readonly VersionSnapshot[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<VersionSnapshot | null>(null);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (nativeReady) {
      return;
    }
    const timer = setTimeout(() => {
      setNativeMissing(true);
    }, 1500);
    return () => {
      clearTimeout(timer);
    };
  }, [nativeReady]);

  useEffect(() => {
    if (noteId === undefined) {
      return;
    }
    const request = { cancelled: false };
    attachedRef.current = undefined;
    sessionRef.current = undefined;
    setLoaded(undefined);
    void (async () => {
      try {
        const stored = withEditableBody(await vaultRef.current.getDocument(noteId));
        if (request.cancelled) {
          return;
        }
        const crdt = YjsCrdtDocument.fromCanonical(stored);
        sessionRef.current = {
          noteId,
          crdt,
          materializer: new EditMaterializer(
            crdt,
            createNativeIntakeLedger(() => asIntakeClient(nativeRef.current)),
          ),
        };
        latestDocumentRef.current = stored;
        setLoaded(stored);
      } catch (error) {
        if (!request.cancelled) {
          setLoadError(messageOf(error, 'Jot could not open this note.'));
        }
      }
    })();
    return () => {
      request.cancelled = true;
    };
  }, [noteId]);

  // Hand the document to the native editor once both exist, then replay anything the editor
  // journaled that never reached the database, and restore undo history from earlier sessions.
  useEffect(() => {
    const session = sessionRef.current;
    const native = nativeRef.current;
    if (
      !nativeReady ||
      loaded === undefined ||
      session === undefined ||
      native === null ||
      noteId === undefined
    ) {
      return;
    }
    if (attachedRef.current === noteId) {
      return;
    }
    attachedRef.current = noteId;
    void (async () => {
      try {
        if (typeof native.setAppliedTransactionIds === 'function') {
          await native.setAppliedTransactionIds(
            await vaultRef.current.listAppliedTransactionIds(noteId),
          );
        }
        await native.loadDocument(noteId, loaded, SCHEMA_VERSION, ZERO_REVISION);
        let base = session.crdt.getCanonicalDocument();
        await session.materializer.recover(async (record) => {
          const next = session.crdt.getCanonicalDocument();
          await vaultRef.current.commitEdit({
            noteId,
            transactionId: record.transactionId,
            operations: record.operations,
            crdtUpdate: session.materializer.lastUpdate(),
            document: next,
            baseDocument: base,
          });
          base = next;
          latestDocumentRef.current = next;
        });
        const history = await vaultRef.current.listHistory(noteId);
        if (
          typeof native.seedHistory === 'function' &&
          (history.undo.length > 0 || history.redo.length > 0)
        ) {
          await native.seedHistory(history.undo, history.redo);
        }
        if (isBlankDocument(loaded)) {
          await native.focus();
        }
      } catch (error) {
        setEditError(messageOf(error, 'Jot could not finish opening this note.'));
      }
    })();
  }, [loaded, nativeReady, noteId]);

  // A note created with New note and left empty is removed instead of cluttering the list.
  // Only that case: an existing note with an empty body may still have a title, or edits
  // waiting in the recovery journal, and deleting it would lose them.
  const createdForThisVisit = useLocalSearchParams<{ new?: string }>().new === '1';
  useEffect(() => {
    return () => {
      const id = noteId;
      const document = latestDocumentRef.current;
      if (
        !createdForThisVisit ||
        id === undefined ||
        document === undefined ||
        !isBlankDocument(document)
      ) {
        return;
      }
      const current = vaultRef.current.notes.find((entry) => entry.id === id);
      if (
        current === undefined ||
        current.title.trim().length > 0 ||
        current.pinned ||
        current.trashed ||
        current.tagIds.length > 0
      ) {
        return;
      }
      void queueRef.current
        .then(() => vaultRef.current.deleteNotePermanently(id))
        .catch(() => undefined);
    };
  }, [noteId]);

  const persist = useCallback(
    async (
      session: EditorSession,
      transactionId: TransactionId,
      operations: readonly SchemaOperation[],
      history?: HistoryStep,
    ) => {
      const baseDocument = session.crdt.getCanonicalDocument();
      let nextDocument: Document | undefined;
      await session.materializer.materialize({ transactionId, operations }, async () => {
        nextDocument = session.crdt.getCanonicalDocument();
        await vaultRef.current.commitEdit({
          noteId: session.noteId,
          transactionId,
          operations,
          crdtUpdate: session.materializer.lastUpdate(),
          document: nextDocument,
          baseDocument,
          ...(history === undefined ? {} : { history }),
        });
      });
      if (nextDocument !== undefined) {
        latestDocumentRef.current = nextDocument;
      }
    },
    [],
  );

  const onCommitted = useCallback(
    (event: NativeEvent<'committedTransaction'>) => {
      const session = sessionRef.current;
      if (session === undefined) {
        return;
      }
      const { transactionId, operations, origin, historyOf, baseRevision } = event.nativeEvent;
      revisionRef.current = (baseRevision + 1) as DocumentRevision;
      // Edits are saved one at a time, in the order the editor made them.
      queueRef.current = queueRef.current
        .then(async () => {
          const history: HistoryStep | undefined =
            (origin === 'undo' || origin === 'redo') && historyOf !== undefined
              ? { kind: origin, transactionId: historyOf }
              : undefined;
          await persist(
            session,
            parseId<TransactionId>(transactionId),
            parseSchemaOperations(operations),
            history,
          );
        })
        .catch((error: unknown) => {
          setEditError(
            messageOf(
              error,
              'Jot could not save that change. It stays in the recovery journal and is retried when the note opens.',
            ),
          );
        });
    },
    [persist],
  );

  const dispatch = useCallback((command: EditorCommand) => {
    const native = nativeRef.current;
    if (native === null) {
      return;
    }
    native.dispatchCommand(command).catch((error: unknown) => {
      setEditError(messageOf(error, 'That change did not apply.'));
    });
  }, []);

  const addImage = useCallback(
    async (asset: ImageAsset) => {
      if (noteId === undefined) {
        return;
      }
      try {
        const imported = await vaultRef.current.importImage(noteId, asset);
        dispatch({
          name: 'insertImage',
          attachmentId: imported.attachmentId,
          alt: '',
          path: imported.path,
          widthBasisPoints: 10000,
        });
      } catch (error) {
        setEditError(messageOf(error, 'Jot could not add that image.'));
      }
    },
    [dispatch, noteId],
  );

  const pickImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        exif: false,
        // HEIC becomes JPEG, which every Markdown viewer can show after export.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      const asset = result.canceled ? undefined : result.assets[0];
      if (asset === undefined) {
        return;
      }
      await addImage({
        uri: asset.uri,
        mimeType: asset.mimeType ?? null,
        fileName: asset.fileName ?? null,
        width: asset.width,
        height: asset.height,
      });
    } catch (error) {
      setEditError(messageOf(error, 'Jot could not open your photo library.'));
    }
  }, [addImage]);

  const onPaste = useCallback(
    (event: NativeEvent<'pasteRequested'>) => {
      const { imagePath, text } = event.nativeEvent;
      if (imagePath !== undefined) {
        void addImage({ uri: imagePath, mimeType: 'image/jpeg', fileName: 'Pasted image.jpg' });
        return;
      }
      if (text !== undefined && text.length > 0) {
        const nodes = markdownToBlocks(text);
        if (nodes.length > 0) {
          dispatch({ name: 'insertBlocks', nodes });
        }
      }
    },
    [addImage, dispatch],
  );

  const runNoteCommand = useCallback(async (run: () => Promise<void>, failure: string) => {
    try {
      await run();
    } catch (error) {
      setEditError(messageOf(error, failure));
    }
  }, []);

  const openVersions = useCallback(async () => {
    if (noteId === undefined) {
      return;
    }
    setVersions(await vaultRef.current.listVersions(noteId));
    setSheet('versions');
  }, [noteId]);

  const restoreVersion = useCallback(
    async (version: VersionSnapshot) => {
      const session = sessionRef.current;
      const native = nativeRef.current;
      if (
        session === undefined ||
        native === null ||
        noteId === undefined ||
        typeof native.applyTransactions !== 'function'
      ) {
        return;
      }
      try {
        const target = await vaultRef.current.versionDocument(noteId, version.id);
        // Let queued edits land first so the diff starts from what the editor shows.
        await queueRef.current;
        const operations = documentDiffOperations(session.crdt.getCanonicalDocument(), target);
        if (operations.length === 0) {
          return;
        }
        await native.applyTransactions(
          noteId,
          revisionRef.current,
          [{ transactionId: createId<TransactionId>(), operations }],
          'local',
        );
      } catch (error) {
        setEditError(messageOf(error, 'Jot could not restore that version.'));
      }
    },
    [noteId],
  );

  const folderTree = useMemo(
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

  if (noteId === undefined) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]} edges={['top']}>
        <Header
          palette={palette}
          onBack={() => {
            router.back();
          }}
        />
        <ErrorBanner
          palette={palette}
          message="This link does not point to a note."
          actionLabel="Back to notes"
          onAction={() => {
            router.back();
          }}
        />
      </SafeAreaView>
    );
  }

  const sheetContent = ((): {
    title: string;
    message?: string;
    align: 'center' | 'leading';
    actions: ActionItem[];
  } => {
    if (sheet === 'menu' && note !== undefined) {
      const tagNames = vault.tags
        .filter((tag) => note.tagIds.includes(tag.id))
        .map((tag) => tag.name);
      const folder = vault.folders.find((entry) => entry.id === note.folderId);
      return {
        title: '',
        align: 'center',
        actions: [
          {
            key: 'pin',
            label: note.pinned ? 'Unpin' : 'Pin',
            onPress: () => {
              void runNoteCommand(
                () => vault.applyNoteCommand({ type: 'pin', noteId, pinned: !note.pinned }),
                'Jot could not update this note.',
              );
            },
          },
          {
            key: 'tags',
            label: 'Tags',
            detail: tagNames.length === 0 ? 'None' : tagNames.join(', '),
            keepOpen: true,
            onPress: () => {
              setSheet('tags');
            },
          },
          {
            key: 'folder',
            label: 'Move to folder',
            detail: folder?.name ?? 'No folder',
            keepOpen: true,
            onPress: () => {
              setSheet('folder');
            },
          },
          {
            key: 'versions',
            label: 'Version history',
            keepOpen: true,
            onPress: () => {
              void openVersions();
            },
          },
          {
            key: 'archive',
            label: note.archived ? 'Move out of archive' : 'Archive',
            onPress: () => {
              void runNoteCommand(
                () => vault.applyNoteCommand({ type: 'archive', noteId, archived: !note.archived }),
                'Jot could not update this note.',
              );
            },
          },
          {
            key: 'trash',
            label: 'Move to trash',
            destructive: true,
            onPress: () => {
              void runNoteCommand(async () => {
                await vault.applyNoteCommand({ type: 'trash', noteId });
                router.back();
              }, 'Jot could not move this note to the trash.');
            },
          },
        ],
      };
    }
    if (sheet === 'tags' && note !== undefined) {
      return {
        title: 'Tags',
        align: 'leading',
        actions: [
          ...vault.tags.map((tag) => {
            const attached = note.tagIds.includes(tag.id);
            return {
              key: tag.id,
              label: tag.name,
              selected: attached,
              keepOpen: true,
              onPress: () => {
                void runNoteCommand(
                  () => vault.setNoteTag(noteId, tag.id, !attached),
                  'Jot could not change tags.',
                );
              },
            };
          }),
          {
            key: 'new',
            label: 'New tag…',
            onPress: () => {
              setTagName('');
              setTagPromptOpen(true);
            },
          },
        ],
      };
    }
    if (sheet === 'folder' && note !== undefined) {
      const moveTo = (folderId: FolderId | null) => {
        void runNoteCommand(
          () => vault.applyNoteCommand({ type: 'move', noteId, folderId }),
          'Jot could not move this note.',
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
          ...folderTree.map((node) => ({
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
    if (sheet === 'versions') {
      return {
        title: 'Version history',
        message:
          versions.length === 0
            ? 'Jot saves versions while you write. None exist for this note yet.'
            : 'Restoring a version is an edit, so Undo brings back what you have now.',
        align: 'leading',
        actions: [
          {
            key: 'save',
            label: 'Save a version now',
            keepOpen: true,
            onPress: () => {
              void runNoteCommand(async () => {
                await vault.saveVersion(noteId);
                setVersions(await vault.listVersions(noteId));
              }, 'Jot could not save a version.');
            },
          },
          ...versions.map((version) => ({
            key: version.id,
            label: formatFullDate(version.createdWallMs),
            detail: version.tier === 'manual' ? 'Saved by you' : 'Saved automatically',
            keepOpen: true,
            onPress: () => {
              setRestoreTarget(version);
              setSheet('restore');
            },
          })),
        ],
      };
    }
    if (sheet === 'restore' && restoreTarget !== null) {
      return {
        title: `Restore the version from ${formatFullDate(restoreTarget.createdWallMs)}?`,
        align: 'center',
        actions: [
          {
            key: 'restore',
            label: 'Restore this version',
            onPress: () => {
              void restoreVersion(restoreTarget);
            },
          },
        ],
      };
    }
    if (sheet === 'image' && imageTarget !== null) {
      return {
        title: 'Image size',
        message: 'You can also pinch the image to pick any size.',
        align: 'center',
        actions: [
          ...IMAGE_SIZES.map((size) => ({
            key: size.label,
            label: size.label,
            selected: Math.abs(size.widthBasisPoints - imageTarget.widthBasisPoints) < 300,
            onPress: () => {
              dispatch({
                name: 'setImageWidth',
                nodeId: imageTarget.nodeId,
                widthBasisPoints: size.widthBasisPoints,
              });
            },
          })),
          {
            key: 'remove',
            label: 'Remove image',
            destructive: true,
            onPress: () => {
              dispatch({ name: 'removeBlock', nodeId: imageTarget.nodeId });
            },
          },
        ],
      };
    }
    return { title: '', align: 'center', actions: [] };
  })();

  const showMissing = nativeMissing && !nativeReady && loaded !== undefined;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]} edges={['top']}>
      <StatusBar style={palette.ink === tokens.color.dark.ink ? 'light' : 'dark'} />
      {/* Android draws edge-to-edge, so adjustResize never shrinks the window. Without padding here
          the keyboard covers the format bar. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <Header
          palette={palette}
          onBack={() => {
            router.back();
          }}
        >
          {focused ? (
            <>
              <HeaderIcon
                palette={palette}
                glyph="undo"
                label="Undo"
                disabled={!canUndo}
                onPress={() => {
                  void nativeRef.current?.undo();
                }}
              />
              <HeaderIcon
                palette={palette}
                glyph="redo"
                label="Redo"
                disabled={!canRedo}
                onPress={() => {
                  void nativeRef.current?.redo();
                }}
              />
              <Pressable
                onPress={() => {
                  void nativeRef.current?.blur();
                }}
                accessibilityRole="button"
                accessibilityLabel="Done"
                hitSlop={tokens.spacing.scale.space8}
                style={({ pressed }) => [styles.done, pressedStyle(pressed)]}
              >
                <Text
                  style={[styles.doneLabel, { color: palette.accent, fontFamily: uiFontFamily() }]}
                >
                  Done
                </Text>
              </Pressable>
            </>
          ) : (
            <HeaderIcon
              palette={palette}
              glyph="more"
              label="Note options"
              disabled={note === undefined}
              onPress={() => {
                setSheet('menu');
              }}
            />
          )}
        </Header>
        {loadError !== null ? (
          <ErrorBanner
            palette={palette}
            message={loadError}
            actionLabel="Back to notes"
            onAction={() => {
              router.back();
            }}
          />
        ) : null}
        {note?.trashed === true ? (
          <ErrorBanner
            palette={palette}
            message="This note is in the trash."
            actionLabel="Restore note"
            onAction={() => {
              void runNoteCommand(
                () => vault.applyNoteCommand({ type: 'restore', noteId }),
                'Jot could not restore this note.',
              );
            }}
          />
        ) : null}
        {editError !== null ? (
          <ErrorBanner
            palette={palette}
            message={editError}
            actionLabel="Dismiss"
            onAction={() => {
              setEditError(null);
            }}
          />
        ) : null}
        {note !== undefined && note.modifiedMs > 0 && !focused ? (
          <Text style={[styles.date, { color: palette.inkFaint, fontFamily: uiFontFamily() }]}>
            {formatFullDate(note.modifiedMs)}
          </Text>
        ) : null}
        <View style={styles.editor}>
          {showMissing ? (
            <Text style={[styles.missing, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>
              The native editor is not in this build. Rebuild the Jot development client to write
              here.
            </Text>
          ) : null}
          <JotEditorView
            ref={nativeRef}
            documentId={noteId}
            schemaVersion={SCHEMA_VERSION}
            revision={ZERO_REVISION}
            {...(vault.attachmentsDirectory === null
              ? {}
              : { attachmentsDirectory: vault.attachmentsDirectory })}
            placeholder="Start writing"
            accentColor={palette.accent}
            onReady={() => {
              setNativeReady(true);
            }}
            onCommittedTransaction={onCommitted}
            onSelectionChanged={(event) => {
              const {
                activeMarks,
                block,
                canUndo: undoable,
                canRedo: redoable,
              } = event.nativeEvent;
              setFormat({
                marks: new Set(activeMarks.map((mark) => mark.type)),
                blockKind: block?.kind ?? 'paragraph',
                headingLevel: block?.headingLevel,
                inQuote: block?.inQuote === true,
              });
              setCanUndo(undoable === true);
              setCanRedo(redoable === true);
            }}
            onFocusChanged={(event) => {
              setFocused(event.nativeEvent.focused);
            }}
            onImagePressed={(event) => {
              setImageTarget({
                nodeId: event.nativeEvent.nodeId,
                widthBasisPoints: event.nativeEvent.widthBasisPoints,
              });
              setSheet('image');
            }}
            onPasteRequested={onPaste}
            onRecoverableError={(event) => {
              setEditError(
                `The editor reported ${event.nativeEvent.code} (${event.nativeEvent.context}).`,
              );
            }}
            style={styles.native}
          />
        </View>
        <FormatBar
          palette={palette}
          state={format}
          panelOpen={panelOpen}
          keyboardVisible={keyboardVisible}
          bottomInset={insets.bottom}
          onTogglePanel={() => {
            setPanelOpen((open) => !open);
          }}
          onCommand={dispatch}
          onInsertImage={() => {
            void pickImage();
          }}
          onLink={() => {
            setHref('');
            setLinkOpen(true);
          }}
          onDismissKeyboard={() => {
            void nativeRef.current?.blur();
          }}
        />
      </KeyboardAvoidingView>
      <ActionSheet
        palette={palette}
        visible={sheet !== null && sheetContent.actions.length > 0}
        title={sheetContent.title}
        {...(sheetContent.message === undefined ? {} : { message: sheetContent.message })}
        align={sheetContent.align}
        actions={sheetContent.actions}
        cancelLabel={sheet === 'tags' || sheet === 'versions' ? 'Done' : 'Cancel'}
        onClose={() => {
          setSheet(null);
        }}
      />
      <PromptModal
        palette={palette}
        visible={linkOpen}
        title={format.marks.has('link') ? 'Edit link' : 'Add link'}
        placeholder="example.com"
        value={href}
        onChange={setHref}
        confirmLabel={href.trim().length === 0 && format.marks.has('link') ? 'Remove link' : 'Save'}
        keyboardType="url"
        autoCapitalize="none"
        onCancel={() => {
          setLinkOpen(false);
        }}
        onConfirm={() => {
          const normalized = normalizeHref(href);
          if (normalized === null) {
            setEditError('Links can start with https, http, or mailto.');
            return;
          }
          setLinkOpen(false);
          dispatch(
            normalized === '' ? { name: 'unsetLink' } : { name: 'setLink', href: normalized },
          );
        }}
      />
      <PromptModal
        palette={palette}
        visible={tagPromptOpen}
        title="New tag"
        placeholder="Name"
        value={tagName}
        onChange={setTagName}
        confirmLabel="Add tag"
        onCancel={() => {
          setTagPromptOpen(false);
        }}
        onConfirm={() => {
          setTagPromptOpen(false);
          void runNoteCommand(async () => {
            const tag = await vault.createTag(tagName);
            await vault.setNoteTag(noteId, tag.id, true);
          }, 'Jot could not add that tag.');
        }}
      />
    </SafeAreaView>
  );
}

function Header({
  palette,
  onBack,
  children,
}: {
  readonly palette: ReturnType<typeof usePalette>;
  readonly onBack: () => void;
  readonly children?: React.ReactNode;
}) {
  return (
    <GlassSurface palette={palette} style={[styles.header, { borderBottomColor: palette.hairline }]}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Notes"
        hitSlop={tokens.spacing.scale.space8}
        style={({ pressed }) => [styles.back, pressedStyle(pressed)]}
      >
        <Glyph name="back" color={palette.accent} size={28} />
        <Text
          style={[
            styles.backLabel,
            {
              color: palette.accent,
              fontFamily: uiFontFamily(),
              marginLeft:
                Platform.OS === 'ios'
                  ? -tokens.spacing.scale.space2
                  : tokens.spacing.scale.space2,
            },
          ]}
        >
          Notes
        </Text>
      </Pressable>
      <View style={styles.headerSpacer} />
      {children}
    </GlassSurface>
  );
}

function HeaderIcon({
  palette,
  glyph,
  label,
  disabled = false,
  onPress,
}: {
  readonly palette: ReturnType<typeof usePalette>;
  readonly glyph: GlyphName;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.headerIcon, pressedStyle(pressed)]}
    >
      <Glyph name={glyph} color={disabled ? palette.inkFaint : palette.accent} size={24} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    minHeight: touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: tokens.spacing.scale.space4,
    paddingRight: tokens.spacing.scale.space8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    minHeight: touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: tokens.spacing.scale.space8,
  },
  backLabel: {
    fontSize: typeSize.body,
  },
  headerSpacer: {
    flex: 1,
  },
  headerIcon: {
    minWidth: touchMin,
    minHeight: touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  done: {
    minHeight: touchMin,
    paddingHorizontal: tokens.spacing.scale.space8,
    justifyContent: 'center',
  },
  doneLabel: {
    fontSize: typeSize.body,
    fontWeight: '600',
  },
  date: {
    fontSize: typeSize.footnote,
    textAlign: 'center',
    paddingBottom: tokens.spacing.scale.space4,
  },
  editor: {
    flex: 1,
  },
  native: {
    flex: 1,
  },
  missing: {
    fontSize: typeSize.subhead,
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingVertical: tokens.spacing.scale.space8,
  },
});
