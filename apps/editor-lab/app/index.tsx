import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tokens } from '@jot/tokens/generated';
import {
  canonicalizeDocumentToString,
  deriveId,
  parseDocument,
  parseId,
  SCHEMA_VERSION,
} from '@jot/schema';
import type { Document, NoteId, SchemaSelection, TransactionId } from '@jot/schema';
import {
  EditMaterializer,
  MemoryIntakeLedger,
  YjsCrdtDocument,
  type IntakeLedger,
} from '@jot/core';
import {
  HeadlessEditorHost,
  JotEditorView,
  createNativeIntakeLedger,
  parseSchemaOperations,
  readNativeDocumentSnapshot,
  type DocumentRevision,
  type EditorCommand,
  type EditorEvent,
  type JotEditorNativeHandle,
  type NativeIntakeClient,
} from '@jot/editor-native';
import paragraphBoldJson from '../fixtures/paragraph-bold.json';
import listsTasksJson from '../fixtures/lists-tasks.json';
import headingsCodeJson from '../fixtures/headings-code.json';
import fiveThousandWordsJson from '../fixtures/five-thousand-words.json';

const LAB_SEED = parseId('aaaaaaaaaaaaaaaaaaaaaaaaaa');
const ZERO_REVISION = 0 as DocumentRevision;

type FixtureId = 'paragraph-bold' | 'lists-tasks' | 'headings-code' | 'five-thousand-words';

type ToolbarItem = {
  readonly label: string;
  readonly command: EditorCommand | 'undo' | 'redo';
};

const TOOLBAR: readonly ToolbarItem[] = [
  { label: 'Undo', command: 'undo' },
  { label: 'Redo', command: 'redo' },
  { label: 'B', command: { name: 'toggleBold' } },
  { label: 'I', command: { name: 'toggleItalic' } },
  { label: 'H1', command: { name: 'setHeading', level: 1 } },
  { label: 'H2', command: { name: 'setHeading', level: 2 } },
  { label: 'P', command: { name: 'setParagraph' } },
  { label: 'UL', command: { name: 'toggleBulletList' } },
  { label: 'OL', command: { name: 'toggleOrderedList' } },
  { label: 'Task', command: { name: 'toggleTaskList' } },
  { label: 'Code', command: { name: 'toggleCodeBlock' } },
];

const FIXTURES: readonly { readonly id: FixtureId; readonly label: string }[] = [
  { id: 'paragraph-bold', label: 'Bold para' },
  { id: 'lists-tasks', label: 'Lists' },
  { id: 'headings-code', label: 'Headings' },
  { id: 'five-thousand-words', label: '5k words' },
];

type Session = {
  readonly crdt: YjsCrdtDocument;
  readonly materializer: EditMaterializer;
};

function loadFixture(id: FixtureId): Document {
  switch (id) {
    case 'paragraph-bold':
      return parseDocument(paragraphBoldJson);
    case 'lists-tasks':
      return parseDocument(listsTasksJson);
    case 'headings-code':
      return parseDocument(headingsCodeJson);
    case 'five-thousand-words':
      return parseDocument(fiveThousandWordsJson);
  }
}

function noteIdForFixture(id: FixtureId): NoteId {
  return deriveId<NoteId>(LAB_SEED, `editor-lab:${id}`, 0);
}

