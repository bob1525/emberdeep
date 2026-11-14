import type { Rng } from '../../engine/rng';
import type { GameMap } from '../map';
import { floorRegions } from './util';

/** 初始地板填充比例（约 45%） */
const CAVE_INITIAL_FLOOR = 0.45;
/** 平滑轮数下限 */
const CAVE_MIN_ROUNDS = 4;
/** 平滑轮数上限 */
const CAVE_MAX_ROUNDS = 5;
/** 平滑规则：8 邻域中墙的数量达到该值即变墙，否则变地板 */
const CAVE_WALL_NEIGHBORS = 5;
/** 强制为墙的边缘圈数 */
const BORDER_WALL_RINGS = 2;

/**
 * 细胞自动机洞穴层生成：
 * 1. 内部随机填充约 45% 地板（最外圈保持墙）；
 * 2. 平滑 4-5 轮（8 邻域墙数 ≥ 5 变墙，否则变地板）；
 * 3. 边缘两圈强制墙；
 * 4. 洪泛取最大连通地板区，其余地板全部填墙。
 */
export function generateCave(map: GameMap, rng: Rng): void {
  const width = map.width;
  const height = map.height;

  // 1) 内部随机填充
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      map.setTile(x, y, rng.next() < CAVE_INITIAL_FLOOR ? 'floor' : 'wall');
    }
  }

  // 2) 细胞自动机平滑
  const rounds = rng.int(CAVE_MIN_ROUNDS, CAVE_MAX_ROUNDS);
  for (let i = 0; i < rounds; i++) smoothOnce(map);

  // 3) 边缘两圈强制墙
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nearEdge =
        x < BORDER_WALL_RINGS ||
        x >= width - BORDER_WALL_RINGS ||
        y < BORDER_WALL_RINGS ||
        y >= height - BORDER_WALL_RINGS;
      if (nearEdge) map.setTile(x, y, 'wall');
    }
  }

  // 4) 只保留最大的四方向连通地板区，其余填墙
  const [largest] = floorRegions(map);
  if (!largest) return; // 全墙的退化情况，交给 generateFloor 的重试机制处理
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (map.isWalkable(x, y) && !largest.has(y * width + x)) map.setTile(x, y, 'wall');
    }
  }
}

/** 一轮平滑：先快照全部瓦片再逐格改写，避免本轮写入影响本轮读取 */
function smoothOnce(map: GameMap): void {
  const width = map.width;
  const height = map.height;
  const snap = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      snap[y * width + x] = map.isWalkable(x, y) ? 1 : 0;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let walls = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          // 快照越界读出 undefined，按墙计
          if (snap[(y + dy) * width + (x + dx)] !== 1) walls++;
        }
      }
      map.setTile(x, y, walls >= CAVE_WALL_NEIGHBORS ? 'wall' : 'floor');
    }
  }
}
