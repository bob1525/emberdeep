/** 一次性补丁：AI 寻路节点预算 + 模拟器回合上限收敛（M7 性能预算） */
import { readFileSync, writeFileSync } from 'node:fs';

const brainPath = 'src/engine/brain.ts';
let brain = readFileSync(brainPath, 'utf8');
const brainOld =
  '  const path = findPathWithFn({ x: self.x, y: self.y }, target, (x, y) => !isBlocked(x, y));';
const brainNew =
  '  // M7：AI 寻路节点预算（ chase 每次最多展开 600 节点，24 怪场景下回合成本可控）\n' +
  '  const path = findPathWithFn({ x: self.x, y: self.y }, target, (x, y) => !isBlocked(x, y), 600);';
if (!brain.includes(brainOld)) {
  console.error('brain old segment not found（可能已应用）');
} else {
  brain = brain.replace(brainOld, brainNew);
  writeFileSync(brainPath, brain);
  console.log('brain node budget applied');
}

const simPath = 'src/simulator.ts';
let sim = readFileSync(simPath, 'utf8');
const simOld = '  const TURN_CAP = 6000;';
const simNew = '  const TURN_CAP = 3000; // M7：模拟器单局回合预算收敛';
if (!sim.includes(simOld)) {
  console.error('sim old segment not found（可能已应用）');
} else {
  sim = sim.replace(simOld, simNew);
  writeFileSync(simPath, sim);
  console.log('sim turn cap applied');
}
