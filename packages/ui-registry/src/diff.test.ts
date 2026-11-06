import { describe, expect, it } from 'vitest';
import { sideBySide } from './domain/VersionDiff';

describe('sideBySide', () => {
  it('aligns added and removed lines', () => {
    const [left, right] = sideBySide('a\nb\nc', 'a\nc\nd');
    expect(left.map((l) => l.kind)).toEqual(['same', 'del', 'same', 'pad']);
    expect(right.map((l) => l.kind)).toEqual(['same', 'pad', 'same', 'add']);
  });
});

describe('stableStringify', () => {
  it('ignores key order', async () => {
    const { stableStringify } = await import('./domain/util');
    expect(stableStringify({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(stableStringify({ a: [{ x: 1, y: 2 }], b: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});
