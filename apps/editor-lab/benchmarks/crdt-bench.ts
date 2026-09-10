/**
 * CRDT microbench harness. Run with bun from repo root:
 *   bun apps/editor-lab/benchmarks/crdt-bench.ts
 *   bun apps/editor-lab/benchmarks/crdt-bench.ts --engines yjs
 *   bun apps/editor-lab/benchmarks/crdt-bench.ts --engines all
 *
 * Default `--engines yjs` so optional WASM packages are not required.
 * environment is "bun". Hermes release-build numbers still have to be
 * collected on a device. Do not copy these timings into product claims.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { YjsCrdtDocument } from '@jot/core';
import { createId, deriveId, parseDocument, parseId } from '@jot/schema';
import type { NodeId, TransactionId } from '@jot/schema';

type EngineStatus = 'skipped' | 'ran';

type EngineResult = {
  readonly engine: string;
  readonly status: EngineStatus;
  readonly notes: string;
  readonly timingsMs: Readonly<Record<string, number>>;
};

type BenchFile = {
  readonly environment: 'bun';
  readonly generatedAt: string;
  readonly yjsVersion: string;
  readonly comment: string;
  readonly engines: readonly EngineResult[];
};

const ROOT = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(ROOT, 'results');
const LATEST_PATH = join(RESULTS_DIR, 'latest.json');
const YJS_VERSION = '13.6.32';
const INSERTS = 1000;
const ENGINE_ORDER = ['yjs', 'loro', 'automerge'] as const;

function parseEngines(argv: readonly string[]): readonly string[] {
  const idx = argv.indexOf('--engines');
  const raw = idx === -1 ? 'yjs' : (argv[idx + 1] ?? 'yjs');
  if (raw === 'all') {
    return [...ENGINE_ORDER];
  }
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function nowMs(): number {
  return performance.now();
}

function seedParagraph(): { document: ReturnType<typeof parseDocument>; paraId: NodeId } {
  const docId = parseId('aaaaaaaaaaaaaaaaaaaaaaaaaa');
  const paraId = deriveId(docId, 'paragraph', 0);
  const textId = deriveId(paraId, 'text', 0);
  return {
    paraId,
    document: parseDocument({
      type: 'doc',
      id: docId,
      content: [
        {
          type: 'paragraph',
          id: paraId,
          content: [{ type: 'text', id: textId, text: '', marks: [] }],
        },
      ],
    }),
  };
}

function loadOptional(specifier: string): Promise<unknown> {
  const importer = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<unknown>;
  return importer(specifier);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

async function benchYjs(): Promise<EngineResult> {
  const { document, paraId } = seedParagraph();
  const a = YjsCrdtDocument.fromCanonical(document);
  const applyStart = nowMs();
  for (let i = 0; i < INSERTS; i += 1) {
    a.applySchemaOperations(
      [
        {
          type: 'insertText',
          position: {
            nodeId: paraId,
            offsetUtf16: i,
            affinity: 'after',
            revision: 0,
          },
          text: 'x',
          storedMarks: [],
        },
      ],
      createId<TransactionId>(),
    );
  }
  const applyMs = nowMs() - applyStart;

  const encodeStart = nowMs();
  const bytes = a.encodeUpdate();
  const encodeMs = nowMs() - encodeStart;

  const b = new YjsCrdtDocument();
  const decodeStart = nowMs();
  b.applyUpdate(bytes);
  const decodeMs = nowMs() - decodeStart;

  return {
    engine: 'yjs',
    status: 'ran',
    notes: `Yjs ${YJS_VERSION} via YjsCrdtDocument. ${String(INSERTS)} insertText ops. bun, not Hermes.`,
    timingsMs: {
      apply1000: applyMs,
      encode: encodeMs,
      decode: decodeMs,
      updateBytes: bytes.byteLength,
    },
  };
}

async function benchLoro(): Promise<EngineResult> {
  try {
    const mod = await loadOptional('loro-crdt');
    if (!isRecord(mod) || typeof mod.LoroDoc !== 'function') {
      return {
        engine: 'loro',
        status: 'skipped',
        notes: 'loro-crdt imported but LoroDoc was missing',
        timingsMs: {},
      };
    }
    const LoroDoc = mod.LoroDoc as new () => {
      getText: (name: string) => {
        insert: (index: number, text: string) => void;
      };
      export: (opts: { mode: string }) => Uint8Array;
      import: (bytes: Uint8Array) => void;
    };
    const doc = new LoroDoc();
    const text = doc.getText('body');
    const applyStart = nowMs();
    for (let i = 0; i < INSERTS; i += 1) {
      text.insert(i, 'x');
    }
    const applyMs = nowMs() - applyStart;
    const encodeStart = nowMs();
    const bytes = doc.export({ mode: 'snapshot' });
    const encodeMs = nowMs() - encodeStart;
    const other = new LoroDoc();
    const decodeStart = nowMs();
    other.import(bytes);
    const decodeMs = nowMs() - decodeStart;
    return {
      engine: 'loro',
      status: 'ran',
      notes: 'loro-crdt loaded under bun. Still not a Hermes result.',
      timingsMs: {
        apply1000: applyMs,
        encode: encodeMs,
        decode: decodeMs,
        updateBytes: bytes.byteLength,
      },
    };
  } catch (error) {
    return {
      engine: 'loro',
      status: 'skipped',
      notes: error instanceof Error ? error.message : String(error),
      timingsMs: {},
    };
  }
}

async function benchAutomerge(): Promise<EngineResult> {
  try {
    const mod = await loadOptional('@automerge/automerge');
    if (!isRecord(mod)) {
      return {
        engine: 'automerge',
        status: 'skipped',
        notes: '@automerge/automerge imported but was not a module object',
        timingsMs: {},
      };
    }
    const from = mod.from;
    const change = mod.change;
    const splice = mod.splice;
    const save = mod.save;
    const load = mod.load;
    if (
      typeof from !== 'function' ||
      typeof change !== 'function' ||
      typeof splice !== 'function' ||
      typeof save !== 'function' ||
      typeof load !== 'function'
    ) {
      return {
        engine: 'automerge',
        status: 'skipped',
        notes: '@automerge/automerge loaded without from/change/splice/save/load',
        timingsMs: {},
      };
    }
    let doc: unknown = from({ text: '' });
    const applyStart = nowMs();
    for (let i = 0; i < INSERTS; i += 1) {
      doc = change(doc, (draft: unknown) => {
        splice(draft, ['text'], i, 0, 'x');
      });
    }
    const applyMs = nowMs() - applyStart;
    const encodeStart = nowMs();
    const bytes = save(doc) as Uint8Array;
    const encodeMs = nowMs() - encodeStart;
    const decodeStart = nowMs();
    load(bytes);
    const decodeMs = nowMs() - decodeStart;
    return {
      engine: 'automerge',
      status: 'ran',
      notes: '@automerge/automerge loaded under bun. Still not a Hermes result.',
      timingsMs: {
        apply1000: applyMs,
        encode: encodeMs,
        decode: decodeMs,
        updateBytes: bytes.byteLength,
      },
    };
  } catch (error) {
    return {
      engine: 'automerge',
      status: 'skipped',
      notes: error instanceof Error ? error.message : String(error),
      timingsMs: {},
    };
  }
}

function isEngineResult(value: unknown): value is EngineResult {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.engine === 'string' &&
    (value.status === 'ran' || value.status === 'skipped') &&
    typeof value.notes === 'string' &&
    isRecord(value.timingsMs)
  );
}

function loadPreviousEngines(): readonly EngineResult[] {
  if (!existsSync(LATEST_PATH)) {
    return [];
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(LATEST_PATH, 'utf8'));
    if (!isRecord(raw) || !Array.isArray(raw.engines)) {
      return [];
    }
    return raw.engines.filter(isEngineResult);
  } catch {
    return [];
  }
}

function mergeEngines(
  previous: readonly EngineResult[],
  next: readonly EngineResult[],
  requested: readonly string[],
): EngineResult[] {
  const byName = new Map<string, EngineResult>();
  for (const engine of previous) {
    if (!requested.includes(engine.engine)) {
      byName.set(engine.engine, engine);
    }
  }
  for (const engine of next) {
    byName.set(engine.engine, engine);
  }
  const out: EngineResult[] = [];
  for (const name of ENGINE_ORDER) {
    const row = byName.get(name);
    if (row) {
      out.push(row);
    }
  }
  for (const [name, row] of byName) {
    if (!ENGINE_ORDER.includes(name as (typeof ENGINE_ORDER)[number])) {
      out.push(row);
    }
  }
  return out;
}

const requested = parseEngines(process.argv.slice(2));
const ran: EngineResult[] = [];
if (requested.includes('yjs')) {
  ran.push(await benchYjs());
}
if (requested.includes('loro')) {
  ran.push(await benchLoro());
}
if (requested.includes('automerge')) {
  ran.push(await benchAutomerge());
}

const engines = mergeEngines(loadPreviousEngines(), ran, requested);
const retained = engines.some((engine) => !requested.includes(engine.engine));

const payload: BenchFile = {
  environment: 'bun',
  generatedAt: new Date().toISOString(),
  yjsVersion: YJS_VERSION,
  comment: retained
    ? 'Numbers are local bun, not Hermes. A Hermes release-build on device is still required before CRDT choice is closed. Engines not requested this run were copied from the previous latest.json.'
    : 'Numbers are local bun, not Hermes. A Hermes release-build on device is still required before CRDT choice is closed.',
  engines,
};

mkdirSync(RESULTS_DIR, { recursive: true });
writeFileSync(LATEST_PATH, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify(payload, null, 2));
