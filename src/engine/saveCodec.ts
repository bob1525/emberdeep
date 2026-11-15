/**
 * SaveCodec（里程碑 4）：RunState 字段 ↔ SaveData 的编解码边界。
 * encode 接收显式字段对象（不持有 Game 引用），decode 走 saveSchema 校验。
 * 无头可运行：不依赖 Renderer / DOM。
 * SaveData 契约定义在此（M4 边界）：engine 层自持存档类型，game.ts 反向引用，
 * 消除 engine → 门面的反向依赖。
 */
import type { Actor } from '../entities/actor';
import type { GroundItem, GoldPile, MerchantState } from '../economy/inventoryService';
import type { PlacedTrap } from '../world/traps';
import type { ShrineKind } from '../world/shrines';
import type { AffixData } from '../items/affixes';
import type { Tile } from '../world/tiles';
import type { Pt } from './los';

/** localStorage 存档结构（schema 校验在 saveSchema.ts）。version 用于未来格式迁移 */
export interface SaveData {
  version: 1;
  depth: number;
  turn: number;
  level: number;
  xp: number;
  mightUntil: number;
  runSeed: number;
  player: Actor;
  monsters: Actor[];
  groundItems: GroundItem[];
  explored: string[];
  stairsDown: { x: number; y: number };
  mapWidth: number;
  mapHeight: number;
  mapTiles: Tile[];
  rngState: number;
  kills: number;
  deathCause: string;
  traps?: PlacedTrap[];
  /** 火势状态（key = y*80+x → 剩余回合 + 烧毁格 key 列表；旧档缺失走 migrate 空态） */
  fire?: { fire: [number, number][]; smoke: [number, number][]; burned?: number[] };
  gold?: number;
  goldPiles?: GoldPile[];
  merchant?: MerchantState | null;
  affixData?: [number, AffixData][];
  classId?: string;
  skillRemaining?: number;
  ownedTalents?: string[];
  shrines?: { x: number; y: number; kind: ShrineKind }[];
  memories?: [number, { lastSeenPlayer: Pt | null; alert: number; rallyPoint: Pt | null; rallyAge: number; cooldowns: [string, number][] }][];
  mode?: string;
  talentChoices?: string[];
  pendingLevelUps?: number;
  bossSummonCount?: number;
  bossSpecies?: string | null;
}

/** encode 的显式输入：与 Game 的可持久化字段一一对应 */
export interface SaveInput {
  depth: number;
  turn: number;
  level: number;
  xp: number;
  gold: number;
  mightUntil: number;
  runSeed: number;
  player: unknown;
  monsters: unknown[];
  groundItems: unknown[];
  explored: string[];
  stairsDown: { x: number; y: number };
  mapWidth: number;
  mapHeight: number;
  mapTiles: string[];
  rngState: number;
  kills: number;
  deathCause: string;
  traps: unknown[];
  fire: { fire: [number, number][]; smoke: [number, number][]; burned: number[] };
  shrines: unknown[];
  mode: string;
  talentChoices: string[];
  pendingLevelUps: number;
  bossSummonCount: number;
  bossSpecies: string | null;
  affixData: [number, unknown][];
  classId: string;
  skillRemaining: number;
  ownedTalents: string[];
  goldPiles: unknown[];
  merchant: unknown;
  memories: unknown[];
}

/** 显式字段 → SaveData（字段顺序由本函数固定，canonical 序列化依赖它） */
export function encodeSaveData(input: SaveInput): SaveData {
  return {
    version: 1,
    depth: input.depth,
    turn: input.turn,
    level: input.level,
    xp: input.xp,
    gold: input.gold,
    mightUntil: input.mightUntil,
    runSeed: input.runSeed,
    player: input.player,
    monsters: input.monsters,
    groundItems: input.groundItems,
    explored: [...input.explored],
    stairsDown: { ...input.stairsDown },
    mapWidth: input.mapWidth,
    mapHeight: input.mapHeight,
    mapTiles: [...input.mapTiles],
    rngState: input.rngState,
    kills: input.kills,
    deathCause: input.deathCause,
    traps: input.traps,
    fire: { fire: [...input.fire.fire], smoke: [...input.fire.smoke], burned: [...input.fire.burned] },
    shrines: input.shrines,
    goldPiles: input.goldPiles,
    merchant: input.merchant,
    memories: input.memories,
    mode: input.mode === 'levelUp' ? 'levelUp' : 'play',
    talentChoices: input.mode === 'levelUp' ? input.talentChoices : [],
    pendingLevelUps: input.pendingLevelUps,
    bossSummonCount: input.bossSummonCount,
    bossSpecies: input.bossSpecies,
    affixData: [...input.affixData],
    classId: input.classId,
    skillRemaining: input.skillRemaining,
    ownedTalents: input.ownedTalents ?? [],
  } as SaveData;
}

/** 旧档缺字段补默认值（迁移：v1 新增可选字段的兜底） */
export function migrateV1Defaults(data: Record<string, unknown>): void {
  data.traps ??= [];
  data.fire ??= { fire: [], smoke: [], burned: [] };
  data.gold ??= 0;
  data.goldPiles ??= [];
  data.merchant ??= null;
  data.affixData ??= [];
  data.classId ??= 'warrior';
  data.skillRemaining ??= 0;
  data.ownedTalents ??= [];
  data.shrines ??= [];
  data.memories ??= [];
  data.mode ??= 'play';
  data.talentChoices ??= [];
  data.pendingLevelUps ??= data.mode === 'levelUp' ? 1 : 0;
  data.bossSummonCount ??= 0;
  data.bossSpecies ??= null;
}
