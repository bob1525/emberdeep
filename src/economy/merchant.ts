/**
 * 商人系统 — 每层货架抽取与定价数学。纯逻辑，无 UI（商店界面由集成层完成）。
 * 定价基准：
 * - 药水 ≈ 15-30、卷轴 ≈ 25-40：基准价 + 物品强度分在区间内取档，不随深度浮动；
 * - 武器/护甲：按 bonus 线性（每点 ≈ 25）× 深度系数（1 + depth × 0.1）；
 * - 远程：伤害均值 × 6 + 射程 × 3 的强度分 × 深度系数。
 * 卖出价恒为买入价的 40%（向下取整，至少 1）。货架抽取全走 Rng，同种子完全可复现。
 */
import { RANGED } from '../engine/ranged';
import type { Rng } from '../engine/rng';
import { ITEMS } from '../items/catalog';
import type { ItemDef } from '../items/catalog';

/** 商人货架条目 */
export interface StockEntry {
  catalogId: string;
  category: 'potion' | 'scroll' | 'weapon' | 'armor' | 'ranged';
  /** 买入价 */
  price: number;
}

/** 货架商品类别（与 StockEntry['category'] 一致的内部别名） */
type MerchantCategory = StockEntry['category'];

/**
 * ITEMS 商品的上架门控表：最浅可上架层数。
 * 与物品目录掉落表 LOOT_WEIGHTS 的 minDepth 保持一致（该表未导出，故此处镜像一份）。
 * 远程武器的门控直接读 RangedDef.minDepth，不进此表；未收录的商品视为第 1 层即可上架。
 */
const STOCK_MIN_DEPTH: Record<string, number> = {
  minor_healing: 1,
  healing: 1,
  might: 1,
  teleport: 1,
  fireblast: 1,
  dagger: 1,
  short_sword: 2,
  war_axe: 3,
  leather_armor: 1,
  chain_mail: 2,
  plate_armor: 3,
};

/** 商品的最浅上架层数：远程读目录定义，其余查门控表（缺省视为 1） */
function stockMinDepth(catalogId: string, category: MerchantCategory): number {
  if (category === 'ranged') return RANGED[catalogId]?.minDepth ?? 1;
  return STOCK_MIN_DEPTH[catalogId] ?? 1;
}

/** 把深度归一为安全整数：非有限值（NaN / ±∞）或 ≤0 回落到第 1 层 */
function normalizeDepth(depth: number): number {
  return Number.isFinite(depth) ? Math.max(1, Math.floor(depth)) : 1;
}

/** clamp 到闭区间 [lo, hi] */
function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * 药水/卷轴的强度分（0 档起算）：决定其在基准区间内的高档程度。
 * - heal 字段（药水的回复量 / 火焰爆裂卷轴的伤害区间）：均值越大越贵；
 * - might 药水：bonus × duration 折算；
 * - teleport 卷轴：固定低档；未知效果给保底档。
 */
function consumableStrength(def: ItemDef): number {
  if (def.heal) {
    const [lo, hi] = def.heal;
    return ((lo + hi) / 2) * 1.5 - 9;
  }
  if (def.effect === 'might') return (def.bonus ?? 0) * (def.duration ?? 0) * 0.25;
  if (def.effect === 'teleport') return 3;
  return 5;
}

/** 装备/远程的深度系数：每加深一层涨价 10% */
function depthFactor(depth: number): number {
  return 1 + depth * 0.1;
}

/**
 * 指定商品的买入价（含深度与物品强度加成）。
 * 药水/卷轴为固定基准价 + 强度分（药水 ∈ [15,30]、卷轴 ∈ [25,40]），不随深度浮动；
 * 武器/护甲/远程乘深度系数，随深度单调不减。
 * catalogId 不在对应目录、或类别与目录定义不符时抛错。
 */
export function buyPrice(catalogId: string, category: MerchantCategory, depth: number): number {
  const d = normalizeDepth(depth);
  // 远程走 RANGED 目录，其余类别走 ITEMS 目录
  if (category === 'ranged') {
    const def = RANGED[catalogId];
    if (!def) throw new Error(`远程目录中不存在: "${catalogId}"`);
    const [lo, hi] = def.damage;
    const strength = ((lo + hi) / 2) * 6 + def.range * 3;
    return Math.max(5, Math.round(strength * depthFactor(d)));
  }
  const def = ITEMS[catalogId];
  if (!def) throw new Error(`物品目录中不存在: "${catalogId}"`);
  if (def.category !== category) {
    throw new Error(`"${catalogId}" 的类别为 ${def.category}，与传入的 ${category} 不符`);
  }
  if (category === 'weapon' || category === 'armor') {
    // 每点 bonus ≈ 25 金币，再乘深度系数；bonus 缺失按 0 防御式处理
    const strength = Math.max(0, def.bonus ?? 0) * 25;
    return Math.max(5, Math.round(strength * depthFactor(d)));
  }
  // 药水/卷轴：基准价 + 强度分（clamp 保区间），恒定不随深度
  const base = category === 'potion' ? 15 : 25;
  return Math.max(5, base + clamp(Math.round(consumableStrength(def)), 0, 15));
}

/** 卖出价 = 买入价的 40%（向下取整，至少 1） */
export function sellPrice(catalogId: string, category: MerchantCategory, depth: number): number {
  return Math.max(1, Math.floor(buyPrice(catalogId, category, depth) * 0.4));
}

/**
 * 每层商人的货架：4-6 件，从 ITEMS 与 RANGED 两个目录按 minDepth 门控抽取。
 * 门控规则：minDepth > depth 的商品绝不出现；条目 price 直接取 buyPrice。
 * 抽取为部分洗牌（整点掷数），同 rng 状态完全可复现。
 */
export function rollStock(depth: number, rng: Rng): StockEntry[] {
  const d = normalizeDepth(depth);
  // 组装当前深度的候选池：两个目录合并，门控剔除过浅不能上架的商品
  const pool: Array<{ catalogId: string; category: MerchantCategory }> = [];
  for (const [id, def] of Object.entries(ITEMS)) {
    if (d >= stockMinDepth(id, def.category)) pool.push({ catalogId: id, category: def.category });
  }
  for (const [id] of Object.entries(RANGED)) {
    if (d >= stockMinDepth(id, 'ranged')) pool.push({ catalogId: id, category: 'ranged' });
  }
  // 部分洗牌无重复抽取 4-6 件（池不足时取全池）：
  // 每轮掷 j ∈ [i, len-1] 交换 pool[i]↔pool[j]，取"换入位"的元素 b —— 它来自全池任意位置，
  // 且换出后留在前缀区不会被再次抽中，故无重复。
  const count = Math.min(rng.int(4, 6), pool.length);
  const stock: StockEntry[] = [];
  for (let i = 0; i < count; i++) {
    const a = pool[i];
    const j = rng.int(i, pool.length - 1);
    const b = pool[j];
    if (!a || !b) break; // 防御式：索引越界即终止
    pool[i] = b;
    pool[j] = a;
    stock.push({ catalogId: b.catalogId, category: b.category, price: buyPrice(b.catalogId, b.category, d) });
  }
  return stock;
}
