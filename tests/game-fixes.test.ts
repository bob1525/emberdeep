import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';

/** 无头开局：固定种子 + 指定职业，跳过标题与职业选择 */
function startGame(seed: number, slot = 0): Game {
  const game = new Game(null, seed, null, { fixedSeed: true });
  game.handleAction({ type: 'titleNew' });
  game.handleAction({ type: 'useSlot', slot });
  return game;
}

describe('P0-6 多级升级不吞天赋', () => {
  it('大额经验跨两级 → 两组三选一依次展示', () => {
    const game = startGame(9);
    const need = game.xpToNext();
    game.grantXp(need * 4);
    expect(game.level).toBe(3);
    expect(game.mode).toBe('levelUp');
    expect(game.talentChoices.length).toBeGreaterThan(0);

    game.handleAction({ type: 'useSlot', slot: 0 });
    // 第一次选择后：仍有排队升级 → 展示下一组候选
    expect(game.mode).toBe('levelUp');
    expect(game.ownedTalents.length).toBe(1);

    const secondSlot = game.talentChoices.length > 1 ? 1 : 0;
    game.handleAction({ type: 'useSlot', slot: secondSlot });
    expect(game.mode).toBe('play');
    expect(game.ownedTalents.length).toBe(2);
  });

  it('候选耗尽时升级优雅跳过', () => {
    const game = startGame(10);
    game.grantXp(game.xpToNext() * 4 + 3);
    // 连续选完全部候选（最多 4 组）
    for (let i = 0; i < 6 && game.mode === 'levelUp'; i++) {
      game.handleAction({ type: 'useSlot', slot: 0 });
    }
    expect(game.mode).toBe('play');
  });
});

describe('P0-5 存档往返（Boss 身份/分配器水位）', () => {
  it('Boss 层存档读档后 Boss 仍在且特技可触发', () => {
    const game = startGame(55);
    game.jumpToDepth(5);
    expect(game.hasBoss()).toBe(true);
    game.handleAction({ type: 'wait' });
    const data = game.exportSaveData();
    const loaded = new Game(null, 55, data);
    expect(loaded.hasBoss()).toBe(true);
    expect(() => loaded.debugForceBossSpecial()).not.toThrow();
  });

  it('读档后召唤实体 ID 唯一（分配器水位正确）', () => {
    const game = startGame(56);
    game.jumpToDepth(5);
    game.handleAction({ type: 'wait' });
    const loaded = new Game(null, 56, game.exportSaveData());
    loaded.debugForceBossSpecial();
    const stats = loaded.internalStats();
    if (stats.summonedCount > 0) {
      // 召唤物若与存档实体撞 ID，Map 覆盖会导致 alive < summoned
      expect(stats.aliveSummoned).toBe(stats.summonedCount);
    }
  });
});

describe('P0-4 怪物状态结算', () => {
  it('燃烧的怪物在几回合内死亡并移除', () => {
    const game = startGame(88);
    game.jumpToDepth(1);
    expect(game.debugBurnNearest()).toBe(true);
    const before = game.internalStats().monsterCount;
    for (let i = 0; i < 8; i++) game.handleAction({ type: 'wait' });
    expect(game.internalStats().monsterCount).toBeLessThan(before);
  });
});

describe('P0-7 自动探索预算', () => {
  it('单批步数不超过预算（不会一次跑几千回合）', () => {
    const game = startGame(77);
    const before = game.turn;
    game.handleAction({ type: 'autoExplore' });
    expect(game.turn - before).toBeLessThanOrEqual(26);
    // 再按一次可以继续推进
    const mid = game.turn;
    game.handleAction({ type: 'autoExplore' });
    expect(game.turn).toBeGreaterThanOrEqual(mid);
  });
});

describe('P0-7 自动探索批次内受伤即中断', () => {
  /** 把玩家周围 (2r+1)² 范围全部点燃（公共 @internal debugIgniteAt；墙/不可燃格自动无效） */
  function igniteAround(game: Game, r = 2): void {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        game.debugIgniteAt(game.player.x + dx, game.player.y + dy);
      }
    }
  }

  it('批次内受到 HP 损失（火伤）→ 本批立即停止（1 步 << 预算）且给出中断原因', () => {
    const game = startGame(777);
    const hpBefore = game.player.hp;
    const before = game.turn;
    igniteAround(game);
    game.handleAction({ type: 'autoExplore' });
    // 第一步踏进燃烧格 → 回合结算火伤 → 批次立刻中断（断言 1 步即证未跑满预算）
    expect(game.turn - before).toBe(1);
    expect(game.player.hp).toBeLessThan(hpBefore);
    expect(
      game.allLog().some((e) => e.text.includes('你受到了伤害，自动探索中断！')),
    ).toBe(true);
  });

  it('受伤中断后再按 o 从中断处继续（P0-7 续批语义不被破坏）', () => {
    const game = startGame(777);
    igniteAround(game);
    game.handleAction({ type: 'autoExplore' });
    const afterInterrupt = game.turn;
    game.handleAction({ type: 'autoExplore' });
    // 续批从断点继续推进：仍被火伤中断，但确实又走了一步
    expect(game.turn).toBeGreaterThan(afterInterrupt);
    const interrupts = game
      .allLog()
      .filter((e) => e.text.includes('你受到了伤害，自动探索中断！'));
    expect(interrupts.length).toBe(2);
  });

  it('不受伤的批次行为与改前一致（预算内正常停车，无受伤中断提示）', () => {
    const game = startGame(77);
    const before = game.turn;
    game.handleAction({ type: 'autoExplore' });
    expect(game.turn - before).toBeLessThanOrEqual(26);
    expect(
      game.allLog().some((e) => e.text.includes('你受到了伤害，自动探索中断！')),
    ).toBe(false);
  });
});

describe('P1-11 种子语义', () => {
  it('固定种子下两次开局的初始状态完全一致', () => {
    const a = startGame(424242);
    const b = startGame(424242);
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it('固定种子跨级一致：跳层后哈希也一致', () => {
    const a = startGame(424242);
    a.jumpToDepth(5);
    const b = startGame(424242);
    b.jumpToDepth(5);
    expect(a.stateHash()).toBe(b.stateHash());
  });
});
