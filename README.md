# 蜜蜂授粉路线规划器（gbbeeroute）

面向果园托管服务队与蜂场技术员，把「果园地块 → 花期 → 蜂群投放点 → 转场路线」排成季内可执行的授粉安排，解决花期重叠时蜂群撞车、转场距离过远、投放点与地块不匹配的问题。**纯前端单页应用**，全部数据保存在浏览器 IndexedDB，不依赖任何后端服务或外部接口。

## 一、Docker 一键启动（推荐）

```bash
cp .env.example .env      # 首次启动先复制环境变量文件
docker compose up -d --build
```

启动后访问：<http://localhost:21817>

```bash
docker compose ps        # 查看容器状态
docker compose logs -f   # 查看日志
docker compose down      # 停止并移除容器（数据在浏览器本地）
```

`.env` 可调：

```
COMPOSE_PROJECT_NAME=gbbeeroute
FRONTEND_PORT=21817
VITE_AMAP_KEY=            # 可选，留空即自动降级为本地 SVG 网格视图
```

## 二、技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 |
| 语言 | TypeScript（`tsc --noEmit` 类型检查零错误） |
| UI 组件库 | Ant Design 5 |
| 地图 | 高德地图 JS API 2.0（可选，key 走 `VITE_AMAP_KEY`） |
| 状态管理 | Zustand |
| 路由 | React Router 6（nginx `try_files` 回落） |
| 构建 | Vite 5 |
| 本地存储 | IndexedDB（Dexie 封装，含 `schemaVersion` 与升级迁移） |
| 部署 | 多阶段 Dockerfile：`node:20-alpine` 构建 → `nginx:alpine` 托管 |

## 三、高德地图 Key 与降级策略

- 在 `.env` 里填写 `VITE_AMAP_KEY=<你的 key>` 后**重新构建**（`docker compose up -d --build`），地图将使用高德 JS API 渲染地块、投放点与转场折线；
- **未配置 key 或脚本加载失败时，`RouteMap` 自动降级为本地 SVG 网格视图**：按经纬度线性映射渲染地块、投放点与转场折线，支持点选拾取坐标；
- **构建与运行都不依赖该 key**：未配置 key 时不会注入任何外部脚本（避免无谓请求与报错），Docker 构建零网络依赖即可通过；
- 页面右上角始终显示当前数据源（高德地图 JS API / 本地 SVG 网格视图）。

