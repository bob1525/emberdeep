import type { GameMap } from '../world/map';

/** 场景中任意一个待绘制的字符（角色可带血条数据） */
export interface Glyph {
  x: number;
  y: number;
  glyph: string;
  color: string;
  hp?: number;
  maxHp?: number;
}

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
  /** 地形标记（楼梯/陷阱），已探索即可见 */
  markers: Glyph[];
  /** 地面物品，仅当前可见时绘制 */
  items: Glyph[];
  /** 角色（玩家 + 怪物），仅当前可见时绘制；玩家必须排第一 */
  actors: Glyph[];
  /** 玩家死亡时叠加暗红遮罩与统计 */
  dead?: boolean;
  stats?: DeathStats;
}

/** 短时视觉效果 */
export type Effect =
  | { kind: 'float'; x: number; y: number; text: string; color: string; dur?: number }
  | { kind: 'flash'; x: number; y: number; color: string; dur?: number }
  | { kind: 'burst'; x: number; y: number; color: string; dur?: number }
  | { kind: 'quake'; dur?: number }
  | { kind: 'flashScreen'; color: string; dur?: number }
  /** 角色从 (fromX,fromY) 滑行到 (toX,toY) */
  | { kind: 'step'; fromX: number; fromY: number; toX: number; toY: number; glyph: string; color: string; dur?: number }
  /** 攻击突进：向 (dx,dy) 顶一下再收回 */
  | { kind: 'lunge'; x: number; y: number; dx: number; dy: number; glyph: string; color: string; dur?: number };

interface ActiveEffect {
  effect: Effect;
  start: number;
  dur: number;
}

/** 楼层主题：每 5 层换一次氛围 */
interface Theme {
  bg: string;
  wall: string;
  floor: string;
}

const THEMES: Theme[] = [
  { bg: '#0b0e14', wall: '#5a6474', floor: '#3d4554' }, // 1-4 余烬灰
  { bg: '#0a0d13', wall: '#52709a', floor: '#33445e' }, // 5-9 寒渊蓝
  { bg: '#0d0a13', wall: '#7366a0', floor: '#41395e' }, // 10-14 幽暗紫
  { bg: '#130a08', wall: '#9a6552', floor: '#5c392f' }, // 15+ 熔核红
];

function themeFor(depth: number): Theme {
  return THEMES[Math.min(THEMES.length - 1, Math.floor((depth - 1) / 5))] as Theme;
}

/** hex → [r,g,b] */
function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** 把颜色向背景压暗（factor=1 原色，0 全黑） */
function shade(hex: string, bgHex: string, factor: number): string {
  const [r, g, b] = rgb(hex);
  const [br, bgG, bb] = rgb(bgHex);
  const mix = (c: number, base: number) => Math.round(c * factor + base * (1 - factor));
  return `rgb(${mix(r, br)}, ${mix(g, bgG)}, ${mix(b, bb)})`;
}

/** 确定性纹理哈希：同一格永远长一样 */
function tileHash(x: number, y: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return (h >>> 0) % 1000;
}

const WALL_GLYPHS = ['#', '▓', '▒'];
const FLOOR_GLYPHS = ['·', ',', '`'];
const FONT = '18px Consolas, "Courier New", monospace';
const CELL_H = 20;
const BG = '#0b0e14';

