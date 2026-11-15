/**
 * InventoryEconomyService（里程碑 4）：背包 / 装备 / 商人 / 金币逻辑的服务化迁移。
 * 从 game.ts 迁出：捡拾（pickup）、喝药（quaff）、背包使用/丢弃（useSlot/dropSlot）、
 * 卷轴（传送/烈焰）、商人买卖（buy/sell）、远程武器查找与词缀数据清理。
 * 依赖以最小上下文接口 InventoryEconomyCtx 注入，本模块不得 import game.ts（门面）：
 * - 实体与容器（player/groundItems/goldPiles/merchant/map/effects）按引用传入、就地变更；
 * - 会被重赋值的标量（gold/mightUntil）经 getter/setter 读写，规避引用失效；
 * - 击杀/可见目标/日志等回调由门面提供（行为与音效保持与迁移前逐位一致）。
 */
import { playSfx } from '../engine/audio';
import { applyStatus } from '../engine/statuses';
import { RANGED } from '../engine/ranged';
import type { Rng } from '../engine/rng';
import { allocateItemUid } from '../entities/actor';
import type { Actor, ItemInstance } from '../entities/actor';
import type { StockEntry } from './merchant';
import { sellPrice } from './merchant';
import { itemDef, weaponBonus, armorBonus } from '../items/catalog';
import { itemInfo } from '../ui/sceneBuilder';
import type { Effect } from '../ui/renderer';
import type { GameMap } from '../world/map';

/** 消息语气（与 game.ts 的 Tone 同构；服务不得反向 import 门面，故此处独立声明） */
export type LogTone = 'info' | 'good' | 'bad' | 'combat';

/** 背包容量上限 */
export const MAX_INVENTORY = 12;

/** 地面的一件物品 */
export interface GroundItem {
  x: number;
  y: number;
  item: ItemInstance;
}

/** 地面的一堆金币 */
export interface GoldPile {
  x: number;
  y: number;
  amount: number;
}

/** 流浪商人（位置 + 当前货架） */
export interface MerchantState {
  x: number;
  y: number;
  stock: StockEntry[];
}

/**
 * 库存/经济服务的最小上下文。
 * 数组/Map/实体类依赖以引用传入（服务只做就地变更，绝不重赋值）；
 * gold / mightUntil 是门面侧会被重置的标量，经访问器读写以保证写回。
 */
export interface InventoryEconomyCtx {
  readonly player: Actor;
  readonly rng: Rng;
  readonly map: GameMap;
  readonly groundItems: GroundItem[];
  readonly goldPiles: GoldPile[];
  readonly merchant: MerchantState | null;
  /** 当前层深（商人卖价按层计） */
  readonly depth: number;
  /** 当前回合（力量药水计时起点） */
  readonly turn: number;
  /** 读钱袋 */
  getGold(): number;
  /** 增减钱袋（买卖/捡拾） */
  addGold(delta: number): void;
  /** 设置余烬之力（力量药水）到期回合 */
  setMightUntil(turn: number): void;
  /** 打击感特效队列：服务只就地 push */
  readonly effects: Effect[];
  /** 删除一件物品的词缀数据（卖出时清理） */
  deleteAffixData(uid: number): void;
  /** 当前全部词缀 uid（换层清理用） */
  affixUids(): number[];
  /** 天赋·贪婪的金币加成系数 */
  talentGoldBonus(): number;
  /** 当前可见敌人（烈焰卷轴的目标集） */
  visibleTargets(): Actor[];
  /** 击杀怪物结算（经验/金币掉落/演出仍由门面负责） */
  killMonster(target: Actor): void;
  /** 火势：点燃指定格（走门面燃料语义；返回是否产生新的燃烧格） */
  igniteCell(x: number, y: number): boolean;
  /** 消息日志 */
  log(text: string, tone: LogTone): void;
}

/** 库存/装备/经济服务：无状态编排，全部状态经上下文读写 */
export class InventoryEconomyService {
  constructor(private readonly ctx: InventoryEconomyCtx) {}

  /** 背包里可用的远程武器：优先弓（可重复），其次投掷物 */
  rangedInInventory(): ItemInstance | null {
    return (
      this.ctx.player.inventory.find(
        (it) => it.category === 'ranged' && RANGED[it.catalogId]?.kind === 'bow',
      ) ??
      this.ctx.player.inventory.find((it) => it.category === 'ranged' && RANGED[it.catalogId]?.thrown) ??
      null
    );
  }

