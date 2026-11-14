export type Action =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'wait' };

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
    if (e.key === '.' || e.key === ' ') {
      e.preventDefault();
      onAction({ type: 'wait' });
    }
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
