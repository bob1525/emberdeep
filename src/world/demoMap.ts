import { GameMap } from './map';

/**
 * 首个可玩的演示地图：手挖的六个房间加走廊。
 * Phase 2 会把它替换成 BSP + 洞穴的程序化生成。
 */
export function createDemoMap(): GameMap {
  const map = GameMap.filled(80, 45, 'wall');

  // 房间（左上角 x, y, 宽, 高）
  carveRect(map, 5, 5, 14, 8);   // A 起始房
  carveRect(map, 30, 4, 12, 10); // B
  carveRect(map, 55, 8, 16, 9);  // C
  carveRect(map, 8, 25, 18, 12); // D
  carveRect(map, 35, 22, 14, 14);// E
  carveRect(map, 58, 28, 14, 10);// F 楼梯房

  // 走廊
  carveRect(map, 12, 13, 1, 12); // A → D
  carveRect(map, 19, 8, 11, 1);  // A → B
  carveRect(map, 42, 12, 13, 1); // B → C
  carveRect(map, 62, 17, 1, 11); // C → F
  carveRect(map, 26, 30, 9, 1);  // D → E
  carveRect(map, 49, 30, 9, 1);  // E → F

  return map;
}

function carveRect(map: GameMap, x: number, y: number, w: number, h: number): void {
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      map.setTile(tx, ty, 'floor');
    }
  }
}
