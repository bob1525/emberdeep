import { describe, expect, it } from 'vitest';
import { allocateItemUid } from '../src/entities/actor';
import type { ItemCategory, ItemInstance } from '../src/entities/actor';
import { Rng } from '../src/engine/rng';
import { ITEMS, armorBonus, createItem, itemDef, itemName, rollLoot, weaponBonus } from '../src/items/catalog';

/** 类别 → 地面字符的约定 */
const GLYPHS: Record<ItemCategory, string> = { potion: '!', scroll: '?', weapon: '/', armor: '[',
  ranged: '}', };
const CATEGORIES: readonly ItemCategory[] = ['potion', 'scroll', 'weapon', 'armor'];

describe('物品目录完整性', () => {
  const entries = Object.entries(ITEMS);

  it('目录规模与内容清单一致，catalogId 无重复且与键名一致', () => {
    // 内容清单：4 药水 + 2 卷轴 + 3 武器 + 3 护甲
    expect(entries).toHaveLength(12);
    const ids = entries.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [id, def] of entries) {
      expect(def.catalogId).toBe(id);
    }
  });

  it('所有 def 的类别 / 字符 / 中文名 / 描述 / 颜色符合约定', () => {
    for (const [, def] of entries) {
      expect(CATEGORIES).toContain(def.category);
      expect(def.glyph).toBe(GLYPHS[def.category]);
      expect(def.name.trim().length).toBeGreaterThan(0);
      expect(def.description.trim().length).toBeGreaterThan(0);
      expect(def.color.trim().length).toBeGreaterThan(0);
    }
  });

  it('weapon/armor 必有非负整数 bonus，数值与清单一致', () => {
    for (const [, def] of entries) {
      if (def.category === 'weapon' || def.category === 'armor') {
        expect(def.bonus).toBeDefined();
        expect(Number.isInteger(def.bonus)).toBe(true);
        expect(def.bonus).toBeGreaterThanOrEqual(0);
      }
    }
    expect(ITEMS['dagger']?.bonus).toBe(1);
    expect(ITEMS['short_sword']?.bonus).toBe(3);
    expect(ITEMS['war_axe']?.bonus).toBe(5);
    expect(ITEMS['leather_armor']?.bonus).toBe(1);
    expect(ITEMS['chain_mail']?.bonus).toBe(2);
    expect(ITEMS['plate_armor']?.bonus).toBe(4);
  });

  it('potion 必有 heal 或 effect；治疗量区间合法；might 携带 bonus 与 duration', () => {
    const potions = entries.map(([, d]) => d).filter((d) => d.category === 'potion');
    expect(potions).toHaveLength(4);
    for (const def of potions) {
      expect(def.heal !== undefined || def.effect !== undefined).toBe(true);
      if (def.heal) {
        const [min, max] = def.heal;
        expect(min).toBeGreaterThanOrEqual(1);
        expect(max).toBeGreaterThanOrEqual(min);
      }
      if (def.effect === 'might') {
        // 内容清单：攻击 +3，持续 20 回合
        expect(def.bonus).toBe(3);
        expect(def.duration).toBeGreaterThanOrEqual(1);
      }
    }
    expect(ITEMS['minor_healing']?.heal).toEqual([6, 10]);
    expect(ITEMS['healing']?.heal).toEqual([12, 20]);
    expect(ITEMS['greater_healing']?.heal).toEqual([18, 30]);
    // 治疗线逐档抬升：小型 < 标准 < 高级（区间上下限均单调）
    expect(ITEMS['healing']?.heal?.[0]).toBeGreaterThan(ITEMS['minor_healing']?.heal?.[0] ?? 0);
    expect(ITEMS['greater_healing']?.heal?.[0]).toBeGreaterThan(ITEMS['healing']?.heal?.[0] ?? 0);
    expect(ITEMS['greater_healing']?.heal?.[1]).toBeGreaterThan(ITEMS['healing']?.heal?.[1] ?? 0);
    expect(ITEMS['might']?.duration).toBe(20);
  });

  it('scroll 必有 effect（teleport / fireblast）', () => {
    const scrolls = entries.map(([, d]) => d).filter((d) => d.category === 'scroll');
    expect(scrolls).toHaveLength(2);
    for (const def of scrolls) {
      expect(def.effect).toBeDefined();
      expect(['teleport', 'fireblast']).toContain(def.effect);
    }
    // 火焰爆裂的伤害区间复用 heal 字段承载
    expect(ITEMS['fireblast']?.heal).toEqual([8, 14]);
  });
});

