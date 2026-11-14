/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages 部署时用 `vite build --base=/emberdeep/` 覆盖
  base: '/',
  test: {
    environment: 'node',
    // sim-full.test.ts 是深跑档（500 seeds × 3 职业 × 2500 回合，20-60 分钟），
    // 仅限手动 `npx vitest run tests/sim-full.test.ts`——绝不进默认 npm test / CI
    exclude: ['**/sim-full.test.ts**'],
  },
});
