import { describe, expect, it } from 'vitest';
import { RANGED } from '../src/engine/ranged';
import { Rng } from '../src/engine/rng';
import { ITEMS } from '../src/items/catalog';
import { SHRINES, resolveAltar, resolveWell } from '../src/world/shrines';
import type { AltarReport, WellReport } from '../src/world/shrines';

/** 祝福的合法载荷集合（kind/turns/power 与契约一致） */
const VALID_BLESSINGS: ReadonlyArray<{ kind: string; turns: number; power: number }> = [
  { kind: 'might', turns: 30, power: 3 },
  { kind: 'shield', turns: 25, power: 2 },
  { kind: 'regeneration', turns: 12, power: 1 },
];

/** 诅咒的合法载荷集合 */
const VALID_CURSES: ReadonlyArray<{ kind: string; turns: number; power: number }> = [
  { kind: 'poison', turns: 8, power: 2 },
  { kind: 'slow', turns: 10, power: 0 },
];

/** 载荷是否命中合法集合之一（kind/turns/power 全等） */
function matchesAny(
  payload: { kind: string; turns: number; power: number },
  table: ReadonlyArray<{ kind: string; turns: number; power: number }>,
): boolean {
  return table.some((e) => e.kind === payload.kind && e.turns === payload.turns && e.power === payload.power);
}

/** 祭坛命中的结果档数（祝福/诅咒/回满血三档互斥，应恒为 1） */
function altarTierCount(r: AltarReport): number {
  return (r.blessing !== null ? 1 : 0) + (r.curse !== null ? 1 : 0) + (r.fullHeal ? 1 : 0);
}

/** 许愿井命中的结果档数（治愈/捞物/无事/惹怒四档互斥，应恒为 1） */
function wellTierCount(r: WellReport): number {
  return (r.heal ? 1 : 0) + (r.item !== null ? 1 : 0) + (r.nothing ? 1 : 0) + (r.angered ? 1 : 0);
}

