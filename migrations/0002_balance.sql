-- 进销通 v2.3 · 客户余额账户与余额支付
-- 说明：users.balance 为客户可用余额（元），所有变动均写入 balance_logs 流水，可追溯、可对账。

-- 客户余额（正数=可用余额；不允许为负，扣减前在应用层校验）
ALTER TABLE users ADD COLUMN balance REAL NOT NULL DEFAULT 0;

-- 余额流水（每一笔充值 / 消费 / 退款 / 作废退回 / 手工调整均留痕）
CREATE TABLE IF NOT EXISTS balance_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,                   -- 所属客户
  change REAL NOT NULL,                       -- 变动金额：正数入账，负数出账
  before_balance REAL NOT NULL,               -- 变动前余额
  after_balance REAL NOT NULL,                -- 变动后余额
  type TEXT NOT NULL DEFAULT 'adjust',        -- recharge 充值 | consume 消费 | refund 退款 | void 作废退回 | adjust 调整
  ref_type TEXT NOT NULL DEFAULT '',          -- sales 销售单 | return 退货单 | manual 手工
  ref_id INTEGER,                             -- 关联单据 id
  ref_no TEXT NOT NULL DEFAULT '',            -- 关联单据号快照
  operator_id INTEGER,                        -- 经办人
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_balance_logs_user ON balance_logs(user_id, id);
CREATE INDEX IF NOT EXISTS idx_balance_logs_ref ON balance_logs(ref_type, ref_id);
