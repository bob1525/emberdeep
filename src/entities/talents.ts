/**
 * 升级三选一天赋系统 — 纯数据 + 概率抽取 + 数值合成。
 * 只负责"掷出哪些候选天赋、已拥有天赋的加成合计"；
 * 升级界面与加成落到角色属性由集成层对接。
 * 全部随机走 Rng 的确定性整数掷，同一种子完全可复现。
 */
import type { Rng } from '../engine/rng';

/** 天赋加成集合：未声明的字段视为不提供该加成（合计时按 0 计） */
export interface TalentMods {
  /** 每层攻击加成 */
  attack?: number;
  /** 每层防御加成 */
  defense?: number;
  /** 每层生命上限加成（允许负数，如狂战士以血换力） */
  maxHp?: number;
  /** 暴击率加成（0-1 小数），基础暴击率 10% 由游戏层定 */
  critChance?: number;
  /** 吸血比例（0-1 小数）：造成伤害的 N% 回血 */
  lifesteal?: number;
  /** 金币获取加成（0-1） */
  goldBonus?: number;
  /** 经验获取加成（0-1） */
  xpBonus?: number;
  /** 每 5 回合回复的生命 */
  regen?: number;
}

/** 天赋稀有度档位：普通 → 稀有 → 史诗 */
export type TalentRarity = 'common' | 'rare' | 'epic';

/** 单条天赋定义 */
export interface TalentDef {
  id: string;
  /** 中文名，如 铁胃 / 蛮力 / 鹰眼 / 蝙蝠之吻 */
  name: string;
  /** 一句话效果描述（带负数代价的天赋必须在此说明） */
  description: string;
  rarity: TalentRarity;
  /** 最多可拥有几层（同 id 重复选取上限） */
  maxStacks: number;
  /** 每层提供的加成 */
  mods: TalentMods;
}

/**
 * 天赋目录：13 条，覆盖全部 8 种加成，三档稀有度齐备。
 * 数值设计（梯度）：
 * - common：单加成小数值，可叠 2-3 层，是前期养成主力；
 * - rare：单加成大数值或双加成混合，叠 2-3 层封顶；
 * - epic：强力混合加成或带代价的极端收益，仅 1 层。
 * 狂战士的 maxHp 为负数：负加成是合法数据，展示层靠 description 说明代价。
 */
export const TALENTS: readonly TalentDef[] = [
  // ---- common：单加成小数值，堆层数 ----
  { id: 'iron_stomach', name: '铁胃', description: '生命上限 +6。', rarity: 'common', maxStacks: 3, mods: { maxHp: 6 } },
  { id: 'brute_force', name: '蛮力', description: '攻击 +2。', rarity: 'common', maxStacks: 3, mods: { attack: 2 } },
  { id: 'stone_skin', name: '石肤', description: '防御 +1。', rarity: 'common', maxStacks: 3, mods: { defense: 1 } },
  { id: 'gold_greed', name: '财迷', description: '金币获取 +30%。', rarity: 'common', maxStacks: 2, mods: { goldBonus: 0.3 } },
  { id: 'apprentice', name: '学徒', description: '经验获取 +25%。', rarity: 'common', maxStacks: 2, mods: { xpBonus: 0.25 } },
  { id: 'vitality', name: '活力', description: '每 5 回合回复 1 点生命。', rarity: 'common', maxStacks: 3, mods: { regen: 1 } },
  // ---- rare：大数值单加成或混合加成 ----
  { id: 'eagle_eye', name: '鹰眼', description: '暴击率 +8%。', rarity: 'rare', maxStacks: 3, mods: { critChance: 0.08 } },
  { id: 'bat_kiss', name: '蝙蝠之吻', description: '吸血：造成伤害的 15% 转化为生命回复。', rarity: 'rare', maxStacks: 2, mods: { lifesteal: 0.15 } },
  { id: 'tenacity', name: '顽强', description: '生命上限 +12。', rarity: 'rare', maxStacks: 2, mods: { maxHp: 12 } },
  { id: 'precision', name: '精准', description: '攻击 +1，暴击率 +5%。', rarity: 'rare', maxStacks: 2, mods: { attack: 1, critChance: 0.05 } },
  // ---- epic：强力混合收益或带代价的极端收益，仅 1 层 ----
  { id: 'berserker', name: '狂战士', description: '攻击 +4，但生命上限 -8：以血换力。', rarity: 'epic', maxStacks: 1, mods: { attack: 4, maxHp: -8 } },
  { id: 'midas_hands', name: '黄金之手', description: '金币获取 +80%，经验获取 +30%。', rarity: 'epic', maxStacks: 1, mods: { goldBonus: 0.8, xpBonus: 0.3 } },
  { id: 'reapers_touch', name: '死神之触', description: '强力吸血：造成伤害的 35% 转化为生命回复。', rarity: 'epic', maxStacks: 1, mods: { lifesteal: 0.35 } },
];

// 数据定义冻结为只读，防止运行期意外篡改（与 affixes.ts 同风格）
for (const def of TALENTS) {
  Object.freeze(def.mods);
  Object.freeze(def);
}

