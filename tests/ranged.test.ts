import { describe, expect, it } from 'vitest';
import { RANGED, resolveShot, shotPath } from '../src/engine/ranged';
import type { RangedDef } from '../src/engine/ranged';
import { Rng } from '../src/engine/rng';

/** 从目录取定义；缺失即抛错（顺带充当目录完整性断言） */
function def(id: string): RangedDef {
  const d = RANGED[id];
  if (!d) throw new Error(`RANGED 目录缺少: "${id}"`);
  return d;
}

/** 全敞开地图：没有墙 */
const noWall = (): boolean => false;

describe('shotPath', () => {
  it('水平直线逐格前进', () => {
    expect(shotPath({ x: 0, y: 0 }, 1, 0, 3, noWall)).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('斜向直线逐格前进', () => {
    expect(shotPath({ x: 2, y: 2 }, 1, -1, 3, noWall)).toEqual([
      { x: 3, y: 1 },
      { x: 4, y: 0 },
      { x: 5, y: -1 },
    ]);
  });

  it('遇墙提前停，阻挡格不含在路径里（箭停在墙前）', () => {
    const wallAt = (x: number, y: number): boolean => x === 2 && y === 0;
    expect(shotPath({ x: 0, y: 0 }, 1, 0, 5, wallAt)).toEqual([{ x: 1, y: 0 }]);
  });

  it('第一步就撞墙：空路径', () => {
    const wallAt = (x: number, y: number): boolean => x === 1 && y === 0;
    expect(shotPath({ x: 0, y: 0 }, 1, 0, 5, wallAt)).toEqual([]);
  });

  it('无阻挡时恰好飞满射程，绝不多走一格', () => {
    const p = shotPath({ x: 0, y: 0 }, 1, 0, 6, noWall);
    expect(p).toHaveLength(6);
    expect(p[5]).toEqual({ x: 6, y: 0 });
    expect(p[6]).toBeUndefined();
  });

  it('八方向弹道逐格正确', () => {
    const dirs: ReadonlyArray<readonly [number, number]> = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ];
    for (const [dx, dy] of dirs) {
      const p = shotPath({ x: 10, y: 10 }, dx, dy, 4, noWall);
      expect(p).toHaveLength(4);
      p.forEach((cell, i) => {
        expect(cell).toEqual({ x: 10 + dx * (i + 1), y: 10 + dy * (i + 1) });
      });
    }
  });

  it('非法方向防御式返回空路径', () => {
    const badDirs: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [2, 0],
      [0, 2],
      [1, 2],
      [2, 2],
      [-2, -1],
      [0.5, 0],
      [1, 0.5],
    ];
    for (const [dx, dy] of badDirs) {
      expect(shotPath({ x: 5, y: 5 }, dx, dy, 4, noWall)).toEqual([]);
    }
    expect(shotPath({ x: 5, y: 5 }, Number.NaN, 0, 4, noWall)).toEqual([]);
    expect(shotPath({ x: 5, y: 5 }, 1, Number.POSITIVE_INFINITY, 4, noWall)).toEqual([]);
  });

  it('射程不足 1（含 0 / 负数 / NaN / 无穷）防御式返回空路径', () => {
    expect(shotPath({ x: 0, y: 0 }, 1, 0, 0, noWall)).toEqual([]);
    expect(shotPath({ x: 0, y: 0 }, 1, 0, -3, noWall)).toEqual([]);
    expect(shotPath({ x: 0, y: 0 }, 1, 0, Number.NaN, noWall)).toEqual([]);
    expect(shotPath({ x: 0, y: 0 }, 1, 0, Number.POSITIVE_INFINITY, noWall)).toEqual([]);
  });
});

