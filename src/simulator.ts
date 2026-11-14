/**
 * 无头平衡模拟器（里程碑 6/7）。
 * 由 tests/simulator.test.ts 驱动（vitest 管线解析无扩展名导入），
 * 结果写入 work/sim-results.json，供建筑与数值决策使用。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Game } from './game';
import { pathfindingStats } from './engine/pathfinding';
import type { ClassId } from './entities/classes';

export const SIM_CLASSES: readonly ClassId[] = ['warrior', 'ranger', 'mage'];

export interface SimResult {
  seed: number;
  classId: string;
  maxDepth: number;
  reached30: boolean;
  dead: boolean;
  cause: string;
  turns: number;
  kills: number;
  gold: number;
  level: number;
  potions: number;
  snapshotBytes: number;
  durationMs: number;
  astarCalls: number;
}

/** 单局模拟：固定种子的机器人跑一整条命（或到达 30 层 / 回合上限卡死标记） */
export function simulateRun(
  seed: number,
  classId: ClassId,
  maxDepthCap = 30,
  turnCap = 3000,
): SimResult {
  const game = new Game(null, seed, null, { fixedSeed: true });
  game.setSimMode(true);
  game.handleAction({ type: 'titleNew' });
  const slot = classId === 'ranger' ? 1 : classId === 'mage' ? 2 : 0;
  game.handleAction({ type: 'useSlot', slot });
  const t0 = Date.now();
  const astarBefore = { ...pathfindingStats };
  let stuck = false;
  let stagnant = 0;
  let lastTurn = -1;
  while (!game.dead && game.depth < maxDepthCap) {
    game.simTurn();
    // 保险丝：bot 策略若产生「回合冻结」（动作全被堵），8 次后强制断开，
    // 标记 deadlock——防止单种子无限循环卡死整个测试进程（P0 兜底）
    if (game.turn === lastTurn) {
      stagnant += 1;
      if (stagnant >= 8) {
        stuck = true;
        break;
      }
    } else {
      stagnant = 0;
      lastTurn = game.turn;
    }
    if (game.turn >= turnCap) {
      stuck = true;
      break;
    }
  }
  const snapshotBytes = JSON.stringify(game.exportSaveData()).length;
  return {
    seed,
    classId,
    maxDepth: game.depth,
    reached30: game.depth >= maxDepthCap,
    dead: game.dead,
    cause: game.dead ? game.deathCause : stuck ? (game.turn >= turnCap ? '回合上限（机器人卡死）' : '回合冻结（bot 无动作可用，已断开）') : `到达第 ${game.depth} 层`,
    turns: game.turn,
    kills: game.kills,
    gold: game.gold,
    level: game.level,
    potions: game.getPotionsUsed(),
    snapshotBytes,
    durationMs: Date.now() - t0,
    astarCalls: pathfindingStats.calls - astarBefore.calls,
  };
}

export interface ClassSummary {
  runs: number;
  avgMaxDepth: number;
  reached5: number;
  reached10: number;
  reached15: number;
  reached20: number;
  reached30: number;
  avgTurns: number;
  avgKills: number;
  avgGold: number;
  avgLevel: number;
  avgPotions: number;
  avgSnapshotBytes: number;
  avgAstarCallsPerRun: number;
  avgDurationMs: number;
  topDeathCauses: string;
}

export function summarize(list: SimResult[]): ClassSummary {
  const n = list.length || 1;
  const sum = (f: (r: SimResult) => number) => Math.round(list.reduce((s, r) => s + f(r), 0) / n);
  const pct = (f: (r: SimResult) => boolean) => Math.round((list.filter(f).length / n) * 100);
  const causes: Record<string, number> = {};
  for (const r of list) {
    if (r.dead) causes[r.cause] = (causes[r.cause] ?? 0) + 1;
  }
  const topCauses = Object.entries(causes)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}:${v}`)
    .join(', ');
  return {
    runs: list.length,
    avgMaxDepth: sum((r) => r.maxDepth),
    reached5: pct((r) => r.maxDepth >= 5),
    reached10: pct((r) => r.maxDepth >= 10),
    reached15: pct((r) => r.maxDepth >= 15),
    reached20: pct((r) => r.maxDepth >= 20),
    reached30: pct((r) => r.reached30),
    avgTurns: sum((r) => r.turns),
    avgKills: sum((r) => r.kills),
    avgGold: sum((r) => r.gold),
    avgLevel: sum((r) => r.level),
    avgPotions: sum((r) => r.potions),
    avgSnapshotBytes: sum((r) => r.snapshotBytes),
    avgAstarCallsPerRun: sum((r) => r.astarCalls),
    avgDurationMs: sum((r) => r.durationMs),
    topDeathCauses: topCauses || '（无死亡）',
  };
}

/** 按职业批量模拟（Q3：500 seeds 大规模数据采集用，增量输出进度） */
export function simulateClassBatch(
  classId: ClassId,
  seedCount: number,
  turnCap = 2500,
  seedOffset = 0,
): SimResult[] {
  const results: SimResult[] = [];
  for (let i = 1; i <= seedCount; i++) {
    results.push(simulateRun(seedOffset + i * 13, classId, 30, turnCap));
    if (i % 50 === 0) {
      console.log(`[sim ${classId}] ${i}/${seedCount} 局完成`);
    }
  }
  return results;
}

export function simulateAll(seedsPerClass: number, turnCap = 3000): {
  summary: Record<string, unknown>;
  results: SimResult[];
} {
  const results: SimResult[] = [];
  for (const classId of SIM_CLASSES) {
    for (let i = 1; i <= seedsPerClass; i++) {
      results.push(simulateRun(1000 + i * 7, classId, 30, turnCap));
    }
  }
  const summary: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    seedsPerClass,
    classes: Object.fromEntries(
      SIM_CLASSES.map((c) => [c, summarize(results.filter((r) => r.classId === c))]),
    ),
  };
  return { summary, results };
}

export function writeSimReport(seedsPerClass: number, turnCap = 3000): Record<string, unknown> {
  const { summary, results } = simulateAll(seedsPerClass, turnCap);
  mkdirSync('work', { recursive: true });
  writeFileSync('work/sim-results.json', JSON.stringify({ summary, results }, null, 1), 'utf8');
  return summary;
}
