import { describe, expect, it } from 'vitest';
import { resolveAttack } from '../src/engine/combat';
import { Rng } from '../src/engine/rng';

describe('resolveAttack', () => {
  it('伤害永远至少为 1（高防目标也能被磨死）', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) {
      const r = resolveAttack({
        attackerName: '你',
        attack: 2,
        defenderName: '石像',
        defense: 99,
        defenderHp: 10,
        rng,
      });
      expect(r.damage).toBeGreaterThanOrEqual(1);
    }
  });

  it('伤害落在期望区间', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 500; i++) {
      const r = resolveAttack({
        attackerName: '你',
        attack: 6,
        defenderName: '鼠人',
        defense: 1,
        defenderHp: 100,
        rng,
      });
      // 6 + [0..2] - 1 = 5..7
      expect(r.damage).toBeGreaterThanOrEqual(5);
      expect(r.damage).toBeLessThanOrEqual(7);
      expect(r.killed).toBe(false);
    }
  });

  it('致命一击返回 killed = true', () => {
    const r = resolveAttack({
      attackerName: '你',
      attack: 20,
      defenderName: '鼠人',
      defense: 0,
      defenderHp: 5,
      rng: new Rng(1),
    });
    expect(r.killed).toBe(true);
    expect(r.damage).toBeGreaterThanOrEqual(5);
  });

  it('同种子下结算完全可复现', () => {
    const run = (seed: number) => {
      const rng = new Rng(seed);
      return Array.from({ length: 10 }, () =>
        resolveAttack({
          attackerName: 'A',
          attack: 5,
          defenderName: 'B',
          defense: 2,
          defenderHp: 10,
          rng,
        }).damage,
      );
    };
    expect(run(77)).toEqual(run(77));
  });
});
