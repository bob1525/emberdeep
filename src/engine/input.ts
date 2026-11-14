export type Action =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'wait' }
  | { type: 'pickup' }
  | { type: 'quaff' }
  | { type: 'useScroll'; scroll: 'teleport' | 'fireblast' }
  | { type: 'descend' }
  | { type: 'toggleMute' }
  | { type: 'restart' };

/** 键位 → 方向。支持方向键、WASD、vi 键（hjkl）以及斜向（yubn） */
const KEY_DIRS: Record<string, readonly [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
  h: [-1, 0],
  j: [0, 1],
  k: [0, -1],
  l: [1, 0],
  y: [-1, -1],
  u: [1, -1],
  b: [-1, 1],
  n: [1, 1],
};

/** 功能键位 */
const KEY_COMMANDS: Record<string, Action> = {
  g: { type: 'pickup' },
  q: { type: 'quaff' },
  t: { type: 'useScroll', scroll: 'teleport' },
  f: { type: 'useScroll', scroll: 'fireblast' },
  '>': { type: 'descend' },
  m: { type: 'toggleMute' },
  r: { type: 'restart' },
};

/** 绑定键盘输入，返回解绑函数 */
export function bindInput(onAction: (action: Action) => void): () => void {
  const handler = (e: KeyboardEvent) => {
    // 不劫持浏览器快捷键
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const dir = KEY_DIRS[e.key];
    if (dir) {
      e.preventDefault();
      onAction({ type: 'move', dx: dir[0], dy: dir[1] });
      return;
    }
    const command = KEY_COMMANDS[e.key];
    if (command) {
      e.preventDefault();
      onAction({ ...command });
      return;
    }
    if (e.key === '.' || e.key === ' ') {
      e.preventDefault();
      onAction({ type: 'wait' });
    }
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}

/** 角度八分区对应的方向（屏幕坐标系，y 向下） */
const TOUCH_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

const SWIPE_THRESHOLD = 24;

/**
 * 触屏手势：在画布上滑动 = 8 方向移动，点按 = 原地等待。
 * （移动端的动作按钮由 main 单独绑定）
 */
export function bindTouch(target: HTMLElement, onAction: (action: Action) => void): () => void {
  let sx = 0;
  let sy = 0;
  let tracking = false;

  const onStart = (e: TouchEvent) => {
    const t = e.changedTouches[0];
    if (!t) return;
    sx = t.clientX;
    sy = t.clientY;
    tracking = true;
  };

  const onEnd = (e: TouchEvent) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (Math.hypot(dx, dy) < SWIPE_THRESHOLD) {
      onAction({ type: 'wait' });
      return;
    }
    const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
    const dir = TOUCH_DIRS[((octant % 8) + 8) % 8];
    if (!dir) return;
    onAction({ type: 'move', dx: dir[0], dy: dir[1] });
  };

  target.addEventListener('touchstart', onStart, { passive: true });
  target.addEventListener('touchend', onEnd);
  return () => {
    target.removeEventListener('touchstart', onStart);
    target.removeEventListener('touchend', onEnd);
  };
}
