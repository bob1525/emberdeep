#!/usr/bin/env node
/**
 * M5/M6/M7 模拟数据分析：读 work/sim-full-{class}.json，输出职业平衡与性能百分位报告。
 * 用法：node scripts/analyze-sim.mjs [--json]
 * 数据来源：npx vitest run --config vitest.manual.config.ts tests/sim-full.test.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const workDir = join(import.meta.dirname, '..', 'work');

/** 百分位（线性插值） */
function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const stats = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return {
    n: s.length,
    mean: s.length ? Math.round(s.reduce((x, y) => x + y, 0) / s.length * 10) / 10 : 0,
    p50: Math.round(pct(s, 0.5)),
    p95: Math.round(pct(s, 0.95)),
    p99: Math.round(pct(s, 0.99)),
    max: s.length ? s[s.length - 1] : 0,
  };
};

const classes = ['warrior', 'ranger', 'mage'];
const report = {};
const jsonOut = process.argv.includes('--json');

for (const cls of classes) {
  const file = join(workDir, `sim-full-${cls}.json`);
  if (!existsSync(file)) {
    report[cls] = { error: `缺少 ${file}（先跑深跑档）` };
    continue;
  }
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const results = data.results ?? [];

  // 结局分类：dead=战死 / win=到达 30 层 / capped=回合上限 / deadlock=回合冻结保险丝
  const outcomes = { dead: 0, win: 0, capped: 0, deadlock: 0 };
  const deathFloors = {};
  const floor1Deaths = [];
  const alive = [];
  for (const r of results) {
    if (r.dead) {
      outcomes.dead += 1;
      // cause 只是凶手名（骷髅兵/中毒/献祭祭坛…），死亡层取 maxDepth
      const fl = r.maxDepth ?? 0;
      deathFloors[fl] = (deathFloors[fl] ?? 0) + 1;
      if (fl === 1) floor1Deaths.push(r);
    } else if (r.reached30) {
      outcomes.win += 1;
      alive.push(r);
    } else if ((r.cause ?? '').includes('回合冻结')) {
      outcomes.deadlock += 1;
    } else {
      outcomes.capped += 1;
    }
  }
  const cappedDenominator = results.length - outcomes.capped - outcomes.deadlock;

  report[cls] = {
    seeds: results.length,
    turnCap: data.turnCap,
    outcomes,
    // 死亡率：分母排除 capped/deadlock 局（终局协议要求）
    deathRate: `${Math.round((outcomes.dead / Math.max(1, cappedDenominator)) * 100)}%`,
    floor1DeathRate: `${Math.round((deathFloors[1] ?? 0) / Math.max(1, cappedDenominator) * 100)}%`,
    deathFloorDist: Object.fromEntries(Object.entries(deathFloors).sort((a, b) => a[0] - b[0])),
    depth: stats(results.map((r) => r.maxDepth)),
    turns: stats(results.map((r) => r.turns)),
    kills: stats(results.map((r) => r.kills)),
    gold: stats(results.map((r) => r.gold)),
    level: stats(results.map((r) => r.level)),
    // M7 性能
    perf: {
      durationMs: stats(results.map((r) => r.durationMs)),
      astarCalls: stats(results.map((r) => r.astarCalls)),
      snapshotBytes: stats(results.map((r) => r.snapshotBytes)),
    },
  };
}

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const [cls, r] of Object.entries(report)) {
    if (r.error) { console.log(`${cls}: ${r.error}`); continue; }
    console.log(`\n=== ${cls.toUpperCase()}（${r.seeds} seeds, turnCap ${r.turnCap}）===`);
    console.log(`结局: 战死 ${r.outcomes.dead} / 通关 ${r.outcomes.win} / capped ${r.outcomes.capped} / 冻结断开 ${r.outcomes.deadlock}`);
    console.log(`死亡率 ${r.deathRate} · 1 层死亡率 ${r.floor1DeathRate}`);
    console.log(`死亡层分布: ${JSON.stringify(r.deathFloorDist)}`);
    console.log(`深度 p50=${r.depth.p50} p95=${r.depth.p95} p99=${r.depth.p99} max=${r.depth.max} (mean ${r.depth.mean})`);
    console.log(`回合 p50=${r.turns.p50} p95=${r.turns.p95} p99=${r.turns.p99} max=${r.turns.max}`);
    console.log(`击杀 mean=${r.kills.mean} p95=${r.kills.p95} · 金币 mean=${r.gold.mean} · 等级 mean=${r.level.mean}`);
    console.log(`M7 性能: 单局耗时 p50=${r.perf.durationMs.p50}ms p95=${r.perf.durationMs.p95}ms max=${r.perf.durationMs.max}ms · A* p50=${r.perf.astarCalls.p50} p95=${r.perf.astarCalls.p95} max=${r.perf.astarCalls.max} · 快照 p50=${r.perf.snapshotBytes.p50}B max=${r.perf.snapshotBytes.max}B`);
  }
  // 横向对比一行结论
  const rows = classes.filter((c) => !report[c].error).map((c) => `${c}: 1层死 ${report[c].floor1DeathRate} / 总死 ${report[c].deathRate} / 深度p50 ${report[c].depth.p50}`);
  console.log(`\n横向: ${rows.join(' | ')}`);
}
