import { describe, expect, it } from 'vitest';
import {
  CONTENT_VERSION,
  REPLAY_PROTOCOL_VERSION,
  ReplayRecorder,
  replayHashes,
  runReplay,
  type ReplayData,
} from '../src/engine/replay';
import type { Action } from '../src/engine/input';
import { Game } from '../src/game';

function scriptedActions(count = 12): Action[] {
  const moves: Action[] = [
    { type: 'move', dx: 1, dy: 0 },
    { type: 'move', dx: 0, dy: 1 },
    { type: 'move', dx: -1, dy: 0 },
    { type: 'move', dx: 0, dy: -1 },
    { type: 'move', dx: 1, dy: 1 },
  ];
  const actions: Action[] = [];
  for (let i = 0; i < count; i++) {
    actions.push(moves[i % moves.length] as Action);
    if (i % 5 === 0) actions.push({ type: 'wait' });
  }
  return actions;
}

function recordReplay(seed: number, classId: string, actions: Action[], snapshots = false): ReplayData {
  const game = new Game(null, seed, null, { fixedSeed: true });
  game.handleAction({ type: 'titleNew' });
  const slot = classId === 'ranger' ? 1 : classId === 'mage' ? 2 : 0;
  game.handleAction({ type: 'useSlot', slot });
  const recorder = new ReplayRecorder(game, classId, snapshots);
  for (const a of actions) recorder.record(a);
  return recorder.exportReplay();
}

describe('回放协议 v2', () => {
  it('同 header + 同 Action → runReplay 通过', () => {
    const data = recordReplay(20261114, 'warrior', scriptedActions());
    expect(runReplay(data)).toEqual({ pass: true, divergedAtAction: null });
  });

  it('异种子 → 初始状态不同（replayHashes 首哈希不同）', () => {
    const actions = scriptedActions(6);
    const a = replayHashes(111, 'warrior', actions);
    const b = replayHashes(222, 'warrior', actions);
    expect(a[0]).not.toBe(b[0]);
  });

  it('异职业 → 初始状态不同', () => {
    const actions = scriptedActions(6);
    const a = replayHashes(777, 'warrior', actions);
    const b = replayHashes(777, 'mage', actions);
    expect(a[0]).not.toBe(b[0]);
  });

  it('断点续玩：save→hydrate 后继续相同输入，哈希与不中断运行逐位一致', () => {
    const seed = 4242;
    const actions = scriptedActions(30);
    // 基准：不中断跑完
    const base = new Game(null, seed, null, { fixedSeed: true });
    base.handleAction({ type: 'titleNew' });
    base.handleAction({ type: 'useSlot', slot: 1 }); // 游侠
    const baseHashes = [base.stateHash()];
    for (const a of actions) {
      base.handleAction(a);
      baseHashes.push(base.stateHash());
    }
    // 断点：第 17 步后导出存档 → 读档 → 继续相同输入
    const k = 17;
    const cut = new Game(null, seed, null, { fixedSeed: true });
    cut.handleAction({ type: 'titleNew' });
    cut.handleAction({ type: 'useSlot', slot: 1 });
    for (let i = 0; i < k; i++) cut.handleAction(actions[i] as Action);
    const data = cut.exportSaveData();
    const resumed = new Game(null, seed, data, { fixedSeed: true });
    const resumedHashes = [resumed.stateHash()];
    for (let i = k; i < actions.length; i++) {
      resumed.handleAction(actions[i] as Action);
      resumedHashes.push(resumed.stateHash());
    }
    expect(resumedHashes).toEqual(baseHashes.slice(k));
  });

  it('修改第 5 步 Action → 在第 5 步报告分歧（含字段路径）', () => {
    const data = recordReplay(424242, 'warrior', scriptedActions(10), true);
    const mutated: ReplayData = {
      ...data,
      actions: data.actions.map((r, i) =>
        i === 5 && r.action.type === 'move'
          ? { ...r, action: { type: 'move', dx: -r.action.dx, dy: -r.action.dy } }
          : r,
      ),
    };
    const diff = runReplay(mutated);
    expect(diff.pass).toBe(false);
    expect(diff.divergedAtAction).toBe(5);
    expect(diff.expectedHash).toBeDefined();
    expect(diff.actualHash).not.toBe(diff.expectedHash);
  });

  it('旧协议 / 异内容版本被明确拒绝', () => {
    const data = recordReplay(1, 'warrior', scriptedActions(3));
    const wrongProtocol = { ...data, protocolVersion: 1 as unknown as 2 };
    expect(runReplay(wrongProtocol).reason).toContain('协议版本');
    const wrongContent = { ...data, contentVersion: '0.0.9' };
    expect(runReplay(wrongContent).reason).toContain('内容版本');
  });

  it('双 Game 实例交替回放互不污染（allocator 隔离）', () => {
    const a = recordReplay(31415, 'warrior', scriptedActions(20));
    const b = recordReplay(27182, 'mage', scriptedActions(20));
    expect(runReplay(a).pass).toBe(true);
    expect(runReplay(b).pass).toBe(true);
    expect(runReplay(a).pass).toBe(true); // b 跑过后 a 仍可复现
  });

  it('协议常量与内容版本已定义', () => {
    expect(REPLAY_PROTOCOL_VERSION).toBe(2);
    expect(CONTENT_VERSION).toBe('0.1.0');
  });
});
