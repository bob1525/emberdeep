import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { InventoryEconomyService } from '../src/economy/inventoryService';
import {
  DEFAULT_KEY_STRIDE,
  FIRE_TICK_DAMAGE,
  extinguish,
  ignite,
  isBurning,
  isSmoky,
  newFireState,
} from '../src/world/fire';
import type { FireState } from '../src/world/fire';
import { applyStatus } from '../src/engine/statuses';
import { allocateItemUid, makeActor } from '../src/entities/actor';
import type { Actor } from '../src/entities/actor';
import { GameMap } from '../src/world/map';
import { Rng } from '../src/engine/rng';
import { parseSaveData } from '../src/engine/saveSchema';
import type { Effect } from '../src/ui/renderer';

/** 无头开局：固定种子 + 指定职业，跳过标题与职业选择 */
function startGame(seed: number, slot = 0): Game {
  const game = new Game(null, seed, null, { fixedSeed: true });
  game.handleAction({ type: 'titleNew' });
  game.handleAction({ type: 'useSlot', slot });
  return game;
}

/** y*80+x 格索引（DEFAULT_KEY_STRIDE，与集成层 key 编码一致） */
function keyAt(x: number, y: number): number {
  return y * DEFAULT_KEY_STRIDE + x;
}

/** 火势状态快照（key 升序），供两个 Game 的逐回合确定性比对 */
function fireSnapshot(state: FireState): {
  fire: [number, number][];
  smoke: [number, number][];
} {
  return {
    fire: [...state.fire.entries()].sort((a, b) => a[0] - b[0]),
    smoke: [...state.smoke.entries()].sort((a, b) => a[0] - b[0]),
  };
}

/** 八邻方向（与 turnEngine 的避火尝试次序一致：dy 优先、dx 升序） */
const NEIGHBORS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

describe('点燃来源：烈焰卷轴', () => {
  it('applyFireblast：命中目标周边 1 格地面全部点燃（全地板图上恰为 3×3）', () => {
    const fire = newFireState();
    const logs: string[] = [];
    const effects: Effect[] = [];
    const map = GameMap.filled(9, 9, 'floor');
    const target = makeActor({
      species: 'rat',
      name: '鼠人',
      glyph: 'r',
      color: '#b0a080',
      x: 4,
      y: 4,
      hp: 100,
      maxHp: 100,
    });
    const player = makeActor({
      side: 'player',
      species: 'player',
      name: '你',
      glyph: '@',
      color: '#f5b04c',
      x: 2,
      y: 2,
      hp: 30,
      maxHp: 30,
      inventory: [{ uid: allocateItemUid(), catalogId: 'fireblast', category: 'scroll' }],
      equipment: { weapon: null, armor: null },
    });
    const service = new InventoryEconomyService({
      player,
      rng: new Rng(7),
      map,
      groundItems: [],
      goldPiles: [],
      merchant: null,
      depth: 1,
      turn: 0,
      getGold: () => 0,
      addGold: () => {},
      setMightUntil: () => {},
      effects,
      deleteAffixData: () => {},
      affixUids: () => [],
      talentGoldBonus: () => 0,
      visibleTargets: () => [target],
      killMonster: () => {},
      // 与门面 igniteCell 同构：key 编码 + 燃料语义 + ignite
      igniteCell: (x, y) => {
        const key = y * DEFAULT_KEY_STRIDE + x;
        const wasBurning = fire.fire.has(key);
        ignite(fire, key, map.tileAt(x, y) === 'wall' ? 'wall' : 'oil');
        return !wasBurning && fire.fire.has(key);
      },
      log: (text) => {
        logs.push(text);
      },
    });

    expect(service.castFireblast()).toBe(true);
    expect(player.inventory.some((it) => it.catalogId === 'fireblast')).toBe(false); // 卷轴消耗
    expect(target.hp).toBeLessThan(100); // 直接伤害仍生效
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        expect(isBurning(fire, keyAt(4 + dx, 4 + dy))).toBe(true);
      }
    }
    expect(fire.fire.get(keyAt(4, 4))).toBe(6); // 地板按油渍级燃料烧 6 回合
    expect(fire.fire.size).toBe(9);
    expect(logs.some((t) => t.includes('引燃了地面'))).toBe(true);
  });
});

