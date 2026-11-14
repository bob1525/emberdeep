import { describe, expect, it } from 'vitest';
import type { MonsterTemplate } from '../src/entities/monsters';
import { MONSTERS, monsterTable, rollMonster } from '../src/entities/monsters';
import { Rng } from '../src/engine/rng';

/** 各物种的解锁层数（与内容清单一致） */
const UNLOCK_DEPTH: Record<string, number> = {
  rat: 1,
  bat: 1,
  skeleton: 2,
  orc: 3,
  ogre: 4,
  ember_wraith: 5,
};

describe('怪物图鉴完整性', () => {
  const entries = Object.entries(MONSTERS);

  it('物种数量与内容清单一致，species 无重复且与键名一致', () => {
    expect(entries).toHaveLength(6);
    const ids = entries.map(([id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [id, tpl] of entries) {
      expect(tpl.species).toBe(id);
      expect(Object.keys(UNLOCK_DEPTH)).toContain(id);
    }
  });

  it('中文名与图鉴清单一致', () => {
    expect(MONSTERS['rat']?.name).toBe('鼠人');
    expect(MONSTERS['bat']?.name).toBe('巨蝠');
    expect(MONSTERS['skeleton']?.name).toBe('骷髅兵');
    expect(MONSTERS['orc']?.name).toBe('兽人');
    expect(MONSTERS['ogre']?.name).toBe('食人魔');
    expect(MONSTERS['ember_wraith']?.name).toBe('余烬幽魂');
  });

  it('模板字段合法：名称/字符/颜色非空，数值为正', () => {
    for (const [, tpl] of entries) {
      expect(tpl.name.trim().length).toBeGreaterThan(0);
      expect(tpl.glyph.length).toBe(1);
      expect(tpl.color.trim().length).toBeGreaterThan(0);
      expect(tpl.maxHp).toBeGreaterThan(0);
      expect(tpl.attack).toBeGreaterThan(0);
      expect(tpl.defense).toBeGreaterThanOrEqual(0);
      expect(tpl.xpValue).toBeGreaterThan(0);
      expect(tpl.senseRadius).toBeGreaterThan(0);
    }
  });

  it('xpValue 与综合强度正相关（按经验排序 = 按综合战力排序）', () => {
    const power = (t: MonsterTemplate) => t.maxHp + t.attack * 3 + t.defense * 2;
    const byXp = [...entries].sort((a, b) => a[1].xpValue - b[1].xpValue);
    const byPower = [...entries].sort((a, b) => power(a[1]) - power(b[1]));
    expect(byXp.map(([id]) => id)).toEqual(byPower.map(([id]) => id));
  });

  it('深层物种全面不弱于浅层物种（生命/攻击/防御/经验/感知）', () => {
    for (const [aId, a] of entries) {
      for (const [bId, b] of entries) {
        if ((UNLOCK_DEPTH[aId] ?? 0) < (UNLOCK_DEPTH[bId] ?? 0)) {
          expect(b.maxHp).toBeGreaterThanOrEqual(a.maxHp);
          expect(b.attack).toBeGreaterThanOrEqual(a.attack);
          expect(b.defense).toBeGreaterThanOrEqual(a.defense);
          expect(b.xpValue).toBeGreaterThanOrEqual(a.xpValue);
          expect(b.senseRadius).toBeGreaterThanOrEqual(a.senseRadius);
        }
      }
    }
  });

  it('同层物种存在定位梯度（鼠人皮厚，巨蝠敏捷且感知更远）', () => {
    const rat = MONSTERS['rat'];
    const bat = MONSTERS['bat'];
    expect(rat).toBeDefined();
    expect(bat).toBeDefined();
    if (rat && bat) {
      expect(rat.maxHp).toBeGreaterThan(bat.maxHp);
      expect(bat.attack).toBeGreaterThan(rat.attack);
      expect(bat.senseRadius).toBeGreaterThan(rat.senseRadius);
      expect(bat.xpValue).toBeGreaterThan(rat.xpValue);
    }
  });
});

describe('monsterTable', () => {
  it('depth 1 只有 rat/bat；逐层按清单解锁更强物种', () => {
    expect(monsterTable(1)).toEqual(['rat', 'bat']);
    expect(monsterTable(2)).toContain('skeleton');
    expect(monsterTable(3)).toContain('orc');
    expect(monsterTable(4)).toContain('ogre');
    expect(monsterTable(5)).toContain('ember_wraith');
    expect(monsterTable(2)).toHaveLength(3);
    expect(monsterTable(3)).toHaveLength(4);
    expect(monsterTable(4)).toHaveLength(5);
    expect(monsterTable(5)).toHaveLength(6);
  });

  it('深度递增时物种只增不减', () => {
    let prev: string[] = [];
    for (let d = 1; d <= 5; d++) {
      const cur = monsterTable(d);
      for (const id of prev) expect(cur).toContain(id);
      expect(cur.length).toBeGreaterThan(prev.length);
      prev = cur;
    }
  });

  it('越界深度收敛到合法区间（0 / 负数 → 第 1 层，99 → 第 5 层）', () => {
    expect(monsterTable(0)).toEqual(monsterTable(1));
    expect(monsterTable(-3)).toEqual(monsterTable(1));
    expect(monsterTable(99)).toEqual(monsterTable(5));
  });

  it('每次调用返回独立副本，外部改动不污染出现表', () => {
    const a = monsterTable(1);
    a.push('hacker');
    expect(monsterTable(1)).not.toContain('hacker');
    expect(monsterTable(1)).toHaveLength(2);
  });
});

describe('rollMonster', () => {
  it('同 rng 种子下抽取序列完全可复现', () => {
    const run = () => {
      const rng = new Rng(42);
      return Array.from({ length: 50 }, () => rollMonster(3, rng).species);
    };
    expect(run()).toEqual(run());
  });

  it('返回值始终是图鉴中对应深度的模板', () => {
    for (let depth = 1; depth <= 5; depth++) {
      const table = monsterTable(depth);
      const rng = new Rng(depth * 1000 + 7);
      for (let i = 0; i < 200; i++) {
        const tpl = rollMonster(depth, rng);
        expect(table).toContain(tpl.species);
        // 直接返回图鉴模板本体，不做隐藏拷贝
        expect(tpl).toBe(MONSTERS[tpl.species]);
      }
    }
  });

  it('深度门控：depth 1 抽 200 次不出 ogre 等深层怪，且浅层两种怪都可能出现', () => {
    const rng = new Rng(11);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(rollMonster(1, rng).species);
    expect(seen.has('skeleton')).toBe(false);
    expect(seen.has('orc')).toBe(false);
    expect(seen.has('ogre')).toBe(false);
    expect(seen.has('ember_wraith')).toBe(false);
    expect(seen.has('rat')).toBe(true);
    expect(seen.has('bat')).toBe(true);
  });

  it('越深平均经验越高（强度随深度爬升）', () => {
    const avgXp = (depth: number) => {
      const rng = new Rng(77);
      let sum = 0;
      for (let i = 0; i < 400; i++) sum += rollMonster(depth, rng).xpValue;
      return sum / 400;
    };
    expect(avgXp(4)).toBeGreaterThan(avgXp(1));
    expect(avgXp(5)).toBeGreaterThan(avgXp(2));
  });
});
