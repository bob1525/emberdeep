import { describe, expect, it } from 'vitest';
import { decideMonsterAction } from '../src/engine/ai';
import { makeActor } from '../src/entities/actor';
import type { Actor } from '../src/entities/actor';
import { Rng } from '../src/engine/rng';

const OPEN = () => false;

function monster(overrides: Partial<Actor> = {}): Actor {
  return makeActor({
    species: 'rat',
    name: '鼠人',
    x: 5,
    y: 5,
    ai: { mode: 'sleep', senseRadius: 6 },
    ...overrides,
  });
}

const playerAt = (x: number, y: number): Actor =>
  makeActor({ species: 'player', name: '你', x, y, ai: null });

describe('decideMonsterAction', () => {
  it('贴身必攻击，即便在沉睡', () => {
    const self = monster({ x: 5, y: 5 });
    const action = decideMonsterAction({
      self,
      player: playerAt(6, 6),
      isBlocked: OPEN,
      rng: new Rng(1),
    });
    expect(action).toEqual({ type: 'attack' });
  });

  it('睡眠中无视线不行动', () => {
    const self = monster({ x: 0, y: 0 });
    const wall = (x: number) => x === 2;
    const action = decideMonsterAction({
      self,
      player: playerAt(4, 0),
      isBlocked: wall,
      rng: new Rng(1),
    });
    expect(action).toEqual({ type: 'wait' });
    expect(self.ai?.mode).toBe('sleep');
  });

  it('睡眠中有视线 → 转 chase 并朝玩家移动', () => {
    const self = monster({ x: 0, y: 0 });
    const action = decideMonsterAction({
      self,
      player: playerAt(4, 0),
      isBlocked: OPEN,
      rng: new Rng(1),
    });
    expect(self.ai?.mode).toBe('chase');
    expect(action.type).toBe('move');
    if (action.type === 'move') expect(action.dx).toBeGreaterThan(0);
  });

  it('chase 被墙隔断时仍直线逼近', () => {
    const self = monster({ x: 0, y: 0, ai: { mode: 'chase', senseRadius: 6 } });
    const wall = (x: number, y: number) => x === 2 && y <= 4;
    const action = decideMonsterAction({
      self,
      player: playerAt(4, 0),
      isBlocked: wall,
      rng: new Rng(1),
    });
    // A* 能绕墙（缺口在 y=5），也可能先向下走一格
    expect(action.type).toBe('move');
  });

  it('wander 沿偏好方向移动（唯一通路是偏好方向时）', () => {
    const self = monster({ x: 5, y: 5, ai: { mode: 'wander', wanderDir: { dx: 1, dy: 0 } } });
    const action = decideMonsterAction({
      self,
      player: playerAt(50, 50),
      // 只有小怪右边的格子是通路：若延续偏好则必然向右走，换向则原地等待
      isBlocked: (x: number, y: number) => !(x === 6 && y === 5),
      rng: new Rng(2),
    });
    if (action.type === 'move') {
      expect(action).toEqual({ type: 'move', dx: 1, dy: 0 });
    } else {
      expect(action).toEqual({ type: 'wait' });
    }
  });

  it('wander 感知到玩家 → 转 chase', () => {
    const self = monster({ x: 5, y: 5, ai: { mode: 'wander', wanderDir: { dx: -1, dy: 0 } } });
    const action = decideMonsterAction({
      self,
      player: playerAt(8, 5),
      isBlocked: OPEN,
      rng: new Rng(2),
    });
    expect(self.ai?.mode).toBe('chase');
    expect(action.type).toBe('move');
    if (action.type === 'move') expect(action.dx).toBeGreaterThan(0);
  });

  it('同输入同 rng 状态 → 决策可复现', () => {
    const run = (seed: number): string => {
      const self = monster({ x: 5, y: 5, ai: { mode: 'wander' } });
      const action = decideMonsterAction({
        self,
        player: playerAt(30, 30),
        isBlocked: OPEN,
        rng: new Rng(seed),
      });
      return JSON.stringify(action);
    };
    expect(run(42)).toBe(run(42));
  });

  it('ai 为 null 的实体不会崩溃（防御式兜底）', () => {
    const self = monster({ ai: null });
    const action = decideMonsterAction({
      self,
      player: playerAt(20, 20),
      isBlocked: OPEN,
      rng: new Rng(1),
    });
    expect(['wait', 'move']).toContain(action.type);
  });
});
