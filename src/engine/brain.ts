/**
 * 怪物行为树 AI：selector/sequence/leaf 组合子 + 怪物记忆。
 * 与旧的三态 ai.ts 互补：本系统给普通怪物提供有记忆、会呼救、会包抄的行为。
 */
import type { Actor, AiState } from '../entities/actor';
import type { AiAction } from './ai';
import { hasLineOfSight } from './los';
import type { Pt } from './los';
import type { Rng } from './rng';
import { findPathWithFn } from './pathfinding';

/** 八方向（含斜向） */
const ALL_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

// ---------- 记忆 ----------

export interface MonsterMemory {
  /** 最后目击玩家的位置（丢失视线后去这里搜查） */
  lastSeenPlayer: Pt | null;
  /** 警戒等级：0 平静 / 1 起疑 / 2 战斗 */
  alert: number;
  /** 同伴呼救的集结点 */
  rallyPoint: Pt | null;
  rallyAge: number;
  /** 行为冷却（如呼救每 10 回合一次） */
  cooldowns: Map<string, number>;
}

export function newMemory(): MonsterMemory {
  return {
    lastSeenPlayer: null,
    alert: 0,
    rallyPoint: null,
    rallyAge: 0,
    cooldowns: new Map(),
  };
}

/** 每回合衰减：冷却递减、集结点超时作废 */
export function tickMemory(memory: MonsterMemory): void {
  for (const [k, v] of [...memory.cooldowns]) {
    const next = v - 1;
    if (next <= 0) memory.cooldowns.delete(k);
    else memory.cooldowns.set(k, next);
  }
  if (memory.rallyPoint) {
    memory.rallyAge += 1;
    if (memory.rallyAge > RALLY_TIMEOUT) {
      memory.rallyPoint = null;
      memory.rallyAge = 0;
    }
  }
}

const RALLY_TIMEOUT = 10;
const CALL_HELP_COOLDOWN = 10;
const CALL_HELP_RADIUS = 8;
const WANDER_KEEP_DIR = 0.6;

// ---------- 行为树骨架 ----------

export type BtStatus = 'success' | 'failure' | 'running';

export interface BtNode {
  kind: 'selector' | 'sequence' | 'leaf';
  /** leaf 的行为名 */
  id?: string;
  children?: BtNode[];
}

export interface BrainAlly {
  actor: Actor;
  memory: MonsterMemory;
}

export interface BrainContext {
  self: Actor;
  player: Actor;
  allies: BrainAlly[];
  isBlocked: (x: number, y: number) => boolean;
  isOnFire: (x: number, y: number) => boolean;
  rng: Rng;
  memory: MonsterMemory;
}

export interface BrainEvent {
  kind: 'callForHelp' | 'alerted' | 'fleeingFire';
  at: Pt;
  text: string;
}

export interface BrainResult {
  action: AiAction;
  events: BrainEvent[];
}

type LeafResult = { status: BtStatus; action?: AiAction };
type LeafFn = (ctx: BrainContext, events: BrainEvent[]) => LeafResult;

function cheb(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** 沿 A* 路径取走向目标的下一步（目标格豁免阻挡，供攻击收尾） */
function stepToward(self: Actor, target: Pt, isBlocked: (x: number, y: number) => boolean): AiAction | null {
  const path = findPathWithFn({ x: self.x, y: self.y }, target, (x, y) => !isBlocked(x, y));
  const first = path?.[0];
  if (!first) return null;
  return { type: 'move', dx: first.x - self.x, dy: first.y - self.y };
}

// ---------- 叶子行为 ----------

/** 逃离火焰：脚下或邻近有火时，逃向火最少的可走格；无路可逃则认命继续作战 */
const fleeFire: LeafFn = (ctx, events) => {
  const nearFire =
    ctx.isOnFire(ctx.self.x, ctx.self.y) ||
    ALL_DIRS.some(([dx, dy]) => ctx.isOnFire(ctx.self.x + dx, ctx.self.y + dy));
  if (!nearFire) return { status: 'failure' };

  let best: { dx: number; dy: number } | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const [dx, dy] of ALL_DIRS) {
    const nx = ctx.self.x + dx;
    const ny = ctx.self.y + dy;
    if (ctx.isBlocked(nx, ny) || ctx.isOnFire(nx, ny)) continue;
    let fires = 0;
    for (const [ddx, ddy] of ALL_DIRS) {
      if (ctx.isOnFire(nx + ddx, ny + ddy)) fires += 1;
    }
    const score = -fires;
    if (score > bestScore) {
      bestScore = score;
      best = { dx, dy };
    }
  }
  if (!best) return { status: 'failure' };
  events.push({
    kind: 'fleeingFire',
    at: { x: ctx.self.x, y: ctx.self.y },
    text: `${ctx.self.name}在火焰中乱窜！`,
  });
  return { status: 'success', action: { type: 'move', dx: best.dx, dy: best.dy } };
};

