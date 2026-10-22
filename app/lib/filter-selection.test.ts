import { describe, expect, it } from 'vitest';
import { NONE_SELECTED, pruneInvalidSelections } from './filter-selection';

describe('filter-selection', () => {
  it('drops selections outside the options but keeps the NONE value (すべて解除)', () => {
    expect(pruneInvalidSelections({ a: ['x', 'gone'] }, [['a', ['x', 'y']]])).toEqual({ a: ['x'] });
    expect(pruneInvalidSelections({ a: [NONE_SELECTED] }, [['a', ['x', 'y']]])).toBeNull();
    expect(pruneInvalidSelections({ a: [] as string[] }, [['a', ['x']]])).toBeNull();
  });
});