describe('resolveShot', () => {
  it('途中第一格有目标即命中并停止，弹道截断于目标格', () => {
    // (2,0) 与 (4,0) 都有敌人：第一格 (2,0) 命中即停，不越过
    const targets = new Set(['2,0', '4,0']);
    const r = resolveShot({
      from: { x: 0, y: 0 },
      dx: 1,
      dy: 0,
      def: def('short_bow'),
      isBlocked: noWall,
      targetAt: (x, y) => targets.has(`${x},${y}`),
      rng: new Rng(42),
    });
    expect(r.hit).toBe(true);
    expect(r.path).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }]);
    expect(r.x).toBe(2);
    expect(r.y).toBe(0);
    expect(r.damage).toBeGreaterThanOrEqual(3);
    expect(r.damage).toBeLessThanOrEqual(6);
  });

  it('相邻格目标一步命中', () => {
    const r = resolveShot({
      from: { x: 0, y: 0 },
      dx: 1,
      dy: 0,
      def: def('short_bow'),
      isBlocked: noWall,
      targetAt: (x) => x === 1,
      rng: new Rng(1),
    });
    expect(r.hit).toBe(true);
    expect(r.path).toEqual([{ x: 1, y: 0 }]);
    expect(r.x).toBe(1);
    expect(r.y).toBe(0);
  });

  it('伤害落在武器区间（连掷 300 次）', () => {
    const rng = new Rng(2024);
    for (let i = 0; i < 300; i++) {
      const r = resolveShot({
        from: { x: 0, y: 0 },
        dx: 1,
        dy: 0,
        def: def('long_bow'),
        isBlocked: noWall,
        targetAt: (x) => x === 3,
        rng,
      });
      expect(r.hit).toBe(true);
      expect(r.damage).toBeGreaterThanOrEqual(5);
      expect(r.damage).toBeLessThanOrEqual(9);
    }
  });

  it('无目标飞满射程：不命中、伤害 0、弹着点为弹道终点', () => {
    const r = resolveShot({
      from: { x: 0, y: 0 },
      dx: 1,
      dy: 0,
      def: def('short_bow'),
      isBlocked: noWall,
      targetAt: () => false,
      rng: new Rng(7),
    });
    expect(r.hit).toBe(false);
    expect(r.damage).toBe(0);
    expect(r.path).toHaveLength(6);
    expect(r.x).toBe(6);
    expect(r.y).toBe(0);
  });

  it('最大射程格上的目标仍可命中', () => {
    const r = resolveShot({
      from: { x: 0, y: 0 },
      dx: 1,
      dy: 0,
      def: def('short_bow'),
      isBlocked: noWall,
      targetAt: (x) => x === 6,
      rng: new Rng(5),
    });
    expect(r.hit).toBe(true);
    expect(r.path).toHaveLength(6);
    expect(r.x).toBe(6);
    expect(r.y).toBe(0);
  });

  it('墙挡在目标之前：箭停在墙前不命中', () => {
    const wallAt = (x: number, y: number): boolean => x === 2 && y === 0;
    const r = resolveShot({
      from: { x: 0, y: 0 },
      dx: 1,
      dy: 0,
      def: def('short_bow'),
      isBlocked: wallAt,
      targetAt: (x) => x === 3,
      rng: new Rng(7),
    });
    expect(r.hit).toBe(false);
    expect(r.damage).toBe(0);
    expect(r.path).toEqual([{ x: 1, y: 0 }]);
    expect(r.x).toBe(1);
    expect(r.y).toBe(0);
  });

  it('目标位于墙格不被命中（阻挡优先于目标）', () => {
    const wallAt = (x: number, y: number): boolean => x === 2 && y === 0;
    const r = resolveShot({
      from: { x: 0, y: 0 },
      dx: 1,
      dy: 0,
      def: def('short_bow'),
      isBlocked: wallAt,
      targetAt: (x, y) => wallAt(x, y),
      rng: new Rng(7),
    });
    expect(r.hit).toBe(false);
    expect(r.damage).toBe(0);
    expect(r.path).toEqual([{ x: 1, y: 0 }]);
  });

  it('发射格上的目标不会被命中', () => {
    const r = resolveShot({
      from: { x: 0, y: 0 },
      dx: 1,
      dy: 0,
      def: def('short_bow'),
      isBlocked: noWall,
      targetAt: (x, y) => x === 0 && y === 0,
      rng: new Rng(7),
    });
    expect(r.hit).toBe(false);
    expect(r.damage).toBe(0);
    expect(r.path).toHaveLength(6);
  });

  it('飞刀斜向投掷命中并结算伤害', () => {
    const r = resolveShot({
      from: { x: 5, y: 5 },
      dx: -1,
      dy: 1,
      def: def('throwing_knife'),
      isBlocked: noWall,
      targetAt: (x, y) => x === 3 && y === 7,
      rng: new Rng(99),
    });
    expect(r.hit).toBe(true);
    expect(r.path).toEqual([{ x: 4, y: 6 }, { x: 3, y: 7 }]);
    expect(r.x).toBe(3);
    expect(r.y).toBe(7);
    expect(r.damage).toBeGreaterThanOrEqual(2);
    expect(r.damage).toBeLessThanOrEqual(4);
    // 弹着点即弹道最后一格
    expect(r.path[r.path.length - 1]).toEqual({ x: r.x, y: r.y });
  });

  it('非法方向：空弹道、不命中、伤害 0、弹着点为发射点', () => {
    const r = resolveShot({
      from: { x: 3, y: 4 },
      dx: 2,
      dy: 0,
      def: def('short_bow'),
      isBlocked: noWall,
      targetAt: () => true,
      rng: new Rng(1),
    });
    expect(r).toEqual({ path: [], hit: false, damage: 0, x: 3, y: 4 });
  });

  it('第一步撞墙：空弹道、不命中、弹着点为发射点', () => {
    const wallAt = (x: number): boolean => x === 4;
    const r = resolveShot({
      from: { x: 3, y: 4 },
      dx: 1,
      dy: 0,
      def: def('short_bow'),
      isBlocked: wallAt,
      targetAt: () => true,
      rng: new Rng(1),
    });
    expect(r).toEqual({ path: [], hit: false, damage: 0, x: 3, y: 4 });
  });

  it('同种子下结算完全可复现（确定性）', () => {
    const run = (seed: number): number[] => {
      const rng = new Rng(seed);
      return Array.from({ length: 20 }, (_, i) => {
        const tx = 2 + (i % 3); // 目标格在 2..4 间轮换
        return resolveShot({
          from: { x: 0, y: 0 },
          dx: 1,
          dy: 0,
          def: def('short_bow'),
          isBlocked: noWall,
          targetAt: (x) => x === tx,
          rng,
        }).damage;
      });
    };
    expect(run(1234)).toEqual(run(1234));
    expect(run(1234)).not.toEqual(run(1235));
  });
});

