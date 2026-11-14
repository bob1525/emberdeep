/**
 * 把仓库里所有受版本控制的文件打包成单个 Markdown 文件，
 * 方便交给其他 AI 做代码评审。
 * 用法：node scripts/make-llm-bundle.js [输出路径]
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const files = execSync('git ls-files', { cwd: root, encoding: 'utf8' })
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

const parts = [];
parts.push('# Emberdeep 余烬深渊 — 完整源码包\n');
parts.push('一款纯 TypeScript + Canvas 的浏览器 Roguelike（零运行时依赖，Vite 构建）。\n');
parts.push(`本文件由 scripts/make-llm-bundle.js 自动生成，包含全部 ${files.length} 个受版本控制的文件。\n`);
parts.push('## 文件清单\n');
for (const f of files) parts.push(`- ${f}`);
parts.push('\n---\n');
for (const f of files) {
  const content = readFileSync(join(root, f), 'utf8');
  const ext = f.split('.').pop() ?? '';
  parts.push(`\n## 文件：${f}\n`);
  parts.push('```' + ext);
  parts.push(content);
  parts.push('```');
}
const out = process.argv[2] ?? '../emberdeep-llm.md';
writeFileSync(out, parts.join('\n'), 'utf8');
console.log(`已生成 ${out}（${files.length} 个文件）`);
