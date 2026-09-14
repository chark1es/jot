#!/usr/bin/env bun
/**
 * Checks native editor corpus output (packages/editor-native/corpus) against TypeScript and Yjs.
 *
 * For each platform output and scenario:
 * - every step's operations apply with TypeScript `applyOperations` and with Yjs, in order
 * - a native inverse, when present, restores the document from before the step
 * - the native document, the TypeScript document, and the Yjs document match
 * - the document outline matches the scenario's `expect`
 * - schema fixtures survive the native linear round trip byte for byte (canonical JSON)
 * With two platforms, their documents, editor text, caret, and operations must match once
 * generated ids are replaced by first-appearance order.
 *
 *   bun scripts/editor-corpus-verify.ts /tmp/swift.json /tmp/kotlin.json
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalizeDocumentToString, createId, deriveId, parseDocument } from '../packages/schema/src/index.ts';
import type { Document } from '../packages/schema/src/index.ts';
import { applyOperations } from '../packages/editor-native/src/apply-operations.ts';
import { parseSchemaOperations } from '../packages/editor-native/src/operation-parse.ts';
import { YjsCrdtDocument } from '../packages/core/src/yjs-document.ts';

const ROOT = join(import.meta.dirname, '..');
export const CORPUS_PATH = join(ROOT, 'packages/editor-native/corpus/editing.json');
export const FIXTURES_DIR = join(ROOT, 'packages/schema/fixtures');

/** The editors show an empty note as one empty paragraph with the id TypeScript derives for it. */
function startingDocument(raw: unknown): Document {
  const parsed = parseDocument(raw);
  if (parsed.content.length > 0) {
    return parsed;
  }
  return parseDocument({ ...parsed, content: [{ type: 'paragraph', id: deriveId(parsed.id, 'paragraph', 0), content: [] }] });
}

type JsonNode = {
  readonly type: string;
  readonly id?: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: readonly JsonNode[];
  readonly text?: string;
  readonly marks?: readonly { readonly type: string; readonly attrs?: Readonly<Record<string, unknown>> }[];
};

type ScenarioSpec = {
  readonly name: string;
  readonly doc: unknown;
  readonly expect: readonly string[];
};

type StepOutput = {
  readonly step: string;
  readonly operations?: unknown[];
  readonly inverse?: unknown[] | null;
};

type ScenarioOutput = {
  readonly name: string;
  readonly steps: readonly StepOutput[];
  readonly document: unknown;
  readonly caret: number;
  readonly text: string;
  readonly error: string | null;
};

export type CorpusOutput = {
  readonly platform: string;
  readonly scenarios: readonly ScenarioOutput[];
  readonly fixtures: readonly { readonly name: string; readonly document: unknown }[];
};

export type CorpusReport = {
  readonly failures: readonly string[];
  readonly scenarios: number;
  readonly operations: number;
  readonly fixtures: number;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Text node ids change whenever text is split or merged, so comparisons ignore them and merge equal runs. */
function withoutTextIds(node: JsonNode): JsonNode {
  const content: JsonNode[] = [];
  for (const child of node.content ?? []) {
    if (child.type === 'text') {
      const text = child.text ?? '';
      if (text.length === 0) {
        continue;
      }
      const marks = [...(child.marks ?? [])].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
      const previous = content.at(-1);
      if (previous?.type === 'text' && stable(previous.marks) === stable(marks)) {
        content[content.length - 1] = { ...previous, text: `${previous.text ?? ''}${text}` };
      } else {
        content.push({ type: 'text', text, marks });
      }
      continue;
    }
    content.push(withoutTextIds(child));
  }
  return node.content === undefined ? { ...node } : { ...node, content };
}

function signature(document: unknown): string {
  return stable(withoutTextIds(document as JsonNode));
}

/** Replaces every generated id with its order of first appearance, sharing `names` across calls. */
function anonymize(value: unknown, names: Map<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => anonymize(item, names));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (record.type === 'text' && key === 'id') {
        continue;
      }
      out[key] = anonymize(item, names);
    }
    return out;
  }
  if (typeof value === 'string' && /^[a-z2-7]{26}$/.test(value)) {
    let name = names.get(value);
    if (name === undefined) {
      name = `#${String(names.size)}`;
      names.set(value, name);
    }
    return name;
  }
  return value;
}

