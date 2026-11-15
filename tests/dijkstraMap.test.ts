import { describe, expect, it } from 'vitest';
import { computeDijkstra, dijkstraStep } from '../src/engine/dijkstraMap';
import { GameMap } from '../src/world/map';

/** 行字符串建图：'#' 墙，'.' 地板 */
function mapFrom(rows: string[]): GameMap {
  const first = rows[0];
  if (!first) throw new Error('mapFrom 需要至少一行');
  const tiles = rows.flatMap((row) => [...row].map((c) => (c === '#' ? 'wall' : 'floor')));
  return new GameMap(first.length, rows.length, tiles);
}

describe('computeDijkstra', () => {
  it('源点为 0，相邻 +1，被墙隔断为 -1', () => {
    const map = mapFrom(['...', '###', '...']);
    const dm = computeDijkstra(0, 0, map, (x, y) => map.isWalkable(x, y));
    expect(dm.dist[0]).toBe(0);
    expect(dm.dist[1]).toBe(1);
    expect(dm.dist[2]).toBe(2);
    // 第二行全墙 + 第三行只与墙相邻（BFS 不穿墙斜行）：不可达
    for (let idx = 3; idx < 9; idx++) expect(dm.dist[idx]).toBe(-1);
  });
});

describe('dijkstraStep', () => {
  it('直行下坡：朝源点方向走一格', () => {
    const map = mapFrom(['...', '###', '###']);
    const dm = computeDijkstra(0, 0, map, (x, y) => map.isWalkable(x, y));
    const step = dijkstraStep(dm, { x: 2, y: 0 }, map, (x, y) => map.isWalkable(x, y));
    expect(step).toEqual({ x: 1, y: 0 });
  });

  it('对角下坡 + 八邻固定次序：开放场从 (2,2) 走 (1,1)', () => {
    const map = GameMap.filled(5, 5, 'floor');
    const dm = computeDijkstra(0, 0, map, (x, y) => map.isWalkable(x, y));
    const step = dijkstraStep(dm, { x: 2, y: 2 }, map, (x, y) => map.isWalkable(x, y));
    expect(step).toEqual({ x: 1, y: 1 });
  });

  it('禁穿角：两个正交邻格任一缺失即禁斜行；齐备则贴墙斜行放行', () => {
    const stepOf = (rows: string[]): { x: number; y: number } | null => {
      const map = mapFrom(rows);
      const dm = computeDijkstra(0, 0, map, (x, y) => map.isWalkable(x, y));
      return dijkstraStep(dm, { x: 1, y: 1 }, map, (x, y) => map.isWalkable(x, y));
    };
    // (1,0) 是墙：斜切源点被禁 → null
    expect(stepOf(['.#.', '...', '###'])).toBeNull();
    // (0,1) 是墙：同样被禁 → null
    expect(stepOf(['#..', '...', '###'])).toBeNull();
    // 两个正交邻格齐备（墙在别处）：合法斜行放行，直取源点
    expect(stepOf(['..#', '...', '###'])).toEqual({ x: 0, y: 0 });
  });

  it('占位协商：被占用格跳过，取次优 downhill 格', () => {
    const map = GameMap.filled(3, 3, 'floor');
    const dm = computeDijkstra(0, 0, map, (x, y) => map.isWalkable(x, y));
    // 斜下格 (1,0) 被同伴占用：跳过它，取同样 downhill 的正交格 (1,1)
    const passable = (x: number, y: number): boolean =>
      map.isWalkable(x, y) && !(x === 1 && y === 0);
    const step = dijkstraStep(dm, { x: 2, y: 1 }, map, passable);
    expect(step).toEqual({ x: 1, y: 1 });
  });

  it('占位协商：被占用正交格会阻塞贴身斜行（比 A* 地形转角更严）', () => {
    const map = GameMap.filled(3, 3, 'floor');
    const dm = computeDijkstra(0, 0, map, (x, y) => map.isWalkable(x, y));
    // (1,0) 被占用：从 (1,1) 斜切源点 (0,0) 的转角格缺失 → null
    const passable = (x: number, y: number): boolean =>
      map.isWalkable(x, y) && !(x === 1 && y === 0);
    expect(dijkstraStep(dm, { x: 1, y: 1 }, map, passable)).toBeNull();
    // 对照：无占用时同一斜行放行
    expect(dijkstraStep(dm, { x: 1, y: 1 }, map, (x, y) => map.isWalkable(x, y))).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('占位协商：唯一 downhill 格被占用（走廊堵死）→ null（由调用方回退）', () => {
    const map = mapFrom(['...', '###', '###']);
    const dm = computeDijkstra(0, 0, map, (x, y) => map.isWalkable(x, y));
    const passable = (x: number, y: number): boolean =>
      map.isWalkable(x, y) && !(x === 1 && y === 0);
    expect(dijkstraStep(dm, { x: 2, y: 0 }, map, passable)).toBeNull();
    // 无占用时同格给出正常步（对照）
    expect(dijkstraStep(dm, { x: 2, y: 0 }, map, (x, y) => map.isWalkable(x, y))).toEqual({
      x: 1,
      y: 0,
    });
  });

  it('站在源点上返回 null', () => {
    const map = GameMap.filled(3, 3, 'floor');
    const dm = computeDijkstra(1, 1, map, (x, y) => map.isWalkable(x, y));
    expect(dijkstraStep(dm, { x: 1, y: 1 }, map, (x, y) => map.isWalkable(x, y))).toBeNull();
  });
});
