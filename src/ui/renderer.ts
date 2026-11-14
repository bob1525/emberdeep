import { TILE_GLYPH } from '../world/tiles';
import type { GameMap } from '../world/map';

/** 场景中任意一个待绘制的字符 */
export interface Glyph {
  x: number;
  y: number;
  glyph: string;
  color: string;
}

/** 死亡画面展示的本局统计 */
export interface DeathStats {
  depth: number;
  turn: number;
  level: number;
  kills: number;
  cause: string;
}

export interface Scene {
  map: GameMap;
  /** 楼层深度，决定主题色 */
  depth: number;
  /** 当前视野内的格子（键 "x,y"），以全亮度绘制 */
  visible: Set<string>;
  /** 已探索记忆中的格子，以暗色绘制 */
  explored: Set<string>;
  /** 地形标记（如下行楼梯），已探索即可见 */
  markers: Glyph[];
  /** 地面物品，仅当前可见时绘制 */
  items: Glyph[];
  /** 角色（玩家 + 怪物），仅当前可见时绘制；玩家必须排第一 */
  actors: Glyph[];
  /** 玩家死亡时叠加暗红遮罩与统计 */
  dead?: boolean;
  stats?: DeathStats;
}

const FONT = '18px Consolas, "Courier New", monospace';
const CELL_H = 20;

/** 楼层主题：每 5 层换一次氛围 */
interface Theme {
  bg: string;
  wall: string;
  floor: string;
}

const THEMES: Theme[] = [
  { bg: '#0b0e14', wall: '#566070', floor: '#38404f' }, // 1-4 余烬灰
  { bg: '#0a0d13', wall: '#4f6b8f', floor: '#2f3f56' }, // 5-9 寒渊蓝
  { bg: '#0d0a13', wall: '#6b5f8f', floor: '#3d3656' }, // 10-14 幽暗紫
  { bg: '#130a08', wall: '#8f5f4f', floor: '#56362f' }, // 15+ 熔核红
];

function themeFor(depth: number): Theme {
  return THEMES[Math.min(THEMES.length - 1, Math.floor((depth - 1) / 5))] as Theme;
}

/** 把 hex 颜色向指定背景压暗，用于"记忆中"的地形 */
function dimColor(hex: string, bg: string, factor = 0.4): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const br = parseInt(bg.slice(1, 3), 16);
  const bgG = parseInt(bg.slice(3, 5), 16);
  const bb = parseInt(bg.slice(5, 7), 16);
  const mix = (c: number, base: number) => Math.round(c * factor + base * (1 - factor));
  return `rgb(${mix(r, br)}, ${mix(g, bgG)}, ${mix(b, bb)})`;
}

/** 短时视觉效果的统一时长（毫秒） */
export type Effect =
  | { kind: 'float'; x: number; y: number; text: string; color: string; dur?: number }
  | { kind: 'flash'; x: number; y: number; color: string; dur?: number }
  | { kind: 'burst'; x: number; y: number; color: string; dur?: number }
  | { kind: 'quake'; dur?: number }
  | { kind: 'flashScreen'; color: string; dur?: number };

interface ActiveEffect {
  effect: Effect;
  start: number;
  dur: number;
}