## 四、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:21817
npm run build      # 类型检查 + 生产构建
```

## 五、目录结构

```
sologsb-1117/
├── docker-compose.yml          # 顶层 name: gbbeeroute，无 version 字段
├── .env.example                # COMPOSE_PROJECT_NAME / FRONTEND_PORT / VITE_AMAP_KEY
├── frontend/
│   ├── Dockerfile              # 多阶段构建，nginx 阶段 chmod -R a+rX 静态资源
│   ├── nginx.conf              # try_files 前端路由回落 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # orchard.ts / colony.ts / droppoint.ts / route.ts / index.ts
│       ├── stores/             # orchardStore / colonyStore / droppointStore / routeStore / scheduleStore（Zustand）
│       ├── components/common/  # RouteMap / FlowerWindowBar / StatusTag / CoordPicker
│       ├── hooks/              # useAmap / usePersistentStore
│       ├── pages/              # SchedulePage / OrchardsPage / ColoniesPage / RoutesPage / ExportPage
│       ├── router/index.tsx
│       └── utils/              # geo.ts / schedule.ts / export.ts / id.ts
```

## 六、数据模型与存储

| 模型 | 说明 | Dexie 表 |
| --- | --- | --- |
| Orchard 果园地块 | 地块名、作物、面积、经纬度、盛花期起止、需蜂强度（箱/亩）、园主联系方式、可达性、历史授粉年份、数据修订号 | `orchards` |
| BeeColony 蜂群 | 群号、蜂种、群势（足框）、箱型、当前所在地块、状态（待投放/在园/转场中/回场）、最近检查日期、健康备注 | `colonies` |
| DropPoint 投放点 | 所属地块、坐标、编号、可容纳箱数、遮阴条件、水源距离、投放时间窗、撤场时间、责任人、安排群号、数据修订号 | `dropPoints` |
| TransitRoute 转场路线 | 出发/到达投放点、预计里程与耗时、车辆类型、出发时刻、风险备注、实际记录 | `routes` |
| ScheduleBasis 排程基准 | 上次重算时各地块/投放点的修订号快照与重算时刻 | `scheduleMeta` |

- 数据库名 `gbbeeroute`，`meta` 表保存 `schemaVersion`；
- `version(2)` 升级迁移会为历史投放点补齐「可容纳箱数」（默认 8 箱）；
- `version(3)` 新增 `scheduleMeta` 表，并为旧数据补齐缺省值：投放点容量默认 8 箱、蜂群箱型默认「标准继箱」、地块与投放点修订号默认 1；
- 数据仅存于浏览器本地，容器无状态、不挂载命名卷。

## 七、两边协作与排程失效重算

花期与投放点归托管队维护，蜂群与转场顺序归技术员维护，两边各改各的，因此**占用与可执行状态一律按两边最新一版数据实时推导**，不读历史快照：

- **占用实时折算**：投放点的占用箱数 = 安排群号逐个查蜂群台账（技术员侧最新）按箱型折算后求和；台账里查不到的群号标「未知群号」，提示两边核对；
- **容量校核与排队**：技术员排群进投放点时，按箱型折出的箱数不能超容；装不下的群保留在该点安排中按容量排队，并写明差几箱（容量缺口），托管队调高容量后自动转入正式占用；
- **投放窗校核**：转场路线预计到达时刻（出发时刻 + 预计耗时）晚于投放窗当天 → 标记「需托管队调窗口」，由托管队调整投放时间窗后自动消除；
- **失效重算**：托管队修改地块可达性或投放点容量后，对应数据修订号 +1，引用它的排程立即失效（标「待重算」）；在总表点击「重算排程」重新校验并写入新基准前，授粉安排清单与打印视图**不可作为可执行方案导出**（JSON 备份不受限）。

## 八、主要页面

| 路由 | 功能 |
| --- | --- |
| `/` | 季内授粉安排总表：花期条带 + 已投放群体，冲突标红汇总；投放点占用明细（折合箱数 / 排队缺口 / 调窗标记）+ 一键重算排程 |
| `/orchards` | 果园地块管理：面积与需蜂强度自动算建议箱数、可达性标记、花期重叠提示、投放点维护（含坐标拾取、容量编辑与占用实时校核） |
| `/colonies` | 蜂群台账：按群势与状态筛选，批量改状态、批量记录检查备注、批量排入投放点（超容自动排队并提示差几箱） |
| `/routes` | 转场路线规划：地图依次选点生成顺序与里程，拖动或上下移动调整顺序并实时重算，写回路线表 |
| `/export` | 导出授粉安排清单 / 转场路线表（CSV）、全量 JSON 备份，并提供横向/纵向打印视图；排程失效未重算时禁止导出可执行方案 |

## 九、计算约定

- 建议箱数 = ⌈面积(亩) × 需蜂强度(箱/亩)⌉，最少 1 箱；
- 箱型折算：标准继箱 = 2 箱，平箱 = 1 箱，交尾箱 = 0.5 箱；投放点占用 = 安排群号按箱型折算求和，超出容量的群按安排顺序排队，缺口 = 占用 − 容量；
- 投放窗校核：转场到达时刻（出发时刻 + 预计耗时）晚于投放窗当天 → 需托管队调窗口；
- 失效判定：排程基准（上次重算时的修订号快照）与当前修订号不一致的地块（可达性）或投放点（容量），其排程失效待重算；
- 转场里程按 Haversine 球面距离累计，耗时按平均 32 km/h + 0.25 h 装卸估算；
- 花期重叠：两地块盛花期区间交集天数 ≥ 1 即视为重叠；同一群号在重叠期内被排入两个地块 → 冲突。
