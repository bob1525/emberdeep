import { describe, expect, it } from 'vitest';
import { Rng } from '../src/engine/rng';
import {
  BASE_SPREAD_CHANCE,
  DEFAULT_KEY_STRIDE,
  FIRE_TICK_DAMAGE,
  OIL_SPREAD_BONUS,
  SMOKE_LIFETIME,
  extinguish,
  fuelOf,
  ignite,
  isBurning,
  isSmoky,
  newFireState,
  tickFire,
} from '../src/world/fire';
import type { FireEvent, FireState } from '../src/world/fire';

/** 概率受控的假 Rng：next 恒返回固定值（0 → 必然蔓延；0.99 → 必不蔓延） */
function riggedRng(value: number): Rng {
  return { next: () => value } as unknown as Rng;
}

/**
 * 字符画地图 → fuelAt：'d'=木门 'o'=油渍 '.'=地板 '#'=墙，越界一律墙。
 * 测试地图四周留一圈墙，避免 y*width+x 编码下的跨行环绕邻接干扰断言。
 */
function gridFuel(rows: string[], stride: number): (key: number) => string {
  return (key: number) => {
    if (key < 0) return 'wall';
    const y = Math.floor(key / stride);
    const x = key - y * stride;
    const ch = rows[y]?.[x];
    if (ch === 'd') return 'door';
    if (ch === 'o') return 'oil';
    if (ch === '.') return 'floor';
    return 'wall';
  };
}

/** y*width+x 编码的格子 key */
function keyAt(x: number, y: number, stride: number): number {
  return y * stride + x;
}

/** 单回合快照：燃烧 / 烟雾的有序键值对 + 事件，供确定性比对 */
interface TickSnapshot {
  fire: [number, number][];
  smoke: [number, number][];
  events: FireEvent[];
}

function snapshot(state: FireState, events: FireEvent[]): TickSnapshot {
  return {
    fire: [...state.fire.entries()].sort((a, b) => a[0] - b[0]),
    smoke: [...state.smoke.entries()].sort((a, b) => a[0] - b[0]),
    events,
  };
}

describe('常量与燃料表', () => {
  it('契约常量固定', () => {
    expect(FIRE_TICK_DAMAGE).toBe(3);
    expect(SMOKE_LIFETIME).toBe(12);
    expect(BASE_SPREAD_CHANCE).toBe(0.15);
    expect(OIL_SPREAD_BONUS).toBe(0.15);
    expect(DEFAULT_KEY_STRIDE).toBe(80);
  });

  it('fuelOf：door 10 / oil 6 / 其余一律不燃', () => {
    expect(fuelOf('door')).toBe(10);
    expect(fuelOf('oil')).toBe(6);
    expect(fuelOf('wall')).toBe(0);
    expect(fuelOf('floor')).toBe(0);
    expect(fuelOf('')).toBe(0);
    expect(fuelOf('mysteryTile')).toBe(0);
  });
});

describe('ignite / extinguish', () => {
  it('可燃物点燃成功，不可燃无效', () => {
    const state = newFireState();
    ignite(state, 7, 'floor');
    ignite(state, 7, 'wall');
    expect(state.fire.size).toBe(0);
    expect(isBurning(state, 7)).toBe(false);

    ignite(state, 7, 'door');
    expect(state.fire.get(7)).toBe(10);
    expect(isBurning(state, 7)).toBe(true);

    const other = newFireState();
    ignite(other, 0, 'oil');
    expect(other.fire.get(0)).toBe(6);
    expect(isBurning(other, 0)).toBe(true);
  });

  it('重复点燃取 max 剩余，不叠加', () => {
    const state = newFireState();
    const fuel = gridFuel(['#####', '##d##', '#####'], 5);
    ignite(state, 7, 'door');
    for (let i = 0; i < 4; i++) tickFire(state, fuel, riggedRng(0.99), 5);
    expect(state.fire.get(7)).toBe(6);
    ignite(state, 7, 'door'); // max(6, 10) = 10
    expect(state.fire.get(7)).toBe(10);
    for (let i = 0; i < 2; i++) tickFire(state, fuel, riggedRng(0.99), 5);
    expect(state.fire.get(7)).toBe(8);
    ignite(state, 7, 'oil'); // max(8, 6) = 8，不会缩短也不会叠加
    expect(state.fire.get(7)).toBe(8);
  });

  it('extinguish：点火后立即扑灭，且不再蔓延（邻格是门也点不着）', () => {
    const state = newFireState();
    const fuel = gridFuel(['#####', 'dd###', '#####'], 5);
    ignite(state, 5, 'door');
    extinguish(state, 5);
    expect(isBurning(state, 5)).toBe(false);
    // 掷点恒 0：任何候选格都必然点燃，但扑灭格已不在燃烧表中
    for (let i = 0; i < 10; i++) {
      expect(tickFire(state, fuel, riggedRng(0), 5).events).toEqual([]);
    }
    expect(state.fire.size).toBe(0);
    expect(isBurning(state, 6)).toBe(false);
  });

  it('extinguish：燃烧中途扑灭不再有 burnOut，残留烟自然消散', () => {
    const state = newFireState();
    const fuel = gridFuel(['#####', '##d##', '#####'], 5);
    ignite(state, 7, 'door');
    for (let i = 0; i < 3; i++) tickFire(state, fuel, riggedRng(0.99), 5);
    expect(isBurning(state, 7)).toBe(true);
    expect(isSmoky(state, 7)).toBe(true);

    extinguish(state, 7);
    expect(isBurning(state, 7)).toBe(false);
    expect(isSmoky(state, 7)).toBe(true); // 烟不受灭火影响

    // 烟从 11 起逐回合衰减，第 14 回合归零消散
    for (let t = 4; t <= 14; t++) {
      const report = tickFire(state, fuel, riggedRng(0.99), 5);
      const kinds = report.events.map((e) => e.kind);
      expect(kinds).not.toContain('burnOut');
      expect(kinds).not.toContain('spread');
      expect(kinds).not.toContain('smokeStart');
      if (t < 14) {
        expect(kinds).toEqual([]);
        expect(isSmoky(state, 7)).toBe(true);
      } else {
        expect(report.events).toEqual([{ kind: 'smokeGone', key: 7 }]);
        expect(isSmoky(state, 7)).toBe(false);
      }
    }
  });
});

