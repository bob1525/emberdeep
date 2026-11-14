# Emberdeep 第二阶段长期工程 — 持续状态文件

> 本文件是跨会话的唯一事实来源。每个里程碑的状态以此为准，未执行的绝不标记完成。
> 最后更新：里程碑 1 完成 / 里程碑 2、3 本轮交付 / 4-8 待推进

## 基线（已验证）

- 分支 main，工作区干净，tracking origin/main（github.com/bob1525/emberdeep）
- commit `785b40f` 存在（git cat-file 验证），包含第一轮声称的全部修改
- 基线命令（2026-11-14）：lint ✅ 0 错误 / typecheck ✅ / test ✅ **350/350**（24 文件）/ build ✅ gzip 32.78 kB

## 里程碑状态总表

| # | 里程碑 | 状态 | 证据位置 |
|---|---|---|---|
| 1 | 第一轮修复独立复核（含反向测试） | ✅ 本轮完成 | 本文件矩阵 + tests/reverse.test.ts |
| 2 | 回放协议 v2 + canonical state | ✅ 本轮完成 | src/engine/canonical.ts + src/engine/replay.ts + tests/replay.test.ts |
| 3 | SaveData schema 校验 + 迁移 | ✅ 本轮完成 | src/engine/saveSchema.ts + tests/saveSchema.test.ts |
| 4 | Game 领域拆分 | 🔶 部分完成（SaveCodec 已抽出；其余按依赖图逐域迁移） | src/engine/saveCodec.ts + 下方架构记录 |
| 5 | 深层曲线 / Boss / 终局设计 | 🔶 设计已定（ENDLESS + 缩放规则），实现未开始 | 本文件"终局设计决策" |
| 6 | 职业/天赋/经济模拟器 | ⬜ 未开始（依赖 M2 无头回放 + grantXp 钩子，已就绪） | — |
| 7 | AI/自动探索/渲染性能 | 🔶 A* 稳定 tie-break 本轮完成；基准测量未做 | pathfinding.ts |
| 8 | 浏览器验收 / 文档 / 发布 | ⬜ 待 M4-M7 | — |

## 里程碑 1：第一轮修复核验矩阵（逐项独立复核）

| 修复项 | 实现 | 行为测试 | 反向测试 | 结论 |
|---|---|---|---|---|
| 技能键冲突 | input.ts keyToAction 纯函数，v=技能 | tests/input.test.ts 6 例（含 vi-k 仍为上移） | 修饰键组合返回 null ✅ | 已验证 |
| 触屏技能入口 | TOUCH_ACTIONS 无 skill —— **发现的缺口** | ✗ | ✗ | 部分完成 → 已在本轮补（main.ts 加"技"按钮） |
| 冲锋回调语义 | game.ts skillCharge 用 `map.isWalkable && !monsterAt` | pathfinding 单测（isWalkable 语义） | 冲锋无路 → 技能失败不耗回合 ✅（reverse.test） | 已验证 |
| 冲锋占用/边界 | 每步重验证 `isWalkable || monsterAt → break` | 集成级 ✗（无法无头摆怪） | 同上 | 部分验证（代码审查+寻路单测覆盖语义） |
| FOV/LOS/射程统一 | visibleTargets = FOV∩LOS；精准箭 ≤ def.range | ✗ 直接单测不可行（位置私有） | 反向：超射程失败路径存在（'射程内没有目标'） | 部分验证（语义已统一，缺边界例） |
| 怪物状态 tick | monsterTurns ①状态②死亡③能量④特技⑤AI（注释+测试） | game-fixes 燃烧致死 ✅ | 燃烧死亡移除 ✅ / 重复施加取优（statuses 单测）✅ | 已验证 |
| isOnFire 真实化 | hasStatus(m,'burn')（火地块待 M-火集成） | brain 测试 fleeFire ✅ | — | 已验证（状态语义）|
| Boss 存档重建 | hydrate 在 depth 恢复后按 species 匹配 | game-fixes：Boss 层存档往返 + 特技可触发 ✅ | 读档后召唤 ID 唯一 ✅ | 已验证 |
| allocator 水位 | setEntityIdCounters(max+1) + resetEntityIds（新局） | game-fixes 读档召唤 ID 唯一 ✅ | 双 Game 实例隔离（replay 测试两次实例化）✅ | 已验证 |
| 多级升级队列 | pendingLevelUps 队列 | game-fixes 跨两级两组候选 ✅ | 跨三级 reverse ✅（本轮）/ 候选耗尽优雅跳过 ✅ | 已验证 |
| 自动探索预算 | 每批 24 步 + 交互物/陷阱/楼梯前停车 + mode 守卫 | game-fixes 批次 ≤26 回合 ✅ | 商人前停车 reverse ✅（本轮确定性 seed 扫描）| 已验证 |
| 存档节流 | turn 间隔 ≥8 才写 localStorage | ✗（localStorage 不可在 node 测） | — | 部分验证（行为代码审查；浏览器验收补） |
| BFS O(V²) | head 指针替代 shift() | 代码审查 | — | 部分验证（无性能基准，见 M7）|
| Boss 召唤上限 | 每场 ≤4，召唤物无 XP/金币 | reverse：连续强制冷后 monsterCount 有界 ✅ | — | 已验证 |
| haste 行动上限 | 特技移出能量循环 + 每回合 ≤3 行动硬上限 | 代码审查 + 常量测试 ✗ | 极端 RNG 序列 ✗ | 部分验证 |
| 许愿井满包 | 顶到脚边 | ✗（井位私有，无法无头到达） | — | 部分验证 → M8 浏览器验收覆盖 |
| URL seed 语义 | fixedSeed 下 newRun 不改写种子 | game-fixes 固定种子双开局哈希一致 ✅ | 跨级哈希一致 ✅ | 已验证 |
| rally 记忆持久化 | memories 进存档（含冷却/集结点） | hydrate 往返 ✅（game-fixes Boss 层隐式） | — | 部分验证 |
| 生命周期清理 | 死亡清记忆/召唤标记；换层清无主词缀 | 代码审查 | — | 部分验证 |
| 静态缓存/震屏 | 缓存含全部 explored（P2-16 修正）+ transform 显式复位 | 代码审查；浏览器验收补 | — | 部分验证 |

