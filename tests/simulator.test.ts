import { describe, expect, it } from 'vitest';
import { simulateAll, writeSimReport, SIM_CLASSES } from '../src/simulator';
import { Game } from '../src/game';

/**
 * 里程碑 6/7：无头平衡模拟器。
 * CI 快速档：每职业 2 seeds、回合上限 1200（约 1 分钟）——覆盖 1-2 层死亡率与早期经济。
 * 深跑档：SIM_SEEDS=40 SIM_TURNCAP=6000 本地手动运行（不计入 CI，运行时间 30-120 分钟）。
 * 结果写入 work/sim-results.json。
 */
const seedsPerClass = Number(process.env.SIM_SEEDS ?? '2');
const turnCap = Number(process.env.SIM_TURNCAP ?? '1200');

describe('里程碑 6/7：无头平衡模拟器', () => {
  it('三职业各跑多个 seed 并产出结构化结果', () => {
    const { summary, results } = simulateAll(seedsPerClass, turnCap);
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
    const report = writeSimReport(seedsPerClass, turnCap);
    expect(Object.keys(report.classes as object).length).toBe(3);
  }, 300000);

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