describe('tickFire：燃烧与烧尽', () => {
  it('孤立火源逐回合递减，第 10 回合 burnOut；烟第 1 回合产生、第 20 回合消散', () => {
    const state = newFireState();
    const fuel = gridFuel(['#####', '##d##', '#####'], 5);
    ignite(state, 7, 'door');

    for (let t = 1; t <= 21; t++) {
      const report = tickFire(state, fuel, riggedRng(0.99), 5);
      if (t <= 9) {
        expect(state.fire.get(7)).toBe(10 - t);
        expect(state.smoke.get(7)).toBe(11); // 置满 12 后当回合衰减 1
        expect(report.events).toEqual(t === 1 ? [{ kind: 'smokeStart', key: 7 }] : []);
      } else if (t === 10) {
        expect(state.fire.has(7)).toBe(false);
        expect(state.smoke.get(7)).toBe(10);
        expect(report.events).toEqual([{ kind: 'burnOut', key: 7 }]);
      } else if (t < 20) {
        expect(state.smoke.get(7)).toBe(20 - t);
        expect(report.events).toEqual([]);
      } else if (t === 20) {
        expect(report.events).toEqual([{ kind: 'smokeGone', key: 7 }]);
        expect(isSmoky(state, 7)).toBe(false);
      } else {
        expect(report.events).toEqual([]);
        expect(state.smoke.size).toBe(0);
      }
      if (t >= 10) expect(isBurning(state, 7)).toBe(false); // 烧尽后永不再燃烧
    }
  });

  it('burnOut 后该格不再燃烧：邻火同回合也无法复燃刚烧尽的格子', () => {
    const state = newFireState();
    const fuel = gridFuel(['#####', 'dd###', '#####'], 5);
    ignite(state, 5, 'door');

    const spreadTicks: [number, number][] = [];
    const burnOutTicks: [number, number][] = [];
    for (let t = 1; t <= 21; t++) {
      const report = tickFire(state, fuel, riggedRng(0), 5); // 掷点恒 0：候选格必然点燃
      for (const e of report.events) {
        if (e.kind === 'spread') spreadTicks.push([e.key, t]);
        if (e.kind === 'burnOut') burnOutTicks.push([e.key, t]);
      }
    }
    // 只有 6 号被点燃一次；5 号烧尽后尽管 6 号仍在烧、fuelAt(5) 仍是门，也不再复燃
    expect(spreadTicks).toEqual([[6, 1]]);
    expect(burnOutTicks).toEqual([
      [5, 10],
      [6, 11],
    ]);
    expect(state.fire.size).toBe(0);
  });
});

