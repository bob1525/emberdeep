import './style.css';
import { Game } from './game';
import { bindInput, bindTouch, type Action } from './engine/input';
import { STATUSES } from './engine/statuses';
import type { StatusKind } from './engine/statuses';
import { startAmbient } from './engine/audio';
import { RANGED } from './engine/ranged';
import { rarityColor } from './items/affixes';
import { itemDef } from './items/catalog';
import { CLASSES } from './entities/classes';
import type { ClassId } from './entities/classes';
import { TALENTS } from './entities/talents';
import { Renderer } from './ui/renderer';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
const minimapCanvas = document.querySelector<HTMLCanvasElement>('#minimap');
const statusEl = document.querySelector<HTMLDivElement>('#status');
const logEl = document.querySelector<HTMLDivElement>('#log');
const overlayEl = document.querySelector<HTMLDivElement>('#overlay');
if (!canvas || !statusEl || !logEl || !overlayEl) throw new Error('页面结构不完整');

const renderer = new Renderer(canvas);
// URL 支持：?seed=12345（复现同一条地牢）或 ?daily（每日挑战，按日期固定种子）
const params = new URLSearchParams(window.location.search);
const dailySeed = Number.parseInt(
  new Date().toISOString().slice(0, 10).replace(/-/g, ''),
  10,
);
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const fixedSeed =
  Number.isFinite(seedParam) && seedParam > 0
    ? seedParam
    : params.has('daily') && Number.isFinite(dailySeed)
      ? dailySeed
      : undefined;
// 从标题画面开始；"继续"由玩家在菜单里选择。
// 无固定种子时用环境熵生成起始种子；有则每局完全一致（P1-11 种子语义）
const game = new Game(
  renderer,
  fixedSeed ?? ((Date.now() % 2147483647) || 1),
  undefined,
  { fixedSeed: fixedSeed !== undefined },
);

