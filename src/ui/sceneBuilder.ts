/**
 * SceneBuilder（里程碑 4）：RunState 数据 → 渲染 Scene 的纯转换。
 * 不持有状态、不调用 Renderer、不依赖 DOM——输入相同则输出相同。
 */
import type { ItemInstance } from '../entities/actor';
import { RANGED } from '../engine/ranged';
import { itemDef } from '../items/catalog';
import type { GameMap } from '../world/map';
import { TRAPS } from '../world/traps';
import { SHRINES } from '../world/shrines';
import type { DeathStats, Glyph, Scene } from './renderer';

/** 火势层字形与配色（火苗与打击感特效的火焰色一致；烟字半透明表达） */
const FIRE_GLYPH = '▲';
const FIRE_COLOR = '#f5803a';
const SMOKE_GLYPH = '~';
const SMOKE_COLOR = 'rgba(150, 156, 168, 0.55)';

/** 统一取物品展示信息：远程武器走 RANGED 目录，其余走通用目录 */
export function itemInfo(item: ItemInstance): {
  name: string;
  glyph: string;
  color: string;
} {
  if (item.category === 'ranged') {
    const def = RANGED[item.catalogId];
    if (def) return def;
  }
  return itemDef(item);
}

export interface SceneInput {
  map: GameMap;
  depth: number;
  visible: Set<string>;
  explored: Set<string>;
  stairsDown: { x: number; y: number };
  traps: { x: number; y: number; kind: string }[];
  shrines: { x: number; y: number; kind: string }[];
  /** 燃烧中的格子（火势集成：火苗字形层） */
  fireCells: { x: number; y: number }[];
  /** 烟雾格子（本轮仅作视觉：半透明烟字，不动 FOV） */
  smokeCells: { x: number; y: number }[];
  /** 玩家（actors[0]） */
  player: Glyph & { hp: number; maxHp: number };
  monsters: (Glyph & { hp: number; maxHp: number })[];
  groundItems: { x: number; y: number; item: ItemInstance }[];
  goldPiles: { x: number; y: number; amount: number }[];
  merchant: { x: number; y: number } | null;
  affixColorOf: (uid: number) => string | null;
  dead: boolean;
  stats?: DeathStats;
}

/** 纯转换：相同输入永远产出相同 Scene */
export function buildScene(input: SceneInput): Scene {
  const actors: Glyph[] = [
    {
      x: input.player.x,
      y: input.player.y,
      glyph: input.player.glyph,
      color: input.player.color,
      hp: input.player.hp,
      maxHp: input.player.maxHp,
    },
  ];
  for (const m of input.monsters) {
    actors.push({ x: m.x, y: m.y, glyph: m.glyph, color: m.color, hp: m.hp, maxHp: m.maxHp });
  }
  if (input.merchant) {
    actors.push({
      x: input.merchant.x,
      y: input.merchant.y,
      glyph: '$',
      color: '#e8c14a',
    });
  }

  const items: Glyph[] = input.groundItems.map((g) => {
    const def = itemInfo(g.item);
    const affixColor = input.affixColorOf(g.item.uid);
    return {
      x: g.x,
      y: g.y,
      glyph: def.glyph,
      color: affixColor ?? def.color,
    };
  });
  for (const g of input.goldPiles) {
    items.push({ x: g.x, y: g.y, glyph: '$', color: '#e8c14a' });
  }

  const trapGlyphs: Glyph[] = input.traps.map((t) => {
    const def = TRAPS[t.kind as keyof typeof TRAPS];
    return { x: t.x, y: t.y, glyph: def.glyph, color: def.color };
  });
  const shrineGlyphs: Glyph[] = input.shrines.map((s) => {
    const def = SHRINES[s.kind as keyof typeof SHRINES];
    return { x: s.x, y: s.y, glyph: def.glyph, color: def.color };
  });

  // 火势/烟雾层：明火优先于烟（同格只画火苗），烟雾仅作半透明视觉
  const burning = new Set(input.fireCells.map((p) => `${p.x},${p.y}`));
  const hazards: Glyph[] = input.fireCells.map((p) => ({
    x: p.x,
    y: p.y,
    glyph: FIRE_GLYPH,
    color: FIRE_COLOR,
    pulse: true,
  }));
  for (const p of input.smokeCells) {
    if (burning.has(`${p.x},${p.y}`)) continue;
    hazards.push({ x: p.x, y: p.y, glyph: SMOKE_GLYPH, color: SMOKE_COLOR });
  }

  return {
    map: input.map,
    depth: input.depth,
    visible: input.visible,
    explored: input.explored,
    markers: [
      {
        x: input.stairsDown.x,
        y: input.stairsDown.y,
        glyph: '>',
        color: '#c9a227',
      },
      ...trapGlyphs,
      ...shrineGlyphs,
    ],
    hazards,
    items,
    actors,
    dead: input.dead,
    stats: input.stats,
  };
}
