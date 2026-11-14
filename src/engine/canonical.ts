/**
 * Canonical 状态序列化与 64 位状态哈希（回放协议 v2）。
 *
 * 设计要点：
 * - 对象键递归排序、Map 转排序数组、数组保序——不依赖对象自然属性顺序
 * - 双 32 位 FNV 变体拼接为 64 位指纹；单 32 位哈希不再被宣称为"逻辑一致的证明"
 * - firstDifference() 在两个 canonical JSON 之间定位第一个分歧的字段路径
 */

/** 递归规范化：对象键排序 / Map→{__map:[...]} / Set→{__set:[...]} / undefined→null */
export function canonicalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Map) {
    const entries: [string, unknown][] = [...value.entries()].map(
      ([k, v]) => [String(k), canonicalize(v)] as [string, unknown],
    );
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return { __map: entries };
  }
  if (value instanceof Set) {
    const items = [...value].map((v) => String(canonicalize(v))).sort();
    return { __set: items };
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj: Record<string, unknown> = {};
  for (const k of Object.keys(value).sort()) {
    obj[k] = canonicalize((value as Record<string, unknown>)[k]);
  }
  return obj;
}

/** 规范化 JSON 文本（状态比较与快照落盘的统一格式） */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function fnv1a32(input: string, offset: number): number {
  let h = offset >>> 0;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

/** 64 位指纹：FNV-1a 与 FNV-1 双变体拼接（16 位十六进制） */
export function hash64(input: string): string {
  const a = fnv1a32(input, 0x811c9dc5);
  const b = fnv1a32(input, 0x01000194);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * 在两个已规范化的 JSON 字符串之间定位第一个分歧的字段路径。
 * 返回 null 表示完全一致。数组以 [index] 表示位置。
 */
export function firstDifference(aJson: string, bJson: string): string | null {
  let a: unknown;
  let b: unknown;
  try {
    a = JSON.parse(aJson);
    b = JSON.parse(bJson);
  } catch {
    return '$(无法解析)';
  }
  return diffWalk(a, b, '$');
}

function diffWalk(a: unknown, b: unknown, path: string): string | null {
  if (a === b) return null;
  const aObj = a !== null && typeof a === 'object';
  const bObj = b !== null && typeof b === 'object';
  if (!aObj || !bObj || Array.isArray(a) !== Array.isArray(b)) return path;
  const aa = a as Record<string, unknown>;
  const bb = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(aa), ...Object.keys(bb)])].sort();
  for (const k of keys) {
    const d = diffWalk(aa[k], bb[k], Array.isArray(a) ? `${path}[${k}]` : `${path}.${k}`);
    if (d) return d;
  }
  return null;
}
