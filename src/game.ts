import type { Action } from './engine/input';
import type { Glyph } from './ui/renderer';
import type { Renderer } from './ui/renderer';
import { createDemoMap } from './world/demoMap';
import type { GameMap } from './world/map';

export interface Player {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

const STAIRS = { x: 65, y: 33 };

/** 游戏状态与回合逻辑（Phase 3 会加入敌人回合） */
export class Game {
  map: GameMap = createDemoMap();
  player: Player = { x: 8, y: 8, hp: 30, maxHp: 30 };
  turn = 0;
  log: string[] = ['你在地牢深处醒来，余烬在墙上投下微光……'];

  /** 状态变化后由 main 注入的刷新回调 */
  onChange: (() => void) | null = null;

  constructor(private renderer: Renderer) {}

  start(): void {
    this.render();
    this.onChange?.();
  }

  handleAction(action: Action): void {
    let acted = false;
    if (action.type === 'wait') {
      acted = true;
    } else {
      acted = this.tryMove(action.dx, action.dy);
    }
    if (!acted) return;

    this.turn++;
    this.render();
    this.onChange?.();
  }

  recentLog(): string[] {
    return this.log.slice(-8);
  }

  /** 移动成功返回 true；撞墙不消耗回合 */
  private tryMove(dx: number, dy: number): boolean {
    const nx = this.player.x + dx;
    const ny = this.player.y + dy;
    if (!this.map.isWalkable(nx, ny)) return false;

    this.player.x = nx;
    this.player.y = ny;
    if (nx === STAIRS.x && ny === STAIRS.y) {
      this.log.push('一段向下的楼梯，深处传来热风——第 2 层还没建好（Phase 2）。');
    }
    return true;
  }

  private render(): void {
    const stairs: Glyph = { ...STAIRS, glyph: '>', color: '#c9a227' };
    const player: Glyph = { ...this.player, glyph: '@', color: '#f5b04c' };
    this.renderer.draw(this.map, [stairs], [player]);
  }
}
