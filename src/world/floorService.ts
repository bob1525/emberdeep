/**
 * FloorService（里程碑 4）：楼层构建与推进逻辑的服务化迁移。
 * 从 game.ts 迁出：buildFloor（地图生成 + 怪物/物品/商人/奇遇建筑/陷阱/Boss 布置）、
 * descend（下楼推进）。依赖以最小上下文接口 FloorServiceCtx 注入，
 * 本模块不得 import game.ts（门面）：
 * - buildFloor 会整体重赋值门面的容器字段（map/monsters/merchant/traps/boss 等），
 *   一律经 getter/setter 访问器读写，保证写回门面；
 * - player/rng/affixData/memories/effects 按引用传入、就地变更；
 * - 怪物占用查询、词缀清理、FOV 刷新、最大深度记录等回调由门面提供
 *   （行为、日志文本、音效与 RNG 消耗顺序与迁移前逐位一致）。
 */
import { playSfx } from '../engine/audio';
import type { MonsterMemory } from '../engine/brain';
import type { Pt } from '../engine/los';
import { RANGED } from '../engine/ranged';
import type { Rng } from '../engine/rng';
import { allocateItemUid, makeActor } from '../entities/actor';
import type { Actor } from '../entities/actor';
import { rollMonster } from '../entities/monsters';
import { bossForDepth } from '../entities/bosses';
import type { BossDef } from '../entities/bosses';
import { rollElite, scaleAttack, scaleHp } from '../entities/scaling';
import { rollGold } from '../economy/gold';
import { rollStock } from '../economy/merchant';
import type { GoldPile, GroundItem, LogTone, MerchantState } from '../economy/inventoryService';
import { rollLoot } from '../items/catalog';
import { rollAffixData } from '../items/affixes';
import type { AffixData } from '../items/affixes';
import type { Effect } from '../ui/renderer';
import type { GameMap } from '../world/map';
import { generateFloor } from './generators/floor';
import { rollTraps } from './traps';
import type { PlacedTrap } from './traps';
import type { ShrineKind } from './shrines';

/** 楼层上的一座奇遇建筑（祭坛/许愿井） */
export interface FloorShrine {
  x: number;
  y: number;
  kind: ShrineKind;
}

/**
 * 楼层服务的最小上下文。
 * player/rng/affixData/memories/effects 按引用传入（服务只做就地变更，绝不重赋值）；
 * map/stairsDown/monsters/goldPiles/groundItems/merchant/shrines/traps/explored/boss
 * 是门面侧会被整体重赋值的字段，经访问器读写以保证写回。
 */
export interface FloorServiceCtx {
  // ---- 按引用传入的就地变更对象 ----
  readonly rng: Rng;
  readonly player: Actor;
  /** 怪物 AI 记忆（换层时清空） */
  readonly memories: Map<number, MonsterMemory>;
  /** 物品词缀数据（装备落地时写入） */
  readonly affixData: Map<number, AffixData>;
  /** 打击感特效队列：服务只就地 push */
  readonly effects: Effect[];
  // ---- 门面会重赋值的标量/容器：经访问器读写 ----
  /** 当前层深（buildFloor 按它生成，descend 递增） */
  getDepth(): number;
  setDepth(depth: number): void;
  getMap(): GameMap;
  setMap(map: GameMap): void;
  getStairsDown(): Pt;
  setStairsDown(stairs: Pt): void;
  getMonsters(): Actor[];
  setMonsters(monsters: Actor[]): void;
  getGoldPiles(): GoldPile[];
  setGoldPiles(piles: GoldPile[]): void;
  getGroundItems(): GroundItem[];
  setGroundItems(items: GroundItem[]): void;
  getMerchant(): MerchantState | null;
  setMerchant(merchant: MerchantState | null): void;
  getShrines(): FloorShrine[];
  setShrines(shrines: FloorShrine[]): void;
  setTraps(traps: PlacedTrap[]): void;
  /** 已探索集合（buildFloor 整体替换为新 Set） */
  setExplored(explored: Set<string>): void;
  /** 存活 Boss 及其定义（Boss 战系统按引用读取，只写回） */
  setBoss(boss: Actor | null): void;
  setBossDef(def: BossDef | null): void;
  // ---- 门面回调 ----
  /** 指定坐标是否有怪物占用（Boss 落位避让） */
  monsterAt(x: number, y: number): Actor | undefined;
  /** 换层时清理不再被引用的词缀数据（P1-14，门面委托 InventoryEconomyService） */
  pruneAffixData(): void;
  /** 记录历史最深进度（ENDLESS 元进度，门面写 localStorage） */
  recordDepth(depth: number): void;
  /** 重算 FOV 并合并进已探索集合 */
  updateFov(): void;
  /** 消息日志 */
  log(text: string, tone: LogTone): void;
}