game.onChange = () => {
  const statusTags = game.player.statuses
    .map((s) => STATUSES[s.kind as StatusKind]?.name ?? s.kind)
    .join('·');
  const skillDef = CLASSES[game.classId as ClassId]?.skill;
  const skillRemain = game.skillRemaining();
  const skillText = skillDef
    ? ` · ${skillDef.name}${skillRemain > 0 ? `(${skillRemain})` : '(就绪)'}` +
      (skillRemain > 0 ? '' : ' k')
    : '';
  statusEl.textContent =
    `第 ${game.depth} 层 · 回合 ${game.turn} · HP ${game.player.hp}/${game.player.maxHp} · ` +
    `攻 ${game.effectiveAttack()} · 防 ${game.effectiveDefense()} · ` +
    `等级 ${game.level} · 经验 ${game.xp}/${game.xpToNext()} · ` +
    `金币 ${game.gold}` +
    skillText +
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

const ASCII_LOGO = [
  ' ███████╗███╗   ███╗██████╗ ███████╗██████╗ ██████╗ ███████╗██████╗ ',
  ' ██╔════╝████╗ ████║██╔══██╗██╔════╝██╔══██╗██╔══██╗██╔════╝██╔══██╗',
  ' █████╗  ██╔████╔██║██████╔╝█████╗  ██████╔╝██║  ██║█████╗  ██████╔╝',
  ' ██╔══╝  ██║╚██╔╝██║██╔══██╗██╔══╝  ██╔══██╗██║  ██║██╔══╝  ██╔══██╗',
  ' ███████╗██║ ╚═╝ ██║██████╔╝███████╗██║  ██║██████╔╝███████╗██║  ██║',
  ' ╚══════╝╚═╝     ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝',
].join('\n');

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
    const logo = document.createElement('pre');
    logo.className = 'ascii-logo';
    logo.textContent = ASCII_LOGO;
    const tagline = document.createElement('p');
    tagline.className = 'tagline';
    tagline.textContent = '余烬深渊 · 浏览器 Roguelike';
    panel.append(logo, tagline);
    if (fixedSeed !== undefined) {
      panel.append(hint(`固定种子 ${game.seed()} — 同一种子，同一座地牢`));
    }
    panel.append(option('[Enter] 新的冒险', '深入随机生成的地牢，死亡即失去一切'));
    if (Game.readSave() !== null) {
      panel.append(option('[C] 继续上局', '从停下的地方继续'));
    }
    panel.append(hint('移动 方向键/WASD/hjkl · 斜向 yubn · 撞向敌人即攻击'));
    panel.append(hint('g 捡拾 · q 喝药 · i 背包 · ? 消息 · > 下楼 · m 静音'));
  } else if (game.mode === 'classSelect') {
    const heading = document.createElement('h3');
    heading.textContent = '选择你的职业';
    panel.append(heading);
    const order: ClassId[] = ['warrior', 'ranger', 'mage'];
    for (let i = 0; i < order.length; i++) {
      const cls = CLASSES[order[i] as ClassId];
      if (!cls) continue;
      panel.append(
        option(
          `[${i + 1}] ${cls.name}`,
          `HP ${cls.baseHp} · 攻 ${cls.baseAttack} · 防 ${cls.baseDefense} · 技能「${cls.skill.name}」`,
        ),
      );
    }
    panel.append(hint('Esc 返回标题'));
  } else if (game.mode === 'inventory') {
    const heading = document.createElement('h3');
    heading.textContent = '背包';
    panel.append(heading);
    const inventory = game.player.inventory;
    if (inventory.length === 0) {
      panel.append(hint('（空空如也）'));
    } else {
      inventory.forEach((item, i) => {
        const info =
          item.category === 'ranged' ? RANGED[item.catalogId] : itemDef(item);
        const equipped =
          game.player.equipment.weapon?.uid === item.uid
            ? '（已装备）'
            : game.player.equipment.armor?.uid === item.uid
              ? '（已装备）'
              : '';
        const description =
          item.category === 'ranged'
            ? '远程武器（z 键射击）'
            : ((info as { description?: string } | null)?.description ?? '');
        const row = document.createElement('p');
        row.textContent = `${i + 1}. ${game.itemDisplayName(item)}${equipped} — ${description}`;
        row.style.color = rarityColor(game.itemAffix(item));
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
  } else if (game.mode === 'targeting') {
    const heading = document.createElement('h3');
    heading.textContent = '射击';
    panel.append(heading);
    panel.append(hint('方向键 / yubn 选择方向 · Esc 取消'));
  } else if (game.mode === 'shop') {
    const heading = document.createElement('h3');
    heading.textContent = `流浪商人 · 你的金币 ${game.gold}`;
    panel.append(heading);
    const merchantStock = game.merchantStock();
    if (merchantStock.length === 0) {
      panel.append(hint('（货架已空）'));
    } else {
      merchantStock.forEach((entry, i) => {
        const row = document.createElement('p');
        const name =
          entry.category === 'ranged'
            ? (RANGED[entry.catalogId]?.name ?? entry.catalogId)
            : (itemDef({ uid: 0, catalogId: entry.catalogId, category: entry.category })?.name ??
              entry.catalogId);
        row.textContent = `${i + 1}. ${name} — ${entry.price} 金币`;
        panel.append(row);
      });
    }
    panel.append(hint('数字 购买 · Shift+数字 出售背包物品 · Esc 离开'));
  } else if (game.mode === 'levelUp') {
    const heading = document.createElement('h3');
    heading.textContent = `升级！选择一项天赋（等级 ${game.level}）`;
    panel.append(heading);
    const rarityColorTalent: Record<string, string> = {
      common: '#c0c8d4',
      rare: '#6fb3e0',
      epic: '#c678dd',
    };
    game.talentChoices.forEach((id, i) => {
      const def = TALENTS.find((t) => t.id === id);
      const row = document.createElement('p');
      row.textContent = `${i + 1}. ${def?.name ?? id} — ${def?.description ?? ''}`;
      row.style.color = rarityColorTalent[def?.rarity ?? 'common'] ?? '#c0c8d4';
      panel.append(row);
    });
    panel.append(hint('数字键选择 · 天赋立即生效'));
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

// 首次用户手势启动环境低音（浏览器自动播放策略）
const startAmbientOnce = (): void => {
  startAmbient();
  window.removeEventListener('keydown', startAmbientOnce);
  window.removeEventListener('touchstart', startAmbientOnce);
};
window.addEventListener('keydown', startAmbientOnce, { once: true });
window.addEventListener('touchstart', startAmbientOnce, { once: true });

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
