import type { Pt } from '../../engine/los';
import { Rng } from '../../engine/rng';
import { GameMap } from '../map';
import { generateBsp } from './bsp';
import { generateCave } from './cave';
import { bfsReach, chebyshev, toIndex, toPoint } from './util';

/** 楼层地图宽度 */
export const MAP_WIDTH = 80;
/** 楼层地图高度 */
export const MAP_HEIGHT = 45;
/** BSP 房间层的最大深度（depth ≤ 3 用 BSP，≥ 4 用洞穴） */
const BSP_MAX_DEPTH = 3;
/** 楼梯与出生点的最小 BFS 距离 */
const STAIRS_MIN_BFS_DIST = 30;
/** 怪物与出生点的最小切比雪夫距离 */
const MONSTER_MIN_CHEB = 8;
/** 物品与出生点的最小切比雪夫距离 */
const ITEM_MIN_CHEB = 6;
/** 怪物数量上限 */
const MONSTER_CAP = 24;
/** 生成失败时的最大尝试次数 */
const MAX_ATTEMPTS = 20;
/** 重试时的种子偏移步长 */
const ATTEMPT_SEED_STEP = 7919;

/** 一次楼层生成的完整结果 */
export interface FloorData {
  map: GameMap;
  playerSpawn: Pt;
  stairsDown: Pt;
  monsterSpawns: Pt[];
  itemSpots: Pt[];
}

/**
 * 生成一层地牢。depth 从 1 开始：1-3 层为 BSP 房间，≥ 4 层为细胞自动机洞穴。
 * 同一组 (depth, seed) 输出完全一致；个别种子生成废图时用派生种子 seed + attempt*7919 重试。
 */
export function generateFloor(depth: number, seed: number): FloorData {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return tryGenerate(depth, seed, attempt);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `楼层生成失败：depth=${depth}, seed=${seed}, 连续 ${MAX_ATTEMPTS} 次尝试均未通过校验`,
    { cause: lastError },
  );
}

/** 用派生种子做单次生成尝试；任何校验不过都抛错，由 generateFloor 决定重试 */
function tryGenerate(depth: number, seed: number, attempt: number): FloorData {
  const derivedSeed = (seed + attempt * ATTEMPT_SEED_STEP) >>> 0;
  const rng = new Rng(derivedSeed);
  const map = GameMap.filled(MAP_WIDTH, MAP_HEIGHT, 'wall');
  if (depth <= BSP_MAX_DEPTH) generateBsp(map, rng);
  else generateCave(map, rng);

  const floors = collectFloors(map);
  if (floors.length === 0) throw new Error('生成结果中没有地板格');

  // 洞穴层要求地板足够开阔，过于破碎的图直接重试
  const floorRatio = floors.length / (MAP_WIDTH * MAP_HEIGHT);
  if (depth > BSP_MAX_DEPTH && floorRatio <= 0.25) {
    throw new Error(`洞穴层地板占比过低：${floorRatio.toFixed(3)}`);
  }

  // 出生点：随机一块地板
  const playerSpawn = rng.pick(floors);

  // BFS 距离场；其键集合即从出生点洪泛可达的全部地板格
  const dist = bfsReach(map, playerSpawn);
  let maxIndex = -1;
  let maxDist = -1;
  const farIndices: number[] = [];
  for (const [index, d] of dist) {
    if (d > maxDist) {
      maxDist = d;
      maxIndex = index;
    }
    if (d >= STAIRS_MIN_BFS_DIST) farIndices.push(index);
  }
  if (maxIndex < 0) throw new Error('出生点没有任何可达地板格');

  // 楼梯：优先从 BFS 距离 ≥ 30 的可达格中挑一个；可达范围整体不足 30 时取最深格
  const chosen = farIndices.length > 0 ? farIndices[rng.int(0, farIndices.length - 1)] : undefined;
  const stairsDown = toPoint(chosen ?? maxIndex, map.width);

  // 洪泛验证：楼梯必须从出生点可达
  if (!dist.has(toIndex(stairsDown.x, stairsDown.y, map.width))) {
    throw new Error('楼梯与出生点不连通');
  }

  // 点位统一占用表：出生点、楼梯、怪物、物品两两不同格
  const occupied = new Set<number>([
    toIndex(playerSpawn.x, playerSpawn.y, map.width),
    toIndex(stairsDown.x, stairsDown.y, map.width),
  ]);

  const monsterCount = Math.min(6 + depth * 2, MONSTER_CAP);
  const monsterPool = floors.filter((p) => chebyshev(p, playerSpawn) >= MONSTER_MIN_CHEB);
  const monsterSpawns = pickDistinct(rng, monsterPool, monsterCount, occupied, map.width);
  if (monsterSpawns.length < monsterCount) throw new Error('满足间距要求的怪物刷新点不足');

  const itemCount = rng.int(2, 4);
  const itemPool = floors.filter((p) => chebyshev(p, playerSpawn) >= ITEM_MIN_CHEB);
  const itemSpots = pickDistinct(rng, itemPool, itemCount, occupied, map.width);
  if (itemSpots.length < itemCount) throw new Error('满足间距要求的物品点位不足');

  return { map, playerSpawn, stairsDown, monsterSpawns, itemSpots };
}

/** 收集内部区域的所有地板格（最外圈必为墙，无需扫描） */
function collectFloors(map: GameMap): Pt[] {
  const points: Pt[] = [];
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) {
      if (map.isWalkable(x, y)) points.push({ x, y });
    }
  }
  return points;
}

/** 从候选点中无放回地随机取 count 个，选中的点写入 occupied；返回实际取到的点 */
function pickDistinct(
  rng: Rng,
  candidates: readonly Pt[],
  count: number,
  occupied: Set<number>,
  width: number,
): Pt[] {
  const pool = candidates.filter((p) => !occupied.has(toIndex(p.x, p.y, width)));
  const picked: Pt[] = [];
  while (picked.length < count && pool.length > 0) {
    const [spot] = pool.splice(rng.int(0, pool.length - 1), 1);
    if (!spot) break; // 越界保护，理论上不会发生
    occupied.add(toIndex(spot.x, spot.y, width));
    picked.push(spot);
  }
  return picked;
}
