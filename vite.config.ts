/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages 部署时用 `vite build --base=/emberdeep/` 覆盖
  base: '/',
  test: {
    environment: 'node',
  },
});
