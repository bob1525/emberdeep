import { TILE_COLOR, TILE_GLYPH } from '../world/tiles';
import type { GameMap } from '../world/map';

/** 场景中任意一个待绘制的字符 */
export interface Glyph {
  x: number;
  y: number;
  glyph: string;
  color: string;
}

const FONT = '18px Consolas, "Courier New", monospace';
const CELL_H = 20;

/** 字符画渲染器：整个画面就是一张大号字符表 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D 上下文不可用');
    this.ctx = ctx;
  }

  draw(map: GameMap, markers: Glyph[], entities: Glyph[]): void {
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

    this.ctx.fillStyle = '#0b0e14';
    this.ctx.fillRect(0, 0, widthPx, heightPx);
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.tileAt(x, y);
        this.drawGlyph(x, y, cellW, TILE_GLYPH[tile], TILE_COLOR[tile]);
      }
    }

    for (const m of markers) this.drawGlyph(m.x, m.y, cellW, m.glyph, m.color);
    for (const e of entities) this.drawGlyph(e.x, e.y, cellW, e.glyph, e.color);
  }

  private drawGlyph(x: number, y: number, cellW: number, glyph: string, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillText(glyph, x * cellW + cellW / 2, y * CELL_H + CELL_H / 2);
  }
}
