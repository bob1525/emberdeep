import { describe, expect, it } from 'vitest';
import type { ClassDef, SkillCooldown, SkillDef } from '../src/entities/classes';
import { CLASSES, canUseSkill, makeCooldown, startCooldown, tickCooldown } from '../src/entities/classes';
import { RANGED } from '../src/engine/ranged';
import { ITEMS } from '../src/items/catalog';

/** 目录条目快照（键名 → 定义），供各用例遍历 */
const entries: Array<[string, ClassDef]> = Object.entries(CLASSES);

describe('职业目录完整性', () => {
  it('恰好三个职业，键名与 id 一致且互不重复', () => {
    expect(entries).toHaveLength(3);
    expect(Object.keys(CLASSES).sort()).toEqual(['mage', 'ranger', 'warrior']);
    for (const [key, def] of entries) {
      expect(def.id).toBe(key);
    }
  });

  it('中文名 / 描述非空，技能信息齐全，冷却 ≥ 5', () => {
    for (const [, def] of entries) {
      expect(def.name.trim().length).toBeGreaterThan(0);
      expect(def.description.trim().length).toBeGreaterThan(0);
      expect(def.skill.id.trim().length).toBeGreaterThan(0);
      expect(def.skill.name.trim().length).toBeGreaterThan(0);
      expect(def.skill.description.trim().length).toBeGreaterThan(0);
      expect(Number.isInteger(def.skill.cooldown)).toBe(true);
      expect(def.skill.cooldown).toBeGreaterThanOrEqual(5);
    }
    // 中文命名约定
    expect(CLASSES.warrior.name).toBe('战士');
    expect(CLASSES.ranger.name).toBe('游侠');
    expect(CLASSES.mage.name).toBe('法师');
    expect(CLASSES.warrior.skill.name).toBe('冲锋');
    expect(CLASSES.ranger.skill.name).toBe('精准箭');
    expect(CLASSES.mage.skill.name).toBe('烈焰新星');
    // 技能 id 互不重复
    const skillIds = entries.map(([, d]) => d.skill.id);
    expect(new Set(skillIds).size).toBe(skillIds.length);
  });

  it('技能 id 与冷却符合设计：冲锋 12 / 精准箭 8 / 烈焰新星 14', () => {
    expect(CLASSES.warrior.skill.id).toBe('charge');
    expect(CLASSES.ranger.skill.id).toBe('precise_shot');
    expect(CLASSES.mage.skill.id).toBe('flame_nova');
    expect(CLASSES.warrior.skill.cooldown).toBe(12);
    expect(CLASSES.ranger.skill.cooldown).toBe(8);
    expect(CLASSES.mage.skill.cooldown).toBe(14);
  });

  it('目录定义冻结为只读（含嵌套 skill 与 startItems）', () => {
    for (const [, def] of entries) {
      expect(Object.isFrozen(def)).toBe(true);
      expect(Object.isFrozen(def.skill)).toBe(true);
      expect(Object.isFrozen(def.startItems)).toBe(true);
    }
  });
});

describe('起始装备与物品', () => {
  it('所有起始 id 都真实存在于对应目录，且类别正确', () => {
    for (const [, def] of entries) {
      if (def.startWeapon) {
        expect(ITEMS[def.startWeapon]).toBeDefined();
        expect(ITEMS[def.startWeapon]?.category).toBe('weapon');
      }
      if (def.startArmor) {
        expect(ITEMS[def.startArmor]).toBeDefined();
        expect(ITEMS[def.startArmor]?.category).toBe('armor');
      }
      for (const id of def.startItems) {
        expect(ITEMS[id]).toBeDefined();
      }
      if (def.startRanged) {
        expect(RANGED[def.startRanged]).toBeDefined();
      }
    }
  });

  it('战士：短剑 + 皮甲 + 1 瓶小型治疗药水，不带远程', () => {
    const w = CLASSES.warrior;
    expect(w.startWeapon).toBe('short_sword');
    expect(w.startArmor).toBe('leather_armor');
    expect(w.startItems).toEqual(['minor_healing']);
    expect(w.startRanged).toBeNull();
  });

  it('游侠：匕首 + 皮甲 + 2 瓶小型治疗药水 + 短弓（弓类远程武器）', () => {
    const r = CLASSES.ranger;
    expect(r.startWeapon).toBe('dagger');
    expect(r.startArmor).toBe('leather_armor');
    expect(r.startItems).toEqual(['minor_healing', 'minor_healing']);
    expect(r.startRanged).toBe('short_bow');
    // RANGED 用 kind 标记类别：短弓是可反复使用的 bow
    expect(RANGED['short_bow']?.kind).toBe('bow');
  });

  it('法师：匕首 + 不带护甲 + 治疗药水，不带远程', () => {
    const m = CLASSES.mage;
    expect(m.startWeapon).toBe('dagger');
    expect(m.startArmor).toBeNull();
    expect(m.startItems).toEqual(['healing']);
    expect(m.startRanged).toBeNull();
  });
});