/** 楼层构建/推进服务：无状态编排，全部状态经上下文读写 */
export class FloorService {
  constructor(private readonly ctx: FloorServiceCtx) {}

  /**
   * 构建当前层：生成地图与楼梯，放置玩家出生点，布置怪物、物品、
   * 商人、奇遇建筑、陷阱与关底 Boss。RNG 消耗顺序与迁移前逐位一致。
   */
  buildFloor(): void {
    const ctx = this.ctx;
    const depth = ctx.getDepth();
    const floor = generateFloor(depth, ctx.rng.int(1, 2147483647));
    ctx.setMap(floor.map);
    ctx.setStairsDown({ ...floor.stairsDown });
    ctx.player.x = floor.playerSpawn.x;
    ctx.player.y = floor.playerSpawn.y;
    ctx.setMonsters(
      floor.monsterSpawns.map((p) => {
        const t = rollMonster(depth, ctx.rng);
        // ENDLESS 深度缩放（M5）：depth > 5 后 HP/攻击逐层增强；20 层起精英变体
        const hp = scaleHp(t.maxHp, depth);
        const attack = scaleAttack(t.attack, depth);
        const elite = rollElite(depth, ctx.rng.next());
        return makeActor({
          species: t.species,
          name: elite ? `${elite.name}${t.name}` : t.name,
          glyph: t.glyph,
          color: t.color,
          x: p.x,
          y: p.y,
          hp: Math.round(hp * (elite?.hpFactor ?? 1)),
          maxHp: Math.round(hp * (elite?.hpFactor ?? 1)),
          attack: Math.round(attack * (elite?.attackFactor ?? 1)),
          defense: t.defense,
          xpValue: Math.round(t.xpValue * (elite?.xpFactor ?? 1)),
          ai: { mode: 'sleep', senseRadius: t.senseRadius },
        });
      }),
    );
    ctx.memories.clear();
    ctx.setGoldPiles([]);
    ctx.setGroundItems([]);
    for (const p of floor.itemSpots) {
      if (ctx.rng.next() < 0.3) {
        // 金币堆
        ctx.getGoldPiles().push({ x: p.x, y: p.y, amount: rollGold(depth, ctx.rng) });
      } else if (ctx.rng.next() < 0.25) {
        // 远程武器
        const pool = Object.entries(RANGED).filter(([, d]) => d.minDepth <= depth);
        const entry = ctx.rng.pick(pool);
        if (entry) {
          ctx.getGroundItems().push({
            x: p.x,
            y: p.y,
            item: { uid: allocateItemUid(), catalogId: entry[0], category: 'ranged' },
          });
          continue;
        }
        ctx.getGroundItems().push({ x: p.x, y: p.y, item: rollLoot(depth, ctx.rng) });
      } else {
        const item = rollLoot(depth, ctx.rng);
        // 装备类随机词缀
        if (item.category === 'weapon' || item.category === 'armor') {
          ctx.affixData.set(item.uid, rollAffixData(depth, ctx.rng));
        }
        ctx.getGroundItems().push({ x: p.x, y: p.y, item });
      }
    }
    this.placeMerchant(floor);
    this.placeShrines(floor);
    this.placeTraps(floor);
    this.placeBoss(floor);
    ctx.pruneAffixData();
    ctx.setExplored(new Set());
    ctx.updateFov();
  }

  /** 下楼推进：只有站在楼梯上才能下一层（depth 经上下文递增后重建楼层） */
  descend(): boolean {
    const ctx = this.ctx;
    if (ctx.player.x === ctx.getStairsDown().x && ctx.player.y === ctx.getStairsDown().y) {
      const depth = ctx.getDepth() + 1;
      ctx.setDepth(depth);
      ctx.recordDepth(depth);
      ctx.log(`你走下楼梯，来到第 ${depth} 层。`, 'info');
      playSfx('stairs');
      ctx.effects.push({ kind: 'flashScreen', color: '#2f7d4f', dur: 450 });
      this.buildFloor();
      return true;
    }
    ctx.log('脚下没有向下的楼梯。', 'info');
    return false;
  }

