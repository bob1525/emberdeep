/**
 * SaveData 显式校验层（里程碑 3）。
 * JSON.parse 的结果不再被直接断言成 SaveData——必须通过本模块的结构与语义校验。
 * 迁移策略：v1 缺失的可选字段在 Game.hydrate 中补默认值；未知版本在此明确拒绝。
 */
import { BOSSES } from '../entities/bosses';
import { RANGED } from './ranged';

const VALID_CATEGORIES = ['potion', 'scroll', 'weapon', 'armor', 'ranged'] as const;
const VALID_TILES = ['wall', 'floor'] as const;
const VALID_CLASSES = ['warrior', 'ranger', 'mage'] as const;
const KNOWN_BOSS_SPECIES = new Set(BOSSES.map((b) => b.species));

export interface ParseOk {
  ok: true;
  data: SaveDataLike;
  warnings: string[];
}

export interface ParseFail {
  ok: false;
  reason: string;
}

/** 宽松结构类型：与 game.ts 的 SaveData 字段对齐（此处不 import 以避免循环依赖） */
export interface SaveDataLike {
  version: 1;
  [key: string]: unknown;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function fail(reason: string): ParseFail {
  return { ok: false, reason };
}

/** 校验并返回存档；失败给出人类可读原因 */
export function parseSaveData(raw: unknown): ParseOk | ParseFail {
  if (typeof raw !== 'object' || raw === null) return fail('存档不是对象');
  const d = raw as Record<string, unknown>;
  const warnings: string[] = [];

  if (d.version !== 1) return fail(`不支持的存档版本：${String(d.version)}（当前支持 v1）`);

  for (const [key, min] of [
    ['depth', 1],
    ['level', 1],
    ['turn', 0],
    ['gold', 0],
  ] as const) {
    if (!isFiniteNumber(d[key]) || (d[key] as number) < min) {
      return fail(`字段 ${key} 非法（应为 ≥${min} 的有限数字）`);
    }
  }
  if (!isFiniteNumber(d.xp) || (d.xp as number) < 0) return fail('字段 xp 非法');
  if (!isFiniteNumber(d.rngState) || (d.rngState as number) < 0) return fail('字段 rngState 非法');

  const width = d.mapWidth;
  const height = d.mapHeight;
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width < 1 || height < 1) {
    return fail('地图尺寸非法');
  }
  if (!Array.isArray(d.mapTiles) || d.mapTiles.length !== width * height) {
    return fail('地图瓦片数量与尺寸不符');
  }
  if (!d.mapTiles.every((t) => VALID_TILES.includes(t as (typeof VALID_TILES)[number]))) {
    return fail('地图存在非法瓦片类型');
  }

  const player = d.player;
  if (typeof player !== 'object' || player === null) return fail('player 缺失');
  const p = player as Record<string, unknown>;
  if (!isFiniteNumber(p.hp) || !isFiniteNumber(p.maxHp) || (p.hp as number) <= 0) {
    return fail('玩家生命值非法（死亡状态不应被保存）');
  }
  if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return fail('玩家坐标非法');
  if (p.side !== 'player') return fail('player.side 非法');

  if (!Array.isArray(d.monsters)) return fail('monsters 缺失');
  const actorIds = new Set<number>();
  if (!isFiniteNumber(p.id)) return fail('player.id 非法');
  actorIds.add(p.id);
  for (const m of d.monsters) {
    if (typeof m !== 'object' || m === null) return fail('monsters 中存在非法条目');
    const a = m as Record<string, unknown>;
    if (!isFiniteNumber(a.id) || actorIds.has(a.id)) return fail('实体 ID 重复或非法');
    actorIds.add(a.id);
    if (!isFiniteNumber(a.hp) || (a.hp as number) <= 0) return fail('怪物生命值非法');
    if (!isFiniteNumber(a.x) || !isFiniteNumber(a.y)) return fail('怪物坐标非法');
    if (typeof a.species !== 'string') return fail('怪物 species 非法');
  }

  const validItem = (it: unknown): boolean => {
    if (typeof it !== 'object' || it === null) return false;
    const i = it as Record<string, unknown>;
    return (
      isFiniteNumber(i.uid) &&
      typeof i.catalogId === 'string' &&
      VALID_CATEGORIES.includes(i.category as (typeof VALID_CATEGORIES)[number])
    );
  };
  if (!Array.isArray(d.groundItems) || !d.groundItems.every(validItem)) {
    return fail('groundItems 存在非法物品');
  }
  const inventory = d.player && typeof d.player === 'object' ? (d.player as Record<string, unknown>).inventory : null;
  if (!Array.isArray(inventory) || !inventory.every(validItem)) {
    return fail('背包存在非法物品');
  }
  const equipment = (d.player as Record<string, unknown>).equipment;
  if (typeof equipment !== 'object' || equipment === null) return fail('equipment 缺失');
  const eq = equipment as Record<string, unknown>;
  for (const slot of ['weapon', 'armor'] as const) {
    const it = eq[slot];
    if (it !== null && !validItem(it)) return fail(`装备槽 ${slot} 非法`);
  }

  // 远程武器 catalogId 必须存在于 RANGED 目录
  for (const it of [...(inventory as unknown[]), ...(d.groundItems as unknown[])]) {
    const i = it as Record<string, unknown>;
    if (i.category !== 'ranged') continue;
    if (!(RANGED as Record<string, unknown>)[i.catalogId as string]) {
      return fail(`未知远程武器 catalogId：${String(i.catalogId)}`);
    }
  }

  if (!Array.isArray(d.explored)) return fail('explored 缺失');
  if (!Array.isArray(d.shrines ?? [])) return fail('shrines 非法');
  if (!Array.isArray(d.ownedTalents ?? [])) return fail('ownedTalents 非法');

  if (d.classId !== undefined && !VALID_CLASSES.includes(d.classId as (typeof VALID_CLASSES)[number])) {
    return fail(`未知职业：${String(d.classId)}`);
  }

  if (d.bossSpecies !== null && d.bossSpecies !== undefined) {
    if (typeof d.bossSpecies !== 'string' || !KNOWN_BOSS_SPECIES.has(d.bossSpecies)) {
      return fail(`未知 Boss species：${String(d.bossSpecies)}`);
    }
  }

  // 引用完整性：affixData 的 uid 必须仍被某件物品引用
  const referencedUids = new Set<number>();
  for (const it of [
    ...((inventory as unknown[]) ?? []),
    ...(d.groundItems as unknown[]),
    (eq.weapon as unknown) ?? null,
    (eq.armor as unknown) ?? null,
  ]) {
    if (typeof it === 'object' && it !== null && isFiniteNumber((it as Record<string, unknown>).uid)) {
      referencedUids.add((it as Record<string, unknown>).uid as number);
    }
  }
  if (Array.isArray(d.affixData)) {
    for (const [uid] of d.affixData as [number, unknown][]) {
      if (!referencedUids.has(uid)) {
        warnings.push(`affixData 存在悬空 uid ${uid}（将在 hydrate 清理）`);
      }
    }
  }

  return { ok: true, data: d as unknown as SaveDataLike, warnings };
}
