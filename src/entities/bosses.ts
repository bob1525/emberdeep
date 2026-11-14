/**
 * Boss 图鉴 — 楼层守关者的静态定义、阶段划分与阶段特技决策。
 * 纯数据 + 决策逻辑；特技的摆放（召唤落点、演出特效）与伤害落地由集成层完成。
 */
import type { Rng } from '../engine/rng';

/** Boss 特技种类 */
export type BossSpecial = 'summon' | 'aoe' | 'haste' | 'heal';

export interface BossPhase {
  /** 进入该阶段的血量上限阈值（占 maxHp 百分比，0-1，递减排列） */
  hpThreshold: number;
  /** 该阶段攻击加成（狂暴化） */
  attackBonus: number;
  /** 该阶段主特技 */
  special: BossSpecial;
}

export interface BossDef {
  species: string;
  /** 中文名 */
  name: string;
  /** 大写字母或特殊字符 */
  glyph: string;
  color: string;
  maxHp: number;
  attack: number;
  defense: number;
  /** 普通精英的 4-6 倍 */
  xpValue: number;
  /** 感知到玩家的半径 */
  senseRadius: number;
  /** 出现楼层（5 的倍数对齐） */
  minDepth: number;
  /** 首次生成时的演出文本 */
  introText: string;
  /** 被击杀时的演出文本 */
  deathText: string;
  /** 2-3 个阶段；hpThreshold 从 1 起严格递减，末位 ≤ 0.2 */
  phases: BossPhase[];
}

/** 特技结算报告：由 decideBossSpecial 产出，集成层据此摆特效与落地数值 */
export interface BossSpecialReport {
  /** 特技种类；普通攻击为 'none' */
  kind: BossSpecial | 'none';
  /** aoe：对视野内玩家的基础伤害（集成层再算防御）；其余特技为 0 */
  damage: number;
  /** summon：召唤数量；其余特技为 0 */
  count: number;
  /** 中文演出文本；普通攻击为空串（普通攻击的记录由集成层自行处理） */
  message: string;
}

/** 特技触发概率：30% 放特技，否则普通攻击 */
const SPECIAL_CHANCE = 0.3;

/**
 * Boss 图鉴（按 minDepth 升序）。数值设计（以精英余烬幽魂 28HP/攻8/防3/经验35 为参照）：
 * - 余烬领主（5 层）：火尘中站起的召唤师，全程召集爪牙围攻，血量跌破两成时改放冲击波自保；
 * - 深渊巨兽（10 层）：纯粹的力量型，全程冲击波压制，残血狂暴加速拼命；
 * - 灰烬之王（15 层）：不死君王，满血阶段不断重塑躯体（回复 15% maxHp），
 *   半血召唤灰烬近卫，最终阶段燃尽自身放出毁灭冲击波（攻击加成最高）。
 */
export const BOSSES: readonly BossDef[] = [
  {
    species: 'ember_lord',
    name: '余烬领主',
    glyph: 'L',
    color: '#ff6a2a',
    maxHp: 90,
    attack: 9,
    defense: 2,
    xpValue: 90,
    senseRadius: 10,
    minDepth: 5,
    introText: '灼热的空气扭曲成漩涡——余烬领主从火尘中站起，低吼着召集它的爪牙！',
    deathText: '余烬领主崩解成漫天飞灰，火光在它空了的巢穴里缓缓熄灭。',
    phases: [
      { hpThreshold: 1, attackBonus: 0, special: 'summon' },
      { hpThreshold: 0.5, attackBonus: 2, special: 'summon' },
      { hpThreshold: 0.2, attackBonus: 4, special: 'aoe' },
    ],
  },
  {
    species: 'abyss_beast',
    name: '深渊巨兽',
    glyph: 'M',
    color: '#7060c8',
    maxHp: 150,
    attack: 12,
    defense: 3,
    xpValue: 140,
    senseRadius: 11,
    minDepth: 10,
    introText: '大地开始震颤——深渊巨兽撕开岩壁爬了上来，一双巨眼在黑暗中锁定了你！',
    deathText: '深渊巨兽轰然倒地，震塌了半面岩壁，深渊重新陷入死寂。',
    phases: [
      { hpThreshold: 1, attackBonus: 0, special: 'aoe' },
      { hpThreshold: 0.55, attackBonus: 3, special: 'aoe' },
      { hpThreshold: 0.18, attackBonus: 6, special: 'haste' },
    ],
  },
  {
    species: 'ash_king',
    name: '灰烬之王',
    glyph: 'K',
    color: '#d9c37f',
    maxHp: 220,
    attack: 14,
    defense: 4,
    xpValue: 190,
    senseRadius: 12,
    minDepth: 15,
    introText: '满地灰烬无风自动，凝聚成一位头戴焦冠的君王——灰烬之王俯视着你。',
    deathText: '灰烬之王的焦冠应声碎裂，千万年的余烬终于随风散尽。',
    phases: [
      { hpThreshold: 1, attackBonus: 0, special: 'heal' },
      { hpThreshold: 0.5, attackBonus: 3, special: 'summon' },
      { hpThreshold: 0.15, attackBonus: 6, special: 'aoe' },
    ],
  },
];

