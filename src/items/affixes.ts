/**
 * 装备词缀与稀有度系统 — 纯数据 + 数值合成。
 * 只负责"掷出什么稀有度与词缀、加成合计、如何显示"；
 * 词缀落到装备实例与属性结算由游戏层对接。
 * 全部随机走 Rng 的确定性整数掷，同一种子完全可复现。
 */
import type { Rng } from '../engine/rng';

/** 装备稀有度档位：普通 → 魔力 → 稀有 → 史诗 */
export type Rarity = 'common' | 'magic' | 'rare' | 'epic';

/** 稀有度静态信息 */
export interface RarityInfo {
  /** 中文名：普通 / 魔力 / 稀有 / 史诗 */
  name: string;
  /** 装备名显示色（#rrggbb） */
  color: string;
  /** 该稀有度附带的词缀数量 */
  affixCount: number;
}

/**
 * 稀有度表：affixCount 随档位 0→3 严格递增。
 * 颜色为 UI 显示约定（装备名按稀有度着色）。
 */
export const RARITIES: Record<Rarity, RarityInfo> = {
  common: { name: '普通', color: '#c0c8d4', affixCount: 0 },
  magic: { name: '魔力', color: '#6fb3e0', affixCount: 1 },
  rare: { name: '稀有', color: '#c9a227', affixCount: 2 },
  epic: { name: '史诗', color: '#c678dd', affixCount: 3 },
};

/** 单条词缀定义：至少携带 attack/defense/maxHp 之一 */
export interface AffixDef {
  id: string;
  /** 前缀中文名（以"的"结尾，展示时直接拼在装备原名前） */
  name: string;
  /** 攻击加成 */
  attack?: number;
  /** 防御加成 */
  defense?: number;
  /** 生命上限加成 */
  maxHp?: number;
}

/**
 * 词缀目录：数值区间 +1~+3，attack/defense/maxHp 各 3 档梯度；
 * "轻盈的"为攻击+生命的混合词缀，让稀有/史诗的组合更有花样。
 */
export const AFFIXES: readonly AffixDef[] = [
  { id: 'sharp', name: '锋利的', attack: 1 },
  { id: 'brutal', name: '残暴的', attack: 2 },
  { id: 'burning', name: '燃烧的', attack: 3 },
  { id: 'sturdy', name: '坚固的', defense: 1 },
  { id: 'heavy', name: '厚重的', defense: 2 },
  { id: 'ornate', name: '精铸的', defense: 3 },
  { id: 'tough', name: '强韧的', maxHp: 1 },
  { id: 'vital', name: '生命的', maxHp: 2 },
  { id: 'boiling', name: '沸血的', maxHp: 3 },
  { id: 'agile', name: '轻盈的', attack: 1, maxHp: 1 },
];

// 数据定义冻结为只读，防止运行期意外篡改（与 catalog.ts 同风格）
for (const info of Object.values(RARITIES)) {
  Object.freeze(info);
}
for (const def of AFFIXES) {
  Object.freeze(def);
}

/** id → 词缀定义的查询索引 */
const AFFIX_INDEX: Record<string, AffixDef> = {};
for (const def of AFFIXES) {
  AFFIX_INDEX[def.id] = def;
}

/** 一件装备的词缀数据：稀有度 + 词缀 id 列表（列表顺序即展示拼接顺序） */
export interface AffixData {
  rarity: Rarity;
  affixIds: string[];
}

/** 稀有度权重模型：weight(depth) = max(floor, base + (growth − decay) × (depth − 1)) */
interface RarityWeight {
  /** depth 1 的基础权重 */
  base: number;
  /** 每加深一层增加的权重（高阶稀有度越深越常见） */
  growth: number;
  /** 每加深一层衰减的权重（普通装备随深度淘汰） */
  decay: number;
  /** 权重下限，防止深层彻底绝迹 */
  floor: number;
}

