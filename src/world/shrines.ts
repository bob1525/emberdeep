/**
 * 楼层事件系统 — 献祭祭坛（resolveAltar）与许愿井（resolveWell）的纯结算逻辑。
 * 地图摆放与交互 UI 由集成层完成；本模块只掷 Rng、产出结算报告，
 * 由集成层按报告扣血 / 扣金币 / 施加状态 / 回满血 / 生成怪物与输出日志。
 * 概率档位用一次 [1, 100] 整掷切分（祭坛 60/25/15、许愿井 40/30/20/10），
 * 其余抽取全走 Rng 的确定性整数掷，同 rng 状态完全可复现。
 */
import { RANGED } from '../engine/ranged';
import type { Rng } from '../engine/rng';
import type { StatusKind } from '../engine/statuses';
import { ITEMS } from '../items/catalog';

export type ShrineKind = 'altar' | 'well';

export interface ShrineDef {
  kind: ShrineKind;
  /** 中文名：献祭祭坛 / 许愿井 */
  name: string;
  /** 地面显示字符（Ω 祭坛 / U 井口），与怪物字母、物品符号、楼梯、墙体错开 */
  glyph: string;
  /** 地面显示色 */
  color: string;
}

/**
 * 楼层设施目录：kind → 定义。
 */
export const SHRINES: Record<ShrineKind, ShrineDef> = {
  altar: { kind: 'altar', name: '献祭祭坛', glyph: 'Ω', color: '#d43d2e' },
  well: { kind: 'well', name: '许愿井', glyph: 'U', color: '#4fc3f7' },
};

// 定义对象冻结为只读，防止运行期意外篡改（与物品/陷阱目录保持一致）
for (const def of Object.values(SHRINES)) {
  Object.freeze(def);
}

/**
 * 祭坛祝福的种类 = StatusKind ∪ 'might'。
 * 'might'（力量祝福：临时攻击加成）不是引擎的持续状态，而是游戏层的计时器机制
 * （GameState.mightUntil + MIGHT_ATTACK_BONUS，见 src/game.ts）——契约中的 might 祝福由此落地。
 * 集成层需对 blessing.kind === 'might' 单独结算（设置 mightUntil），其余种类走 applyStatus。
 */
export type ShrineBlessingKind = StatusKind | 'might';

export interface AltarReport {
  /** 献祭的生命代价（由集成层扣血），= ceil(maxHp * 0.3) */
  cost: number;
  /** 60%：随机祝福（might 30回合3 / shield 25回合2 / regeneration 12回合1 三选一），未命中为 null */
  blessing: { kind: ShrineBlessingKind; turns: number; power: number } | null;
  /** 25%：诅咒（poison 8回合2 / slow 10回合0 二选一），未命中为 null */
  curse: { kind: StatusKind; turns: number; power: number } | null;
  /** 15%：深渊感念你的勇气，直接回满血（heal = maxHp，代价照扣） */
  fullHeal: boolean;
  /** 中文事件文本（由集成层转交日志系统） */
  message: string;
}

/** 祝福池条目：效果载荷 + 结果文案（不含献祭代价前缀） */
interface BlessingRoll {
  kind: ShrineBlessingKind;
  turns: number;
  power: number;
  text: string;
}

/** 诅咒池条目：kind 恒为 StatusKind（诅咒不借用 might 机制） */
interface CurseRoll {
  kind: StatusKind;
  turns: number;
  power: number;
  text: string;
}

/** 祝福池（60% 档三选一）：might 30 回合 3 / shield 25 回合 2 / regeneration 12 回合 1 */
const BLESSINGS: readonly BlessingRoll[] = [
  { kind: 'might', turns: 30, power: 3, text: '战纹骤然炽亮，力量涌遍你的全身（攻击 +3，持续 30 回合）。' },
  { kind: 'shield', turns: 25, power: 2, text: '一层灰白屏障自碑面升起，将你包裹其中（护盾，持续 25 回合）。' },
  { kind: 'regeneration', turns: 12, power: 1, text: '献祭之火温顺地舔舐你的伤口，血肉飞快愈合（再生，持续 12 回合）。' },
];

