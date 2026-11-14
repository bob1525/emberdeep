import { isMuted, playSfx, setMuted } from './engine/audio';
import type { Action } from './engine/input';
import { computeFov } from './engine/fov';
import { decideMonsterAction } from './engine/ai';
import type { AiAction } from './engine/ai';
import { resolveAttack } from './engine/combat';
import { hasLineOfSight } from './engine/los';
import type { Pt } from './engine/los';
import { Rng } from './engine/rng';
import { canonicalJson, hash64 } from './engine/canonical';
import { parseSaveData } from './engine/saveSchema';
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
  resetEntityIds,
  setEntityIdCounters,
  type Actor,
  type ItemInstance,
} from './entities/actor';
import { rollMonster } from './entities/monsters';
import { bossForDepth, decideBossSpecial, phaseForHp } from './entities/bosses';
import type { BossDef, BossPhase, BossSpecialReport } from './entities/bosses';
import { CLASSES, canUseSkill, makeCooldown, startCooldown, tickCooldown } from './entities/classes';
import type { ClassId, SkillCooldown } from './entities/classes';
import { TALENTS, talentBonus, rollTalentChoices } from './entities/talents';
import type { TalentMods } from './entities/talents';
import { runBrain, newMemory, tickMemory } from './engine/brain';
import type { MonsterMemory } from './engine/brain';
import { findPathWithFn } from './engine/pathfinding';
import { itemDef, rollLoot, weaponBonus, armorBonus } from './items/catalog';
import { displayName, rarityColor, rollAffixData, bonusOf } from './items/affixes';
import type { AffixData } from './items/affixes';
import { RANGED, resolveShot } from './engine/ranged';
import { rollGold } from './economy/gold';
import { rollStock, sellPrice } from './economy/merchant';
import type { StockEntry } from './economy/merchant';

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
import { SHRINES, resolveAltar, resolveWell } from './world/shrines';
import type { ShrineKind } from './world/shrines';
import type { Tile } from './world/tiles';
import { drawMinimap, type Effect, type Glyph, type Renderer, type Scene } from './ui/renderer';

export type Tone = 'info' | 'good' | 'bad' | 'combat';

export interface LogEntry {
  text: string;
  tone: Tone;
}

/** UI 界面模式：菜单 / 职业选择 / 背包 / 消息历史 / 商店 / 升级三选一等界面功能的地基 */
export type UiMode =
  | 'title'
  | 'classSelect'
  | 'play'
  | 'levelUp'
  | 'inventory'
  | 'log'
  | 'targeting'
  | 'shop';

interface GoldPile {
  x: number;
  y: number;
  amount: number;
}

interface MerchantState {
  x: number;
  y: number;
  stock: StockEntry[];
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
  kills: number;
  deathCause: string;
  traps?: PlacedTrap[];
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

const FOV_RADIUS = 8;
const MIGHT_ATTACK_BONUS = 3;
const MAX_INVENTORY = 12;
/** Boss 每场战斗的召唤物上限（P0-8） */
const BOSS_SUMMON_CAP = 4;
/** 自动探索单批步数预算（P0-7） */
const AUTO_EXPLORE_BUDGET = 24;

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
  /** 钱袋 */
  gold = 0;
  /** 当前职业与职业技能冷却 */
  classId: ClassId = 'warrior';
  skill: SkillCooldown = makeCooldown(CLASSES.warrior.skill);
  /** 已拥有天赋（含重复层数） */
  ownedTalents: string[] = [];
  /** 升级三选一的当前候选 */
  talentChoices: string[] = [];
  /** 待处理的升级次数（一次经验奖励可能跨多级，P0-6） */
  private pendingLevelUps = 0;
  /** 本场 Boss 战已召唤的小怪数（P0-8 上限控制） */
  private bossSummonCount = 0;
  /** Boss 召唤物 ID：不给经验/金币（P0-8） */
  private summonedIds = new Set<number>();
  /** 上次持久化的回合数（自动探索批量存档节流，P0-7） */
  private lastPersistTurn = -1;
  /** URL/每日种子时为 true：newRun 不得改写种子（P1-11） */
  private readonly fixedSeed: boolean;
  /** 当前界面模式；游戏从标题画面开始 */
  mode: UiMode = 'title';
  /** 消息历史查看游标（log 模式；null = 定位在最新） */
  logCursor: number | null = null;

