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
    items,
    actors,
    dead: input.dead,
    stats: input.stats,
  };
}