  /** 商店里买下指定货架槽位 */
  buyFromMerchant(slot: number): void {
    const merchant = this.ctx.merchant;
    if (!merchant) return;
    const entry = merchant.stock[slot];
    if (!entry) return;
    if (this.ctx.getGold() < entry.price) {
      this.ctx.log('金币不够，商人摇了摇头。', 'info');
      return;
    }
    if (this.ctx.player.inventory.length >= MAX_INVENTORY) {
      this.ctx.log('背包满了，拿不下更多货物。', 'info');
      return;
    }
    const item: ItemInstance = {
      uid: allocateItemUid(),
      catalogId: entry.catalogId,
      category: entry.category,
    };
    this.ctx.addGold(-entry.price);
    merchant.stock.splice(slot, 1);
    this.ctx.player.inventory.push(item);
    playSfx('pickup');
    this.ctx.log(`买下了${itemInfo(item).name}（-${entry.price} 金币）。`, 'good');
  }

  /** 商店里卖掉背包指定槽位的物品 */
  sellFromInventory(slot: number): void {
    const merchant = this.ctx.merchant;
    if (!merchant) return;
    const item = this.ctx.player.inventory[slot];
    if (!item) return;
    const price = sellPrice(item.catalogId, item.category, this.ctx.depth);
    this.ctx.player.inventory.splice(slot, 1);
    this.ctx.deleteAffixData(item.uid);
    this.ctx.addGold(price);
    playSfx('pickup');
    this.ctx.log(`卖掉了${itemInfo(item).name}，得到 ${price} 金币。`, 'good');
  }

  /** 捡起脚下之物：金币堆优先；装备类先与身上对比，更好才换装 */
  pickup(): boolean {
    // 金币堆优先
    const goldIdx = this.ctx.goldPiles.findIndex(
      (g) => g.x === this.ctx.player.x && g.y === this.ctx.player.y,
    );
    if (goldIdx !== -1) {
      const pile = this.ctx.goldPiles.splice(goldIdx, 1)[0];
      if (!pile) return false;
      const gained = Math.floor(pile.amount * (1 + this.ctx.talentGoldBonus()));
      this.ctx.addGold(gained);
      playSfx('pickup');
      this.ctx.log(`拾起了 ${gained} 金币。`, 'good');
      return true;
    }
    const idx = this.ctx.groundItems.findIndex(
      (g) => g.x === this.ctx.player.x && g.y === this.ctx.player.y,
    );
    if (idx === -1) {
      this.ctx.log('这里没有可以捡的东西。', 'info');
      return false;
    }
    const ground = this.ctx.groundItems.splice(idx, 1)[0];
    if (!ground) return false;
    const def = itemInfo(ground.item);

    if (ground.item.category === 'weapon' || ground.item.category === 'armor') {
      const slot = ground.item.category === 'weapon' ? 'weapon' : 'armor';
      const current = this.ctx.player.equipment[slot];
      const currentBonus = current
        ? slot === 'weapon'
          ? weaponBonus(current)
          : armorBonus(current)
        : -1;
      // 该分支里必是普通装备，直接查通用目录拿加成
      const catalogDef = itemDef(ground.item);
      const nextBonus = catalogDef.bonus ?? 0;
      if (nextBonus > currentBonus) {
        this.ctx.player.equipment[slot] = ground.item;
        this.ctx.log(
          `装备了${catalogDef.name}（${slot === 'weapon' ? '攻击' : '防御'} +${nextBonus}）。`,
          'good',
        );
        if (current) this.ctx.groundItems.push({ x: this.ctx.player.x, y: this.ctx.player.y, item: current });
        playSfx('pickup');
        return true;
      }
      this.ctx.log(`${def.name}不如身上的装备，留在了原地。`, 'info');
      this.ctx.groundItems.push(ground);
      return false;
    }

    if (this.ctx.player.inventory.length >= MAX_INVENTORY) {
      this.ctx.log('背包满了，拿不下更多东西。', 'info');
      this.ctx.groundItems.push(ground);
      return false;
    }
    this.ctx.player.inventory.push(ground.item);
    this.ctx.log(`拾起了${def.name}。`, 'good');
    playSfx('pickup');
    return true;
  }