/** id → 天赋定义的查询索引 */
const TALENT_INDEX: Record<string, TalentDef> = {};
for (const def of TALENTS) {
  TALENT_INDEX[def.id] = def;
}

/** 反查天赋定义；id 不在目录中时抛错（与 affixes 风格一致） */
function talentById(id: string): TalentDef {
  const def = TALENT_INDEX[id];
  if (!def) throw new Error(`天赋目录中不存在: "${id}"`);
  return def;
}

/**
 * 已拥有天赋列表（含重复层）→ 全部加成合计。
 * 同一 id 出现几次就累加几层；未知 id 抛错（游戏层不应出现目录外的天赋）。
 */
export function talentBonus(owned: readonly string[]): Required<TalentMods> {
  const totals: Required<TalentMods> = {
    attack: 0,
    defense: 0,
    maxHp: 0,
    critChance: 0,
    lifesteal: 0,
    goldBonus: 0,
    xpBonus: 0,
    regen: 0,
  };
  for (const id of owned) {
    const { mods } = talentById(id);
    totals.attack += mods.attack ?? 0;
    totals.defense += mods.defense ?? 0;
    totals.maxHp += mods.maxHp ?? 0;
    totals.critChance += mods.critChance ?? 0;
    totals.lifesteal += mods.lifesteal ?? 0;
    totals.goldBonus += mods.goldBonus ?? 0;
    totals.xpBonus += mods.xpBonus ?? 0;
    totals.regen += mods.regen ?? 0;
  }
  return totals;
}

/** 稀有度权重模型：weight(depth) = max(floor, base + growth × (depth − 1)) */
interface RarityWeight {
  /** depth 1 的基础权重 */
  base: number;
  /** 每加深一层增加的权重（稀有/史诗天赋越深越常见） */
  growth: number;
  /** 权重下限，防止深层彻底绝迹 */
  floor: number;
}

/**
 * 稀有度权重表（平衡用常量，调平衡只改这里）：
 * depth 1：普通 100 / 稀有 14 / 史诗 2 —— 按目录条数折算后三选一含史诗约 3%；
 * depth 10：普通 8 / 稀有 32 / 史诗 29 —— 史诗按权重约占 1/3，三选一含史诗约 70%。
 */
const RARITY_WEIGHTS: Record<TalentRarity, RarityWeight> = {
  common: { base: 100, growth: 0, floor: 8 },
  rare: { base: 14, growth: 2, floor: 0 },
  epic: { base: 2, growth: 3, floor: 0 },
};

/** 计算某稀有度在给定深度的权重 */
function rarityWeightAt(entry: RarityWeight, depth: number): number {
  return Math.max(entry.floor, entry.base + entry.growth * (depth - 1));
}

/** 带权重的候选条目（抽取过程的内部结构） */
interface WeightedTalent {
  def: TalentDef;
  weight: number;
}

/** 从非空候选池按权重抽一个（消耗一次整数掷，保证可复现） */
function pickWeighted(entries: readonly WeightedTalent[], rng: Rng): WeightedTalent {
  let total = 0;
  for (const entry of entries) total += entry.weight;
  if (total <= 0) {
    // 权重表异常兜底：退化为等权抽取
    const fallback = entries[rng.int(0, entries.length - 1)];
    if (!fallback) throw new Error('pickWeighted: 候选池为空（不应发生）');
    return fallback;
  }
  // 累积权重游走：整点掷数保证可复现（与 rollRarity 同思路）
  let roll = rng.int(1, total);
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  throw new Error('pickWeighted: 加权抽取越界（不应发生）');
}

/**
 * 升级时抽 3 个候选天赋 id：
 * - 排除已满层的 id（owned 中出现次数 ≥ maxStacks）；
 * - 候选之间互不重复（加权无放回抽取）；
 * - depth 越高，稀有/史诗占比越高（稀有度权重随深度上移）；
 * - 可用候选不足 3 个时返回全部可用候选（可以少于 3，甚至为空）。
 */
export function rollTalentChoices(owned: readonly string[], depth: number, rng: Rng): string[] {
  const d = Number.isFinite(depth) ? Math.max(1, Math.floor(depth)) : 1;

  // 统计 owned 中各目录 id 的层数；不在目录中的 id 不可能命中任何天赋，自然忽略
  const stackCounts: Record<string, number> = {};
  for (const id of owned) {
    if (id in TALENT_INDEX) {
      stackCounts[id] = (stackCounts[id] ?? 0) + 1;
    }
  }

  // 可用候选：未满层的天赋，权重取其稀有度在当前深度的权重
  const pool: WeightedTalent[] = [];
  for (const def of TALENTS) {
    if ((stackCounts[def.id] ?? 0) >= def.maxStacks) continue;
    pool.push({ def, weight: rarityWeightAt(RARITY_WEIGHTS[def.rarity], d) });
  }

  // 加权无放回抽取：池子抽空即停，候选不足 3 个时自然返回全部可用候选
  const remaining = [...pool];
  const choices: string[] = [];
  while (choices.length < 3 && remaining.length > 0) {
    const chosen = pickWeighted(remaining, rng);
    choices.push(chosen.def.id);
    remaining.splice(remaining.indexOf(chosen), 1);
  }
  return choices;
}
