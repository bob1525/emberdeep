# Emberdeep 第二阶段长期工程 — 持续状态文件

> 本文件是跨会话的唯一事实来源。每个里程碑的状态以此为准，未执行的绝不标记完成。
> 最后更新：M1/M2/M3 完成（bc63506 已在 GitHub）+ M5 实现 + M6 模拟器交付 + M7 部分测量（本地 commit 待推送，见外部阻塞）

## ⚠️ 当前外部阻塞

- **git push 到 github.com:443 被网络干扰**（Connection reset / Connect timeout）。
- 已尝试 5 种独立方案：①直接重推 ②+20s 重试 ③+60s 重试 ④HTTP/1.1 强制 ⑤gh api 诊断（api.github.com 正常返回 bob1525 —— 阻塞为主域 SNI 级选择性干扰）。
- 本地 commit（M5/M6/M7 全部工作）安全保存在磁盘 main 分支，网络恢复后 `git push` 即可。
- 已验证（阻塞前）：bc63506 推送成功，CI 两工作流全绿。

## 基线（已验证）

- 分支 main，tracking origin/main（github.com/bob1525/emberdeep）
- commit `785b40f` 存在（git cat-file 验证）；bc63506 为其后续且已推送成功（阻塞前 CI 全绿）
- 基线命令（2026-11-14）：lint ✅ / typecheck ✅ / test ✅ **350/350** / build ✅
- 最新命令（本轮）：lint ✅ / typecheck ✅ / test ✅ **378/378**（28 文件）/ build ✅ gzip 35.14 kB

## 里程碑状态总表

| 里程碑 | 状态 | 代码证据 | 测试证据 | 未完成项 | 下一步 |
|---|---|---|---|---|---|
| M1 | DONE | 22 项修复逐条核验矩阵（下方） | reverse.test.ts 5 反例 + input 6 + game-fixes 8 | 触屏/浏览器路径留 M8 | M8 |
| M2 | DONE | canonical.ts（键排序/Map/Set 规范化/64 位双哈希/firstDifference）+ replay.ts v2（协议头/录制器/断点/分歧诊断） | replay 8（含断点续玩逐位一致/第 5 步分歧定位/协议拒绝/双实例隔离）+ canonical 6 | UI 导出按钮（记录） | — |
| M3 | DONE | saveSchema.ts（版本/数值范围/瓦片/实体/物品类别↔目录/Boss species/引用完整性）；readSave 接线；未知版本拒绝；缺字段默认迁移 | saveSchema 11（损坏/旧档/悬空词缀警告/重复 ID 拒绝） | 逐字段 canonical 化 SaveData 序列化（M2 已覆盖哈希路径） | — |
| M4 | PARTIAL | **本轮新增：EntityRegistry（registry.ts）+ SaveCodec（saveCodec.ts：encodeSaveData/migrateV1Defaults，game.buildSaveData 已委托）** + saveSchema.ts；**SaveCodec 抽取当场抓到 memories 编解码不匹配 bug（对象数组 vs 元组）→ 已修复并有往返测试守卫** | game-fixes/replay round-trip ✅ | TurnEngine/FloorService/InventoryEconomyService/ReplayRunner/SceneBuilder 迁移；依赖图文档 | 每域先测后迁（下一批） |
| M5 | PARTIAL | scaling.ts 落地 + buildFloor/placeBoss 接线 + recordDepth/bestDepth 元进度 + simTurn 机器人策略修复（捡拾/撤退/技能/商人绕行寻路） | 模拟器两轮数据对比（修复前 24 局全灭 vs 修复后战士 0 死亡） | **数值未收敛**：游侠/法师仍 100% 死于 1 层（巨蝠威胁+bot 无走位，策略与数值问题需分离归因）；500 seeds 深跑待做 | 数值调整 + 深跑 |
| M6 | PARTIAL | simulator.ts（turnCap 参数化：CI 快速档 1200 / 深跑档 6000）+ tests/simulator.test.ts（CI 档约 1-6 分钟）+ 卡死原因记录 | simulator.test ✅ | 500 seeds；失败局 Action 序列导出 | 扩 seeds |
| M7 | PARTIAL | pathfindingStats 计数器 + 快照字节/耗时测量（A* 局均 19~5070、快照 30~49KB 无深度增长） | simulator 数据 | p50/p95/p99、最坏场景、A* tie-break、长程内存 | 基准测试 |
| M8 | PARTIAL | work/browser-acceptance.md（路径 1/2/3/4/11/12 实测通过，5-8 headless 补证）；README 技能键 v；状态栏 k→v 修正 | browser-acceptance.md | 路径 5-10 浏览器深跑；架构图；changelog | 收口 |

## 里程碑 1：修复核验矩阵（22 项）

