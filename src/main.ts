import './style.css';
import { Game } from './game';
import { bindInput, bindTouch, type Action } from './engine/input';
import { Renderer } from './ui/renderer';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
const minimapCanvas = document.querySelector<HTMLCanvasElement>('#minimap');
const statusEl = document.querySelector<HTMLDivElement>('#status');
const logEl = document.querySelector<HTMLDivElement>('#log');
if (!canvas || !statusEl || !logEl) throw new Error('页面结构不完整');

const renderer = new Renderer(canvas);
const saved = Game.readSave();
const game = new Game(renderer, undefined, saved);

game.onChange = () => {
  statusEl.textContent =
    `第 ${game.depth} 层 · 回合 ${game.turn} · HP ${game.player.hp}/${game.player.maxHp} · ` +
    `攻 ${game.effectiveAttack()} · 防 ${game.effectiveDefense()} · ` +
    `等级 ${game.level} · 经验 ${game.xp}/${game.xpToNext()}`;
  logEl.replaceChildren(
    ...game.recentLog().map((entry) => {
      const p = document.createElement('p');
      p.textContent = entry.text;
      p.dataset.tone = entry.tone;
      return p;
    }),
  );
  if (minimapCanvas) game.drawMinimapTo(minimapCanvas);
  renderer.playEffects(game.takeEffects());
};

game.start();
bindInput((action) => game.handleAction(action));
bindTouch(canvas, (action) => game.handleAction(action));

// 触屏动作按钮（桌面端由 CSS 隐藏）
const TOUCH_ACTIONS: Record<string, Action> = {
  pickup: { type: 'pickup' },
  quaff: { type: 'quaff' },
  teleport: { type: 'useScroll', scroll: 'teleport' },
  fireblast: { type: 'useScroll', scroll: 'fireblast' },
  descend: { type: 'descend' },
  toggleMute: { type: 'toggleMute' },
  restart: { type: 'restart' },
};
for (const button of document.querySelectorAll<HTMLButtonElement>('#touch-actions button')) {
  const act = TOUCH_ACTIONS[button.dataset.act ?? ''];
  if (act) button.addEventListener('click', () => game.handleAction({ ...act }));
}
