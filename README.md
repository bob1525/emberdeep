# Emberdeep · 余烬深渊

> 一款纯 TypeScript + Canvas 的浏览器 Roguelike，零运行时依赖。

在地牢中下行，收集装备，对抗深渊中的生物。每一层都由程序生成，每一次死亡都是新的开始。

## 开发

```bash
npm install
npm run dev        # 本地开发服务器
npm test           # 运行测试
npm run lint       # ESLint
npm run build      # 产物构建（含类型检查）
```

## 路线图

- [x] 项目脚手架（Vite + TypeScript + ESLint + Vitest + CI）
- [x] 可玩骨架：字符渲染、键盘移动（方向键 / WASD / vi 键 / 斜向）
- [x] 核心引擎：视野光照（可见/记忆/未知三层）、回合状态机、战斗结算
- [x] 程序化地图生成：BSP 房间 + 洞穴（细胞自动机）+ 楼层递进
- [x] 敌人 AI：睡眠 / 游荡 / 追踪三态，A* 寻路，回合制战斗
- [x] 物品系统：药水、卷轴、装备（自动换装）、背包、经验升级
- [x] UI/UX：HUD、战斗日志（分色）、小地图、WebAudio 合成音效、死亡画面
- [ ] 发布：localStorage 存档、平衡性调优、GitHub Pages 上线

## 操作

| 按键 | 功能 |
| --- | --- |
| Enter | 标题画面：开始新的冒险 |
| C | 标题画面：继续上局 |
| 方向键 / WASD / hjkl | 移动（撞向敌人即攻击） |
| yubn | 斜向移动 |
| 空格 / . | 原地等待 |
| g | 捡拾物品（装备自动对比换装） |
| q | 喝药水 |
| i | 背包（数字使用/装备，Shift+数字丢弃） |
| ? | 完整消息历史（PgUp/PgDn 翻页） |
| t / f | 使用传送 / 烈焰卷轴 |
| > | 下楼（站在楼梯上） |
| v | 职业技能（战士冲锋 / 游侠精准箭 / 法师烈焰新星） |
| m | 静音开关 |
| r | 死亡后重新开始 |

> 进度自动存档于 localStorage（每回合写入），死亡即清档——经典的 permadeath。关闭页面后重新打开会从上次进度继续。

## 技术栈

- TypeScript + Vite，无任何运行时依赖
- 渲染：Canvas 字符画（glyph grid），高分屏适配，三层视野光照
- 可播种 PRNG（mulberry32），地图生成可复现
- 音效：WebAudio 振荡器现场合成，零音频素材
- 测试：Vitest · CI：GitHub Actions · 部署：GitHub Pages