describe('点燃来源：余烬幽魂陨落', () => {
  it('余烬幽魂死亡时脚下格点燃（killMonster 按 species 判定）', () => {
    // 固定种子扫描一块第 5 层有幽魂的地图：生成确定，扫描过程确定
    let game: Game | null = null;
    let wraith: Actor | null = null;
    for (let seed = 1; seed <= 40 && !wraith; seed++) {
      const g = startGame(seed);
      g.jumpToDepth(5);
      wraith = g.debugMonsters().find((m) => m.species === 'ember_wraith') ?? null;
      if (wraith) game = g;
    }
    expect(game).not.toBeNull();
    expect(wraith).not.toBeNull();
    const g = game as Game;
    const w = wraith as Actor;
    // 压到 2 点血：下个怪物阶段燃烧结算必死（死亡先于移动，坐标不变）
    w.hp = 2;
    applyStatus(w, 'burn', 3, 2);
    const deathKey = keyAt(w.x, w.y);
    for (let i = 0; i < 6 && g.debugMonsters().includes(w); i++) {
      g.handleAction({ type: 'wait' });
    }
    expect(g.debugMonsters().includes(w)).toBe(false);
    expect(isBurning(g.debugFireState(), deathKey)).toBe(true);
    // 点燃燃料 6，但同回合的火势结算立即递减 1（击杀发生在怪物阶段、结算在其后）
    expect(g.debugFireState().fire.get(deathKey)).toBe(6 - 1);
  });
});

describe('每回合结算：火伤与烟雾', () => {
  it('站在燃烧格上的玩家每回合受 FIRE_TICK_DAMAGE，致死记录死因「烈火」', () => {
    const game = startGame(42);
    expect(game.debugIgniteAt(game.player.x, game.player.y)).toBe(true);
    const playerKey = keyAt(game.player.x, game.player.y);
    const hpBefore = game.player.hp;
    game.handleAction({ type: 'wait' });
    // 怪物至少出生在 8 格外（MONSTER_MIN_CHEB），首个等待回合不可能有近战干扰
    expect(game.player.hp).toBe(hpBefore - FIRE_TICK_DAMAGE);
    expect(isSmoky(game.debugFireState(), playerKey)).toBe(true); // 燃烧产生烟雾（本轮仅视觉）
    game.player.hp = FIRE_TICK_DAMAGE;
    game.handleAction({ type: 'wait' });
    expect(game.dead).toBe(true);
    expect(game.deathCause).toBe('烈火');
    expect(game.allLog().some((e) => e.text.includes('烈火灼烧着你'))).toBe(true);
  });

  it('被火围困的怪物受伤致死并走 killMonster 结算', () => {
    const game = startGame(88);
    const m = game.debugMonsters()[0] as Actor;
    expect(m).toBeDefined();
    // 九宫格全部点燃：避火无出口，AI 也只能留在火里
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        game.debugIgniteAt(m.x + dx, m.y + dy);
      }
    }
    m.hp = FIRE_TICK_DAMAGE;
    const killsBefore = game.kills;
    game.handleAction({ type: 'wait' });
    expect(game.kills).toBe(killsBefore + 1);
    expect(game.debugMonsters().includes(m)).toBe(false);
  });
});

describe('怪物避火', () => {
  it('站在燃烧格上的怪优先移向相邻非燃烧格（占用本回合行动）', () => {
    const game = startGame(42);
    // 找一只满足以下条件的怪：附近 2 格内没有同伴（防抢先占位），
    // 且八邻中存在可通行地板（debugIgniteAt 返回 true 即可通行地板）
    let chosen: { m: Actor; exit: { x: number; y: number } } | null = null;
    for (const m of game.debugMonsters()) {
      const others = game.debugMonsters().filter((o) => o !== m);
      if (
        others.some((o) => Math.max(Math.abs(o.x - m.x), Math.abs(o.y - m.y)) <= 2)
      ) {
        continue;
      }
      const state = game.debugFireState();
      state.fire.clear(); // 探针点燃会污染下一只候选的判定，先清场
      let exit: { x: number; y: number } | null = null;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = m.x + dx;
        const ny = m.y + dy;
        if (others.some((o) => o.x === nx && o.y === ny)) continue;
        if (game.player.x === nx && game.player.y === ny) continue;
        if (game.debugIgniteAt(nx, ny)) {
          if (!exit) {
            exit = { x: nx, y: ny };
            // 首个可通行邻格留作避火出口，其余全部保持燃烧
            extinguish(state, keyAt(nx, ny));
          }
        }
      }
      if (exit && game.debugIgniteAt(m.x, m.y)) {
        chosen = { m, exit };
        break;
      }
    }
    expect(chosen).not.toBeNull();
    const { m, exit } = chosen as { m: Actor; exit: { x: number; y: number } };
    expect(isBurning(game.debugFireState(), keyAt(m.x, m.y))).toBe(true);
    game.handleAction({ type: 'wait' });
    // 避火移动占用本回合行动：怪已站到唯一出口上（后续蔓延不影响位置）
    expect(m.x).toBe(exit.x);
    expect(m.y).toBe(exit.y);
  });
});