  private map: GameMap = GameMap.filled(1, 1, 'wall');
  private stairsDown: { x: number; y: number } = { x: 0, y: 0 };
  private monsters: Actor[] = [];
  private boss: Actor | null = null;
  private bossDef: BossDef | null = null;
  private memories = new Map<number, MonsterMemory>();
  private groundItems: GroundItem[] = [];
  private traps: PlacedTrap[] = [];
  private shrines: { x: number; y: number; kind: ShrineKind }[] = [];
  private goldPiles: GoldPile[] = [];
  private merchant: MerchantState | null = null;
  private affixData = new Map<number, AffixData>();
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
    private renderer: Renderer | null,
    runSeed = Date.now() % 2147483647,
    save?: SaveData | null,
    opts?: { fixedSeed?: boolean },
  ) {
    this.runSeed = (runSeed % 2147483647) || 1;
    this.fixedSeed = opts?.fixedSeed ?? false;
    this.rng = new Rng(this.runSeed);
    resetEntityIds();
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

  /** 自动存档：自动探索批量模式下按回合节流（P0-7）；失败静默降级 */
  private persist(): void {
    if (this.turn - this.lastPersistTurn < 8 && this.turn !== 0) return;
    this.lastPersistTurn = this.turn;
    try {
      const data = this.buildSaveData();
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      // 忽略存储异常
    }
  }

  /** 构造存档快照（persist 与状态哈希共用，字段顺序必须稳定） */
  private buildSaveData(): SaveData {
    return {
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
        gold: this.gold,
        goldPiles: this.goldPiles,
        merchant: this.merchant,
        affixData: [...this.affixData.entries()],
        classId: this.classId,
        skillRemaining: this.skill.remaining,
        ownedTalents: this.ownedTalents,
        shrines: this.shrines,
        mode: this.mode === 'levelUp' ? 'levelUp' : 'play',
        talentChoices: this.mode === 'levelUp' ? this.talentChoices : [],
        pendingLevelUps: this.pendingLevelUps,
        bossSummonCount: this.bossSummonCount,
        bossSpecies: this.boss?.species ?? null,
        memories: [...this.memories.entries()].map(([id, m]) => [
          id,
          {
            lastSeenPlayer: m.lastSeenPlayer,
            alert: m.alert,
            rallyPoint: m.rallyPoint,
            rallyAge: m.rallyAge,
            cooldowns: [...m.cooldowns],
          },
        ]),
      };
  }

  /**
   * 逻辑状态指纹（canonical 序列化 + 64 位双哈希，回放协议 v2）。
   * 任何非确定性泄漏（Math.random 混入逻辑、Date.now、键序依赖）都会立刻暴露。
   */
  stateHash(): string {
    return hash64(canonicalJson(this.buildSaveData()));
  }

  /** 读取并校验存档（走 schema 校验层）；损坏或版本不符返回 null */
  static readSave(): SaveData | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const parsed = parseSaveData(JSON.parse(raw));
      if (!parsed.ok) {
        console.warn('[emberdeep] 存档被拒绝：', parsed.reason);
        return null;
      }
      for (const warning of parsed.warnings) {
        console.warn('[emberdeep 存档]', warning);
      }
      return parsed.data as unknown as SaveData;
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
    this.goldPiles = save.goldPiles ?? [];
    this.merchant = save.merchant ?? null;
    this.affixData = new Map(save.affixData ?? []);
    this.classId = (save.classId as ClassId | undefined) ?? 'warrior';
    this.skill = makeCooldown(CLASSES[this.classId].skill);
    this.skill.remaining = save.skillRemaining ?? 0;
    this.ownedTalents = save.ownedTalents ?? [];
    this.talentChoices = [];
    this.shrines = save.shrines ?? [];
    this.memories.clear();
    for (const [id, m] of save.memories ?? []) {
      this.memories.set(id, {
        lastSeenPlayer: m.lastSeenPlayer,
        alert: m.alert,
        rallyPoint: m.rallyPoint,
        rallyAge: m.rallyAge,
        cooldowns: new Map(m.cooldowns),
      });
    }
    this.gold = save.gold ?? 0;
    this.kills = save.kills ?? 0;
    this.deathCause = save.deathCause ?? '未知';
    this.pendingLevelUps = save.mode === 'levelUp' ? Math.max(1, save.pendingLevelUps ?? 1) : 0;
    this.bossSummonCount = save.bossSummonCount ?? 0;
    // 分配器状态恢复：读档后新建实体的 ID 必须与已有实体不冲突（P0-5）
    let maxActorId = this.player.id;
    for (const m of this.monsters) maxActorId = Math.max(maxActorId, m.id);
    let maxItemUid = 0;
    for (const it of this.player.inventory) maxItemUid = Math.max(maxItemUid, it.uid);
    for (const g of this.groundItems) maxItemUid = Math.max(maxItemUid, g.item.uid);
    if (this.player.equipment.weapon) maxItemUid = Math.max(maxItemUid, this.player.equipment.weapon.uid);
    if (this.player.equipment.armor) maxItemUid = Math.max(maxItemUid, this.player.equipment.armor.uid);
    setEntityIdCounters(maxActorId + 1, maxItemUid + 1);
    // 界面模式恢复：只有升级三选一是可中断存档点，其余一律回到游戏
    this.mode =
      save.mode === 'levelUp' && (save.talentChoices?.length ?? 0) > 0
        ? 'levelUp'
        : 'play';
    this.talentChoices = this.mode === 'levelUp' ? (save.talentChoices ?? []) : [];
    this.depth = save.depth;
    this.turn = save.turn;
    this.level = save.level;
    this.xp = save.xp;
    this.mightUntil = save.mightUntil;
    this.runSeed = save.runSeed;
    this.rng = Rng.fromState(save.rngState);
    // Boss 身份重建（P0-5）：必须在 depth 恢复之后，按 species 匹配，
    // 以此恢复阶段特技与 Boss 击杀奖励
    this.boss = null;
    const def = bossForDepth(this.depth);
    this.bossDef = def;
    if (def) {
      this.boss = this.monsters.find((m) => m.species === def.species) ?? null;
    }
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
      case 'classSelect':
        this.handleClassSelect(action);
        break;
      case 'levelUp':
        this.handleLevelUp(action);
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
      case 'shop':
        this.handleShop(action);
        break;
    }

    if (this.mode === 'play') this.updateFov();
    this.render();
    this.onChange?.();
  }

  private handleTitle(action: Action): void {
    if (action.type === 'titleNew') {
      this.mode = 'classSelect';
    } else if (action.type === 'titleContinue') {
      if (this.continueFromSave()) this.mode = 'play';
    }
  }

  private handleClassSelect(action: Action): void {
    if (action.type === 'closeOverlay') {
      this.mode = 'title';
      return;
    }
    if (action.type === 'useSlot') {
      const order: ClassId[] = ['warrior', 'ranger', 'mage'];
      const classId = order[action.slot];
      if (!classId) return;
      this.newRun(classId);
      this.mode = 'play';
      return;
    }
  }

  private handleLevelUp(action: Action): void {
    if (action.type !== 'useSlot') return;
    const id = this.talentChoices[action.slot];
    if (!id) return;
    this.ownedTalents.push(id);
    const def = TALENTS.find((t) => t.id === id);
    // 生命上限类天赋立即生效
    const maxHpGain = def?.mods.maxHp ?? 0;
    if (maxHpGain !== 0) {
      this.player.maxHp += maxHpGain;
      this.player.hp = Math.max(1, this.player.hp + maxHpGain);
    }
    this.log.push({
      text: `获得天赋「${def?.name ?? id}」— ${def?.description ?? ''}`,
      tone: 'good',
    });
    playSfx('levelup');
    this.talentChoices = [];
    this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
    if (this.pendingLevelUps > 0) {
      // 还有排队中的升级：展示下一组三选一（P0-6）
      this.offerTalents();
      return;
    }
    this.mode = 'play';
    this.persist();
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
    if (action.type === 'useSkill') {
      if (this.useClassSkill()) this.endPlayerTurn();
      return;
    }
    if (this.doPlayerAction(action)) this.endPlayerTurn();
  }

  /** 职业技能（k 键）：按职业分派结算，消耗冷却 */
  private useClassSkill(): boolean {
    const def = CLASSES[this.classId].skill;
    if (!canUseSkill(this.skill)) {
      this.log.push({
        text: `${def.name}还在冷却（${this.skill.remaining} 回合）。`,
        tone: 'info',
      });
      return false;
    }
    let used = false;
    if (this.classId === 'warrior') used = this.skillCharge();
    else if (this.classId === 'ranger') used = this.skillPreciseShot();
    else used = this.skillFlameNova();
    if (used) {
      startCooldown(this.skill, def);
      this.log.push({ text: `${def.name}！`, tone: 'combat' });
    }
    return used;
  }

  /** 战士·冲锋：冲向最近的可见敌人（2-4 格）并造成 1.5 倍伤害（P0-2：回调语义修正+步步验证） */
  private skillCharge(): boolean {
    let best: Actor | null = null;
    let bestPath: Pt[] | null = null;
    for (const m of this.visibleTargets()) {
      const path = findPathWithFn(
        { x: this.player.x, y: this.player.y },
        { x: m.x, y: m.y },
        (x, y) => this.map.isWalkable(x, y) && !this.monsterAt(x, y),
      );
      if (path && path.length >= 2 && path.length <= 5) {
        if (!bestPath || path.length < bestPath.length) {
          best = m;
          bestPath = path;
        }
      }
    }
    if (!best || !bestPath) {
      this.log.push({ text: '冲锋范围内没有敌人。', tone: 'info' });
      return false;
    }
    // 沿路径冲刺到目标前一格；每步重新验证地形与占用，禁止穿墙
    for (let i = 0; i < bestPath.length - 1; i++) {
      const step = bestPath[i];
      if (!step) break;
      if (!this.map.isWalkable(step.x, step.y) || this.monsterAt(step.x, step.y)) break;
      this.effects.push({
        kind: 'step',
        fromX: this.player.x,
        fromY: this.player.y,
        toX: step.x,
        toY: step.y,
        glyph: this.player.glyph,
        color: this.player.color,
        dur: 120,
      });
      this.player.x = step.x;
      this.player.y = step.y;
    }
    const damage = Math.max(
      1,
      resolveAttack({
        attackerName: '你',
        attack: Math.round(this.effectiveAttack() * 1.5),
        defenderName: best.name,
        defense: best.defense,
        defenderHp: best.hp,
        rng: this.rng,
      }).damage,
    );
    best.hp -= damage;
    playSfx('hit');
    this.effects.push(
      { kind: 'float', x: best.x, y: best.y, text: `-${damage}`, color: '#f5b04c' },
      { kind: 'flash', x: best.x, y: best.y, color: '#ffffff' },
    );
    this.log.push({ text: `你撞进了${best.name}的怀里（${damage} 伤害）。`, tone: 'combat' });
    if (best.hp <= 0) this.killMonster(best);
    return true;
  }

  /** 游侠·精准箭：射向最近的可见敌人，双倍远程伤害 */
  private skillPreciseShot(): boolean {
    const weapon = this.rangedInInventory();
    if (!weapon) {
      this.log.push({ text: '没有远程武器，精准箭无从谈起。', tone: 'info' });
      return false;
    }
    const def = RANGED[weapon.catalogId];
    if (!def) return false;
    const targets = this.visibleTargets().filter(
      (t) =>
        Math.max(Math.abs(t.x - this.player.x), Math.abs(t.y - this.player.y)) <=
        def.range,
    );
    if (targets.length === 0) {
      this.log.push({ text: '射程内没有目标。', tone: 'info' });
      return false;
    }
    const nearest = targets.reduce((a, b) =>
      Math.max(Math.abs(b.x - this.player.x), Math.abs(b.y - this.player.y)) <
      Math.max(Math.abs(a.x - this.player.x), Math.abs(a.y - this.player.y))
        ? b
        : a,
    );
    const damage = Math.max(
      1,
      this.rng.int(def.damage[0] ?? 1, def.damage[1] ?? 1) * 2 - nearest.defense,
    );
    nearest.hp -= damage;
    playSfx('hit');
    this.effects.push(
      { kind: 'float', x: nearest.x, y: nearest.y, text: `-${damage}`, color: '#8ecafc' },
      { kind: 'flash', x: nearest.x, y: nearest.y, color: '#8ecafc' },
    );
    this.log.push({ text: `精准箭贯穿了${nearest.name}（${damage} 伤害）。`, tone: 'combat' });
    if (nearest.hp <= 0) this.killMonster(nearest);
    return true;
  }

  /** 法师·烈焰新星：灼烧视野内所有敌人 */
  private skillFlameNova(): boolean {
    const targets = this.visibleTargets();
    if (targets.length === 0) {
      this.log.push({ text: '视野内没有敌人，新星无处绽放。', tone: 'info' });
      return false;
    }
    playSfx('zap');
    this.effects.push(
      { kind: 'quake', dur: 300 },
      { kind: 'flashScreen', color: '#f5803a', dur: 500 },
    );
    for (const t of targets) {
      const damage = this.rng.int(6, 10);
      t.hp -= damage;
      applyStatus(t, 'burn', 2, 2);
      this.effects.push(
        { kind: 'flash', x: t.x, y: t.y, color: '#f5803a' },
        { kind: 'float', x: t.x, y: t.y, text: `-${damage}`, color: '#f5803a' },
      );
      this.log.push({ text: `烈焰吞噬了${t.name}（${damage} 伤害）。`, tone: 'combat' });
      if (t.hp <= 0) this.killMonster(t);
    }
    return true;
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

  private handleShop(action: Action): void {
    if (action.type === 'closeOverlay' || action.type === 'openInventory') {
      this.mode = 'play';
      return;
    }
    // 商店里：数字键购买，Shift+数字键出售
    if (action.type === 'useSlot') {
      this.buyFromMerchant(action.slot);
      return;
    }
    if (action.type === 'dropSlot') {
      this.sellFromInventory(action.slot);
      return;
    }
  }

  private buyFromMerchant(slot: number): void {
    if (!this.merchant) return;
    const entry = this.merchant.stock[slot];
    if (!entry) return;
    if (this.gold < entry.price) {
      this.log.push({ text: '金币不够，商人摇了摇头。', tone: 'info' });
      return;
    }
    if (this.player.inventory.length >= MAX_INVENTORY) {
      this.log.push({ text: '背包满了，拿不下更多货物。', tone: 'info' });
      return;
    }
    const item: ItemInstance = {
      uid: allocateItemUid(),
      catalogId: entry.catalogId,
      category: entry.category,
    };
    this.gold -= entry.price;
    this.merchant.stock.splice(slot, 1);
    this.player.inventory.push(item);
    playSfx('pickup');
    this.log.push({ text: `买下了${itemInfo(item).name}（-${entry.price} 金币）。`, tone: 'good' });
  }

  private sellFromInventory(slot: number): void {
    if (!this.merchant) return;
    const item = this.player.inventory[slot];
    if (!item) return;
    const price = sellPrice(item.catalogId, item.category, this.depth);
    this.player.inventory.splice(slot, 1);
    this.affixData.delete(item.uid);
    this.gold += price;
    playSfx('pickup');
    this.log.push({ text: `卖掉了${itemInfo(item).name}，得到 ${price} 金币。`, tone: 'good' });
  }

  /** 玩家行动成功后的公共回合结算 */
  private endPlayerTurn(): void {
    this.turn += 1;
    tickCooldown(this.skill);
    for (const memory of this.memories.values()) tickMemory(memory);
    // 天赋·活力：每 5 回合回复生命
    const regen = this.talentMods().regen;
    if (regen > 0 && this.turn % 5 === 0 && this.player.hp < this.player.maxHp) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + regen);
    }
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
   * 自动探索（P0-7）：分批推进，每批最多 AUTO_EXPLORE_BUDGET 步。
   * 中断条件：视野内出现敌人 / 走到商人、奇遇建筑、已知陷阱、楼梯前 /
   * 玩家死亡 / 离开 play 模式 / 无路可走。批量存档由 persist 节流。
   */
  private autoStep(): void {
    let steps = 0;
    while (
      this.autoExploring &&
      !this.dead &&
      this.mode === 'play' &&
      steps < AUTO_EXPLORE_BUDGET
    ) {
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
      // 交互物与楼梯前停下：这些是不可逆/需要玩家确认的事件
      if (this.merchant && this.merchant.x === next.x && this.merchant.y === next.y) {
        this.autoExploring = false;
        this.log.push({ text: '前方有一位流浪商人，自动探索停止。', tone: 'info' });
        return;
      }
      if (this.shrines.some((s) => s.x === next.x && s.y === next.y)) {
        this.autoExploring = false;
        this.log.push({ text: '前方有一座奇异的建筑，自动探索停止。', tone: 'info' });
        return;
      }
      if (this.traps.some((t) => t.x === next.x && t.y === next.y)) {
        this.autoExploring = false;
        this.log.push({ text: '前方地面上有陷阱的痕迹，是否冒险由你决定。', tone: 'info' });
        return;
      }
      if (next.x === this.stairsDown.x && next.y === this.stairsDown.y) {
        this.autoExploring = false;
        this.log.push({ text: '你停在了向下的楼梯前。', tone: 'info' });
        return;
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
        steps += 1;
        this.endPlayerTurn();
      } else {
        // 被堵住：重新寻路
        this.autoPath = null;
      }
    }
    if (this.autoExploring && steps >= AUTO_EXPLORE_BUDGET) {
      this.log.push({ text: '自动探索暂歇——再按 o 继续。', tone: 'info' });
    }
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

    // P0-7：head 指针代替 queue.shift()，避免 O(V²) 的数组搬家
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head];
      head += 1;
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

  /** 本局种子（标题画面展示，URL 可复现同一条地牢） */
  seed(): number {
    return this.runSeed;
  }

  /** 技能剩余冷却回合 */
  skillRemaining(): number {
    return this.skill.remaining;
  }

  effectiveAttack(): number {
    const weapon = this.player.equipment.weapon;
    const weaponBonusTotal =
      (weapon ? weaponBonus(weapon) : 0) + bonusOf(this.affixData.get(weapon?.uid ?? -1) ?? null).attack;
    const mightPart =
      this.mightUntil !== 0 && this.turn <= this.mightUntil ? MIGHT_ATTACK_BONUS : 0;
    return this.player.attack + weaponBonusTotal + mightPart + this.talentMods().attack;
  }

  effectiveDefense(): number {
    const armor = this.player.equipment.armor;
    const armorBonusTotal =
      (armor ? armorBonus(armor) : 0) + bonusOf(this.affixData.get(armor?.uid ?? -1) ?? null).defense;
    return (
      this.player.defense + armorBonusTotal + totalDefenseBonus(this.player) + this.talentMods().defense
    );
  }

  /** 带词缀前缀的物品名（背包/日志用） */
  itemDisplayName(item: ItemInstance): string {
    return displayName(itemInfo(item).name, this.affixData.get(item.uid) ?? null);
  }

  /** 物品词缀数据（可能为 null） */
  itemAffix(item: ItemInstance): AffixData | null {
    return this.affixData.get(item.uid) ?? null;
  }

  /** 商店货架（只读副本） */
  merchantStock(): StockEntry[] {
    return this.merchant ? [...this.merchant.stock] : [];
  }

  // ---------- 内部钩子（@internal 供无头模拟器与测试使用，不参与 UI） ----------

  /** @internal 直接跳到指定层（蒙特卡洛模拟器用） */
  jumpToDepth(depth: number): void {
    this.depth = Math.max(1, Math.floor(depth));
    this.buildFloor();
    this.log.push({ text: `（模拟）降临第 ${this.depth} 层。`, tone: 'info' });
  }

  /** @internal 测试用：是否有存活 Boss */
  hasBoss(): boolean {
    return this.boss !== null;
  }

  /** @internal 测试与模拟器用：内部计数快照 */
  internalStats(): {
    monsterCount: number;
    bossSummonCount: number;
    summonedCount: number;
    aliveSummoned: number;
  } {
    return {
      monsterCount: this.monsters.length,
      bossSummonCount: this.bossSummonCount,
      summonedCount: this.summonedIds.size,
      aliveSummoned: this.monsters.filter((m) => this.summonedIds.has(m.id)).length,
    };
  }

  /** @internal 测试用：强制 Boss 释放一次阶段特技（确定性消耗 rng） */
  debugForceBossSpecial(): void {
    for (let i = 0; i < 60; i++) {
      const phase = this.bossPhase();
      if (!phase) return;
      const special = decideBossSpecial(phase, this.rng);
      if (special.kind !== 'none') {
        this.applyBossSpecial(special);
        return;
      }
    }
  }

  /** @internal 测试用：给最近的怪物施加燃烧（P0-4 验证） */
  debugBurnNearest(): boolean {
    let nearest: Actor | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const m of this.monsters) {
      const d = Math.max(Math.abs(m.x - this.player.x), Math.abs(m.y - this.player.y));
      if (d < best) {
        best = d;
        nearest = m;
      }
    }
    if (!nearest) return false;
    applyStatus(nearest, 'burn', 3, 5);
    return true;
  }

  /** @internal 测试与模拟器用：导出当前存档快照（不落 localStorage） */
  exportSaveData(): SaveData {
    return this.buildSaveData();
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
    // 撞见商人：打开商店，不消耗回合
    if (this.merchant && this.merchant.x === nx && this.merchant.y === ny) {
      this.mode = 'shop';
      return false;
    }
    // 撞上祭坛/许愿井：触发事件（事件本身消耗一个回合，怪物获得行动权）
    const shrineIdx = this.shrines.findIndex((s) => s.x === nx && s.y === ny);
    if (shrineIdx !== -1) {
      const shrine = this.shrines[shrineIdx];
      if (shrine?.kind === 'altar') this.useAltar(shrineIdx);
      else this.useWell(shrineIdx);
      return true;
    }
    const target = this.monsterAt(nx, ny);
    if (target) {
      this.attackMonster(target);
      return true;
    }
    if (!this.map.isWalkable(nx, ny)) return false;
    this.effects.push({
      kind: 'step',
      fromX: this.player.x,
      fromY: this.player.y,
      toX: nx,
      toY: ny,
      glyph: this.player.glyph,
      color: this.player.color,
      dur: 140,
    });
    this.player.x = nx;
    this.player.y = ny;
    this.checkTrap();
    return true;
  }

  private attackMonster(target: Actor): void {
    // 攻击突进动画
    this.effects.push({
      kind: 'lunge',
      x: this.player.x,
      y: this.player.y,
      dx: Math.sign(target.x - this.player.x),
      dy: Math.sign(target.y - this.player.y),
      glyph: this.player.glyph,
      color: this.player.color,
      dur: 170,
    });
    const report = resolveAttack({
      attackerName: '你',
      attack: this.effectiveAttack(),
      defenderName: target.name,
      defense: target.defense,
      defenderHp: target.hp,
      rng: this.rng,
    });
    // 暴击：双倍伤害
    const crit = this.rng.next() < this.critChance();
    const damage = crit ? report.damage * 2 : report.damage;
    target.hp -= damage;
    playSfx('hit');
    this.effects.push(
      {
        kind: 'float',
        x: target.x,
        y: target.y,
        text: crit ? `暴击 -${damage}` : `-${damage}`,
        color: crit ? '#ffdf6b' : '#f5b04c',
      },
      { kind: 'flash', x: target.x, y: target.y, color: '#ffffff' },
    );
    this.log.push({
      text: crit
        ? `暴击！你重创了${target.name}，造成 ${damage} 点伤害。`
        : `你击中了${target.name}，造成 ${damage} 点伤害。`,
      tone: 'combat',
    });
    this.applyLifesteal(damage);
    if (crit) playSfx('kill');
    if (target.hp <= 0) this.killMonster(target);
  }

  /** 当前暴击率（天赋可加成） */
  private critChance(): number {
    return 0.1 + this.talentMods().critChance;
  }

  /** 当前吸血比例（天赋可加成） */
  private lifestealRatio(): number {
    return this.talentMods().lifesteal;
  }

  /** 近战伤害吸血回血 */
  private applyLifesteal(damage: number): void {
    const heal = Math.floor(damage * this.lifestealRatio());
    if (heal > 0) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
    }
  }

  private killMonster(target: Actor): void {
    const idx = this.monsters.indexOf(target);
    if (idx !== -1) this.monsters.splice(idx, 1);
    this.kills += 1;
    playSfx('kill');
    this.effects.push({ kind: 'burst', x: target.x, y: target.y, color: '#d96a5a', dur: 420 });
    this.log.push({ text: `${target.name}倒下了！`, tone: 'good' });
    // 生命周期清理（P1-14）：死亡怪物的 AI 记忆与召唤物标记移除
    this.memories.delete(target.id);
    const wasSummoned = this.summonedIds.delete(target.id);
    // Boss 被击杀：专属演出 + 三倍金币
    if (target === this.boss && this.bossDef) {
      this.log.push({ text: this.bossDef.deathText, tone: 'good' });
      this.effects.push({ kind: 'flashScreen', color: '#f5b04c', dur: 600 });
      this.goldPiles.push({
        x: target.x,
        y: target.y,
        amount: rollGold(this.depth, this.rng) * 3,
      });
      this.boss = null;
      return;
    }
    // 召唤物不奖励经验与金币（P0-8）；普通怪 30% 掉金币
    if (!wasSummoned && this.rng.next() < 0.3) {
      this.goldPiles.push({
        x: target.x,
        y: target.y,
        amount: rollGold(this.depth, this.rng),
      });
    }
    if (!wasSummoned) this.gainXp(target.xpValue);
  }

  /** 获得经验（公开给模拟器/测试使用）；大额经验跨多级时排队逐级三选一（P0-6） */
  grantXp(amount: number): void {
    this.gainXp(amount);
  }

  private gainXp(amount: number): void {
    const bonus = this.talentMods();
    this.xp += Math.floor(amount * (1 + bonus.xpBonus));
    let need = this.xpToNext();
    while (this.xp >= need) {
      this.xp -= need;
      this.level += 1;
      this.pendingLevelUps += 1;
      // 升级回复 30% 生命
      const heal = Math.floor(this.player.maxHp * 0.3);
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
      this.log.push({ text: `升到了 ${this.level} 级！选择一项成长：`, tone: 'good' });
      playSfx('levelup');
      this.effects.push({ kind: 'flashScreen', color: '#f5b04c', dur: 450 });
      need = this.xpToNext();
    }
    // 有待处理升级且当前没有展示中的候选 → 立即 offer 一组
    if (this.pendingLevelUps > 0 && this.talentChoices.length === 0) {
      this.offerTalents();
    }
  }

  /** 展示一组三选一天赋；无可用候选时跳过该次升级 */
  private offerTalents(): void {
    this.talentChoices = rollTalentChoices(this.ownedTalents, this.depth, this.rng);
    if (this.talentChoices.length === 0) {
      this.pendingLevelUps = 0;
      this.log.push({ text: '深渊暂时没有更多天赋给你了。', tone: 'info' });
      return;
    }
    this.mode = 'levelUp';
  }

  /** 已拥有天赋的合计加成 */
  private talentMods(): Required<TalentMods> {
    return talentBonus(this.ownedTalents);
  }

  private pickup(): boolean {
    // 金币堆优先
    const goldIdx = this.goldPiles.findIndex(
      (g) => g.x === this.player.x && g.y === this.player.y,
    );
    if (goldIdx !== -1) {
      const pile = this.goldPiles.splice(goldIdx, 1)[0];
      if (!pile) return false;
      const gained = Math.floor(pile.amount * (1 + this.talentMods().goldBonus));
      this.gold += gained;
      playSfx('pickup');
      this.log.push({ text: `拾起了 ${gained} 金币。`, tone: 'good' });
      return true;
    }
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

  /** 视线阻挡回调（统一给 LOS/FOV/弹道使用） */
  private losBlocked(): (x: number, y: number) => boolean {
    return (x, y) => !this.map.isWalkable(x, y);
  }

  /**
   * 可见敌方的统一定义（P0-3）：必须同时满足
   * ① 在 FOV 集合内（含视野半径限制）② 与玩家之间无地形阻挡。
   * 技能、卷轴、火焰新星、自动探索中断一律使用本函数。
   */
  private visibleTargets(): Actor[] {
    const los = this.losBlocked();
    return this.monsters.filter((m) => {
      if (!this.visible.has(`${m.x},${m.y}`)) return false;
      return hasLineOfSight(this.player.x, this.player.y, m.x, m.y, los);
    });
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
      // ① 状态结算（P0-4）：伤害类先于行动，死亡立即移除；
      //    顺序契约：状态伤害 → 死亡判定 → 能量恢复 → 特技 → AI 行动
      const sReport = tickStatuses(m);
      for (const ev of sReport.events) {
        const info = STATUSES[ev.kind];
        if (ev.damage > 0 && info) {
          this.effects.push({
            kind: 'float',
            x: m.x,
            y: m.y,
            text: `-${ev.damage}`,
            color: info.color,
          });
          this.log.push({ text: `${m.name}因${info.name}受到 ${ev.damage} 点伤害。`, tone: 'combat' });
        }
      }
      if (m.hp <= 0) {
        this.killMonster(m);
        continue;
      }
      if (this.dead) return;

      // ② Boss 阶段特技（在能量循环之外，防止特技连锁；haste 只 +1 能量，P0-8）
      if (m === this.boss && this.bossDef) {
        const phase = this.bossPhase();
        if (phase) {
          const special = decideBossSpecial(phase, this.rng);
          if (special.kind !== 'none') {
            this.applyBossSpecial(special);
            continue;
          }
        }
      }

      // ③ 能量制行动频率：加速怪一回合两次，减速怪隔回合一次
      m.energy += actionsPerTurn(m);
      let actionsThisTurn = 0;
      while (m.energy >= 1 && !this.dead && this.mode === 'play') {
        m.energy -= 1;
        actionsThisTurn += 1;
        if (actionsThisTurn > 3) break; // 硬上限：Boss/加速怪每玩家回合最多 3 次行动（P0-8）
        const act = this.decideMonster(m);
        if (act.type === 'attack') {
          this.monsterAttack(m);
          if (this.dead) break;
        } else if (act.type === 'move') {
          const nx = m.x + act.dx;
          const ny = m.y + act.dy;
          const occupied =
            this.monsterAt(nx, ny) !== undefined ||
            (this.player.x === nx && this.player.y === ny) ||
            (this.merchant !== null && this.merchant.x === nx && this.merchant.y === ny);
          if (!occupied && this.map.isWalkable(nx, ny)) {
            this.effects.push({
              kind: 'step',
              fromX: m.x,
              fromY: m.y,
              toX: nx,
              toY: ny,
              glyph: m.glyph,
              color: m.color,
              dur: 140,
            });
            m.x = nx;
            m.y = ny;
          }
        }
      }
    }
  }

  /** 怪物决策入口：Boss 走专属阶段逻辑，普通怪走行为树（有记忆/会呼救/会逃跑） */
  private decideMonster(m: Actor): AiAction {
    if (m === this.boss) {
      // Boss 由 monsterTurns 内联处理阶段特技，这里只做常规决策
      return decideMonsterAction({
        self: m,
        player: this.player,
        isBlocked: (x, y) => !this.map.isWalkable(x, y),
        rng: this.rng,
      });
    }
    const memory = this.memories.get(m.id) ?? newMemory();
    this.memories.set(m.id, memory);
    const allies = this.monsters
      .filter((o) => o !== m && o.side === m.side)
      .map((o) => {
        // P1-13：盟友记忆必须写回 Map，临时对象会让呼救的集结点丢失
        let allyMemory = this.memories.get(o.id);
        if (!allyMemory) {
          allyMemory = newMemory();
          this.memories.set(o.id, allyMemory);
        }
        return { actor: o, memory: allyMemory };
      });
    const result = runBrain({
      self: m,
      player: this.player,
      allies,
      isBlocked: (x, y) => !this.map.isWalkable(x, y),
      // 真实火焰判定（P0-4）：身上有燃烧状态即视为身处火场
      isOnFire: (x, y) => x === m.x && y === m.y && hasStatus(m, 'burn'),
      rng: this.rng,
      memory,
    });
    for (const event of result.events) {
      this.log.push({ text: event.text, tone: 'info' });
    }
    return result.action;
  }

  private monsterAttack(m: Actor): void {
    this.effects.push({
      kind: 'lunge',
      x: m.x,
      y: m.y,
      dx: Math.sign(this.player.x - m.x),
      dy: Math.sign(this.player.y - m.y),
      glyph: m.glyph,
      color: m.color,
      dur: 170,
    });
    // Boss 在狂暴阶段攻击力上升
    const phase = m === this.boss ? this.bossPhase() : null;
    const report = resolveAttack({
      attackerName: m.name,
      attack: m.attack + (phase?.attackBonus ?? 0),
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

  /** 换层时清理不再被任何实体引用的词缀数据（P1-14），防止无界累积 */
  private pruneAffixData(): void {
    const keep = new Set<number>();
    for (const it of this.player.inventory) keep.add(it.uid);
    if (this.player.equipment.weapon) keep.add(this.player.equipment.weapon.uid);
    if (this.player.equipment.armor) keep.add(this.player.equipment.armor.uid);
    for (const uid of [...this.affixData.keys()]) {
      if (!keep.has(uid)) this.affixData.delete(uid);
    }
  }

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
    this.memories.clear();
    this.goldPiles = [];
    this.groundItems = [];
    for (const p of floor.itemSpots) {
      if (this.rng.next() < 0.3) {
        // 金币堆
        this.goldPiles.push({ x: p.x, y: p.y, amount: rollGold(this.depth, this.rng) });
      } else if (this.rng.next() < 0.25) {
        // 远程武器
        const pool = Object.entries(RANGED).filter(([, d]) => d.minDepth <= this.depth);
        const entry = this.rng.pick(pool);
        if (entry) {
          this.groundItems.push({
            x: p.x,
            y: p.y,
            item: { uid: allocateItemUid(), catalogId: entry[0], category: 'ranged' },
          });
          continue;
        }
        this.groundItems.push({ x: p.x, y: p.y, item: rollLoot(this.depth, this.rng) });
      } else {
        const item = rollLoot(this.depth, this.rng);
        // 装备类随机词缀
        if (item.category === 'weapon' || item.category === 'armor') {
          this.affixData.set(item.uid, rollAffixData(this.depth, this.rng));
        }
        this.groundItems.push({ x: p.x, y: p.y, item });
      }
    }
    this.placeMerchant(floor);
    this.placeShrines(floor);
    this.placeTraps(floor);
    this.placeBoss(floor);
    this.pruneAffixData();
    this.explored = new Set();
    this.updateFov();
  }

  /** 每 5 层放置关底 Boss，并播报登场演出 */
  private placeBoss(floor: { playerSpawn: Pt }): void {
    this.boss = null;
    this.bossDef = bossForDepth(this.depth);
    if (!this.bossDef) return;
    const candidates: Pt[] = [];
    for (let y = 1; y < this.map.height - 1; y++) {
      for (let x = 1; x < this.map.width - 1; x++) {
        if (!this.map.isWalkable(x, y)) continue;
        if (x === this.stairsDown.x && y === this.stairsDown.y) continue;
        if (this.monsterAt(x, y)) continue;
        if (this.merchant && this.merchant.x === x && this.merchant.y === y) continue;
        if (this.shrines.some((s) => s.x === x && s.y === y)) continue;
        const dist = Math.max(Math.abs(x - floor.playerSpawn.x), Math.abs(y - floor.playerSpawn.y));
        if (dist < 14) continue;
        candidates.push({ x, y });
      }
    }
    if (candidates.length === 0) return;
    const spot = this.rng.pick(candidates);
    const d = this.bossDef;
    this.boss = makeActor({
      species: d.species,
      name: d.name,
      glyph: d.glyph,
      color: d.color,
      x: spot.x,
      y: spot.y,
      hp: d.maxHp,
      maxHp: d.maxHp,
      attack: d.attack,
      defense: d.defense,
      xpValue: d.xpValue,
      ai: { mode: 'sleep', senseRadius: d.senseRadius },
    });
    this.monsters.push(this.boss);
    this.log.push({ text: d.introText, tone: 'bad' });
  }

  /** Boss 当前所处阶段（非 Boss 怪返回 null） */
  private bossPhase(): BossPhase | null {
    if (!this.boss || !this.bossDef || this.boss.hp <= 0) return null;
    return phaseForHp(this.bossDef, this.boss.hp);
  }

  /** 每层放一位流浪商人：离出生点较远的随机地板 */
  private placeMerchant(floor: { playerSpawn: Pt }): void {
    const candidates: Pt[] = [];
    for (let y = 1; y < this.map.height - 1; y++) {
      for (let x = 1; x < this.map.width - 1; x++) {
        if (!this.map.isWalkable(x, y)) continue;
        if (x === this.stairsDown.x && y === this.stairsDown.y) continue;
        const dist = Math.max(Math.abs(x - floor.playerSpawn.x), Math.abs(y - floor.playerSpawn.y));
        if (dist < 12) continue;
        candidates.push({ x, y });
      }
    }
    if (candidates.length === 0) {
      this.merchant = null;
      return;
    }
    const spot = this.rng.pick(candidates);
    this.merchant = { x: spot.x, y: spot.y, stock: rollStock(this.depth, this.rng) };
  }

  /** 每层一座奇遇建筑：奇数层祭坛 / 偶数层许愿井 */
  private placeShrines(floor: {
    playerSpawn: Pt;
    stairsDown: Pt;
    itemSpots: Pt[];
    monsterSpawns: Pt[];
  }): void {
    this.shrines = [];
    const candidates: Pt[] = [];
    for (let y = 1; y < this.map.height - 1; y++) {
      for (let x = 1; x < this.map.width - 1; x++) {
        if (!this.map.isWalkable(x, y)) continue;
        if (x === this.stairsDown.x && y === this.stairsDown.y) continue;
        if (floor.playerSpawn.x === x && floor.playerSpawn.y === y) continue;
        if (floor.itemSpots.some((p) => p.x === x && p.y === y)) continue;
        if (floor.monsterSpawns.some((p) => p.x === x && p.y === y)) continue;
        if (this.merchant && this.merchant.x === x && this.merchant.y === y) continue;
        candidates.push({ x, y });
      }
    }
    if (candidates.length === 0) return;
    const spot = this.rng.pick(candidates);
    const kind: ShrineKind = this.depth % 2 === 1 ? 'altar' : 'well';
    this.shrines.push({ x: spot.x, y: spot.y, kind });
  }

  /** 按深度撒陷阱：避开出生点、楼梯、商人位、奇遇建筑与物品点 */
  private placeTraps(floor: { playerSpawn: Pt; stairsDown: Pt; itemSpots: Pt[] }): void {
    const candidates: Pt[] = [];
    for (let y = 1; y < this.map.height - 1; y++) {
      for (let x = 1; x < this.map.width - 1; x++) {
        if (!this.map.isWalkable(x, y)) continue;
        if (x === floor.playerSpawn.x && y === floor.playerSpawn.y) continue;
        if (x === floor.stairsDown.x && y === floor.stairsDown.y) continue;
        if (floor.itemSpots.some((p) => p.x === x && p.y === y)) continue;
        if (this.merchant && this.merchant.x === x && this.merchant.y === y) continue;
        if (this.shrines.some((s) => s.x === x && s.y === y)) continue;
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

  private newRun(classId: ClassId = this.classId): void {
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
    this.gold = 0;
    this.affixData.clear();
    this.ownedTalents = [];
    this.talentChoices = [];
    this.pendingLevelUps = 0;
    this.bossSummonCount = 0;
    this.summonedIds.clear();
    this.shrines = [];
    this.memories.clear();
    this.mightUntil = 0;
    this.lastPersistTurn = -1;
    this.log = [{ text: '新的冒险开始了。你在余烬深渊的第 1 层醒来……', tone: 'info' }];
    Game.clearSave();
    // 种子语义（P1-11）：URL/每日种子下每局完全一致；否则 LCG 派生保证连续两局不同
    if (!this.fixedSeed) {
      this.runSeed = (this.runSeed * 1664525 + 1013904223) % 2147483647;
    }
    this.rng = new Rng(this.runSeed || 1);
    resetEntityIds();
    // 按职业初始化角色
    this.classId = classId;
    const cls = CLASSES[classId];
    this.player = createPlayer(0, 0);
    this.player.maxHp = cls.baseHp;
    this.player.hp = cls.baseHp;
    this.player.attack = cls.baseAttack;
    this.player.defense = cls.baseDefense;
    this.skill = makeCooldown(cls.skill);
    if (cls.startWeapon) {
      this.player.equipment.weapon = {
        uid: allocateItemUid(),
        catalogId: cls.startWeapon,
        category: 'weapon',
      };
    }
    if (cls.startArmor) {
      this.player.equipment.armor = {
        uid: allocateItemUid(),
        catalogId: cls.startArmor,
        category: 'armor',
      };
    }
    for (const id of cls.startItems) {
      this.player.inventory.push({ uid: allocateItemUid(), catalogId: id, category: 'potion' });
    }
    if (cls.startRanged) {
      this.player.inventory.push({
        uid: allocateItemUid(),
        catalogId: cls.startRanged,
        category: 'ranged',
      });
    }
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

  /** 献祭祭坛：付出 30% 生命上限赌一个结果（一次性） */
  private useAltar(idx: number): void {
    const shrine = this.shrines[idx];
    if (!shrine) return;
    const report = resolveAltar(this.player.maxHp, this.rng);
    this.shrines.splice(idx, 1);
    this.player.hp = Math.max(0, this.player.hp - report.cost);
    playSfx('hurt');
    this.effects.push(
      { kind: 'flash', x: this.player.x, y: this.player.y, color: '#d43d2e' },
      { kind: 'float', x: this.player.x, y: this.player.y, text: `-${report.cost}`, color: '#d43d2e' },
    );
    this.log.push({
      text: report.message,
      tone: report.blessing ? 'good' : report.curse ? 'bad' : 'info',
    });
    if (report.blessing) {
      if (report.blessing.kind === 'might') {
        // might 是计时器机制而非持续状态，走游戏层
        this.mightUntil = this.turn + report.blessing.turns;
      } else {
        applyStatus(this.player, report.blessing.kind, report.blessing.turns, report.blessing.power);
      }
    }
    if (report.curse) {
      applyStatus(this.player, report.curse.kind, report.curse.turns, report.curse.power);
    }
    if (report.fullHeal) {
      this.player.hp = this.player.maxHp;
      this.effects.push({ kind: 'flashScreen', color: '#ffd76b', dur: 500 });
    }
    if (this.player.hp <= 0) {
      this.dead = true;
      this.deathCause = SHRINES.altar.name;
      playSfx('die');
      this.effects.push(
        { kind: 'quake', dur: 500 },
        { kind: 'flashScreen', color: '#5c1010', dur: 600 },
      );
      this.log.push({ text: '你把自己的生命献给了深渊……按 R 重新开始。', tone: 'bad' });
    }
  }

  /** 许愿井：25 金币赌运气（可重复） */
  private useWell(idx: number): void {
    const shrine = this.shrines[idx];
    if (!shrine) return;
    if (this.gold < 25) {
      this.log.push({ text: '许愿井需要 25 金币。', tone: 'info' });
      return;
    }
    const report = resolveWell(this.rng);
    this.gold -= report.goldCost;
    playSfx('quaff');
    this.effects.push({ kind: 'flash', x: this.player.x, y: this.player.y, color: '#4fc3f7' });
    this.log.push({
      text: report.message,
      tone: report.angered ? 'bad' : report.nothing ? 'info' : 'good',
    });
    if (report.heal) {
      this.player.hp = this.player.maxHp;
      this.effects.push({ kind: 'flashScreen', color: '#4fc3f7', dur: 400 });
    }
    if (report.item) {
      const item: ItemInstance = {
        uid: allocateItemUid(),
        catalogId: report.item.catalogId,
        category: report.item.category,
      };
      if (this.player.inventory.length >= MAX_INVENTORY) {
        // 背包满（P0-9）：物品被顶到脚边变成地面物品
        this.groundItems.push({ x: this.player.x, y: this.player.y, item });
        this.log.push({ text: '背包满了，井里的东西被顶到了脚边。', tone: 'info' });
      } else {
        if (item.category === 'weapon' || item.category === 'armor') {
          this.affixData.set(item.uid, rollAffixData(this.depth, this.rng));
        }
        this.player.inventory.push(item);
        this.log.push({ text: `井底捞出了${itemInfo(item).name}！`, tone: 'good' });
      }
    }
    if (report.angered) {
      // 在玩家周围逐环搜索空位，惊醒 1-2 只怪物
      const count = this.rng.int(1, 2);
      let placed = 0;
      for (let r = 1; r <= 4 && placed < count; r++) {
        for (let dy = -r; dy <= r && placed < count; dy++) {
          for (let dx = -r; dx <= r && placed < count; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = this.player.x + dx;
            const y = this.player.y + dy;
            if (!this.map.isWalkable(x, y) || this.monsterAt(x, y)) continue;
            const t = rollMonster(this.depth, this.rng);
            this.monsters.push(
              makeActor({
                species: t.species,
                name: t.name,
                glyph: t.glyph,
                color: t.color,
                x,
                y,
                hp: t.maxHp,
                maxHp: t.maxHp,
                attack: t.attack,
                defense: t.defense,
                xpValue: t.xpValue,
                ai: { mode: 'chase', senseRadius: t.senseRadius },
              }),
            );
            this.effects.push({ kind: 'burst', x, y, color: '#7d4bd1', dur: 400 });
            placed += 1;
          }
        }
      }
      if (placed > 0) this.log.push({ text: '深渊的怪物被惊醒了！', tone: 'bad' });
    }
  }

  /** Boss 阶段特技落地（P0-8：召唤上限/召唤物无 XP/haste 仅 +1 能量） */
  private applyBossSpecial(report: BossSpecialReport): void {
    this.log.push({ text: report.message, tone: 'bad' });
    playSfx('zap');
    this.effects.push({ kind: 'quake', dur: 260 });
    if (report.kind === 'aoe' && this.boss) {
      const dist = Math.max(
        Math.abs(this.player.x - this.boss.x),
        Math.abs(this.player.y - this.boss.y),
      );
      if (dist <= 3) {
        const damage = Math.max(1, report.damage - this.effectiveDefense());
        this.player.hp -= damage;
        this.effects.push({
          kind: 'float',
          x: this.player.x,
          y: this.player.y,
          text: `-${damage}`,
          color: '#d96a5a',
        });
        this.log.push({ text: `冲击波击中了你（${damage} 伤害）！`, tone: 'bad' });
        if (this.player.hp <= 0) {
          this.dead = true;
          this.deathCause = this.bossDef?.name ?? '深渊';
          playSfx('die');
          this.log.push({ text: '你被冲击波撕碎了……按 R 重新开始。', tone: 'bad' });
        }
      }
    } else if (report.kind === 'summon' && this.boss) {
      // 召唤上限：每场战斗最多 4 只（P0-8）
      const room = BOSS_SUMMON_CAP - this.bossSummonCount;
      if (room <= 0) {
        this.log.push({ text: '深渊的雾气翻涌，却再也召不出东西了。', tone: 'info' });
        return;
      }
      for (let i = 0; i < Math.min(report.count, room); i++) {
        let placed = false;
        for (let r = 1; r <= 3 && !placed; r++) {
          for (let dy = -r; dy <= r && !placed; dy++) {
            for (let dx = -r; dx <= r && !placed; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const x = this.boss.x + dx;
              const y = this.boss.y + dy;
              if (!this.map.isWalkable(x, y) || this.monsterAt(x, y)) continue;
              if (this.player.x === x && this.player.y === y) continue;
              const t = rollMonster(this.depth, this.rng);
              const minion = makeActor({
                species: t.species,
                name: t.name,
                glyph: t.glyph,
                color: t.color,
                x,
                y,
                hp: t.maxHp,
                maxHp: t.maxHp,
                attack: t.attack,
                defense: t.defense,
                xpValue: t.xpValue,
                ai: { mode: 'chase', senseRadius: t.senseRadius },
              });
              this.monsters.push(minion);
              this.summonedIds.add(minion.id);
              this.bossSummonCount += 1;
              this.effects.push({ kind: 'burst', x, y, color: '#7d4bd1', dur: 400 });
              placed = true;
            }
          }
        }
      }
    } else if (report.kind === 'haste' && this.boss) {
      // haste = 下一回合一次额外普通行动（能量 +1），不再向循环注入无界能量（P0-8）
      this.boss.energy += 1;
      this.log.push({ text: `${this.boss.name}的动作变得越来越快了！`, tone: 'bad' });
    } else if (report.kind === 'heal' && this.boss) {
      const heal = Math.floor(this.boss.maxHp * 0.15);
      this.boss.hp = Math.min(this.boss.maxHp, this.boss.hp + heal);
      this.effects.push({
        kind: 'float',
        x: this.boss.x,
        y: this.boss.y,
        text: `+${heal}`,
        color: '#7fbf6a',
      });
    }
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
      {
        x: this.player.x,
        y: this.player.y,
        glyph: this.player.glyph,
        color: this.player.color,
        hp: this.player.hp,
        maxHp: this.player.maxHp,
      },
    ];
    for (const m of this.monsters) {
      actors.push({
        x: m.x,
        y: m.y,
        glyph: m.glyph,
        color: m.color,
        hp: m.hp,
        maxHp: m.maxHp,
      });
    }
    const items: Glyph[] = this.groundItems.map((g) => {
      const def = itemInfo(g.item);
      // 带词缀的装备按稀有度颜色显示
      const affix = this.affixData.get(g.item.uid) ?? null;
      const color = affix && affix.affixIds.length > 0 ? rarityColor(affix) : def.color;
      return { x: g.x, y: g.y, glyph: def.glyph, color };
    });
    for (const g of this.goldPiles) {
      items.push({ x: g.x, y: g.y, glyph: '$', color: '#e8c14a' });
    }
    if (this.merchant) {
      actors.push({ x: this.merchant.x, y: this.merchant.y, glyph: '$', color: '#e8c14a' });
    }
    const trapGlyphs: Glyph[] = this.traps.map((t) => {
      const def = TRAPS[t.kind];
      return { x: t.x, y: t.y, glyph: def.glyph, color: def.color };
    });
    const shrineGlyphs: Glyph[] = this.shrines.map((s) => {
      const def = SHRINES[s.kind];
      return { x: s.x, y: s.y, glyph: def.glyph, color: def.color };
    });
    return {
      map: this.map,
      depth: this.depth,
      visible: this.visible,
      explored: this.explored,
      markers: [
        { x: this.stairsDown.x, y: this.stairsDown.y, glyph: '>', color: '#c9a227' },
        ...trapGlyphs,
        ...shrineGlyphs,
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
    // 回放/无头模式下没有渲染器，只推进逻辑
    if (!this.renderer) return;
    this.renderer.draw(this.buildScene());
  }
}
