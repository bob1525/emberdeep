import type { Rng } from './rng';

export interface AttackReport {
  attackerName: string;
  defenderName: string;
  /** 实际造成的伤害（≥1） */
  damage: number;
  /** 防御者是否被击杀 */
  killed: boolean;
}

/**
 * 一次近战攻击的纯数学结算：
 * 伤害 = max(1, 攻击力 + 掷数[0..2] - 防御力)，攻击必中。
 * 武器/护甲加成由游戏层在调用前折算进 attack / defense。
 */
export function resolveAttack(opts: {
  attackerName: string;
  attack: number;
  defenderName: string;
  defense: number;
  defenderHp: number;
  rng: Rng;
}): AttackReport {
  const damage = Math.max(1, opts.attack + opts.rng.int(0, 2) - opts.defense);
  const remainingHp = opts.defenderHp - damage;
  return {
    attackerName: opts.attackerName,
    defenderName: opts.defenderName,
    damage,
    killed: remainingHp <= 0,
  };
}
