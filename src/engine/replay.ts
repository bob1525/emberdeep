/**
 * 回放协议 v2（里程碑 2）——纯协议层：
 * - 协议头：protocolVersion / contentVersion / initialSeed / effectiveSeed / fixedSeed / classId
 * - 每个 Action 附 checkpoint 哈希；可选录制 canonical 快照用于字段级差异诊断
 * - 执行器（runReplay/replayHashes，需要构造 Game）在 src/replayRunner.ts（M4 边界：
 *   engine 层不 import 门面，录制器只依赖结构化的 ReplaySource）
 * - contentVersion 变更即视为内容不兼容，回放明确拒绝
 */
import type { Action } from './input';
import type { SaveData } from './saveCodec';
import { canonicalJson } from './canonical';

export const REPLAY_PROTOCOL_VERSION = 2;
/** 内容版本：存档/内容结构变化时必须提升，旧回放将被明确拒绝 */
export const CONTENT_VERSION = '0.2.0';

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

/** 录制器所需的最小游戏面（结构化接口，Game 天然满足；engine 不依赖门面具体类） */
export interface ReplaySource {
  handleAction(action: Action): void;
  stateHash(): string;
  exportSaveData(): SaveData;
  seed(): number;
}

/** 无头录制器：包裹游戏面，把每个 Action 与其后的状态指纹记录下来 */
export class ReplayRecorder {
  private records: ReplayActionRecord[] = [];

  constructor(
    private source: ReplaySource,
    private classId: string,
    private recordSnapshots = false,
  ) {}

  /** 执行并记录一个 Action */
  record(action: Action): void {
    this.source.handleAction(action);
    this.records.push({
      action,
      checkpointHash: this.source.stateHash(),
      ...(this.recordSnapshots
        ? { checkpointSnapshot: canonicalJson(this.source.exportSaveData()) }
        : {}),
    });
  }

  exportReplay(): ReplayData {
    return {
      protocolVersion: REPLAY_PROTOCOL_VERSION,
      contentVersion: CONTENT_VERSION,
      initialSeed: this.source.seed(),
      effectiveSeed: this.source.seed(),
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
