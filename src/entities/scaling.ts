/**
 * ENDLESS 深度缩放（里程碑 5）。
 * 设计决策：depth > 5 后每层 HP +12%、攻击 +8%（整数化）；
 * 20 层起出现精英词缀怪（×1.5 属性、×2 经验）；
 * Boss 在超过其 minDepth 后按每层差 +12% 缩放重复登场。
 */

export function depthHpMultiplier(depth: number): number {
  const over = Math.max(0, Math.floor(depth) - 5);
  return 1 + over * 0.12;
}

export function depthAttackMultiplier(depth: number): number {
  const over = Math.max(0, Math.floor(depth) - 5);
  return 1 + over * 0.08;
}

export function scaleHp(base: number, depth: number): number {
  return Math.max(1, Math.round(base * depthHpMultiplier(depth)));
}

export function scaleAttack(base: number, depth: number): number {
  return Math.max(1, Math.round(base * depthAttackMultiplier(depth)));
}

export function isEliteDepth(depth: number): boolean {
  return Math.floor(depth) >= 20;
}

/** 精英词缀：20 层起按概率出现的强化变体 */
export interface EliteVariant {
  name: string;
  hpFactor: number;
  attackFactor: number;
  xpFactor: number;
}

export function rollElite(depth: number, rngRoll: number): EliteVariant | null {
  if (!isEliteDepth(depth)) return null;
  if (rngRoll >= 0.3) return null;
  return { name: '精英', hpFactor: 1.5, attackFactor: 1.4, xpFactor: 2 };
}
