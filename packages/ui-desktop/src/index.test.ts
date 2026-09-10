import { describe, expect, it } from 'vitest';
import { packageName } from './index.js';

describe('@jot/ui-desktop', () => {
  it('imports', () => {
    expect(packageName).toBe('@jot/ui-desktop');
  });
});
