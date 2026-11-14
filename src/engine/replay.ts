import type { Action } from './input';
import { Game } from '../game';

export interface ReplayData {
  version: 1;
  seed: number;
  classId: string;
  actions: Action[];
}

/**
 * 无头回放：给定种子、职业与完整输入流，逐步推进游戏并采集状态哈希。
 * 哈希序列一致 ⇔ 逻辑完全确定。渲染层不参与（Game 接受 null 渲染器）。
 */
export function replayHashes(seed: number, classId: string, actions: Action[]): string[] {
  const game = new Game(null, seed);
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