/** 诅咒池（25% 档二选一）：poison 8 回合 2 / slow 10 回合 0 */
const CURSES: readonly CurseRoll[] = [
  { kind: 'poison', turns: 8, power: 2, text: '碑纹扭曲成毒绿的雾纹，反噬的毒素缠上你的血液（中毒，持续 8 回合）。' },
  { kind: 'slow', turns: 10, power: 0, text: '深渊的凝视自碑面射出，你的四肢骤然沉重如铅（减速，持续 10 回合）。' },
];

/**
 * 纯结算：献祭祭坛。付出 30% 生命上限，赌一个结果 —— 60% 祝福 / 25% 诅咒 / 15% 回满血，
 * 三档互斥， blessing / curse / fullHeal 至少一个命中。
 * 不扣血、不施加状态、不写日志（message 只是文本，由游戏层转交）。
 * 消耗 1 次 [1,100] 整掷定档，命中祝福/诅咒时再各消耗 1 次 pick 掷种类。
 */
export function resolveAltar(maxHp: number, rng: Rng): AltarReport {
  // 防御式：非有限值 / 负数归 0，代价恒为 ceil(maxHp * 0.3)
  const safeMaxHp = Number.isFinite(maxHp) ? Math.max(0, maxHp) : 0;
  const cost = Math.ceil(safeMaxHp * 0.3);
  const prefix = `你割掌献上 ${cost} 点生命，黑曜石碑面幽幽亮起。`;

  // 三档结果用一次 [1,100] 整掷切分：1-60 祝福 / 61-85 诅咒 / 86-100 回满血
  const roll = rng.int(1, 100);
  if (roll <= 60) {
    const picked = rng.pick(BLESSINGS);
    return {
      cost,
      blessing: { kind: picked.kind, turns: picked.turns, power: picked.power },
      curse: null,
      fullHeal: false,
      message: prefix + picked.text,
    };
  }
  if (roll <= 85) {
    const picked = rng.pick(CURSES);
    return {
      cost,
      blessing: null,
      curse: { kind: picked.kind, turns: picked.turns, power: picked.power },
      fullHeal: false,
      message: prefix + picked.text,
    };
  }
  return {
    cost,
    blessing: null,
    curse: null,
    fullHeal: true,
    message: `${prefix}深渊感念你的勇气，暗红符火倒卷而入——浑身的伤势尽数愈合。`,
  };
}

export interface WellReport {
  /** 投币价，恒 25（由集成层扣金币） */
  goldCost: number;
  /** 40%：治愈 —— 回复全部生命（heal 语义：由集成层按当前血量折算） */
  heal: boolean;
  /** 30%：井底捞出一件随机物品（id 与类别），未命中为 null */
  item: { catalogId: string; category: 'potion' | 'scroll' | 'weapon' | 'armor' | 'ranged' } | null;
  /** 20%：什么都没发生 */
  nothing: boolean;
  /** 10%：惹怒深渊 —— 集成层在玩家附近生成 1-2 只怪物 */
  angered: boolean;
  /** 中文事件文本（由集成层转交日志系统） */
  message: string;
}

/** 许愿井物品池条目的类别别名（与 WellReport['item']['category'] 一致） */
type WellCategory = NonNullable<WellReport['item']>['category'];

/** 许愿井捞物池条目 */
interface WellPoolEntry {
  catalogId: string;
  category: WellCategory;
  /** 抽取权重 */
  weight: number;
}

/**
 * 许愿井捞物池：以深度 3 为基准的加权分布 —— 药水/卷轴为主（23/35 ≈ 66%），装备与远程偶尔出现。
 * 消耗品权重与物品目录 LOOT_WEIGHTS 在深度 3 的分布同向（入门装备已衰减、深层装备刚解锁）。
 */
