# 📦 进销通 jinxiao-system

运行在 **Cloudflare Workers** 上的进销存管理系统：全球边缘运行、零服务器维护，
数据存 **D1**（SQLite），图片与备份存 **R2**。支持**二级分销体系**、客户自助注册下单、
密保问题找回密码。

---

## ✨ 功能清单

### 🔐 账号与安全
| 功能 | 说明 |
|---|---|
| 🧙 首次初始化向导 | 第一次打开自动进入，**强制设置管理员账号密码 + 密保问题**（无默认密码） |
| 👥 三级角色 | 管理员 / 销售员 / 客户，菜单与权限按角色隔离 |
| 📝 客户自助注册 | 可在系统设置中一键开/关 |
| ❓ 密保找回密码 | 注册时设置 2 个密保问题，答对即登录并强制改密；防暴力猜测限流 |
| 🚫 登录限流 | 同一账号+IP 连续失败 5 次锁定 15 分钟 |
| 🛡️ 纵深防护 | bcrypt 密码哈希、会话服务端存储（SHA-256 摘要）、CSRF 双重提交、安全响应头、HttpOnly Cookie |
| 👤 个人中心 | 改密码、更新密保、查看/踢出登录设备 |
| 📜 操作审计 | 关键操作（建单、作废、结算、备份恢复、禁用用户等）全留痕 |

### 📦 进 · 销 · 存
| 功能 | 说明 |
|---|---|
| 🏷️ 商品管理 | SKU、分类、供应商、进价/售价、单位、上下架、**图片存 R2** |
| 🗂️ 分类 / 供应商 | 增删改查，删除保护（有流水/关联时禁止） |
| 📥 进货管理 | 进货单 + 明细，自动入库、库存上限防溢出、作废回滚 |
| 🧾 销售开单 | 销售单 + 明细，库存不足自动拦截，支持折扣/多种收款方式/赊账 |
| ↩️ 销售退货 | 退货单自动回库留痕 |
| 📊 库存流水 | 每次变动留痕（前后库存、操作人、关联单据） |
| ⚖️ 库存盘点 | 输入实盘数，自动算盘盈盘亏 |
| ⚠️ 库存预警 | 低于安全库存自动标红 + 独立预警页 |
| 📈 经营报表 | 进货/销售/利润/退货汇总，CSV 导出（BOM 防乱码 + 公式注入防护） |

### 🤝 二级分销
| 功能 | 说明 |
|---|---|
| 🌳 销售层级 | 管理员创建**一级销售**，一级可发展**二级销售**，树形展示 |
| 💰 自动分佣 | 开单即按规则计提：二级拿销售佣金，上级拿管理津贴；基数可选"按利润/按销售额" |
| 📊 业绩统计 | 个人业绩 + 下级团队业绩（本月订单数/销售额/利润） |
| ✅ 佣金结算 | 待结算/已结算状态，一键结算 |

### 🛠️ 数据维护
| 功能 | 说明 |
|---|---|
| 💾 一键备份 | 全量 JSON 快照存 R2，可下载 |
| ♻️ 恢复 / 轮转 | 上传备份恢复（自动清会话保安全），自动备份保留份数可配 |
| ⏰ 定时任务 | 每小时清理过期会话；每天凌晨 3 点自动备份 |

---

## 🏗️ 技术架构

```
浏览器 ──▶ Cloudflare Workers（Hono 路由 + 服务端渲染，无构建步骤）
              ├── D1（jinxiao-db，SQLite， wrangler.jsonc 未写 database_id → 首次部署自动供给）
              ├── R2（jinxiao-files，商品图片 / 备份；deploy:ci 自动创建）
              └── Workers Assets（public/ 静态资源）
```

| 层面 | 选型 |
|---|---|
| 语言/框架 | TypeScript + Hono 4（strict 模式） |
| 数据库 | Cloudflare D1，`migrations/0001_init.sql` |
| 自愈建表 | 同一份 SQL 打进 bundle，空库首次请求自动建表（忘跑迁移也不 500） |
| 存储 | R2（图片、备份） |
| 密码 | bcryptjs；密保答案 SHA-256；会话 token SHA-256 摘要存储 |
| 前端 | 服务端渲染模板 + 原生 CSS/JS（零框架） |
| 定时 | Cron Triggers（清理 + 自动备份） |

---

## 🚀 部署指南

### 方式一：Cloudflare 控制台连接 GitHub（推荐，推送即自动部署）

**第 1 步：推送代码到 GitHub**
```bash
cd jinxiao-system
git init && git add . && git commit -m "init"
# 在 GitHub 新建仓库（如 jinxiao-system），然后：
git remote add origin git@github.com:你的用户名/jinxiao-system.git
git push -u origin main
```

