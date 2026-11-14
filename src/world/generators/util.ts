import type { Pt } from '../../engine/los';
import type { GameMap } from '../map';

/** 四方向偏移：右、左、下、上 */
const DIRS4: readonly Pt[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** (x, y) 坐标转行优先数组索引 */
export function toIndex(x: number, y: number, width: number): number {
  return y * width + x;
}

/** 行优先数组索引转 (x, y) 坐标 */
export function toPoint(index: number, width: number): Pt {
  return { x: index % width, y: Math.floor(index / width) };
}

/** 切比雪夫距离（棋盘距离） */
export function chebyshev(a: Pt, b: Pt): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * 从 start 出发沿四方向 BFS 洪泛。
 * 返回 索引 → 步数 的距离场；距离场的键集合即为从 start 可达的地板格集合。
 * start 本身不可走时返回空表。
 */
export function bfsReach(map: GameMap, start: Pt): Map<number, number> {
  const dist = new Map<number, number>();
  const width = map.width;
  if (!map.isWalkable(start.x, start.y)) return dist;
  const origin = toIndex(start.x, start.y, width);
  dist.set(origin, 0);
  const queue: number[] = [origin];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur === undefined) break; // head < queue.length，仅为满足索引安全检查
    const curDist = dist.get(cur) ?? 0;
    const x = cur % width;
    const y = Math.floor(cur / width);
    for (const d of DIRS4) {
      const nx = x + d.x;
      const ny = y + d.y;
      if (!map.isWalkable(nx, ny)) continue;
      const ni = toIndex(nx, ny, width);
      if (dist.has(ni)) continue;
      dist.set(ni, curDist + 1);
      queue.push(ni);
    }
  }
  return dist;
}

/** 找出所有四方向连通的地板区域，按面积从大到小排序；每块区域用格索引集合表示 */
export function floorRegions(map: GameMap): Set<number>[] {
  const width = map.width;
  const height = map.height;
  const visited = new Uint8Array(width * height);
  const regions: Set<number>[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (visited[toIndex(x, y, width)] !== 0 || !map.isWalkable(x, y)) continue;
      const region = new Set<number>();
      const origin = toIndex(x, y, width);
      visited[origin] = 1;
      const queue: number[] = [origin];
      for (let head = 0; head < queue.length; head++) {
        const cur = queue[head];
        if (cur === undefined) break;
        region.add(cur);
        const cx = cur % width;
        const cy = Math.floor(cur / width);
        for (const d of DIRS4) {
          const nx = cx + d.x;
          const ny = cy + d.y;
          if (!map.isWalkable(nx, ny)) continue;
          const ni = toIndex(nx, ny, width);
          if (visited[ni] !== 0) continue;
          visited[ni] = 1;
          queue.push(ni);
        }
      }
      regions.push(region);
    }
  }
  regions.sort((a, b) => b.size - a.size);
  return regions;
}
