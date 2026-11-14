import { describe, expect, it } from 'vitest';
import { RANGED } from '../src/engine/ranged';
import { Rng } from '../src/engine/rng';
import { rollGold } from '../src/economy/gold';
import { buyPrice, rollStock, sellPrice } from '../src/economy/merchant';
import type { StockEntry } from '../src/economy/merchant';
import { ITEMS } from '../src/items/catalog';

/** 全目录商品清单：ITEMS 与 RANGED 合并，用于遍历式断言 */
const ALL_GOODS: Array<{ catalogId: string; category: StockEntry['category'] }> = [];
for (const [id, def] of Object.entries(ITEMS)) {
  ALL_GOODS.push({ catalogId: id, category: def.category });
}
for (const id of Object.keys(RANGED)) {
  ALL_GOODS.push({ catalogId: id, category: 'ranged' });
}

describe('rollGold', () => {
  it('同 rng 种子下金币序列完全可复现', () => {
    const run = () => {
      const rng = new Rng(777);
      return Array.from({ length: 50 }, () => rollGold(4, rng));
    };
    expect(run()).toEqual(run());
  });

  it('每层金币都落在闭区间 [5 + depth*3, 15 + depth*8] 内', () => {
    const rng = new Rng(42);
    for (let depth = 1; depth <= 12; depth++) {
      const lo = 5 + depth * 3;
      const hi = 15 + depth * 8;
      for (let i = 0; i < 100; i++) {
        const gold = rollGold(depth, rng);
        expect(gold).toBeGreaterThanOrEqual(lo);
        expect(gold).toBeLessThanOrEqual(hi);
        expect(Number.isInteger(gold)).toBe(true);
      }
    }
  });

  it('深度越高金币越丰厚（期望值随深度显著上升）', () => {
    const mean = (depth: number, seed: number) => {
      const rng = new Rng(seed);
      let sum = 0;
      for (let i = 0; i < 2000; i++) sum += rollGold(depth, rng);
      return sum / 2000;
    };
    expect(mean(8, 7)).toBeGreaterThan(mean(2, 7) * 2);
  });
});

describe('rollStock', () => {
  it('同 rng 种子下货架（含价格）完全可复现', () => {
    const run = () => {
      const rng = new Rng(2026);
      return rollStock(3, rng);
    };
    expect(run()).toEqual(run());
  });

  it('货架数量恒为 4-6 件', () => {
    const rng = new Rng(11);
    for (let depth = 1; depth <= 10; depth++) {
      for (let i = 0; i < 30; i++) {
        expect(rollStock(depth, rng).length).toBeGreaterThanOrEqual(4);
        expect(rollStock(depth, rng).length).toBeLessThanOrEqual(6);
      }
    }
  });

  it('minDepth 门控：depth 1 的货架绝不含深层商品', () => {
    const rng = new Rng(5);
    const seen = new Set<string>();
    for (let i = 0; i < 80; i++) {
      for (const entry of rollStock(1, rng)) seen.add(entry.catalogId);
    }
    // 任务点名的三件 + 门控表中的 short_sword / chain_mail（minDepth 2）
    expect(seen.has('war_axe')).toBe(false);
    expect(seen.has('plate_armor')).toBe(false);
    expect(seen.has('long_bow')).toBe(false);
    expect(seen.has('short_sword')).toBe(false);
    expect(seen.has('chain_mail')).toBe(false);
    // 浅层货架应能见到入门商品
    expect(seen.has('dagger')).toBe(true);
    expect(seen.has('minor_healing')).toBe(true);
    expect(seen.has('short_bow')).toBe(true);
  });

  it('深层货架可覆盖两个目录的全部商品', () => {
    const rng = new Rng(9);
    const seen = new Set<string>();
    for (let depth = 3; depth <= 6; depth++) {
      for (let i = 0; i < 20; i++) {
        for (const entry of rollStock(depth, rng)) seen.add(entry.catalogId);
      }
    }
    expect([...seen].sort()).toEqual(ALL_GOODS.map((g) => g.catalogId).sort());
  });

  it('条目 price 与 buyPrice 一致，无重复商品', () => {
    const rng = new Rng(88);
    for (let depth = 1; depth <= 8; depth++) {
      for (let i = 0; i < 20; i++) {
        const stock = rollStock(depth, rng);
        const ids = stock.map((e) => e.catalogId);
        expect(new Set(ids).size).toBe(ids.length);
        for (const entry of stock) {
          expect(entry.price).toBe(buyPrice(entry.catalogId, entry.category, depth));
        }
      }
    }
  });

  it('条目 category 与所属目录匹配', () => {
    const rng = new Rng(123);
    for (let depth = 1; depth <= 8; depth++) {
      for (let i = 0; i < 20; i++) {
        for (const entry of rollStock(depth, rng)) {
          if (entry.category === 'ranged') {
            expect(RANGED[entry.catalogId]).toBeDefined();
          } else {
            expect(ITEMS[entry.catalogId]?.category).toBe(entry.category);
          }
        }
      }
    }
  });
});