describe('SHRINES 目录', () => {
  it('祭坛与许愿井齐全，名称/glyph/颜色正确', () => {
    expect(Object.keys(SHRINES).sort()).toEqual(['altar', 'well']);
    expect(SHRINES.altar.kind).toBe('altar');
    expect(SHRINES.altar.name).toBe('献祭祭坛');
    expect(SHRINES.altar.glyph).toBe('Ω');
    expect(SHRINES.well.kind).toBe('well');
    expect(SHRINES.well.name).toBe('许愿井');
    expect(SHRINES.well.glyph).toBe('U');
    for (const def of Object.values(SHRINES)) {
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.glyph.length).toBeGreaterThan(0);
      expect(def.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('glyph 与物品/楼梯/墙体常用符号错开，两者互不相同', () => {
    const glyphs = Object.values(SHRINES).map((def) => def.glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
    for (const g of glyphs) {
      expect(['!', '?', '/', '[', '>', '#', '·', '@']).not.toContain(g);
    }
  });

  it('定义对象冻结为只读', () => {
    expect(Object.isFrozen(SHRINES.altar)).toBe(true);
    expect(Object.isFrozen(SHRINES.well)).toBe(true);
  });
});

describe('resolveAltar', () => {
  it('同种子下完全可复现（含不同 maxHp）', () => {
    for (const maxHp of [22, 30, 40]) {
      expect(resolveAltar(maxHp, new Rng(42))).toEqual(resolveAltar(maxHp, new Rng(42)));
      expect(resolveAltar(maxHp, new Rng(12345))).toEqual(resolveAltar(maxHp, new Rng(12345)));
    }
  });

  it('cost = ceil(maxHp * 0.3)，与结果档位无关', () => {
    for (const maxHp of [0, 1, 7, 10, 22, 30, 33, 100]) {
      for (let seed = 1; seed <= 20; seed++) {
        expect(resolveAltar(maxHp, new Rng(seed)).cost).toBe(Math.ceil(maxHp * 0.3));
      }
    }
  });

  it('三档结果互斥，且至少命中一档', () => {
    for (let seed = 1; seed <= 200; seed++) {
      expect(altarTierCount(resolveAltar(30, new Rng(seed)))).toBe(1);
    }
  });

  it('祝福/诅咒载荷合法，且三种祝福与两种诅咒都能出现', () => {
    const seenBlessings = new Set<string>();
    const seenCurses = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const r = resolveAltar(30, new Rng(seed));
      if (r.blessing) {
        expect(matchesAny(r.blessing, VALID_BLESSINGS)).toBe(true);
        seenBlessings.add(r.blessing.kind);
      }
      if (r.curse) {
        expect(matchesAny(r.curse, VALID_CURSES)).toBe(true);
        seenCurses.add(r.curse.kind);
      }
    }
    expect(seenBlessings).toEqual(new Set(['might', 'shield', 'regeneration']));
    expect(seenCurses).toEqual(new Set(['poison', 'slow']));
  });

  it('message 为中文事件文本：含献祭代价，祝福/诅咒含持续回合，回满血含深渊感念', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = resolveAltar(30, new Rng(seed));
      expect(r.message).toContain(`${r.cost} 点生命`);
      expect(r.message.length).toBeGreaterThan(10);
      if (r.blessing) expect(r.message).toContain(`持续 ${r.blessing.turns} 回合`);
      if (r.curse) expect(r.message).toContain(`持续 ${r.curse.turns} 回合`);
      if (r.fullHeal) expect(r.message).toContain('深渊感念你的勇气');
    }
  });

  it('返回的 blessing 是独立副本，篡改不污染祝福池', () => {
    let seed = 1;
    let blessing = resolveAltar(30, new Rng(seed)).blessing;
    while (!blessing) {
      seed += 1;
      blessing = resolveAltar(30, new Rng(seed)).blessing;
    }
    const pristine = { ...blessing };
    blessing.turns = 999;
    expect(resolveAltar(30, new Rng(seed)).blessing).toEqual(pristine);
  });
});

describe('resolveAltar 概率分布', () => {
  it('600 次抽样落在 60/25/15 的容差边界内（±10 / ±8 / ±6 个百分点）', () => {
    const rng = new Rng(20241101);
    let blessing = 0;
    let curse = 0;
    let fullHeal = 0;
    for (let i = 0; i < 600; i++) {
      const r = resolveAltar(30, rng);
      if (r.blessing) blessing += 1;
      else if (r.curse) curse += 1;
      else fullHeal += 1;
    }
    expect(blessing).toBeGreaterThanOrEqual(300); // 期望 360（60%），±10pp
    expect(blessing).toBeLessThanOrEqual(420);
    expect(curse).toBeGreaterThanOrEqual(102); // 期望 150（25%），±8pp
    expect(curse).toBeLessThanOrEqual(198);
    expect(fullHeal).toBeGreaterThanOrEqual(54); // 期望 90（15%），±6pp
    expect(fullHeal).toBeLessThanOrEqual(126);
  });
});

describe('resolveWell', () => {
  it('同种子下完全可复现', () => {
    expect(resolveWell(new Rng(7))).toEqual(resolveWell(new Rng(7)));
    expect(resolveWell(new Rng(12345))).toEqual(resolveWell(new Rng(12345)));
  });

  it('goldCost 恒为 25', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 100; i++) {
      expect(resolveWell(rng).goldCost).toBe(25);
    }
  });

  it('四档结果互斥，恰好命中一档', () => {
    for (let seed = 1; seed <= 200; seed++) {
      expect(wellTierCount(resolveWell(new Rng(seed)))).toBe(1);
    }
  });

  it('message 为非空中文事件文本', () => {
    const rng = new Rng(2);
    for (let i = 0; i < 100; i++) {
      expect(resolveWell(rng).message.length).toBeGreaterThan(6);
    }
  });

  it('捞到的物品：类别合法且 catalogId 存在于对应目录（ITEMS / RANGED），文案含物品名', () => {
    const rng = new Rng(777);
    const seenCategories = new Set<string>();
    for (let i = 0; i < 600; i++) {
      const r = resolveWell(rng);
      if (!r.item) continue;
      seenCategories.add(r.item.category);
      if (r.item.category === 'ranged') {
        const def = RANGED[r.item.catalogId];
        expect(def).toBeDefined();
        expect(r.message).toContain(def?.name ?? r.item.catalogId);
      } else {
        const def = ITEMS[r.item.catalogId];
        expect(def).toBeDefined();
        expect(def?.category).toBe(r.item.category);
        expect(r.message).toContain(def?.name ?? r.item.catalogId);
      }
    }
    // 五类物品在 600 次里都会出现（最稀有的类别出现率约 11%，缺席概率 ~1e-9）
    expect(seenCategories.size).toBe(5);
  });

  it('药水/卷轴为主（池权重约 2:1），装备与远程偶尔出现', () => {
    const rng = new Rng(888);
    let consumable = 0;
    let gear = 0;
    for (let i = 0; i < 600; i++) {
      const item = resolveWell(rng).item;
      if (!item) continue;
      if (item.category === 'potion' || item.category === 'scroll') consumable += 1;
      else gear += 1;
    }
    expect(consumable).toBeGreaterThan(gear * 1.5); // 池权重：消耗品 23 / 装备+远程 11
  });

  it('返回的 item 是独立副本，篡改不污染井池', () => {
    let seed = 1;
    let item = resolveWell(new Rng(seed)).item;
    while (!item) {
      seed += 1;
      item = resolveWell(new Rng(seed)).item;
    }
    const pristine = { ...item };
    item.catalogId = 'nonexistent';
    expect(resolveWell(new Rng(seed)).item).toEqual(pristine);
  });
});

describe('resolveWell 概率分布', () => {
  it('600 次抽样落在 40/30/20/10 的容差边界内（±10 个百分点）', () => {
    const rng = new Rng(20241102);
    let heal = 0;
    let item = 0;
    let nothing = 0;
    let angered = 0;
    for (let i = 0; i < 600; i++) {
      const r = resolveWell(rng);
      if (r.heal) heal += 1;
      else if (r.item) item += 1;
      else if (r.nothing) nothing += 1;
      else angered += 1;
    }
    expect(heal).toBeGreaterThanOrEqual(180); // 期望 240（40%），±10pp
    expect(heal).toBeLessThanOrEqual(300);
    expect(item).toBeGreaterThanOrEqual(120); // 期望 180（30%），±10pp
    expect(item).toBeLessThanOrEqual(240);
    expect(nothing).toBeGreaterThanOrEqual(60); // 期望 120（20%），±10pp
    expect(nothing).toBeLessThanOrEqual(180);
    expect(angered).toBeGreaterThanOrEqual(0); // 期望 60（10%），±10pp
    expect(angered).toBeLessThanOrEqual(120);
  });
});
