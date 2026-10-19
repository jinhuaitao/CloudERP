-- 进销通 v2.4 · 客户退换货申请与管理员审核
-- 客户在「我的订单」提交退/换货申请 → 管理员审核 → 通过后自动生成正式退货单（回补库存）。

CREATE TABLE IF NOT EXISTS return_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_no TEXT NOT NULL UNIQUE,            -- 申请单号 RQxxxx
  customer_id INTEGER NOT NULL,               -- 申请人
  sales_order_id INTEGER NOT NULL,            -- 原销售单
  sales_order_no TEXT NOT NULL DEFAULT '',    -- 原销售单号快照
  type TEXT NOT NULL DEFAULT 'return',        -- return 退货 | exchange 换货
  reason TEXT NOT NULL DEFAULT '',            -- 申请原因 / 问题描述
  items_json TEXT NOT NULL DEFAULT '[]',      -- [{product_id,qty,price,name,sku,unit}] 快照
  total REAL NOT NULL DEFAULT 0,              -- 申请退款金额
  status TEXT NOT NULL DEFAULT 'pending',     -- pending 待审核 | approved 已通过 | rejected 已驳回 | cancelled 已撤销
  return_order_id INTEGER,                    -- 审核通过后生成的正式退货单 id
  review_remark TEXT NOT NULL DEFAULT '',     -- 审核意见 / 驳回原因
  reviewer_id INTEGER,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_return_requests_customer ON return_requests(customer_id, id);
CREATE INDEX IF NOT EXISTS idx_return_requests_status ON return_requests(status, id);
CREATE INDEX IF NOT EXISTS idx_return_requests_order ON return_requests(sales_order_id);
