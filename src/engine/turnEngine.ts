/**
 * TurnEngine（里程碑 4）：回合循环与怪物回合编排的服务化迁移。
 * 从 game.ts 迁出：endPlayerTurn（回合结算/状态 tick/能量系统/存档节流）、
 * monsterTurns（怪物回合：状态→死亡→能量→特技→AI 的注释契约顺序）、
 * decideMonster（怪物决策入口）、monsterAttack（怪物攻击结算）、
 * applyBossSpecial（Boss 阶段特技调度）、applyOnHitStatus（深渊生物附加攻击）、
 * tickPlayerStatuses / tickMight / debugForceBossSpecial。
 * 依赖以最小上下文接口 TurnEngineCtx 注入，本模块不得 import game.ts（门面）：
 * - killMonster（击杀结算：金币掉落/经验/Boss 奖励，含 RNG 消耗）、
 *   effectiveDefense（装备/词缀/天赋防御合计）等与战斗经济结算深度耦合的细节
 *   留在门面，以回调注入；
 * - turn/dead/deathCause/mightUntil/boss/bossDef/bossSummonCount 是门面侧
 *   会重赋值或被就地改写的标量，一律经访问器读写，保证写回门面；
 * - player/rng/memories/summonedIds/effects 按引用传入、就地变更；
 * - 怪物移动占用的商人位、地图通行性、升级打断能量循环（mode === 'play'）
 *   等门面状态经回调/访问器注入。
 * 行为、日志文本、音效与 RNG 消耗顺序与迁移前逐位一致。
 */
import { playSfx } from './audio';
import { decideMonsterAction } from './ai';
import type { AiAction } from './ai';
import { resolveAttack } from './combat';
import { runBrain, newMemory, tickMemory } from './brain';
import type { MonsterMemory } from './brain';
import type { Rng } from './rng';
import {
  STATUSES,
  actionsPerTurn,
  applyStatus,
  hasStatus,
  tickStatuses,
} from './statuses';
import { makeActor } from '../entities/actor';
import type { Actor } from '../entities/actor';
import { decideBossSpecial, phaseForHp } from '../entities/bosses';
import type { BossDef, BossPhase, BossSpecialReport } from '../entities/bosses';
import { tickCooldown } from '../entities/classes';
import type { SkillCooldown } from '../entities/classes';
import { rollMonster } from '../entities/monsters';
import type { TalentMods } from '../entities/talents';
import type { Effect } from '../ui/renderer';

/** 日志语气（与 game.ts 的 Tone / InventoryEconomyService 的 LogTone 同形） */
export type TurnLogTone = 'info' | 'good' | 'bad' | 'combat';

/** Boss 每场战斗的召唤物上限（P0-8） */
const BOSS_SUMMON_CAP = 4;

/**
 * 回合引擎的最小上下文。
 * player/rng/memories/summonedIds/effects 按引用传入（服务只做就地变更，绝不重赋值）；
 * turn/dead/deathCause/depth/mightUntil/boss/bossDef/bossSummonCount/monsters
 * 是门面侧会重赋值或被就地改写的状态，经访问器读写以保证写回。
 */
