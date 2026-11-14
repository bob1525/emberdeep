/**
 * 派系关系矩阵：深渊物种（depthspawn）与深渊教团（cult）都敌视玩家，
 * 但教团想独占深渊的祭品，因此与原生物种也互相敌对——它们之间会内斗。
 */
export type FactionId = 'depthspawn' | 'cult' | 'player';

export type Attitude = 'hostile' | 'neutral' | 'friendly';

const MATRIX: Record<FactionId, Record<FactionId, Attitude>> = {
  player: { player: 'friendly', depthspawn: 'hostile', cult: 'hostile' },
  depthspawn: { player: 'hostile', depthspawn: 'friendly', cult: 'hostile' },
  cult: { player: 'hostile', depthspawn: 'hostile', cult: 'friendly' },
};

/** 两派系之间的态度（未知组合按中立处理） */
export function attitude(a: FactionId, b: FactionId): Attitude {
  return MATRIX[a]?.[b] ?? 'neutral';
}
