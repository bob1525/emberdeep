import type { Pt } from '../../engine/los';
import type { Rng } from '../../engine/rng';
import type { GameMap } from '../map';

/** 房间最小宽度 */
const MIN_ROOM_W = 6;
/** 房间最小高度 */
const MIN_ROOM_H = 5;
/** 能容纳一个最小房间的区域最小宽度（房间与区域边缘之间各留 1 格墙） */
const MIN_NODE_W = MIN_ROOM_W + 2;
/** 能容纳一个最小房间的区域最小高度 */
const MIN_NODE_H = MIN_ROOM_H + 2;

/** BSP 递归分割的空间区域 */
interface BspNode {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 已雕刻的房间矩形（左上角 + 尺寸） */
interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * BSP 房间层生成：从地图内部区域（不含最外圈墙）开始递归二分，
 * 叶子节点雕刻房间，兄弟子树之间用 L 形走廊连通，保证全部房间互相连通。
 * 走廊只在房间中心之间的矩形范围内雕刻，因此不会触碰最外圈。
 */
export function generateBsp(map: GameMap, rng: Rng): void {
  split({ x: 1, y: 1, w: map.width - 2, h: map.height - 2 }, rng, map);
}

/** 递归分割区域；返回该区域内已连通部分的一个代表点（叶子房间中心） */
function split(node: BspNode, rng: Rng, map: GameMap): Pt {
  const canSplitVertically = node.w >= MIN_NODE_W * 2 + 1;
  const canSplitHorizontally = node.h >= MIN_NODE_H * 2 + 1;
  if (!canSplitVertically && !canSplitHorizontally) {
    const room = chooseRoom(node, rng);
    carveRoom(map, room);
    return roomCenter(room);
  }

  // 优先沿较长的一边切分；两边形状接近时随机决定方向
  let vertical: boolean;
  if (canSplitVertically && canSplitHorizontally) {
    const ratio = node.w / node.h;
    vertical = ratio >= 1.25 ? true : ratio <= 0.8 ? false : rng.next() < 0.5;
  } else {
    vertical = canSplitVertically;
  }

  if (vertical) {
    const leftWidth = rng.int(MIN_NODE_W, node.w - MIN_NODE_W - 1);
    const a = split({ x: node.x, y: node.y, w: leftWidth, h: node.h }, rng, map);
    const b = split({ x: node.x + leftWidth, y: node.y, w: node.w - leftWidth, h: node.h }, rng, map);
    carveLCorridor(map, rng, a, b);
    return a;
  }

  const topHeight = rng.int(MIN_NODE_H, node.h - MIN_NODE_H - 1);
  const a = split({ x: node.x, y: node.y, w: node.w, h: topHeight }, rng, map);
  const b = split({ x: node.x, y: node.y + topHeight, w: node.w, h: node.h - topHeight }, rng, map);
  carveLCorridor(map, rng, a, b);
  return a;
}

/** 在叶子区域内随机取一个满足最小尺寸、四周留墙的房间矩形 */
function chooseRoom(node: BspNode, rng: Rng): Room {
  const w = rng.int(MIN_ROOM_W, node.w - 2);
  const h = rng.int(MIN_ROOM_H, node.h - 2);
  const x = node.x + rng.int(1, node.w - w - 1);
  const y = node.y + rng.int(1, node.h - h - 1);
  return { x, y, w, h };
}

function roomCenter(room: Room): Pt {
  return { x: room.x + (room.w >> 1), y: room.y + (room.h >> 1) };
}

function carveRoom(map: GameMap, room: Room): void {
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      map.setTile(x, y, 'floor');
    }
  }
}

/** 雕刻 L 形走廊：随机决定先横后竖还是先竖后横 */
function carveLCorridor(map: GameMap, rng: Rng, a: Pt, b: Pt): void {
  const carve = (x: number, y: number): void => map.setTile(x, y, 'floor');
  if (rng.next() < 0.5) {
    // 先横后竖：沿 a.y 横向推进到 b.x，再沿 b.x 纵向推进到 b.y
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) carve(x, a.y);
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) carve(b.x, y);
  } else {
    // 先竖后横：沿 a.x 纵向推进到 b.y，再沿 b.y 横向推进到 b.x
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) carve(a.x, y);
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) carve(x, b.y);
  }
}
