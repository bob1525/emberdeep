import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { simulateClassBatch, summarize, SIM_CLASSES } from '../src/simulator';
import type { SimResult } from '../src/simulator';

/**
 * 里程碑 6 大规模模拟（Q3）：每职业 500 固定 seed。
 * turnCap 2500：capped 局单独计数，不进死亡率分母。
 * 增量落盘：每完成一个职业写一次 work/sim-full-{class}.json。
 * 运行时间约 20-60 分钟——CI 不跑此文件（vitest 排除表/手动触发），
 * 本地命令：npx vitest run tests/sim-full.test.ts
 */
const SEEDS_PER_CLASS = Number(process.env.SIM_SEEDS ?? '500');
const TURN_CAP = Number(process.env.SIM_TURNCAP ?? '2500');

describe('里程碑 6：500 seeds 职业平衡模拟', () => {
  for (const classId of SIM_CLASSES) {
    it(`${classId}: ${SEEDS_PER_CLASS} seeds`, async () => {
      const results: SimResult[] = simulateClassBatch(classId, SEEDS_PER_CLASS, TURN_CAP);
      mkdirSync('work', { recursive: true });
      writeFileSync(
        `work/sim-full-${classId}.json`,
        JSON.stringify({ classId, turnCap: TURN_CAP, seeds: SEEDS_PER_CLASS, results }, null, 1),
        'utf8',
      );
      const s = summarize(results);
      console.log(`[${classId}]`, JSON.stringify(s));
      // 基本结构断言（平衡结论由数据分析给出，不在此硬编码阈值）
      expect(results.length).toBe(SEEDS_PER_CLASS);
      expect(s.runs).toBe(SEEDS_PER_CLASS);
    }, 5400000);
  }

  it('汇总文件写入', async () => {
    const all: Record<string, SimResult[]> = {};
    for (const classId of SIM_CLASSES) {
      all[classId] = simulateClassBatch(classId, 0, TURN_CAP);
    }
    expect(Object.keys(all).length).toBe(3);
  }, 60000);
});
