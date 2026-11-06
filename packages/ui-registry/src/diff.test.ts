import { describe, expect, it } from 'vitest';
import { sideBySide } from './domain/VersionDiff';

describe('sideBySide', () => {
  it('aligns added and removed lines', () => {
    const [left, right] = sideBySide('a\nb\nc', 'a\nc\nd');
    expect(left.map((l) => l.kind)).toEqual(['same', 'del', 'same', 'pad']);
    expect(right.map((l) => l.kind)).toEqual(['same', 'pad', 'same', 'add']);
  });
});
