/**
 * 实体模型契约 — 所有系统（AI、物品、战斗、渲染）共用的数据结构。
 * 纯数据 + 工厂函数，不含任何游戏逻辑。
 */

export type ItemCategory = 'potion' | 'scroll' | 'weapon' | 'armor';

/** 背包里的一件物品。名称/效果等定义由物品目录（items 模块）按 catalogId 提供 */
export interface ItemInstance {
  uid: number;
  catalogId: string;
  category: ItemCategory;
}

export interface Equipment {
  weapon: ItemInstance | null;
  armor: ItemInstance | null;
}

export interface AiState {
  mode: 'sleep' | 'wander' | 'chase';
  /** 感知到玩家的半径（怪物）；缺省由 AI 模块兜底 */
  senseRadius?: number;
  /** 游荡时的偏好方向，用于给怪物一点"性格" */
  wanderDir?: { dx: number; dy: number };
}

export interface Actor {
  id: number;
  side: 'player' | 'monster';
  /** 物种标识，如 'player' | 'rat' | 'bat' | 'skeleton' */
  species: string;
  /** 中文名，用于战斗日志 */
  name: string;
  glyph: string;
  color: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** 基础攻击力（武器加成由游戏层按目录另算） */
  attack: number;
  defense: number;
  /** 击杀所得经验；玩家恒为 0 */
  xpValue: number;
  inventory: ItemInstance[];
  equipment: Equipment;
  /** 玩家为 null */
  ai: AiState | null;
}

let nextActorId = 1;
let nextItemUid = 1;

export function allocateActorId(): number {
  return nextActorId++;
}

export function allocateItemUid(): number {
  return nextItemUid++;
}

const EMPTY_EQUIPMENT: Equipment = { weapon: null, armor: null };

/** 用模板字段创建实体，缺省值统一在这里兜底 */
export function makeActor(template: Partial<Actor> & Pick<Actor, 'species' | 'name' | 'x' | 'y'>): Actor {
  return {
    id: allocateActorId(),
    side: 'monster',
    glyph: 'm',
    color: '#c07070',
    hp: 10,
    maxHp: 10,
    attack: 3,
    defense: 0,
    xpValue: 3,
    inventory: [],
    equipment: EMPTY_EQUIPMENT,
    ai: { mode: 'sleep' },
    ...template,
  };
}

export function createPlayer(x: number, y: number): Actor {
  return makeActor({
    side: 'player',
    species: 'player',
    name: '你',
    glyph: '@',
    color: '#f5b04c',
    x,
    y,
    hp: 30,
    maxHp: 30,
    attack: 4,
    defense: 1,
    xpValue: 0,
    ai: null,
  });
}
