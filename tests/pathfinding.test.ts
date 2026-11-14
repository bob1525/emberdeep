import { describe, expect, it } from 'vitest';
import { GameMap } from '../src/world/map';
import { findPath, findPathWithFn } from '../src/engine/pathfinding';
import type { Pt } from '../src/engine/los';

describe('findPathWithFn', () => {
  it('空地直线：路径不含起点、包含终点', () => {
    const path = findPathWithFn({ x: 0, y: 0 }, { x: 3, y: 0 }, () => true);
    expect(path).not.toBeNull();
    expect(path?.[0]).toEqual({ x: 1, y: 0 });
    expect(path?.[path.length - 1]).toEqual({ x: 3, y: 0 });
    expect(path?.length).toBe(3);
  });

  it('同点路径为空数组', () => {
    expect(findPathWithFn({ x: 2, y: 2 }, { x: 2, y: 2 }, () => true)).toEqual([]);
  });

  it('绕过 L 形墙', () => {
    // 竖墙 x=2，y=0..4；缺口在 y=5
    const isWalkable = (x: number, y: number) => !(x === 2 && y <= 4);
    const path = findPathWithFn({ x: 0, y: 0 }, { x: 4, y: 0 }, isWalkable);
    expect(path).not.toBeNull();
    expect(path?.[path.length - 1]).toEqual({ x: 4, y: 0 });
    // 必须从缺口 y=5 绕过
    expect(path?.some((p) => p.y === 5 && p.x === 2)).toBe(true);
  });

  it('U 形陷阱从开口绕出', () => {
    const walls = new Set(['3,2', '4,2', '5,2', '3,3', '3,4', '5,3', '5,4']);
    const isWalkable = (x: number, y: number) => !walls.has(`${x},${y}`);
    // 目标在 U 内部 (4,3)，开口在 (4,2) 上方——被封了；
    // 改为开口朝下：去掉 (4,2) 与 (4,4)
    walls.delete('4,2');
    walls.delete('4,4');
    const path = findPathWithFn({ x: 4, y: 6 }, { x: 4, y: 3 }, isWalkable);
    expect(path).not.toBeNull();
    expect(path?.some((p) => p.x === 4 && p.y === 4)).toBe(true);
  });

  it('完全封闭的目标不可达 → null', () => {
    const walls = new Set(['4,3', '5,3', '6,3', '4,4', '6,4', '4,5', '5,5', '6,5']);
    const isWalkable = (x: number, y: number) => !walls.has(`${x},${y}`);
    expect(findPathWithFn({ x: 0, y: 0 }, { x: 5, y: 4 }, isWalkable)).toBeNull();
  });

  it('maxNodes 限制生效', () => {
    expect(findPathWithFn({ x: 0, y: 0 }, { x: 99, y: 99 }, () => true, 5)).toBeNull();
  });

  it('禁止穿角：两个正交邻格都被堵时不能斜穿', () => {
    const walls = new Set(['1,0', '0,1']);
    const isWalkable = (x: number, y: number) => !walls.has(`${x},${y}`);
    expect(findPathWithFn({ x: 0, y: 0 }, { x: 1, y: 1 }, isWalkable)).toBeNull();
    // 打开一个正交邻格后可以绕过
    walls.delete('0,1');
    const path = findPathWithFn({ x: 0, y: 0 }, { x: 1, y: 1 }, isWalkable);
    expect(path).not.toBeNull();
    expect(path?.[0]).toEqual({ x: 0, y: 1 });
  });

  it('目标格豁免可通行检查（寻路到玩家所在格）', () => {
    const isWalkable = (x: number, y: number) => !(x === 3 && y === 0);
    const path = findPathWithFn({ x: 0, y: 0 }, { x: 3, y: 0 }, isWalkable);
    expect(path).not.toBeNull();
    expect(path?.[path.length - 1]).toEqual({ x: 3, y: 0 });
  });
});

describe('findPath (GameMap 版本)', () => {
  it('与回调版结果一致', () => {
    const map = GameMap.filled(10, 10, 'wall');
    for (let y = 1; y < 9; y++) {
      for (let x = 1; x < 9; x++) map.setTile(x, y, 'floor');
    }
    const path: Pt[] | null = findPath(map, { x: 1, y: 1 }, { x: 8, y: 8 });
    expect(path).not.toBeNull();
    expect(path?.[path.length - 1]).toEqual({ x: 8, y: 8 });
  });

  it('不可达返回 null', () => {
    const map = GameMap.filled(10, 10, 'wall');
    map.setTile(1, 1, 'floor');
    map.setTile(8, 8, 'floor');
    expect(findPath(map, { x: 1, y: 1 }, { x: 8, y: 8 })).toBeNull();
  });
});
