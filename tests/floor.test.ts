import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/engine/los';
import type { GameMap } from '../src/world/map';
import { MAP_HEIGHT, MAP_WIDTH, generateFloor } from '../src/world/generators/floor';
import type { FloorData } from '../src/world/generators/floor';

/** 四方向偏移，测试内独立定义 */
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** 楼梯与出生点的最小 BFS 距离（与生成规则一致） */
const STAIRS_MIN_DIST = 30;
/** 怪物与出生点的最小切比雪夫距离 */
const MONSTER_MIN_CHEB = 8;
/** 物品与出生点的最小切比雪夫距离 */
const ITEM_MIN_CHEB = 6;

/** 测试用切比雪夫距离 */
function cheb(a: Pt, b: Pt): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** 测试内独立的四方向洪泛（不依赖生成器内部实现），返回可达地板格索引集合 */
function floodFill(map: GameMap, start: Pt): Set<number> {
  const width = map.width;
  const seen = new Set<number>();
  if (!map.isWalkable(start.x, start.y)) return seen;
  seen.add(start.y * width + start.x);
  const queue: Pt[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (!cur) break;
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!map.isWalkable(nx, ny)) continue;
      const ni = ny * width + nx;
      if (seen.has(ni)) continue;
      seen.add(ni);
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

/** 测试内独立的四方向 BFS 距离场 */
function bfsDistances(map: GameMap, start: Pt): Map<number, number> {
  const width = map.width;
  const dist = new Map<number, number>();
  if (!map.isWalkable(start.x, start.y)) return dist;
  dist.set(start.y * width + start.x, 0);
  const queue: Pt[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (!cur) break;
    const base = dist.get(cur.y * width + cur.x) ?? 0;
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const ni = ny * width + nx;
      if (map.isWalkable(nx, ny) && !dist.has(ni)) {
        dist.set(ni, base + 1);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return dist;
}

/** 对一次生成结果做全套结构校验 */
function checkInvariants(floor: FloorData, depth: number): void {
  const { map, playerSpawn, stairsDown, monsterSpawns, itemSpots } = floor;

  // 尺寸固定 80×45
  expect(map.width).toBe(MAP_WIDTH);
  expect(map.height).toBe(MAP_HEIGHT);

  // 最外圈必须全是墙
  for (let x = 0; x < map.width; x++) {
    expect(map.tileAt(x, 0)).toBe('wall');
    expect(map.tileAt(x, map.height - 1)).toBe('wall');
  }
  for (let y = 0; y < map.height; y++) {
    expect(map.tileAt(0, y)).toBe('wall');
    expect(map.tileAt(map.width - 1, y)).toBe('wall');
  }

  // 所有点位都在地板上（越界 isWalkable 为 false，同时覆盖了边界检查）
  const allPoints = [playerSpawn, stairsDown, ...monsterSpawns, ...itemSpots];
  for (const p of allPoints) {
    expect(map.isWalkable(p.x, p.y)).toBe(true);
  }

  // playerSpawn → stairsDown 洪泛连通
  const reachable = floodFill(map, playerSpawn);
  expect(reachable.has(stairsDown.y * map.width + stairsDown.x)).toBe(true);

  // 楼梯距离达标：BFS ≥ 30；可达范围整体不足 30 时应取最深可达格
  const dist = bfsDistances(map, playerSpawn);
  const stairsDist = dist.get(stairsDown.y * map.width + stairsDown.x);
  let maxDist = 0;
  for (const d of dist.values()) {
    if (d > maxDist) maxDist = d;
  }
  expect(stairsDist).toBeDefined();
  if (stairsDist !== undefined) {
    expect(stairsDist >= STAIRS_MIN_DIST || stairsDist === maxDist).toBe(true);
  }

  // 点位数量：怪物 6 + depth*2（上限 24），物品 2-4 个
  expect(monsterSpawns.length).toBe(Math.min(6 + depth * 2, 24));
  expect(itemSpots.length).toBeGreaterThanOrEqual(2);
  expect(itemSpots.length).toBeLessThanOrEqual(4);

  // 与出生点的间距
  for (const m of monsterSpawns) {
    expect(cheb(m, playerSpawn)).toBeGreaterThanOrEqual(MONSTER_MIN_CHEB);
  }
  for (const item of itemSpots) {
    expect(cheb(item, playerSpawn)).toBeGreaterThanOrEqual(ITEM_MIN_CHEB);
  }

  // 所有点位（出生点、楼梯、怪物、物品）互不重叠
  const keys = allPoints.map((p) => p.y * map.width + p.x);
  expect(new Set(keys).size).toBe(keys.length);
}

/** depth 1-8 × 多个种子，共 40 组组合 */
const SEEDS = [1, 42, 1337, 20260214, 777] as const;
const COMBOS: { depth: number; seed: number }[] = [];
for (let depth = 1; depth <= 8; depth++) {
  for (const seed of SEEDS) {
    COMBOS.push({ depth, seed });
  }
}

describe('generateFloor', () => {
  it('同 (depth, seed) 两次生成的地图与点位逐格一致', () => {
    for (const depth of [1, 2, 3, 4, 6, 8]) {
      const a = generateFloor(depth, 2024);
      const b = generateFloor(depth, 2024);
      expect(b.playerSpawn).toEqual(a.playerSpawn);
      expect(b.stairsDown).toEqual(a.stairsDown);
      expect(b.monsterSpawns).toEqual(a.monsterSpawns);
      expect(b.itemSpots).toEqual(a.itemSpots);
      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
          if (a.map.tileAt(x, y) !== b.map.tileAt(x, y)) {
            throw new Error(`depth=${depth} 在 (${x}, ${y}) 处两次生成不一致`);
          }
        }
      }
    }
  });

  it.each(COMBOS)('depth=$depth seed=$seed：边界全墙、点位合规、spawn↔楼梯连通', ({ depth, seed }) => {
    checkInvariants(generateFloor(depth, seed), depth);
  });

  it('depth ≥ 4 的洞穴层地板占比 > 25%', () => {
    const seeds = [3, 11, 77, 555, 90001];
    for (let depth = 4; depth <= 8; depth++) {
      for (const seed of seeds) {
        const { map } = generateFloor(depth, seed);
        let floorCount = 0;
        for (let y = 0; y < map.height; y++) {
          for (let x = 0; x < map.width; x++) {
            if (map.isWalkable(x, y)) floorCount++;
          }
        }
        const ratio = floorCount / (map.width * map.height);
        expect(ratio, `depth=${depth} seed=${seed} 地板占比 ${ratio.toFixed(3)}`).toBeGreaterThan(0.25);
      }
    }
  });

  it('怪物数量随深度增长并在 24 封顶', () => {
    expect(generateFloor(1, 9).monsterSpawns.length).toBe(8);
    expect(generateFloor(2, 9).monsterSpawns.length).toBe(10);
    expect(generateFloor(12, 9).monsterSpawns.length).toBe(24);
  });

  it('不同种子应生成不同的地图（避免退化为常量地图）', () => {
    const a = generateFloor(4, 1);
    const b = generateFloor(4, 2);
    let same = true;
    for (let y = 0; y < MAP_HEIGHT && same; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (a.map.tileAt(x, y) !== b.map.tileAt(x, y)) {
          same = false;
          break;
        }
      }
    }
    expect(same).toBe(false);
  });
});
