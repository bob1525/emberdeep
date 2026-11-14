import { describe, expect, it } from 'vitest';
import type { BossDef, BossPhase, BossSpecial, BossSpecialReport } from '../src/entities/bosses';
import { BOSSES, bossForDepth, decideBossSpecial, phaseForHp } from '../src/entities/bosses';
import { Rng } from '../src/engine/rng';

/** 合法特技种类全集 */
const ALL_SPECIALS: readonly BossSpecial[] = ['summon', 'aoe', 'haste', 'heal'];

/** 按 species 取 Boss 定义（缺失即测试环境异常） */
function bossOf(species: string): BossDef {
  const boss = BOSSES.find((b) => b.species === species);
  if (!boss) throw new Error(`图鉴中缺少 Boss "${species}"`);
  return boss;
}

/** 取指定下标的阶段（越界即测试环境异常） */
function phaseAt(boss: BossDef, index: number): BossPhase {
  const phase = boss.phases[index];
  if (!phase) throw new Error(`${boss.species} 缺少第 ${index + 1} 个阶段`);
  return phase;
}

describe('Boss 图鉴完整性', () => {
  it('恰好三位 Boss，species 唯一且按楼层升序排列（越深越强）', () => {
    expect(BOSSES).toHaveLength(3);
    expect(BOSSES.map((b) => b.species)).toEqual(['ember_lord', 'abyss_beast', 'ash_king']);
    let prev: BossDef | null = null;
    for (const boss of BOSSES) {
      if (prev) {
        expect(boss.minDepth).toBeGreaterThan(prev.minDepth);
        expect(boss.maxHp).toBeGreaterThan(prev.maxHp);
        expect(boss.attack).toBeGreaterThan(prev.attack);
        expect(boss.defense).toBeGreaterThan(prev.defense);
        expect(boss.xpValue).toBeGreaterThan(prev.xpValue);
      }
      prev = boss;
    }
  });

  it('中文名/演出文本/外观齐全，数值为正且 minDepth 对齐 5 的倍数', () => {
    expect(bossOf('ember_lord').name).toBe('余烬领主');
    expect(bossOf('abyss_beast').name).toBe('深渊巨兽');
    expect(bossOf('ash_king').name).toBe('灰烬之王');
    for (const boss of BOSSES) {
      expect(boss.name.trim().length).toBeGreaterThan(0);
      expect(boss.introText.trim().length).toBeGreaterThan(0);
      expect(boss.deathText.trim().length).toBeGreaterThan(0);
      expect(boss.glyph.length).toBe(1);
      expect(boss.color.trim().length).toBeGreaterThan(0);
      expect(boss.maxHp).toBeGreaterThan(0);
      expect(boss.attack).toBeGreaterThan(0);
      expect(boss.defense).toBeGreaterThanOrEqual(0);
      expect(boss.xpValue).toBeGreaterThan(0);
      expect(boss.senseRadius).toBeGreaterThan(0);
      expect(boss.minDepth).toBeGreaterThan(0);
      expect(boss.minDepth % 5).toBe(0);
    }
    // 关键数值锚点（对照设计表：90/150/220 血，5/10/15 层）
    expect(bossOf('ember_lord').maxHp).toBe(90);
    expect(bossOf('abyss_beast').maxHp).toBe(150);
    expect(bossOf('ash_king').maxHp).toBe(220);
    expect(bossOf('ember_lord').minDepth).toBe(5);
    expect(bossOf('abyss_beast').minDepth).toBe(10);
    expect(bossOf('ash_king').minDepth).toBe(15);
  });

  it('阶段设计合法：2-3 个阶段，阈值从 1 严格递减且末位 ≤ 0.2，特技种类合法', () => {
    for (const boss of BOSSES) {
      expect(boss.phases.length).toBeGreaterThanOrEqual(2);
      expect(boss.phases.length).toBeLessThanOrEqual(3);
      expect(phaseAt(boss, 0).hpThreshold).toBe(1);
      for (let i = 1; i < boss.phases.length; i++) {
        expect(phaseAt(boss, i).hpThreshold).toBeLessThan(phaseAt(boss, i - 1).hpThreshold);
      }
      expect(phaseAt(boss, boss.phases.length - 1).hpThreshold).toBeLessThanOrEqual(0.2);
      for (const phase of boss.phases) {
        expect(ALL_SPECIALS).toContain(phase.special);
      }
    }
  });

  it('主特技符合设计：领主召唤、巨兽冲击波、之王回复', () => {
    expect(phaseAt(bossOf('ember_lord'), 0).special).toBe('summon');
    expect(phaseAt(bossOf('abyss_beast'), 0).special).toBe('aoe');
    expect(phaseAt(bossOf('ash_king'), 0).special).toBe('heal');
  });

  it('xpValue 达到普通精英 4-6 倍量级（≥ 60）', () => {
    for (const boss of BOSSES) {
      expect(boss.xpValue).toBeGreaterThanOrEqual(60);
    }
    expect(bossOf('ember_lord').xpValue).toBe(90);
    expect(bossOf('abyss_beast').xpValue).toBe(140);
    expect(bossOf('ash_king').xpValue).toBe(190);
  });

  it('目录冻结为只读（含嵌套阶段数组与阶段对象）', () => {
    expect(Object.isFrozen(BOSSES)).toBe(true);
    for (const boss of BOSSES) {
      expect(Object.isFrozen(boss)).toBe(true);
      expect(Object.isFrozen(boss.phases)).toBe(true);
      for (const phase of boss.phases) {
        expect(Object.isFrozen(phase)).toBe(true);
      }
    }
  });
});

