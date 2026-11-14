/**
 * 递归阴影投射（recursive shadowcasting）视野算法，8 象限扫描。
 * 特性：墙本身可见（照亮墙面）、墙后不可见、欧氏距离判定、原点恒可见。
 */

/** 每个象限的坐标变换 [xx, xy, yx, yy]（RogueBasin 经典矩阵按列展开） */
const OCTANTS: readonly (readonly [number, number, number, number])[] = [
  [1, 0, 0, 1],
  [0, 1, -1, 0],
  [-1, 0, 0, 1],
  [0, -1, 1, 0],
  [-1, 0, 0, -1],
  [0, -1, -1, 0],
  [1, 0, 0, -1],
  [0, 1, 1, 0],
];

/**
 * 计算以 (ox, oy) 为圆心、radius 为半径的可见格集合。
 * 返回键为 "x,y" 的集合，包含原点本身。
 */
export function computeFov(opts: {
  isBlocked: (x: number, y: number) => boolean;
  ox: number;
  oy: number;
  radius: number;
}): Set<string> {
  const visible = new Set<string>([`${opts.ox},${opts.oy}`]);
  const radiusSq = opts.radius * opts.radius;
  for (const [xx, xy, yx, yy] of OCTANTS) {
    castLight(
      opts.ox,
      opts.oy,
      1,
      1.0,
      0.0,
      opts.radius,
      radiusSq,
      xx,
      xy,
      yx,
      yy,
      opts.isBlocked,
      visible,
    );
  }
  return visible;
}

/** 在单个象限内递归投射光影；start/end 是当前光束的斜率边界 */
function castLight(
  cx: number,
  cy: number,
  row: number,
  start: number,
  end: number,
  radius: number,
  radiusSq: number,
  xx: number,
  xy: number,
  yx: number,
  yy: number,
  isBlocked: (x: number, y: number) => boolean,
  visible: Set<string>,
): void {
  if (start < end) return;
  let newStart = 0;
  let blocked = false;

  for (let distance = row; distance <= radius && !blocked; distance++) {
    const dy = -distance;
    for (let dx = -distance; dx <= 0; dx++) {
      const leftSlope = (dx - 0.5) / (dy + 0.5);
      const rightSlope = (dx + 0.5) / (dy - 0.5);
      const x = cx + dx * xx + dy * xy;
      const y = cy + dx * yx + dy * yy;

      if (start < rightSlope) continue;
      if (end > leftSlope) break;

      // 欧氏距离判定：圆内才可见（墙也在圆内可见）
      if (dx * dx + dy * dy <= radiusSq) visible.add(`${x},${y}`);

      if (blocked) {
        // 光束当前处于阻挡状态：遇到新的墙则收窄，遇到空地则恢复
        if (isBlocked(x, y)) {
          newStart = rightSlope;
          continue;
        }
        blocked = false;
        start = newStart;
      } else if (isBlocked(x, y) && distance < radius) {
        // 新的墙：向墙后递归投射残余光束，并收窄当前光束
        blocked = true;
        castLight(
          cx,
          cy,
          distance + 1,
          start,
          leftSlope,
          radius,
          radiusSq,
          xx,
          xy,
          yx,
          yy,
          isBlocked,
          visible,
        );
        newStart = rightSlope;
      }
    }
  }
}