/** 字符画渲染器：整个画面就是一张大号字符表，带视野光照分层与打击感效果层 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private lastScene: Scene | null = null;
  private active: ActiveEffect[] = [];
  private rafId = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D 上下文不可用');
    this.ctx = ctx;
  }

  /** 播放一批打击感效果；期间用 rAF 反复重绘底图叠加效果 */
  playEffects(effects: Effect[]): void {
    if (effects.length === 0) return;
    const now = performance.now();
    for (const effect of effects) {
      this.active.push({ effect, start: now, dur: effect.dur ?? 320 });
    }
    if (this.rafId === 0) this.tick();
  }

  private tick = (): void => {
    const now = performance.now();
    this.active = this.active.filter((a) => now - a.start < a.dur);
    if (this.lastScene) this.draw(this.lastScene);
    if (this.active.length === 0) {
      this.rafId = 0;
      return;
    }
    this.drawEffects(now);
    this.rafId = requestAnimationFrame(this.tick);
  };

  private drawEffects(now: number): void {
    const cellW = Math.ceil(this.ctx.measureText('M').width);
    let quakeX = 0;
    let quakeY = 0;
    for (const { effect, start, dur } of this.active) {
      const t = Math.min(1, (now - start) / dur);
      const ease = 1 - t;
      switch (effect.kind) {
        case 'float': {
          const alpha = t < 0.7 ? 1 : (1 - t) / 0.3;
          this.ctx.globalAlpha = alpha;
          this.ctx.fillStyle = effect.color;
          this.ctx.font = 'bold 15px Consolas, "Courier New", monospace';
          const px = effect.x * cellW + cellW / 2;
          const py = effect.y * CELL_H + CELL_H / 2 - 26 * t;
          this.ctx.fillText(effect.text, px, py);
          this.ctx.globalAlpha = 1;
          break;
        }
        case 'flash': {
          this.ctx.globalAlpha = 0.55 * ease;
          this.ctx.fillStyle = effect.color;
          this.ctx.fillRect(effect.x * cellW, effect.y * CELL_H, cellW, CELL_H);
          this.ctx.globalAlpha = 1;
          break;
        }
        case 'burst': {
          this.ctx.globalAlpha = ease;
          this.ctx.fillStyle = effect.color;
          const cx = effect.x * cellW + cellW / 2;
          const cy = effect.y * CELL_H + CELL_H / 2;
          const radius = 4 + 18 * t;
          for (let i = 0; i < 8; i++) {
            const angle = (Math.PI / 4) * i + t * 2;
            const px = cx + Math.cos(angle) * radius;
            const py = cy + Math.sin(angle) * radius * 0.8;
            this.ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
          }
          this.ctx.globalAlpha = 1;
          break;
        }
        case 'quake': {
          const mag = 5 * ease;
          quakeX += (Math.random() - 0.5) * 2 * mag;
          quakeY += (Math.random() - 0.5) * 2 * mag;
          break;
        }
        case 'flashScreen': {
          this.ctx.globalAlpha = 0.35 * ease;
          this.ctx.fillStyle = effect.color;
          this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
          this.ctx.globalAlpha = 1;
          break;
        }
      }
    }
    if (quakeX !== 0 || quakeY !== 0) {
      // 震动只影响视觉呈现，不破坏画布内部坐标
      const style = this.canvas.style;
      style.transform = `translate(${quakeX.toFixed(1)}px, ${quakeY.toFixed(1)}px)`;
      if (this.active.every((a) => a.effect.kind !== 'quake')) {
        window.setTimeout(() => {
          style.transform = '';
        }, 60);
      }
    } else {
      this.canvas.style.transform = '';
    }
  }

  draw(scene: Scene): void {
    this.lastScene = scene;
    const { map, visible, explored } = scene;
    this.ctx.font = FONT;
    const cellW = Math.ceil(this.ctx.measureText('M').width);
    const widthPx = map.width * cellW;
    const heightPx = map.height * CELL_H;

    // 按 DPR 放大画布，高分屏上文字依然锐利
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== widthPx * dpr || this.canvas.height !== heightPx * dpr) {
      this.canvas.width = widthPx * dpr;
      this.canvas.height = heightPx * dpr;
      this.canvas.style.width = `${widthPx}px`;
      this.canvas.style.height = `${heightPx}px`;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const theme = themeFor(scene.depth);
    this.ctx.fillStyle = theme.bg;
    this.ctx.fillRect(0, 0, widthPx, heightPx);
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const key = `${x},${y}`;
        if (!visible.has(key) && !explored.has(key)) continue;
        const tile = map.tileAt(x, y);
        const lit = visible.has(key);
        const tileColor = tile === 'wall' ? theme.wall : theme.floor;
        this.drawGlyph(x, y, cellW, TILE_GLYPH[tile], lit ? tileColor : dimColor(tileColor, theme.bg));
      }
    }

    // 标记（楼梯）属于地形记忆，探索过就一直显示
    for (const m of scene.markers) {
      if (explored.has(`${m.x},${m.y}`)) {
        this.drawGlyph(m.x, m.y, cellW, m.glyph, explored.has(`${m.x},${m.y}`) && visible.has(`${m.x},${m.y}`) ? m.color : dimColor(m.color, theme.bg));
      }
    }
    // 物品与角色只在当前视野内出现
    for (const it of scene.items) {
      if (visible.has(`${it.x},${it.y}`)) this.drawGlyph(it.x, it.y, cellW, it.glyph, it.color);
    }
    for (const a of scene.actors) {
      if (visible.has(`${a.x},${a.y}`)) this.drawGlyph(a.x, a.y, cellW, a.glyph, a.color);
    }

    if (scene.dead) {
      this.ctx.fillStyle = 'rgba(40, 8, 8, 0.72)';
      this.ctx.fillRect(0, 0, widthPx, heightPx);
      this.ctx.fillStyle = '#d96a5a';
      this.ctx.font = 'bold 48px Consolas, "Courier New", monospace';
      this.ctx.fillText('你死了', widthPx / 2, heightPx / 2 - 20);
      this.ctx.font = '16px Consolas, "Courier New", monospace';
      this.ctx.fillStyle = '#aab4c4';
      const s = scene.stats;
      if (s) {
        this.ctx.fillText(
          `第 ${s.depth} 层 · 存活 ${s.turn} 回合 · 等级 ${s.level} · 击杀 ${s.kills}`,
          widthPx / 2,
          heightPx / 2 + 24,
        );
        this.ctx.fillText(`死因：${s.cause}`, widthPx / 2, heightPx / 2 + 48);
        this.ctx.fillText('按 R 重新开始', widthPx / 2, heightPx / 2 + 76);
      } else {
        this.ctx.fillText('按 R 重新开始', widthPx / 2, heightPx / 2 + 24);
      }
    }
  }

  private drawGlyph(x: number, y: number, cellW: number, glyph: string, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillText(glyph, x * cellW + cellW / 2, y * CELL_H + CELL_H / 2);
  }
}

