-- 进销通 jinxiao-system · 初始化表结构
-- 说明：同一份 SQL 同时用于 wrangler d1 migrations 与运行时自愈建表（空库自动建表）

-- ============ 用户体系 ============
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',      -- admin 管理员 | sales 销售 | customer 客户
  status TEXT NOT NULL DEFAULT 'active',      -- active 正常 | disabled 禁用
  nickname TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  avatar_key TEXT NOT NULL DEFAULT '',        -- R2 对象 key
  parent_id INTEGER,                          -- 上级销售 id（二级分销体系）
  sales_level INTEGER NOT NULL DEFAULT 0,     -- 0 非销售 | 1 一级销售 | 2 二级销售
  commission_rate REAL NOT NULL DEFAULT 0,    -- 个人分佣比例（%，0=用系统默认）
  credit_limit REAL NOT NULL DEFAULT 0,       -- 客户赊账额度
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_parent ON users(parent_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- 密保问题（找回密码用，答案存哈希）
CREATE TABLE IF NOT EXISTS security_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  q1 TEXT NOT NULL,
  a1_hash TEXT NOT NULL,
  q2 TEXT NOT NULL,
  a2_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 会话（存 token 的 SHA-256 摘要）
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 登录尝试（限流/锁定依据）
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  success INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(username, created_at);

-- 找回密码尝试（防暴力猜答案）
CREATE TABLE IF NOT EXISTS recovery_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  success INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_recovery_attempts ON recovery_attempts(username, created_at);

-- ============ 基础资料 ============
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  contact TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ============ 商品 ============
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER,
  supplier_id INTEGER,
  sku TEXT UNIQUE,                            -- 为空时存 NULL（SQLite 允许多个 NULL）
  barcode TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '件',
  purchase_price REAL NOT NULL DEFAULT 0,     -- 进价/成本
  sale_price REAL NOT NULL DEFAULT 0,         -- 售价
  stock REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,          -- 安全库存（低于预警）
  max_stock REAL NOT NULL DEFAULT 0,          -- 库存上限（0=不限制，防溢出）
  image_key TEXT NOT NULL DEFAULT '',         -- R2 对象 key
  status TEXT NOT NULL DEFAULT 'on',          -- on 上架 | off 下架
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

-- ============ 进货 ============
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  supplier_id INTEGER,
  total REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  operator_id INTEGER,
  remark TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'done',        -- done 已完成 | void 已作废
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_purchase_created ON purchase_orders(created_at);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty REAL NOT NULL,
  price REAL NOT NULL,
  amount REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_order ON purchase_items(order_id);

-- ============ 销售 ============
CREATE TABLE IF NOT EXISTS sales_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER,                        -- 客户（散客为 NULL）
  sales_id INTEGER,                           -- 归属销售员（分佣依据）
  total REAL NOT NULL DEFAULT 0,              -- 应收（折后）
  discount REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,               -- 实收
  payment TEXT NOT NULL DEFAULT 'cash',       -- cash 现金 | wechat 微信 | alipay 支付宝 | bank 银行 | credit 赊账
  remark TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'done',        -- done 已完成 | void 已作废
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_sales ON sales_orders(sales_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales_orders(customer_id);

CREATE TABLE IF NOT EXISTS sales_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty REAL NOT NULL,
  price REAL NOT NULL,
  cost REAL NOT NULL DEFAULT 0,               -- 当时成本快照（算利润用）
  amount REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_items_order ON sales_items(order_id);

-- ============ 销售退货 ============
CREATE TABLE IF NOT EXISTS return_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  sales_order_id INTEGER,
  customer_id INTEGER,
  total REAL NOT NULL DEFAULT 0,
  operator_id INTEGER,
  remark TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'done',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  qty REAL NOT NULL,
  price REAL NOT NULL,
  amount REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_return_items_order ON return_items(order_id);

-- ============ 库存流水（每次变动留痕） ============
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  change REAL NOT NULL,                       -- 正数为增、负数为减
  before_qty REAL NOT NULL,
  after_qty REAL NOT NULL,
  type TEXT NOT NULL,                         -- purchase_in 进货 | sale_out 销售 | return_in 退货 | adjust 盘点 | void 作废回滚
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id INTEGER NOT NULL DEFAULT 0,
  operator_id INTEGER,
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_id, id);
CREATE INDEX IF NOT EXISTS idx_movements_created ON stock_movements(created_at);

-- ============ 分佣记录 ============
CREATE TABLE IF NOT EXISTS commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  sales_id INTEGER NOT NULL,
  level INTEGER NOT NULL,                     -- 1 一级 | 2 二级
  base_amount REAL NOT NULL,                  -- 计算基数
  rate REAL NOT NULL,                         -- 分佣比例（%）
  amount REAL NOT NULL,                       -- 佣金金额
  status TEXT NOT NULL DEFAULT 'pending',     -- pending 待结算 | settled 已结算
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_commissions_sales ON commissions(sales_id, status);
CREATE INDEX IF NOT EXISTS idx_commissions_order ON commissions(order_id);

-- ============ 审计日志 ============
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ============ 系统设置 ============
CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL DEFAULT ''
);

-- 默认设置
INSERT OR IGNORE INTO settings (k, v) VALUES
  ('site_name', '进销通'),
  ('allow_register', '1'),
  ('commission_base', 'profit'),
  ('commission_l1_default', '5'),
  ('commission_l2_default', '8'),
  ('commission_l1_override', '2'),
  ('backup_keep', '14'),
  ('schema_version', '1');
