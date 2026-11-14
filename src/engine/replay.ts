/**
 * 回放协议 v2（里程碑 2）：
 * - 协议头：protocolVersion / contentVersion / initialSeed / effectiveSeed / fixedSeed / classId
 * - 每个 Action 附 checkpoint 哈希；可选录制 canonical 快照用于字段级差异诊断
 * - runReplay() 在第一个分歧处报告步数、期望/实际哈希与字段路径
 * - contentVersion 变更即视为内容不兼容，回放明确拒绝
 */
import type { Action } from './input';
import type { SaveData } from '../game';
import { Game } from '../game';
import { canonicalJson, firstDifference } from './canonical';

export const REPLAY_PROTOCOL_VERSION = 2;
/** 内容版本：存档/内容结构变化时必须提升，旧回放将被明确拒绝 */
export const CONTENT_VERSION = '0.1.0';

export interface ReplayActionRecord {
  action: Action;
  checkpointHash: string;
  /** 可选：该步的 canonical 快照（启用快照录制时才有，用于字段级差异） */
  checkpointSnapshot?: string;
}

export interface ReplayData {
  protocolVersion: 2;
  contentVersion: string;
  initialSeed: number;
  effectiveSeed: number;
  fixedSeed: boolean;
  classId: string;
  actions: ReplayActionRecord[];
}

/** 无头录制器：包裹 Game，把每个 Action 与其后的状态指纹记录下来 */
export class ReplayRecorder {
  private records: ReplayActionRecord[] = [];

  constructor(
    private game: Game,
    private classId: string,
    private recordSnapshots = false,
  ) {}

  /** 执行并记录一个 Action */
  record(action: Action): void {
    this.game.handleAction(action);
    this.records.push({
      action,
      checkpointHash: this.game.stateHash(),
      ...(this.recordSnapshots
        ? { checkpointSnapshot: canonicalJson(this.game.exportSaveData()) }
        : {}),
    });
  }

  exportReplay(): ReplayData {
    return {
      protocolVersion: REPLAY_PROTOCOL_VERSION,
      contentVersion: CONTENT_VERSION,
      initialSeed: this.game.seed(),
      effectiveSeed: this.game.seed(),
      fixedSeed: true,
      classId: this.classId,
      actions: [...this.records],
    };
  }
}

export interface ReplayDiff {
  pass: boolean;
  divergedAtAction: number | null;
  expectedHash?: string;
  actualHash?: string;
  /** 启用快照录制时，给出第一个分歧的字段路径 */
  fieldPath?: string | null;
  reason?: string;
}

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

/** 存档类型再导出（SaveCodec 边界：schema 校验在 saveSchema.ts） */
export type { SaveData };
