import type { ESLint, Rule } from 'eslint';

/**
 * Raw color, spacing, radius, shadow, duration, or easing values belong in
 * `src/tokens.json`. Other packages must use generated tokens. The exception is
 * OS semantic values mapped by the generator, such as `separator`,
 * `outlineVariant`, and `CardStrokeColorDefault`.
 */
export const RAW_DESIGN_VALUE_REGEX =
  /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgb|rgba|hsl|hsla)\s*\(|\bcubic-bezier\s*\(|\b(?:ease-in-out|ease-in|ease-out)\b|\b(?:box-shadow|drop-shadow|text-shadow)\b|\b\d+(?:\.\d+)?(?:px|rem|ms)\b/i;

export const OS_SEMANTIC_VALUE_NAMES: ReadonlySet<string> = new Set([
  'none',
  'separator',
  'shadow',
  'elevation',
  'flyoutShadow',
  'outlineVariant',
  'CardStrokeColorDefault',
  'label',
  'secondaryLabel',
  'systemBackground',
  'secondarySystemBackground',
  'onSurface',
  'surface',
  'TextFillColorPrimary',
]);

export type RawDesignKind = 'color' | 'spacing' | 'radius' | 'shadow' | 'duration' | 'easing';

export interface RawDesignMatch {
  readonly kind: RawDesignKind;
  readonly value: string;
  readonly index: number;
}

const PATTERNS: readonly { readonly kind: RawDesignKind; readonly regex: RegExp }[] = [
  {
    kind: 'color',
    regex: /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g,
  },
  { kind: 'color', regex: /\b(?:rgb|rgba|hsl|hsla)\s*\(/gi },
  { kind: 'easing', regex: /\bcubic-bezier\s*\(/gi },
  { kind: 'easing', regex: /\b(?:ease-in-out|ease-in|ease-out)\b/g },
  { kind: 'shadow', regex: /\b(?:box-shadow|drop-shadow|text-shadow)\b/gi },
  { kind: 'duration', regex: /\b\d+(?:\.\d+)?ms\b/g },
  { kind: 'spacing', regex: /\b\d+(?:\.\d+)?(?:px|rem)\b/g },
];

export function isAllowedOsSemanticValue(value: string): boolean {
  return OS_SEMANTIC_VALUE_NAMES.has(value);
}

export function isExemptPath(filename: string): boolean {
  const normalized = filename.replaceAll('\\', '/');
  return (
    normalized.includes('/packages/tokens/') ||
    normalized.includes('/generated/') ||
    /(?:^|\/)tokens\.json$/.test(normalized)
  );
}

export function forbiddenRawValues(source: string): readonly RawDesignMatch[] {
  const hits: RawDesignMatch[] = [];
  const seen = new Set<string>();
  for (const pattern of PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    for (const match of source.matchAll(regex)) {
      const value = match[0];
      const index = match.index;
      if (isAllowedOsSemanticValue(value)) {
        continue;
      }
      const key = `${String(index)}:${value}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      hits.push({ kind: pattern.kind, value, index });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  return hits;
}

function indexToLoc(source: string, index: number): { line: number; column: number } {
  const before = source.slice(0, index);
  const lines = before.split('\n');
  const last = lines.at(-1);
  return {
    line: lines.length,
    column: last === undefined ? 0 : last.length,
  };
}

export const noRawDesignValuesRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid raw hex/rgb/hsl colors outside @jolt/tokens. Use generated tokens. OS semantic values mapped by the generator are allowed.',
    },
    messages: {
      raw: 'Raw design value "{{value}}". Import a token from @jolt/tokens instead.',
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    if (isExemptPath(filename)) {
      return {};
    }
    return {
      Program() {
        const source = context.sourceCode.getText();
        for (const hit of forbiddenRawValues(source)) {
          if (hit.kind !== 'color') {
            continue;
          }
          context.report({
            loc: indexToLoc(source, hit.index),
            messageId: 'raw',
            data: { value: hit.value },
          });
        }
      },
    };
  },
};

export const tokensEslintPlugin: ESLint.Plugin = {
  meta: {
    name: '@jolt/tokens',
    version: '0.0.0',
  },
  rules: {
    'no-raw-design-values': noRawDesignValuesRule,
  },
};
