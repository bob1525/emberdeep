/** 一次性补丁：simTurn 支持 targeting 模式开火（修游侠 useSkill 死循环） */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/game.ts';
let s = readFileSync(path, 'utf8');
const anchor = "simTurn(): 'playing' | 'dead' {";
const oldSeg =
  "    if (this.dead) return 'dead';\n    if (this.mode === 'shop' || this.mode === 'inventory') {";
const newSeg = [
  "    if (this.dead) return 'dead';",
  "    if (this.mode === 'targeting') {",
  '      // 游侠精准箭：瞄准模式朝最近敌人开火（否则关闭，防 useSkill 死循环）',
  '      const targets = this.visibleTargets();',
  '      if (targets.length > 0) {',
  '        const t = targets.reduce((a, b) =>',
  '          Math.max(Math.abs(b.x - this.player.x), Math.abs(b.y - this.player.y)) <',
  '          Math.max(Math.abs(a.x - this.player.x), Math.abs(a.y - this.player.y))',
  '            ? b',
  '            : a,',
  '        );',
  '        this.handleAction({',
  '          type: "move",',
  '          dx: Math.max(-1, Math.min(1, t.x - this.player.x)),',
  '          dy: Math.max(-1, Math.min(1, t.y - this.player.y)),',
  '        });',
  '      } else {',
  "        this.handleAction({ type: 'closeOverlay' });",
  '      }',
  "      return this.dead ? 'dead' : 'playing';",
  '    }',
  "    if (this.mode === 'shop' || this.mode === 'inventory') {",
].join('\n');
if (!s.includes(oldSeg)) {
  console.error('old segment not found（可能已应用）');
  process.exit(0);
}
s = s.replace(oldSeg, newSeg);
writeFileSync(path, s);
console.log('targeting-fire fix applied');
