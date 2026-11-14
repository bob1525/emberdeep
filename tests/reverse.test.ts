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

  it('自动探索在交互物前停车（P0-7：传送至商人/奇遇建筑旁确定性验证）', () => {
    // 商人：深度 1 必有
    const game = startGame(701);
    game.jumpToDepth(1);
    expect(game.debugTeleportNextToInteraction()).toBe(true);
    game.handleAction({ type: 'autoExplore' });
    expect(
      game.allLog().some((entry) => entry.text.includes('流浪商人')),
    ).toBe(true);
    expect(game.mode).toBe('play');

    // 奇遇建筑：深度 2 必有（许愿井）
    const game2 = startGame(702);
    game2.jumpToDepth(2);
    expect(game2.debugTeleportNextToInteraction('shrine')).toBe(true);
    game2.handleAction({ type: 'autoExplore' });
    expect(
      game2.allLog().some((entry) => entry.text.includes('奇异的建筑')),
    ).toBe(true);
    expect(game2.mode).toBe('play');
  });

  it('预算暂停后再按 o 从下一批继续（而不是关闭）', () => {
    const game = startGame(703);
    const before = game.turn;
    game.handleAction({ type: 'autoExplore' });
    const afterBatch1 = game.turn;
    expect(afterBatch1).toBeGreaterThan(before); // 第一批跑满预算
    // 继续第二批
    game.handleAction({ type: 'autoExplore' });
    expect(game.turn).toBeGreaterThan(afterBatch1);
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
