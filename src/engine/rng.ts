/**
 * mulberry32 — 小而快的可播种 PRNG。
 * 可播种意味着同一颗种子生成完全相同的地牢，便于调试、测试和未来的"每日挑战"。
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** 返回 [0, 1) 的浮点数 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 返回 [min, max] 闭区间内的随机整数 */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** 从非空数组中随机取一个元素 */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick(): 数组为空');
    return items[this.int(0, items.length - 1)] as T;
  }

  /** 导出内部状态，用于存档 */
  snapshot(): number {
    return this.state;
  }

  /** 从存档恢复内部状态 */
  static fromState(state: number): Rng {
    const rng = new Rng(0);
    rng.state = state >>> 0;
    return rng;
  }
}
