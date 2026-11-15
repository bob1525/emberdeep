/**
 * 物品目录 — 游戏内所有物品的静态定义、实例工厂与掉落抽取。
 * 纯数据 + 查询/抽取逻辑；药水/卷轴的具体效果结算由游戏层按 effect 字段解释。
 */
import { allocateItemUid } from '../entities/actor';
import type { ItemCategory, ItemInstance } from '../entities/actor';
import type { Rng } from '../engine/rng';

/** 单件物品的静态定义 */
export interface ItemDef {
  catalogId: string;
  category: ItemCategory;
  /** 中文名（如 "治疗药水"） */
  name: string;
  /** 地面字符：药水 !、卷轴 ?、武器 /、护甲 [ */
  glyph: string;
  color: string;
  /** 一句话中文描述 */
  description: string;
  /** weapon：攻击加成；armor：防御加成；might 药水：生效期间的攻击加成 */
  bonus?: number;
  /** potion：回复量区间 [min, max]（含端点）；fireblast 卷轴：伤害区间 [min, max] */
  heal?: [number, number];
  /** potion/scroll 特殊效果 */
  effect?: 'might' | 'teleport' | 'fireblast';
  /** might 等持续型效果的持续回合 */
  duration?: number;
}

/**
 * 物品目录：catalogId → 定义。
 * 数值基准：玩家 30HP / 攻击 4 / 防御 1；战利品随深度逐步升级。
 */
export const ITEMS: Record<string, ItemDef> = {
  minor_healing: {
    catalogId: 'minor_healing',
    category: 'potion',
    name: '小型治疗药水',
    glyph: '!',
    color: '#e0705f',
    description: '恢复 6-10 点生命的淡红色药剂。',
    heal: [6, 10],
  },
  healing: {
    catalogId: 'healing',
    category: 'potion',
    name: '治疗药水',
    glyph: '!',
    color: '#d43d2e',
    description: '恢复 12-20 点生命的深红药剂，深渊中的救命稻草。',
    heal: [12, 20],
  },
  // 高级治疗药水：治疗线第三档（小型 6-10 → 标准 12-20 → 高级 18-30，均值 +50%）。
  // 喝药逻辑按 heal[1] 择优（受伤时优先大瓶），本条目无需任何分支改动即可走通；
  // 掉落权重用 growth 而非 minDepth 做深层偏向（深层权重 5 倍于浅层，
  // 且与经济侧 STOCK_MIN_DEPTH 对未收录条目"视为第 1 层"的门控语义保持一致）。
  greater_healing: {
    catalogId: 'greater_healing',
    category: 'potion',
    name: '高级治疗药水',
    glyph: '!',
    color: '#ff3d6e',
    description: '恢复 18-30 点生命的璀璨洋红药剂，深渊老手的底气。',
    heal: [18, 30],
  },
  might: {
    catalogId: 'might',
    category: 'potion',
    name: '力量药水',
    glyph: '!',
    color: '#e8a13c',
    description: '饮下后 20 回合内攻击 +3，血脉偾张。',
    bonus: 3,
    effect: 'might',
    duration: 20,
  },
  teleport: {
    catalogId: 'teleport',
    category: 'scroll',
    name: '传送卷轴',
    glyph: '?',
    color: '#6fb3e0',
    description: '将持有者随机抛向本层另一处的蓝色符纸。',
    effect: 'teleport',
  },
  fireblast: {
    catalogId: 'fireblast',
    category: 'scroll',
    name: '火焰爆裂卷轴',
    glyph: '?',
    color: '#e0763a',
    description: '引燃视野内所有敌人，造成 8-14 点火焰伤害。',
    effect: 'fireblast',
    heal: [8, 14],
  },
  dagger: {
    catalogId: 'dagger',
    category: 'weapon',
    name: '匕首',
    glyph: '/',
    color: '#a9b8c6',
    description: '轻巧的匕首，攻击 +1。',
    bonus: 1,
  },
  short_sword: {
    catalogId: 'short_sword',
    category: 'weapon',
    name: '短剑',
    glyph: '/',
    color: '#d8e1ea',
    description: '冒险者的可靠伙伴，攻击 +3。',
    bonus: 3,
  },
  war_axe: {
    catalogId: 'war_axe',
    category: 'weapon',
    name: '战斧',
    glyph: '/',
    color: '#c96a45',
    description: '沉重的双手战斧，攻击 +5。',
    bonus: 5,
  },
  leather_armor: {
    catalogId: 'leather_armor',
    category: 'armor',
    name: '皮甲',
    glyph: '[',
    color: '#a2703f',
    description: '硬化的皮革护身，防御 +1。',
    bonus: 1,
  },
  chain_mail: {
    catalogId: 'chain_mail',
    category: 'armor',
    name: '锁子甲',
    glyph: '[',
    color: '#9fb2c4',
    description: '环环相扣的铁环，防御 +2。',
    bonus: 2,
  },
  plate_armor: {
    catalogId: 'plate_armor',
    category: 'armor',
    name: '板甲',
    glyph: '[',
    color: '#e6ecf4',
    description: '深渊中罕见的整套重甲，防御 +4。',
    bonus: 4,
  },
};