/** 字符画渲染器：纹理变化 + 火把光衰减 + 打击感动画 + 暗角氛围 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private lastScene: Scene | null = null;
  private active: ActiveEffect[] = [];
  private lastW = 0;
  private lastH = 0;
  private lastDpr = 0;
  private vignette: CanvasGradient | null = null;
  private vignetteKey = '';
  /** 记忆层离屏缓存：只有 explored 变化/换层/尺寸变化时才重绘 */
  private staticLayer: HTMLCanvasElement | null = null;
  private staticKey = '';

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D 上下文不可用');
    this.ctx = ctx;
    // 常驻动画循环：待机时低频呼吸（火光摇曳/楼梯脉动），效果期间逐帧
    requestAnimationFrame(this.loop);
  }

  private loop = (now: number): void => {
    const effectsActive = this.active.length > 0;
    if (effectsActive || now - this.lastFrame >= 110) {
      this.lastFrame = now;
      if (this.lastScene) {
        this.active = this.active.filter((a) => now - a.start < a.dur);
        this.drawNow(this.lastScene, now);
        if (this.active.length > 0) this.drawEffects(now);
      }
    }
    requestAnimationFrame(this.loop);
  };

  private lastFrame = 0;

  /** 渲染一帧静态场景（外部主动调用；动画循环也会用它重绘） */
  draw(scene: Scene): void {
    this.lastScene = scene;
    this.drawNow(scene, performance.now());
  }

  /** 入队一批效果（移动/攻击/伤害数字等），由动画循环播放 */
  playEffects(effects: Effect[]): void {
    const now = performance.now();
    for (const effect of effects) {
      this.active.push({ effect, start: now, dur: effect.dur ?? 320 });
    }
  }

  // ---------- 核心绘制 ----------

  private drawNow(scene: Scene, now: number): void {
    const { map, visible, explored } = scene;
    this.ctx.font = FONT;
    const cellW = Math.ceil(this.ctx.measureText('M').width);
    const widthPx = map.width * cellW;
    const heightPx = map.height * CELL_H;

    // DPR 放大（只在尺寸真正变化时重设，避免反复清屏）
    const dpr = window.devicePixelRatio || 1;
    if (this.lastW !== widthPx || this.lastH !== heightPx || this.lastDpr !== dpr) {
      this.lastW = widthPx;
      this.lastH = heightPx;
      this.lastDpr = dpr;
      this.canvas.width = Math.round(widthPx * dpr);
      this.canvas.height = Math.round(heightPx * dpr);
      this.canvas.style.width = `${widthPx}px`;
      this.canvas.style.height = `${heightPx}px`;
      this.vignette = null;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const theme = themeFor(scene.depth);
    this.ctx.fillStyle = theme.bg;
    this.ctx.fillRect(0, 0, widthPx, heightPx);
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    // 记忆层（explored 的暗色地形）走离屏缓存，每帧一次 drawImage
    const staticKey = `${scene.depth}:${scene.explored.size}:${cellW}`;
    if (this.staticKey !== staticKey || !this.staticLayer) {
      this.renderStaticLayer(scene, cellW, theme);
      this.staticKey = staticKey;
    }
    if (this.staticLayer) {
      this.ctx.drawImage(this.staticLayer, 0, 0);
    }

    const player = scene.actors[0];
    const flicker =
      Math.sin(now / 95) * 0.02 + Math.sin(now / 37 + 1.3) * 0.015;

    // 可见层：火把光衰减，每帧动态计算（只有 ~FOV 半径内的格子）
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const key = `${x},${y}`;
        if (!visible.has(key)) continue;
        const tile = map.tileAt(x, y);
        const h = tileHash(x, y);
        const glyph =
          tile === 'wall' ? (WALL_GLYPHS[h % 3] ?? '#') : (FLOOR_GLYPHS[h % 3] ?? '·');
        const baseColor = tile === 'wall' ? theme.wall : theme.floor;
        const dist = player ? Math.hypot(x - player.x, y - player.y) : 0;
        const falloff = Math.max(0.5, 1 - (dist / 12) * 0.42 + flicker);
        // 先用背景色覆盖记忆层的暗色字形，再画亮的
        this.ctx.fillStyle = theme.bg;
        this.ctx.fillRect(x * cellW, y * CELL_H, cellW, CELL_H);
        this.drawGlyph(x, y, cellW, glyph, shade(baseColor, theme.bg, falloff));
      }
    }

    // 标记（楼梯/陷阱）：楼梯带金色呼吸
    for (const m of scene.markers) {
      const key = `${m.x},${m.y}`;
      if (!explored.has(key)) continue;
      const lit = visible.has(key);
      let color = lit ? m.color : shade(m.color, theme.bg, 0.45);
      if (m.glyph === '>') {
        const pulse = 0.75 + 0.25 * Math.sin(now / 320);
        color = shade(m.color, theme.bg, lit ? pulse : 0.45 * pulse);
      }
      this.drawGlyph(m.x, m.y, cellW, m.glyph, color);
    }

    for (const it of scene.items) {
      if (visible.has(`${it.x},${it.y}`)) this.drawGlyph(it.x, it.y, cellW, it.glyph, it.color);
    }
    for (const a of scene.actors) {
      if (!visible.has(`${a.x},${a.y}`)) continue;
      // 玩家轻微呼吸亮度
      const isPlayer = a === scene.actors[0];
      const color = isPlayer ? shade(a.color, theme.bg, 0.9 + 0.1 * Math.sin(now / 500)) : a.color;
      this.drawGlyph(a.x, a.y, cellW, a.glyph, color);
      this.drawHpBar(a, cellW);
    }

    if (scene.dead) this.drawDeath(scene, widthPx, heightPx);

    this.drawVignette(widthPx, heightPx);
  }

  private drawGlyph(x: number, y: number, cellW: number, glyph: string, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillText(glyph, x * cellW + cellW / 2, y * CELL_H + CELL_H / 2);
  }

  /** 离屏缓存层：背景 + 记忆中的暗色地形（不含可见层与任何动态元素） */
  private renderStaticLayer(scene: Scene, cellW: number, theme: Theme): void {
    const layer = this.staticLayer ?? document.createElement('canvas');
    this.staticLayer = layer;
    layer.width = scene.map.width * cellW;
    layer.height = scene.map.height * CELL_H;
    const sctx = layer.getContext('2d');
    if (!sctx) return;
    sctx.fillStyle = theme.bg;
    sctx.fillRect(0, 0, layer.width, layer.height);
    sctx.font = FONT;
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    for (let y = 0; y < scene.map.height; y++) {
      for (let x = 0; x < scene.map.width; x++) {
        const key = `${x},${y}`;
        if (!scene.explored.has(key) || scene.visible.has(key)) continue;
        const tile = scene.map.tileAt(x, y);
        const h = tileHash(x, y);
        const glyph =
          tile === 'wall' ? (WALL_GLYPHS[h % 3] ?? '#') : (FLOOR_GLYPHS[h % 3] ?? '·');
        const baseColor = tile === 'wall' ? theme.wall : theme.floor;
        sctx.fillStyle = shade(baseColor, theme.bg, 0.32);
        sctx.fillText(glyph, x * cellW + cellW / 2, y * CELL_H + CELL_H / 2);
      }
    }
  }

  private drawHpBar(a: Glyph, cellW: number): void {
    if (a.hp === undefined || a.maxHp === undefined || a.maxHp <= 0) return;
    if (a.hp >= a.maxHp) return;
    const ratio = Math.max(0, Math.min(1, a.hp / a.maxHp));
    const barW = cellW - 2;
    const px = a.x * cellW + 1;
    const py = a.y * CELL_H + 1;
    this.ctx.fillStyle = '#3a1420';
    this.ctx.fillRect(px, py, barW, 2);
    this.ctx.fillStyle = '#d96a5a';
    this.ctx.fillRect(px, py, Math.max(1, Math.round(barW * ratio)), 2);
  }

  private drawDeath(scene: Scene, widthPx: number, heightPx: number): void {
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

  /** CRT 暗角：边缘渐暗，营造深渊氛围 */
  private drawVignette(widthPx: number, heightPx: number): void {
    const key = `${widthPx}x${heightPx}`;
    if (!this.vignette || this.vignetteKey !== key) {
      const g = this.ctx.createRadialGradient(
        widthPx / 2,
        heightPx / 2,
        Math.min(widthPx, heightPx) * 0.35,
        widthPx / 2,
        heightPx / 2,
        Math.max(widthPx, heightPx) * 0.72,
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.5)');
      this.vignette = g;
      this.vignetteKey = key;
    }
    this.ctx.fillStyle = this.vignette;
    this.ctx.fillRect(0, 0, widthPx, heightPx);
  }

  // ---------- 效果层 ----------

  private drawEffects(now: number): void {
    this.ctx.font = FONT;
    const cellW = Math.ceil(this.ctx.measureText('M').width);
    const bg = this.lastScene ? themeFor(this.lastScene.depth).bg : BG;
    let quakeX = 0;
    let quakeY = 0;
    let quaking = false;

    for (const { effect, start, dur } of this.active) {
      const t = Math.min(1, (now - start) / dur);
      const ease = 1 - t;
      switch (effect.kind) {
        case 'float': {
          this.ctx.globalAlpha = t < 0.7 ? 1 : (1 - t) / 0.3;
          this.ctx.fillStyle = effect.color;
          this.ctx.font = 'bold 15px Consolas, "Courier New", monospace';
          this.ctx.fillText(
            effect.text,
            effect.x * cellW + cellW / 2,
            effect.y * CELL_H + CELL_H / 2 - 26 * t,
          );
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
            this.ctx.fillRect(
              cx + Math.cos(angle) * radius - 1.5,
              cy + Math.sin(angle) * radius * 0.8 - 1.5,
              3,
              3,
            );
          }
          this.ctx.globalAlpha = 1;
          break;
        }
        case 'quake': {
          quaking = true;
          const mag = 5 * ease;
          quakeX += (Math.random() - 0.5) * 2 * mag;
          quakeY += (Math.random() - 0.5) * 2 * mag;
          break;
        }
        case 'flashScreen': {
          this.ctx.globalAlpha = 0.35 * ease;
          this.ctx.fillStyle = effect.color;
          this.ctx.fillRect(0, 0, this.lastW, this.lastH);
          this.ctx.globalAlpha = 1;
          break;
        }
        case 'step': {
          // 滑行：擦掉终点格再画在插值位置
          this.ctx.fillStyle = bg;
          this.ctx.fillRect(effect.toX * cellW, effect.toY * CELL_H, cellW, CELL_H);
          const ease2 = 1 - (1 - t) * (1 - t); // easeOutQuad
          const px = (effect.fromX + (effect.toX - effect.fromX) * ease2) * cellW + cellW / 2;
          const py = (effect.fromY + (effect.toY - effect.fromY) * ease2) * CELL_H + CELL_H / 2;
          this.ctx.fillStyle = effect.color;
          this.ctx.fillText(effect.glyph, px, py);
          break;
        }
        case 'lunge': {
          // 攻击突进：向目标方向顶 0.35 格再收回
          this.ctx.fillStyle = bg;
          this.ctx.fillRect(effect.x * cellW, effect.y * CELL_H, cellW, CELL_H);
          const offset = Math.sin(Math.PI * t) * 0.35;
          const px = (effect.x + effect.dx * offset) * cellW + cellW / 2;
          const py = (effect.y + effect.dy * offset) * CELL_H + CELL_H / 2;
          this.ctx.fillStyle = effect.color;
          this.ctx.fillText(effect.glyph, px, py);
          break;
        }
      }
    }

    if (quaking) {
      this.canvas.style.transform = `translate(${quakeX.toFixed(1)}px, ${quakeY.toFixed(1)}px)`;
    } else if (this.canvas.style.transform) {
      this.canvas.style.transform = '';
    }
  }
}

