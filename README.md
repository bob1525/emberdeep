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
- [ ] 核心引擎：视野算法（FOV）、回合状态机
- [ ] 程序化地图生成：BSP 房间 + 洞穴（细胞自动机）+ 楼层递进
- [ ] 敌人 AI：巡逻 / 追踪 / 寻路，回合制战斗
- [ ] 物品系统：药水、卷轴、装备、背包、升级
- [ ] UI/UX：HUD、小地图、音效、死亡与胜利画面
- [ ] 发布：localStorage 存档、平衡性调优、GitHub Pages 上线

## 技术栈

- TypeScript + Vite，无任何运行时依赖
- 渲染：Canvas 字符画（glyph grid），高分屏适配
- 可播种 PRNG（mulberry32），地图生成可复现
- 测试：Vitest · CI：GitHub Actions
