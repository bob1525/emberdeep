/**
 * 持续状态（buff/debuff）系统 — 中毒、燃烧、减速、加速、护盾、再生。
 * 纯结算模块：只读写 Actor.statuses 与 Actor.hp，不掷随机数、不打日志、不判定死亡，
 * 游戏层负责根据 tickStatuses 返回的事件出日志/特效，并处理死亡。
 * StatusInstance（kind/remaining/power）定义在 src/entities/actor.ts。
 */
import type { Actor, StatusInstance } from '../entities/actor';

export type StatusKind = 'poison' | 'burn' | 'slow' | 'haste' | 'shield' | 'regeneration';

export interface StatusInfo {
  kind: StatusKind;
  /** 中文名：中毒/燃烧/减速/加速/护盾/再生 */
  name: string;
  /** HUD 显示色 */
  color: string;
  /** 是否为每回合造成伤害的状态 */
  damaging: boolean;
  /** 对防御的加成（shield 用） */
  defenseBonus: number;
}

/**
 * 状态目录：HUD 显示与结算所需的静态数值。
 * 伤害类状态的建议施加强度（游戏层施加时参考，不在目录中存默认值）：
 * poison → power 1-2，burn → power 2-4；regeneration 的 power 即每回合回复量。
 */
export const STATUSES: Record<StatusKind, StatusInfo> = {
  poison: { kind: 'poison', name: '中毒', color: '#7cb342', damaging: true, defenseBonus: 0 },
  burn: { kind: 'burn', name: '燃烧', color: '#ff7043', damaging: true, defenseBonus: 0 },
  slow: { kind: 'slow', name: '减速', color: '#4fc3f7', damaging: false, defenseBonus: 0 },
  haste: { kind: 'haste', name: '加速', color: '#ffd54f', damaging: false, defenseBonus: 0 },
  shield: { kind: 'shield', name: '护盾', color: '#b0bec5', damaging: false, defenseBonus: 2 },
  regeneration: { kind: 'regeneration', name: '再生', color: '#81c784', damaging: false, defenseBonus: 0 },
};

/** 运行时校验 StatusInstance.kind（string）是否为已知状态种类 — 容错旧存档里的脏数据 */
function isStatusKind(kind: string): kind is StatusKind {
  return Object.hasOwn(STATUSES, kind);
}

/**
 * 对目标施加状态；同类已存在时取 remaining 较大者、power 较大者（不叠加）。
 * - turns <= 0 视为无效调用，直接忽略（不会创建 0 回合的"即逝"状态）。
 * - power < 0 会钳到 0，避免出现"中毒回血"之类的脏数据。
 * - target.statuses 缺失（旧存档）时先初始化为空数组再写入。
 * - 旧存档若残留多个同 kind 实例，会合并收敛为一个（每次施加后保证同类至多一个）。
 */
export function applyStatus(target: Actor, kind: StatusKind, turns: number, power: number): void {
  if (!target.statuses) target.statuses = [];
  if (turns <= 0) return;
  const safePower = Math.max(0, power);

  // 收敛同类实例：取遍历中第一个作为载体，其余同类合并进载体后丢弃
  let existing: StatusInstance | undefined;
  const kept: StatusInstance[] = [];
  for (const inst of target.statuses) {
    if (inst.kind !== kind) {
      kept.push(inst);
    } else if (!existing) {
      existing = inst;
      kept.push(inst);
    } else {
      existing.remaining = Math.max(existing.remaining, inst.remaining);
      existing.power = Math.max(existing.power, inst.power);
    }
  }

  if (existing) {
    existing.remaining = Math.max(existing.remaining, turns);
    existing.power = Math.max(existing.power, safePower);
  } else {
    kept.push({ kind, remaining: turns, power: safePower });
  }
  target.statuses = kept;
}

/** 目标身上是否带有指定状态（statuses 缺失时安全返回 false，不抛错） */
export function hasStatus(target: Actor, kind: StatusKind): boolean {
  return target.statuses?.some((inst) => inst.kind === kind) ?? false;
}

/** 所有状态提供的防御加成之和（目前只有 shield：+2） */
export function totalDefenseBonus(target: Actor): number {
  let total = 0;
  for (const inst of target.statuses ?? []) {
    if (isStatusKind(inst.kind)) total += STATUSES[inst.kind].defenseBonus;
  }
  return total;
}

export interface StatusTickEvent {
  kind: StatusKind;
  /** 伤害类状态本回合造成的伤害；再生状态为负数表示回复量（受 maxHp 钳制后的实际变化值，满血时为 0） */
  damage: number;
  /** 本回合是否刚好到期移除 */
  expired: boolean;
}

export interface StatusTickReport {
  events: StatusTickEvent[];
}

/**
 * 结算一回合的持续状态：
 * 1. 伤害类（poison/burn）按 power 扣血；regeneration 按 power 回血（事件 damage 为负数）。
 *    两者都把 hp 钳制在 [0, maxHp]，事件里的 damage 是钳制后的实际变化量（不是名义 power）。
 * 2. 全部 remaining-1，减到 0 的在本回合移除（事件 expired = true）。
 * 3. 非伤害状态也产出事件（damage = 0），供游戏层做"护盾破碎""加速结束"之类的提示。
 * 只读写 target.statuses 与 target.hp：不判定死亡、不掷随机数、不打日志、不抛错。
 * 未知 kind（旧存档残留）不产出事件、不产生效果，只随回合衰减并在到点后移除。
 */
export function tickStatuses(target: Actor): StatusTickReport {
  if (!target.statuses) target.statuses = []; // 容错旧存档
  const events: StatusTickEvent[] = [];
  const survivors: StatusInstance[] = [];

  for (const inst of target.statuses) {
    if (!isStatusKind(inst.kind)) {
      inst.remaining -= 1;
      if (inst.remaining > 0) survivors.push(inst);
      continue;
    }
    const info = STATUSES[inst.kind];
    let damage = 0;
    if (info.damaging) {
      const before = target.hp;
      target.hp = Math.max(0, target.hp - inst.power);
      damage = before - target.hp;
    } else if (inst.kind === 'regeneration') {
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + inst.power);
      damage = before - target.hp; // 负数 = 回复量；已满血时为 0
    }
    inst.remaining -= 1;
    const expired = inst.remaining <= 0;
    if (!expired) survivors.push(inst);
    events.push({ kind: inst.kind, damage, expired });
  }

  target.statuses = survivors;
  return { events };
}

/**
 * 行动频率：slow → 0.5（隔回合行动），haste → 2（一回合行动两次），其余 1。
 * 同时带有 slow 与 haste 时两者相乘抵消（0.5 × 2 = 1，即恢复正常速度）。
 */
export function actionsPerTurn(target: Actor): number {
  let actions = 1;
  for (const inst of target.statuses ?? []) {
    if (inst.kind === 'slow') actions *= 0.5;
    else if (inst.kind === 'haste') actions *= 2;
  }
  return actions;
}
