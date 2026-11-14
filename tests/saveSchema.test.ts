import { describe, expect, it } from 'vitest';
import { parseSaveData } from '../src/engine/saveSchema';

/** 构造一份最小合法存档（v1） */
function validSave(): Record<string, unknown> {
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
  };
}

describe('SaveData schema 校验（里程碑 3）', () => {
  it('最小合法存档通过', () => {
    const r = parseSaveData(validSave());
    expect(r.ok).toBe(true);
  });

  it('缺失可选新字段的旧档通过（迁移策略：hydrate 补默认值）', () => {
    const save = validSave();
    delete (save as Record<string, unknown>).shrines;
    delete (save as Record<string, unknown>).ownedTalents;
    delete (save as Record<string, unknown>).memories;
    const r = parseSaveData(save);
    expect(r.ok).toBe(true);
  });

  it('未知版本明确拒绝', () => {
    const r = parseSaveData({ ...validSave(), version: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('版本');
  });

  it('损坏 JSON / 非对象拒绝', () => {
    expect(parseSaveData('not-an-object').ok).toBe(false);
    expect(parseSaveData(null).ok).toBe(false);
  });

  it('地图瓦片数量不符 / 非法瓦片拒绝', () => {
    expect(parseSaveData({ ...validSave(), mapWidth: 6 }).ok).toBe(false);
    const bad = validSave();
    (bad.mapTiles as string[])[3] = 'lava';
    expect(parseSaveData(bad).ok).toBe(false);
  });

  it('玩家死亡状态拒绝（hp ≤ 0）', () => {
    const save = validSave();
    (save.player as Record<string, unknown>).hp = 0;
    expect(parseSaveData(save).ok).toBe(false);
  });

  it('实体 ID 重复拒绝', () => {
    const save = validSave();
    save.monsters = [
      {
        id: 1,
        side: 'monster',
        species: 'rat',
        name: '鼠人',
        glyph: 'r',
        color: '#c07070',
        x: 3,
        y: 3,
        hp: 7,
        maxHp: 7,
        attack: 2,
        defense: 0,
        xpValue: 3,
        statuses: [],
        energy: 0,
        inventory: [],
        equipment: { weapon: null, armor: null },
        ai: { mode: 'sleep' },
      },
    ];
    expect(parseSaveData(save).ok).toBe(false);
  });

  it('未知远程武器 catalogId 拒绝', () => {
    const save = validSave();
    (save.player as Record<string, unknown>).inventory = [
      { uid: 1, catalogId: 'not_a_bow', category: 'ranged' },
    ];
    expect(parseSaveData(save).ok).toBe(false);
  });

  it('未知职业拒绝', () => {
    expect(parseSaveData({ ...validSave(), classId: 'necromancer' }).ok).toBe(false);
  });

  it('未知 Boss species 拒绝', () => {
    expect(parseSaveData({ ...validSave(), bossSpecies: 'slime_king' }).ok).toBe(false);
  });

  it('悬空词缀产生警告但放行（hydrate 清理）', () => {
    const save = validSave();
    save.affixData = [[999, { rarity: 'epic', affixIds: ['burning'] }]];
    const r = parseSaveData(save);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.length).toBeGreaterThan(0);
  });
});