describe('bossForDepth', () => {
  it('depth 5/10/15 分别命中对应 Boss，且返回图鉴定义本体', () => {
    expect(bossForDepth(5)).toBe(bossOf('ember_lord'));
    expect(bossForDepth(10)).toBe(bossOf('abyss_beast'));
    expect(bossForDepth(15)).toBe(bossOf('ash_king'));
  });

  it('更深的整 5 倍数层沿用最深守关者（20/25 → 灰烬之王）', () => {
    expect(bossForDepth(20)?.species).toBe('ash_king');
    expect(bossForDepth(25)?.species).toBe('ash_king');
  });

  it('非 5 的倍数层与越界层返回 null（1/3/7/12/0/-5/NaN）', () => {
    for (const depth of [1, 3, 7, 12, 0, -5, Number.NaN]) {
      expect(bossForDepth(depth)).toBeNull();
    }
  });
});

describe('decideBossSpecial', () => {
  // 固定阶段样本：满血召唤阶段 / 半血冲击波阶段
  const SUMMON_PHASE: BossPhase = { hpThreshold: 1, attackBonus: 0, special: 'summon' };
  const AOE_PHASE: BossPhase = { hpThreshold: 0.5, attackBonus: 0, special: 'aoe' };

  it('同种子下决策序列完全可复现（含普通攻击与特技）', () => {
    const runSummon = () => {
      const rng = new Rng(2024);
      return Array.from({ length: 60 }, () => decideBossSpecial(SUMMON_PHASE, rng));
    };
    expect(runSummon()).toEqual(runSummon());

    const runAoe = () => {
      const rng = new Rng(777);
      return Array.from({ length: 60 }, () => decideBossSpecial(AOE_PHASE, rng));
    };
    expect(runAoe()).toEqual(runAoe());
  });

  it('普通攻击约占 70%（600 次统计，±10% 以内），特技确实会出现', () => {
    const rng = new Rng(11);
    let none = 0;
    let special = 0;
    for (let i = 0; i < 600; i++) {
      const report = decideBossSpecial(SUMMON_PHASE, rng);
      if (report.kind === 'none') none++;
      else special++;
    }
    expect(none).toBeGreaterThanOrEqual(360); // 70% - 10%
    expect(none).toBeLessThanOrEqual(480); // 70% + 10%
    expect(special).toBeGreaterThan(0);
  });

  it('普通攻击报告为零值占位（kind none / 无伤害 / 无召唤 / 空演出文本）', () => {
    const rng = new Rng(5);
    const reports: BossSpecialReport[] = [];
    for (let i = 0; i < 600 && !reports.some((r) => r.kind === 'none'); i++) {
      reports.push(decideBossSpecial(SUMMON_PHASE, rng));
    }
    const normal = reports.find((r) => r.kind === 'none');
    if (!normal) throw new Error('600 次内应出现普通攻击');
    expect(normal.damage).toBe(0);
    expect(normal.count).toBe(0);
    expect(normal.message).toBe('');
  });

  it('aoe 特技伤害落在 [6+加成, 10+加成]，且与攻击加成严格线性', () => {
    const collect = (attackBonus: number) => {
      const rng = new Rng(404);
      const damages: number[] = [];
      for (let i = 0; i < 400; i++) {
        const report = decideBossSpecial({ hpThreshold: 0.5, attackBonus, special: 'aoe' }, rng);
        if (report.kind === 'aoe') damages.push(report.damage);
      }
      return damages;
    };
    const base = collect(0);
    const boosted = collect(3);
    expect(base.length).toBeGreaterThan(50);
    expect(boosted).toHaveLength(base.length);
    for (const [i, dmg] of base.entries()) {
      expect(dmg).toBeGreaterThanOrEqual(6);
      expect(dmg).toBeLessThanOrEqual(10);
      expect(boosted[i]).toBe(dmg + 3);
    }
  });

  it('summon 特技召唤 1-2 只、无伤害，两种数量都会出现，演出文本含数量', () => {
    const rng = new Rng(88);
    const counts = new Set<number>();
    let specials = 0;
    for (let i = 0; i < 400; i++) {
      const report = decideBossSpecial(SUMMON_PHASE, rng);
      if (report.kind === 'none') continue;
      specials++;
      expect(report.kind).toBe('summon');
      expect(report.count).toBeGreaterThanOrEqual(1);
      expect(report.count).toBeLessThanOrEqual(2);
      expect(report.damage).toBe(0);
      expect(report.message).toContain(String(report.count));
      counts.add(report.count);
    }
    expect(specials).toBeGreaterThan(50);
    expect(counts.has(1)).toBe(true);
    expect(counts.has(2)).toBe(true);
  });

  it('haste / heal 特技零伤害零召唤，演出文本非空', () => {
    const hastePhase = phaseAt(bossOf('abyss_beast'), 2); // 残血阶段：haste
    const healPhase = phaseAt(bossOf('ash_king'), 0); // 满血阶段：heal
    for (const phase of [hastePhase, healPhase]) {
      const rng = new Rng(31);
      let found: BossSpecialReport | null = null;
      for (let i = 0; i < 600 && !found; i++) {
        const report = decideBossSpecial(phase, rng);
        if (report.kind !== 'none') found = report;
      }
      expect(found).not.toBeNull();
      if (found) {
        expect(found.kind).toBe(phase.special);
        expect(found.damage).toBe(0);
        expect(found.count).toBe(0);
        expect(found.message.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('phaseForHp', () => {
  it('满血返回首阶段，半血返回中阶段，残血/倒地返回末阶段（返回定义本体）', () => {
    for (const boss of BOSSES) {
      const first = phaseAt(boss, 0);
      const mid = phaseAt(boss, 1);
      const last = phaseAt(boss, boss.phases.length - 1);
      expect(phaseForHp(boss, boss.maxHp)).toBe(first);
      expect(phaseForHp(boss, Math.floor(boss.maxHp / 2))).toBe(mid);
      expect(phaseForHp(boss, Math.floor(boss.maxHp * 0.1))).toBe(last);
      expect(phaseForHp(boss, 0)).toBe(last);
    }
  });

  it('阈值边界：血量恰在阈值上归入更深阶段，超过 maxHp 收敛回首阶段', () => {
    const ash = bossOf('ash_king'); // 阈值 [1, 0.5, 0.15]
    expect(phaseForHp(ash, Math.floor(ash.maxHp * 0.15))).toBe(phaseAt(ash, 2));
    expect(phaseForHp(ash, Math.floor(ash.maxHp * 0.16))).toBe(phaseAt(ash, 1));
    expect(phaseForHp(ash, ash.maxHp * 3)).toBe(phaseAt(ash, 0));
    const ember = bossOf('ember_lord'); // 阈值 [1, 0.5, 0.2]
    expect(phaseForHp(ember, Math.floor(ember.maxHp * 0.2))).toBe(phaseAt(ember, 2));
  });

  it('阶段攻击加成随血量恶化严格递增（狂暴化）', () => {
    for (const boss of BOSSES) {
      expect(phaseAt(boss, 0).attackBonus).toBe(0);
      for (let i = 1; i < boss.phases.length; i++) {
        expect(phaseAt(boss, i).attackBonus).toBeGreaterThan(phaseAt(boss, i - 1).attackBonus);
      }
    }
  });

  it('血量从满到 0 逐点扫描，阶段序号单调不回退', () => {
    for (const boss of BOSSES) {
      let prevIdx = 0;
      for (let hp = boss.maxHp; hp >= 0; hp--) {
        const phase = phaseForHp(boss, hp);
        const idx = boss.phases.findIndex((p) => p === phase);
        expect(idx).toBeGreaterThanOrEqual(prevIdx);
        prevIdx = idx;
      }
    }
  });
});
