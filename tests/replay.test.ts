import { describe, expect, it } from 'vitest';
import { replayHashes } from '../src/engine/replay';
import type { Action } from '../src/engine/input';

/** 60 步混合输入流：移动/等待/自动探索开关/喝药/捡拾 */
function scriptedActions(): Action[] {
  const actions: Action[] = [];
  const moves: Action[] = [
    { type: 'move', dx: 1, dy: 0 },
    { type: 'move', dx: 0, dy: 1 },
    { type: 'move', dx: -1, dy: 0 },
    { type: 'move', dx: 0, dy: -1 },
    { type: 'move', dx: 1, dy: 1 },
  ];
  for (let i = 0; i < 60; i++) {
    actions.push(moves[i % moves.length] as Action);
    if (i % 7 === 0) actions.push({ type: 'wait' });
    if (i % 11 === 0) actions.push({ type: 'autoExplore' });
    if (i % 13 === 0) actions.push({ type: 'autoExplore' }); // 关闭
    if (i % 17 === 0) actions.push({ type: 'quaff' });
    if (i % 19 === 0) actions.push({ type: 'pickup' });
    if (i % 23 === 0) actions.push({ type: 'useSkill' });
  }
  return actions;
}

describe('确定性回放', () => {
  const actions = scriptedActions();

  it('同种子同输入 → 逐步状态哈希完全一致', () => {
    const a = replayHashes(20261114, 'warrior', actions);
    const b = replayHashes(20261114, 'warrior', actions);
    expect(a).toEqual(b);
    expect(a.length).toBe(actions.length + 1);
  });

  it('异种子 → 初始哈希即不同（地牢确实变了）', () => {
    const a = replayHashes(111, 'warrior', actions);
    const b = replayHashes(222, 'warrior', actions);
    expect(a[0]).not.toBe(b[0]);
  });

  it('同种子不同职业 → 哈希不同（初始属性与装备不同）', () => {
    const a = replayHashes(777, 'warrior', actions);
    const b = replayHashes(777, 'mage', actions);
    expect(a[0]).not.toBe(b[0]);
  });

  it('逻辑里不存在非确定性泄漏（两次跑 500 步自动探索仍一致）', () => {
    const heavy: Action[] = [{ type: 'autoExplore' }, { type: 'wait' }, { type: 'autoExplore' }];
    const a = replayHashes(31415, 'ranger', heavy);
    const b = replayHashes(31415, 'ranger', heavy);
    expect(a).toEqual(b);
  });
});
