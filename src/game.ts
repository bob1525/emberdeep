import { isMuted, playSfx, setMuted } from './engine/audio';
import type { Action } from './engine/input';
import { computeFov } from './engine/fov';
import { decideMonsterAction } from './engine/ai';
import { resolveAttack } from './engine/combat';
import { hasLineOfSight } from './engine/los';
import type { Pt } from './engine/los';
import { Rng } from './engine/rng';
import {
  STATUSES,
  actionsPerTurn,
  applyStatus,
  hasStatus,
  tickStatuses,
  totalDefenseBonus,
} from './engine/statuses';
import {
  createPlayer,
  makeActor,
  allocateItemUid,
  type Actor,
  type ItemInstance,
} from './entities/actor';
import { rollMonster } from './entities/monsters';
import { itemDef, rollLoot, weaponBonus, armorBonus } from './items/catalog';
import { RANGED, resolveShot } from './engine/ranged';

/** 统一取物品展示信息：远程武器走 RANGED 目录，其余走通用目录 */
function itemInfo(item: ItemInstance): {
  name: string;
  glyph: string;
  color: string;
  description?: string;
} {
  if (item.category === 'ranged') {
    const def = RANGED[item.catalogId];
    if (def) return def;
  }
  return itemDef(item);
}
import { generateFloor } from './world/generators/floor';
import { GameMap } from './world/map';
import { TRAPS, rollTraps, triggerTrap } from './world/traps';
import type { PlacedTrap } from './world/traps';
import type { Tile } from './world/tiles';
import { drawMinimap, type Effect, type Glyph, type Renderer, type Scene } from './ui/renderer';

export type Tone = 'info' | 'good' | 'bad' | 'combat';

export interface LogEntry {
  text: string;
  tone: Tone;
}

/** UI 界面模式：菜单 / 背包 / 消息历史等界面功能的地基 */
export type UiMode = 'title' | 'play' | 'inventory' | 'log' | 'targeting';

export interface GroundItem {
  x: number;
  y: number;
  item: ItemInstance;
}

const SAVE_KEY = 'emberdeep-save-v1';

/** localStorage 存档结构。version 用于未来格式迁移 */
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
}

const FOV_RADIUS = 8;
const MIGHT_ATTACK_BONUS = 3;
const MAX_INVENTORY = 12;

/** 游戏总控：回合循环、战斗编排、楼层推进、物品使用 */
export class Game {
  depth = 1;
  turn = 0;
  level = 1;
  xp = 0;
  dead = false;
  player: Actor;
  /** 本局击杀数（死亡统计用） */
  kills = 0;
  deathCause = '未知';
  /** 当前界面模式；游戏从标题画面开始 */
  mode: UiMode = 'title';
  /** 消息历史查看游标（log 模式；null = 定位在最新） */
  logCursor: number | null = null;

  private map: GameMap = GameMap.filled(1, 1, 'wall');
  private stairsDown: { x: number; y: number } = { x: 0, y: 0 };
  private monsters: Actor[] = [];
  private groundItems: GroundItem[] = [];
  private traps: PlacedTrap[] = [];
  private visible = new Set<string>();
  private explored = new Set<string>();
  private effects: Effect[] = [];
  private mightUntil = 0;
  private autoExploring = false;
  private autoPath: Pt[] | null = null;
  private rng: Rng;
  private runSeed: number;
  private log: LogEntry[] = [];

  /** 状态变化后由 main 注入的刷新回调 */
  onChange: (() => void) | null = null;

  constructor(
    private renderer: Renderer,
    runSeed = Date.now() % 2147483647,
    save?: SaveData | null,
  ) {
    this.runSeed = (runSeed % 2147483647) || 1;
    this.rng = new Rng(this.runSeed);
    this.player = createPlayer(0, 0);
    this.log.push({ text: '你在余烬深渊的第 1 层醒来，身后的楼梯已经塌了……', tone: 'info' });
    if (save) {
      try {
        this.hydrate(save);
        return;
      } catch {
        this.log.push({ text: '存档已损坏，开始新的冒险。', tone: 'info' });
        this.player = createPlayer(0, 0);
      }
    }
    this.buildFloor();
  }

  start(): void {
    this.render();
    this.onChange?.();
  }