describe('createItem / itemDef / bonus 查询', () => {
  it('createItem 生成类别正确的实例，且 uid 全局唯一递增', () => {
    const a = createItem('healing');
    const b = createItem('healing');
    expect(a.catalogId).toBe('healing');
    expect(a.category).toBe('potion');
    expect(b.uid).not.toBe(a.uid);
    expect(b.uid).toBeGreaterThan(a.uid);
    expect(allocateItemUid()).toBeGreaterThan(b.uid);
  });

  it('createItem：未知 catalogId 抛错', () => {
    expect(() => createItem('excalibur')).toThrow();
  });

  it('itemDef 能反查目录定义；查不到时抛错', () => {
    const inst = createItem('war_axe');
    expect(itemDef(inst).catalogId).toBe('war_axe');
    expect(itemDef(inst).name).toBe(ITEMS['war_axe']?.name);
    const ghost: ItemInstance = { uid: allocateItemUid(), catalogId: 'ghost_item', category: 'potion' };
    expect(() => itemDef(ghost)).toThrow();
  });

  it('itemName 返回目录中的中文名', () => {
    expect(itemName(createItem('minor_healing'))).toBe('小型治疗药水');
    expect(itemName(createItem('leather_armor'))).toBe('皮甲');
  });

  it('weaponBonus / armorBonus：正确类别返回 bonus，类别错误返回 0', () => {
    expect(weaponBonus(createItem('dagger'))).toBe(1);
    expect(weaponBonus(createItem('war_axe'))).toBe(5);
    expect(armorBonus(createItem('plate_armor'))).toBe(4);
    expect(armorBonus(createItem('chain_mail'))).toBe(2);
    // 类别错误一律 0
    expect(weaponBonus(createItem('healing'))).toBe(0);
    expect(weaponBonus(createItem('teleport'))).toBe(0);
    expect(weaponBonus(createItem('leather_armor'))).toBe(0);
    expect(armorBonus(createItem('dagger'))).toBe(0);
    // might 药水的 bonus:3 只表示生效期攻击加成，不漏进武器/护甲加成
    expect(weaponBonus(createItem('might'))).toBe(0);
    expect(armorBonus(createItem('might'))).toBe(0);
  });
});

describe('rollLoot', () => {
  it('同 rng 种子下掉落序列完全可复现', () => {
    const run = () => {
      const rng = new Rng(2024);
      return Array.from({ length: 50 }, () => rollLoot(3, rng).catalogId);
    };
    expect(run()).toEqual(run());
  });

  it('深度门控：depth 1 抽 200 次不出 war_axe / plate_armor', () => {
    const rng = new Rng(1);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(rollLoot(1, rng).catalogId);
    expect(seen.has('war_axe')).toBe(false);
    expect(seen.has('plate_armor')).toBe(false);
    // 浅层应能见到入门装备与常规消耗品
    expect(seen.has('dagger')).toBe(true);
    expect(seen.has('minor_healing')).toBe(true);
  });

  it('深度越高，高级战利品（高阶装备与高级药水）越常见', () => {
    // 统计"高阶装备（bonus ≥ 2）+ 治疗药水"的出现次数；深度 1 池中不含任何高阶装备
    const countAdvanced = (depth: number, seed: number) => {
      const rng = new Rng(seed);
      let count = 0;
      for (let i = 0; i < 2000; i++) {
        const def = itemDef(rollLoot(depth, rng));
        const isTier2Gear = (def.category === 'weapon' || def.category === 'armor') && (def.bonus ?? 0) >= 2;
        if (isTier2Gear || def.catalogId === 'healing') count++;
      }
      return count;
    };
    expect(countAdvanced(5, 7)).toBeGreaterThan(countAdvanced(1, 7) * 2);
  });

  it('跨深度大量抽取可覆盖目录中所有物品', () => {
    const rng = new Rng(99);
    const seen = new Set<string>();
    for (let depth = 1; depth <= 5; depth++) {
      for (let i = 0; i < 300; i++) seen.add(rollLoot(depth, rng).catalogId);
    }
    expect([...seen].sort()).toEqual(Object.keys(ITEMS).sort());
  });

  it('返回的实例与目录定义自洽', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 100; i++) {
      const inst = rollLoot(2, rng);
      expect(itemDef(inst).catalogId).toBe(inst.catalogId);
      expect(inst.category).toBe(ITEMS[inst.catalogId]?.category);
    }
  });
});
