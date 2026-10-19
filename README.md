# 📦 进销通 Jinxiao ERP

运行在 **Cloudflare Workers** 上的进销存 + 二级分销系统：全球边缘运行、零服务器维护，业务数据存 **D1**（SQLite），商品实拍图 / 头像 / 收款码 / 全量备份存 **R2**。

服务端直出 HTML 字符串（`src/views/*.ts`）+ 单个 vanilla JS（`public/static/js/app.js`），无前端框架、无独立前端构建。

> 本文只写「系统现在是什么、怎么用、有哪些口径」。历次 v2.x 的改动与修复过程不再记录在 README。

---

## 功能模块

| 模块 | 路由 | 说明 |
| --- | --- | --- |
| 经营看板 | `/dashboard` `/warnings` | 今日 / 本月销售与毛利、14 天趋势、分类库存价值占比、低库存预警 |
| 商品档案 | `/products` `/products/new` | 两级分类、SKU / 条码 / 单位、成本价与售价、上下架、CSV 导出；行内「📥 进货」「🧾 开单」直达 |
| 分类与供应商 | `/categories` `/suppliers` | 一级 / 二级树、重命名、排序、删除保护 |
| 采购进货 | `/purchase` `/purchase/new` | 入库即按**加权平均法**更新成本，可作废回滚 |
| 销售开单 | `/sales` `/sales/new` | POS 式实时算「小计 − 优惠 = 折后应收 / 挂账欠款」，可作废并回补库存 |
| 退货 | `/returns` `/returns/new` | 关联原单校验可退数量与成交单价，可作废 |
| 退换货申请 | `/returns/apply` `/returns/my` `/returns/requests` | 客户提申请 → 管理员审核通过自动生成正式退货单 |
| 客户与余额 | `/customers` `/customers/:id` | 充值 / 扣减、余额流水、挂账欠款与授信额度 |
| 库存流水 | `/movements` `/adjust` | 期初入库、出入库、盘点调整，逐笔可追溯 |
| 二级分销 | `/team` `/commissions` | 一级 / 二级销售员，成交自动生成佣金记录，可结算 |
| 报表 | `/reports` `/reports/export` | 经营汇总与明细，CSV 导出 |
| 客户订货 | `/catalog` `/shop` | 加购 → 购物车（Cookie `jc_cart`）→ 自助下单 → 我的订单 |
| 系统设置 | `/settings` | 站点名称、分佣比例、微信 / 支付宝收款码、银行转账信息 |
| 运维 | `/maintenance` | 全量备份 / 恢复 / 下载、清空数据、审计日志 `/audit` |
| 账号与权限 | `/setup` `/login` `/register` `/forgot` `/profile` `/users` | 密保问题找回密码、多会话管理与注销、角色与状态管理、销售员层级 |

## 角色

- **管理员（admin）**：全部模块。首个账号由 `/setup` 初始化建立，之后经 `/register` 注册的一律是 `customer`。
- **销售员（sales）**：看板、快速开单、我的销售单、销售退货、客户管理、商品库存、库存流水与预警、我的团队、我的佣金。退换货审核**只读**（仅管理员可执行审核通过 / 驳回），无进货、无用户权限、无系统设置与备份维护。
- **客户（customer）**：商品目录、自助下单、我的订单、退换货申请、余额与收货信息（个人中心）。
- 数据可见范围按归属收敛：销售员只能看自己名下客户与自己的销售单；余额**扣减仅管理员**可执行，销售员只能充值。

---

## 关键业务口径

**库存与成本**
- 采购入库、销售出库、退货回补、作废回滚全部写 `stock_movements`，`before_qty → after_qty` 逐笔闭环；同单多行同商品按商品实时递推，杜绝拆行超卖。
- 进货成本用**加权平均法**动态更新；新建商品填期初库存 > 0 会自动写入 `initial_in` 流水。
- 有库存流水的商品不允许删除，只能下架。

**金额与欠款**
- 欠款不是「选项」而是结果：实收 < 应收即产生挂账，并按客户 `credit_limit` 校验授信上限；结清走 `/sales/:id/pay` 欠款补收核销。
- 收款方式仅微信 / 支付宝 / 银行转账 / 余额支付（`cash`、`credit` 已下线，历史单据仍按 `PAYMENT_NAME` 原样展示，未做数据清洗）。
- **余额支付按应收全额扣减**，不允许「部分余额 + 部分挂账」；散客（无 `customer_id`）不可用。扣减用条件 UPDATE 原子执行，不允许透支。
- 客户自助下单强制按数据库实时售价结算，前端提交的 `price` 一律忽略；未配置的收款渠道不出现在下拉，服务端同样按白名单拒绝。

**退货**
- 可退数量 = 售出 − 有效退货单已退（− 待审核占用），服务端 `createReturnOrder()` 校验，前端改不动。
- 从订单页「办理退货」进入时原单**只读锁定**（附隐藏 `sales_order_id`），清空单号不能绕过校验；退货单价不得高于原成交单价，退货客户须与原单一致。
- 原单为余额支付时，退货金额自动原路退回客户余额（`refund` 流水，与库存回补同批提交）。

**单据商品明细**
- 新建单据默认**不渲染空白明细行**，只显示一条占位引导；从商品档案「📥 进货 / 🧾 开单」或原单带入退货时仍按上下文预填真实行。
- 明细可删到零行，删空即禁用提交按钮；手工增行的空行结构由 `<template id="itemRowTemplate">` 下发（不随表单提交），已有预填行的页面由 JS 按首行克隆并复位。

