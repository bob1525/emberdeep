import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';

describe('Rng', () => {
  it('同一种子产生完全相同的序列', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('int() 始终落在闭区间内', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('pick() 只返回数组中的元素', () => {
    const rng = new Rng(1);
    const pool = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) {
      expect(pool).toContain(rng.pick(pool));
    }
  });

  it('pick() 空数组时抛错', () => {
    const rng = new Rng(1);
    expect(() => rng.pick([])).toThrow();
  });
});