/** 贴身攻击 */
const meleeAttack: LeafFn = (ctx) => {
  const dist = cheb(ctx.self.x, ctx.self.y, ctx.player.x, ctx.player.y);
  if (dist <= 1) return { status: 'success', action: { type: 'attack' } };
  return { status: 'failure' };
};

/** 呼救：看见玩家且同派系盟友在范围内 → 给盟友写集结点，冷却 10 回合 */
const callForHelp: LeafFn = (ctx, events) => {
  const ai = ctx.self.ai;
  if (!ai || ai.mode === 'sleep') return { status: 'failure' };
  if ((ctx.memory.cooldowns.get('callForHelp') ?? 0) > 0) return { status: 'failure' };
  const dist = cheb(ctx.self.x, ctx.self.y, ctx.player.x, ctx.player.y);
  const senseRadius = ai.senseRadius ?? 6;
  const canSee =
    dist <= senseRadius &&
    hasLineOfSight(ctx.self.x, ctx.self.y, ctx.player.x, ctx.player.y, ctx.isBlocked);
  if (!canSee) return { status: 'failure' };
  const nearby = ctx.allies.filter(({ actor }) =>
    cheb(actor.x, actor.y, ctx.player.x, ctx.player.y) <= CALL_HELP_RADIUS,
  );
  if (nearby.length === 0) return { status: 'failure' };
  for (const ally of nearby) {
    ally.memory.rallyPoint = { x: ctx.player.x, y: ctx.player.y };
    ally.memory.alert = Math.max(ally.memory.alert, 1);
  }
  ctx.memory.cooldowns.set('callForHelp', CALL_HELP_COOLDOWN);
  events.push({
    kind: 'callForHelp',
    at: { x: ctx.self.x, y: ctx.self.y },
    text: `${ctx.self.name}发出尖锐的啸叫，召唤同伴！`,
  });
  return { status: 'success', action: { type: 'wait' } };
};

/** 支援：有集结点则前往；抵达附近或超时则放弃 */
const support: LeafFn = (ctx) => {
  const rp = ctx.memory.rallyPoint;
  if (!rp) return { status: 'failure' };
  if (cheb(ctx.self.x, ctx.self.y, rp.x, rp.y) <= 2) {
    ctx.memory.rallyPoint = null;
    ctx.memory.rallyAge = 0;
    return { status: 'failure' };
  }
  const action = stepToward(ctx.self, rp, ctx.isBlocked);
  if (!action) {
    ctx.memory.rallyPoint = null;
    return { status: 'failure' };
  }
  return { status: 'success', action };
};

/** 搜查：前往最后目击点，到达后转游荡 */
const investigate: LeafFn = (ctx) => {
  if (ctx.self.ai?.mode === 'sleep') return { status: 'failure' };
  const lsp = ctx.memory.lastSeenPlayer;
  if (!lsp) return { status: 'failure' };
  if (cheb(ctx.self.x, ctx.self.y, lsp.x, lsp.y) <= 0) {
    ctx.memory.lastSeenPlayer = null;
    if (ctx.self.ai) ctx.self.ai.mode = 'wander';
    return { status: 'failure' };
  }
  const action = stepToward(ctx.self, lsp, ctx.isBlocked);
  if (!action) {
    ctx.memory.lastSeenPlayer = null;
    return { status: 'failure' };
  }
  return { status: 'success', action };
};