/**
 * 稀有度权重表（平衡用常量，调平衡只改这里）：
 * depth 1：普通 100 / 魔力 35 / 稀有 12 / 史诗 2 —— 普通约 67%，史诗约 1.3%；
 * depth 8：普通 16 / 魔力 42 / 稀有 26 / 史诗 23 —— 史诗约 21%，开始可见；
 * depth 10：普通 8 / 魔力 44 / 稀有 30 / 史诗 29 —— 稀有+史诗约 53%。
 */
const RARITY_WEIGHTS: Record<Rarity, RarityWeight> = {
  common: { base: 100, growth: 0, decay: 12, floor: 8 },
  magic: { base: 35, growth: 1, decay: 0, floor: 0 },
  rare: { base: 12, growth: 2, decay: 0, floor: 0 },
  epic: { base: 2, growth: 3, decay: 0, floor: 0 },
};

/** 加权抽取的固定遍历顺序（显式声明，保证确定性不依赖键序） */
const RARITY_ORDER: readonly Rarity[] = ['common', 'magic', 'rare', 'epic'];

/** 计算某稀有度在给定深度的权重 */
function rarityWeightAt(entry: RarityWeight, depth: number): number {
  const delta = depth - 1;
  return Math.max(entry.floor, entry.base + (entry.growth - entry.decay) * delta);
}

/** 按深度加权掷稀有度；只消耗一次 rng 整数掷 */
function rollRarity(depth: number, rng: Rng): Rarity {
  let total = 0;
  for (const rarity of RARITY_ORDER) {
    total += rarityWeightAt(RARITY_WEIGHTS[rarity], depth);
  }
  // 累积权重游走：整点掷数保证可复现（与 rollLoot 同思路）
  let roll = rng.int(1, total);
  for (const rarity of RARITY_ORDER) {
    roll -= rarityWeightAt(RARITY_WEIGHTS[rarity], depth);
    if (roll <= 0) return rarity;
  }
  throw new Error('rollRarity: 加权抽取越界（不应发生）');
}

/**
 * 按深度掷装备稀有度与词缀。
 * 先加权掷稀有度（权重随深度上移：浅层大概率普通，深层稀有/史诗渐多），
 * 再按该稀有度的 affixCount 从词缀目录无放回抽取，保证 id 不重复；
 * common 无词缀，直接返回空列表。
 */
export function rollAffixData(depth: number, rng: Rng): AffixData {
  const d = Number.isFinite(depth) ? Math.max(1, Math.floor(depth)) : 1;
  const rarity = rollRarity(d, rng);
  const count = RARITIES[rarity].affixCount;
  if (count === 0) return { rarity, affixIds: [] };
  // 无放回抽取：从目录副本中逐个移除已选项
  const remaining: AffixDef[] = [...AFFIXES];
  const affixIds: string[] = [];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const chosen = rng.pick(remaining);
    affixIds.push(chosen.id);
    remaining.splice(remaining.indexOf(chosen), 1);
  }
  return { rarity, affixIds };
}

/** 反查词缀定义；id 不在目录中时抛错（与 itemDef 风格一致） */
function affixById(id: string): AffixDef {
  const def = AFFIX_INDEX[id];
  if (!def) throw new Error(`词缀目录中不存在: "${id}"`);
  return def;
}

/** 词缀数值合计（null = 无词缀装备，全 0） */
export function bonusOf(data: AffixData | null): { attack: number; defense: number; maxHp: number } {
  const totals = { attack: 0, defense: 0, maxHp: 0 };
  if (!data) return totals;
  for (const id of data.affixIds) {
    const def = affixById(id);
    totals.attack += def.attack ?? 0;
    totals.defense += def.defense ?? 0;
    totals.maxHp += def.maxHp ?? 0;
  }
  return totals;
}

/** 展示名："燃烧的短剑"；common / 无词缀时返回原名 */
export function displayName(baseName: string, data: AffixData | null): string {
  if (!data || data.affixIds.length === 0) return baseName;
  const prefixes = data.affixIds.map((id) => affixById(id).name).join('');
  return prefixes + baseName;
}

/** 稀有度显示色；null 视为 common */
export function rarityColor(data: AffixData | null): string {
  const rarity: Rarity = data ? data.rarity : 'common';
  return RARITIES[rarity].color;
}
