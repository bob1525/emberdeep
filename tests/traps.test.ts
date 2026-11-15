import { describe, expect, it } from 'vitest';
import type { Pt } from '../src/engine/los';
import { Rng } from '../src/engine/rng';
import { TRAPS, rollTraps, triggerTrap } from '../src/world/traps';
import type { TrapKind } from '../src/world/traps';

/** 生成 w×h 网格的全部格点，作为候选地板格 */
function gridCandidates(w: number, h: number): Pt[] {
  const pts: Pt[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      pts.push({ x, y });
    }
  }
  return pts;
}

describe('TRAPS 目录', () => {
  it('四种陷阱齐全且字段完整', () => {
    const kinds: TrapKind[] = ['spikes', 'poisonGas', 'teleportRune', 'flameJet'];
    expect(Object.keys(TRAPS).sort()).toEqual([...kinds].sort());
    for (const kind of kinds) {
      const def = TRAPS[kind];
      expect(def.kind).toBe(kind);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.glyph.length).toBeGreaterThan(0);
      expect(def.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(Number.isInteger(def.minDepth)).toBe(true);
      expect(def.minDepth).toBeGreaterThanOrEqual(1);
    }
  });

  it('中文名固定', () => {
    expect(TRAPS.spikes.name).toBe('地刺');
    expect(TRAPS.poisonGas.name).toBe('毒雾符文');
    expect(TRAPS.teleportRune.name).toBe('传送符文');
    expect(TRAPS.flameJet.name).toBe('火焰喷口');
  });

  it('glyph 互不相同，且与怪物/物品/楼梯/墙体常用符号错开', () => {
    const glyphs = Object.values(TRAPS).map((def) => def.glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
    for (const g of glyphs) {
      expect(['!', '?', '/', '[', '>', '#', '·', '@']).not.toContain(g);
    }
  });
});

describe('rollTraps', () => {
  const candidates = gridCandidates(10, 10);

  it('同种子下完全可复现', () => {
    const run = () => rollTraps(3, 8, candidates, new Rng(42));
    expect(run()).toEqual(run());
  });

  it('数量合规：实际放置数取 count 与候选数的较小者', () => {
    expect(rollTraps(2, 5, candidates.slice(0, 3), new Rng(1))).toHaveLength(3);
    expect(rollTraps(2, 7, candidates, new Rng(1))).toHaveLength(7);
    expect(rollTraps(2, 0, candidates, new Rng(1))).toHaveLength(0);
    expect(rollTraps(2, 5, [], new Rng(1))).toHaveLength(0);
  });

  it('不放回：位置互不重复', () => {
    for (const seed of [1, 7, 99]) {
      const traps = rollTraps(3, 12, candidates, new Rng(seed));
      const keys = traps.map((t) => `${t.x},${t.y}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('minDepth 门控：1 层不出火焰喷口，深层四种都会出现', () => {
    const shallow = rollTraps(1, 30, candidates, new Rng(5));
    expect(shallow).toHaveLength(30);
    expect(shallow.some((t) => t.kind === 'flameJet')).toBe(false);

    // 深层多种子抽 300 个，等权 1/4 下任一种类全缺席的概率 ~1e-37，实际必然齐活
    const seen = new Set<TrapKind>();
    for (let seed = 1; seen.size < 4 && seed <= 50; seed++) {
      for (const t of rollTraps(4, 6, candidates, new Rng(seed))) {
        seen.add(t.kind);
      }
    }
    expect(seen.size).toBe(4);
  });

  it('全部落在候选格内', () => {
    const traps = rollTraps(2, 9, candidates, new Rng(11));
    const allowed = new Set(candidates.map((p) => `${p.x},${p.y}`));
    for (const t of traps) {
      expect(allowed.has(`${t.x},${t.y}`)).toBe(true);
    }
  });
});

describe('triggerTrap', () => {
  it('同种子下完全可复现', () => {
    const kinds: TrapKind[] = ['spikes', 'poisonGas', 'teleportRune', 'flameJet'];
    const run = (seed: number) => {
      const rng = new Rng(seed);
      return kinds.map((kind) => triggerTrap(kind, rng).damage);
    };
    expect(run(77)).toEqual(run(77));
  });

  it('地刺：伤害 2-4，无状态，不传送', () => {
    // 第二轮早期死亡率收敛（work/sim-analysis-round2.md）：3-6→2-4，
    // 削减自动探索批次内无法反应的被动消耗
    const rng = new Rng(9);
    for (let i = 0; i < 300; i++) {
      const r = triggerTrap('spikes', rng);
      expect(r.kind).toBe('spikes');
      expect(r.damage).toBeGreaterThanOrEqual(2);
      expect(r.damage).toBeLessThanOrEqual(4);
      expect(r.status).toBeNull();
      expect(r.teleport).toBe(false);
      expect(r.message.length).toBeGreaterThan(0);
    }
  });

  it('火焰喷口：伤害 4-8 且附加燃烧（3 回合 power 2）', () => {
    const rng = new Rng(9);
    const rolled = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const r = triggerTrap('flameJet', rng);
      expect(r.kind).toBe('flameJet');
      expect(r.damage).toBeGreaterThanOrEqual(4);
      expect(r.damage).toBeLessThanOrEqual(8);
      rolled.add(r.damage);
      expect(r.status).toEqual({ kind: 'burn', turns: 3, power: 2 });
      expect(r.teleport).toBe(false);
      expect(r.message.length).toBeGreaterThan(0);
    }
    expect(rolled.size).toBe(5); // 4..8 每个值都掷到过
  });

  it('毒雾符文：无直接伤害，附加中毒（5 回合 power 1）', () => {
    // 第二轮早期死亡率收敛（work/sim-analysis-round2.md）：毒雾总伤 10→5，
    // 保持 5 回合持续压力、减半对脆皮的消耗爆发
    const r = triggerTrap('poisonGas', new Rng(3));
    expect(r.kind).toBe('poisonGas');
    expect(r.damage).toBe(0);
    expect(r.status).toEqual({ kind: 'poison', turns: 5, power: 1 });
    expect(r.teleport).toBe(false);
    expect(r.message.length).toBeGreaterThan(0);
  });

  it('传送符文：teleport = true，无伤害无状态', () => {
    const r = triggerTrap('teleportRune', new Rng(3));
    expect(r.kind).toBe('teleportRune');
    expect(r.teleport).toBe(true);
    expect(r.damage).toBe(0);
    expect(r.status).toBeNull();
    expect(r.message.length).toBeGreaterThan(0);
  });
});
