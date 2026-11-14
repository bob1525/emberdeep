import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import { AFFIXES, RARITIES, bonusOf, displayName, rarityColor, rollAffixData } from '../src/items/affixes';
import type { Rarity } from '../src/items/affixes';

/** 稀有度固定档位顺序（common → epic，affixCount 应沿此严格递增） */
const RARITY_LADDER: readonly Rarity[] = ['common', 'magic', 'rare', 'epic'];

describe('稀有度表完整性', () => {
  it('恰好 4 档，键名与档位集合一致', () => {
    expect(Object.keys(RARITIES).sort()).toEqual([...RARITY_LADDER].sort());
  });

  it('affixCount 沿 common→epic 严格 0→3 递增', () => {
    RARITY_LADDER.forEach((rarity, i) => {
      expect(RARITIES[rarity].affixCount).toBe(i);
    });
  });

  it('中文名与颜色符合约定', () => {
    expect(RARITIES.common.name).toBe('普通');
    expect(RARITIES.magic.name).toBe('魔力');
    expect(RARITIES.rare.name).toBe('稀有');
    expect(RARITIES.epic.name).toBe('史诗');
    expect(RARITIES.common.color).toBe('#c0c8d4');
    expect(RARITIES.magic.color).toBe('#6fb3e0');
    expect(RARITIES.rare.color).toBe('#c9a227');
    expect(RARITIES.epic.color).toBe('#c678dd');
  });

  it('所有颜色均为 #rrggbb 小写十六进制格式', () => {
    for (const info of Object.values(RARITIES)) {
      expect(info.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('词缀目录完整性', () => {
  it('至少 8 条词缀，id 无重复', () => {
    expect(AFFIXES.length).toBeGreaterThanOrEqual(8);
    const ids = AFFIXES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('前缀中文名非空且以"的"结尾', () => {
    for (const affix of AFFIXES) {
      expect(affix.name.length).toBeGreaterThanOrEqual(3);
      expect(affix.name.endsWith('的')).toBe(true);
    }
  });

  it('每条词缀至少携带一项加成，取值为 +1~+3 的整数', () => {
    for (const affix of AFFIXES) {
      const values = [affix.attack, affix.defense, affix.maxHp].filter(
        (v): v is number => v !== undefined,
      );
      expect(values.length).toBeGreaterThanOrEqual(1);
      for (const v of values) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(3);
      }
    }
  });

  it('attack/defense/maxHp 各有至少 2 条不同强度（梯度）', () => {
    const distinctValues = (key: 'attack' | 'defense' | 'maxHp') =>
      new Set(AFFIXES.map((a) => a[key]).filter((v): v is number => v !== undefined)).size;
    expect(distinctValues('attack')).toBeGreaterThanOrEqual(2);
    expect(distinctValues('defense')).toBeGreaterThanOrEqual(2);
    expect(distinctValues('maxHp')).toBeGreaterThanOrEqual(2);
  });

  it('抽查关键词条目数值与清单一致', () => {
    const byId = (id: string) => AFFIXES.find((a) => a.id === id);
    expect(byId('sharp')).toMatchObject({ attack: 1 });
    expect(byId('brutal')).toMatchObject({ attack: 2 });
    expect(byId('burning')).toMatchObject({ attack: 3 });
    expect(byId('sturdy')).toMatchObject({ defense: 1 });
    expect(byId('heavy')).toMatchObject({ defense: 2 });
    expect(byId('ornate')).toMatchObject({ defense: 3 });
    expect(byId('vital')).toMatchObject({ maxHp: 2 });
    expect(byId('boiling')).toMatchObject({ maxHp: 3 });
    expect(byId('agile')).toMatchObject({ attack: 1, maxHp: 1 });
  });
});

describe('rollAffixData', () => {
  it('同种子下掷出的序列完全可复现', () => {
    const run = () => {
      const rng = new Rng(42);
      return Array.from({ length: 100 }, () => {
        const data = rollAffixData(5, rng);
        return `${data.rarity}=${data.affixIds.join(',')}`;
      });
    };
    expect(run()).toEqual(run());
  });

  it('affixIds 无重复、都在目录中且数量与 rarity.affixCount 一致（跨深度大量抽样）', () => {
    const rng = new Rng(11);
    const catalogIds = new Set(AFFIXES.map((a) => a.id));
    for (let depth = 1; depth <= 12; depth++) {
      for (let i = 0; i < 100; i++) {
        const data = rollAffixData(depth, rng);
        expect(data.affixIds.length).toBe(RARITIES[data.rarity].affixCount);
        expect(new Set(data.affixIds).size).toBe(data.affixIds.length);
        for (const id of data.affixIds) {
          expect(catalogIds.has(id)).toBe(true);
        }
      }
    }
  });

  it('common 恒为空词缀；epic 恰有 3 条', () => {
    const rng = new Rng(3);
    let commonCount = 0;
    let epicCount = 0;
    for (let i = 0; i < 400; i++) {
      const data = rollAffixData(9, rng);
      if (data.rarity === 'common') {
        commonCount++;
        expect(data.affixIds).toEqual([]);
      } else if (data.rarity === 'epic') {
        epicCount++;
        expect(data.affixIds.length).toBe(3);
      }
    }
    expect(commonCount).toBeGreaterThan(0);
    expect(epicCount).toBeGreaterThan(0);
  });

  it('深度 1 抽 200 次：史诗出现率 < 5%，普通出现率 > 50%', () => {
    const rng = new Rng(2024);
    const counts: Record<Rarity, number> = { common: 0, magic: 0, rare: 0, epic: 0 };
    for (let i = 0; i < 200; i++) counts[rollAffixData(1, rng).rarity]++;
    expect(counts.epic / 200).toBeLessThan(0.05);
    expect(counts.common / 200).toBeGreaterThan(0.5);
  });

  it('深度 10 抽 200 次：稀有+史诗出现率 > 40%', () => {
    const rng = new Rng(2024);
    let advanced = 0;
    for (let i = 0; i < 200; i++) {
      const rarity = rollAffixData(10, rng).rarity;
      if (rarity === 'rare' || rarity === 'epic') advanced++;
    }
    expect(advanced / 200).toBeGreaterThan(0.4);
  });

  it('深度 8 起史诗可见（300 次抽样中出现史诗）', () => {
    const rng = new Rng(7);
    let epicCount = 0;
    for (let i = 0; i < 300; i++) {
      if (rollAffixData(8, rng).rarity === 'epic') epicCount++;
    }
    expect(epicCount).toBeGreaterThan(0);
  });

  it('非法深度（0 / 负数 / NaN）按 depth 1 处理且不抛错', () => {
    const rng = new Rng(5);
    for (const depth of [0, -3, Number.NaN]) {
      const data = rollAffixData(depth, rng);
      expect(RARITY_LADDER).toContain(data.rarity);
    }
  });
});

describe('bonusOf', () => {
  it('null 与空词缀 → 全 0', () => {
    expect(bonusOf(null)).toEqual({ attack: 0, defense: 0, maxHp: 0 });
    expect(bonusOf({ rarity: 'common', affixIds: [] })).toEqual({ attack: 0, defense: 0, maxHp: 0 });
  });

  it('单/双/三词缀数值正确合计', () => {
    expect(bonusOf({ rarity: 'magic', affixIds: ['sharp'] })).toEqual({ attack: 1, defense: 0, maxHp: 0 });
    expect(bonusOf({ rarity: 'rare', affixIds: ['brutal', 'heavy'] })).toEqual({
      attack: 2,
      defense: 2,
      maxHp: 0,
    });
    expect(bonusOf({ rarity: 'epic', affixIds: ['burning', 'boiling', 'agile'] })).toEqual({
      attack: 4,
      defense: 0,
      maxHp: 4,
    });
  });

  it('混合词缀按字段分别计入', () => {
    expect(bonusOf({ rarity: 'magic', affixIds: ['agile'] })).toEqual({ attack: 1, defense: 0, maxHp: 1 });
  });

  it('未知词缀 id 抛错', () => {
    expect(() => bonusOf({ rarity: 'magic', affixIds: ['ghost'] })).toThrow();
  });
});

describe('displayName', () => {
  it('null 与 common 返回原名', () => {
    expect(displayName('短剑', null)).toBe('短剑');
    expect(displayName('短剑', { rarity: 'common', affixIds: [] })).toBe('短剑');
  });

  it('magic / rare 单词缀：前缀 + 原名', () => {
    expect(displayName('短剑', { rarity: 'magic', affixIds: ['burning'] })).toBe('燃烧的短剑');
    expect(displayName('皮甲', { rarity: 'rare', affixIds: ['sturdy'] })).toBe('坚固的皮甲');
  });

  it('词缀数 = 2 时两个前缀依 affixIds 顺序拼接', () => {
    expect(displayName('短剑', { rarity: 'rare', affixIds: ['burning', 'vital'] })).toBe('燃烧的生命的短剑');
    expect(displayName('短剑', { rarity: 'rare', affixIds: ['vital', 'burning'] })).toBe('生命的燃烧的短剑');
  });

  it('词缀数 = 3 时三个前缀依序拼接', () => {
    expect(displayName('战斧', { rarity: 'epic', affixIds: ['brutal', 'ornate', 'boiling'] })).toBe(
      '残暴的精铸的沸血的战斧',
    );
  });
});

describe('rarityColor', () => {
  it('null → common 色', () => {
    expect(rarityColor(null)).toBe('#c0c8d4');
    expect(rarityColor(null)).toBe(RARITIES.common.color);
  });

  it('各稀有度映射到各自颜色', () => {
    for (const rarity of RARITY_LADDER) {
      expect(rarityColor({ rarity, affixIds: [] })).toBe(RARITIES[rarity].color);
    }
  });
});