  /** 每 5 层放置关底 Boss，并播报登场演出 */
  private placeBoss(floor: { playerSpawn: Pt }): void {
    const ctx = this.ctx;
    ctx.setBoss(null);
    const def = bossForDepth(ctx.getDepth());
    ctx.setBossDef(def);
    if (!def) return;
    const candidates: Pt[] = [];
    const map = ctx.getMap();
    const stairs = ctx.getStairsDown();
    for (let y = 1; y < map.height - 1; y++) {
      for (let x = 1; x < map.width - 1; x++) {
        if (!map.isWalkable(x, y)) continue;
        if (x === stairs.x && y === stairs.y) continue;
        if (ctx.monsterAt(x, y)) continue;
        const merchant = ctx.getMerchant();
        if (merchant && merchant.x === x && merchant.y === y) continue;
        if (ctx.getShrines().some((s) => s.x === x && s.y === y)) continue;
        const dist = Math.max(Math.abs(x - floor.playerSpawn.x), Math.abs(y - floor.playerSpawn.y));
        if (dist < 14) continue;
        candidates.push({ x, y });
      }
    }
    if (candidates.length === 0) return;
    const spot = ctx.rng.pick(candidates);
    // ENDLESS 缩放（M5）：Boss 超过其 minDepth 重复登场时按层差 +12% HP / +8% 攻
    const hp = scaleHp(def.maxHp, ctx.getDepth());
    const attack = scaleAttack(def.attack, ctx.getDepth());
    const boss = makeActor({
      species: def.species,
      name: def.name,
      glyph: def.glyph,
      color: def.color,
      x: spot.x,
      y: spot.y,
      hp,
      maxHp: hp,
      attack,
      defense: def.defense,
      xpValue: Math.round(def.xpValue * (hp / def.maxHp)),
      ai: { mode: 'sleep', senseRadius: def.senseRadius },
    });
    ctx.setBoss(boss);
    ctx.getMonsters().push(boss);
    ctx.log(def.introText, 'bad');
  }

  /** 每层放一位流浪商人：离出生点较远的随机地板 */
  private placeMerchant(floor: { playerSpawn: Pt }): void {
    const ctx = this.ctx;
    const candidates: Pt[] = [];
    const map = ctx.getMap();
    const stairs = ctx.getStairsDown();
    for (let y = 1; y < map.height - 1; y++) {
      for (let x = 1; x < map.width - 1; x++) {
        if (!map.isWalkable(x, y)) continue;
        if (x === stairs.x && y === stairs.y) continue;
        const dist = Math.max(Math.abs(x - floor.playerSpawn.x), Math.abs(y - floor.playerSpawn.y));
        if (dist < 12) continue;
        candidates.push({ x, y });
      }
    }
    if (candidates.length === 0) {
      ctx.setMerchant(null);
      return;
    }
    const spot = ctx.rng.pick(candidates);
    ctx.setMerchant({ x: spot.x, y: spot.y, stock: rollStock(ctx.getDepth(), ctx.rng) });
  }

  /** 每层一座奇遇建筑：奇数层祭坛 / 偶数层许愿井 */
  private placeShrines(floor: {
    playerSpawn: Pt;
    stairsDown: Pt;
    itemSpots: Pt[];
    monsterSpawns: Pt[];
  }): void {
    const ctx = this.ctx;
    ctx.setShrines([]);
    const candidates: Pt[] = [];
    const map = ctx.getMap();
    const stairs = ctx.getStairsDown();
    for (let y = 1; y < map.height - 1; y++) {
      for (let x = 1; x < map.width - 1; x++) {
        if (!map.isWalkable(x, y)) continue;
        if (x === stairs.x && y === stairs.y) continue;
        if (floor.playerSpawn.x === x && floor.playerSpawn.y === y) continue;
        if (floor.itemSpots.some((p) => p.x === x && p.y === y)) continue;
        if (floor.monsterSpawns.some((p) => p.x === x && p.y === y)) continue;
        const merchant = ctx.getMerchant();
        if (merchant && merchant.x === x && merchant.y === y) continue;
        candidates.push({ x, y });
      }
    }
    if (candidates.length === 0) return;
    const spot = ctx.rng.pick(candidates);
    const kind: ShrineKind = ctx.getDepth() % 2 === 1 ? 'altar' : 'well';
    ctx.getShrines().push({ x: spot.x, y: spot.y, kind });
  }

  /** 按深度撒陷阱：避开出生点、楼梯、商人位、奇遇建筑与物品点 */
  private placeTraps(floor: { playerSpawn: Pt; stairsDown: Pt; itemSpots: Pt[] }): void {
    const ctx = this.ctx;
    const candidates: Pt[] = [];
    const map = ctx.getMap();
    for (let y = 1; y < map.height - 1; y++) {
      for (let x = 1; x < map.width - 1; x++) {
        if (!map.isWalkable(x, y)) continue;
        if (x === floor.playerSpawn.x && y === floor.playerSpawn.y) continue;
        if (x === floor.stairsDown.x && y === floor.stairsDown.y) continue;
        if (floor.itemSpots.some((p) => p.x === x && p.y === y)) continue;
        const merchant = ctx.getMerchant();
        if (merchant && merchant.x === x && merchant.y === y) continue;
        if (ctx.getShrines().some((s) => s.x === x && s.y === y)) continue;
        candidates.push({ x, y });
      }
    }
    ctx.setTraps(rollTraps(ctx.getDepth(), Math.min(6, 1 + ctx.getDepth()), candidates, ctx.rng));
  }
}
