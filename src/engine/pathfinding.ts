import type { Pt } from './los';
import type { GameMap } from '../world/map';

const STRAIGHT = 10;
const DIAGONAL = 14;

/** 性能计数器（M7 基准用；纯观测，不影响逻辑与确定性） */
export const pathfindingStats = { calls: 0, expanded: 0 };

/** 八方向的 (dx, dy, 代价) */
const NEIGHBORS: readonly (readonly [number, number, number])[] = [
  [1, 0, STRAIGHT],
  [-1, 0, STRAIGHT],
  [0, 1, STRAIGHT],
  [0, -1, STRAIGHT],
  [1, 1, DIAGONAL],
  [1, -1, DIAGONAL],
  [-1, 1, DIAGONAL],
  [-1, -1, DIAGONAL],
];

interface HeapItem {
  node: number;
  f: number;
}

/** 简单二叉小顶堆 */
class MinHeap {
  private items: HeapItem[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: number, f: number): void {
    this.items.push({ node, f });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const cur = this.items[i];
      const par = this.items[parent];
      if (!cur || !par || cur.f >= par.f) break;
      this.items[i] = par;
      this.items[parent] = cur;
      i = parent;
    }
  }

  pop(): HeapItem | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (!top) return undefined;
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        const cur = this.items[i];
        const leftChild = this.items[left];
        const rightChild = this.items[right];
        if (leftChild && cur && leftChild.f < cur.f) smallest = left;
        const smallestItem = this.items[smallest];
        if (rightChild && smallestItem && rightChild.f < smallestItem.f) smallest = right;
        if (smallest === i) break;
        const a = this.items[i];
        const b = this.items[smallest];
        if (!a || !b) break;
        this.items[i] = b;
        this.items[smallest] = a;
        i = smallest;
      }
    }
    return top;
  }
}

function octile(from: Pt, to: Pt): number {
  const dx = Math.abs(from.x - to.x);
  const dy = Math.abs(from.y - to.y);
  return STRAIGHT * (dx + dy) + (DIAGONAL - 2 * STRAIGHT) * Math.min(dx, dy);
}

function reconstruct(cameFrom: Map<number, number>, goal: number, width: number): Pt[] {
  const path: Pt[] = [];
  let cur = goal;
  for (;;) {
    const prev = cameFrom.get(cur);
    path.push({ x: cur % width, y: Math.floor(cur / width) });
    if (prev === undefined) break;
    cur = prev;
  }
  path.reverse();
  // 契约：路径从起点的下一步开始（走到这里时 goal !== from，shift 必然安全）
  path.shift();
  return path;
}

/**
 * A* 寻路（回调版，供 AI 在没有 GameMap 实例时使用）。
 * 8 方向、直行 10 / 斜行 14、禁止穿角（斜行要求两个正交邻格都可通行）。
 * 目标格豁免可通行检查（AI 借此寻路到玩家所在格，最后一步表现为攻击）。
 * 返回从 from 的下一步开始、包含 to 的路径；不可达或展开节点超过 maxNodes 返回 null。
 */
export function findPathWithFn(
  from: Pt,
  to: Pt,
  isWalkable: (x: number, y: number) => boolean,
  maxNodes = 2000,
): Pt[] | null {
  if (from.x === to.x && from.y === to.y) return [];
  const width = 1 << 16; // 虚拟网格宽度，仅用于把坐标打包成唯一索引
  const startIdx = from.y * width + from.x;
  const goalIdx = to.y * width + to.x;

  const gScore = new Map<number, number>([[startIdx, 0]]);
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  const open = new MinHeap();
  open.push(startIdx, octile(from, to));
  let expanded = 0;
  pathfindingStats.calls += 1;

  let cur = open.pop();
  while (cur) {
    const curIdx = cur.node;
    if (curIdx === goalIdx) return reconstruct(cameFrom, curIdx, width);
    if (closed.has(curIdx)) {
      cur = open.pop();
      continue;
    }
    closed.add(curIdx);
    expanded += 1;
    pathfindingStats.expanded += 1;
    if (expanded > maxNodes) return null;

    const cx = curIdx % width;
    const cy = Math.floor(curIdx / width);
    const baseG = gScore.get(curIdx) ?? Number.POSITIVE_INFINITY;

    for (const [dx, dy, cost] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const isGoal = nx === to.x && ny === to.y;
      if (!isWalkable(nx, ny) && !isGoal) continue;
      if (dx !== 0 && dy !== 0) {
        // 禁止穿角
        if (!isWalkable(cx + dx, cy) || !isWalkable(cx, cy + dy)) continue;
      }
      const nIdx = ny * width + nx;
      if (closed.has(nIdx)) continue;
      const tentative = baseG + cost;
      if (tentative < (gScore.get(nIdx) ?? Number.POSITIVE_INFINITY)) {
        gScore.set(nIdx, tentative);
        cameFrom.set(nIdx, curIdx);
        open.push(nIdx, tentative + octile({ x: nx, y: ny }, to));
      }
    }
    cur = open.pop();
  }
  return null;
}

/** A* 寻路（GameMap 版本） */
export function findPath(map: GameMap, from: Pt, to: Pt, maxNodes = 2000): Pt[] | null {
  return findPathWithFn(from, to, (x, y) => map.isWalkable(x, y), maxNodes);
}