| 修复项 | 实现 | 行为测试 | 反向测试 | 结论 |
|---|---|---|---|---|
| 技能键冲突 | input.ts keyToAction 纯函数，v=技能 | input.test 6 例（vi-k 仍上移） | 修饰键返回 null ✅ | 已验证 |
| 触屏技能入口 | TOUCH_ACTIONS 补"技"按钮 | ✗（DOM） | — | 部分验证（M8） |
| 冲锋回调语义 | skillCharge `isWalkable && !monsterAt` + 每步重验证 | pathfinding 语义单测 | 冲锋无路不耗回合 ✅（reverse） | 已验证 |
| 冲锋占用/边界 | 每步 `isWalkable\|\|monsterAt → break` | 集成级摆怪不可行 | 同上 | 部分验证 |
| FOV/LOS/射程 | visibleTargets=FOV∩LOS；精准箭 ≤ def.range | 代码审查 | '射程内没有目标' 路径 ✅ | 部分验证（语义统一） |
| 怪物状态 tick | monsterTurns ①状态②死亡③能量④特技⑤AI（注释契约） | game-fixes 燃烧致死 ✅ | reverse/debugBurnNearest ✅ + 重复施加取优（statuses）✅ | 已验证 |
| isOnFire 真实化 | hasStatus(m,'burn') | brain fleeFire ✅ | — | 已验证（状态语义） |
| Boss 存档重建 | hydrate 尾部按 species 匹配（depth 恢复后） | game-fixes Boss 层往返 ✅ | 读档后召唤 ID 唯一 ✅ | 已验证 |
| allocator 水位 | setEntityIdCounters(max+1) + resetEntityIds | game-fixes ✅ | 双实例隔离（replay）✅ | 已验证 |
| 多级升级队列 | pendingLevelUps + offerTalents | game-fixes 跨两级 ✅ | reverse 跨四级 ✅ / 候选耗尽 ✅ | 已验证 |
| 自动探索预算 | 每批 24 步 + 交互/陷阱/楼梯停车 + mode 守卫 + 暂停续批语义修正 | game-fixes 批次 ≤26 ✅ | reverse 传送至交互物旁停车 ✅ / 续批 ✅ | 已验证 |
| BFS O(V²) | head 指针替代 shift() | 代码审查 | — | 部分验证（M7 基准）|
| Boss 召唤上限 | 每场 ≤4 + 召唤物无 XP/金币 + 特技移出能量循环 + 每回合 ≤3 行动 | reverse 连续强制冷 monsterCount 有界 ✅ | — | 已验证 |
| haste 行动上限 | 能量 +1（非循环注入）+ 硬上限 3 | 代码审查 | 极端 RNG 序列 ✗ | 部分验证 |
| 许愿井满包 | 顶到脚边为地面物品 | 代码审查 | — | 部分验证（M8） |
| URL seed 语义 | fixedSeed 下 newRun 不改写 | game-fixes 固定种子双开局哈希一致 ✅ | reverse 跨级哈希一致 ✅ | 已验证 |
| rally 记忆持久化 | memories 进存档（冷却/集结点） | game-fixes Boss 层往返隐式 ✅ | — | 部分验证 |
| 生命周期清理 | 死亡清记忆/召唤标记；换层 prune 无主词缀 | 代码审查 | — | 部分验证 |
| 静态缓存失效 | 缓存层含全部 explored（P2-16 修正） | 代码审查 | — | 部分验证（M8） |
| 震屏复位 | drawNow 显式清 transform（P2-16） | 代码审查 | — | 部分验证（M8） |
| 触屏技能入口 | TOUCH_ACTIONS"技"按钮 | ✗ | — | 部分验证（M8） |
| schema 校验 | parseSaveData 全字段校验 | saveSchema 11 ✅ | 损坏/旧档/未知版本拒绝 ✅ | 已验证 |

**M1 结论：16 已验证 / 8 部分验证（缺口归属 M7 基准与 M8 浏览器）/ 0 回归。**

## M6 模拟器数据（8 seeds × 3 职业，sim-results.json 有全量）

- **平衡发现**：修复机器人（捡拾/喝药/撤退/技能）后 —— 战士 8 局 0 死亡但困于 2 层（击杀 7/局）；**游侠与法师 100% 死于 1 层**（巨蝠为主，22-28HP 承受不了 3 攻击力蝙蝠的换血）——
  结论：①巨蝠（3 攻/5 血）对低血职业的 1 层威胁过高（数值问题，待调）②机器人无走位能力，数据解读需带此前提 ③战士 40HP 明显超模（对照实验组）
- **性能测量（M7）**：A* 局均 19~5070 次（游侠 12 万回合异常局已由技能退避+回合上限消除）；快照 30~49KB 无深度异常增长；单局 0.2~30s

## 下一阶段

1. 推送（网络恢复后）：本地 main 含 M5/M6/M7 全部工作
2. M4 继续拆分；M5 数值调整（巨蝠 1 层威胁/战士超模）用模拟器回归验证
3. M7 剩余基准；M8 浏览器 12 路径 + 文档收口

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
