import { describe, expect, it } from 'vitest';
import { createDemoMap } from '../src/world/demoMap';

const STAIRS = { x: 65, y: 33 };
const START = { x: 8, y: 8 };

describe('createDemoMap', () => {
  const map = createDemoMap();

  it('玩家起点和楼梯所在处都可通行', () => {
    expect(map.isWalkable(START.x, START.y)).toBe(true);
    expect(map.isWalkable(STAIRS.x, STAIRS.y)).toBe(true);
  });

  it('从起点可以一路走到楼梯（洪泛填充验证连通性）', () => {
    const seen = new Set<string>([`${START.x},${START.y}`]);
    const queue = [START];
    let reachedStairs = false;

    while (queue.length > 0) {
      const cur = queue.pop()!;
      if (cur.x === STAIRS.x && cur.y === STAIRS.y) {
        reachedStairs = true;
        break;
      }
      const neighbors = [
        { x: cur.x + 1, y: cur.y },
        { x: cur.x - 1, y: cur.y },
        { x: cur.x, y: cur.y + 1 },
        { x: cur.x, y: cur.y - 1 },
      ];
      for (const n of neighbors) {
        const key = `${n.x},${n.y}`;
        if (!seen.has(key) && map.isWalkable(n.x, n.y)) {
          seen.add(key);
          queue.push(n);
        }
      }
    }

    expect(reachedStairs).toBe(true);
  });

  it('地图边界保持是墙', () => {
    for (let x = 0; x < map.width; x++) {
      expect(map.tileAt(x, 0)).toBe('wall');
      expect(map.tileAt(x, map.height - 1)).toBe('wall');
    }
    for (let y = 0; y < map.height; y++) {
      expect(map.tileAt(0, y)).toBe('wall');
      expect(map.tileAt(map.width - 1, y)).toBe('wall');
    }
  });
});
