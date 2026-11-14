/** 网格上的整数坐标 */
export interface Pt {
  x: number;
  y: number;
}

/**
 * Bresenham 视线检测：从 (x0,y0) 到 (x1,y1) 之间没有阻挡格即视为可见。
 * 端点本身不参与阻挡判断（站在墙里的怪不存在，但目标格可以是墙旁）。
 */
export function hasLineOfSight(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  isBlocked: (x: number, y: number) => boolean,
): boolean {
  let cx = x0;
  let cy = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (cx !== x1 || cy !== y1) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
    // 走完一步后才检查中途格；到达端点即返回，端点不检查阻挡
    if (cx === x1 && cy === y1) return true;
    if (isBlocked(cx, cy)) return false;
  }
  return true;
}
