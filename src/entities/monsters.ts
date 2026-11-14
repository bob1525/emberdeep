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
 * - 深层物种的生命/攻击/防御/经验/感知全面不低于浅层物种；
 * - 余烬幽魂是第 5 层精英：攻高防厚感知远，经验值显著高于食人魔。
 */
export const MONSTERS: Record<string, MonsterTemplate> = {
  rat: {
    species: 'rat',
    name: '鼠人',
    glyph: 'r',
    color: '#b0a080',
    maxHp: 7,
    attack: 2,
    defense: 0,
    xpValue: 3,
    senseRadius: 5,
  },
  bat: {
    species: 'bat',
    name: '巨蝠',
    glyph: 'B',
    color: '#8f7fb8',
    maxHp: 5,
    attack: 3,
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
};

// 模板对象冻结为只读；实例化时由游戏层展开为新对象
for (const tpl of Object.values(MONSTERS)) {
  Object.freeze(tpl);
}

/** 按解锁顺序（即强度顺序）排列的出现表；下标 i 即第 i+1 层，深层是浅层的超集 */
const DEPTH_TABLES: readonly (readonly string[])[] = [
  ['rat', 'bat'],
  ['rat', 'bat', 'skeleton'],
  ['rat', 'bat', 'skeleton', 'orc'],
  ['rat', 'bat', 'skeleton', 'orc', 'ogre'],
  ['rat', 'bat', 'skeleton', 'orc', 'ogre', 'ember_wraith'],
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