**第 2 步：控制台连接仓库**
1. 打开 [Cloudflare 控制台](https://dash.cloudflare.com/) → **Workers & Pages** → **创建** → **连接 Git**；
2. 选择刚推送的仓库，项目名填 `jinxiao-system`（**必须与 `wrangler.jsonc` 的 `name` 一致**，否则会建出第二个 Worker）；
3. 构建配置：
   - 构建命令：`npm install`
   - **部署命令：`npm run deploy:ci`**（= 自动创建 R2 → 部署 → 线上执行 D1 迁移，顺序不能换）
   - 根目录：`/`（仓库根即项目根时留空）

**第 3 步：R2 自动创建（两种方式二选一）**

- **全自动**：在 Workers Builds 的构建环境变量中添加
  `CLOUDFLARE_API_TOKEN`（需 Account - R2 - Edit 权限）和 `CLOUDFLARE_ACCOUNT_ID`，
  `scripts/ensure-r2.mjs` 会在每次部署前检查并自动创建 `jinxiao-files` 存储桶；
- **手动**：控制台 → R2 → 先点一次开通 → 手动创建 `jinxiao-files` 存储桶
  （此时构建变量可不填，脚本会自动跳过）。

> D1 数据库无需手动创建：`wrangler.jsonc` 故意不写 `database_id`，
> 首次部署时 wrangler 会自动供给名为 `jinxiao-db` 的数据库并绑定。

**第 4 步：部署并初始化**

点 **保存并部署** → 等待构建成功 → 访问分配的 `*.workers.dev` 域名：

1. 首次打开自动进入 **🪄 初始化向导**：设置管理员用户名、密码、昵称、2 个密保问题；
2. 提交后跳转登录页，用刚创建的管理员登录；
3. 去 **系统设置** 按需调整：站点名称、是否允许客户注册、分佣比例等；
4. 去 **用户管理** 创建一级销售员，或去 **销售团队** 搭建二级体系。

> ⚠️ 没有默认密码——初始化向导是强制的，跳不过。这是有意为之的安全设计。

### 方式二：本地 wrangler CLI

```bash
npm install
npx wrangler login
npm run deploy:ci          # 自动建 R2 → 部署 → 线上迁移
# 本地开发：
npm run db:migrate:local && npm run dev   # http://localhost:8787
```

---

## 👥 角色与二级分销玩法

| 角色 | 能做什么 |
|---|---|
| 👑 管理员 | 全部功能：进货、商品、用户、团队、设置、备份 |
| 💼 销售员 | 开单、退货、查看库存、发展下级、管理客户、看自己/团队业绩与佣金 |
| 🛒 客户 | 注册 → 浏览商品目录 → 自助下单 → 查看自己的订单与欠款 |

**搭建二级体系**：`销售团队` → `新增销售员` → 选"一级"；
一级销售登录后在同一页面"新增下级"即可创建二级。
开单时选择归属销售员，系统自动按 `系统设置` 里的规则计提佣金
（默认：按利润，一级 5%、二级 8%、上级管理津贴 2%）。

---

## ❓ 常见问题

**Q：部署后打开是 500？**
A：多半是 D1 迁移没跑。检查构建日志中 `deploy:ci` 的三步是否都成功；
或本地跑 `npm run db:migrate:remote` 补一次。运行时自愈建表只覆盖"完全空库"。

**Q：图片上传失败？**
A：检查 R2 存储桶 `jinxiao-files` 是否存在、绑定名是否为 `R2`；
单张图片上限默认 5MB（`wrangler.jsonc` 的 `MAX_UPLOAD_MB` 可调）。

**Q：客户注册后是什么角色？**
A：固定为 `customer`，只能看商品目录和下单，不能进后台。注册开关在系统设置里。

**Q：忘记管理员密码？**
A：用初始化时设置的密保问题在登录页"忘记密码"处找回；
若密保也丢了，用 `wrangler d1 execute` 直接更新 users 表密码哈希（需本地 bcrypt 生成）。

**Q：怎么换绑自己的域名？**
A：Workers 项目 → 设置 → 域和路由 → 添加自定义域。

---

## 📁 目录结构

```
jinxiao-system/
├── src/
│   ├── index.ts          # 入口：中间件链（安全头/认证/CSRF）+ 路由挂载 + 定时任务
│   ├── env.ts            # 环境与上下文类型
│   ├── lib.ts            # 工具：转义/密码学/CSV/分页/校验
│   ├── db.ts             # 数据层 Store（全部 D1 操作 + 自愈建表）
│   ├── views/            # 服务端渲染模板（layout/auth/dashboard/products/stock/team/system）
│   └── routes/           # 路由处理器（setup-auth/dashboard/products/stock/team/system + helpers）
├── public/static/        # css/app.css、js/app.js（原生，无框架）
├── migrations/0001_init.sql
├── scripts/ensure-r2.mjs # 部署前自动创建 R2 存储桶
├── wrangler.jsonc
└── package.json          # deploy:ci = 建R2 → 部署 → 线上迁移
```

---

*MIT License · 首次打开请完成初始化向导，公网部署建议开启 HTTPS（Cloudflare 默认提供）。*