/**
 * 小地图：每格 2px，展示探索进度、楼梯方位与可见生物。
 * 约定：scene.actors[0] 是玩家（Game.buildScene 已保证）。
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
  const theme = themeFor(scene.depth);
  ctx.fillStyle = '#07090d';
  ctx.fillRect(0, 0, w, h);

  for (let y = 0; y < scene.map.height; y++) {
    for (let x = 0; x < scene.map.width; x++) {
      const key = `${x},${y}`;
      const lit = scene.visible.has(key);
      if (!lit && !scene.explored.has(key)) continue;
      const isFloor = scene.map.isWalkable(x, y);
      const base = isFloor ? theme.floor : theme.wall;
      ctx.fillStyle = lit ? base : shade(base, '#07090d', 0.45);
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
    if (scene.visible.has(`${it.x},${it.y}`)) {
      ctx.fillStyle = it.color;
      ctx.fillRect(it.x * s, it.y * s, s, s);
    }
  }
  const player = scene.actors[0];
  for (const a of scene.actors.slice(1)) {
    if (scene.visible.has(`${a.x},${a.y}`)) {
      ctx.fillStyle = '#d96a5a';
      ctx.fillRect(a.x * s, a.y * s, s, s);
    }
  }
  if (player) {
    ctx.fillStyle = '#f5b04c';
    ctx.fillRect(player.x * s - 1, player.y * s - 1, s + 1, s + 1);
  }
}
