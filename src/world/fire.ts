/**
 * 火势蔓延模拟 — 元胞自动机（环境与实体双向耦合的核心）。
 * 纯结算模块：不改地形、不结算伤害、不写日志 —— 集成层根据 FireTickReport 的事件
 * 烧毁地形（burnOut → 换 tile）、对 isBurning 格上的实体结算 FIRE_TICK_DAMAGE、
 * 将 isSmoky 接入视线遮挡回调。
 *
 * 格子 key 由集成层编码（推荐 y * width + x）；八邻格 key 的换算依赖行宽 stride，
 * 见 tickFire 的第 4 个参数。
 */
import type { Rng } from '../engine/rng';

/** 站在火上的实体每回合受到的伤害（集成层结算） */
export const FIRE_TICK_DAMAGE = 3;

/** 烟雾标称存续回合数：燃烧格每回合刷新为该值，所有烟雾每回合衰减 1 */
export const SMOKE_LIFETIME = 12;

/** 基础蔓延概率：每个可燃未燃邻格每回合掷一次 rng.next */
export const BASE_SPREAD_CHANCE = 0.15;

/** 目标格是油渍（oil）时的额外蔓延概率（合计 0.30，即概率翻倍） */
export const OIL_SPREAD_BONUS = 0.15;

/** 默认行宽：本项目地图固定 80×45（MAP_WIDTH），y*width+x 编码下默认即正确 */
export const DEFAULT_KEY_STRIDE = 80;

export interface FireState {
  /** 燃烧中的格子 → 剩余燃烧回合 */
  fire: Map<number, number>;
  /** 烟雾格子 → 剩余消散回合 */
  smoke: Map<number, number>;
}

/** 新建空火势状态（开局 / 换层时调用） */
export function newFireState(): FireState {
  return { fire: new Map<number, number>(), smoke: new Map<number, number>() };
}

/**
 * 可燃物燃料表：tile 类型 → 点燃后的燃烧回合数。
 * wall / floor 等不可燃返回 0；door 木门 10 回合、烧得最久最易蔓延；
 * oil 油渍 6 回合且蔓延概率翻倍（油渍 tile 由集成层负责放置，本模块只认字符）。
 */
export function fuelOf(tile: string): number {
  if (tile === 'door') return 10;
  if (tile === 'oil') return 6;
  return 0;
}

/**
 * 点燃一格：燃料不足（fuelOf = 0）则无效；
 * 已在燃烧则保留更久的剩余回合（取 max），不会叠加。
 */
export function ignite(state: FireState, key: number, tile: string): void {
  const fuel = fuelOf(tile);
  if (fuel <= 0) return;
  const existing = state.fire.get(key) ?? 0;
  state.fire.set(key, Math.max(existing, fuel));
}

/** 手动扑灭一格的火（泼水 / 踩踏判定用）。烟雾不受影响，按剩余回合自然消散。 */
export function extinguish(state: FireState, key: number): void {
  state.fire.delete(key);
}

export interface FireEvent {
  kind: 'spread' | 'burnOut' | 'smokeStart' | 'smokeGone';
  key: number;
}

export interface FireTickReport {
  events: FireEvent[];
}

/** 八邻格偏移（dy 优先、dx 升序的固定顺序），保证 rng 消耗次序逐回合一致 */
const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/** 同格多种事件时的排序权重（按推演步骤先后：熄灭 → 蔓延 → 起烟 → 散烟） */
const KIND_ORDER: Record<FireEvent['kind'], number> = {
  burnOut: 0,
  spread: 1,
  smokeStart: 2,
  smokeGone: 3,
};

