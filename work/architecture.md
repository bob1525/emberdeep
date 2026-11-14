# 架构与模块依赖图

> 由源码 import 语句机械提取（2026-11-15，HEAD 39871d5），非手绘。
> 分层原则：下层不认识上层；`game.ts` 是唯一允许横跨全域的门面。

## 分层总览

```
L5 入口/工具        main.ts  simulator.ts  engine/replay.ts  engine/saveCodec.ts
                        │         │                │                  │
L4 门面             game.ts（回合循环/规则编排，唯一全域消费者）
                        │
L3 复合逻辑         engine/brain.ts(行为树)   economy/merchant.ts   ui/sceneBuilder.ts
                        │                        │                     │
L2 领域服务         engine/ai.ts  engine/saveSchema.ts  world/traps.ts  world/shrines.ts
                    items/catalog.ts  economy/gold.ts  world/generators/*  ui/renderer.ts
                        │
L1 原子服务         engine/combat.ts  engine/ranged.ts  engine/pathfinding.ts
                    engine/dijkstraMap.ts  engine/statuses.ts  world/map.ts
                    entities/monsters.ts  entities/bosses.ts  entities/talents.ts
                    items/affixes.ts
                        │
L0 基础件（零依赖） engine/rng.ts  engine/los.ts  engine/fov.ts  engine/canonical.ts
                    engine/input.ts  engine/audio.ts  engine/factions.ts
                    entities/actor.ts  entities/classes.ts  entities/registry.ts
                    entities/scaling.ts  world/tiles.ts
```

## 模块清单与职责

| 模块 | 层 | 职责 | 依赖 |
|---|---|---|---|
| `engine/rng` | 0 | mulberry32 可播种 PRNG（snapshot/fromState） | — |
| `engine/los` | 0 | Bresenham 视线 + `Pt` 类型 | — |
| `engine/fov` | 0 | 递归阴影投射 FOV（8 象限，含墙） | — |
| `engine/canonical` | 0 | 确定性序列化 + 64 位双哈希 + 字段差异定位 | — |
| `engine/input` | 0 | 按键→动作纯函数 + DOM 绑定 + 触屏手势 | — |
| `engine/audio` | 0 | WebAudio 振荡器合成（10 音效 + 环境低音） | — |
| `engine/factions` | 0 | 派系关系矩阵 | — |
| `entities/actor` | 0 | Actor/ItemInstance/Equipment/Status 实体模型 + 工厂 | — |
| `entities/classes` | 0 | 三职业定义 + 技能冷却状态机 | — |
| `entities/registry` | 0 | 实体 ID/UID 分配器（确定性重放基石） | — |
| `entities/scaling` | 0 | 深度缩放表（ENDLESS）+ 精英掷骰 | — |
| `world/tiles` | 0 | 瓦片类型与字形/颜色表 | — |
| `engine/combat` | 1 | 攻击结算（attack + rng − defense，最低 1） | rng |
| `engine/ranged` | 1 | 远程目录 + 弹道 + 射击结算 | los, rng |
| `engine/pathfinding` | 1 | A*（二叉堆，8 向，禁穿角）+ 调用计数 | world/map, los |
| `engine/dijkstraMap` | 1 | 距离场追击优化（**待接线**，见已知债务） | world/map, los |
| `engine/statuses` | 1 | 6 种状态效果施加/_tick/加成汇总 | actor |
| `world/map` | 1 | GameMap 网格 + 导出 | tiles |
| `entities/monsters` | 1 | 6 种怪物模板 + 深度出现表 | rng |
| `entities/bosses` | 1 | 3 只多阶段 Boss + 特技/阶段机 | rng |
| `entities/talents` | 1 | 13 条天赋池 + 三选一掷骰 | rng |
| `items/affixes` | 1 | 10 前缀 × 4 稀有度 + 命名/着色 | rng |
| `items/catalog` | 2 | 11 件物品目录 + 掉落掷骰 | rng, actor |
| `economy/gold` | 2 | 金币掉落量 | rng |
| `world/generators/floor` | 2 | BSP(1-3 层)/洞穴(4+) 组合生成，保证连通 | map, rng, los, bsp, cave, util |
| `world/traps` | 2 | 4 种陷阱布置与触发 | los, rng, statuses |
| `world/shrines` | 2 | 献祭祭坛/许愿井结算 | ranged, rng, statuses, catalog |
| `engine/ai` | 2 | 睡眠/游荡/追击三态决策（Boss 常规决策） | actor, los, pathfinding, rng |
| `engine/saveSchema` | 2 | 存档全字段校验 + 失败原因 | bosses, ranged |
| `ui/renderer` | 2 | Canvas 字形渲染/三层光照/特效/离屏缓存 | world/map |
| `engine/brain` | 3 | 行为树 AI（逃火/攻击/呼救/支援/调查/追击） | ai, los, pathfinding, rng, actor |
| `economy/merchant` | 3 | 商人进货与买卖价 | ranged, rng, catalog |
| `ui/sceneBuilder` | 3 | 游戏状态→渲染场景纯转换（无副作用） | ranged, actor, catalog, map, shrines, traps, renderer |
| `game.ts` | 4 | 回合循环/战斗/物品/陷阱/Boss/商人/存档/UI 模式编排（~2400 行） | 全域 |
| `main.ts` | 5 | 浏览器引导：渲染循环/输入/弹层/音效/小地图 | game, ui, input, audio, classes, talents, affixes, catalog, ranged, statuses |
| `simulator.ts` | 5 | 无头机器人对局（平衡/性能/回归） | game, pathfinding, classes |
| `engine/replay` | 5 | 回放协议 v2：录制/重放/分歧诊断 | game, canonical, input |
| `engine/saveCodec` | 5 | 存档编解码 + v1 迁移 | game |
| `world/fire` | — | 火势蔓延（**已交付未接入**） | rng |

## 已知分层债务（M4 收口状态：2026-11-15 更新）

1. ~~`engine/replay.ts` 与 `engine/saveCodec.ts` 反向依赖 `game.ts`~~ **已解决**（f06511c）：
   SaveData 契约移入 saveCodec.ts；runReplay/replayHashes 迁至 `src/replayRunner.ts`（与 simulator 同层）；
   ReplayRecorder 改依赖结构化 `ReplaySource`。engine/ 与 economy/ 已无任何对 game.ts 的依赖。
2. ~~`game.ts` ~2400 行（TurnEngine/FloorService/InventoryEconomyService 待拆）~~ **已解决**：
   InventoryEconomyService（249d548）、FloorService（34c13fb）、TurnEngine（0ae5c15）先后迁出，
   game.ts 2626 → **1917 行**；各服务经最小上下文接口（Ctx 模式）注入，门面保留同名委托，RNG 顺序逐位一致。
3. **`engine/dijkstraMap.ts` 与 `world/fire.ts` 已交付未接线**（README 已知限制同步）。

## 契约要点

- **确定性链**：`registry`（ID 重置）→ `rng`（单一流）→ `canonical`（序列化规范）→ `replay`（动作流 + checkpoint）——四个模块共同保证同种子同动作 = 逐位同状态。
- **渲染管线**：`game` → `sceneBuilder`（纯转换，可无头复用）→ `renderer`（Canvas，只认 Scene，不认 Game）。
- **AI 双轨**：`brain`（行为树，普通怪）与 `ai`（三态，Boss 常规决策）共用 pathfinding/los 底座。