describe('换层重置', () => {
  it('本层未烧尽的火不会带到下一层（buildFloor 重置 FireState）', () => {
    const game = startGame(9);
    game.debugIgniteAt(game.player.x, game.player.y);
    expect(game.debugFireState().fire.size).toBeGreaterThan(0);
    game.jumpToDepth(3);
    expect(game.debugFireState().fire.size).toBe(0);
    expect(game.debugFireState().smoke.size).toBe(0);
  });
});

describe('存档持久化', () => {
  /** 最小合法 v1 存档骨架（与 saveSchema.test.ts 同构，挂载 fire 字段做变体） */
  function minimalSave(fire?: unknown): Record<string, unknown> {
    return {
      version: 1,
      depth: 1,
      turn: 3,
      level: 1,
      xp: 0,
      gold: 0,
      mightUntil: 0,
      runSeed: 12345,
      kills: 0,
      deathCause: '未知',
      player: {
        id: 1,
        side: 'player',
        species: 'player',
        name: '你',
        glyph: '@',
        color: '#f5b04c',
        x: 2,
        y: 2,
        hp: 30,
        maxHp: 30,
        attack: 4,
        defense: 1,
        xpValue: 0,
        statuses: [],
        energy: 0,
        inventory: [],
        equipment: { weapon: null, armor: null },
        ai: null,
      },
      monsters: [],
      groundItems: [],
      traps: [],
      shrines: [],
      explored: [],
      stairsDown: { x: 1, y: 1 },
      mapWidth: 5,
      mapHeight: 5,
      mapTiles: new Array(25).fill('floor'),
      rngState: 999,
      ...(fire === undefined ? {} : { fire }),
    };
  }

  it('schema：fire 字段（[key, 剩余回合] 对的数组）合法即通过，结构损坏被拒绝', () => {
    expect(parseSaveData(minimalSave({ fire: [[37, 6]], smoke: [[38, 12]] })).ok).toBe(true);
    expect(parseSaveData(minimalSave({ fire: [], smoke: [], burned: [37, 38] })).ok).toBe(true);
    expect(parseSaveData(minimalSave({ fire: [], smoke: [] })).ok).toBe(true); // burned 缺省容忍
    expect(parseSaveData(minimalSave({ fire: [['oops', 1]], smoke: [] })).ok).toBe(false);
    expect(parseSaveData(minimalSave({ fire: 'nope', smoke: [] })).ok).toBe(false);
    expect(parseSaveData(minimalSave({ fire: [[37]], smoke: [] })).ok).toBe(false);
    expect(parseSaveData(minimalSave({ fire: [[37, 'x']], smoke: [] })).ok).toBe(false);
    expect(parseSaveData(minimalSave({ fire: [], smoke: [], burned: ['x'] })).ok).toBe(false);
    expect(parseSaveData(minimalSave({ fire: [], smoke: [], burned: 'nope' })).ok).toBe(false);
  });

  it('exportSaveData 的 fire 字段结构即 schema 接受的形态；旧档（无 fire 字段）读入正常', () => {
    const game = startGame(31);
    game.debugIgniteAt(game.player.x, game.player.y);
    const save = game.exportSaveData();
    expect(save.fire).toBeDefined();
    expect(save.fire?.fire.length).toBeGreaterThan(0);
    expect(Array.isArray(save.fire?.smoke)).toBe(true);
    // 生产链路是 JSON 序列化落盘：形状经 JSON 往返后不变
    const roundTripped = JSON.parse(JSON.stringify(save)) as typeof save;
    expect(roundTripped.fire).toEqual(save.fire);

    // 旧存档（无 fire 字段）读入：火势为空态且可继续游玩
    delete (roundTripped as unknown as Record<string, unknown>).fire;
    const loaded = new Game(null, 99, roundTripped);
    expect(loaded.debugFireState().fire.size).toBe(0);
    expect(loaded.debugFireState().smoke.size).toBe(0);
    expect(() => loaded.handleAction({ type: 'wait' })).not.toThrow();
  });
});

