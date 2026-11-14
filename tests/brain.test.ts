import { describe, expect, it } from 'vitest';
import { runBrain, newMemory, tickMemory, MONSTER_TREE } from '../src/engine/brain';
import type { BrainContext, MonsterMemory } from '../src/engine/brain';
import { attitude } from '../src/engine/factions';
import { makeActor } from '../src/entities/actor';
import type { Actor } from '../src/entities/actor';
import { Rng } from '../src/engine/rng';

const OPEN = () => false;

function monster(x: number, y: number, overrides: Partial<Actor> = {}): Actor {
  return makeActor({
    species: 'rat',
    name: '鼠人',
    x,
    y,
    ai: { mode: 'wander', senseRadius: 6 },
    ...overrides,
  });
}

function makeCtx(opts: {
  self: Actor;
  player: Actor;
  memory?: MonsterMemory;
  allies?: { actor: Actor; memory: MonsterMemory }[];
  isBlocked?: (x: number, y: number) => boolean;
  isOnFire?: (x: number, y: number) => boolean;
  seed?: number;
}): BrainContext {
  return {
    self: opts.self,
    player: opts.player,
    allies: opts.allies ?? [],
    isBlocked: opts.isBlocked ?? OPEN,
    isOnFire: opts.isOnFire ?? (() => false),
    rng: new Rng(opts.seed ?? 1),
    memory: opts.memory ?? newMemory(),
  };
}

describe('factions', () => {
  it('关系矩阵符合设计：教团与原生物种互相敌对（它们之间会内斗）', () => {
    expect(attitude('player', 'depthspawn')).toBe('hostile');
    expect(attitude('depthspawn', 'player')).toBe('hostile');
    expect(attitude('cult', 'depthspawn')).toBe('hostile');
    expect(attitude('depthspawn', 'cult')).toBe('hostile');
    expect(attitude('cult', 'cult')).toBe('friendly');
    expect(attitude('depthspawn', 'depthspawn')).toBe('friendly');
  });

  it('关系矩阵对称', () => {
    const ids = ['player', 'depthspawn', 'cult'] as const;
    for (const a of ids) {
      for (const b of ids) {
        expect(attitude(a, b)).toBe(attitude(b, a));
      }
    }
  });
});

describe('行为树', () => {
  it('结构：默认树是 selector，包含 6 个叶子', () => {
    expect(MONSTER_TREE.kind).toBe('selector');
    expect(MONSTER_TREE.children?.length).toBe(6);
  });

  it('火焰最高优先：脚下有火时即便贴着玩家也先逃命', () => {
    const self = monster(5, 5);
    const memory = newMemory();
    const ctx = makeCtx({
      self,
      player: monster(6, 5),
      memory,
      isOnFire: (x, y) => x === 5 && y === 5,
    });
    const result = runBrain(ctx);
    expect(result.action.type).toBe('move');
    expect(result.events.some((e) => e.kind === 'fleeingFire')).toBe(true);
  });

  it('贴身攻击', () => {
    const self = monster(5, 5, { ai: { mode: 'chase', senseRadius: 6 } });
    const result = runBrain(
      makeCtx({ self, player: monster(6, 5), memory: newMemory(), seed: 3 }),
    );
    expect(result.action).toEqual({ type: 'attack' });
  });

  it('看见玩家 → 记忆写入 + 唤醒 + 朝玩家移动', () => {
    const self = monster(0, 0);
    const memory = newMemory();
    const result = runBrain(
      makeCtx({ self, player: monster(4, 0), memory, seed: 3 }),
    );
    expect(memory.lastSeenPlayer).toEqual({ x: 4, y: 0 });
    expect(memory.alert).toBe(2);
    expect(self.ai?.mode).toBe('chase');
    expect(result.action.type).toBe('move');
  });

  it('丢失视线 → 走向最后目击点（搜查），到达后清除记忆', () => {
    const self = monster(0, 0, { ai: { mode: 'chase', senseRadius: 6 } });
    const memory = newMemory();
    memory.lastSeenPlayer = { x: 5, y: 0 };
    memory.alert = 2;
    // 玩家在远处且无视线（距离超出感知半径）
    let result = runBrain(makeCtx({ self, player: monster(40, 40), memory, seed: 3 }));
    expect(result.action.type).toBe('move');
    if (result.action.type === 'move') {
      expect(self.x + result.action.dx).toBe(1); // 向目击点 (5,0) 前进
    }
    // 抵达目击点：记忆清除
    self.x = 5;
    self.y = 0;
    result = runBrain(makeCtx({ self, player: monster(40, 40), memory, seed: 3 }));
    expect(memory.lastSeenPlayer).toBeNull();
  });

  it('呼救：看见玩家且盟友在 8 格内 → 盟友获得集结点，自己进入冷却', () => {
    const self = monster(0, 0, { ai: { mode: 'chase', senseRadius: 6 } });
    const ally = monster(6, 2);
    const allyMemory = newMemory();
    const memory = newMemory();
    runBrain(
      makeCtx({
        self,
        player: monster(3, 0),
        memory,
        allies: [{ actor: ally, memory: allyMemory }],
        seed: 3,
      }),
    );
    expect(allyMemory.rallyPoint).toEqual({ x: 3, y: 0 });
    expect(memory.cooldowns.get('callForHelp')).toBe(10);
    // 冷却期间不再呼救（集结点保持不变即可再次通过，但冷却不刷新）
    tickMemory(memory);
    const before = memory.cooldowns.get('callForHelp');
    runBrain(
      makeCtx({
        self,
        player: monster(3, 0),
        memory,
        allies: [{ actor: ally, memory: allyMemory }],
        seed: 3,
      }),
    );
    expect(memory.cooldowns.get('callForHelp')).toBe(before);
  });

  it('支援：有集结点的怪物朝集结点移动', () => {
    const self = monster(0, 0, { ai: { mode: 'wander', senseRadius: 6 } });
    const memory = newMemory();
    memory.rallyPoint = { x: 6, y: 0 };
    const result = runBrain(
      makeCtx({ self, player: monster(50, 50), memory, seed: 3 }),
    );
    expect(result.action.type).toBe('move');
    if (result.action.type === 'move') {
      expect(self.x + result.action.dx).toBe(1);
    }
  });

  it('同输入同 rng 状态 → 决策可复现', () => {
    const run = (seed: number): string => {
      const self = monster(5, 5);
      const result = runBrain(
        makeCtx({ self, player: monster(30, 30), memory: newMemory(), seed }),
      );
      return JSON.stringify(result);
    };
    expect(run(42)).toBe(run(42));
  });
});

describe('tickMemory', () => {
  it('冷却递减至 0 后移除；集结点超时作废', () => {
    const memory = newMemory();
    memory.cooldowns.set('callForHelp', 1);
    memory.rallyPoint = { x: 1, y: 1 };
    tickMemory(memory);
    expect(memory.cooldowns.has('callForHelp')).toBe(false);
    expect(memory.rallyPoint).not.toBeNull();
    for (let i = 0; i < 12; i++) tickMemory(memory);
    expect(memory.rallyPoint).toBeNull();
  });
});
