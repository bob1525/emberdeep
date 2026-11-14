/**
 * SaveCodec（里程碑 4）：RunState 字段 ↔ SaveData 的编解码边界。
 * encode 接收显式字段对象（不持有 Game 引用），decode 走 saveSchema 校验。
 * 无头可运行：不依赖 Renderer / DOM。
 */
import type { SaveData } from '../game';

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
