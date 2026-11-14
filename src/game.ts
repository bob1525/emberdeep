import { isMuted, playSfx, setMuted } from './engine/audio';
import type { Action } from './engine/input';
import { computeFov } from './engine/fov';
import { decideMonsterAction } from './engine/ai';
import { resolveAttack } from './engine/combat';
import { hasLineOfSight } from './engine/los';
import { Rng } from './engine/rng';
import { createPlayer, makeActor, type Actor, type ItemInstance } from './entities/actor';
import { rollMonster } from './entities/monsters';
import { itemDef, rollLoot, weaponBonus, armorBonus } from './items/catalog';
import { generateFloor } from './world/generators/floor';
import { GameMap } from './world/map';
import type { Tile } from './world/tiles';
import { drawMinimap, type Effect, type Glyph, type Renderer, type Scene } from './ui/renderer';

export type Tone = 'info' | 'good' | 'bad' | 'combat';

export interface LogEntry {
  text: string;
  tone: Tone;
}

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

  private map: GameMap = GameMap.filled(1, 1, 'wall');
  private stairsDown: { x: number; y: number } = { x: 0, y: 0 };
  private monsters: Actor[] = [];
  private groundItems: GroundItem[] = [];
  private visible = new Set<string>();
  private explored = new Set<string>();
  private effects: Effect[] = [];
  private mightUntil = 0;
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
    this.monsters = save.monsters;
    this.groundItems = save.groundItems;
    this.stairsDown = { ...save.stairsDown };
    this.explored = new Set(save.explored);
    this.player = save.player;
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
    if (this.dead) {
      if (action.type === 'restart') this.newRun();
    } else if (this.doPlayerAction(action)) {
      this.turn += 1;
      this.monsterTurns();
      this.tickMight();
      if (this.dead) {
        Game.clearSave();
      } else {
        this.persist();
      }
    }
    this.updateFov();
    this.render();
    this.onChange?.();
  }

  recentLog(count = 8): LogEntry[] {
    return this.log.slice(-count);
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
    return this.player.defense + (armor ? armorBonus(armor) : 0);
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
    const def = itemDef(ground.item);

    if (ground.item.category === 'weapon' || ground.item.category === 'armor') {
      const slot = ground.item.category === 'weapon' ? 'weapon' : 'armor';
      const current = this.player.equipment[slot];
      const currentBonus = current
        ? slot === 'weapon'
          ? weaponBonus(current)
          : armorBonus(current)
        : -1;
      const nextBonus = def.bonus ?? 0;
      if (nextBonus > currentBonus) {
        this.player.equipment[slot] = ground.item;
        this.log.push({
          text: `装备了${def.name}（${slot === 'weapon' ? '攻击' : '防御'} +${nextBonus}）。`,
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
    this.player.inventory.splice(idx, 1);
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
    const los = (x: number, y: number) => !this.map.isWalkable(x, y);
    const targets = this.monsters.filter((m) =>
      hasLineOfSight(this.player.x, this.player.y, m.x, m.y, los),
    );
    if (targets.length === 0) {
      this.log.push({ text: '视野内没有敌人，卷轴没有点燃的理由。', tone: 'info' });
      return false;
    }
    this.player.inventory.splice(idx, 1);
    this.log.push({ text: '烈焰从卷轴中喷涌而出！', tone: 'combat' });
    playSfx('zap');
    this.effects.push({ kind: 'quake', dur: 260 });
    for (const t of targets) {
      const damage = this.rng.int(8, 14);
      t.hp -= damage;
      this.effects.push(
        { kind: 'flash', x: t.x, y: t.y, color: '#f5803a' },
        { kind: 'float', x: t.x, y: t.y, text: `-${damage}`, color: '#f5803a' },
      );
      this.log.push({ text: `火焰吞噬了${t.name}（${damage} 伤害）。`, tone: 'combat' });
      if (t.hp <= 0) this.killMonster(t);
    }
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
    this.groundItems = floor.itemSpots.map((p) => ({
      x: p.x,
      y: p.y,
      item: rollLoot(this.depth, this.rng),
    }));
    this.explored = new Set();
    this.updateFov();
  }

  private newRun(): void {
    this.depth = 1;
    this.turn = 0;
    this.level = 1;
    this.xp = 0;
    this.dead = false;
    this.kills = 0;
    this.deathCause = '未知';
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
      const def = itemDef(g.item);
      return { x: g.x, y: g.y, glyph: def.glyph, color: def.color };
    });
    return {
      map: this.map,
      depth: this.depth,
      visible: this.visible,
      explored: this.explored,
      markers: [{ x: this.stairsDown.x, y: this.stairsDown.y, glyph: '>', color: '#c9a227' }],
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
