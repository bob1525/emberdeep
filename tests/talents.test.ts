import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import { TALENTS, rollTalentChoices, talentBonus } from '../src/entities/talents';
import type { TalentDef, TalentMods, TalentRarity } from '../src/entities/talents';

/** 稀有度固定档位顺序（common → epic） */
const RARITY_LADDER: readonly TalentRarity[] = ['common', 'rare', 'epic'];

/** 全部 8 种 mod 字段（目录必须逐一覆盖） */
const MOD_KEYS: readonly (keyof TalentMods)[] = [
  'attack',
  'defense',
  'maxHp',
  'critChance',
  'lifesteal',
  'goldBonus',
  'xpBonus',
  'regen',
];

/** id → 天赋定义（测试辅助；目录内必有，缺失即测试失败） */
function defOf(id: string): TalentDef {
  const def = TALENTS.find((t) => t.id === id);
  if (!def) throw new Error(`目录中不存在: "${id}"`);
  return def;
}

/** 构造"除 keep 外全部天赋都叠满 maxStacks"的 owned 列表 */
function ownedWithAllMaxedExcept(keep: readonly string[]): string[] {
  const owned: string[] = [];
  for (const def of TALENTS) {
    if (keep.includes(def.id)) continue;
    for (let i = 0; i < def.maxStacks; i++) owned.push(def.id);
  }
  return owned;
}

