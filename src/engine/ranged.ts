/**
 * 远程/投掷战斗的弹道与命中数学 — 纯逻辑，不含 UI 瞄准（瞄准由集成层完成）。
 * 弹道为八方向直线：逐格前进，撞墙停在墙前，飞行途中第一格有目标即命中并停止。
 * 伤害掷骰与近战结算（combat.ts）共用同一 Rng，同种子完全可复现。
 */
import type { Pt } from './los';
import type { Rng } from './rng';

/** 远程武器类别：bow = 弓（可反复使用），thrown = 投掷物（掷出即消耗） */
export type RangedKind = 'bow' | 'thrown';

/** 单件远程武器的静态定义 */
export interface RangedDef {
  catalogId: string;
  /** 中文名 */
  name: string;
  /** 地面字符：} 弓类 / ! 投掷刀（沿用物品目录惯例） */
  glyph: string;
  color: string;
  kind: RangedKind;
  /** 最大射程（格） */
  range: number;
  /** 伤害区间 [min, max]（含端点） */
  damage: [number, number];
  /** thrown=true 的武器掷出后即消耗（掉落在目标格或途中） */
  thrown: boolean;
  /** 最浅出现层数（更浅不生成；深度门控由游戏层执行） */
  minDepth: number;
}

/**
 * 远程武器目录：catalogId → 定义。
 * 数值定位：短弓入门可靠、长弓深层的远程顶级输出、飞刀廉价的一次性补刀工具。
 */
export const RANGED: Record<string, RangedDef> = {
  short_bow: {
    catalogId: 'short_bow',
    name: '短弓',
    glyph: '}',
    color: '#c9a15c',
    kind: 'bow',
    range: 6,
    damage: [3, 6],
    thrown: false,
    minDepth: 1,
  },
  long_bow: {
    catalogId: 'long_bow',
    name: '长弓',
    glyph: '}',
    color: '#9c7a45',
    kind: 'bow',
    range: 9,
    damage: [5, 9],
    thrown: false,
    minDepth: 3,
  },
  throwing_knife: {
    catalogId: 'throwing_knife',
    name: '飞刀',
    glyph: '!',
    color: '#a9b8c6',
    kind: 'thrown',
    range: 4,
    damage: [2, 4],
    thrown: true,
    minDepth: 1,
  },
};

// 定义对象冻结为只读，防止运行期意外篡改（与物品目录保持一致）
for (const def of Object.values(RANGED)) {
  Object.freeze(def);
}

/** 判断 (dx,dy) 是否为八方向单位向量：每个分量 ∈ {-1,0,1} 且不全为 0 */
function isUnitDirection(dx: number, dy: number): boolean {
  if (!Number.isInteger(dx) || !Number.isInteger(dy)) return false;
  return Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx !== 0 || dy !== 0);
}

/**
 * 从 from 沿八方向 (dx,dy) 的直线弹道：逐格前进，遇 isBlocked 格停下
 * （阻挡格本身不含在路径里——箭矢撞墙停在墙前），或到射程上限。
 * 防御式：方向非法或射程 < 1（含 NaN / ±∞）返回空路径；非整数射程向下取整。
 */
export function shotPath(
  from: Pt,
  dx: number,
  dy: number,
  range: number,
  isBlocked: (x: number, y: number) => boolean,
): Pt[] {
  if (!isUnitDirection(dx, dy)) return [];
  const maxSteps = Number.isFinite(range) ? Math.floor(range) : 0;
  if (maxSteps < 1) return [];
  const path: Pt[] = [];
  let x = from.x;
  let y = from.y;
  for (let step = 0; step < maxSteps; step++) {
    x += dx;
    y += dy;
    // 撞墙：该格不入路径，箭矢停在墙前
    if (isBlocked(x, y)) break;
    path.push({ x, y });
  }
  return path;
}

/** 一次射击的完整结算结果 */
export interface ShotReport {
  /** 弹道实际经过的格子（不含 from；命中时止于目标格） */
  path: Pt[];
  /** 弹道终点上是否有目标（即是否命中） */
  hit: boolean;
  /** 命中伤害（未命中为 0），区间由武器 damage + rng 决定 */
  damage: number;
  /** 弹着点（无效输入或一步未飞出时为发射点） */
  x: number;
  y: number;
}

/**
 * 完整射击结算：沿 shotPath 逐格飞行，第一格 targetAt 为 true 的格子即命中并停止。
 * 只有命中才消耗 rng 掷伤害（rng.int(damage[0], damage[1])），未命中伤害 0 且不掷骰。
 * 防御式：方向非法 / 射程不足时返回空弹道、不命中，弹着点为发射点。
 * 发射格本身不参与目标判定——站在原地的单位不会被自己射出的弹矢命中；
 * 阻挡优先于目标：位于墙格里的"目标"不会被命中（该格不入弹道）。
 */
export function resolveShot(opts: {
  from: Pt;
  dx: number;
  dy: number;
  def: RangedDef;
  isBlocked: (x: number, y: number) => boolean;
  /** 当前该格是否有敌人；返回 true 即视为有目标（集成层负责把"目标 id 或 null"折叠成布尔） */
  targetAt: (x: number, y: number) => boolean;
  rng: Rng;
}): ShotReport {
  const path = shotPath(opts.from, opts.dx, opts.dy, opts.def.range, opts.isBlocked);

  // 逐格飞行：第一格有目标的格子即命中并停止
  let hitIndex = -1;
  let impact: Pt | null = null;
  for (const [i, cell] of path.entries()) {
    if (opts.targetAt(cell.x, cell.y)) {
      hitIndex = i;
      impact = cell;
      break;
    }
  }

  if (!impact) {
    // 未命中：弹着点为弹道终点；一步都没飞出去（撞墙/无效输入）则为发射点
    const last = path[path.length - 1];
    return {
      path,
      hit: false,
      damage: 0,
      x: last ? last.x : opts.from.x,
      y: last ? last.y : opts.from.y,
    };
  }

  const [lo, hi] = opts.def.damage;
  return {
    // 命中：弹道止于目标格，不会越过
    path: path.slice(0, hitIndex + 1),
    hit: true,
    damage: opts.rng.int(lo, hi),
    x: impact.x,
    y: impact.y,
  };
}