describe('RANGED 目录', () => {
  it('三件规定武器数值与规格一致', () => {
    expect(def('short_bow')).toMatchObject({
      catalogId: 'short_bow',
      name: '短弓',
      glyph: '}',
      kind: 'bow',
      range: 6,
      damage: [3, 6],
      thrown: false,
    });
    expect(def('long_bow')).toMatchObject({
      catalogId: 'long_bow',
      name: '长弓',
      glyph: '}',
      kind: 'bow',
      range: 9,
      damage: [5, 9],
      thrown: false,
    });
    expect(def('throwing_knife')).toMatchObject({
      catalogId: 'throwing_knife',
      name: '飞刀',
      glyph: '!',
      kind: 'thrown',
      range: 4,
      damage: [2, 4],
      thrown: true,
    });
  });

  it('每条定义字段完整合法', () => {
    for (const [id, d] of Object.entries(RANGED)) {
      expect(d.catalogId).toBe(id);
      expect(d.name.length).toBeGreaterThan(0); // 中文名非空
      expect(d.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(Number.isInteger(d.range)).toBe(true);
      expect(d.range).toBeGreaterThan(0);
      const [lo, hi] = d.damage;
      expect(Number.isInteger(lo)).toBe(true);
      expect(Number.isInteger(hi)).toBe(true);
      expect(lo).toBeGreaterThanOrEqual(1);
      expect(hi).toBeGreaterThanOrEqual(lo);
      expect(Number.isInteger(d.minDepth)).toBe(true);
      expect(d.minDepth).toBeGreaterThanOrEqual(1);
      if (d.kind === 'bow') {
        expect(d.thrown).toBe(false); // 弓可反复使用
        expect(d.glyph).toBe('}');
      } else {
        expect(d.kind).toBe('thrown');
        expect(d.thrown).toBe(true); // 投掷物掷出即消耗
        expect(d.glyph).toBe('!');
      }
    }
  });

  it('minDepth 存在且短弓 ≤ 长弓（深度门控由游戏层执行）', () => {
    expect(def('short_bow').minDepth).toBeLessThanOrEqual(def('long_bow').minDepth);
  });
});