describe('天赋目录完整性', () => {
  it('至少 12 条天赋，id 无重复', () => {
    expect(TALENTS.length).toBeGreaterThanOrEqual(12);
    const ids = TALENTS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('中文名与描述均非空', () => {
    for (const talent of TALENTS) {
      expect(talent.name.length).toBeGreaterThan(0);
      expect(talent.description.length).toBeGreaterThan(0);
    }
  });

  it('rarity 只取合法档位，且三档稀有度都有覆盖', () => {
    for (const talent of TALENTS) {
      expect(RARITY_LADDER).toContain(talent.rarity);
    }
    for (const rarity of RARITY_LADDER) {
      expect(TALENTS.some((t) => t.rarity === rarity)).toBe(true);
    }
  });

  it('maxStacks 为 1-3 的整数', () => {
    for (const talent of TALENTS) {
      expect(Number.isInteger(talent.maxStacks)).toBe(true);
      expect(talent.maxStacks).toBeGreaterThanOrEqual(1);
      expect(talent.maxStacks).toBeLessThanOrEqual(3);
    }
  });

  it('覆盖全部 8 种 mod，且每条天赋至少携带一项加成', () => {
    for (const key of MOD_KEYS) {
      expect(TALENTS.some((t) => t.mods[key] !== undefined)).toBe(true);
    }
    for (const talent of TALENTS) {
      const provided = MOD_KEYS.filter((k) => talent.mods[k] !== undefined);
      expect(provided.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('抽查关键条目：中文名、稀有度、层数与数值与清单一致（含狂战士负生命上限）', () => {
    expect(defOf('iron_stomach')).toMatchObject({ name: '铁胃', rarity: 'common', maxStacks: 3, mods: { maxHp: 6 } });
    expect(defOf('brute_force')).toMatchObject({ name: '蛮力', rarity: 'common', mods: { attack: 2 } });
    expect(defOf('stone_skin')).toMatchObject({ name: '石肤', rarity: 'common', mods: { defense: 1 } });
    expect(defOf('gold_greed')).toMatchObject({ name: '财迷', rarity: 'common', mods: { goldBonus: 0.3 } });
    expect(defOf('apprentice')).toMatchObject({ name: '学徒', rarity: 'common', mods: { xpBonus: 0.25 } });
    expect(defOf('vitality')).toMatchObject({ name: '活力', rarity: 'common', mods: { regen: 1 } });
    expect(defOf('eagle_eye')).toMatchObject({ name: '鹰眼', rarity: 'rare', mods: { critChance: 0.08 } });
    expect(defOf('bat_kiss')).toMatchObject({ name: '蝙蝠之吻', rarity: 'rare', mods: { lifesteal: 0.15 } });
    expect(defOf('tenacity')).toMatchObject({ name: '顽强', rarity: 'rare', mods: { maxHp: 12 } });
    expect(defOf('precision')).toMatchObject({ name: '精准', rarity: 'rare', mods: { attack: 1, critChance: 0.05 } });
    expect(defOf('berserker')).toMatchObject({ name: '狂战士', rarity: 'epic', maxStacks: 1, mods: { attack: 4, maxHp: -8 } });
    expect(defOf('midas_hands')).toMatchObject({ name: '黄金之手', rarity: 'epic', maxStacks: 1, mods: { goldBonus: 0.8, xpBonus: 0.3 } });
    expect(defOf('reapers_touch')).toMatchObject({ name: '死神之触', rarity: 'epic', maxStacks: 1, mods: { lifesteal: 0.35 } });
  });

  it('关键维度有梯度：attack / maxHp / lifesteal 各有至少 2 档不同数值', () => {
    const distinct = (key: keyof TalentMods) =>
      new Set(TALENTS.map((t) => t.mods[key]).filter((v): v is number => v !== undefined)).size;
    expect(distinct('attack')).toBeGreaterThanOrEqual(2);
    expect(distinct('maxHp')).toBeGreaterThanOrEqual(2);
    expect(distinct('lifesteal')).toBeGreaterThanOrEqual(2);
  });
});

describe('talentBonus', () => {
  it('空列表 → 全 0', () => {
    expect(talentBonus([])).toEqual({
      attack: 0,
      defense: 0,
      maxHp: 0,
      critChance: 0,
      lifesteal: 0,
      goldBonus: 0,
      xpBonus: 0,
      regen: 0,
    });
  });

  it('单个天赋只计入其声明的字段', () => {
    expect(talentBonus(['brute_force'])).toEqual({
      attack: 2,
      defense: 0,
      maxHp: 0,
      critChance: 0,
      lifesteal: 0,
      goldBonus: 0,
      xpBonus: 0,
      regen: 0,
    });
    expect(talentBonus(['vitality']).regen).toBe(1);
    expect(talentBonus(['eagle_eye']).critChance).toBeCloseTo(0.08, 12);
  });

  it('同一 id 多层累加', () => {
    expect(talentBonus(['iron_stomach', 'iron_stomach']).maxHp).toBe(12);
    expect(talentBonus(['brute_force', 'brute_force', 'brute_force']).attack).toBe(6);
    expect(talentBonus(['gold_greed', 'gold_greed']).goldBonus).toBeCloseTo(0.6, 12);
  });

  it('多个不同 id 按字段分别合计（含混合与负数加成）', () => {
    const total = talentBonus(['brute_force', 'stone_skin', 'precision', 'berserker']);
    expect(total.attack).toBe(2 + 1 + 4); // 蛮力 + 精准 + 狂战士
    expect(total.defense).toBe(1); // 石肤
    expect(total.maxHp).toBe(-8); // 狂战士的代价
    expect(total.critChance).toBeCloseTo(0.05, 12); // 精准
    for (const key of ['lifesteal', 'goldBonus', 'xpBonus', 'regen'] as const) {
      expect(total[key]).toBe(0);
    }
  });

  it('小数加成多层合计（浮点容差）', () => {
    const total = talentBonus([
      'bat_kiss',
      'bat_kiss',
      'reapers_touch',
      'apprentice',
      'apprentice',
      'midas_hands',
    ]);
    expect(total.lifesteal).toBeCloseTo(0.15 * 2 + 0.35, 12);
    expect(total.xpBonus).toBeCloseTo(0.25 * 2 + 0.3, 12);
    expect(total.goldBonus).toBeCloseTo(0.8, 12);
  });

  it('未知 id 抛错', () => {
    expect(() => talentBonus(['ghost_talent'])).toThrow();
  });
});

describe('rollTalentChoices', () => {
  it('同种子下抽取序列完全可复现（跨深度混合抽样）', () => {
    const run = () => {
      const rng = new Rng(42);
      const out: string[][] = [];
      for (let depth = 1; depth <= 6; depth++) {
        for (let i = 0; i < 20; i++) out.push(rollTalentChoices([], depth, rng));
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('池子充足时每次恰好 3 个、互不重复、都在目录中（跨深度大量抽样）', () => {
    const rng = new Rng(11);
    const catalogIds = new Set(TALENTS.map((t) => t.id));
    for (let depth = 1; depth <= 12; depth++) {
      for (let i = 0; i < 100; i++) {
        const choices = rollTalentChoices([], depth, rng);
        expect(choices.length).toBe(3);
        expect(new Set(choices).size).toBe(choices.length);
        for (const id of choices) {
          expect(catalogIds.has(id)).toBe(true);
        }
      }
    }
  });

  it('满层 id 绝不再出现：铁胃叠满 3 层后 200 次抽取都不含它', () => {
    const rng = new Rng(2024);
    const owned = ['iron_stomach', 'iron_stomach', 'iron_stomach'];
    for (let i = 0; i < 200; i++) {
      const choices = rollTalentChoices(owned, 3, rng);
      expect(choices.length).toBe(3);
      expect(choices).not.toContain('iron_stomach');
    }
  });

  it('全部史诗满层后，任何深度都不再出现史诗 id', () => {
    const rng = new Rng(9);
    const epicIds = TALENTS.filter((t) => t.rarity === 'epic').map((t) => t.id);
    const owned: string[] = [];
    for (const def of TALENTS) {
      if (def.rarity !== 'epic') continue;
      for (let i = 0; i < def.maxStacks; i++) owned.push(def.id);
    }
    for (let depth = 1; depth <= 10; depth++) {
      for (let i = 0; i < 50; i++) {
        for (const id of rollTalentChoices(owned, depth, rng)) {
          expect(epicIds).not.toContain(id);
        }
      }
    }
  });

  it('depth 1 抽 200 次：含史诗的抽取占比 < 10%', () => {
    const rng = new Rng(2024);
    let epicRolls = 0;
    for (let i = 0; i < 200; i++) {
      const choices = rollTalentChoices([], 1, rng);
      if (choices.some((id) => defOf(id).rarity === 'epic')) epicRolls++;
    }
    expect(epicRolls / 200).toBeLessThan(0.1);
  });

  it('depth 10 抽 200 次：含史诗的抽取占比 > 25%', () => {
    const rng = new Rng(2024);
    let epicRolls = 0;
    for (let i = 0; i < 200; i++) {
      const choices = rollTalentChoices([], 10, rng);
      if (choices.some((id) => defOf(id).rarity === 'epic')) epicRolls++;
    }
    expect(epicRolls / 200).toBeGreaterThan(0.25);
  });

  it('可用候选不足 3 个时返回全部可用候选（这里恰好 2 条）', () => {
    const keep = ['brute_force', 'stone_skin'];
    const owned = ownedWithAllMaxedExcept(keep);
    for (let i = 0; i < 50; i++) {
      const choices = rollTalentChoices(owned, 5, new Rng(i));
      expect([...choices].sort()).toEqual([...keep].sort());
    }
  });

  it('全部满层时返回空数组', () => {
    const owned = ownedWithAllMaxedExcept([]);
    expect(rollTalentChoices(owned, 1, new Rng(1))).toEqual([]);
  });

  it('非法深度（0 / 负数 / NaN）按 depth 1 处理且不抛错', () => {
    const rng = new Rng(5);
    for (const depth of [0, -3, Number.NaN]) {
      const choices = rollTalentChoices([], depth, rng);
      expect(choices.length).toBe(3);
    }
  });
});