export interface TurnEngineCtx {
  // ---- 按引用传入的就地变更对象 ----
  readonly rng: Rng;
  readonly player: Actor;
  /** 怪物 AI 记忆（换层/新局时清空，不重赋值） */
  readonly memories: Map<number, MonsterMemory>;
  /** Boss 召唤物 ID 集合（不给经验/金币，P0-8；新局时清空，不重赋值） */
  readonly summonedIds: Set<number>;
  /** 打击感特效队列：服务只就地 push */
  readonly effects: Effect[];
  // ---- 门面标量/容器：经访问器读写 ----
  /** 当前回合数（endPlayerTurn 递增） */
  getTurn(): number;
  setTurn(turn: number): void;
  /** 职业技能冷却（ hydrate/newRun 会整体重赋值） */
  getSkill(): SkillCooldown;
  /** 玩家死亡标记（怪物攻击/特技/状态伤害可置位） */
  getDead(): boolean;
  setDead(dead: boolean): void;
  /** 死亡原因（置 dead 时一并写回） */
  getDeathCause(): string;
  setDeathCause(cause: string): void;
  /** 当前层深（怪物攻击致死记录、Boss 召唤物按层生成） */
  getDepth(): number;
  /** 余烬之力到期回合（tickMight 归零） */
  getMightUntil(): number;
  setMightUntil(turn: number): void;
  /** 存活 Boss 及其定义（击杀时门面会置空） */
  getBoss(): Actor | null;
  getBossDef(): BossDef | null;
  /** 本场 Boss 战已召唤的小怪数（P0-8 上限控制） */
  getBossSummonCount(): number;
  setBossSummonCount(count: number): void;
  /** 怪物列表（Boss 召唤会就地 push） */
  getMonsters(): Actor[];
  /** 流浪商人位置（怪物移动占用判定）；无商人时为 null */
  getMerchantPos(): { x: number; y: number } | null;
  /** 界面是否处于 play 模式（升级三选一会打断怪物能量循环） */
  isPlayMode(): boolean;
  // ---- 门面回调 ----
  /** 地图通行性（视线阻挡回调统一给 AI/移动/召唤落位使用） */
  isWalkable(x: number, y: number): boolean;
  /** 已拥有天赋的合计加成（回合回复用） */
  talentMods(): Required<TalentMods>;
  /** 玩家有效防御（装备+词缀+天赋，怪物攻击/冲击波结算用） */
  effectiveDefense(): number;
  /** 击杀结算（金币掉落/经验/Boss 奖励，含 RNG 消耗，留在门面） */
  killMonster(target: Actor): void;
  /** 指定坐标是否有怪物占用 */
  monsterAt(x: number, y: number): Actor | undefined;
  /** 自动存档（批量模式按回合节流，门面实现） */
  persist(): void;
  /** 清除存档（玩家死亡时） */
  clearSave(): void;
  /** 记录历史最深进度（ENDLESS 元进度，门面写 localStorage） */
  recordDepth(depth: number): void;
  /** 消息日志 */
  log(text: string, tone: TurnLogTone): void;
}

/** 回合循环/怪物回合编排引擎：无状态编排，全部状态经上下文读写 */
export class TurnEngine {
  constructor(private readonly ctx: TurnEngineCtx) {}