// 定义对象冻结为只读，防止运行期意外篡改
for (const def of Object.values(ITEMS)) {
  Object.freeze(def);
}

/** 由目录定义创建一件背包实例，uid 由全局分配器保证唯一 */
export function createItem(catalogId: string): ItemInstance {
  const def = ITEMS[catalogId];
  if (!def) throw new Error(`物品目录中不存在: "${catalogId}"`);
  return { uid: allocateItemUid(), catalogId, category: def.category };
}

/** 反查实例的目录定义；catalogId 不在目录中时抛错 */
export function itemDef(inst: ItemInstance): ItemDef {
  const def = ITEMS[inst.catalogId];
  if (!def) throw new Error(`物品实例引用了不存在的目录项: "${inst.catalogId}"`);
  return def;
}

/** 实例的中文名 */
export function itemName(inst: ItemInstance): string {
  return itemDef(inst).name;
}

/** 武器攻击加成；非武器返回 0 */
export function weaponBonus(inst: ItemInstance): number {
  const def = itemDef(inst);
  return def.category === 'weapon' ? (def.bonus ?? 0) : 0;
}

/** 护甲防御加成；非护甲返回 0 */
export function armorBonus(inst: ItemInstance): number {
  const def = itemDef(inst);
  return def.category === 'armor' ? (def.bonus ?? 0) : 0;
}

/** 单件物品的掉落权重模型：weight = base + (growth - decay) × (depth - minDepth)，下限 0 */
interface LootWeight {
  /** 基础权重 */
  base: number;
  /** 最浅出现层数（更浅时权重为 0，即深度门控） */
  minDepth: number;
  /** 每加深一层增加的权重（高级战利品越深越常见） */
  growth: number;
  /** 每加深一层衰减的权重（入门装备随深度淘汰） */
  decay: number;
}

/**
 * 掉落权重表：depth 越大，武器/护甲/高级药水权重越高。
 * war_axe 与 plate_armor 从第 3 层才出现；匕首/皮甲在深层自然淘汰；
 * greater_healing 全深度可用但每层增值，深层占比约 9%（浅层约 3.6%）。
 */
const LOOT_WEIGHTS: Record<string, LootWeight> = {
  minor_healing: { base: 10, minDepth: 1, growth: 0, decay: 0 },
  healing: { base: 3, minDepth: 1, growth: 1, decay: 0 },
  greater_healing: { base: 1, minDepth: 1, growth: 1, decay: 0 },
  might: { base: 2, minDepth: 1, growth: 1, decay: 0 },
  teleport: { base: 2, minDepth: 1, growth: 1, decay: 0 },
  fireblast: { base: 1, minDepth: 1, growth: 1, decay: 0 },
  dagger: { base: 5, minDepth: 1, growth: 0, decay: 2 },
  short_sword: { base: 3, minDepth: 2, growth: 1, decay: 0 },
  war_axe: { base: 1, minDepth: 3, growth: 1, decay: 0 },
  leather_armor: { base: 4, minDepth: 1, growth: 0, decay: 1 },
  chain_mail: { base: 2, minDepth: 2, growth: 1, decay: 0 },
  plate_armor: { base: 1, minDepth: 3, growth: 1, decay: 0 },
};

/** 计算某件物品在给定深度的最终权重 */
function lootWeightAt(entry: LootWeight, depth: number): number {
  if (depth < entry.minDepth) return 0;
  const delta = depth - entry.minDepth;
  return Math.max(0, entry.base + (entry.growth - entry.decay) * delta);
}

/** 按深度加权抽取一件掉落物；仅消耗 rng 的确定性整数掷，同 rng 状态完全可复现 */
export function rollLoot(depth: number, rng: Rng): ItemInstance {
  const d = Number.isFinite(depth) ? Math.max(1, Math.floor(depth)) : 1;
  // 组装当前深度的加权掉落池（权重为 0 的条目被门控剔除）
  const pool: Array<{ id: string; weight: number }> = [];
  let total = 0;
  for (const [id, w] of Object.entries(LOOT_WEIGHTS)) {
    const weight = lootWeightAt(w, d);
    if (weight > 0) {
      pool.push({ id, weight });
      total += weight;
    }
  }
  if (pool.length === 0 || total <= 0) {
    throw new Error(`rollLoot: 深度 ${depth} 的掉落池为空`);
  }
  // 累积权重游走：整点掷数保证可复现
  let roll = rng.int(1, total);
  for (const entry of pool) {
    roll -= entry.weight;
    if (roll <= 0) return createItem(entry.id);
  }
  throw new Error('rollLoot: 加权抽取越界（不应发生）');
}
