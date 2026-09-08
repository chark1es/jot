import { RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';

import {
  forbiddenRawValues,
  isExemptPath,
  noRawDesignValuesRule,
  RAW_DESIGN_VALUE_REGEX,
} from './no-raw-design-values.js';

describe('raw design values', () => {
  it('matches hex, rgb, spacing, duration, shadow, and easing', () => {
    expect(RAW_DESIGN_VALUE_REGEX.test('#b4681a')).toBe(true);
    expect(RAW_DESIGN_VALUE_REGEX.test('rgba(0, 0, 0, 0.12)')).toBe(true);
    expect(RAW_DESIGN_VALUE_REGEX.test('16px')).toBe(true);
    expect(RAW_DESIGN_VALUE_REGEX.test('120ms')).toBe(true);
    expect(RAW_DESIGN_VALUE_REGEX.test('cubic-bezier(0.2, 0, 0, 1)')).toBe(true);
    expect(RAW_DESIGN_VALUE_REGEX.test('box-shadow')).toBe(true);
    expect(RAW_DESIGN_VALUE_REGEX.test('tokens.color.light.ink')).toBe(false);
  });

  it('classifies forbidden values', () => {
    const hits = forbiddenRawValues('color: #fff; padding: 8px; animation: 180ms ease-out;');
    expect(hits.map((hit) => hit.kind)).toEqual(['color', 'spacing', 'duration', 'easing']);
  });

  it('exempts the tokens package and generated files', () => {
    expect(isExemptPath('/Users/dev/jolt/packages/tokens/src/generate.ts')).toBe(true);
    expect(isExemptPath('packages/tokens/generated/tokens.ts')).toBe(true);
    expect(isExemptPath('/apps/desktop/src/note-list.tsx')).toBe(false);
  });
});

it('eslint rule flags hex and rgb outside the tokens package', () => {
  const tester = new RuleTester({
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  });

  tester.run('no-raw-design-values', noRawDesignValuesRule, {
    valid: [
      {
        code: 'const color = tokens.color.light.ink;',
        filename: '/apps/desktop/src/note.ts',
      },
      {
        code: 'const color = "#fff";',
        filename: '/repo/packages/tokens/src/example.ts',
      },
    ],
    invalid: [
      {
        code: 'const color = "#fff";',
        filename: '/apps/desktop/src/note.ts',
        errors: [{ messageId: 'raw' }],
      },
      {
        code: 'const color = rgb(0, 0, 0);',
        filename: '/apps/mobile/src/note.tsx',
        errors: [{ messageId: 'raw' }],
      },
    ],
  });
});
