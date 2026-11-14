import './style.css';
import { Game } from './game';
import { bindInput, bindTouch, type Action } from './engine/input';
import { STATUSES } from './engine/statuses';
import type { StatusKind } from './engine/statuses';
import { itemDef } from './items/catalog';
import { Renderer } from './ui/renderer';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
const minimapCanvas = document.querySelector<HTMLCanvasElement>('#minimap');
const statusEl = document.querySelector<HTMLDivElement>('#status');
const logEl = document.querySelector<HTMLDivElement>('#log');
const overlayEl = document.querySelector<HTMLDivElement>('#overlay');
if (!canvas || !statusEl || !logEl || !overlayEl) throw new Error('页面结构不完整');

const renderer = new Renderer(canvas);
// 从标题画面开始；"继续"由玩家在菜单里选择
const game = new Game(renderer);

game.onChange = () => {
  const statusTags = game.player.statuses
    .map((s) => STATUSES[s.kind as StatusKind]?.name ?? s.kind)
    .join('·');
  statusEl.textContent =
    `第 ${game.depth} 层 · 回合 ${game.turn} · HP ${game.player.hp}/${game.player.maxHp} · ` +
    `攻 ${game.effectiveAttack()} · 防 ${game.effectiveDefense()} · ` +
    `等级 ${game.level} · 经验 ${game.xp}/${game.xpToNext()}` +
    (statusTags ? ` · 【${statusTags}】` : '');
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
  renderOverlay();
};

// ---------- 覆盖层（标题 / 背包 / 消息历史） ----------

function renderOverlay(): void {
  if (!overlayEl) return;
  if (game.mode === 'play') {
    overlayEl.hidden = true;
    overlayEl.replaceChildren();
    return;
  }
  overlayEl.hidden = false;
  const panel = document.createElement('div');
  panel.className = 'panel';

  if (game.mode === 'title') {
    const title = document.createElement('h2');
    title.textContent = 'EMBERDEEP';
    const tagline = document.createElement('p');
    tagline.className = 'tagline';
    tagline.textContent = '余烬深渊 · 浏览器 Roguelike';
    panel.append(title, tagline);
    panel.append(option('[Enter] 新的冒险', '深入随机生成的地牢，死亡即失去一切'));
    if (Game.readSave() !== null) {
      panel.append(option('[C] 继续上局', '从停下的地方继续'));
    }
    panel.append(hint('移动 方向键/WASD/hjkl · 斜向 yubn · 撞向敌人即攻击'));
    panel.append(hint('g 捡拾 · q 喝药 · i 背包 · ? 消息 · > 下楼 · m 静音'));
  } else if (game.mode === 'inventory') {
    const heading = document.createElement('h3');
    heading.textContent = '背包';
    panel.append(heading);
    const inventory = game.player.inventory;
    if (inventory.length === 0) {
      panel.append(hint('（空空如也）'));
    } else {
      inventory.forEach((item, i) => {
        const def = itemDef(item);
        const equipped =
          game.player.equipment.weapon?.uid === item.uid
            ? '（已装备）'
            : game.player.equipment.armor?.uid === item.uid
              ? '（已装备）'
              : '';
        const row = document.createElement('p');
        row.textContent = `${i + 1}. ${def.name}${equipped} — ${def.description}`;
        panel.append(row);
      });
    }
    panel.append(hint('数字 使用/装备 · Shift+数字 丢弃 · i / Esc 返回'));
  } else if (game.mode === 'log') {
    const heading = document.createElement('h3');
    heading.textContent = '消息记录';
    panel.append(heading);
    const cursor = game.logCursor ?? game.allLog().length - 1;
    const from = Math.max(0, cursor - 15);
    for (let i = from; i <= cursor; i++) {
      const entry = game.allLog()[i];
      if (!entry) continue;
      const p = document.createElement('p');
      p.textContent = `${i === cursor ? '▸' : '　'} ${entry.text}`;
      p.dataset.tone = entry.tone;
      panel.append(p);
    }
    panel.append(hint('PgUp/PgDn 翻页 · Esc 返回'));
  }

  overlayEl.replaceChildren(panel);
}

function option(key: string, desc: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'opt';
  const k = document.createElement('strong');
  k.textContent = key;
  p.append(k, document.createTextNode(` ${desc}`));
  return p;
}

function hint(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = text;
  return p;
}

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
  inventory: { type: 'openInventory' },
};
for (const button of document.querySelectorAll<HTMLButtonElement>('#touch-actions button')) {
  const act = TOUCH_ACTIONS[button.dataset.act ?? ''];
  if (act) button.addEventListener('click', () => game.handleAction({ ...act }));
}
