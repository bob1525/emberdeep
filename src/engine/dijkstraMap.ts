/**
 * Dijkstra 距离场（里程碑 7 性能优化）。
 * 从玩家位置 BFS 一次生成全场距离，所有追击怪物查表选方向，
 * 替代每怪一次 A*（24 怪 × 600 节点 → 1 × BFS 全图）。
 * 经典 Roguelike 优化：Brogue/DCSS 同款方案。
 */
import type { GameMap } from '../world/map';
import type { Pt } from './los';

export interface DijkstraMap {
  /** 距离场（-1 = 不可达），行优先 idx = y * width + x */
  dist: Int32Array;
  width: number;
  height: number;
  /** 玩家位置（场源点） */
  ox: number;
  oy: number;
}

const ALL_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** 从源点 BFS 生成距离场；passable 排除不可通行格和被占用格 */
export function computeDijkstra(
  ox: number,
  oy: number,
  map: GameMap,
  isPassable: (x: number, y: number) => boolean,
): DijkstraMap {
  const w = map.width;
  const h = map.height;
  const dist = new Int32Array(w * h).fill(-1);
  const startIdx = oy * w + ox;
  dist[startIdx] = 0;
  const queue: number[] = [startIdx];
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head];
    head += 1;
    if (cur === undefined) break;
    const curDist = dist[cur] ?? -1;
    const cx = cur % w;
    const cy = Math.floor(cur / w);
    for (const [dx, dy] of ALL_DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!map.inBounds(nx, ny)) continue;
      const nIdx = ny * w + nx;
      if (dist[nIdx] !== -1) continue;
      if (!isPassable(nx, ny)) continue;
      dist[nIdx] = curDist + 1;
      queue.push(nIdx);
    }
  }
  return { dist, width: w, height: h, ox, oy };
}

/**
 * 查表选方向：从 self 位置找距离值更小的邻格。
 * 禁止穿角（斜行需要两个正交邻格都可达）。
 * 返回 null 表示已被围死或已在源点。
 */
export function dijkstraStep(
  dm: DijkstraMap,
  self: Pt,
  map: GameMap,
  isPassable: (x: number, y: number) => boolean,
): Pt | null {
  const w = dm.width;
  const curDist = dm.dist[self.y * w + self.x] ?? -1;
  if (curDist <= 0) return null;

  let best: Pt | null = null;
  let bestDist = curDist;
  for (const [dx, dy] of ALL_DIRS) {
    const nx = self.x + dx;
    const ny = self.y + dy;
    if (!map.inBounds(nx, ny)) continue;
    const nDist = dm.dist[ny * w + nx] ?? -1;
    if (nDist === -1 || nDist >= bestDist) continue;
    if (!isPassable(nx, ny)) continue;
    // 禁穿角
    if (dx !== 0 && dy !== 0) {
      if (!isPassable(self.x + dx, self.y) || !isPassable(self.x, self.y + dy)) continue;
    }
    best = { x: nx, y: ny };
    bestDist = nDist;
  }
  return best;
}