/**
 * 每回合推演（原地演化 state，返回事件报告）：
 * 1. 每个燃烧格剩余回合 -1，归零 → burnOut 事件并移除（燃料耗尽：本回合内不再
 *    蔓延 / 产烟，也不会被邻火复燃）；
 * 2. 幸存燃烧格向八邻格蔓延：邻格可燃（fuelOf > 0）、未燃烧且本回合未被点燃时，
 *    按概率 = 0.15 + (邻格是油渍 ? 0.15 : 0) 点燃（每个候选格恰掷一次 rng.next，
 *    不可燃格不掷）；
 * 3. 幸存燃烧格生成烟雾（SMOKE_LIFETIME 回合），已有烟则刷新（刷新不发 smokeStart）；
 *    本回合新点燃的格从下回合才开始递减 / 蔓延 / 产烟；
 * 4. 全部烟雾回合 -1（含刚生成的烟），归零 → smokeGone；
 * 5. 事件按 (key 升序、种类按推演顺序) 稳定排序返回。
 *
 * 确定性：燃烧 / 烟雾 key 显式排序、八邻偏移固定、候选格恰掷一次 ——
 * 同 state + 同 fuelAt + 同 rng 状态 → 完全相同的结果与 rng 消耗。
 *
 * @param stride key 行宽（y*width+x 编码中的 width），用于把八邻偏移换算成邻格 key。
 *               默认 80 = 本项目 MAP_WIDTH；测试或异形地图请显式传入。
 */
export function tickFire(
  state: FireState,
  fuelAt: (key: number) => string,
  rng: Rng,
  stride: number = DEFAULT_KEY_STRIDE,
): FireTickReport {
  const events: FireEvent[] = [];

  // 阶段 1：燃烧递减，烧尽者移除（显式排序保证遍历稳定）
  const burning = [...state.fire.keys()].sort((a, b) => a - b);
  const survivors: number[] = [];
  const burnedOut = new Set<number>();
  for (const key of burning) {
    const left = (state.fire.get(key) ?? 0) - 1;
    if (left <= 0) {
      state.fire.delete(key);
      burnedOut.add(key);
      events.push({ kind: 'burnOut', key });
    } else {
      state.fire.set(key, left);
      survivors.push(key);
    }
  }

  // 阶段 2：蔓延（只考察本回合开始时就在燃烧且未烧尽的格子；新点燃者下回合才行动）
  const fresh = new Set<number>();
  for (const key of survivors) {
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nKey = key + dy * stride + dx;
      if (nKey === key) continue; // stride=1 的退化情形下跳过自身
      if (state.fire.has(nKey) || fresh.has(nKey) || burnedOut.has(nKey)) continue;
      const tile = fuelAt(nKey);
      const fuel = fuelOf(tile);
      if (fuel <= 0) continue; // 不可燃：不掷随机数
      const chance = BASE_SPREAD_CHANCE + (tile === 'oil' ? OIL_SPREAD_BONUS : 0);
      if (rng.next() < chance) {
        state.fire.set(nKey, fuel);
        fresh.add(nKey);
        events.push({ kind: 'spread', key: nKey });
      }
    }
  }

  // 阶段 3：产烟（幸存燃烧格；新起烟才发 smokeStart，刷新不发）
  for (const key of survivors) {
    const hadSmoke = state.smoke.has(key);
    state.smoke.set(key, SMOKE_LIFETIME);
    if (!hadSmoke) events.push({ kind: 'smokeStart', key });
  }

  // 阶段 4：烟雾衰减（含刚生成的烟：先置满再衰减）
  const smokyKeys = [...state.smoke.keys()].sort((a, b) => a - b);
  for (const key of smokyKeys) {
    const left = (state.smoke.get(key) ?? 0) - 1;
    if (left <= 0) {
      state.smoke.delete(key);
      events.push({ kind: 'smokeGone', key });
    } else {
      state.smoke.set(key, left);
    }
  }

  // 阶段 5：事件稳定排序：(key 升序, 种类按推演顺序)
  events.sort((a, b) => a.key - b.key || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  return { events };
}

/** 该格是否在燃烧（集成层：站在火上的实体每回合受 FIRE_TICK_DAMAGE） */
export function isBurning(state: FireState, key: number): boolean {
  return state.fire.has(key);
}

/** 该格是否有烟（集成层：烟阻挡视线，传入 hasLineOfSight 的 isBlocked 回调） */
export function isSmoky(state: FireState, key: number): boolean {
  return state.smoke.has(key);
}