  /** 每回合自动存档；失败（隐私模式等）静默降级 */
  private persist(): void {
    try {
      const data: SaveData = {
        version: 1,
        depth: this.depth,
        turn: this.turn,
        level: this.level,
        xp: this.xp,
        mightUntil: this.mightUntil,
        runSeed: this.runSeed,
        player: this.player,
        monsters: this.monsters,
        groundItems: this.groundItems,
        explored: [...this.explored],
        stairsDown: this.stairsDown,
        mapWidth: this.map.width,
        mapHeight: this.map.height,
        mapTiles: this.map.exportGrid(),
        rngState: this.rng.snapshot(),
        kills: this.kills,
        deathCause: this.deathCause,
        traps: this.traps,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      // 忽略存储异常
    }
  }

  /** 读取并校验存档；损坏或版本不符返回 null */
  static readSave(): SaveData | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as SaveData;
      if (data.version !== 1) return null;
      if (!Array.isArray(data.mapTiles) || !Array.isArray(data.explored)) return null;
      if (!Array.isArray(data.monsters) || !Array.isArray(data.groundItems)) return null;
      if (!data.player || data.player.hp <= 0) return null;
      if (data.mapTiles.length !== data.mapWidth * data.mapHeight) return null;
      return data;
    } catch {
      return null;
    }
  }

  static clearSave(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // 忽略存储异常
    }
  }

  private hydrate(save: SaveData): void {
    // 先恢复最可能损坏的地图，失败时构造函数能干净回退
    this.map = new GameMap(save.mapWidth, save.mapHeight, save.mapTiles);
    this.stairsDown = { ...save.stairsDown };
    this.explored = new Set(save.explored);
    // 兼容旧存档：statuses / energy 是后加字段，缺失时补默认值
    this.player = {
      ...save.player,
      statuses: save.player.statuses ?? [],
      energy: save.player.energy ?? 0,
    };
    this.monsters = save.monsters.map((m) => ({
      ...m,
      statuses: m.statuses ?? [],
      energy: m.energy ?? 0,
    }));
    this.groundItems = save.groundItems;
    this.traps = save.traps ?? [];
    this.kills = save.kills ?? 0;
    this.deathCause = save.deathCause ?? '未知';
    this.depth = save.depth;
    this.turn = save.turn;
    this.level = save.level;
    this.xp = save.xp;
    this.mightUntil = save.mightUntil;
    this.runSeed = save.runSeed;
    this.rng = Rng.fromState(save.rngState);
    this.log.push({ text: `欢迎回来——继续第 ${this.depth} 层的冒险。`, tone: 'info' });
    this.updateFov();
  }

  handleAction(action: Action): void {
    if (action.type === 'toggleMute') {
      setMuted(!isMuted());
      this.log.push({ text: isMuted() ? '音效已关闭。' : '音效已开启。', tone: 'info' });
      this.render();
      this.onChange?.();
      return;
    }

    switch (this.mode) {
      case 'title':
        this.handleTitle(action);
        break;
      case 'inventory':
        this.handleInventory(action);
        break;
      case 'log':
        this.handleLog(action);
        break;
      case 'play':
        this.handlePlay(action);
        break;
      case 'targeting':
        this.handleTargeting(action);
        break;
    }

    if (this.mode === 'play') this.updateFov();
    this.render();
    this.onChange?.();
  }

  private handleTitle(action: Action): void {
    if (action.type === 'titleNew') {
      this.newRun();
      this.mode = 'play';
    } else if (action.type === 'titleContinue') {
      if (this.continueFromSave()) this.mode = 'play';
    }
  }

  private handlePlay(action: Action): void {
    if (this.dead) {
      if (action.type === 'restart') this.newRun();
      return;
    }
    // 任何主动操作都会打断自动探索（o 本身除外，用于开关）
    if (this.autoExploring && action.type !== 'autoExplore') {
      this.autoExploring = false;
      this.autoPath = null;
    }
    if (action.type === 'autoExplore') {
      this.autoExploring = !this.autoExploring;
      this.autoPath = null;
      if (this.autoExploring) {
        this.log.push({ text: '开始自动探索……', tone: 'info' });
        this.autoStep();
      } else {
        this.log.push({ text: '自动探索已停止。', tone: 'info' });
      }
      return;
    }
    if (action.type === 'openInventory') {
      this.mode = 'inventory';
      return;
    }
    if (action.type === 'openLog') {
      this.mode = 'log';
      return;
    }
    if (action.type === 'aimBow') {
      this.tryEnterTargeting();
      return;
    }
    if (this.doPlayerAction(action)) this.endPlayerTurn();
  }

  private handleTargeting(action: Action): void {
    if (action.type === 'closeOverlay') {
      this.mode = 'play';
      return;
    }
    if (action.type === 'move') {
      if (this.fire(action.dx, action.dy)) {
        this.mode = 'play';
        this.endPlayerTurn();
      }
      return;
    }
    // 其他按键一律取消瞄准
    this.mode = 'play';
  }

  /** 背包里可用的远程武器：优先弓（可重复），其次投掷物 */
  private rangedInInventory(): ItemInstance | null {
    return (
      this.player.inventory.find(
        (it) => it.category === 'ranged' && RANGED[it.catalogId]?.kind === 'bow',
      ) ??
      this.player.inventory.find((it) => it.category === 'ranged' && RANGED[it.catalogId]?.thrown) ??
      null
    );
  }

  private tryEnterTargeting(): void {
    if (!this.rangedInInventory()) {
      this.log.push({ text: '背包里没有远程武器。', tone: 'info' });
      return;
    }
    this.mode = 'targeting';
  }

  /** 朝方向射一箭 / 掷一刀 */
  private fire(dx: number, dy: number): boolean {
    const weapon = this.rangedInInventory();
    if (!weapon) {
      this.log.push({ text: '背包里没有远程武器。', tone: 'info' });
      return false;
    }
    const def = RANGED[weapon.catalogId];
    if (!def) return false;
    const report = resolveShot({
      from: { x: this.player.x, y: this.player.y },
      dx,
      dy,
      def,
      isBlocked: (x, y) => !this.map.isWalkable(x, y),
      targetAt: (x, y) => this.monsterAt(x, y) !== undefined,
      rng: this.rng,
    });
    if (report.hit) {
      const target = this.monsterAt(report.x, report.y);
      if (target) {
        const damage = Math.max(1, report.damage - target.defense);
        target.hp -= damage;
        playSfx('hit');
        this.effects.push(
          { kind: 'float', x: target.x, y: target.y, text: `-${damage}`, color: '#8ecafc' },
          { kind: 'flash', x: target.x, y: target.y, color: '#8ecafc' },
        );
        this.log.push({
          text: `${def.name}命中了${target.name}（${damage} 伤害）。`,
          tone: 'combat',
        });
        if (target.hp <= 0) this.killMonster(target);
      }
    } else {
      this.log.push({ text: `${def.name}射空了。`, tone: 'info' });
    }
    // 投掷物掷出即消耗
    if (def.thrown) {
      const idx = this.player.inventory.indexOf(weapon);
      if (idx !== -1) this.player.inventory.splice(idx, 1);
    }
    return true;
  }

  private handleInventory(action: Action): void {
    switch (action.type) {
      case 'closeOverlay':
      case 'openInventory':
        this.mode = 'play';
        return;
      case 'useSlot':
        if (this.useInventorySlot(action.slot)) {
          this.mode = 'play';
          this.endPlayerTurn();
        }
        return;
      case 'dropSlot':
        if (this.dropInventorySlot(action.slot)) {
          this.mode = 'play';
          this.endPlayerTurn();
        }
        return;
      default:
        return;
    }
  }

  private handleLog(action: Action): void {
    if (action.type === 'scrollLog') {
      const base = this.logCursor ?? this.log.length - 1;
      this.logCursor = Math.max(0, Math.min(this.log.length - 1, base + action.dir));
      return;
    }
    // 任何其他按键都退出历史查看
    this.logCursor = null;
    this.mode = 'play';
  }

  /** 玩家行动成功后的公共回合结算 */
  private endPlayerTurn(): void {
    this.turn += 1;
    this.tickPlayerStatuses();
    if (!this.dead) {
      // 玩家加速 → 怪物隔回合行动；玩家减速 → 怪物一回合行动两轮
      const hasted = hasStatus(this.player, 'haste');
      const slowed = hasStatus(this.player, 'slow');
      if (!hasted || this.turn % 2 === 0) this.monsterTurns();
      if (slowed && !this.dead) this.monsterTurns();
    }
    this.tickMight();
    if (this.dead) {
      Game.clearSave();
    } else {
      this.persist();
    }
  }

  // ---------- 自动探索 ----------

  /**
   * 迭代式自动探索：每回合走向最近的未探索区域。
   * 视野内出现敌人、玩家死亡或无路可走时中断。
   */
  private autoStep(): void {
    let guard = 0;
    while (this.autoExploring && !this.dead && guard < 500) {
      guard += 1;
      if (this.visibleTargets().length > 0) {
        this.autoExploring = false;
        this.log.push({ text: '发现敌人，自动探索中断！', tone: 'info' });
        return;
      }
      if (!this.autoPath || this.autoPath.length === 0) {
        this.autoPath = this.pathToUnexplored();
        if (!this.autoPath) {
          this.autoExploring = false;
          this.log.push({ text: '这一层已经探索完毕。', tone: 'good' });
          return;
        }
      }
      const next = this.autoPath[0];
      if (!next) {
        this.autoPath = null;
        continue;
      }
      const dx = next.x - this.player.x;
      const dy = next.y - this.player.y;
      // 安全阀：路径步必须相邻（传送等意外位移会导致路径失效）
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        this.autoPath = null;
        continue;
      }
      if (this.tryPlayerMove(dx, dy)) {
        this.autoPath.shift();
        this.endPlayerTurn();
      } else {
        // 被堵住：重新寻路
        this.autoPath = null;
      }
    }
    if (guard >= 500) this.autoExploring = false;
  }

  /** BFS 找最近一块"边上还有未探索格"的可达区域，返回一步步的路径 */
  private pathToUnexplored(): Pt[] | null {
    const w = this.map.width;
    const startIdx = this.player.y * w + this.player.x;
    const seen = new Set<number>([startIdx]);
    const parent = new Map<number, number>();
    const queue: number[] = [startIdx];
    const dirs: readonly (readonly [number, number])[] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];

    const hasUnexploredNeighbor = (x: number, y: number): boolean => {
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (this.map.isWalkable(nx, ny) && !this.explored.has(`${nx},${ny}`)) return true;
      }
      return false;
    };

    while (queue.length > 0) {
      const cur = queue.shift();
      if (cur === undefined) break;
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      if (cur !== startIdx && hasUnexploredNeighbor(cx, cy)) {
        // 回溯出路径（不含起点）
        const path: Pt[] = [];
        let curIdx: number | undefined = cur;
        while (curIdx !== undefined && curIdx !== startIdx) {
          path.push({ x: curIdx % w, y: Math.floor(curIdx / w) });
          curIdx = parent.get(curIdx);
        }
        path.reverse();
        return path;
      }
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this.map.isWalkable(nx, ny)) continue;
        const nIdx = ny * w + nx;
        if (seen.has(nIdx)) continue;
        seen.add(nIdx);
        parent.set(nIdx, cur);
        queue.push(nIdx);
      }
    }
    return null;
  }

  /** 玩家身上的持续状态结算（中毒/燃烧/再生…），可能致死 */
  private tickPlayerStatuses(): void {
    const report = tickStatuses(this.player);
    for (const event of report.events) {
      const info = STATUSES[event.kind];
      if (!info) continue;
      if (event.damage > 0) {
        this.effects.push({
          kind: 'float',
          x: this.player.x,
          y: this.player.y,
          text: `-${event.damage}`,
          color: info.color,
        });
        this.log.push({ text: `${info.name}侵蚀着你（${event.damage} 伤害）。`, tone: 'bad' });
      } else if (event.damage < 0) {
        this.effects.push({
          kind: 'float',
          x: this.player.x,
          y: this.player.y,
          text: `+${-event.damage}`,
          color: info.color,
        });
        this.log.push({ text: `${info.name}让你恢复了 ${-event.damage} 点生命。`, tone: 'good' });
      } else if (event.expired) {
        this.log.push({ text: `${info.name}消退了。`, tone: 'info' });
      }
      if (this.player.hp <= 0) {
        this.dead = true;
        this.deathCause = info.name;
        playSfx('die');
        this.effects.push(
          { kind: 'quake', dur: 500 },
          { kind: 'flashScreen', color: '#5c1010', dur: 600 },
        );
        this.log.push({ text: `你死于${info.name}……按 R 重新开始。`, tone: 'bad' });
        break;
      }
    }
  }

  /** 从存档继续（标题菜单用）；失败保持当前界面 */
  continueFromSave(): boolean {
    const save = Game.readSave();
    if (!save) return false;
    try {
      this.hydrate(save);
      return true;
    } catch {
      this.log.push({ text: '存档已损坏，无法继续。', tone: 'info' });
      return false;
    }
  }

  recentLog(count = 8): LogEntry[] {
    return this.log.slice(-count);
  }

  /** 完整消息历史（log 界面用） */
  allLog(): LogEntry[] {
    return this.log;
  }

  xpToNext(): number {
    return this.level * 10;
  }

  effectiveAttack(): number {
    const weapon = this.player.equipment.weapon;
    const mightPart =
      this.mightUntil !== 0 && this.turn <= this.mightUntil ? MIGHT_ATTACK_BONUS : 0;
    return this.player.attack + (weapon ? weaponBonus(weapon) : 0) + mightPart;
  }

  effectiveDefense(): number {
    const armor = this.player.equipment.armor;
    return (
      this.player.defense + (armor ? armorBonus(armor) : 0) + totalDefenseBonus(this.player)
    );
  }

  // ---------- 玩家回合 ----------

  /** 返回 true 表示消耗了一个回合 */
  private doPlayerAction(action: Action): boolean {
    switch (action.type) {
      case 'move':
        return this.tryPlayerMove(action.dx, action.dy);
      case 'wait':
        return true;
      case 'pickup':
        return this.pickup();
      case 'quaff':
        return this.quaff();
      case 'useScroll':
        return action.scroll === 'teleport' ? this.castTeleport() : this.castFireblast();
      case 'descend':
        return this.descend();
      case 'restart':
        // 活着时按 R 不做任何事，防误触
        return false;
      default:
        // 其余 UI 类动作不会进入 play 模式的处理链
        return false;
    }
  }

  private tryPlayerMove(dx: number, dy: number): boolean {
    const nx = this.player.x + dx;
    const ny = this.player.y + dy;
    const target = this.monsterAt(nx, ny);
    if (target) {
      this.attackMonster(target);
      return true;
    }
    if (!this.map.isWalkable(nx, ny)) return false;
    this.player.x = nx;
    this.player.y = ny;
    this.checkTrap();
    return true;
  }

  private attackMonster(target: Actor): void {
    const report = resolveAttack({
      attackerName: '你',
      attack: this.effectiveAttack(),
      defenderName: target.name,
      defense: target.defense,
      defenderHp: target.hp,
      rng: this.rng,
    });
    target.hp -= report.damage;
    playSfx('hit');
    this.effects.push(
      { kind: 'float', x: target.x, y: target.y, text: `-${report.damage}`, color: '#f5b04c' },
      { kind: 'flash', x: target.x, y: target.y, color: '#ffffff' },
    );
    this.log.push({ text: `你击中了${target.name}，造成 ${report.damage} 点伤害。`, tone: 'combat' });
    if (report.killed) this.killMonster(target);
  }

  private killMonster(target: Actor): void {
    const idx = this.monsters.indexOf(target);
    if (idx !== -1) this.monsters.splice(idx, 1);
    this.kills += 1;
    playSfx('kill');
    this.effects.push({ kind: 'burst', x: target.x, y: target.y, color: '#d96a5a', dur: 420 });
    this.log.push({ text: `${target.name}倒下了！`, tone: 'good' });
    this.gainXp(target.xpValue);
  }

  private gainXp(amount: number): void {
    this.xp += amount;
    let need = this.xpToNext();
    while (this.xp >= need) {
      this.xp -= need;
      this.level += 1;
      this.player.maxHp += 4;
      this.player.hp += 4;
      this.player.attack += 1;
      this.log.push({
        text: `升级！现在 ${this.level} 级，生命上限 +4，攻击 +1。`,
        tone: 'good',
      });
      playSfx('levelup');
      this.effects.push({ kind: 'flashScreen', color: '#f5b04c', dur: 450 });
      need = this.xpToNext();
    }
  }

  private pickup(): boolean {
    const idx = this.groundItems.findIndex(
      (g) => g.x === this.player.x && g.y === this.player.y,
    );
    if (idx === -1) {
      this.log.push({ text: '这里没有可以捡的东西。', tone: 'info' });
      return false;
    }
    const ground = this.groundItems.splice(idx, 1)[0];
    if (!ground) return false;
    const def = itemInfo(ground.item);

    if (ground.item.category === 'weapon' || ground.item.category === 'armor') {
      const slot = ground.item.category === 'weapon' ? 'weapon' : 'armor';
      const current = this.player.equipment[slot];
      const currentBonus = current
        ? slot === 'weapon'
          ? weaponBonus(current)
          : armorBonus(current)
        : -1;
      // 该分支里必是普通装备，直接查通用目录拿加成
      const catalogDef = itemDef(ground.item);
      const nextBonus = catalogDef.bonus ?? 0;
      if (nextBonus > currentBonus) {
        this.player.equipment[slot] = ground.item;
        this.log.push({
          text: `装备了${catalogDef.name}（${slot === 'weapon' ? '攻击' : '防御'} +${nextBonus}）。`,
          tone: 'good',
        });
        if (current) this.groundItems.push({ x: this.player.x, y: this.player.y, item: current });
        playSfx('pickup');
        return true;
      }
      this.log.push({ text: `${def.name}不如身上的装备，留在了原地。`, tone: 'info' });
      this.groundItems.push(ground);
      return false;
    }

    if (this.player.inventory.length >= MAX_INVENTORY) {
      this.log.push({ text: '背包满了，拿不下更多东西。', tone: 'info' });
      this.groundItems.push(ground);
      return false;
    }
    this.player.inventory.push(ground.item);
    this.log.push({ text: `拾起了${def.name}。`, tone: 'good' });
    playSfx('pickup');
    return true;
  }

  private quaff(): boolean {
    const candidates = this.player.inventory
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.category === 'potion');
    if (candidates.length === 0) {
      this.log.push({ text: '背包里没有药水。', tone: 'info' });
      return false;
    }
    const hurt = this.player.hp < this.player.maxHp;
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
    this.player.inventory.splice(chosen.index, 1);
    playSfx('quaff');
    if (def.effect === 'might') {
      this.mightUntil = this.turn + (def.duration ?? 20);
      this.log.push({ text: `${def.name}下肚，余烬之力涌遍全身！攻击 +3。`, tone: 'good' });
      return true;
    }
    const [lo, hi] = def.heal ?? [0, 0];
    const amount = this.rng.int(lo, hi);
    const before = this.player.hp;
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + amount);
    this.log.push({
      text: `喝下${def.name}，恢复了 ${this.player.hp - before} 点生命。`,
      tone: 'good',
    });
    return true;
  }

  private castTeleport(): boolean {
    const idx = this.findScroll('teleport');
    if (idx === -1) {
      this.log.push({ text: '没有传送卷轴。', tone: 'info' });
      return false;
    }
    this.player.inventory.splice(idx, 1);
    return this.applyTeleport();
  }

  /** 传送到随机地板格（快捷键与背包使用共用） */
  private applyTeleport(): boolean {
    let tx = 0;
    let ty = 0;
    let ok = false;
    for (let i = 0; i < 500 && !ok; i++) {
      tx = this.rng.int(1, this.map.width - 2);
      ty = this.rng.int(1, this.map.height - 2);
      ok = this.map.isWalkable(tx, ty);
    }
    if (!ok) {
      this.log.push({ text: '卷轴失效了……', tone: 'info' });
      return false;
    }
    this.player.x = tx;
    this.player.y = ty;
    this.log.push({ text: '空间在你面前折叠，你出现在另一处。', tone: 'good' });
    playSfx('teleport');
    this.effects.push({ kind: 'flashScreen', color: '#3a6ea5', dur: 400 });
    return true;
  }

  private castFireblast(): boolean {
    const idx = this.findScroll('fireblast');
    if (idx === -1) {
      this.log.push({ text: '没有烈焰卷轴。', tone: 'info' });
      return false;
    }
    const targets = this.visibleTargets();
    if (targets.length === 0) {
      this.log.push({ text: '视野内没有敌人，卷轴没有点燃的理由。', tone: 'info' });
      return false;
    }
    this.player.inventory.splice(idx, 1);
    return this.applyFireblast(targets);
  }

  /** 视线内所有存活怪物 */
  private visibleTargets(): Actor[] {
    const los = (x: number, y: number) => !this.map.isWalkable(x, y);
    return this.monsters.filter((m) =>
      hasLineOfSight(this.player.x, this.player.y, m.x, m.y, los),
    );
  }

  private applyFireblast(targets: Actor[]): boolean {
    this.log.push({ text: '烈焰从卷轴中喷涌而出！', tone: 'combat' });
    playSfx('zap');
    this.effects.push({ kind: 'quake', dur: 260 });
    for (const t of targets) {
      const damage = this.rng.int(8, 14);
      t.hp -= damage;
      applyStatus(t, 'burn', 3, 2);
      this.effects.push(
        { kind: 'flash', x: t.x, y: t.y, color: '#f5803a' },
        { kind: 'float', x: t.x, y: t.y, text: `-${damage}`, color: '#f5803a' },
      );
      this.log.push({ text: `火焰吞噬了${t.name}（${damage} 伤害）。`, tone: 'combat' });
      if (t.hp <= 0) this.killMonster(t);
    }
    return true;
  }

  /** 背包界面：使用 / 装备指定槽位 */
  private useInventorySlot(index: number): boolean {
    const item = this.player.inventory[index];
    if (!item) return false;
    if (item.category === 'ranged') {
      this.log.push({ text: '远程武器直接按 z 射击。', tone: 'info' });
      return false;
    }
    const def = itemDef(item);

    if (item.category === 'potion' && def.effect === 'might') {
      this.player.inventory.splice(index, 1);
      this.mightUntil = this.turn + (def.duration ?? 20);
      playSfx('quaff');
      this.log.push({ text: `${def.name}下肚，余烬之力涌遍全身！攻击 +3。`, tone: 'good' });
      return true;
    }
    if (item.category === 'potion' && def.heal) {
      this.player.inventory.splice(index, 1);
      const [lo, hi] = def.heal;
      const amount = this.rng.int(lo ?? 0, hi ?? 0);
      const before = this.player.hp;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + amount);
      playSfx('quaff');
      this.log.push({
        text: `喝下${def.name}，恢复了 ${this.player.hp - before} 点生命。`,
        tone: 'good',
      });
      return true;
    }
    if (item.category === 'scroll' && def.effect === 'teleport') {
      this.player.inventory.splice(index, 1);
      return this.applyTeleport();
    }
    if (item.category === 'scroll' && def.effect === 'fireblast') {
      const targets = this.visibleTargets();
      if (targets.length === 0) {
        this.log.push({ text: '视野内没有敌人，卷轴没有点燃的理由。', tone: 'info' });
        return false;
      }
      this.player.inventory.splice(index, 1);
      return this.applyFireblast(targets);
    }
    if (item.category === 'weapon' || item.category === 'armor') {
      // 强制换装，原装备放回背包
      const slot = item.category;
      const current = this.player.equipment[slot];
      this.player.equipment[slot] = item;
      this.player.inventory.splice(index, 1);
      if (current) this.player.inventory.push(current);
      playSfx('pickup');
      this.log.push({ text: `装备了${def.name}。`, tone: 'good' });
      return true;
    }
    return false;
  }

  /** 背包界面：丢弃指定槽位到脚下 */
  private dropInventorySlot(index: number): boolean {
    const item = this.player.inventory[index];
    if (!item) return false;
    this.player.inventory.splice(index, 1);
    this.groundItems.push({ x: this.player.x, y: this.player.y, item });
    this.log.push({ text: `丢下了${itemDef(item).name}。`, tone: 'info' });
    return true;
  }

  private findScroll(effect: 'teleport' | 'fireblast'): number {
    return this.player.inventory.findIndex(
      (it) => it.category === 'scroll' && itemDef(it).effect === effect,
    );
  }

  private descend(): boolean {
    if (this.player.x === this.stairsDown.x && this.player.y === this.stairsDown.y) {
      this.depth += 1;
      this.log.push({ text: `你走下楼梯，来到第 ${this.depth} 层。`, tone: 'info' });
      playSfx('stairs');
      this.effects.push({ kind: 'flashScreen', color: '#2f7d4f', dur: 450 });
      this.buildFloor();
      return true;
    }
    this.log.push({ text: '脚下没有向下的楼梯。', tone: 'info' });
    return false;
  }

  // ---------- 怪物回合 ----------

  private monsterTurns(): void {
    for (const m of [...this.monsters]) {
      // 能量制行动频率：加速怪一回合两次，减速怪隔回合一次
      m.energy += actionsPerTurn(m);
      while (m.energy >= 1 && !this.dead) {
        m.energy -= 1;
        const act = decideMonsterAction({
          self: m,
          player: this.player,
          isBlocked: (x, y) => !this.map.isWalkable(x, y),
          rng: this.rng,
        });
        if (act.type === 'attack') {
          this.monsterAttack(m);
          if (this.dead) break;
        } else if (act.type === 'move') {
          const nx = m.x + act.dx;
          const ny = m.y + act.dy;
          const occupied =
            this.monsterAt(nx, ny) !== undefined ||
            (this.player.x === nx && this.player.y === ny);
          if (!occupied && this.map.isWalkable(nx, ny)) {
            m.x = nx;
            m.y = ny;
          }
        }
      }
    }
  }

  private monsterAttack(m: Actor): void {
    const report = resolveAttack({
      attackerName: m.name,
      attack: m.attack,
      defenderName: '你',
      defense: this.effectiveDefense(),
      defenderHp: this.player.hp,
      rng: this.rng,
    });
    this.player.hp -= report.damage;
    playSfx('hurt');
    this.effects.push(
      { kind: 'float', x: this.player.x, y: this.player.y, text: `-${report.damage}`, color: '#d96a5a' },
      { kind: 'flash', x: this.player.x, y: this.player.y, color: '#d96a5a' },
    );
    this.log.push({ text: `${m.name}击中了你，造成 ${report.damage} 点伤害！`, tone: 'bad' });
    this.applyOnHitStatus(m);
    if (report.killed) {
      this.dead = true;
      this.deathCause = m.name;
      playSfx('die');
      this.effects.push({ kind: 'quake', dur: 500 }, { kind: 'flashScreen', color: '#5c1010', dur: 600 });
      this.log.push({ text: `你死在了第 ${this.depth} 层……按 R 重新开始。`, tone: 'bad' });
    }
  }

  // ---------- 楼层与渲染 ----------

  private buildFloor(): void {
    const floor = generateFloor(this.depth, this.rng.int(1, 2147483647));
    this.map = floor.map;
    this.stairsDown = { ...floor.stairsDown };
    this.player.x = floor.playerSpawn.x;
    this.player.y = floor.playerSpawn.y;
    this.monsters = floor.monsterSpawns.map((p) => {
      const t = rollMonster(this.depth, this.rng);
      return makeActor({
        species: t.species,
        name: t.name,
        glyph: t.glyph,
        color: t.color,
        x: p.x,
        y: p.y,
        hp: t.maxHp,
        maxHp: t.maxHp,
        attack: t.attack,
        defense: t.defense,
        xpValue: t.xpValue,
        ai: { mode: 'sleep', senseRadius: t.senseRadius },
      });
    });
    this.groundItems = floor.itemSpots.map((p) => {
      // 25% 概率出现远程武器，其余走普通掉落表
      if (this.rng.next() < 0.25) {
        const pool = Object.entries(RANGED).filter(([, d]) => d.minDepth <= this.depth);
        const entry = this.rng.pick(pool);
        if (entry) {
          return {
            x: p.x,
            y: p.y,
            item: {
              uid: allocateItemUid(),
              catalogId: entry[0],
              category: 'ranged' as const,
            },
          };
        }
      }
      return { x: p.x, y: p.y, item: rollLoot(this.depth, this.rng) };
    });
    this.placeTraps(floor);
    this.explored = new Set();
    this.updateFov();
  }

  /** 按深度撒陷阱：避开出生点、楼梯与物品点 */
  private placeTraps(floor: { playerSpawn: Pt; stairsDown: Pt; itemSpots: Pt[] }): void {
    const candidates: Pt[] = [];
    for (let y = 1; y < this.map.height - 1; y++) {
      for (let x = 1; x < this.map.width - 1; x++) {
        if (!this.map.isWalkable(x, y)) continue;
        if (x === floor.playerSpawn.x && y === floor.playerSpawn.y) continue;
        if (x === floor.stairsDown.x && y === floor.stairsDown.y) continue;
        if (floor.itemSpots.some((p) => p.x === x && p.y === y)) continue;
        candidates.push({ x, y });
      }
    }
    this.traps = rollTraps(this.depth, Math.min(6, 1 + this.depth), candidates, this.rng);
  }

  /** 玩家踏入陷阱格：一次性触发后拆除（简化设计） */
  private checkTrap(): void {
    const idx = this.traps.findIndex((t) => t.x === this.player.x && t.y === this.player.y);
    if (idx === -1) return;
    const trap = this.traps.splice(idx, 1)[0];
    if (!trap) return;
    const report = triggerTrap(trap.kind, this.rng);
    playSfx('hurt');
    this.effects.push({ kind: 'flash', x: this.player.x, y: this.player.y, color: '#d96a5a' });
    this.log.push({ text: report.message, tone: 'bad' });
    if (report.damage > 0) {
      this.player.hp -= report.damage;
      this.effects.push({
        kind: 'float',
        x: this.player.x,
        y: this.player.y,
        text: `-${report.damage}`,
        color: '#d96a5a',
      });
    }
    if (report.status) {
      applyStatus(this.player, report.status.kind, report.status.turns, report.status.power);
    }
    if (report.teleport) {
      this.applyTeleport();
    }
    if (this.player.hp <= 0) {
      this.dead = true;
      this.deathCause = TRAPS[trap.kind].name;
      playSfx('die');
      this.effects.push(
        { kind: 'quake', dur: 500 },
        { kind: 'flashScreen', color: '#5c1010', dur: 600 },
      );
      this.log.push({ text: `你死于${TRAPS[trap.kind].name}……按 R 重新开始。`, tone: 'bad' });
    }
  }

  private newRun(): void {
    this.depth = 1;
    this.turn = 0;
    this.level = 1;
    this.xp = 0;
    this.dead = false;
    this.kills = 0;
    this.deathCause = '未知';
    this.logCursor = null;
    this.autoExploring = false;
    this.autoPath = null;
    this.mightUntil = 0;
    this.log = [{ text: '新的冒险开始了。你在余烬深渊的第 1 层醒来……', tone: 'info' }];
    Game.clearSave();
    // 线性同余派生新种子，保证连续两局必然不同
    this.runSeed = (this.runSeed * 1664525 + 1013904223) % 2147483647;
    this.rng = new Rng(this.runSeed || 1);
    this.player = createPlayer(0, 0);
    this.buildFloor();
  }

  private tickMight(): void {
    if (this.mightUntil !== 0 && this.turn > this.mightUntil) {
      this.mightUntil = 0;
      this.log.push({ text: '余烬之力消散了。', tone: 'info' });
    }
  }

  private updateFov(): void {
    this.visible = computeFov({
      isBlocked: (x, y) => !this.map.isWalkable(x, y),
      ox: this.player.x,
      oy: this.player.y,
      radius: FOV_RADIUS,
    });
    for (const key of this.visible) this.explored.add(key);
  }

  private monsterAt(x: number, y: number): Actor | undefined {
    return this.monsters.find((m) => m.x === x && m.y === y);
  }

  /** 深渊生物的附加攻击：按物种概率施加状态 */
  private applyOnHitStatus(m: Actor): void {
    if (this.dead) return;
    const roll = this.rng.next();
    if (m.species === 'rat' && roll < 0.15) {
      applyStatus(this.player, 'poison', 4, 1);
      this.log.push({ text: '鼠人的咬伤让你中毒了！', tone: 'bad' });
    } else if (m.species === 'ember_wraith' && roll < 0.35) {
      applyStatus(this.player, 'burn', 3, 2);
      this.log.push({ text: '余烬幽魂的火焰灼烧着你！', tone: 'bad' });
    } else if (m.species === 'skeleton' && roll < 0.1) {
      applyStatus(this.player, 'slow', 4, 0);
      this.log.push({ text: '骷髅兵的寒气让你行动迟缓！', tone: 'bad' });
    }
  }

  /** 供 main 把小地图画到指定画布上 */
  drawMinimapTo(canvas: HTMLCanvasElement): void {
    drawMinimap(canvas, this.buildScene());
  }

  /** 取走累积的打击感效果，由渲染层播放 */
  takeEffects(): Effect[] {
    const pending = this.effects;
    this.effects = [];
    return pending;
  }

  private buildScene(): Scene {
    const actors: Glyph[] = [
      { x: this.player.x, y: this.player.y, glyph: this.player.glyph, color: this.player.color },
    ];
    for (const m of this.monsters) {
      actors.push({ x: m.x, y: m.y, glyph: m.glyph, color: m.color });
    }
    const items: Glyph[] = this.groundItems.map((g) => {
      const def = itemInfo(g.item);
      return { x: g.x, y: g.y, glyph: def.glyph, color: def.color };
    });
    const trapGlyphs: Glyph[] = this.traps.map((t) => {
      const def = TRAPS[t.kind];
      return { x: t.x, y: t.y, glyph: def.glyph, color: def.color };
    });
    return {
      map: this.map,
      depth: this.depth,
      visible: this.visible,
      explored: this.explored,
      markers: [
        { x: this.stairsDown.x, y: this.stairsDown.y, glyph: '>', color: '#c9a227' },
        ...trapGlyphs,
      ],
      items,
      actors,
      dead: this.dead,
      stats: this.dead
        ? {
            depth: this.depth,
            turn: this.turn,
            level: this.level,
            kills: this.kills,
            cause: this.deathCause,
          }
        : undefined,
    };
  }

  private render(): void {
    this.renderer.draw(this.buildScene());
  }
}
