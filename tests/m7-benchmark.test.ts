import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { makeActor, type Actor } from '../src/entities/actor';
import type { GameMap } from '../src/world/map';
import { MONSTERS } from '../src/entities/monsters';
import { pathfindingStats } from '../src/engine/pathfinding';

/** 无头开局：固定种子 + 指定职业，跳过标题与职业选择 */
function startGame(seed: number, slot = 0): Game {
  const game = new Game(null, seed, null, { fixedSeed: true });
  game.handleAction({ type: 'titleNew' });
  game.handleAction({ type: 'useSlot', slot });
  return game;
}

/** 基准测试需要的内部访问（map/monsters 为门面私有字段） */
interface GameInternals {
  map: GameMap;
  monsters: Actor[];
  player: Actor;
}

/** 在玩家周围 radius 内找 walkable 且无怪格，最多 n 个 */
function freeRingTiles(game: Game, radius: number, n: number): Array<{ x: number; y: number }> {
  const { map, monsters, player } = game as unknown as GameInternals;
  const occupied = new Set(monsters.map((m) => `${m.x},${m.y}`));
  const tiles: Array<{ x: number; y: number }> = [];
  for (let r = 1; r <= radius && tiles.length < n; r++) {
    for (let dy = -r; dy <= r && tiles.length < n; dy++) {
      for (let dx = -r; dx <= r && tiles.length < n; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = player.x + dx;
        const y = player.y + dy;
        if (!map.inBounds(x, y) || !map.isWalkable(x, y)) continue;
        if (occupied.has(`${x},${y}`)) continue;
        tiles.push({ x, y });
      }
    }
  }
  return tiles.slice(0, n);
}

/**
 * M7 最坏场景基准：24 只追击怪围城持续 150 回合。
 * 性能基准语义：玩家血量拉满禁死亡、每回合补员保持 24 活体——
 * 专注度量 AI 行为树 + A* 寻路在最坏怪物规模下的每回合成本。
 * 断言：回合必推进（无冻结）、A* 每回合有界、单回合耗时有界。
 */
describe('M7 最坏场景基准（24 怪围城）', () => {
  it('24 怪追击 150 回合：回合推进、A*/回合 ≤ 上限、耗时有界', () => {
    const game = startGame(4242);
    const g = game as unknown as GameInternals;
    const tpl = MONSTERS['rat'];
    if (!tpl) throw new Error('MONSTERS 缺少 rat 模板');
    const spawn = (): void => {
      // 死亡怪会被 killMonster 移出数组——活体数即数组长度
      for (const spot of freeRingTiles(game, 4, 24 - g.monsters.length)) {
        g.monsters.push(makeActor({ ...tpl, x: spot.x, y: spot.y, id: 9000 + g.monsters.length }));
      }
    };
    spawn();
    g.player.hp = 999999; // 禁死亡：基准专注 AI/寻路负载，不做公平性对抗

    const callsBefore = pathfindingStats.calls;
    const TURNS = 150;
    const t0 = performance.now();
    let frozen = 0;
    let lastTurn = game.turn;
    for (let i = 0; i < TURNS; i++) {
      game.simTurn();
      g.player.hp = 999999; // 怪物阶段后回满，防止意外死亡中断基准
      spawn(); // 补员：保持最坏怪量
      if (game.turn === lastTurn) frozen += 1;
      lastTurn = game.turn;
    }
    const elapsed = performance.now() - t0;

    // 回合推进：允许个别回合无动作（如被完全围死），不允许大面积冻结
    expect(frozen).toBeLessThanOrEqual(8);
    // A* 预算：每回合 ≤ 24 怪 × 2 次调用 × 2 倍余量
    const callsPerTurn = (pathfindingStats.calls - callsBefore) / TURNS;
    expect(callsPerTurn).toBeLessThanOrEqual(24 * 2 * 2);
    // 耗时：最坏场景平均单回合 < 10ms（本地基线 ~1-3ms，10ms 为回归红线）
    expect(elapsed / TURNS).toBeLessThan(10);
  });

  it('深层数据规模：跳至 15 层探索后快照有界（无病态增长）', () => {
    const game = startGame(777);
    game.jumpToDepth(15);
    // 跑一批探索制造真实探索足迹
    for (let i = 0; i < 40; i++) game.simTurn();
    const bytes = JSON.stringify(game.exportSaveData()).length;
    // 基线浅层快照 37-50KB；深层 explored/记忆增长应在数倍内（< 4 倍）
    expect(bytes).toBeLessThan(50 * 1024 * 4);
  });
});