describe('buyPrice', () => {
  it('随深度单调不减（对全目录每一件商品）', () => {
    for (const { catalogId, category } of ALL_GOODS) {
      for (let depth = 1; depth < 12; depth++) {
        expect(buyPrice(catalogId, category, depth + 1))
          .toBeGreaterThanOrEqual(buyPrice(catalogId, category, depth));
      }
    }
  });

  it('药水落在基准区间 [15, 30]，卷轴落在 [25, 40]', () => {
    for (const { catalogId, category } of ALL_GOODS) {
      const price = buyPrice(catalogId, category, 1);
      if (category === 'potion') {
        expect(price).toBeGreaterThanOrEqual(15);
        expect(price).toBeLessThanOrEqual(30);
      }
      if (category === 'scroll') {
        expect(price).toBeGreaterThanOrEqual(25);
        expect(price).toBeLessThanOrEqual(40);
      }
    }
  });

  it('定价 spot check：强度与深度系数符合公式', () => {
    // 药水/卷轴：基准 + 强度分，恒定
    expect(buyPrice('minor_healing', 'potion', 1)).toBe(18);
    expect(buyPrice('healing', 'potion', 7)).toBe(30);
    expect(buyPrice('might', 'potion', 1)).toBe(30);
    expect(buyPrice('teleport', 'scroll', 1)).toBe(28);
    expect(buyPrice('fireblast', 'scroll', 5)).toBe(33);
    // 武器/护甲：bonus × 25 × (1 + depth*0.1)
    expect(buyPrice('dagger', 'weapon', 1)).toBe(28); // 25 × 1.1 = 27.5 → 28
    expect(buyPrice('war_axe', 'weapon', 1)).toBe(138); // 125 × 1.1 = 137.5 → 138
    expect(buyPrice('war_axe', 'weapon', 3)).toBe(163); // 125 × 1.3 = 162.5 → 163
    expect(buyPrice('plate_armor', 'armor', 5)).toBe(150); // 100 × 1.5
    expect(buyPrice('chain_mail', 'armor', 2)).toBe(60); // 50 × 1.2
    // 远程：(伤害均值 × 6 + 射程 × 3) × 深度系数
    expect(buyPrice('short_bow', 'ranged', 1)).toBe(50); // (27 + 18) × 1.1 = 49.5 → 50
    expect(buyPrice('long_bow', 'ranged', 3)).toBe(90); // (42 + 27) × 1.3 = 89.7 → 90
    expect(buyPrice('throwing_knife', 'ranged', 1)).toBe(33); // (18 + 12) × 1.1
  });

  it('深度系数确实抬高装备与远程价格', () => {
    expect(buyPrice('war_axe', 'weapon', 3)).toBeGreaterThan(buyPrice('war_axe', 'weapon', 1));
    expect(buyPrice('long_bow', 'ranged', 3)).toBeGreaterThan(buyPrice('long_bow', 'ranged', 1));
    expect(buyPrice('plate_armor', 'armor', 5)).toBeGreaterThan(buyPrice('plate_armor', 'armor', 1));
  });

  it('未知 catalogId 或类别与目录不符时抛错', () => {
    expect(() => buyPrice('ghost_item', 'potion', 1)).toThrow();
    expect(() => buyPrice('ghost_bow', 'ranged', 1)).toThrow();
    expect(() => buyPrice('dagger', 'potion', 1)).toThrow();
    expect(() => buyPrice('short_bow', 'weapon', 1)).toThrow();
  });
});

describe('sellPrice', () => {
  it('恰为 floor(buyPrice × 0.4)（至少 1），对全目录各深度成立', () => {
    for (const { catalogId, category } of ALL_GOODS) {
      for (let depth = 1; depth <= 12; depth++) {
        const buy = buyPrice(catalogId, category, depth);
        expect(sellPrice(catalogId, category, depth)).toBe(Math.max(1, Math.floor(buy * 0.4)));
        expect(sellPrice(catalogId, category, depth)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('卖买差价合理：sell < buy（全目录各深度）', () => {
    for (const { catalogId, category } of ALL_GOODS) {
      for (let depth = 1; depth <= 12; depth++) {
        expect(sellPrice(catalogId, category, depth))
          .toBeLessThan(buyPrice(catalogId, category, depth));
      }
    }
  });

  it('卖出价 spot check', () => {
    expect(sellPrice('dagger', 'weapon', 1)).toBe(11); // floor(28 × 0.4)
    expect(sellPrice('minor_healing', 'potion', 1)).toBe(7); // floor(18 × 0.4)
    expect(sellPrice('short_bow', 'ranged', 1)).toBe(20); // floor(50 × 0.4)
  });
});