function firstSelection(document: Document, revision: DocumentRevision): SchemaSelection | undefined {
  const block = document.content[0];
  if (block === undefined) {
    return undefined;
  }
  return { nodeId: block.id, offsetUtf16: 0, affinity: 'after', revision };
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function asIntakeClient(handle: JotEditorNativeHandle | null): NativeIntakeClient | null {
  return handle;
}

function createSession(document: Document, ledger: IntakeLedger): Session {
  const crdt = YjsCrdtDocument.fromCanonical(document);
  return { crdt, materializer: new EditMaterializer(crdt, ledger) };
}

export default function Index() {
  const dark = useColorScheme() === 'dark';
  const palette = dark ? tokens.color.dark : tokens.color.light;
  const hostRef = useRef(new HeadlessEditorHost());
  const nativeRef = useRef<JotEditorNativeHandle>(null);
  const nativeReadyRef = useRef(false);
  const composingRef = useRef(false);
  const sessionRef = useRef<Session | undefined>(undefined);
  const [nativeReady, setNativeReady] = useState(false);
  const [fixture, setFixture] = useState<FixtureId>('paragraph-bold');
  const [revision, setRevision] = useState(ZERO_REVISION);
  const [appliedCount, setAppliedCount] = useState(0);
  const [lastTxId, setLastTxId] = useState<TransactionId | undefined>(undefined);
  const [composing, setComposing] = useState(false);
  const [divergence, setDivergence] = useState<string | undefined>(undefined);
  const document = useMemo(() => loadFixture(fixture), [fixture]);
  const noteId = useMemo(() => noteIdForFixture(fixture), [fixture]);

  const syncHeader = (session: Session): void => {
    setAppliedCount(session.materializer.appliedCount());
    setLastTxId(session.materializer.lastTransactionId());
  };

  const ingestCommitted = (transactionId: string, operations: unknown, baseRevision: number): void => {
    if (composingRef.current) {
      return;
    }
    const session = sessionRef.current;
    if (session === undefined) {
      return;
    }
    void (async () => {
      try {
        await session.materializer.materialize(
          {
            transactionId: parseId<TransactionId>(transactionId),
            operations: parseSchemaOperations(operations),
          },
          () => Promise.resolve(),
        );
        setRevision((baseRevision + 1) as DocumentRevision);
        syncHeader(session);
      } catch (error) {
        setDivergence(error instanceof Error ? error.message : 'materialize failed');
      }
    })();
  };

  const recoverAndCompare = async (): Promise<void> => {
    const session = sessionRef.current;
    if (session === undefined) {
      return;
    }
    try {
      await session.materializer.recover(() => Promise.resolve());
      syncHeader(session);
    } catch (error) {
      setDivergence(error instanceof Error ? error.message : 'recover failed');
      return;
    }
    const snapshot = await readNativeDocumentSnapshot(() => asIntakeClient(nativeRef.current));
    if (snapshot === undefined) {
      return;
    }
    const yjs = session.crdt.getCanonicalDocument();
    if (canonicalizeDocumentToString(snapshot) !== canonicalizeDocumentToString(yjs)) {
      setDivergence('native snapshot diverges from Yjs canonical Document');
    }
  };

  const onHostEvent = (event: EditorEvent): void => {
    if (event.type === 'compositionChanged') {
      composingRef.current = event.active;
      setComposing(event.active);
      return;
    }
    if (event.type === 'committedTransaction') {
      ingestCommitted(event.transactionId, event.operations, event.baseRevision);
    }
  };

  useEffect(() => {
    const ledger: IntakeLedger = nativeReadyRef.current
      ? createNativeIntakeLedger(() => asIntakeClient(nativeRef.current))
      : new MemoryIntakeLedger();
    const session = createSession(document, ledger);
    sessionRef.current = session;
    setAppliedCount(0);
    setLastTxId(undefined);
    setRevision(ZERO_REVISION);
    setDivergence(undefined);
    composingRef.current = false;
    setComposing(false);

    const host = hostRef.current;
    const unsubscribe = host.subscribe(onHostEvent);
    const selection = firstSelection(document, ZERO_REVISION);
    void (async () => {
      await host.loadDocument(noteId, document, SCHEMA_VERSION, ZERO_REVISION);
      if (selection !== undefined) {
        await host.setSelection(selection);
      }
      const native = nativeRef.current;
      if (nativeReadyRef.current && native !== null && typeof native.loadDocument === 'function') {
        await native.loadDocument(noteId, document, SCHEMA_VERSION, ZERO_REVISION);
        await recoverAndCompare();
      }
    })();
    return () => {
      unsubscribe();
    };
  }, [document, noteId]);

  const onFixture = (id: FixtureId): void => {
    setFixture(id);
  };

  const onUndoRedo = (action: 'undo' | 'redo'): void => {
    const native = nativeRef.current;
    if (nativeReady && native !== null && typeof native[action] === 'function') {
      void native[action]();
      return;
    }
    void hostRef.current[action]();
  };

  const onCommand = (command: EditorCommand): void => {
    const native = nativeRef.current;
    if (nativeReady && native !== null && typeof native.dispatchCommand === 'function') {
      void native.dispatchCommand(command);
      return;
    }
    void hostRef.current.dispatchCommand(command);
  };

  const meta = [
    fixture,
    lastTxId === undefined ? 'tx none' : `tx ${shortId(lastTxId)}`,
    `applied ${String(appliedCount)}`,
    composing ? 'ime' : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.ink }]}>Editor lab</Text>
          <Text style={[styles.meta, { color: palette.inkMuted }]}>{meta}</Text>
        </View>
        {divergence === undefined ? null : (
          <Text style={[styles.error, { color: palette.error }]}>{divergence}</Text>
        )}
        <ScrollView
          horizontal
          style={styles.fixtureRow}
          contentContainerStyle={styles.fixtureContent}
          showsHorizontalScrollIndicator={false}
        >
          {FIXTURES.map((item) => {
            const selected = item.id === fixture;
            return (
              <Pressable
                key={item.id}
                onPress={() => {
                  onFixture(item.id);
                }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: selected ? palette.accentMuted : palette.surface,
                    borderColor: selected ? palette.accent : palette.hairline,
                  },
                ]}
              >
                <Text style={[styles.chipLabel, { color: palette.ink }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View
          style={[
            styles.editorFrame,
            { backgroundColor: palette.surface, borderColor: palette.hairline },
          ]}
        >
          {nativeReady ? null : (
            <Text style={[styles.placeholderTitle, { color: palette.inkMuted }]}>
              Native JotEditor not linked. Headless host is active until you rebuild the editor-lab
              dev client.
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
              const crdt = sessionRef.current?.crdt ?? YjsCrdtDocument.fromCanonical(document);
              const materializer = new EditMaterializer(
                crdt,
                createNativeIntakeLedger(() => asIntakeClient(nativeRef.current)),
              );
              sessionRef.current = { crdt, materializer };
              void recoverAndCompare();
            }}
            onCommittedTransaction={(event) => {
              const nativeEvent = event.nativeEvent;
              ingestCommitted(
                nativeEvent.transactionId,
                nativeEvent.operations,
                nativeEvent.baseRevision,
              );
            }}
            onCompositionChanged={(event) => {
              const active = event.nativeEvent.active;
              composingRef.current = active;
              setComposing(active);
            }}
            onRecoverableError={(event) => {
              setDivergence(`${event.nativeEvent.code}: ${event.nativeEvent.context}`);
            }}
            style={styles.nativeEditor}
          />
        </View>
        <View style={[styles.toolbar, { backgroundColor: palette.surface, borderColor: palette.hairline }]}>
          {TOOLBAR.map((item) => (
            <Pressable
              key={item.label}
              onPress={() => {
                if (item.command === 'undo' || item.command === 'redo') {
                  onUndoRedo(item.command);
                  return;
                }
                onCommand(item.command);
              }}
              style={[styles.tool, { borderColor: palette.hairline, backgroundColor: palette.canvas }]}
            >
              <Text style={[styles.toolLabel, { color: palette.ink }]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </KeyboardAvoidingView>
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
  header: {
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingTop: tokens.spacing.scale.space8,
    paddingBottom: tokens.spacing.scale.space8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: tokens.spacing.scale.space8,
  },
  title: {
    fontSize: tokens.type.editor.body.size,
    fontWeight: '600',
  },
  meta: {
    fontSize: 13,
    flexShrink: 1,
  },
  error: {
    fontSize: 13,
    paddingHorizontal: tokens.spacing.scale.space16,
    paddingBottom: tokens.spacing.scale.space8,
  },
  fixtureRow: {
    flexGrow: 0,
    flexShrink: 0,
  },
  fixtureContent: {
    paddingHorizontal: tokens.spacing.scale.space16,
    gap: tokens.spacing.scale.space8,
    paddingBottom: tokens.spacing.scale.space8,
  },
  chip: {
    borderWidth: 1,
    borderRadius: tokens.radius.pill,
    paddingHorizontal: tokens.spacing.scale.space12,
    paddingVertical: tokens.spacing.scale.space8,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  editorFrame: {
    flex: 1,
    marginHorizontal: tokens.spacing.scale.space16,
    borderWidth: 1,
    borderRadius: tokens.radius.control,
    padding: tokens.spacing.scale.space12,
  },
  nativeEditor: {
    flex: 1,
  },
  placeholderTitle: {
    fontSize: tokens.type.editor.body.size,
    fontWeight: '600',
    marginBottom: tokens.spacing.scale.space8,
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacing.scale.space8,
    padding: tokens.spacing.scale.space8,
    borderTopWidth: 1,
  },
  tool: {
    borderWidth: 1,
    borderRadius: tokens.radius.compact,
    paddingHorizontal: tokens.spacing.scale.space8,
    paddingVertical: tokens.spacing.scale.space8,
    minWidth: 36,
    alignItems: 'center',
  },
  toolLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
});