/** 追击/游荡：有视线直取玩家，丢失视线走向记忆点，否则游荡 */
const chaseOrWander: LeafFn = (ctx, events) => {
  const ai: AiState = ctx.self.ai ?? { mode: 'wander' };
  const dist = cheb(ctx.self.x, ctx.self.y, ctx.player.x, ctx.player.y);
  const senseRadius = ai.senseRadius ?? 6;
  const canSee =
    dist <= senseRadius &&
    hasLineOfSight(ctx.self.x, ctx.self.y, ctx.player.x, ctx.player.y, ctx.isBlocked);

  if (canSee && ai.mode === 'sleep') {
    ai.mode = 'chase';
    events.push({
      kind: 'alerted',
      at: { x: ctx.self.x, y: ctx.self.y },
      text: `${ctx.self.name}发现了你！`,
    });
  }

  if (ai.mode === 'chase') {
    if (canSee) {
      if (dist <= 1) return { status: 'success', action: { type: 'attack' } };
      const action = stepToward(ctx.self, { x: ctx.player.x, y: ctx.player.y }, ctx.isBlocked);
      if (action) return { status: 'success', action };
      return { status: 'failure' };
    }
    // 丢失视线：走向最后目击点（记忆！而不是作弊式直奔真实位置）
    const lsp = ctx.memory.lastSeenPlayer;
    if (lsp) {
      const action = stepToward(ctx.self, lsp, ctx.isBlocked);
      if (action) return { status: 'success', action };
      ctx.memory.lastSeenPlayer = null;
      ai.mode = 'wander';
      return { status: 'failure' };
    }
    ai.mode = 'wander';
  }

  // 游荡：60% 延续偏好方向，撞墙随机换向
  const preferred = ai.wanderDir;
  if (preferred && ctx.rng.next() < WANDER_KEEP_DIR) {
    if (!ctx.isBlocked(ctx.self.x + preferred.dx, ctx.self.y + preferred.dy)) {
      return { status: 'success', action: { type: 'move', dx: preferred.dx, dy: preferred.dy } };
    }
  }
  const dir = ctx.rng.pick(ALL_DIRS);
  ai.wanderDir = { dx: dir[0], dy: dir[1] };
  if (!ctx.isBlocked(ctx.self.x + dir[0], ctx.self.y + dir[1])) {
    return { status: 'success', action: { type: 'move', dx: dir[0], dy: dir[1] } };
  }
  return { status: 'success', action: { type: 'wait' } };
};

const LEAVES: Record<string, LeafFn> = {
  fleeFire,
  meleeAttack,
  callForHelp,
  support,
  investigate,
  chaseOrWander,
};

/** 普通怪物的默认行为树（优先级自上而下） */
export const MONSTER_TREE: BtNode = {
  kind: 'selector',
  children: [
    { kind: 'leaf', id: 'fleeFire' },
    { kind: 'leaf', id: 'meleeAttack' },
    { kind: 'leaf', id: 'callForHelp' },
    { kind: 'leaf', id: 'support' },
    { kind: 'leaf', id: 'investigate' },
    { kind: 'leaf', id: 'chaseOrWander' },
  ],
};

function runBt(
  node: BtNode,
  ctx: BrainContext,
  events: BrainEvent[],
): { status: BtStatus; action?: AiAction } {
  if (node.kind === 'leaf') {
    const fn = node.id ? LEAVES[node.id] : undefined;
    if (!fn) return { status: 'failure' };
    return fn(ctx, events);
  }
  if (node.kind === 'selector') {
    for (const child of node.children ?? []) {
      const r = runBt(child, ctx, events);
      if (r.status !== 'failure') return r;
    }
    return { status: 'failure' };
  }
  // sequence：全部成功才算成功
  for (const child of node.children ?? []) {
    const r = runBt(child, ctx, events);
    if (r.status === 'failure') return r;
  }
  return { status: 'success' };
}

/** 感知 + 行为树执行入口 */
export function runBrain(ctx: BrainContext): BrainResult {
  const events: BrainEvent[] = [];
  // 感知：看见玩家 → 写入记忆并进入战斗警戒
  const dist = cheb(ctx.self.x, ctx.self.y, ctx.player.x, ctx.player.y);
  const senseRadius = ctx.self.ai?.senseRadius ?? 6;
  if (
    dist <= senseRadius &&
    hasLineOfSight(ctx.self.x, ctx.self.y, ctx.player.x, ctx.player.y, ctx.isBlocked)
  ) {
    ctx.memory.lastSeenPlayer = { x: ctx.player.x, y: ctx.player.y };
    ctx.memory.alert = 2;
    // 看见玩家即进入战斗模式（沉睡的怪醒来，游荡的怪转入追击）
    if (ctx.self.ai && ctx.self.ai.mode !== 'chase') ctx.self.ai.mode = 'chase';
  }
  const r = runBt(MONSTER_TREE, ctx, events);
  return { action: r.action ?? { type: 'wait' }, events };
}