// 定义冻结为只读（含嵌套阶段数组与阶段对象）；集成层直接引用图鉴本体，不做隐藏拷贝
for (const boss of BOSSES) {
  for (const phase of boss.phases) {
    Object.freeze(phase);
  }
  Object.freeze(boss.phases);
  Object.freeze(boss);
}
Object.freeze(BOSSES);

/**
 * 该楼层对应的 Boss；非 5 的倍数层（含 0/负数/非有限值）返回 null。
 * 超过最深层专属楼层的整 5 倍数层（如 20 层及更深），沿用最深的守关者。
 */
export function bossForDepth(depth: number): BossDef | null {
  if (!Number.isFinite(depth) || depth <= 0 || depth % 5 !== 0) return null;
  // BOSSES 按 minDepth 升序排列，遍历后留下的即"不晚于该层出现的最深 Boss"
  let matched: BossDef | null = null;
  for (const boss of BOSSES) {
    if (boss.minDepth <= depth) matched = boss;
  }
  return matched;
}

/**
 * Boss 阶段特技结算：30% 概率放该阶段特技，否则普通攻击（kind 'none'）。
 * 全部随机走 rng，同种子下决策序列完全可复现。
 */
export function decideBossSpecial(phase: BossPhase, rng: Rng): BossSpecialReport {
  if (rng.next() >= SPECIAL_CHANCE) {
    return { kind: 'none', damage: 0, count: 0, message: '' };
  }
  // 狂暴阶段（带攻击加成）的特技演出统一加前缀
  const berserk = phase.attackBonus > 0 ? '狂性大发，' : '';
  switch (phase.special) {
    case 'aoe': {
      const damage = rng.int(6, 10) + phase.attackBonus;
      return {
        kind: 'aoe',
        damage,
        count: 0,
        message: `${berserk}猛地践踏大地，灼热冲击波席卷四周！（伤害 ${damage}）`,
      };
    }
    case 'summon': {
      const count = rng.int(1, 2);
      return {
        kind: 'summon',
        damage: 0,
        count,
        message: `${berserk}发出刺耳的嘶鸣，从阴影中唤出 ${count} 只爪牙！`,
      };
    }
    case 'haste':
      return { kind: 'haste', damage: 0, count: 0, message: `${berserk}周身腾起赤红气流，动作骤然变得迅疾！` };
    case 'heal':
      // 集成层按 15% maxHp 回血（不低于当前血量上限）
      return { kind: 'heal', damage: 0, count: 0, message: `${berserk}伤口间的火星重新烧旺，躯体正在重塑！（回复 15% 生命）` };
  }
}

/**
 * 当前血量所在阶段：阶段 i 覆盖血量区间 (下一阶段阈值, 本阶段阈值]。
 * 从高阈值往低扫描，返回第一个覆盖 hp/maxHp 的阶段；
 * 血量越界（<0 或 >maxHp）收敛到 [0,1] 区间后判断。
 */
export function phaseForHp(def: BossDef, hp: number): BossPhase {
  const phases = def.phases;
  const ratio = Math.min(1, Math.max(0, hp / def.maxHp));
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    if (!phase) continue;
    const lower = i + 1 < phases.length ? (phases[i + 1]?.hpThreshold ?? 0) : Number.NEGATIVE_INFINITY;
    if (ratio <= phase.hpThreshold && ratio > lower) return phase;
  }
  const fallback = phases[phases.length - 1];
  if (!fallback) throw new Error('phaseForHp: Boss 缺少阶段定义（不应发生）');
  return fallback;
}
