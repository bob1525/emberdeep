import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node 构建脚本允许 process/console
    files: ['scripts/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },
);