describe('全链集成（simTurn 驱动）：点燃 → 蔓延 → 伤害 → 熄灭 → 存档往返', () => {
  it('蔓延与燃尽：同动作流逐回合火势与状态哈希完全一致', () => {
    const seed = 4242;
    const igniteBlock = (g: Game): number => {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (g.debugIgniteAt(g.player.x + dx, g.player.y + dy)) n += 1;
        }
      }
      return n;
    };
    // 运行时强化（仅测试内调整）：整层火场清扫需百余回合，期间怪物持续骚扰——
    // 高血量 + 高防御（每击伤害钳到 1）保证观察窗口内玩家不死、火势 tick 不被冻结
    const boostHp = (g: Game): void => {
      g.player.maxHp += 5000;
      g.player.hp += 5000;
      g.player.defense += 500;
    };

    const a = startGame(seed);
    boostHp(a);
    const initial = igniteBlock(a);
    expect(initial).toBeGreaterThan(0);
    const b = startGame(seed);
    boostHp(b);
    expect(igniteBlock(b)).toBe(initial);

    // 第一阶段：simTurn 驱动（机器人走真实动作链），逐回合确定性比对
    let maxFire = initial;
    let maxSmoke = 0;
    for (let i = 0; i < 4; i++) {
      a.simTurn();
      b.simTurn();
      expect(fireSnapshot(a.debugFireState())).toEqual(fireSnapshot(b.debugFireState()));
      expect(a.stateHash()).toBe(b.stateHash());
      maxFire = Math.max(maxFire, a.debugFireState().fire.size);
      maxSmoke = Math.max(maxSmoke, a.debugFireState().smoke.size);
    }
    expect(maxFire).toBeGreaterThan(initial); // 蔓延确实发生过
    expect(maxSmoke).toBeGreaterThan(0); // 燃烧产生烟雾
    expect(a.allLog().some((e) => e.text.includes('烈火灼烧着你'))).toBe(true); // 玩家火伤结算
    expect(a.dead).toBe(false);

    // 第二阶段：原地等待驱动（wait 同样走 endPlayerTurn 的完整 tick 路径），
    // 火在无玩家位移干扰下自行蔓延、烧毁地面、烧尽、烟散
    // （火场前沿以 ~1 格/回合的速度扫过走廊，整层烧尽需百余回合，cap 放宽到 500）
    for (let i = 0; i < 500; i++) {
      if (a.debugFireState().fire.size === 0 && a.debugFireState().smoke.size === 0) break;
      // 火伤击杀会授予经验触发升级三选一：该界面下 wait 不推进回合，先选天赋
      if (a.mode === 'levelUp') {
        expect(b.mode).toBe('levelUp');
        a.handleAction({ type: 'useSlot', slot: 0 });
        b.handleAction({ type: 'useSlot', slot: 0 });
        expect(a.mode).toBe('play');
        continue;
      }
      a.handleAction({ type: 'wait' });
      b.handleAction({ type: 'wait' });
      expect(fireSnapshot(a.debugFireState())).toEqual(fireSnapshot(b.debugFireState()));
      expect(a.stateHash()).toBe(b.stateHash());
      maxFire = Math.max(maxFire, a.debugFireState().fire.size);
      maxSmoke = Math.max(maxSmoke, a.debugFireState().smoke.size);
    }
    expect(a.debugFireState().fire.size).toBe(0); // 燃尽自然熄灭
    expect(a.debugFireState().smoke.size).toBe(0); // 烟也散尽
    expect(maxFire).toBeGreaterThan(initial);
    expect(maxSmoke).toBeGreaterThan(0);
    // 烧毁契约：烧过的格子永久失去燃料（存档 burned 字段随之积累）
    const saveAtBurnout = a.exportSaveData();
    expect(saveAtBurnout.fire?.burned?.length ?? 0).toBeGreaterThan(initial);
  });

  it('存档往返：读档局与原局从中断点继续，火势与总状态逐回合一致', () => {
    const seed = 1717;
    const c = startGame(seed);
    c.player.maxHp += 5000;
    c.player.hp += 5000;
    c.player.defense += 500;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        c.debugIgniteAt(c.player.x + dx, c.player.y + dy);
      }
    }
    // 导出存档（此刻尚未跑过任何回合：无 autoPath 等未持久化的瞬态）。
    // 生产链路经 localStorage JSON 序列化（断开对象引用），测试同样走 JSON 往返。
    const restored = new Game(null, seed, JSON.parse(JSON.stringify(c.exportSaveData())) as ReturnType<Game['exportSaveData']>);
    expect(fireSnapshot(restored.debugFireState())).toEqual(fireSnapshot(c.debugFireState()));
    for (let i = 0; i < 25; i++) {
      c.simTurn();
      restored.simTurn();
      expect(fireSnapshot(restored.debugFireState())).toEqual(fireSnapshot(c.debugFireState()));
      expect(c.stateHash()).toBe(restored.stateHash());
    }
  });
});
