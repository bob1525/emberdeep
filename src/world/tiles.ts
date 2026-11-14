export type Tile = 'wall' | 'floor';

/** 地形对应的字符画字形 */
export const TILE_GLYPH: Record<Tile, string> = {
  wall: '#',
  floor: '·',
};

/** 地形对应的颜色 */
export const TILE_COLOR: Record<Tile, string> = {
  wall: '#566070',
  floor: '#38404f',
};
