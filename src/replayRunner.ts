/**
 * ReplayRunner（里程碑 4 边界）：回放执行器。
 * 需要构造 Game 实例，因此住在门面同层（与 simulator.ts 同级），
 * engine/replay.ts 只保留纯协议与录制器。
 */
import type { Action } from './engine/input';
import { Game } from './game';
import {
  CONTENT_VERSION,
  REPLAY_PROTOCOL_VERSION,
  type ReplayData,
  type ReplayDiff,
} from './engine/replay';
import { canonicalJson, firstDifference } from './engine/canonical';

/** 重放一份回放数据；任何分歧在第一个受影响步骤报告 */
export function runReplay(data: ReplayData): ReplayDiff {
  if (data.protocolVersion !== REPLAY_PROTOCOL_VERSION) {
    return {
      pass: false,
      divergedAtAction: null,
      reason: `回放协议版本不符：${String(data.protocolVersion)}（当前 v${REPLAY_PROTOCOL_VERSION}）`,
    };
  }
  if (data.contentVersion !== CONTENT_VERSION) {
    return {
      pass: false,
      divergedAtAction: null,
      reason: `内容版本不符：${data.contentVersion} ≠ ${CONTENT_VERSION}`,
    };
  }
  const game = new Game(null, data.initialSeed, null, { fixedSeed: data.fixedSeed });
  game.handleAction({ type: 'titleNew' });
  const slot = data.classId === 'ranger' ? 1 : data.classId === 'mage' ? 2 : 0;
  game.handleAction({ type: 'useSlot', slot });

  for (let i = 0; i < data.actions.length; i++) {
    const rec = data.actions[i];
    if (!rec) break;
    game.handleAction(rec.action);
    const hash = game.stateHash();
    if (rec.checkpointHash !== hash) {
      let fieldPath: string | null = null;
      if (rec.checkpointSnapshot) {
        fieldPath = firstDifference(
          rec.checkpointSnapshot,
          canonicalJson(game.exportSaveData()),
        );
      }
      return {
        pass: false,
        divergedAtAction: i,
        expectedHash: rec.checkpointHash,
        actualHash: hash,
        fieldPath,
      };
    }
  }
  return { pass: true, divergedAtAction: null };
}

/** 兼容旧测试的便捷封装：返回逐步哈希序列（v1 语义） */
export function replayHashes(seed: number, classId: string, actions: Action[]): string[] {
  const game = new Game(null, seed, null, { fixedSeed: true });
  game.handleAction({ type: 'titleNew' });
  const slot = classId === 'ranger' ? 1 : classId === 'mage' ? 2 : 0;
  game.handleAction({ type: 'useSlot', slot });
  const hashes = [game.stateHash()];
  for (const action of actions) {
    game.handleAction(action);
    hashes.push(game.stateHash());
  }
  return hashes;
}
