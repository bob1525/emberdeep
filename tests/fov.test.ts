import { describe, expect, it } from 'vitest';
import { computeFov } from '../src/engine/fov';

const open = () => false;

describe('computeFov', () => {
  it('空地 radius=3：原点可见，可见格恰好是以 3 为半径的欧氏圆（29 格）', () => {
    const visible = computeFov({ isBlocked: open, ox: 0, oy: 0, radius: 3 });
    expect(visible.has('0,0')).toBe(true);
    // 圆内格子数：1 + 8 + 16 + 4 = 29
    expect(visible.size).toBe(29);
    // 对角远角 (3,3) 距离平方 18 > 9，不可见
    expect(visible.has('3,3')).toBe(false);
    expect(visible.has('3,0')).toBe(true);
    expect(visible.has('2,2')).toBe(true);
  });

  it('radius=5 时空地可见格数量符合圆面积', () => {
    const visible = computeFov({ isBlocked: open, ox: 0, oy: 0, radius: 5 });
    // 所有点对的 dx²+dy² ≤ 25
    let expected = 0;
    for (let y = -5; y <= 5; y++) {
      for (let x = -5; x <= 5; x++) {
        if (x * x + y * y <= 25) expected++;
      }
    }
    expect(visible.size).toBe(expected);
  });

  it('竖墙本身可见，墙后不可见', () => {
    const wall = (x: number) => x === 5;
    const visible = computeFov({ isBlocked: wall, ox: 0, oy: 0, radius: 8 });
    expect(visible.has('5,0')).toBe(true); // 墙照亮
    expect(visible.has('6,0')).toBe(false); // 墙正后
    expect(visible.has('6,1')).toBe(false); // 墙斜后
    expect(visible.has('4,0')).toBe(true); // 墙前
  });

  it('整排墙的房间：墙内可见，墙外不可见，不允许穿角', () => {
    // 一排墙在 y=3，从 (5,5) 往上看
    const wall = (_x: number, y: number) => y === 3;
    const visible = computeFov({ isBlocked: wall, ox: 5, oy: 5, radius: 10 });
    expect(visible.has('5,3')).toBe(true); // 墙照亮
    expect(visible.has('5,2')).toBe(false); // 墙后正对
    expect(visible.has('4,2')).toBe(false); // 墙后斜对
    expect(visible.has('5,4')).toBe(true); // 墙前
  });

  it('墙上开一扇门，门后一条通道可见', () => {
    const wall = (x: number, y: number) => y === 3 && x !== 5;
    const visible = computeFov({ isBlocked: wall, ox: 5, oy: 5, radius: 10 });
    expect(visible.has('5,3')).toBe(true); // 门洞
    expect(visible.has('5,2')).toBe(true); // 门后直线
    expect(visible.has('5,1')).toBe(true);
    // 宽容拐角（permissive corners）变体允许门口斜后一格被看见，
    // 但远离门洞的墙后区域必须仍然被挡
    expect(visible.has('3,2')).toBe(false);
    expect(visible.has('7,2')).toBe(false);
  });

  it('对称障碍产生对称视野', () => {
    const wall = (x: number, y: number) => x === 3 && Math.abs(y) === 1;
    const visible = computeFov({ isBlocked: wall, ox: 0, oy: 0, radius: 6 });
    for (const key of visible) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      expect(visible.has(`${x},${-y}`)).toBe(true);
    }
  });

  it('没有任何格超出半径', () => {
    const visible = computeFov({ isBlocked: open, ox: 10, oy: 10, radius: 4 });
    for (const key of visible) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      const d2 = (x - 10) ** 2 + (y - 10) ** 2;
      expect(d2).toBeLessThanOrEqual(16);
    }
  });
});
