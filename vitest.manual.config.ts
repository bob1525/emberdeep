import { defineConfig, configDefaults } from 'vitest/config';

/**
 * 深跑档专用配置：允许 sim-full.test.ts（500 seeds × 3 职业 × 2500 回合，20-60 分钟）。
 * 默认配置（vite.config.ts）已把该文件排除出 npm test / CI；
 * 手动触发：npx vitest run --config vitest.manual.config.ts tests/sim-full.test.ts
 * 缩小规模：SIM_SEEDS=40 SIM_TURNCAP=6000 前缀同上
 */
export default defineConfig({
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude],
  },
});