  /** 玩家行动成功后的公共回合结算 */
  endPlayerTurn(): void {
    const ctx = this.ctx;
    ctx.setTurn(ctx.getTurn() + 1);
    tickCooldown(ctx.getSkill());
    for (const memory of ctx.memories.values()) tickMemory(memory);
    // 天赋·活力：每 5 回合回复生命
    const regen = ctx.talentMods().regen;
    if (regen > 0 && ctx.getTurn() % 5 === 0 && ctx.player.hp < ctx.player.maxHp) {
      ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + regen);
    }
    this.tickPlayerStatuses();
    if (!ctx.getDead()) {
      // 玩家加速 → 怪物隔回合行动；玩家减速 → 怪物一回合行动两轮
      const hasted = hasStatus(ctx.player, 'haste');
      const slowed = hasStatus(ctx.player, 'slow');
      if (!hasted || ctx.getTurn() % 2 === 0) this.monsterTurns();
      if (slowed && !ctx.getDead()) this.monsterTurns();
    }
    this.tickMight();
    if (ctx.getDead()) {
      ctx.clearSave();
    } else {
      ctx.persist();
    }
  }

  /** 玩家身上的持续状态结算（中毒/燃烧/再生…），可能致死 */
  private tickPlayerStatuses(): void {
    const ctx = this.ctx;
    const report = tickStatuses(ctx.player);
    for (const event of report.events) {
      const info = STATUSES[event.kind];
      if (!info) continue;
      if (event.damage > 0) {
        ctx.effects.push({
          kind: 'float',
          x: ctx.player.x,
          y: ctx.player.y,
          text: `-${event.damage}`,
          color: info.color,
        });
        ctx.log(`${info.name}侵蚀着你（${event.damage} 伤害）。`, 'bad');
      } else if (event.damage < 0) {
        ctx.effects.push({
          kind: 'float',
          x: ctx.player.x,
          y: ctx.player.y,
          text: `+${-event.damage}`,
          color: info.color,
        });
        ctx.log(`${info.name}让你恢复了 ${-event.damage} 点生命。`, 'good');
      } else if (event.expired) {
        ctx.log(`${info.name}消退了。`, 'info');
      }
      if (ctx.player.hp <= 0) {
        ctx.setDead(true);
        ctx.setDeathCause(info.name);
        playSfx('die');
        ctx.effects.push(
          { kind: 'quake', dur: 500 },
          { kind: 'flashScreen', color: '#5c1010', dur: 600 },
        );
        ctx.log(`你死于${info.name}……按 R 重新开始。`, 'bad');
        break;
      }
    }
  }

  /** 余烬之力到期归零 */
  private tickMight(): void {
    const ctx = this.ctx;
    if (ctx.getMightUntil() !== 0 && ctx.getTurn() > ctx.getMightUntil()) {
      ctx.setMightUntil(0);
      ctx.log('余烬之力消散了。', 'info');
    }
  }

  // ---------- 怪物回合 ----------

  private monsterTurns(): void {
    const ctx = this.ctx;
    for (const m of [...ctx.getMonsters()]) {
      // ① 状态结算（P0-4）：伤害类先于行动，死亡立即移除；
      //    顺序契约：状态伤害 → 死亡判定 → 能量恢复 → 特技 → AI 行动
      const sReport = tickStatuses(m);
      for (const ev of sReport.events) {
        const info = STATUSES[ev.kind];
        if (ev.damage > 0 && info) {
          ctx.effects.push({
            kind: 'float',
            x: m.x,
            y: m.y,
            text: `-${ev.damage}`,
            color: info.color,
          });
          ctx.log(`${m.name}因${info.name}受到 ${ev.damage} 点伤害。`, 'combat');
        }
      }
      if (m.hp <= 0) {
        ctx.killMonster(m);
        continue;
      }
      if (ctx.getDead()) return;

      // ② Boss 阶段特技（在能量循环之外，防止特技连锁；haste 只 +1 能量，P0-8）
      if (m === ctx.getBoss() && ctx.getBossDef()) {
        const phase = this.bossPhase();
        if (phase) {
          const special = decideBossSpecial(phase, ctx.rng);
          if (special.kind !== 'none') {
            this.applyBossSpecial(special);
            continue;
          }
        }
      }

      // ③ 能量制行动频率：加速怪一回合两次，减速怪隔回合一次
      m.energy += actionsPerTurn(m);
      let actionsThisTurn = 0;
      while (m.energy >= 1 && !ctx.getDead() && ctx.isPlayMode()) {
        m.energy -= 1;
        actionsThisTurn += 1;
        if (actionsThisTurn > 3) break; // 硬上限：Boss/加速怪每玩家回合最多 3 次行动（P0-8）
        const act = this.decideMonster(m);
        if (act.type === 'attack') {
          this.monsterAttack(m);
          if (ctx.getDead()) break;
        } else if (act.type === 'move') {
          const nx = m.x + act.dx;
          const ny = m.y + act.dy;
          const merchant = ctx.getMerchantPos();
          const occupied =
            ctx.monsterAt(nx, ny) !== undefined ||
            (ctx.player.x === nx && ctx.player.y === ny) ||
            (merchant !== null && merchant.x === nx && merchant.y === ny);
          if (!occupied && ctx.isWalkable(nx, ny)) {
            ctx.effects.push({
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
    const ctx = this.ctx;
    if (m === ctx.getBoss()) {
      // Boss 由 monsterTurns 内联处理阶段特技，这里只做常规决策
      return decideMonsterAction({
        self: m,
        player: ctx.player,
        isBlocked: (x, y) => !ctx.isWalkable(x, y),
        rng: ctx.rng,
      });
    }
    const memory = ctx.memories.get(m.id) ?? newMemory();
    ctx.memories.set(m.id, memory);
    const allies = ctx
      .getMonsters()
      .filter((o) => o !== m && o.side === m.side)
      .map((o) => {
        // P1-13：盟友记忆必须写回 Map，临时对象会让呼救的集结点丢失
        let allyMemory = ctx.memories.get(o.id);
        if (!allyMemory) {
          allyMemory = newMemory();
          ctx.memories.set(o.id, allyMemory);
        }
        return { actor: o, memory: allyMemory };
      });
    const result = runBrain({
      self: m,
      player: ctx.player,
      allies,
      isBlocked: (x, y) => !ctx.isWalkable(x, y),
      // 真实火焰判定（P0-4）：身上有燃烧状态即视为身处火场
      isOnFire: (x, y) => x === m.x && y === m.y && hasStatus(m, 'burn'),
      rng: ctx.rng,
      memory,
    });
    for (const event of result.events) {
      ctx.log(event.text, 'info');
    }
    return result.action;
  }

  private monsterAttack(m: Actor): void {
    const ctx = this.ctx;
    ctx.effects.push({
      kind: 'lunge',
      x: m.x,
      y: m.y,
      dx: Math.sign(ctx.player.x - m.x),
      dy: Math.sign(ctx.player.y - m.y),
      glyph: m.glyph,
      color: m.color,
      dur: 170,
    });
    // Boss 在狂暴阶段攻击力上升
    const phase = m === ctx.getBoss() ? this.bossPhase() : null;
    const report = resolveAttack({
      attackerName: m.name,
      attack: m.attack + (phase?.attackBonus ?? 0),
      defenderName: '你',
      defense: ctx.effectiveDefense(),
      defenderHp: ctx.player.hp,
      rng: ctx.rng,
    });
    ctx.player.hp -= report.damage;
    playSfx('hurt');
    ctx.effects.push(
      { kind: 'float', x: ctx.player.x, y: ctx.player.y, text: `-${report.damage}`, color: '#d96a5a' },
      { kind: 'flash', x: ctx.player.x, y: ctx.player.y, color: '#d96a5a' },
    );
    ctx.log(`${m.name}击中了你，造成 ${report.damage} 点伤害！`, 'bad');
    this.applyOnHitStatus(m);
    if (report.killed) {
      ctx.setDead(true);
      ctx.setDeathCause(m.name);
      ctx.recordDepth(ctx.getDepth());
      playSfx('die');
      ctx.effects.push({ kind: 'quake', dur: 500 }, { kind: 'flashScreen', color: '#5c1010', dur: 600 });
      ctx.log(`你死在了第 ${ctx.getDepth()} 层……按 R 重新开始。`, 'bad');
    }
  }

  /** Boss 当前所处阶段（非 Boss 怪返回 null） */
  private bossPhase(): BossPhase | null {
    const ctx = this.ctx;
    const boss = ctx.getBoss();
    const def = ctx.getBossDef();
    if (!boss || !def || boss.hp <= 0) return null;
    return phaseForHp(def, boss.hp);
  }

  /** Boss 阶段特技落地（P0-8：召唤上限/召唤物无 XP/haste 仅 +1 能量） */
  private applyBossSpecial(report: BossSpecialReport): void {
    const ctx = this.ctx;
    ctx.log(report.message, 'bad');
    playSfx('zap');
    ctx.effects.push({ kind: 'quake', dur: 260 });
    const boss = ctx.getBoss();
    if (report.kind === 'aoe' && boss) {
      const dist = Math.max(
        Math.abs(ctx.player.x - boss.x),
        Math.abs(ctx.player.y - boss.y),
      );
      if (dist <= 3) {
        const damage = Math.max(1, report.damage - ctx.effectiveDefense());
        ctx.player.hp -= damage;
        ctx.effects.push({
          kind: 'float',
          x: ctx.player.x,
          y: ctx.player.y,
          text: `-${damage}`,
          color: '#d96a5a',
        });
        ctx.log(`冲击波击中了你（${damage} 伤害）！`, 'bad');
        if (ctx.player.hp <= 0) {
          ctx.setDead(true);
          ctx.setDeathCause(ctx.getBossDef()?.name ?? '深渊');
          playSfx('die');
          ctx.log('你被冲击波撕碎了……按 R 重新开始。', 'bad');
        }
      }
    } else if (report.kind === 'summon' && boss) {
      // 召唤上限：每场战斗最多 4 只（P0-8）
      const room = BOSS_SUMMON_CAP - ctx.getBossSummonCount();
      if (room <= 0) {
        ctx.log('深渊的雾气翻涌，却再也召不出东西了。', 'info');
        return;
      }
      for (let i = 0; i < Math.min(report.count, room); i++) {
        let placed = false;
        for (let r = 1; r <= 3 && !placed; r++) {
          for (let dy = -r; dy <= r && !placed; dy++) {
            for (let dx = -r; dx <= r && !placed; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const x = boss.x + dx;
              const y = boss.y + dy;
              if (!ctx.isWalkable(x, y) || ctx.monsterAt(x, y)) continue;
              if (ctx.player.x === x && ctx.player.y === y) continue;
              const t = rollMonster(ctx.getDepth(), ctx.rng);
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
              ctx.getMonsters().push(minion);
              ctx.summonedIds.add(minion.id);
              ctx.setBossSummonCount(ctx.getBossSummonCount() + 1);
              ctx.effects.push({ kind: 'burst', x, y, color: '#7d4bd1', dur: 400 });
              placed = true;
            }
          }
        }
      }
    } else if (report.kind === 'haste' && boss) {
      // haste = 下一回合一次额外普通行动（能量 +1），不再向循环注入无界能量（P0-8）
      boss.energy += 1;
      ctx.log(`${boss.name}的动作变得越来越快了！`, 'bad');
    } else if (report.kind === 'heal' && boss) {
      const heal = Math.floor(boss.maxHp * 0.15);
      boss.hp = Math.min(boss.maxHp, boss.hp + heal);
      ctx.effects.push({
        kind: 'float',
        x: boss.x,
        y: boss.y,
        text: `+${heal}`,
        color: '#7fbf6a',
      });
    }
  }

  /** 深渊生物的附加攻击：按物种概率施加状态 */
  private applyOnHitStatus(m: Actor): void {
    const ctx = this.ctx;
    if (ctx.getDead()) return;
    const roll = ctx.rng.next();
    if (m.species === 'rat' && roll < 0.15) {
      applyStatus(ctx.player, 'poison', 4, 1);
      ctx.log('鼠人的咬伤让你中毒了！', 'bad');
    } else if (m.species === 'ember_wraith' && roll < 0.35) {
      applyStatus(ctx.player, 'burn', 3, 2);
      ctx.log('余烬幽魂的火焰灼烧着你！', 'bad');
    } else if (m.species === 'skeleton' && roll < 0.1) {
      applyStatus(ctx.player, 'slow', 4, 0);
      ctx.log('骷髅兵的寒气让你行动迟缓！', 'bad');
    }
  }

  /** @internal 测试用：强制 Boss 释放一次阶段特技（确定性消耗 rng） */
  debugForceBossSpecial(): void {
    for (let i = 0; i < 60; i++) {
      const phase = this.bossPhase();
      if (!phase) return;
      const special = decideBossSpecial(phase, this.ctx.rng);
      if (special.kind !== 'none') {
        this.applyBossSpecial(special);
        return;
      }
    }
  }
}
