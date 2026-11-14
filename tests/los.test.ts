import { describe, expect, it } from 'vitest';
import { hasLineOfSight } from '../src/engine/los';

const openField = () => false;

describe('hasLineOfSight', () => {
  it('空地上任意两点互通', () => {
    expect(hasLineOfSight(0, 0, 10, 0, openField)).toBe(true);
    expect(hasLineOfSight(0, 0, 7, 5, openField)).toBe(true);
    expect(hasLineOfSight(0, 0, 0, 0, openField)).toBe(true);
  });

  it('中间一堵墙挡住视线', () => {
    const wall = (x: number, y: number) => x === 5 && y === 0;
    expect(hasLineOfSight(0, 0, 10, 0, wall)).toBe(false);
    // 绕开墙的直线不受影响
    expect(hasLineOfSight(0, 1, 10, 1, wall)).toBe(true);
  });

  it('端点在墙上不算被阻挡（用于贴墙目标判定）', () => {
    const wall = (x: number, y: number) => x === 5 && y === 0;
    expect(hasLineOfSight(0, 0, 5, 0, wall)).toBe(true);
  });

  it('斜线穿角：两个阻挡格夹缝不能透过', () => {
    // 从 (2,0) 到 (0,2) 的斜线经过 (1,1)
    const wall = (x: number, y: number) => x === 1 && y === 1;
    expect(hasLineOfSight(2, 0, 0, 2, wall)).toBe(false);
  });
});