describe('tickFire：蔓延', () => {
  it('掷点恒 0：左右门邻格同回合点燃；新点燃格下回合才递减 / 产烟', () => {
    const state = newFireState();
    const fuel = gridFuel(['#####', '#ddd#', '#####'], 5);
    ignite(state, 7, 'door');

    const r1 = tickFire(state, fuel, riggedRng(0), 5);
    expect(r1.events).toEqual([
      { kind: 'spread', key: 6 },
      { kind: 'smokeStart', key: 7 },
      { kind: 'spread', key: 8 },
    ]);
    expect(isBurning(state, 6)).toBe(true);
    expect(isBurning(state, 8)).toBe(true);
    expect(state.fire.get(6)).toBe(10); // 新点燃格本回合不递减
    expect(state.smoke.has(6)).toBe(false); // 新点燃格本回合不产烟

    const r2 = tickFire(state, fuel, riggedRng(0), 5);
    // 新点燃格首次被处理：递减 + 首次产烟（smokeStart），但八邻内已无可燃未燃格
    expect(r2.events).toEqual([
      { kind: 'smokeStart', key: 6 },
      { kind: 'smokeStart', key: 8 },
    ]);
    expect(state.fire.get(6)).toBe(9); // 下回合才开始递减
    expect(state.smoke.get(6)).toBe(11); // 下回合才开始产烟
  });

  it('掷点恒 0.99（高于油渍上限 0.30）：绝不蔓延', () => {
    const state = newFireState();
    const fuel = gridFuel(['#####', '#dod#', '#####'], 5);
    ignite(state, 7, 'door');
    for (let t = 1; t <= 9; t++) {
      const report = tickFire(state, fuel, riggedRng(0.99), 5);
      expect(report.events.every((e) => e.kind !== 'spread')).toBe(true);
      expect(state.fire.size).toBe(1);
    }
    expect(isBurning(state, 7)).toBe(true);
  });

  it('油渍蔓延概率翻倍：掷点 0.2 高于基础 0.15 但低于油渍 0.30，只点燃油渍', () => {
    const state = newFireState();
    const fuel = gridFuel(['#####', 'ddod#', '#####'], 5);
    // 火源 6：左邻 5 是门（0.15，掷 0.2 不中），右邻 7 是油渍（0.30，掷 0.2 命中）
    ignite(state, 6, 'door');
    const report = tickFire(state, fuel, riggedRng(0.2), 5);
    expect(report.events).toEqual([
      { kind: 'smokeStart', key: 6 },
      { kind: 'spread', key: 7 },
    ]);
    expect(isBurning(state, 7)).toBe(true);
    expect(isBurning(state, 5)).toBe(false);
    expect(isBurning(state, 8)).toBe(false);
  });

  it('八邻蔓延：斜对角的门也能被点燃', () => {
    const state = newFireState();
    const fuel = gridFuel(['###d#', '##d##', '#####'], 5);
    ignite(state, 7, 'door');
    const report = tickFire(state, fuel, riggedRng(0), 5);
    expect(report.events).toEqual([
      { kind: 'spread', key: 3 },
      { kind: 'smokeStart', key: 7 },
    ]);
    expect(isBurning(state, 3)).toBe(true);
  });

  it('不可燃格绝不蔓延：邻格全是地板 / 墙，火只在原地烧尽', () => {
    const state = newFireState();
    const fuel = gridFuel(['#####', '#...#', '#####'], 5);
    ignite(state, 7, 'door');
    const spreads: FireEvent[] = [];
    for (let t = 1; t <= 20; t++) {
      const report = tickFire(state, fuel, riggedRng(0), 5);
      spreads.push(...report.events.filter((e) => e.kind === 'spread'));
    }
    expect(spreads).toEqual([]);
    expect(state.fire.size).toBe(0); // 第 10 回合烧尽
    expect(state.smoke.size).toBe(0); // 第 20 回合烟散尽
  });

  it('真实 Rng：油渍场（fuel 6）单火源，多种子扫描下 50 回合内蔓延是常态', () => {
    // p = 0.30/回合/邻格，火源有 5 个回合的蔓延窗口（1 - 0.7^5 ≈ 83%/种子）。
    // 固定种子扫描是确定性的，这里验证概率代码路径在真实 Rng 下确实可触发。
    let spreadSeeds = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const state = newFireState();
      const fuel = gridFuel(['#####', '#ooo#', '#####'], 5);
      ignite(state, 6, 'oil');
      const rng = new Rng(seed);
      let spread = false;
      for (let t = 1; t <= 50 && !spread; t++) {
        tickFire(state, fuel, rng, 5);
        if (state.fire.size > 1) spread = true;
      }
      if (spread) spreadSeeds++;
    }
    expect(spreadSeeds).toBeGreaterThanOrEqual(8);
  });
});

