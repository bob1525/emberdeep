import './style.css';
import { Game } from './game';
import { bindInput } from './engine/input';
import { Renderer } from './ui/renderer';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
const statusEl = document.querySelector<HTMLDivElement>('#status');
const logEl = document.querySelector<HTMLDivElement>('#log');
if (!canvas || !statusEl || !logEl) throw new Error('页面结构不完整');

const game = new Game(new Renderer(canvas));

game.onChange = () => {
  statusEl.textContent = `回合 ${game.turn} · HP ${game.player.hp}/${game.player.maxHp}`;
  logEl.replaceChildren(
    ...game.recentLog().map((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      return p;
    }),
  );
};

game.start();
bindInput((action) => game.handleAction(action));
