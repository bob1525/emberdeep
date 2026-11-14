import { describe, expect, it } from 'vitest';
import { GameMap } from '../src/world/map';

describe('GameMap', () => {
  it('filled() 创建指定尺寸的地图', () => {
    const map = GameMap.filled(10, 6, 'wall');
    expect(map.width).toBe(10);
    expect(map.height).toBe(6);
    expect(map.tileAt(4, 4)).toBe('wall');
  });

  it('数据尺寸不符时抛错', () => {
    expect(() => new GameMap(10, 6, new Array(59).fill('wall'))).toThrow();
  });

  it('越界访问视为墙', () => {
    const map = GameMap.filled(10, 10, 'floor');
    expect(map.tileAt(-1, 0)).toBe('wall');
    expect(map.tileAt(0, -1)).toBe('wall');
    expect(map.tileAt(10, 0)).toBe('wall');
    expect(map.tileAt(0, 10)).toBe('wall');
  });

  it('setTile 越界时抛错', () => {
    const map = GameMap.filled(10, 10, 'wall');
    expect(() => map.setTile(10, 5, 'floor')).toThrow();
  });

  it('isWalkable 只对地板为真', () => {
    const map = GameMap.filled(10, 10, 'wall');
    map.setTile(3, 3, 'floor');
    expect(map.isWalkable(3, 3)).toBe(true);
    expect(map.isWalkable(0, 0)).toBe(false);
  });

  it('exportGrid 往返还原地形（存档依赖）', () => {
    const map = GameMap.filled(4, 3, 'wall');
    map.setTile(1, 1, 'floor');
    const grid = map.exportGrid();
    const restored = new GameMap(4, 3, grid);
    expect(restored.tileAt(1, 1)).toBe('floor');
    expect(restored.tileAt(0, 0)).toBe('wall');
  });
});