const WELL_POOL: readonly WellPoolEntry[] = [
  { catalogId: 'minor_healing', category: 'potion', weight: 10 },
  { catalogId: 'healing', category: 'potion', weight: 5 },
  { catalogId: 'might', category: 'potion', weight: 3 },
  { catalogId: 'teleport', category: 'scroll', weight: 3 },
  { catalogId: 'fireblast', category: 'scroll', weight: 2 },
  { catalogId: 'dagger', category: 'weapon', weight: 1 },
  { catalogId: 'short_sword', category: 'weapon', weight: 2 },
  { catalogId: 'war_axe', category: 'weapon', weight: 1 },
  { catalogId: 'leather_armor', category: 'armor', weight: 1 },
  { catalogId: 'chain_mail', category: 'armor', weight: 1 },
  { catalogId: 'plate_armor', category: 'armor', weight: 1 },
  { catalogId: 'short_bow', category: 'ranged', weight: 1 },
  { catalogId: 'throwing_knife', category: 'ranged', weight: 2 },
  { catalogId: 'long_bow', category: 'ranged', weight: 1 },
];

/** 池总权重（累积权重游走的掷数上限） */
const WELL_POOL_TOTAL = WELL_POOL.reduce((sum, entry) => sum + entry.weight, 0);

// 载入即校验池完整性：id 必须存在于对应目录且类别一致（拼错立刻在测试期暴露，而不是赌运行期抽到）
for (const entry of WELL_POOL) {
  if (entry.category === 'ranged') {
    if (!RANGED[entry.catalogId]) throw new Error(`WELL_POOL: "${entry.catalogId}" 不在远程目录中`);
  } else {
    const def = ITEMS[entry.catalogId];
    if (!def) throw new Error(`WELL_POOL: "${entry.catalogId}" 不在物品目录中`);
    if (def.category !== entry.category) {
      throw new Error(`WELL_POOL: "${entry.catalogId}" 的目录类别 ${def.category} 与声明的 ${entry.category} 不符`);
    }
  }
}

/** 许愿井的固定投币价 */
const WELL_GOLD_COST = 25;

/** 按权重从井池抽出一件物品；整点掷数保证同 rng 状态完全可复现 */
function rollWellItem(rng: Rng): NonNullable<WellReport['item']> {
  let roll = rng.int(1, WELL_POOL_TOTAL);
  for (const entry of WELL_POOL) {
    roll -= entry.weight;
    if (roll <= 0) return { catalogId: entry.catalogId, category: entry.category };
  }
  throw new Error('rollWellItem: 加权抽取越界（不应发生）');
}

/** 目录中文名（供事件文案引用）；查不到时回退 catalogId，不抛错 */
function wellItemName(catalogId: string, category: WellCategory): string {
  const def = category === 'ranged' ? RANGED[catalogId] : ITEMS[catalogId];
  return def?.name ?? catalogId;
}

/**
 * 纯结算：许愿井。投 25 金币赌运气 —— 40% 治愈 / 30% 捞物 / 20% 无事 / 10% 惹怒深渊，
 * 四档互斥恰好命中其一。不扣金币、不回血、不生成怪物、不写日志，全部由集成层按报告执行。
 * 消耗 1 次 [1,100] 整掷定档，命中捞物档时再消耗 1 次整掷抽物品。
 */
export function resolveWell(rng: Rng): WellReport {
  // 四档结果用一次 [1,100] 整掷切分：1-40 治愈 / 41-70 捞物 / 71-90 无事 / 91-100 惹怒深渊
  const roll = rng.int(1, 100);
  if (roll <= 40) {
    return {
      goldCost: WELL_GOLD_COST,
      heal: true,
      item: null,
      nothing: false,
      angered: false,
      message: '井水泛起温暖的金色微光，你捧起饮下，浑身的伤势尽愈。',
    };
  }
  if (roll <= 70) {
    const item = rollWellItem(rng);
    return {
      goldCost: WELL_GOLD_COST,
      heal: false,
      item,
      nothing: false,
      angered: false,
      message: `井底深处传来轻响——你从水中捞上了一件「${wellItemName(item.catalogId, item.category)}」。`,
    };
  }
  if (roll <= 90) {
    return {
      goldCost: WELL_GOLD_COST,
      heal: false,
      item: null,
      nothing: true,
      angered: false,
      message: '金币沉入井底，水面泛起一圈涟漪又归于沉寂——什么也没有发生。',
    };
  }
  return {
    goldCost: WELL_GOLD_COST,
    heal: false,
    item: null,
    nothing: false,
    angered: true,
    message: '井水骤然沸腾翻涌，深渊的怒意自井底冲出——有什么东西被惊醒了！',
  };
}
