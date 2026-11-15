/**
 * 陷阱系统 — 内容定义（目录）与纯结算。
 * rollTraps 供地牢生成时在候选地板格上撒陷阱；triggerTrap 供游戏层在目标踩上陷阱格时结算效果。
 * 纯结算模块：不做地图操作、不做死亡判定、不写日志 —— message 只是文本，
 * 游戏层负责按 TrapTriggerReport 扣血 / 施加状态 / 执行随机传送与日志输出。
 */
import type { Pt } from '../engine/los';
import type { Rng } from '../engine/rng';
import type { StatusKind } from '../engine/statuses';

export type TrapKind = 'spikes' | 'poisonGas' | 'teleportRune' | 'flameJet';

export interface TrapDef {
  kind: TrapKind;
  /** 中文名：地刺 / 毒雾符文 / 传送符文 / 火焰喷口 */
  name: string;
  /** 地面显示字符（未触发时也可见，考验玩家观察力） */
  glyph: string;
  /** 地面显示色 */
  color: string;
  /** 出现的最低楼层（更浅的楼层不会生成该陷阱） */
  minDepth: number;
}

/**
 * 陷阱目录：kind → 定义。
 * glyph 刻意与怪物（字母）、物品（! ? / [）、楼梯（>）、墙体（#）错开，
 * 既考验观察力又不至于与其他实体混淆。
 */
export const TRAPS: Record<TrapKind, TrapDef> = {
  spikes: { kind: 'spikes', name: '地刺', glyph: '^', color: '#b8bcc4', minDepth: 1 },
  poisonGas: { kind: 'poisonGas', name: '毒雾符文', glyph: '&', color: '#7cb342', minDepth: 1 },
  teleportRune: { kind: 'teleportRune', name: '传送符文', glyph: '=', color: '#6fb3e0', minDepth: 1 },
  flameJet: { kind: 'flameJet', name: '火焰喷口', glyph: '*', color: '#ff7043', minDepth: 2 },
};

// 定义对象冻结为只读，防止运行期意外篡改
for (const def of Object.values(TRAPS)) {
  Object.freeze(def);
}

export interface PlacedTrap {
  x: number;
  y: number;
  kind: TrapKind;
}

/**
 * 从候选地板格中随机挑 n 个放陷阱（不放回），种类按 minDepth 门控等权抽取。
 * - 实际放置数 = min(count, 去重后的候选格数)；count <= 0 或候选为空时返回空数组。
 * - 候选格先按坐标去重，避免调用方传入重复格导致同格叠两个陷阱。
 * - 只消耗 rng 的确定性整数掷（洗牌 + 逐个 pick），同 rng 状态完全可复现。
 */
export function rollTraps(depth: number, count: number, candidates: Pt[], rng: Rng): PlacedTrap[] {
  const d = Math.max(1, Math.floor(depth));
  const want = Math.max(0, Math.floor(count));
  if (want === 0 || candidates.length === 0) return [];

  // 候选格去重：同格只保留一份
  const seen = new Set<string>();
  const pool: Pt[] = [];
  for (const pt of candidates) {
    const key = `${pt.x},${pt.y}`;
    if (!seen.has(key)) {
      seen.add(key);
      pool.push(pt);
    }
  }

  // 不放回抽取：每次随机剔除一格并收入选中集（take <= pool.length，抽完后池必被取空到 take 个）
  const take = Math.min(want, pool.length);
  const chosen: Pt[] = [];
  for (let i = 0; i < take; i++) {
    const pt = pool.splice(rng.int(0, pool.length - 1), 1)[0];
    if (pt) chosen.push(pt);
  }

  // 种类池按 minDepth 门控，等权抽取（spikes 恒在池中，池不会为空）
  const kinds = (Object.keys(TRAPS) as TrapKind[]).filter((k) => TRAPS[k].minDepth <= d);
  const traps: PlacedTrap[] = [];
  for (const pt of chosen) {
    traps.push({ x: pt.x, y: pt.y, kind: rng.pick(kinds) });
  }
  return traps;
}

export interface TrapTriggerReport {
  kind: TrapKind;
  /** 直接伤害（spikes 3-6 / flameJet 4-8），无则 0 */
  damage: number;
  /** 附加状态（poisonGas → poison 5 回合 power 2；flameJet → burn 3 回合 power 2），无则 null */
  status: { kind: StatusKind; turns: number; power: number } | null;
  /** 传送符文 → true（游戏层负责把目标随机传送） */
  teleport: boolean;
  /** 触发时的中文日志文本 */
  message: string;
}

/** 地刺直接伤害区间 [min, max]（含端点）（第二轮早期死亡率收敛：3-6→2-4，压制自动探索批次内的被动消耗） */
const SPIKES_DAMAGE: [number, number] = [2, 4];
/** 火焰喷口直接伤害区间 [min, max]（含端点） */
const FLAME_DAMAGE: [number, number] = [4, 8];
/** 毒雾附加的中毒参数：5 回合、每回合 1 点（第二轮早期死亡率收敛：10 点总伤对 26HP 法师过重，减半消耗压力） */
const POISON: { kind: StatusKind; turns: number; power: number } = { kind: 'poison', turns: 5, power: 1 };
/** 火焰附加的燃烧参数：3 回合、每回合 2 点 */
const BURN: { kind: StatusKind; turns: number; power: number } = { kind: 'burn', turns: 3, power: 2 };

/**
 * 纯结算：触发陷阱的效果。
 * 不做地图操作、不做死亡判定、不写日志 —— message 只是文本，由游戏层转交日志系统。
 * spikes / flameJet 各消耗一次 rng.int 掷伤害；poisonGas / teleportRune 不掷随机数。
 */
export function triggerTrap(kind: TrapKind, rng: Rng): TrapTriggerReport {
  if (kind === 'spikes') {
    const damage = rng.int(SPIKES_DAMAGE[0], SPIKES_DAMAGE[1]);
    return { kind, damage, status: null, teleport: false, message: `地刺从脚下弹出，扎了你 ${damage} 点伤害。` };
  }
  if (kind === 'poisonGas') {
    return {
      kind,
      damage: 0,
      status: { ...POISON },
      teleport: false,
      message: '毒雾符文亮起，刺鼻的绿雾将你笼罩（中毒 5 回合）。',
    };
  }
  if (kind === 'teleportRune') {
    return { kind, damage: 0, status: null, teleport: true, message: '传送符文轰然作响，空间在你脚下扭曲。' };
  }
  if (kind === 'flameJet') {
    const damage = rng.int(FLAME_DAMAGE[0], FLAME_DAMAGE[1]);
    return {
      kind,
      damage,
      status: { ...BURN },
      teleport: false,
      message: `火焰喷口喷出灼热火柱（${damage} 点伤害），你被点燃（燃烧 3 回合）。`,
    };
  }
  throw new Error(`triggerTrap: 未知的陷阱种类 ${String(kind)}`);
}