function outlineRuns(node: JsonNode): string {
  const parts: string[] = [];
  for (const child of withoutTextIds(node).content ?? []) {
    if (child.type === 'text') {
      const marks = (child.marks ?? []).map((mark) => mark.type);
      parts.push(marks.length === 0 ? (child.text ?? '') : `{${child.text ?? ''}|${marks.join(',')}}`);
    } else if (child.type === 'hardBreak') {
      parts.push('<br>');
    } else {
      parts.push(`<${child.type}>`);
    }
  }
  return parts.join('');
}

function outlineLabel(node: JsonNode): string {
  const attrs = Object.entries(node.attrs ?? {})
    .filter(([key, value]) => key !== 'attachmentId' && value !== '' && value !== undefined && value !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${String(value)}`);
  return attrs.length === 0 ? node.type : `${node.type}(${attrs.join(',')})`;
}

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'caption']);

/** One line per text block or leaf block, prefixed by its container path. */
export function outline(document: unknown): string[] {
  const lines: string[] = [];
  const walk = (node: JsonNode, path: readonly string[]): void => {
    const label = [...path, outlineLabel(node)].join('>');
    if (TEXT_BLOCKS.has(node.type)) {
      const runs = outlineRuns(node);
      lines.push(runs.length === 0 ? `${label}:` : `${label}: ${runs}`);
      return;
    }
    if ((node.content ?? []).length === 0) {
      lines.push(label);
      return;
    }
    for (const child of node.content ?? []) {
      walk(child, [...path, outlineLabel(node)]);
    }
  };
  for (const child of (document as JsonNode).content ?? []) {
    walk(child, []);
  }
  return lines;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function verifyCorpus(outputs: readonly CorpusOutput[]): CorpusReport {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as { scenarios: ScenarioSpec[] };
  const failures: string[] = [];
  let operations = 0;
  let fixtures = 0;

  for (const output of outputs) {
    const platform = output.platform;
    if (output.scenarios.length !== corpus.scenarios.length) {
      failures.push(`${platform}: ran ${String(output.scenarios.length)} of ${String(corpus.scenarios.length)} scenarios`);
    }
    corpus.scenarios.forEach((spec, index) => {
      const native = output.scenarios[index];
      const where = `${platform} "${spec.name}"`;
      if (native === undefined) {
        return;
      }
      if (native.error !== null) {
        failures.push(`${where}: native error ${native.error}`);
        return;
      }
      let document = startingDocument(spec.doc);
      const crdt = new YjsCrdtDocument();
      crdt.replaceFromCanonical(document);
      for (const [stepIndex, step] of native.steps.entries()) {
        if (step.operations === undefined) {
          continue;
        }
        const before = document;
        // The app parses native events with the same intake parser before TypeScript or Yjs sees them.
        let ops: ReturnType<typeof parseSchemaOperations>;
        try {
          ops = parseSchemaOperations(step.operations);
        } catch (error) {
          failures.push(`${where} step ${String(stepIndex)} (${step.step}): operations do not parse: ${message(error)}`);
          return;
        }
        operations += ops.length;
        try {
          document = applyOperations(document, ops);
        } catch (error) {
          failures.push(`${where} step ${String(stepIndex)} (${step.step}): TypeScript rejected operations: ${message(error)}`);
          return;
        }
        try {
          crdt.applySchemaOperations(ops, createId());
        } catch (error) {
          failures.push(`${where} step ${String(stepIndex)} (${step.step}): Yjs rejected operations: ${message(error)}`);
          return;
        }
        if (step.inverse !== null && step.inverse !== undefined) {
          try {
            const restored = applyOperations(document, parseSchemaOperations(step.inverse));
            if (signature(restored) !== signature(before)) {
              failures.push(`${where} step ${String(stepIndex)} (${step.step}): inverse does not restore the previous document`);
            }
          } catch (error) {
            failures.push(`${where} step ${String(stepIndex)} (${step.step}): inverse rejected: ${message(error)}`);
          }
        }
      }
      let nativeDocument: Document;
      try {
        nativeDocument = parseDocument(native.document);
      } catch (error) {
        failures.push(`${where}: native document is not schema-valid: ${message(error)}`);
        return;
      }
      if (signature(nativeDocument) !== signature(document)) {
        failures.push(`${where}: native document differs from TypeScript\n  native     ${outline(nativeDocument).join(' / ')}\n  typescript ${outline(document).join(' / ')}`);
      }
      const yjsDocument = crdt.getCanonicalDocument();
      if (signature(yjsDocument) !== signature(document)) {
        failures.push(`${where}: Yjs document differs from TypeScript\n  yjs        ${outline(yjsDocument).join(' / ')}\n  typescript ${outline(document).join(' / ')}`);
      }
      const actual = outline(document);
      if (stable(actual) !== stable(spec.expect)) {
        failures.push(`${where}: outline\n  expected ${spec.expect.join(' / ')}\n  actual   ${actual.join(' / ')}`);
      }
    });

    for (const fixture of output.fixtures) {
      fixtures += 1;
      const expected = canonicalizeDocumentToString(JSON.parse(readFileSync(join(FIXTURES_DIR, fixture.name), 'utf8')));
      let actual: string;
      try {
        actual = canonicalizeDocumentToString(fixture.document);
      } catch (error) {
        failures.push(`${platform} fixture ${fixture.name}: ${message(error)}`);
        continue;
      }
      if (actual !== expected) {
        failures.push(`${platform} fixture ${fixture.name}: linear round trip changed the document`);
      }
    }
  }

  const [first, second] = outputs;
  if (first !== undefined && second !== undefined) {
    corpus.scenarios.forEach((spec, index) => {
      const a = first.scenarios[index];
      const b = second.scenarios[index];
      if (a === undefined || b === undefined) {
        return;
      }
      const where = `${first.platform} vs ${second.platform} "${spec.name}"`;
      const namesA = new Map<string, string>();
      const namesB = new Map<string, string>();
      anonymize(spec.doc, namesA);
      anonymize(spec.doc, namesB);
      const stepsA = stable(anonymize(a.steps, namesA));
      const stepsB = stable(anonymize(b.steps, namesB));
      if (stepsA !== stepsB) {
        const kindsA = a.steps.map((step) => step.step).join(',');
        const kindsB = b.steps.map((step) => step.step).join(',');
        failures.push(`${where}: operations differ${kindsA === kindsB ? '' : ` (steps ${kindsA} vs ${kindsB})`}`);
      }
      if (stable(anonymize(a.document, namesA)) !== stable(anonymize(b.document, namesB))) {
        failures.push(`${where}: documents differ`);
      }
      if (a.text !== b.text || a.caret !== b.caret) {
        failures.push(`${where}: editor text or caret differ (${String(a.caret)} vs ${String(b.caret)})`);
      }
    });
  }

  return { failures, scenarios: corpus.scenarios.length, operations, fixtures };
}

if (import.meta.main) {
  const outputs = process.argv.slice(2).map((path) => JSON.parse(readFileSync(path, 'utf8')) as CorpusOutput);
  const report = verifyCorpus(outputs);
  for (const failure of report.failures) {
    process.stdout.write(`FAIL ${failure}\n`);
  }
  process.stdout.write(
    `${String(report.scenarios)} scenarios, ${String(report.operations)} operations, ${String(report.fixtures)} fixture round trips, ${String(report.failures.length)} failures\n`,
  );
  process.exit(report.failures.length === 0 ? 0 : 1);
}
