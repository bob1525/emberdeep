/**
 * 职业系统 — 三职业（战士/游侠/法师）的静态模板与技能冷却状态机。
 * 纯数据 + 冷却状态机：起始装备/物品引用物品目录（ITEMS）与远程目录（RANGED）的 catalogId，
 * 引用存在性由 tests/classes.test.ts 对照目录校验；技能的具体效果结算（位移/射击/范围伤害）
 * 不在本模块，由集成层按 skill.id 解释执行。
 */

/** 职业标识 */
export type ClassId = 'warrior' | 'ranger' | 'mage';

/** 职业主动技能的静态定义（效果结算由集成层按 id 解释执行） */
export interface SkillDef {
  id: string;
  /** 中文名：冲锋 / 精准箭 / 烈焰新星 */
  name: string;
  /** 一句话中文描述 */
  description: string;
  /** 冷却回合数：使用后需经过的回合数，归零后可再次使用 */
  cooldown: number;
}

/** 职业静态模板：数值梯度 + 起始装备 + 主动技能 */
export interface ClassDef {
  id: ClassId;
  /** 中文名：战士 / 游侠 / 法师 */
  name: string;
  /** 一句话中文描述（选人界面展示） */
  description: string;
  /** 基础生命上限（进场时的 maxHp） */
  baseHp: number;
  /**
   * 基础攻击力（武器加成由游戏层按物品目录另算）。
   * 梯度：战士与法师并列最高——法师以低血低防换输出；游侠居中偏低，凭短弓补远程输出。
   */
  baseAttack: number;
  /** 基础防御（护甲加成由游戏层按物品目录另算）；战士最高 */
  baseDefense: number;
  /** 起始武器（ITEMS 目录 id；null 表示不带武器进场） */
  startWeapon: string | null;
  /** 起始护甲（ITEMS 目录 id；null 表示不带护甲进场） */
  startArmor: string | null;
  /** 起始背包物品（ITEMS 目录 id，可重复） */
  startItems: string[];
  /** 起始远程武器（RANGED 目录 id；null 表示没有） */
  startRanged: string | null;
  /** 职业主动技能 */
  skill: SkillDef;
}

/**
 * 职业目录：ClassId → 定义。
 * 数值梯度（基准：早期玩家 30HP / 攻击 4 / 防御 1）：
 * - 战士 40HP / 攻 4 / 防 2 —— 高血高防的近战壁垒，短剑 + 皮甲起手；
 * - 游侠 28HP / 攻 3 / 防 1 —— 属性中庸，凭短弓在远处放风筝，双药水保续航；
 * - 法师 22HP / 攻 4 / 防 0 —— 脆皮高攻，无护甲裸进深渊，靠烈焰新星清场。
 */
export const CLASSES: Record<ClassId, ClassDef> = {
  warrior: {
    id: 'warrior',
    name: '战士',
    description: '身经百战的老兵，血厚甲坚，是深渊中最可靠的壁垒。',
    baseHp: 40,
    baseAttack: 4,
    baseDefense: 2,
    startWeapon: 'short_sword',
    startArmor: 'leather_armor',
    startItems: ['minor_healing'],
    startRanged: null,
    skill: {
      id: 'charge',
      name: '冲锋',
      description: '化作一道残影冲向敌人，发动一次势大力沉的冲撞。',
      cooldown: 12,
    },
  },
  ranger: {
    id: 'ranger',
    name: '游侠',
    description: '眼疾手快的猎手，凭一张短弓在远处放倒猎物。',
    baseHp: 28,
    baseAttack: 3,
    baseDefense: 1,
    startWeapon: 'dagger',
    startArmor: 'leather_armor',
    startItems: ['minor_healing', 'minor_healing'],
    startRanged: 'short_bow',
    skill: {
      id: 'precise_shot',
      name: '精准箭',
      description: '凝神屏息射出一支直取要害的利箭，伤害远超寻常。',
      cooldown: 8,
    },
  },
  mage: {
    id: 'mage',
    name: '法师',
    description: '追逐余烬之火的咒法学徒，脆弱的身躯里握着毁灭性的烈焰。',
    baseHp: 26,
    baseAttack: 4,
    baseDefense: 0,
    startWeapon: 'dagger',
    startArmor: null,
    startItems: ['healing'],
    startRanged: null,
    skill: {
      id: 'flame_nova',
      name: '烈焰新星',
      description: '以自身为中心迸发一圈烈焰，灼烧周围的所有敌人。',
      cooldown: 14,
    },
  },
};

// 定义对象冻结为只读（含嵌套的 skill 与 startItems），防止运行期意外篡改（与物品/怪物目录保持一致）
for (const def of Object.values(CLASSES)) {
  Object.freeze(def.skill);
  Object.freeze(def.startItems);
  Object.freeze(def);
}

/** 单个技能的冷却状态：挂在玩家身上，由集成层在回合推进时调用 tickCooldown */
export interface SkillCooldown {
  skillId: string;
  /** 剩余冷却回合数；0 表示立即可用 */
  remaining: number;
}

/** 由技能定义创建冷却状态：进场即可用（remaining = 0） */
export function makeCooldown(def: SkillDef): SkillCooldown {
  return { skillId: def.id, remaining: 0 };
}

/** 技能当前是否可用：冷却归零即可用（负数脏数据也视为可用） */
export function canUseSkill(cd: SkillCooldown): boolean {
  return cd.remaining <= 0;
}

/** 使用技能后进入冷却：钳为非负整数，防御非法的 cooldown 定义；冷却未走完时重启即重置回满冷却 */
export function startCooldown(cd: SkillCooldown, def: SkillDef): void {
  cd.remaining = Math.max(0, Math.floor(def.cooldown));
}

/** 冷却推进一回合：逐回合递减，下限 0（不会出现负数） */
export function tickCooldown(cd: SkillCooldown): void {
  cd.remaining = Math.max(0, cd.remaining - 1);
}
