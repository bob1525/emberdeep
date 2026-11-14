import { describe, expect, it } from 'vitest';
import { simulateAll, writeSimReport, SIM_CLASSES } from '../src/simulator';
import { Game } from '../src/game';

/**
 * 里程碑 6/7：无头平衡模拟器。
 * 默认每职业 8 个 seed（CI 友好）；本地深度模拟用 SIM_SEEDS=40+ 运行。
 * 结果写入 work/sim-results.json。
 */
const seedsPerClass = Number(process.env.SIM_SEEDS ?? '8');

describe('里程碑 6/7：无头平衡模拟器', () => {
  it('三职业各跑多个 seed 并产出结构化结果', () => {
    const { summary, results } = simulateAll(seedsPerClass);
    expect(results.length).toBe(seedsPerClass * SIM_CLASSES.length);
    // 结构断言：摘要包含全部指标键
    const classes = summary.classes as Record<string, Record<string, unknown>>;
    for (const classId of SIM_CLASSES) {
      const s = classes[classId];
      expect(s).toBeDefined();
      expect(s?.runs).toBe(seedsPerClass);
      expect(s).toHaveProperty('avgMaxDepth');
      expect(s).toHaveProperty('reached10');
      expect(s).toHaveProperty('topDeathCauses');
      expect(s).toHaveProperty('avgAstarCallsPerRun');
    }
    // 落盘
    const report = writeSimReport(seedsPerClass);
    expect(Object.keys(report.classes as object).length).toBe(3);
  }, 600000);

  it('固定种子可复现：同 seed 两局状态哈希一致（模拟器确定性）', () => {
    const a = new Game(null, 987654, null, { fixedSeed: true });
    a.setSimMode(true);
    a.handleAction({ type: 'titleNew' });
    a.handleAction({ type: 'useSlot', slot: 0 });
    const b = new Game(null, 987654, null, { fixedSeed: true });
    b.setSimMode(true);
    b.handleAction({ type: 'titleNew' });
    b.handleAction({ type: 'useSlot', slot: 0 });
    for (let i = 0; i < 40; i++) {
      a.simTurn();
      b.simTurn();
      expect(a.stateHash()).toBe(b.stateHash());
    }
  }, 120000);
});
