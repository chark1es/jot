import { describe, expect, it } from 'vitest';
import { packageName } from './index.js';

describe('@jolt/ui-desktop', () => {
  it('imports', () => {
    expect(packageName).toBe('@jolt/ui-desktop');
  });
});
