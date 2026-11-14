import type { Actor, AiState } from '../entities/actor';
import { hasLineOfSight } from './los';
import type { Rng } from './rng';
import { findPathWithFn } from './pathfinding';

export type AiAction =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'attack' }
  | { type: 'wait' };

const WANDER_KEEP_DIR = 0.6;

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

/**
 * 怪物一回合的决策。isBlocked 只描述地形阻挡（玩家所在格不由它表达）。
 * 行为：贴身必攻击；睡眠 → 感知到玩家转追击；游荡 → 感知到玩家转追击；
 * 追击 → A* 第一步，被堵则直线逼近，再堵则等待。
 * 模式变化直接写回 self.ai（游戏层靠它持久化）。
 */
export function decideMonsterAction(opts: {
  self: Actor;
  player: Actor;
  isBlocked: (x: number, y: number) => boolean;
  rng: Rng;
}): AiAction {
  const { self, player, isBlocked, rng } = opts;
  const ai: AiState = self.ai ?? { mode: 'sleep' };

  const dxToPlayer = player.x - self.x;
  const dyToPlayer = player.y - self.y;
  const chebyshev = Math.max(Math.abs(dxToPlayer), Math.abs(dyToPlayer));

  // 贴身规则优先级最高：睡着也立刻醒打
  if (chebyshev <= 1) return { type: 'attack' };

  const senseRadius = ai.senseRadius ?? 6;
  const canSense =
    chebyshev <= senseRadius &&
    hasLineOfSight(self.x, self.y, player.x, player.y, isBlocked);

  if (ai.mode === 'sleep') {
    if (canSense) {
      ai.mode = 'chase';
      return chaseStep(self, player, isBlocked);
    }
    return { type: 'wait' };
  }

  if (ai.mode === 'chase') {
    return chaseStep(self, player, isBlocked);
  }

  // wander
  if (canSense) {
    ai.mode = 'chase';
    return chaseStep(self, player, isBlocked);
  }
  return wanderStep(self, ai, isBlocked, rng);
}

function chaseStep(
  self: Actor,
  player: Actor,
  isBlocked: (x: number, y: number) => boolean,
): AiAction {
  const isWalkable = (x: number, y: number) => !isBlocked(x, y);
  const path = findPathWithFn({ x: self.x, y: self.y }, { x: player.x, y: player.y }, isWalkable);
  const first = path?.[0];
  if (first) {
    // 路径的最后一段是玩家所在格：贴上就算攻击
    if (first.x === player.x && first.y === player.y) return { type: 'attack' };
    return { type: 'move', dx: first.x - self.x, dy: first.y - self.y };
  }

  // 无路可寻：直线逼近，斜向不行走正交
  const dx = Math.sign(player.x - self.x);
  const dy = Math.sign(player.y - self.y);
  if (!isBlocked(self.x + dx, self.y + dy)) return { type: 'move', dx, dy };
  if (dx !== 0 && !isBlocked(self.x + dx, self.y)) return { type: 'move', dx, dy: 0 };
  if (dy !== 0 && !isBlocked(self.x, self.y + dy)) return { type: 'move', dx: 0, dy };
  return { type: 'wait' };
}

function wanderStep(
  self: Actor,
  ai: AiState,
  isBlocked: (x: number, y: number) => boolean,
  rng: Rng,
): AiAction {
  // 60% 概率延续偏好方向
  const preferred = ai.wanderDir;
  if (preferred && rng.next() < WANDER_KEEP_DIR) {
    if (!isBlocked(self.x + preferred.dx, self.y + preferred.dy)) {
      return { type: 'move', dx: preferred.dx, dy: preferred.dy };
    }
  }
  // 撞墙/无偏好：随机换向再试一次
  const dir = rng.pick(ALL_DIRS);
  ai.wanderDir = { dx: dir[0], dy: dir[1] };
  if (!isBlocked(self.x + dir[0], self.y + dir[1])) {
    return { type: 'move', dx: dir[0], dy: dir[1] };
  }
  return { type: 'wait' };
}