describe('传播链', () => {
  it('1×5 门序列：点燃一端，火逐回合传递，20 回合内传到另一端并烧遍全链', () => {
    // stride 6 + 两侧留墙垫：避免门铺满整行时 y*width+x 编码的行环绕邻接
    const state = newFireState();
    const fuel = gridFuel(['######', '#ddddd', '######'], 6);
    ignite(state, 7, 'door');

    const spreadTicks: [number, number][] = [];
    const burnOutTicks: [number, number][] = [];
    let reachedFarEnd = false;
    for (let t = 1; t <= 20; t++) {
      const report = tickFire(state, fuel, riggedRng(0), 6);
      for (const e of report.events) {
        if (e.kind === 'spread') spreadTicks.push([e.key, t]);
        if (e.kind === 'burnOut') burnOutTicks.push([e.key, t]);
      }
      if (isBurning(state, 11)) reachedFarEnd = true;
    }

    // 火传到了另一端（key 11），每格恰好点燃一次、逐格推进（1 格/回合）
    expect(reachedFarEnd).toBe(true);
    expect(spreadTicks).toEqual([
      [8, 1],
      [9, 2],
      [10, 3],
      [11, 4],
    ]);
    // 每格烧 10 回合后依次烧尽，无一复燃
    expect(burnOutTicks).toEqual([
      [7, 10],
      [8, 11],
      [9, 12],
      [10, 13],
      [11, 14],
    ]);
    // 20 回合后明火全灭；链首的烟已散尽，链尾的烟仍在消散中
    expect(state.fire.size).toBe(0);
    expect(isSmoky(state, 7)).toBe(false);
    expect(isSmoky(state, 11)).toBe(true);
  });
});

describe('事件排序', () => {
  it('多格多事件按 key 升序稳定排列', () => {
    const state = newFireState();
    const fuel = gridFuel(['#####', 'ddd##', '#####'], 5);
    ignite(state, 5, 'door');
    ignite(state, 7, 'door');
    const report = tickFire(state, fuel, riggedRng(0), 5);
    expect(report.events).toEqual([
      { kind: 'smokeStart', key: 5 },
      { kind: 'spread', key: 6 },
      { kind: 'smokeStart', key: 7 },
    ]);
  });

  it('同格多种事件按推演顺序排列（burnOut 先于 smokeGone）', () => {
    // 直接构造状态：火与烟都只剩 1 回合
    const state: FireState = {
      fire: new Map([[7, 1]]),
      smoke: new Map([[7, 1]]),
    };
    const fuel = gridFuel(['#####', '##d##', '#####'], 5);
    const report = tickFire(state, fuel, riggedRng(0), 5);
    expect(report.events).toEqual([
      { kind: 'burnOut', key: 7 },
      { kind: 'smokeGone', key: 7 },
    ]);
    expect(isBurning(state, 7)).toBe(false);
    expect(isSmoky(state, 7)).toBe(false);
  });
});

describe('确定性', () => {
  const ROWS = [
    '########',
    '#dd.o..#',
    '#.d#.o.#',
    '#o..dd.#',
    '########',
  ];

  function runSim(seed: number): { snaps: TickSnapshot[]; rngState: number } {
    const state = newFireState();
    ignite(state, keyAt(1, 1, 8), 'door');
    ignite(state, keyAt(4, 1, 8), 'oil');
    const fuel = gridFuel(ROWS, 8);
    const rng = new Rng(seed);
    const snaps: TickSnapshot[] = [];
    for (let t = 1; t <= 21; t++) {
      const report = tickFire(state, fuel, rng, 8);
      snaps.push(snapshot(state, report.events));
    }
    return { snaps, rngState: rng.snapshot() };
  }

  it('同种子两次推演：逐回合状态、事件与 rng 终态完全一致', () => {
    const a = runSim(2024);
    const b = runSim(2024);
    expect(a.snaps).toEqual(b.snaps);
    expect(a.rngState).toBe(b.rngState); // 连 rng 消耗次数都一致
  });

  it('推演确实发生了蔓延与烧尽（避免确定性断言空转）', () => {
    const { snaps } = runSim(2024);
    const allEvents = snaps.flatMap((s) => s.events);
    expect(allEvents.some((e) => e.kind === 'spread')).toBe(true);
    expect(allEvents.some((e) => e.kind === 'burnOut')).toBe(true);
    expect(allEvents.some((e) => e.kind === 'smokeStart')).toBe(true);
    expect(allEvents.some((e) => e.kind === 'smokeGone')).toBe(true);
  });
});

describe('tickFire 契约', () => {
  it('原地演化传入 state，每次返回新报告对象', () => {
    const state = newFireState();
    const fuel = gridFuel(['#####', '##d##', '#####'], 5);
    ignite(state, 7, 'door');
    const r1 = tickFire(state, fuel, riggedRng(0.99), 5);
    const r2 = tickFire(state, fuel, riggedRng(0.99), 5);
    expect(r1).not.toBe(r2);
    expect(state.fire.get(7)).toBe(8); // state 被原地修改
  });
});