/**
 * 小地图：每格 2px，展示探索进度、楼梯方位与可见生物。
 * 约定：scene.actors[0] 是玩家（Game.render 已保证）。
 */
export function drawMinimap(target: HTMLCanvasElement, scene: Scene): void {
  const ctx = target.getContext('2d');
  if (!ctx) return;
  const s = 2;
  const w = scene.map.width * s;
  const h = scene.map.height * s;
  if (target.width !== w || target.height !== h) {
    target.width = w;
    target.height = h;
  }
  ctx.fillStyle = '#07090d';
  ctx.fillRect(0, 0, w, h);

  for (let y = 0; y < scene.map.height; y++) {
    for (let x = 0; x < scene.map.width; x++) {
      const key = `${x},${y}`;
      const lit = visibleOf(scene, key);
      if (!lit && !scene.explored.has(key)) continue;
      const isFloor = scene.map.isWalkable(x, y);
      ctx.fillStyle = lit
        ? isFloor
          ? '#4a5568'
          : '#2a3140'
        : isFloor
          ? '#252c3a'
          : '#161b26';
      ctx.fillRect(x * s, y * s, s, s);
    }
  }

  for (const m of scene.markers) {
    if (scene.explored.has(`${m.x},${m.y}`)) {
      ctx.fillStyle = m.color;
      ctx.fillRect(m.x * s - 1, m.y * s - 1, s + 1, s + 1);
    }
  }
  for (const it of scene.items) {
    if (visibleOf(scene, `${it.x},${it.y}`)) {
      ctx.fillStyle = it.color;
      ctx.fillRect(it.x * s, it.y * s, s, s);
    }
  }
  const player = scene.actors[0];
  for (const a of scene.actors.slice(1)) {
    if (visibleOf(scene, `${a.x},${a.y}`)) {
      ctx.fillStyle = '#d96a5a';
      ctx.fillRect(a.x * s, a.y * s, s, s);
    }
  }
  if (player) {
    ctx.fillStyle = '#f5b04c';
    ctx.fillRect(player.x * s - 1, player.y * s - 1, s + 1, s + 1);
  }
}

function visibleOf(scene: Scene, key: string): boolean {
  return scene.visible.has(key);
}