  /** 喝药（q 键）：受伤优先高治疗量药水，满血时优先力量药水 */
  quaff(): boolean {
    const candidates = this.ctx.player.inventory
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.category === 'potion');
    if (candidates.length === 0) {
      this.ctx.log('背包里没有药水。', 'info');
      return false;
    }
    const hurt = this.ctx.player.hp < this.ctx.player.maxHp;
    const healPotions = candidates.filter(({ item }) => itemDef(item).heal !== undefined);
    let chosen = candidates[0];
    if (!chosen) return false;
    if (hurt && healPotions.length > 0) {
      // 优先喝治疗量最高的药水
      for (const c of healPotions) {
        const bestMax = itemDef(chosen.item).heal?.[1] ?? -1;
        const cMax = itemDef(c.item).heal?.[1] ?? -1;
        if (cMax > bestMax) chosen = c;
      }
    } else {
      // 满血或没有治疗药水时：喝力量药水，否则随便喝一瓶
      const might = candidates.find(({ item }) => itemDef(item).effect === 'might');
      chosen = might ?? healPotions[0] ?? chosen;
    }
    const def = itemDef(chosen.item);
    this.ctx.player.inventory.splice(chosen.index, 1);
    playSfx('quaff');
    if (def.effect === 'might') {
      this.ctx.setMightUntil(this.ctx.turn + (def.duration ?? 20));
      this.ctx.log(`${def.name}下肚，余烬之力涌遍全身！攻击 +3。`, 'good');
      return true;
    }
    const [lo, hi] = def.heal ?? [0, 0];
    const amount = this.ctx.rng.int(lo, hi);
    const before = this.ctx.player.hp;
    this.ctx.player.hp = Math.min(this.ctx.player.maxHp, this.ctx.player.hp + amount);
    this.ctx.log(`喝下${def.name}，恢复了 ${this.ctx.player.hp - before} 点生命。`, 'good');
    return true;
  }

  /** 背包界面：使用 / 装备指定槽位 */
  useInventorySlot(index: number): boolean {
    const item = this.ctx.player.inventory[index];
    if (!item) return false;
    if (item.category === 'ranged') {
      this.ctx.log('远程武器直接按 z 射击。', 'info');
      return false;
    }
    const def = itemDef(item);

    if (item.category === 'potion' && def.effect === 'might') {
      this.ctx.player.inventory.splice(index, 1);
      this.ctx.setMightUntil(this.ctx.turn + (def.duration ?? 20));
      playSfx('quaff');
      this.ctx.log(`${def.name}下肚，余烬之力涌遍全身！攻击 +3。`, 'good');
      return true;
    }
    if (item.category === 'potion' && def.heal) {
      this.ctx.player.inventory.splice(index, 1);
      const [lo, hi] = def.heal;
      const amount = this.ctx.rng.int(lo ?? 0, hi ?? 0);
      const before = this.ctx.player.hp;
      this.ctx.player.hp = Math.min(this.ctx.player.maxHp, this.ctx.player.hp + amount);
      playSfx('quaff');
      this.ctx.log(`喝下${def.name}，恢复了 ${this.ctx.player.hp - before} 点生命。`, 'good');
      return true;
    }
    if (item.category === 'scroll' && def.effect === 'teleport') {
      this.ctx.player.inventory.splice(index, 1);
      return this.applyTeleport();
    }
    if (item.category === 'scroll' && def.effect === 'fireblast') {
      const targets = this.ctx.visibleTargets();
      if (targets.length === 0) {
        this.ctx.log('视野内没有敌人，卷轴没有点燃的理由。', 'info');
        return false;
      }
      this.ctx.player.inventory.splice(index, 1);
      return this.applyFireblast(targets);
    }
    if (item.category === 'weapon' || item.category === 'armor') {
      // 强制换装，原装备放回背包
      const slot = item.category;
      const current = this.ctx.player.equipment[slot];
      this.ctx.player.equipment[slot] = item;
      this.ctx.player.inventory.splice(index, 1);
      if (current) this.ctx.player.inventory.push(current);
      playSfx('pickup');
      this.ctx.log(`装备了${def.name}。`, 'good');
      return true;
    }
    return false;
  }

  /** 背包界面：丢弃指定槽位到脚下 */
  dropInventorySlot(index: number): boolean {
    const item = this.ctx.player.inventory[index];
    if (!item) return false;
    this.ctx.player.inventory.splice(index, 1);
    this.ctx.groundItems.push({ x: this.ctx.player.x, y: this.ctx.player.y, item });
    this.ctx.log(`丢下了${itemDef(item).name}。`, 'info');
    return true;
  }

  /** 使用传送卷轴（快捷键路径） */
  castTeleport(): boolean {
    const idx = this.findScroll('teleport');
    if (idx === -1) {
      this.ctx.log('没有传送卷轴。', 'info');
      return false;
    }
    this.ctx.player.inventory.splice(idx, 1);
    return this.applyTeleport();
  }

  /** 传送到随机地板格（快捷键与背包使用共用；陷阱误触也走这里） */
  applyTeleport(): boolean {
    let tx = 0;
    let ty = 0;
    let ok = false;
    for (let i = 0; i < 500 && !ok; i++) {
      tx = this.ctx.rng.int(1, this.ctx.map.width - 2);
      ty = this.ctx.rng.int(1, this.ctx.map.height - 2);
      ok = this.ctx.map.isWalkable(tx, ty);
    }
    if (!ok) {
      this.ctx.log('卷轴失效了……', 'info');
      return false;
    }
    this.ctx.player.x = tx;
    this.ctx.player.y = ty;
    this.ctx.log('空间在你面前折叠，你出现在另一处。', 'good');
    playSfx('teleport');
    this.ctx.effects.push({ kind: 'flashScreen', color: '#3a6ea5', dur: 400 });
    return true;
  }

  /** 使用烈焰卷轴（快捷键路径） */
  castFireblast(): boolean {
    const idx = this.findScroll('fireblast');
    if (idx === -1) {
      this.ctx.log('没有烈焰卷轴。', 'info');
      return false;
    }
    const targets = this.ctx.visibleTargets();
    if (targets.length === 0) {
      this.ctx.log('视野内没有敌人，卷轴没有点燃的理由。', 'info');
      return false;
    }
    this.ctx.player.inventory.splice(idx, 1);
    return this.applyFireblast(targets);
  }

  /** 烈焰卷轴结算：灼烧全部可见敌人并附加燃烧 */
  applyFireblast(targets: Actor[]): boolean {
    this.ctx.log('烈焰从卷轴中喷涌而出！', 'combat');
    playSfx('zap');
    this.ctx.effects.push({ kind: 'quake', dur: 260 });
    for (const t of targets) {
      const damage = this.ctx.rng.int(8, 14);
      t.hp -= damage;
      applyStatus(t, 'burn', 3, 2);
      this.ctx.effects.push(
        { kind: 'flash', x: t.x, y: t.y, color: '#f5803a' },
        { kind: 'float', x: t.x, y: t.y, text: `-${damage}`, color: '#f5803a' },
      );
      this.ctx.log(`火焰吞噬了${t.name}（${damage} 伤害）。`, 'combat');
      if (t.hp <= 0) this.ctx.killMonster(t);
    }
    // 火势集成：爆炸范围内地面格点燃（命中目标周边 1 格；墙等不可燃格自动无效）
    let ignitedAny = false;
    for (const t of targets) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (this.ctx.igniteCell(t.x + dx, t.y + dy)) ignitedAny = true;
        }
      }
    }
    if (ignitedAny) {
      this.ctx.log('火焰引燃了地面，火势开始肆虐！', 'combat');
    }
    return true;
  }

  /** 背包里第一件指定效果的卷轴下标（没有则 -1） */
  private findScroll(effect: 'teleport' | 'fireblast'): number {
    return this.ctx.player.inventory.findIndex(
      (it) => it.category === 'scroll' && itemDef(it).effect === effect,
    );
  }

  /** 换层时清理不再被任何实体引用的词缀数据（P1-14），防止无界累积 */
  pruneAffixData(): void {
    const keep = new Set<number>();
    for (const it of this.ctx.player.inventory) keep.add(it.uid);
    if (this.ctx.player.equipment.weapon) keep.add(this.ctx.player.equipment.weapon.uid);
    if (this.ctx.player.equipment.armor) keep.add(this.ctx.player.equipment.armor.uid);
    for (const uid of this.ctx.affixUids()) {
      if (!keep.has(uid)) this.ctx.deleteAffixData(uid);
    }
  }
}