**商品图片（R2）**
- 画册图库 = `R2.list({ prefix: "products/" })` + 引用计数，不建表；建档时可从图库点选复用。
- **换图与删除商品都不删 R2 对象**，避免一张被 N 个商品复用的图被打坏；空间回收只能在画册页删除标记为「未引用」的图。

**分类**
- 一级 / 二级两层，**两级都能直接挂商品**（`products.category_id` 语义不变）；同一父级下名称唯一，不同一级下允许同名。
- 最多两级：二级不能再有子级，有子分类的一级不允许降级或直接删除。
- 按一级筛选会级联包含其下全部二级；看板分类占比按一级汇总。

**页面按角色分流**
- `/catalog`：管理员只见「🖼️ 画册图库」管理卡；客户 / 销售员见「商品目录」，保留搜索框与分类筛选条。
- 侧栏「进销业务」只留销售退货 / 退换货审核，进货与销售列表入口收敛到商品档案页头与顶栏快捷区。

**时区**
- 统计按东八区聚合（`datetime(created_at, '+8 hours')`），避免北京时间 00:00–08:00 的订单被算进前一天。

---

## 目录结构

```
src/
  index.ts        Hono 入口，每个非 /static 请求先跑 ensureSchema()
  db.ts           Store：全部数据访问、库存/金额/佣金计算、备份与清空口径
  cart.ts         客户购物车 Cookie（jc_cart）读写
  lib.ts env.ts   通用工具与环境类型
  routes/         setup-auth · products · stock · dashboard · team · system
  views/          服务端直出的 HTML 字符串组件
migrations/       0001 初始化 · 0002 余额 · 0003 退换货申请 · 0004 二级分类
public/static/    app.css · app.js
scripts/          ensure-r2.mjs（部署前自动建 R2 桶）
wrangler.jsonc    D1 / R2 / Assets / Cron / vars 配置
```

## 本地开发

```bash
npm install
npm run dev                      # wrangler dev，默认 http://localhost:8787
npm run db:migrate:local         # 可选：本地手动跑迁移（正常由 ensureSchema 自愈）
npm run typecheck
```

- 首次打开访问 `/setup` 创建管理员账号。
- CLI 与 `wrangler dev` 必须使用同一个 `--persist-to` 目录，否则两边操作的是不同的本地 D1 副本。
- 环境变量都在 `wrangler.jsonc` 的 `vars`（会话时长、登录失败锁定、上传大小上限等），无密钥需要配置；`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 仅 `ensure-r2.mjs` 建桶时使用。

## 部署

```bash
npm run deploy:ci
# = scripts/ensure-r2.mjs  →  wrangler deploy  →  wrangler d1 migrations apply jinxiao-db --remote
```

- `wrangler.jsonc` 故意不写 D1 `database_id`：首次 deploy 会自动供给数据库；R2 桶由 `scripts/ensure-r2.mjs` 建。
- 定时任务：每小时清理过期会话与登录 / 找回记录；每天 03:00 UTC 自动全量备份到 `backups/auto-*.json`（文件名按东八区时间生成），并按设置项 `backup_keep`（默认 14 份）裁剪超出部分。

## 安全

- 全站响应头：`X-Content-Type-Options`、`X-Frame-Options: DENY`、`Referrer-Policy`、CSP（`script-src 'self'`，禁 inline script）。
- 会话 cookie 存随机原始 token，库里只存其 SHA-256 摘要；个人中心可查看并注销其它会话。
- 所有写操作走 `parseForm()` 内的 CSRF 双提交校验；登录失败按用户名 + IP 计数锁定（`MAX_LOGIN_ATTEMPTS` / `LOCK_MINUTES`）。
- 找回密码用密保问题，同样带失败计数；越权访问按角色在服务端拦截（`needRoles`），不依赖前端隐藏。

## 数据、备份与清空

- 库内共 20 张表（`migrations/` 建表 + `ensureSchema()` 幂等补建）。`ensureSchema()` 在每个非 `/static` 请求前跑一遍升级检测（`ADD COLUMN` + `CREATE TABLE IF NOT EXISTS` + 分类表重建检测），空库自建、存量库补字段，未执行迁移的环境也能自动补齐。
- **备份 / 恢复**：`Store.backupTables()` 是单一口径，覆盖 17 张业务表（不含 `sessions`、`login_attempts`、`recovery_attempts` 这类运行态表）。导出用 `SELECT *`、导入按每行自身的键拼 `INSERT`，因此导入旧版备份不会报错（缺失的新列按默认值落库）。
- 恢复是**按清单全量替换**：先对清单内每张表 `DELETE FROM` 再写入备份内容，所以「清单里有、备份文件里没有」的表会被清空（用补全清单之前导出的旧备份恢复，`balance_logs`、`return_requests` 即属此情况）；清单外的表不受影响。新增业务表必须同步登记进 `backupTables()`。
- **清空数据**（`/maintenance`，仅管理员）两档：① 仅清业务流水（单据 / 明细 / 申请 / 库存流水 / 佣金 / 余额流水，并把 `products.stock`、`users.balance` 归零）；② 恢复出厂（再清商品档案、分类、供应商、账号、会话与登录记录，保留 `settings`）。执行前必须输入确认口令 `清空所有数据`（服务端精确比对），且**先写 `backups/preclear-*.json` 快照**，快照失败即中止。
- 清空与恢复出厂**都不删 R2 对象**（商品图、头像、收款码、历史备份）。
- 新增业务表时同步登记 `Store.clearPlan()`，预览计数、删除执行与审计留痕会一起生效。
