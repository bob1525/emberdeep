import type { Tile } from './tiles';

/** 矩形瓦片地图，行优先存储 */
export class GameMap {
  readonly width: number;
  readonly height: number;
  private tiles: Tile[];

  constructor(width: number, height: number, tiles: Tile[]) {
    if (tiles.length !== width * height) {
      throw new Error(`地图数据尺寸不符：期望 ${width * height}，实际 ${tiles.length}`);
    }
    this.width = width;
    this.height = height;
    this.tiles = tiles;
  }

  static filled(width: number, height: number, tile: Tile): GameMap {
    return new GameMap(width, height, new Array<Tile>(width * height).fill(tile));
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /** 越界一律视为墙，调用方无需先做边界检查 */
  tileAt(x: number, y: number): Tile {
    if (!this.inBounds(x, y)) return 'wall';
    return this.tiles[y * this.width + x] ?? 'wall';
  }

  setTile(x: number, y: number, tile: Tile): void {
    if (!this.inBounds(x, y)) throw new Error(`setTile 越界：(${x}, ${y})`);
    this.tiles[y * this.width + x] = tile;
  }

  isWalkable(x: number, y: number): boolean {
    return this.tileAt(x, y) === 'floor';
  }

  /** 导出地形数据（行优先），供存档使用 */
  exportGrid(): Tile[] {
    return [...this.tiles];
  }
}
