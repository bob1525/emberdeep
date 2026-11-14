import { describe, expect, it } from 'vitest';
import { keyToAction } from '../src/engine/input';

describe('键盘映射（P0-1 回归：技能键不得被 vi 方向键抢占）', () => {
  it('v 触发技能，k 是 vi 上移（两者不冲突）', () => {
    expect(keyToAction('v')).toEqual({ type: 'useSkill' });
    expect(keyToAction('k')).toEqual({ type: 'move', dx: 0, dy: -1 });
  });

  it('方向键与 WASD', () => {
    expect(keyToAction('ArrowRight')).toEqual({ type: 'move', dx: 1, dy: 0 });
    expect(keyToAction('w')).toEqual({ type: 'move', dx: 0, dy: -1 });
    expect(keyToAction('y')).toEqual({ type: 'move', dx: -1, dy: -1 });
  });

  it('功能键位', () => {
    expect(keyToAction('1')).toEqual({ type: 'useSlot', slot: 0 });
    expect(keyToAction('!')).toEqual({ type: 'dropSlot', slot: 0 });
    expect(keyToAction('g')).toEqual({ type: 'pickup' });
    expect(keyToAction('q')).toEqual({ type: 'quaff' });
    expect(keyToAction('z')).toEqual({ type: 'aimBow' });
    expect(keyToAction('o')).toEqual({ type: 'autoExplore' });
    expect(keyToAction('>')).toEqual({ type: 'descend' });
    expect(keyToAction('Enter')).toEqual({ type: 'titleNew' });
    expect(keyToAction('c')).toEqual({ type: 'titleContinue' });
    expect(keyToAction('?')).toEqual({ type: 'openLog' });
    expect(keyToAction('PageUp')).toEqual({ type: 'scrollLog', dir: -1 });
  });

  it('等待与空格', () => {
    expect(keyToAction('.')).toEqual({ type: 'wait' });
    expect(keyToAction(' ')).toEqual({ type: 'wait' });
  });

  it('修饰键组合不劫持（浏览器快捷键优先）', () => {
    expect(keyToAction('w', { ctrlKey: true })).toBeNull();
    expect(keyToAction('v', { metaKey: true })).toBeNull();
    expect(keyToAction('o', { altKey: true })).toBeNull();
  });

  it('无关按键返回 null', () => {
    expect(keyToAction('F5')).toBeNull();
    expect(keyToAction('字')).toBeNull();
  });
});