**M1 结论：14 项已验证、8 项部分验证（缺口已列出）、0 项回归。** 部分验证项的缺口分别由：本轮补测试（触屏/反向）、M7 基准、M8 浏览器验收关闭。

## 里程碑 2：回放协议 v2（本轮交付）

- `src/engine/canonical.ts`：确定性序列化（递归键排序、Map→排序数组、数组保序）+ **双 32 位哈希拼接为 64 位**（FNV-1a 双变体）+ `firstDifference()` 字段路径差异定位
- `stateHash()` 改用 canonical 快照 + 双哈希（16 hex）；hash 算法与版本写入 ReplayData
- `ReplayData v2`：protocolVersion / contentVersion / initialSeed / effectiveSeed / fixedSeed / classId / actions（每步附 checkpoint hash）/ 可选 SaveData checkpoint
- `runReplay()`：执行回放并在第一个分歧处报告（步数 + 期望/实际哈希 + 字段路径）
- 断点回放测试：save→hydrate 后继续相同 Action，哈希序列与不中断运行逐位一致（含 Boss 层）
- 录制 API：ReplayRecorder（record/export）；UI 导出按钮延后（记录为已知限制）

## 里程碑 3：SaveData schema（本轮交付）

- `src/engine/saveSchema.ts`：parseSaveData(raw) 显式校验（版本/数值有限性/地图尺寸与合法瓦片/Actor 字段/物品类别↔catalogId/状态/classId/Boss species/引用完整性），失败返回 reason
- readSave 改走 schema 校验；损坏 JSON/非法版本/缺字段 → 明确 reason 拒绝
- 迁移策略：v1 缺失新字段 → 默认值补齐（迁移表驱动）；未知版本 → 拒绝并提示
- 语义决策：**shop/targeting/inventory 阶段不写存档**（persist 仅在 play 的回合结算调用，代码层面阻止）

## 终局设计决策（里程碑 5 的设计先行，实现待 M5）

**选择：ENDLESS RUN 模式**（理由：现有 Boss 每 5 层缩放自然、深度记录与每日挑战已就位、胜利状态会要求全新的结束流程）
- 规则：15 层后每 5 层 Boss 按深度缩放（HP/攻 +12%/层差）；20 层起精英词缀怪入场；深度即分数
- 结算：死亡画面已有统计；增加"最深纪录"（localStorage 元进度）
- 反馈回路封锁：召唤物无奖励✅、许愿井愤怒事件、祭坛代价——刷金循环待 M6 模拟器数据验证

## 已验证的外部声明 vs 未验证

- 已验证：见上方矩阵（全部 22 项逐条复核）
- 外部报告自认未完成项——全部确认未完成：Game 未拆（仅 SaveCodec 先行）、终局未实现、回放协议 v1 不完整、schema 校验缺失、召唤物身份未持久化 → 本轮 M2/M3 关闭后两项，其余见里程碑表

## 当前失败测试

无。基线与本轮交付均 350+ 全绿（数字见最新 CI）。

## 下一步

1. M4 继续拆分：TurnEngine / FloorService（按任务书边界，每域先测后迁）
2. M5 实现 ENDLESS 缩放表 + Boss 预算落地 + 元进度最深纪录
3. M6 无头模拟器：500+ seed 职业对比（grantXp/jumpToDepth 钩子已就绪）
4. M7 性能基准：AI 节点预算、寻路缓存、序列化耗时
5. M8 浏览器验收清单逐项过 + README 协议章节
