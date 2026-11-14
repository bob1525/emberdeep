import { describe, expect, it } from 'vitest';
import { makeActor } from '../src/entities/actor';
import type { Actor, StatusInstance } from '../src/entities/actor';
import {
  STATUSES,
  actionsPerTurn,
  applyStatus,
  hasStatus,
  tickStatuses,
  totalDefenseBonus,
} from '../src/engine/statuses';
import type { StatusKind } from '../src/engine/statuses';

/** 造一个标准测试靶子 */
function makeTarget(hp = 30, maxHp = 30): Actor {
  return makeActor({ species: 'rat', name: '鼠人', x: 0, y: 0, hp, maxHp });
}

/** 模拟旧存档：把 statuses 字段抹成 undefined（旧版实体可能没有该字段） */
function stripStatuses(actor: Actor): void {
  (actor as { statuses?: StatusInstance[] }).statuses = undefined;
}

describe('STATUSES 目录', () => {
  it('六种状态齐全，中文名/伤害标记/防御加成正确', () => {
    const expected: Array<[StatusKind, string, boolean, number]> = [
      ['poison', '中毒', true, 0],
      ['burn', '燃烧', true, 0],
      ['slow', '减速', false, 0],
      ['haste', '加速', false, 0],
      ['shield', '护盾', false, 2],
      ['regeneration', '再生', false, 0],
    ];
    for (const [kind, name, damaging, defenseBonus] of expected) {
      const info = STATUSES[kind];
      expect(info.kind).toBe(kind);
      expect(info.name).toBe(name);
      expect(info.damaging).toBe(damaging);
      expect(info.defenseBonus).toBe(defenseBonus);
      expect(info.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('applyStatus / hasStatus', () => {
  it('首次施加创建实例，hasStatus 正确识别', () => {
    const t = makeTarget();
    expect(hasStatus(t, 'poison')).toBe(false);
    applyStatus(t, 'poison', 3, 2);
    expect(hasStatus(t, 'poison')).toBe(true);
    expect(hasStatus(t, 'burn')).toBe(false);
    expect(t.statuses).toEqual([{ kind: 'poison', remaining: 3, power: 2 }]);
  });

  it('同类叠加取优：新回合数更长、新强度更高', () => {
    const t = makeTarget();
    applyStatus(t, 'poison', 3, 1);
    applyStatus(t, 'poison', 5, 2);
    expect(t.statuses).toEqual([{ kind: 'poison', remaining: 5, power: 2 }]);
  });

  it('同类叠加取优：已有回合数更长、已有强度更高时不被削弱', () => {
    const t = makeTarget();
    applyStatus(t, 'poison', 5, 2);
    applyStatus(t, 'poison', 3, 1);
    expect(t.statuses).toEqual([{ kind: 'poison', remaining: 5, power: 2 }]);
  });

  it('不同种类各自独立存在', () => {
    const t = makeTarget();
    applyStatus(t, 'poison', 3, 1);
    applyStatus(t, 'burn', 4, 3);
    expect(t.statuses.length).toBe(2);
    expect(hasStatus(t, 'poison')).toBe(true);
    expect(hasStatus(t, 'burn')).toBe(true);
    expect(hasStatus(t, 'slow')).toBe(false);
  });

  it('turns <= 0 视为无效调用，直接忽略', () => {
    const t = makeTarget();
    applyStatus(t, 'poison', 0, 2);
    applyStatus(t, 'poison', -1, 2);
    expect(t.statuses.length).toBe(0);
    expect(hasStatus(t, 'poison')).toBe(false);
  });

  it('负 power 钳到 0（不会出现中毒回血）', () => {
    const t = makeTarget(10);
    applyStatus(t, 'poison', 3, -5);
    expect(t.statuses[0]?.power).toBe(0);
    const report = tickStatuses(t);
    expect(report.events).toEqual([{ kind: 'poison', damage: 0, expired: false }]);
    expect(t.hp).toBe(10);
  });

  it('旧存档残留多个同 kind 实例时收敛合并为一个', () => {
    const t = makeTarget();
    // 直接构造脏数据：两个同类实例
    t.statuses.push({ kind: 'poison', remaining: 2, power: 1 });
    t.statuses.push({ kind: 'poison', remaining: 4, power: 3 });
    applyStatus(t, 'poison', 3, 2);
    expect(t.statuses.length).toBe(1);
    expect(t.statuses[0]).toEqual({ kind: 'poison', remaining: 4, power: 3 });
  });
});

describe('totalDefenseBonus', () => {
  it('无状态时为 0', () => {
    expect(totalDefenseBonus(makeTarget())).toBe(0);
  });

  it('shield 提供 +2 防御', () => {
    const t = makeTarget();
    applyStatus(t, 'shield', 3, 1);
    expect(totalDefenseBonus(t)).toBe(2);
  });

  it('只累计带防御加成的状态（poison/burn 不贡献）', () => {
    const t = makeTarget();
    applyStatus(t, 'shield', 3, 1);
    applyStatus(t, 'poison', 3, 1);
    applyStatus(t, 'burn', 3, 1);
    expect(totalDefenseBonus(t)).toBe(2);
  });

  it('shield 过期后防御加成归零', () => {
    const t = makeTarget();
    applyStatus(t, 'shield', 2, 1);
    tickStatuses(t);
    expect(totalDefenseBonus(t)).toBe(2);
    tickStatuses(t); // 第二次结算后到期移除
    expect(hasStatus(t, 'shield')).toBe(false);
    expect(totalDefenseBonus(t)).toBe(0);
  });
});

describe('tickStatuses：伤害与到期', () => {
  it('poison 每回合按 power 扣血，到期自动移除，事件序列正确', () => {
    const t = makeTarget();
    applyStatus(t, 'poison', 3, 2);

    const r1 = tickStatuses(t);
    expect(r1.events).toEqual([{ kind: 'poison', damage: 2, expired: false }]);
    expect(t.hp).toBe(28);
    expect(hasStatus(t, 'poison')).toBe(true);

    tickStatuses(t);
    expect(t.hp).toBe(26);

    const r3 = tickStatuses(t);
    expect(r3.events).toEqual([{ kind: 'poison', damage: 2, expired: true }]);
    expect(t.hp).toBe(24);
    expect(hasStatus(t, 'poison')).toBe(false);
    expect(t.statuses).toEqual([]);
  });

  it('过期后不再继续扣血', () => {
    const t = makeTarget();
    applyStatus(t, 'burn', 1, 3);
    tickStatuses(t);
    expect(t.hp).toBe(27);
    const r2 = tickStatuses(t);
    expect(r2.events).toEqual([]);
    expect(t.hp).toBe(27);
  });

  it('扣血钳制在 0，不做死亡判定', () => {
    const t = makeTarget(1);
    applyStatus(t, 'poison', 3, 5);
    const report = tickStatuses(t);
    expect(t.hp).toBe(0); // 钳到 0，不变成负数
    expect(report.events).toEqual([{ kind: 'poison', damage: 1, expired: false }]); // 实际生效 1 点
    expect(t.statuses.length).toBe(1); // 状态照常存活，死亡判定交给游戏层
  });

  it('regeneration 每回合回复 power 点，事件用负数 damage 表达', () => {
    const t = makeTarget();
    t.hp = 25;
    applyStatus(t, 'regeneration', 3, 3);
    const r1 = tickStatuses(t);
    expect(r1.events).toEqual([{ kind: 'regeneration', damage: -3, expired: false }]);
    expect(t.hp).toBe(28);
    tickStatuses(t);
    expect(t.hp).toBe(30); // 29 + 3 → 钳到 30
  });

  it('regeneration 回血不越 maxHp，满血时回复量为 0', () => {
    const t = makeTarget();
    t.hp = 29;
    applyStatus(t, 'regeneration', 2, 3);
    const r1 = tickStatuses(t);
    expect(t.hp).toBe(30);
    expect(r1.events).toEqual([{ kind: 'regeneration', damage: -1, expired: false }]); // 只实际回了 1 点

    const r2 = tickStatuses(t);
    expect(t.hp).toBe(30);
    expect(r2.events).toEqual([{ kind: 'regeneration', damage: 0, expired: true }]);
  });

  it('非伤害状态也产出事件（damage = 0），供游戏层提示到期', () => {
    const t = makeTarget();
    applyStatus(t, 'slow', 2, 1);
    expect(tickStatuses(t).events).toEqual([{ kind: 'slow', damage: 0, expired: false }]);
    expect(tickStatuses(t).events).toEqual([{ kind: 'slow', damage: 0, expired: true }]);
    expect(hasStatus(t, 'slow')).toBe(false);
  });

  it('多个状态按施加顺序产出事件', () => {
    const t = makeTarget();
    applyStatus(t, 'poison', 2, 1);
    applyStatus(t, 'burn', 2, 3);
    applyStatus(t, 'shield', 2, 1);
    const report = tickStatuses(t);
    expect(report.events).toEqual([
      { kind: 'poison', damage: 1, expired: false },
      { kind: 'burn', damage: 3, expired: false },
      { kind: 'shield', damage: 0, expired: false },
    ]);
    expect(t.hp).toBe(26);
    expect(t.statuses.length).toBe(3);
  });

  it('无状态时返回空事件且不抛错，不改动其他字段', () => {
    const t = makeTarget();
    const before = { attack: t.attack, defense: t.defense, energy: t.energy, x: t.x, y: t.y };
    const report = tickStatuses(t);
    expect(report).toEqual({ events: [] });
    expect(t.attack).toBe(before.attack);
    expect(t.defense).toBe(before.defense);
    expect(t.energy).toBe(before.energy);
    expect(t.x).toBe(before.x);
    expect(t.y).toBe(before.y);
  });
});

describe('actionsPerTurn', () => {
  it('无状态时为 1', () => {
    expect(actionsPerTurn(makeTarget())).toBe(1);
  });

  it('slow → 0.5（隔回合行动）', () => {
    const t = makeTarget();
    applyStatus(t, 'slow', 3, 1);
    expect(actionsPerTurn(t)).toBe(0.5);
  });

  it('haste → 2（一回合行动两次）', () => {
    const t = makeTarget();
    applyStatus(t, 'haste', 3, 1);
    expect(actionsPerTurn(t)).toBe(2);
  });

  it('同时 slow + haste 相互抵消为 1', () => {
    const t = makeTarget();
    applyStatus(t, 'slow', 3, 1);
    applyStatus(t, 'haste', 3, 1);
    expect(actionsPerTurn(t)).toBe(1);
  });
});

describe('旧存档容错：statuses 缺失', () => {
  it('tickStatuses 不抛错并初始化 statuses 为空数组', () => {
    const t = makeTarget();
    stripStatuses(t);
    const report = tickStatuses(t);
    expect(report).toEqual({ events: [] });
    expect(t.statuses).toEqual([]);
  });

  it('applyStatus 在 statuses 缺失时初始化并正常写入', () => {
    const t = makeTarget();
    stripStatuses(t);
    applyStatus(t, 'haste', 4, 1);
    expect(t.statuses).toEqual([{ kind: 'haste', remaining: 4, power: 1 }]);
    expect(hasStatus(t, 'haste')).toBe(true);
  });

  it('查询类函数对 statuses 缺失安全返回', () => {
    const t = makeTarget();
    stripStatuses(t);
    expect(hasStatus(t, 'poison')).toBe(false);
    expect(totalDefenseBonus(t)).toBe(0);
    expect(actionsPerTurn(t)).toBe(1);
  });
});
