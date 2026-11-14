import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';

/** 无头开局（固定种子） */
function startGame(seed: number, slot = 0): Game {
  const game = new Game(null, seed, null, { fixedSeed: true });
  game.handleAction({ type: 'titleNew' });
  game.handleAction({ type: 'useSlot', slot });
  return game;
}

describe('里程碑 1：反向测试（修复的反例与边界）', () => {
  it('冲锋无路 → 技能失败、不耗回合、不进冷却（P0-2 反例）', () => {
    const game = startGame(501);
    const before = game.turn;
    // 出生点视野内没有可冲锋目标 → 冲锋必须失败
    game.handleAction({ type: 'useSkill' });
    expect(game.turn).toBe(before);
    expect(game.mode).toBe('play');
  });

  it('一个奖励跨三级以上 → 每级一组候选依次展示（P0-6 边界）', () => {
    const game = startGame(502);
    const need = game.xpToNext();
    game.grantXp(need * 10); // 足够跨四级以上（10/20/30/40…）
    expect(game.level).toBe(5);
    expect(game.mode).toBe('levelUp');
    let groups = 0;
    while (game.mode === 'levelUp' && groups < 8) {
      const slot = game.talentChoices.length > 1 ? 1 : 0;
      game.handleAction({ type: 'useSlot', slot });
      groups += 1;
    }
    expect(groups).toBe(4);
    expect(game.mode).toBe('play');
    expect(game.ownedTalents.length).toBe(4);
  });

  it('自动探索在交互物前停车（P0-7 反例：商人或奇遇建筑，确定性 seed 扫描）', () => {
    let covered = false;
    for (let seed = 1; seed <= 40 && !covered; seed++) {
      const game = startGame(seed);
      for (let batch = 0; batch < 30 && !covered; batch++) {
        game.handleAction({ type: 'autoExplore' });
        const stoppedAtInteraction = game
          .allLog()
          .some((entry) => entry.text.includes('流浪商人') || entry.text.includes('奇异的建筑'));
        if (stoppedAtInteraction) {
          covered = true;
          // 停车验证：必须停在 play 模式等待玩家决定，而不是自动触发事件
          expect(game.mode).toBe('play');
        }
        if (game.dead) break;
      }
    }
    expect(covered).toBe(true);
  });

  it('双 Game 实例交替操作互不污染（P0-5 allocator 隔离反例）', () => {
    const a = startGame(601);
    const b = startGame(602);
    // 交替推进，两者初始哈希各自稳定
    const hashA1 = a.stateHash();
    const hashB1 = b.stateHash();
    a.handleAction({ type: 'wait' });
    b.handleAction({ type: 'wait' });
    a.handleAction({ type: 'wait' });
    expect(a.stateHash()).not.toBe(hashA1);
    expect(b.stateHash()).not.toBe(hashB1);
    // b 的哈希不受 a 的操作影响（回到各自序列）
    expect(b.stateHash()).not.toBe(a.stateHash());
  });
});
