/**
 * 怪物图鉴 — 各物种的静态模板、按深度的出现表与随机抽取。
 * 纯数据 + 抽取逻辑；实例化（makeActor）与 AI 行为由游戏层完成。
 */
import type { Rng } from '../engine/rng';

/** 怪物物种的静态模板 */
export interface MonsterTemplate {
  species: string;
  /** 中文名 */
  name: string;
  glyph: string;
  color: string;
  maxHp: number;
  attack: number;
  defense: number;
  /** 击杀所得经验 */
  xpValue: number;
  /** 感知到玩家的半径 */
  senseRadius: number;
}

/**
 * 怪物图鉴：species → 模板。
 * 数值设计（以玩家 30HP / 攻击 4 / 防御 1 为基准）：
 * - 同层物种有定位梯度：鼠人皮厚迟钝，巨蝠脆弱敏捷、感知更远；
 * - 第 1 层压制：鼠人攻 1 血 6 / 巨蝠攻 2 血 4——模拟数据显示玩家在自动探索批次内
 *   只能被动承伤，低层小额消耗伤害与战斗时长是早期死亡率的主导项
 *   （500-seed 数据见 work/sim-analysis-round2.md）；
 * - 深层物种的生命/攻击/防御/经验/感知全面不低于浅层物种；
 * - 余烬幽魂是第 5 层精英：攻高防厚感知远，经验值显著高于食人魔；
 * - 深渊蛛（第 4 层）是玻璃炮弹型：攻击与食人魔持平（7）但血量只有其七成、
 *   感知 10 追平第 5 层精英——先手咬人、被摸就碎，逼玩家抢先进攻；
 *   受"深层全面 ≥ 浅层"不变式约束，其血量下限被兽人（16）托底，
 *   故"低血"是相对同层食人魔（26）而言；攻击上限被熔壳蟹（第 5 层入场、
 *   攻击须低于余烬幽魂的 8）间接压到 7；
 * - 熔壳蟹（第 5 层）是坦位型：防御 4 全图鉴最高、血 27 厚，
 *   但攻击 7 / 血 27 均低于余烬幽魂（8/28）——与精英错位成"磨血壳"，
 *   代价是它的经验也低于幽魂；攻击 7 的下限同样来自"必须全面 ≥ 食人魔/深渊蛛"。
 */
export const MONSTERS: Record<string, MonsterTemplate> = {
  rat: {
    species: 'rat',
    name: '鼠人',
    glyph: 'r',
    color: '#b0a080',
    maxHp: 6,
    attack: 1,
    defense: 0,
    xpValue: 3,
    senseRadius: 5,
  },
  bat: {
    species: 'bat',
    name: '巨蝠',
    glyph: 'B',
    color: '#8f7fb8',
    maxHp: 4,
    attack: 2,
    defense: 0,
    xpValue: 4,
    senseRadius: 7,
  },
  skeleton: {
    species: 'skeleton',
    name: '骷髅兵',
    glyph: 's',
    color: '#dcd6c8',
    maxHp: 12,
    attack: 4,
    defense: 1,
    xpValue: 8,
    senseRadius: 7,
  },
  orc: {
    species: 'orc',
    name: '兽人',
    glyph: 'o',
    color: '#5e9e52',
    maxHp: 16,
    attack: 5,
    defense: 1,
    xpValue: 14,
    senseRadius: 8,
  },
  ogre: {
    species: 'ogre',
    name: '食人魔',
    glyph: 'O',
    color: '#c2703e',
    maxHp: 26,
    attack: 7,
    defense: 2,
    xpValue: 22,
    senseRadius: 8,
  },
  // 玻璃炮弹型（第 4 层入场）：攻击追平食人魔、血量只有其七成（18 vs 26）、
  // 防御垫底，换来全图鉴最远的感知（10，与第 5 层精英持平）——
  // 在玩家看见它之前它已锁定玩家，落单被偷袭时一轮近半血；
  // 但皮脆攻不破甲，抱团推进时是经验包。经验 18 介于兽人（14）与食人魔（22）之间。
  abyss_spider: {
    species: 'abyss_spider',
    name: '深渊蛛',
    glyph: 'S',
    color: '#a45ad6',
    maxHp: 18,
    attack: 7,
    defense: 1,
    xpValue: 18,
    senseRadius: 10,
  },
  ember_wraith: {
    species: 'ember_wraith',
    name: '余烬幽魂',
    glyph: 'W',
    color: '#ff8c3a',
    maxHp: 28,
    attack: 8,
    defense: 3,
    xpValue: 35,
    senseRadius: 10,
  },
  // 坦位型（第 5 层入场）：防御 4 全图鉴最高、血 27 仅次于余烬幽魂，
  // 与幽魂错位成"磨血壳"——攻击 7 / 血 27 都低于幽魂（8/28），威胁靠拖回合而非爆发；
  // 防 4 让攻击 ≤6 的前期输出完全挠不动，逼玩家靠升级装备或技能破壳。
  // "低攻"的下限受"深层全面 ≥ 浅层"不变式约束：必须追平食人魔/深渊蛛的 7。
  // 经验 26 介于食人魔（22）与余烬幽魂（35）之间。
  magma_crab: {
    species: 'magma_crab',
    name: '熔壳蟹',
    glyph: 'C',
    color: '#d4622a',
    maxHp: 27,
    attack: 7,
    defense: 4,
    xpValue: 26,
    senseRadius: 10,
  },
};

// 模板对象冻结为只读；实例化时由游戏层展开为新对象
for (const tpl of Object.values(MONSTERS)) {
  Object.freeze(tpl);
}

/** 按解锁顺序（即强度顺序，同层新物种按经验值插序）排列的出现表；下标 i 即第 i+1 层，深层是浅层的超集 */
const DEPTH_TABLES: readonly (readonly string[])[] = [
  ['rat', 'bat'],
  ['rat', 'bat', 'skeleton'],
  ['rat', 'bat', 'skeleton', 'orc'],
  ['rat', 'bat', 'skeleton', 'orc', 'abyss_spider', 'ogre'],
  ['rat', 'bat', 'skeleton', 'orc', 'abyss_spider', 'ogre', 'magma_crab', 'ember_wraith'],
];

/** 把任意深度收敛到 [1, 最大层数] 区间 */
function clampDepth(depth: number): number {
  if (!Number.isFinite(depth)) return 1;
  return Math.min(DEPTH_TABLES.length, Math.max(1, Math.floor(depth)));
}

/** 该深度可能出现的物种 id 列表（随深度单调变强：只增不减，每次调用返回独立副本） */
export function monsterTable(depth: number): string[] {
  const table = DEPTH_TABLES[clampDepth(depth) - 1] ?? DEPTH_TABLES[0];
  if (!table) throw new Error('monsterTable: 出现表为空（不应发生）');
  return [...table];
}

/** 按深度等权抽取一只怪物的模板 */
export function rollMonster(depth: number, rng: Rng): MonsterTemplate {
  const speciesId = rng.pick(monsterTable(depth));
  const template = MONSTERS[speciesId];
  if (!template) throw new Error(`rollMonster: 出现表引用了未知物种 "${speciesId}"`);
  return template;
}