describe('三职业数值梯度', () => {
  it('生命：战士 40 > 游侠 28 > 法师 22', () => {
    const { warrior, ranger, mage } = CLASSES;
    expect(warrior.baseHp).toBe(40);
    expect(ranger.baseHp).toBe(28);
    expect(mage.baseHp).toBe(22);
    expect(warrior.baseHp).toBeGreaterThan(ranger.baseHp);
    expect(ranger.baseHp).toBeGreaterThan(mage.baseHp);
  });

  it('防御：战士最高，无甲的法师垫底', () => {
    const { warrior, ranger, mage } = CLASSES;
    expect(warrior.baseDefense).toBe(2);
    expect(warrior.baseDefense).toBeGreaterThan(ranger.baseDefense);
    expect(warrior.baseDefense).toBeGreaterThan(mage.baseDefense);
    expect(mage.baseDefense).toBe(0);
  });

  it('攻击：法师（脆皮高攻）不低于战士，游侠居中偏低', () => {
    const { warrior, ranger, mage } = CLASSES;
    expect(mage.baseAttack).toBeGreaterThanOrEqual(warrior.baseAttack);
    expect(ranger.baseAttack).toBeLessThan(warrior.baseAttack);
    expect(warrior.baseAttack).toBeGreaterThan(ranger.baseAttack);
  });

  it('所有基础数值均为整数，且生命 / 攻击为正', () => {
    for (const [, def] of entries) {
      expect(Number.isInteger(def.baseHp)).toBe(true);
      expect(Number.isInteger(def.baseAttack)).toBe(true);
      expect(Number.isInteger(def.baseDefense)).toBe(true);
      expect(def.baseHp).toBeGreaterThan(0);
      expect(def.baseAttack).toBeGreaterThan(0);
      expect(def.baseDefense).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('技能冷却状态机', () => {
  it('makeCooldown：进场即可用，记录 skillId，且各实例互不共享状态', () => {
    const a = makeCooldown(CLASSES.warrior.skill);
    const b = makeCooldown(CLASSES.ranger.skill);
    expect(a).toEqual({ skillId: 'charge', remaining: 0 });
    expect(b.skillId).toBe('precise_shot');
    expect(canUseSkill(a)).toBe(true);
    expect(canUseSkill(b)).toBe(true);
    // a 进入冷却不影响 b：状态各自独立
    startCooldown(a, CLASSES.warrior.skill);
    expect(canUseSkill(a)).toBe(false);
    expect(b.remaining).toBe(0);
    expect(canUseSkill(b)).toBe(true);
  });

  it('三个职业都走完整状态机：可用 → 启动冷却 → 逐回合递减 → 归零后再次可用', () => {
    for (const [, def] of entries) {
      const cd: SkillCooldown = makeCooldown(def.skill);
      expect(canUseSkill(cd)).toBe(true);

      startCooldown(cd, def.skill);
      expect(cd.remaining).toBe(def.skill.cooldown);
      expect(canUseSkill(cd)).toBe(false);

      // 每回合递减 1，归零那一刻才重新可用
      for (let want = def.skill.cooldown - 1; want >= 0; want--) {
        tickCooldown(cd);
        expect(cd.remaining).toBe(want);
        expect(canUseSkill(cd)).toBe(want === 0);
      }
    }
  });

  it('战士冲锋：12 回合冷却逐步递减，归零后可立即再次启动', () => {
    const def = CLASSES.warrior.skill;
    const cd = makeCooldown(def);
    startCooldown(cd, def);
    expect(cd.remaining).toBe(12);
    expect(canUseSkill(cd)).toBe(false);
    // tick 11 次仍不可用，第 12 次归零复用
    for (let i = 0; i < 11; i++) {
      tickCooldown(cd);
      expect(canUseSkill(cd)).toBe(false);
    }
    expect(cd.remaining).toBe(1);
    tickCooldown(cd);
    expect(cd.remaining).toBe(0);
    expect(canUseSkill(cd)).toBe(true);
    startCooldown(cd, def);
    expect(cd.remaining).toBe(12);
  });

  it('tickCooldown 不会把 remaining 压到 0 以下', () => {
    const cd = makeCooldown(CLASSES.mage.skill);
    // 本就为 0 时 tick 不产生负数
    tickCooldown(cd);
    tickCooldown(cd);
    expect(cd.remaining).toBe(0);
    // 冷却中狂 tick 也只会停在 0
    startCooldown(cd, CLASSES.mage.skill);
    for (let i = 0; i < 100; i++) tickCooldown(cd);
    expect(cd.remaining).toBe(0);
    expect(canUseSkill(cd)).toBe(true);
  });

  it('startCooldown 在冷却未走完时重启，会重置为完整冷却且不改写技能定义', () => {
    const def = CLASSES.ranger.skill;
    const cd = makeCooldown(def);
    startCooldown(cd, def);
    tickCooldown(cd);
    expect(cd.remaining).toBe(def.cooldown - 1);
    startCooldown(cd, def);
    expect(cd.remaining).toBe(def.cooldown);
    // 技能定义自身不被改写
    expect(def.cooldown).toBe(8);
    expect(Object.isFrozen(def)).toBe(true);
  });

  it('冷却框架对目录外的任意 SkillDef 同样适用', () => {
    const custom: SkillDef = {
      id: 'test_burst',
      name: '测试爆发',
      description: '用于验证冷却状态机通用性的自定义技能。',
      cooldown: 3,
    };
    const cd = makeCooldown(custom);
    expect(cd.skillId).toBe('test_burst');
    startCooldown(cd, custom);
    expect(cd.remaining).toBe(3);
    tickCooldown(cd);
    tickCooldown(cd);
    expect(cd.remaining).toBe(1);
    expect(canUseSkill(cd)).toBe(false);
    tickCooldown(cd);
    expect(cd.remaining).toBe(0);
    expect(canUseSkill(cd)).toBe(true);
  });

  it('容忍脏数据：remaining 为负时视为可用，tick 后收敛到 0', () => {
    const cd = makeCooldown(CLASSES.mage.skill);
    cd.remaining = -2; // 模拟旧存档脏数据
    expect(canUseSkill(cd)).toBe(true);
    tickCooldown(cd);
    expect(cd.remaining).toBe(0);
  });
});
