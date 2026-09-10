import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { tokens } from '@jot/tokens/generated';
import { EditMaterializer, MemoryIntakeLedger, YjsCrdtDocument } from '@jot/core';
import {
  HeadlessEditorHost,
  JotEditorView,
  createNativeIntakeLedger,
  parseSchemaOperations,
  type DocumentRevision,
  type EditorCommand,
  type JotEditorNativeHandle,
  type NativeIntakeClient,
} from '@jot/editor-native';
import { parseId, SCHEMA_VERSION } from '@jot/schema';
import type { Document, NoteId, TransactionId } from '@jot/schema';
import { AppHeader } from '../../src/components/AppHeader';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { FormatBar, asNativeCommand, type FormatCommand } from '../../src/components/FormatBar';
import { PromptModal } from '../../src/components/PromptModal';
import { editorBodySize, editorFontFamily, uiFontFamily, usePalette } from '../../src/theme';
import { useVault } from '../../src/vault-context';

const ZERO_REVISION = 0 as DocumentRevision;

type EditorSession = {
  readonly crdt: YjsCrdtDocument;
  readonly materializer: EditMaterializer;
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

export default function NoteEditorScreen() {
  const palette = usePalette();
  const vault = useVault();
  const params = useLocalSearchParams<{ id: string }>();
  const noteId = noteIdFromParam(typeof params.id === 'string' ? params.id : undefined);
  const note = vault.notes.find((entry) => entry.id === noteId);
  const nativeRef = useRef<JotEditorNativeHandle>(null);
  const hostRef = useRef(new HeadlessEditorHost());
  const nativeReadyRef = useRef(false);
  const composingRef = useRef(false);
  const sessionRef = useRef<EditorSession | undefined>(undefined);
  const getDocumentRef = useRef(vault.getDocument);
  const commitEditRef = useRef(vault.commitEdit);
  const loadGen = useRef(0);
  const [nativeReady, setNativeReady] = useState(false);
  const [revision, setRevision] = useState(ZERO_REVISION);
  const [document, setDocument] = useState<Document | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('https://');
  getDocumentRef.current = vault.getDocument;
  commitEditRef.current = vault.commitEdit;

  useEffect(() => {
    if (noteId === undefined) {
      setLoadError('This note id is not valid.');
      return;
    }
    const requestId = loadGen.current + 1;
    loadGen.current = requestId;
    void (async () => {
      try {
        const loaded = await getDocumentRef.current(noteId);
        if (loadGen.current !== requestId) {
          return;
        }
        setDocument(loaded);
        const crdt = YjsCrdtDocument.fromCanonical(loaded);
        const ledger = nativeReadyRef.current
          ? createNativeIntakeLedger(() => asIntakeClient(nativeRef.current))
          : new MemoryIntakeLedger();
        sessionRef.current = { crdt, materializer: new EditMaterializer(crdt, ledger) };
        setRevision(ZERO_REVISION);
        const host = hostRef.current;
        await host.loadDocument(noteId, loaded, SCHEMA_VERSION, ZERO_REVISION);
        if (loadGen.current !== requestId) {
          return;
        }
        const native = nativeRef.current;
        if (
          nativeReadyRef.current &&
          native !== null &&
          typeof native.loadDocument === 'function'
        ) {
          await native.loadDocument(noteId, loaded, SCHEMA_VERSION, ZERO_REVISION);
        }
      } catch (error) {
        if (loadGen.current === requestId) {
          setLoadError(error instanceof Error ? error.message : 'Could not open this note.');
        }
      }
    })();
  }, [noteId]);

  if (noteId === undefined) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]} edges={['top']}>
        <AppHeader
          palette={palette}
          title="Note"
          leftLabel="Notes"
          onLeft={() => {
            router.back();
          }}
        />
        <ErrorBanner
          palette={palette}
          message="This note id is not valid."
          actionLabel="Back to notes"
          onAction={() => {
            router.back();
          }}
        />
      </SafeAreaView>
    );
  }

  const ingest = (transactionId: string, operations: unknown, baseRevision: number): void => {
    if (composingRef.current) {
      return;
    }
    const session = sessionRef.current;
    if (session === undefined) {
      return;
    }
    void (async () => {
      try {
        const parsed = parseSchemaOperations(operations);
        const parsedTransactionId = parseId<TransactionId>(transactionId);
        const baseDocument = session.crdt.getCanonicalDocument();
        let nextDocument: Document | undefined;
        await session.materializer.materialize(
          {
            transactionId: parsedTransactionId,
            operations: parsed,
          },
          async () => {
            nextDocument = session.crdt.getCanonicalDocument();
            await commitEditRef.current({
              noteId,
              transactionId: parsedTransactionId,
              operations: parsed,
              crdtUpdate: session.materializer.lastUpdate(),
              document: nextDocument,
              baseDocument,
            });
          },
        );
        if (nextDocument === undefined) {
          throw new Error('The editor produced no document for this edit.');
        }
        setRevision((baseRevision + 1) as DocumentRevision);
        setDocument(nextDocument);
      } catch (error) {
        setEditError(error instanceof Error ? error.message : 'Could not save this edit.');
      }
    })();
  };

  const dispatch = (command: EditorCommand): void => {
    const native = nativeRef.current;
    if (nativeReady && native !== null && typeof native.dispatchCommand === 'function') {
      void native.dispatchCommand(command);
      return;
    }
    void hostRef.current.dispatchCommand(command);
  };

  const undoRedo = (action: 'undo' | 'redo'): void => {
    const native = nativeRef.current;
    if (nativeReady && native !== null && typeof native[action] === 'function') {
      void native[action]();
      return;
    }
    void hostRef.current[action]();
  };

  const onFormat = (command: FormatCommand): void => {
    dispatch(asNativeCommand(command));
  };

  const title = note?.title.trim() === '' || note === undefined ? 'Untitled' : note.title;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]} edges={['top']}>
      <StatusBar style={palette.ink === tokens.color.dark.ink ? 'light' : 'dark'} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <AppHeader
          palette={palette}
          title={title}
          leftLabel="Notes"
          onLeft={() => {
            router.back();
          }}
          rightLabel={note?.pinned === true ? 'Unpin' : 'Pin'}
          onRight={() => {
            if (note !== undefined) {
              void vault.applyNoteCommand({ type: 'pin', noteId, pinned: !note.pinned });
            }
          }}
        />
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
        <View style={styles.editor}>
          {nativeReady || document === undefined ? null : (
            <Text style={[styles.missing, { color: palette.inkMuted, fontFamily: uiFontFamily() }]}>
              Native editor is not linked. Rebuild the Jot development client to write here.
            </Text>
          )}
          <JotEditorView
            ref={nativeRef}
            documentId={noteId}
            schemaVersion={SCHEMA_VERSION}
            revision={revision}
            canonicalDocument={nativeReady ? undefined : document}
            onReady={() => {
              nativeReadyRef.current = true;
              setNativeReady(true);
              const current = document ?? sessionRef.current?.crdt.getCanonicalDocument();
              if (current === undefined) {
                return;
              }
              const crdt = sessionRef.current?.crdt ?? YjsCrdtDocument.fromCanonical(current);
              const materializer = new EditMaterializer(
                crdt,
                createNativeIntakeLedger(() => asIntakeClient(nativeRef.current)),
              );
              sessionRef.current = { crdt, materializer };
              const native = nativeRef.current;
              if (native !== null && typeof native.loadDocument === 'function') {
                void native.loadDocument(noteId, current, SCHEMA_VERSION, revision);
              }
              void (async () => {
                let baseDocument = crdt.getCanonicalDocument();
                try {
                  await materializer.recover(async (record) => {
                    const nextDocument = crdt.getCanonicalDocument();
                    await commitEditRef.current({
                      noteId,
                      transactionId: record.transactionId,
                      operations: record.operations,
                      crdtUpdate: materializer.lastUpdate(),
                      document: nextDocument,
                      baseDocument,
                    });
                    baseDocument = nextDocument;
                    setDocument(nextDocument);
                    setRevision((currentRevision) => (currentRevision + 1) as DocumentRevision);
                  });
                } catch (error) {
                  setEditError(
                    error instanceof Error ? error.message : 'Could not recover unsaved edits.',
                  );
                }
              })();
            }}
            onCommittedTransaction={(event) => {
              ingest(
                event.nativeEvent.transactionId,
                event.nativeEvent.operations,
                event.nativeEvent.baseRevision,
              );
            }}
            onCompositionChanged={(event) => {
              composingRef.current = event.nativeEvent.active;
            }}
            onRecoverableError={(event) => {
              setEditError(`${event.nativeEvent.code}: ${event.nativeEvent.context}`);
            }}
            style={styles.native}
          />
        </View>
        <FormatBar
          palette={palette}
          onCommand={onFormat}
          onUndo={() => {
            undoRedo('undo');
          }}
          onRedo={() => {
            undoRedo('redo');
          }}
          onLink={() => {
            setHref('https://');
            setLinkOpen(true);
          }}
        />
      </KeyboardAvoidingView>
      <PromptModal
        palette={palette}
        visible={linkOpen}
        title="Link"
        placeholder="https://"
        value={href}
        onChange={setHref}
        confirmLabel="Add link"
        keyboardType="url"
        autoCapitalize="none"
        onCancel={() => {
          setLinkOpen(false);
        }}
        onConfirm={() => {
          onFormat({ name: 'setLink', href: href.trim() });
          setLinkOpen(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  editor: {
    flex: 1,
  },
  native: {
    flex: 1,
    fontSize: editorBodySize,
    fontFamily: editorFontFamily(),
  },
  missing: {
    fontSize: editorBodySize,
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingVertical: tokens.spacing.scale.space8,
  },
});
