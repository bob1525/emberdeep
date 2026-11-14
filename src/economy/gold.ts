/**
 * 金币经济 — 掉落金币堆的随机数学。纯逻辑，无 UI；
 * 商人定价与货架抽取见 merchant.ts。全部随机走 Rng，同种子完全可复现。
 */
import type { Rng } from '../engine/rng';

/** 把深度归一为安全整数：非有限值（NaN / ±∞）或 ≤0 回落到第 1 层（与 rollLoot 的防御式一致） */
function normalizeDepth(depth: number): number {
  return Number.isFinite(depth) ? Math.max(1, Math.floor(depth)) : 1;
}

/**
 * 掉落的金币堆：深度越高越丰厚。
 * 掷骰区间为闭区间 [5 + depth*3, 15 + depth*8]（depth 先经防御式归一）。
 * 消耗一次 rng 整数掷，同 rng 状态完全可复现。
 */
export function rollGold(depth: number, rng: Rng): number {
  const d = normalizeDepth(depth);
  return rng.int(5 + d * 3, 15 + d * 8);
}
