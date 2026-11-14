import { describe, expect, it } from 'vitest';
import { canonicalJson, firstDifference, hash64 } from '../src/engine/canonical';

describe('canonical 序列化（回放协议 v2 地基）', () => {
  it('对象键按字典序排列，与写入顺序无关', () => {
    const a = canonicalJson({ b: 1, a: 2 });
    const b = canonicalJson({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });

  it('嵌套对象与数组：数组保序、对象递归排序', () => {
    const a = canonicalJson({ list: [{ z: 1, y: 2 }], top: 0 });
    expect(a).toBe('{"list":[{"y":2,"z":1}],"top":0}');
  });

  it('Map 转排序数组、Set 转排序数组，且与普通结构可区分', () => {
    const m = canonicalJson(new Map<number, number>([[3, 30], [1, 10]]));
    expect(m).toBe('{"__map":[["1",10],["3",30]]}');
    const s = canonicalJson(new Set(['b', 'a']));
    expect(s).toBe('{"__set":["a","b"]}');
    // 冷却 Map 与普通对象不再因结构不同而混淆
    expect(canonicalJson(new Map([['k', 1]]))).not.toBe(canonicalJson({ k: 1 }));
  });

  it('hash64 输出 16 位十六进制且对输入敏感', () => {
    const h1 = hash64('state-1');
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
    expect(hash64('state-1')).toBe(h1);
    expect(hash64('state-2')).not.toBe(h1);
  });

  it('firstDifference 定位嵌套字段路径', () => {
    const a = canonicalJson({ player: { hp: 30, pos: { x: 1, y: 2 } }, depth: 1 });
    const b = canonicalJson({ player: { hp: 30, pos: { x: 2, y: 2 } }, depth: 1 });
    expect(firstDifference(a, b)).toBe('$.player.pos.x');
    expect(firstDifference(a, a)).toBeNull();
  });

  it('数组分歧以 [index] 报告', () => {
    const a = canonicalJson({ monsters: [{ id: 1 }, { id: 2 }] });
    const b = canonicalJson({ monsters: [{ id: 1 }, { id: 3 }] });
    expect(firstDifference(a, b)).toBe('$.monsters[1].id');
  });
});
