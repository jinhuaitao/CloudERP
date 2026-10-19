// 数据访问层：Store 封装所有 D1 操作（含运行时自愈建表、增量字段自愈与严格库存事务校验）
import schemaSql from "../migrations/0001_init.sql";
import { uid, todayUTC8, utc8Range, round2 } from "./lib";

// ---------- 自愈建表与存量库字段平滑升级 ----------
let schemaReady = false;
function splitStatements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  try {
    const r = await db
      .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name='users'")
      .first<{ c: number }>();
    if (!r || r.c === 0) {
      const stmts = splitStatements(schemaSql).map((s) => db.prepare(s));
      for (let i = 0; i < stmts.length; i += 20) {
        await db.batch(stmts.slice(i, i + 20));
      }
    }
    // 幂等升级：空库自建、存量库补字段、以及未跑迁移文件的环境都靠这里兜底
    const upgradeSql = [
      "ALTER TABLE users ADD COLUMN shipping_name TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE users ADD COLUMN address TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE users ADD COLUMN balance REAL NOT NULL DEFAULT 0",
      "ALTER TABLE sales_orders ADD COLUMN shipping_name TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE sales_orders ADD COLUMN shipping_phone TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE sales_orders ADD COLUMN shipping_address TEXT NOT NULL DEFAULT ''",
      `CREATE TABLE IF NOT EXISTS balance_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        change REAL NOT NULL,
        before_balance REAL NOT NULL,
        after_balance REAL NOT NULL,
        type TEXT NOT NULL DEFAULT 'adjust',
        ref_type TEXT NOT NULL DEFAULT '',
        ref_id INTEGER,
        ref_no TEXT NOT NULL DEFAULT '',
        operator_id INTEGER,
        remark TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`,
      "CREATE INDEX IF NOT EXISTS idx_balance_logs_user ON balance_logs(user_id, id)",
      "CREATE INDEX IF NOT EXISTS idx_balance_logs_ref ON balance_logs(ref_type, ref_id)",
      `CREATE TABLE IF NOT EXISTS return_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_no TEXT NOT NULL UNIQUE,
        customer_id INTEGER NOT NULL,
        sales_order_id INTEGER NOT NULL,
        sales_order_no TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'return',
        reason TEXT NOT NULL DEFAULT '',
        items_json TEXT NOT NULL DEFAULT '[]',
        total REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        return_order_id INTEGER,
        review_remark TEXT NOT NULL DEFAULT '',
        reviewer_id INTEGER,
        reviewed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`,
      "CREATE INDEX IF NOT EXISTS idx_return_requests_customer ON return_requests(customer_id, id)",
      "CREATE INDEX IF NOT EXISTS idx_return_requests_status ON return_requests(status, id)",
      "CREATE INDEX IF NOT EXISTS idx_return_requests_order ON return_requests(sales_order_id)",
      "INSERT OR IGNORE INTO settings (k, v) VALUES ('wechat_qr_key', ''), ('alipay_qr_key', ''), ('payment_note', '')",
    ];
    for (const sql of upgradeSql) {
      try {
        await db.prepare(sql).run();
      } catch {
        /* 字段/索引已存在时忽略 */
      }
    }
    schemaReady = true;
  } catch (e) {
    console.error("ensureSchema failed:", (e as Error)?.message);
  }
}

// ---------- 实体类型 ----------
export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: "admin" | "sales" | "customer";
  status: "active" | "disabled";
  nickname: string;
  phone: string;
  email: string;
  shipping_name: string;
  address: string;
  avatar_key: string;
  parent_id: number | null;
  sales_level: number;
  commission_rate: number;
  credit_limit: number;
  /** 客户可用余额（元），仅 customer 使用 */
  balance: number;
  created_at: string;
}
export interface Category {
  id: number;
  name: string;
  sort: number;
  product_count?: number;
}
export interface Supplier {
  id: number;
  name: string;
  contact: string;
  phone: string;
  address: string;
  created_at: string;
  product_count?: number;
}
export interface Product {
  id: number;
  name: string;
  category_id: number | null;
  supplier_id: number | null;
  category_name?: string;
  supplier_name?: string;
  sku: string | null;
  barcode: string;
  unit: string;
  purchase_price: number;
  sale_price: number;
  stock: number;
  min_stock: number;
  max_stock: number;
  image_key: string;
  status: "on" | "off";
  remark: string;
  created_at: string;
  updated_at: string;
}
export interface PurchaseItem {
  id: number;
  order_id: number;
  product_id: number;
  product_name?: string;
  sku?: string;
  unit?: string;
  qty: number;
  price: number;
  amount: number;
}
export interface PurchaseOrder {
  id: number;
  order_no: string;
  supplier_id: number | null;
  supplier_name?: string;
  total: number;
  paid: number;
  operator_id: number | null;
  operator_name?: string;
  remark: string;
  status: string;
  created_at: string;
  items?: PurchaseItem[];
}
export interface SalesItem {
  id: number;
  order_id: number;
  product_id: number;
  product_name?: string;
  sku?: string;
  unit?: string;
  qty: number;
  price: number;
  cost: number;
  amount: number;
}
export interface SalesOrder {
  id: number;
  order_no: string;
  customer_id: number | null;
  sales_id: number | null;
  customer_name?: string;
  sales_name?: string;
  total: number;
  discount: number;
  paid: number;
  payment: string;
  shipping_name: string;
  shipping_phone: string;
  shipping_address: string;
  remark: string;
  status: string;
  created_at: string;
  /** 列表页附带：本单已完成的有效退货单数 */
  return_cnt?: number;
  items?: SalesItem[];
}
export interface ReturnItem {
  id: number;
  order_id: number;
  product_id: number;
  product_name?: string;
  sku?: string;
  unit?: string;
  qty: number;
  price: number;
  amount: number;
}
export interface ReturnOrder {
  id: number;
  order_no: string;
  sales_order_id: number | null;
  sales_order_no?: string;
  customer_id: number | null;
  customer_name?: string;
  total: number;
  operator_id: number | null;
  operator_name?: string;
  remark: string;
  status: string;
  created_at: string;
  items?: ReturnItem[];
}

// ---------- 客户退换货申请 ----------
export interface ReturnRequestItem {
  product_id: number;
  qty: number;
  price: number;
  name?: string;
  sku?: string;
  unit?: string;
}
export interface ReturnRequest {
  id: number;
  request_no: string;
  customer_id: number;
  customer_name?: string;
  customer_username?: string;
  sales_order_id: number;
  sales_order_no: string;
  type: string;
  reason: string;
  items: ReturnRequestItem[];
  total: number;
  status: string;
  return_order_id: number | null;
  review_remark: string;
  reviewer_id: number | null;
  reviewer_name?: string;
  reviewed_at: string | null;
  created_at: string;
}

const REQUEST_TYPE_NAME: Record<string, string> = { return: "退货", exchange: "换货" };
const REQUEST_STATUS_NAME: Record<string, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已驳回",
  cancelled: "已撤销",
};
export function requestTypeName(t: string): string {
  return REQUEST_TYPE_NAME[t] || t;
}
export function requestStatusName(s: string): string {
  return REQUEST_STATUS_NAME[s] || s;
}
export interface StockMovement {
  id: number;
  product_id: number;
  product_name?: string;
  sku?: string;
  unit?: string;
  change: number;
  before_qty: number;
  after_qty: number;
  type: string;
  ref_type: string;
  ref_id: number;
  operator_id: number | null;
  operator_name?: string;
  remark: string;
  created_at: string;
}
export interface Commission {
  id: number;
  order_id: number;
  order_no?: string;
  sales_id: number;
  sales_name?: string;
  level: number;
  base_amount: number;
  rate: number;
  amount: number;
  status: "pending" | "settled";
  created_at: string;
}
export interface SecQ {
  user_id: number;
  q1: string;
  a1_hash: string;
  q2: string;
  a2_hash: string;
}

const MOVEMENT_TYPE_NAME: Record<string, string> = {
  initial_in: "期初入库",
  purchase_in: "进货入库",
  sale_out: "销售出库",
  return_in: "退货入库",
  adjust: "盘点调整",
  void: "单据作废",
};
export function movementTypeName(t: string): string {
  return MOVEMENT_TYPE_NAME[t] || t;
}

const PAYMENT_NAME: Record<string, string> = {
  cash: "现金",
  wechat: "微信支付",
  alipay: "支付宝",
  bank: "银行转账",
  balance: "余额支付",
  credit: "挂账/赊销",
};
export function paymentName(p: string): string {
  return PAYMENT_NAME[p] || p;
}

/** 余额流水类型中文名 */
const BALANCE_TYPE_NAME: Record<string, string> = {
  recharge: "充值",
  consume: "消费",
  refund: "退款",
  void: "作废退回",
  adjust: "手工调整",
};
export function balanceTypeName(t: string): string {
  return BALANCE_TYPE_NAME[t] || t;
}

export interface BalanceLog {
  id: number;
  user_id: number;
  change: number;
  before_balance: number;
  after_balance: number;
  type: string;
  ref_type: string;
  ref_id: number | null;
  ref_no: string;
  operator_id: number | null;
  operator_name?: string;
  remark: string;
  created_at: string;
}

export class Store {
  constructor(private db: D1Database) {}

  // ============ 设置 ============
  async getSetting(k: string, def = ""): Promise<string> {
    const r = await this.db.prepare("SELECT v FROM settings WHERE k=?").bind(k).first<{ v: string }>();
    return r ? r.v : def;
  }
  async getSettings(): Promise<Record<string, string>> {
    const r = await this.db.prepare("SELECT k,v FROM settings").all<{ k: string; v: string }>();
    const o: Record<string, string> = {};
    for (const row of r.results || []) o[row.k] = row.v;
    return o;
  }
  async setSetting(k: string, v: string): Promise<void> {
    await this.db
      .prepare("INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v")
      .bind(k, v)
      .run();
  }

  // ============ 用户 ============
  async countAdmins(): Promise<number> {
    const r = await this.db
      .prepare("SELECT COUNT(*) AS c FROM users WHERE role='admin' AND status='active'")
      .first<{ c: number }>();
    return r?.c || 0;
  }
  async getUserById(id: number): Promise<User | null> {
    return (await this.db.prepare("SELECT * FROM users WHERE id=?").bind(id).first<User>()) || null;
  }
  async getUserByUsername(username: string): Promise<User | null> {
    return (await this.db.prepare("SELECT * FROM users WHERE username=?").bind(username).first<User>()) || null;
  }
  async createUser(d: {
    username: string;
    password_hash: string;
    role: "admin" | "sales" | "customer";
    nickname?: string;
    phone?: string;
    email?: string;
    shipping_name?: string;
    address?: string;
    parent_id?: number | null;
    sales_level?: number;
    commission_rate?: number;
    credit_limit?: number;
    status?: string;
  }): Promise<number> {
    const r = await this.db
      .prepare(
        `INSERT INTO users (username,password_hash,role,status,nickname,phone,email,shipping_name,address,parent_id,sales_level,commission_rate,credit_limit)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        d.username,
        d.password_hash,
        d.role,
        d.status || "active",
        d.nickname || "",
        d.phone || "",
        d.email || "",
        d.shipping_name || "",
        d.address || "",
        d.parent_id ?? null,
        d.sales_level || 0,
        d.commission_rate || 0,
        d.credit_limit || 0
      )
      .run();
    return Number(r.meta.last_row_id);
  }
  async updateUser(
    id: number,
    patch: Partial<
      Pick<
        User,
        | "role"
        | "nickname"
        | "phone"
        | "email"
        | "shipping_name"
        | "address"
        | "status"
        | "parent_id"
        | "sales_level"
        | "commission_rate"
        | "credit_limit"
        | "avatar_key"
      >
    >
  ): Promise<void> {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (!keys.length) return;
    const set = keys.map((k) => `${k}=?`).join(",");
    await this.db
      .prepare(`UPDATE users SET ${set} WHERE id=?`)
      .bind(...keys.map((k) => (patch[k] as unknown) ?? null), id)
      .run();
  }
  async setPassword(id: number, hash: string): Promise<void> {
    await this.db.prepare("UPDATE users SET password_hash=? WHERE id=?").bind(hash, id).run();
  }
  async countSubordinates(parentId: number): Promise<number> {
    const r = await this.db
      .prepare("SELECT COUNT(*) AS c FROM users WHERE parent_id=?")
      .bind(parentId)
      .first<{ c: number }>();
    return r?.c || 0;
  }
  async listUsers(o: {
    role?: string;
    q?: string;
    status?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: User[]; total: number }> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (o.role) {
      where.push("role=?");
      args.push(o.role);
    }
    if (o.status) {
      where.push("status=?");
      args.push(o.status);
    }
    if (o.q) {
      where.push("(username LIKE ? OR nickname LIKE ? OR phone LIKE ? OR shipping_name LIKE ? OR address LIKE ?)");
      args.push(`%${o.q}%`, `%${o.q}%`, `%${o.q}%`, `%${o.q}%`, `%${o.q}%`);
    }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const total =
      (await this.db.prepare(`SELECT COUNT(*) AS c FROM users ${w}`).bind(...args).first<{ c: number }>())?.c || 0;
    const rows =
      (
        await this.db
          .prepare(`SELECT * FROM users ${w} ORDER BY id DESC LIMIT ? OFFSET ?`)
          .bind(...args, o.pageSize, (o.page - 1) * o.pageSize)
          .all<User>()
      ).results || [];
    return { rows, total };
  }
  async listSalesUsers(): Promise<User[]> {
    return (
      (await this.db.prepare("SELECT * FROM users WHERE role='sales' AND status='active' ORDER BY sales_level, id").all<User>())
        .results || []
    );
  }

  // ============ 客户余额账户 ============
  async getBalance(userId: number): Promise<number> {
    const r = await this.db.prepare("SELECT balance FROM users WHERE id=?").bind(userId).first<{ balance: number }>();
    return round2(r?.balance || 0);
  }

  /**
   * 余额变动唯一入口（充值 / 手工调整 / 欠款补收等非批量场景）。
   * change 正数入账、负数出账；出账用「条件 UPDATE」原子扣减，禁止透支。
   */
  async adjustBalance(o: {
    user_id: number;
    change: number;
    type: "recharge" | "consume" | "refund" | "void" | "adjust";
    ref_type?: string;
    ref_id?: number | null;
    ref_no?: string;
    operator_id?: number | null;
    remark?: string;
  }): Promise<{ before: number; after: number }> {
    const change = round2(o.change);
    if (!change) throw new Error("余额变动金额不能为 0");
    const u = await this.getUserById(o.user_id);
    if (!u) throw new Error("客户不存在");
    if (u.role !== "customer") throw new Error("仅客户账号可开通余额账户");

    // 原子扣减：余额不足时 UPDATE 影响 0 行，避免「先读后写」被并发覆盖成负数
    const r = await this.db
      .prepare("UPDATE users SET balance = ROUND(balance + ?, 2) WHERE id=? AND ROUND(balance + ?, 2) >= 0")
      .bind(change, o.user_id, change)
      .run();
    if (!r.meta.changes) {
      const cur = await this.getBalance(o.user_id);
      throw new Error(
        `客户「${u.nickname || u.username}」余额不足：当前可用余额 ¥${cur.toFixed(2)}，本次需扣减 ¥${Math.abs(change).toFixed(2)}`
      );
    }
    const after = await this.getBalance(o.user_id);
    const before = round2(after - change);
    await this.db
      .prepare(
        `INSERT INTO balance_logs (user_id,change,before_balance,after_balance,type,ref_type,ref_id,ref_no,operator_id,remark)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        o.user_id,
        change,
        before,
        after,
        o.type,
        o.ref_type || "manual",
        o.ref_id ?? null,
        o.ref_no || "",
        o.operator_id ?? null,
        o.remark || ""
      )
      .run();
    return { before, after };
  }

  async listBalanceLogs(o: {
    userId: number;
    page: number;
    pageSize: number;
  }): Promise<{ rows: BalanceLog[]; total: number }> {
    const total =
      (
        await this.db
          .prepare("SELECT COUNT(*) AS c FROM balance_logs WHERE user_id=?")
          .bind(o.userId)
          .first<{ c: number }>()
      )?.c || 0;
    const rows =
      (
        await this.db
          .prepare(
            `SELECT bl.*, op.nickname AS operator_name FROM balance_logs bl
             LEFT JOIN users op ON op.id=bl.operator_id
             WHERE bl.user_id=? ORDER BY bl.id DESC LIMIT ? OFFSET ?`
          )
          .bind(o.userId, o.pageSize, (o.page - 1) * o.pageSize)
          .all<BalanceLog>()
      ).results || [];
    return { rows, total };
  }

  /** 某张销售单累计从客户余额扣走的净额（作废时据此退回，重复作废为 0） */
  async salesBalanceNet(salesOrderId: number): Promise<number> {
    const r = await this.db
      .prepare("SELECT COALESCE(SUM(change),0) AS s FROM balance_logs WHERE ref_type='sales' AND ref_id=?")
      .bind(salesOrderId)
      .first<{ s: number }>();
    return round2(-(r?.s || 0));
  }

  /** 该销售单已通过退货单退回客户余额的金额（作废整单时要扣掉，避免重复退款） */
  async returnsBalanceRefund(salesOrderId: number): Promise<number> {
    const r = await this.db
      .prepare(
        `SELECT COALESCE(SUM(bl.change),0) AS s FROM balance_logs bl
         JOIN return_orders ro ON ro.id=bl.ref_id
         WHERE bl.ref_type='returns' AND ro.sales_order_id=? AND ro.status='done'`
      )
      .bind(salesOrderId)
      .first<{ s: number }>();
    return round2(r?.s || 0);
  }

  // ============ 密保问题 ============
  async setSecurityQuestions(userId: number, q1: string, a1hash: string, q2: string, a2hash: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO security_questions (user_id,q1,a1_hash,q2,a2_hash) VALUES (?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET q1=excluded.q1,a1_hash=excluded.a1_hash,q2=excluded.q2,a2_hash=excluded.a2_hash,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`
      )
      .bind(userId, q1, a1hash, q2, a2hash)
      .run();
  }
  async getSecurityQuestions(userId: number): Promise<SecQ | null> {
    return (await this.db.prepare("SELECT * FROM security_questions WHERE user_id=?").bind(userId).first<SecQ>()) || null;
  }

  // ============ 会话 ============
  async createSession(digest: string, userId: number, expiresAt: string, ip: string, ua: string): Promise<void> {
    await this.db
      .prepare("INSERT INTO sessions (id,user_id,expires_at,ip,ua) VALUES (?,?,?,?,?)")
      .bind(digest, userId, expiresAt, ip, ua)
      .run();
  }
  async getSessionWithUser(digest: string): Promise<{ user: User } | null> {
    const r = await this.db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
         WHERE s.id=? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') AND u.status='active'`
      )
      .bind(digest)
      .first<User>();
    return r ? { user: r } : null;
  }
  async deleteSession(digest: string): Promise<void> {
    await this.db.prepare("DELETE FROM sessions WHERE id=?").bind(digest).run();
  }
  async deleteUserSessionById(digest: string, userId: number): Promise<boolean> {
    const r = await this.db.prepare("DELETE FROM sessions WHERE id=? AND user_id=?").bind(digest, userId).run();
    return (r.meta.changes || 0) > 0;
  }
  async deleteUserSessions(userId: number, exceptDigest?: string): Promise<void> {
    if (exceptDigest) {
      await this.db.prepare("DELETE FROM sessions WHERE user_id=? AND id<>?").bind(userId, exceptDigest).run();
    } else {
      await this.db.prepare("DELETE FROM sessions WHERE user_id=?").bind(userId).run();
    }
  }
  async listSessionsByUser(
    userId: number
  ): Promise<{ id: string; created_at: string; expires_at: string; ip: string; ua: string }[]> {
    const r = await this.db
      .prepare("SELECT id,created_at,expires_at,ip,ua FROM sessions WHERE user_id=? ORDER BY created_at DESC")
      .bind(userId)
      .all<{ id: string; created_at: string; expires_at: string; ip: string; ua: string }>();
    return r.results || [];
  }
  async cleanExpiredSessions(): Promise<void> {
    await this.db.prepare("DELETE FROM sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')").run();
  }

  // ============ 登录/找回限流 ============
  async recordLoginAttempt(username: string, ip: string, success: boolean): Promise<void> {
    await this.db
      .prepare("INSERT INTO login_attempts (username,ip,success) VALUES (?,?,?)")
      .bind(username, ip, success ? 1 : 0)
      .run();
  }
  async countRecentFailures(username: string, ip: string, minutes: number): Promise<number> {
    const r = await this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM login_attempts
         WHERE username=? AND ip=? AND success=0 AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now',?)`
      )
      .bind(username, ip, `-${minutes} minutes`)
      .first<{ c: number }>();
    return r?.c || 0;
  }
  async recordRecoveryAttempt(username: string, ip: string, success: boolean): Promise<void> {
    await this.db
      .prepare("INSERT INTO recovery_attempts (username,ip,success) VALUES (?,?,?)")
      .bind(username, ip, success ? 1 : 0)
      .run();
  }
  async countRecentRecoveryFailures(username: string, minutes: number): Promise<number> {
    const r = await this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM recovery_attempts
         WHERE username=? AND success=0 AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now',?)`
      )
      .bind(username, `-${minutes} minutes`)
      .first<{ c: number }>();
    return r?.c || 0;
  }
  async cleanOldAttempts(): Promise<void> {
    await this.db.prepare("DELETE FROM login_attempts WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')").run();
    await this.db
      .prepare("DELETE FROM recovery_attempts WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')")
      .run();
  }

  // ============ 分类 / 供应商 ============
  async listCategories(): Promise<Category[]> {
    return (
      (
        await this.db
          .prepare(
            `SELECT c.*, COUNT(p.id) AS product_count
             FROM categories c LEFT JOIN products p ON p.category_id=c.id
             GROUP BY c.id ORDER BY c.sort, c.id`
          )
          .all<Category>()
      ).results || []
    );
  }
  async createCategory(name: string, sort = 0): Promise<number> {
    const r = await this.db.prepare("INSERT INTO categories (name, sort) VALUES (?, ?)").bind(name, sort).run();
    return Number(r.meta.last_row_id);
  }
  async renameCategory(id: number, name: string, sort?: number): Promise<void> {
    if (sort !== undefined) {
      await this.db.prepare("UPDATE categories SET name=?, sort=? WHERE id=?").bind(name, sort, id).run();
    } else {
      await this.db.prepare("UPDATE categories SET name=? WHERE id=?").bind(name, id).run();
    }
  }
  async deleteCategory(id: number): Promise<void> {
    const stmts = [
      this.db.prepare("UPDATE products SET category_id=NULL WHERE category_id=?").bind(id),
      this.db.prepare("DELETE FROM categories WHERE id=?").bind(id),
    ];
    await this.db.batch(stmts);
  }
  async listSuppliers(q?: string): Promise<Supplier[]> {
    if (q) {
      return (
        (
          await this.db
            .prepare(
              `SELECT s.*, COUNT(p.id) AS product_count
               FROM suppliers s LEFT JOIN products p ON p.supplier_id=s.id
               WHERE s.name LIKE ? OR s.phone LIKE ? OR s.contact LIKE ?
               GROUP BY s.id ORDER BY s.id DESC`
            )
            .bind(`%${q}%`, `%${q}%`, `%${q}%`)
            .all<Supplier>()
        ).results || []
      );
    }
    return (
      (
        await this.db
          .prepare(
            `SELECT s.*, COUNT(p.id) AS product_count
             FROM suppliers s LEFT JOIN products p ON p.supplier_id=s.id
             GROUP BY s.id ORDER BY s.id DESC`
          )
          .all<Supplier>()
      ).results || []
    );
  }
  async getSupplier(id: number): Promise<Supplier | null> {
    return (await this.db.prepare("SELECT * FROM suppliers WHERE id=?").bind(id).first<Supplier>()) || null;
  }
  async createSupplier(d: { name: string; contact?: string; phone?: string; address?: string }): Promise<number> {
    const r = await this.db
      .prepare("INSERT INTO suppliers (name,contact,phone,address) VALUES (?,?,?,?)")
      .bind(d.name, d.contact || "", d.phone || "", d.address || "")
      .run();
    return Number(r.meta.last_row_id);
  }
  async updateSupplier(id: number, d: { name: string; contact?: string; phone?: string; address?: string }): Promise<void> {
    await this.db
      .prepare("UPDATE suppliers SET name=?,contact=?,phone=?,address=? WHERE id=?")
      .bind(d.name, d.contact || "", d.phone || "", d.address || "", id)
      .run();
  }
  async deleteSupplier(id: number): Promise<void> {
    const c = await this.db
      .prepare("SELECT COUNT(*) AS c FROM products WHERE supplier_id=?")
      .bind(id)
      .first<{ c: number }>();
    if ((c?.c || 0) > 0) throw new Error("该供应商下还有关联商品，请先解除关联后再删除");
    const poCount = await this.db
      .prepare("SELECT COUNT(*) AS c FROM purchase_orders WHERE supplier_id=?")
      .bind(id)
      .first<{ c: number }>();
    if ((poCount?.c || 0) > 0) throw new Error("该供应商已有历史进货单据，禁止直接删除");
    await this.db.prepare("DELETE FROM suppliers WHERE id=?").bind(id).run();
  }

  // ============ 商品 ============
  async listProducts(o: {
    q?: string;
    categoryId?: number;
    status?: string;
    lowOnly?: boolean;
    page: number;
    pageSize: number;
  }): Promise<{ rows: Product[]; total: number }> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (o.q) {
      where.push("(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)");
      args.push(`%${o.q}%`, `%${o.q}%`, `%${o.q}%`);
    }
    if (o.categoryId) {
      where.push("p.category_id=?");
      args.push(o.categoryId);
    }
    if (o.status) {
      where.push("p.status=?");
      args.push(o.status);
    }
    if (o.lowOnly) {
      where.push("p.status='on' AND p.stock <= p.min_stock");
    }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const total =
      (await this.db.prepare(`SELECT COUNT(*) AS c FROM products p ${w}`).bind(...args).first<{ c: number }>())?.c || 0;
    const rows =
      (
        await this.db
          .prepare(
            `SELECT p.*, c.name AS category_name, s.name AS supplier_name FROM products p
             LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN suppliers s ON s.id=p.supplier_id
             ${w} ORDER BY p.id DESC LIMIT ? OFFSET ?`
          )
          .bind(...args, o.pageSize, (o.page - 1) * o.pageSize)
          .all<Product>()
      ).results || [];
    return { rows, total };
  }
  async getProduct(id: number): Promise<Product | null> {
    return (
      (await this.db
        .prepare(
          `SELECT p.*, c.name AS category_name, s.name AS supplier_name FROM products p
           LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=?`
        )
        .bind(id)
        .first<Product>()) || null
    );
  }
  async createProduct(d: {
    name: string;
    category_id?: number | null;
    supplier_id?: number | null;
    sku?: string | null;
    barcode?: string;
    unit?: string;
    purchase_price?: number;
    sale_price?: number;
    stock?: number;
    min_stock?: number;
    max_stock?: number;
    image_key?: string;
    remark?: string;
    operator_id?: number | null;
  }): Promise<number> {
    const initStock = round2(d.stock || 0);
    const maxStock = round2(d.max_stock || 0);
    if (initStock < 0) throw new Error("期初库存不能为负数");
    if (maxStock > 0 && initStock > maxStock) {
      throw new Error(`期初库存（${initStock}）不能超过库存上限（${maxStock}）`);
    }
    const skuVal = d.sku?.trim() ? d.sku.trim() : uid("SKU");
    const r = await this.db
      .prepare(
        `INSERT INTO products (name,category_id,supplier_id,sku,barcode,unit,purchase_price,sale_price,stock,min_stock,max_stock,image_key,remark)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        d.name,
        d.category_id ?? null,
        d.supplier_id ?? null,
        skuVal,
        d.barcode || "",
        d.unit || "件",
        round2(d.purchase_price || 0),
        round2(d.sale_price || 0),
        initStock,
        round2(d.min_stock || 0),
        maxStock,
        d.image_key || "",
        d.remark || ""
      )
      .run();
    const productId = Number(r.meta.last_row_id);
    if (initStock > 0) {
      await this.db
        .prepare(
          `INSERT INTO stock_movements (product_id,change,before_qty,after_qty,type,ref_type,ref_id,operator_id,remark)
           VALUES (?,?,?,?, 'initial_in','product',?,?,?)`
        )
        .bind(productId, initStock, 0, initStock, productId, d.operator_id ?? null, "商品建档期初库存")
        .run();
    }
    return productId;
  }
  async updateProduct(
    id: number,
    d: {
      name: string;
      category_id?: number | null;
      supplier_id?: number | null;
      sku?: string | null;
      barcode?: string;
      unit?: string;
      purchase_price?: number;
      sale_price?: number;
      min_stock?: number;
      max_stock?: number;
      image_key?: string;
      remark?: string;
      status?: string;
    }
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE products SET name=?,category_id=?,supplier_id=?,sku=?,barcode=?,unit=?,purchase_price=?,sale_price=?,
         min_stock=?,max_stock=?,image_key=?,remark=?,status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`
      )
      .bind(
        d.name,
        d.category_id ?? null,
        d.supplier_id ?? null,
        d.sku?.trim() ? d.sku.trim() : null,
        d.barcode || "",
        d.unit || "件",
        round2(d.purchase_price || 0),
        round2(d.sale_price || 0),
        round2(d.min_stock || 0),
        round2(d.max_stock || 0),
        d.image_key || "",
        d.remark || "",
        d.status || "on",
        id
      )
      .run();
  }
  async deleteProduct(id: number): Promise<void> {
    const c = await this.db
      .prepare("SELECT COUNT(*) AS c FROM stock_movements WHERE product_id=?")
      .bind(id)
      .first<{ c: number }>();
    if ((c?.c || 0) > 0) throw new Error("该商品已有库存流水记录，禁止删除（可将其下架）");
    await this.db.prepare("DELETE FROM products WHERE id=?").bind(id).run();
  }
  /** 画册图库中每张图片被多少商品引用（key → 商品数），用于选图展示与删除保护 */
  async imageUsage(): Promise<Record<string, number>> {
    const r = await this.db
      .prepare("SELECT image_key, COUNT(*) AS c FROM products WHERE image_key<>'' GROUP BY image_key")
      .all<{ image_key: string; c: number }>();
    const out: Record<string, number> = {};
    for (const row of r.results || []) out[row.image_key] = Number(row.c);
    return out;
  }
  async lowStockProducts(): Promise<Product[]> {
    return (
      (
        await this.db
          .prepare(
            `SELECT p.*, c.name AS category_name, s.name AS supplier_name FROM products p
             LEFT JOIN categories c ON c.id=p.category_id
             LEFT JOIN suppliers s ON s.id=p.supplier_id
             WHERE p.status='on' AND p.stock <= p.min_stock ORDER BY (p.stock - p.min_stock) ASC, p.stock ASC`
          )
          .all<Product>()
      ).results || []
    );
  }
  async countLowStock(): Promise<number> {
    const r = await this.db
      .prepare("SELECT COUNT(*) AS c FROM products WHERE status='on' AND stock <= min_stock")
      .first<{ c: number }>();
    return r?.c || 0;
  }

  // ============ 进货 ============
  async createPurchaseOrder(o: {
    supplier_id: number | null;
    operator_id: number;
    paid?: number;
    remark: string;
    items: { product_id: number; qty: number; price: number }[];
  }): Promise<string> {
    if (!o.items.length) throw new Error("请至少添加一件商品");
    const prods = new Map<number, Product>();
    for (const id of [...new Set(o.items.map((i) => i.product_id))]) {
      const p = await this.getProduct(id);
      if (!p) throw new Error("所选商品不存在");
      prods.set(id, { ...p });
    }
    const simStock = new Map<number, number>();
    for (const [id, p] of prods) simStock.set(id, p.stock);

    let total = 0;
    for (const it of o.items) {
      const p = prods.get(it.product_id)!;
      if (it.qty <= 0) throw new Error(`商品「${p.name}」进货数量必须大于 0`);
      if (it.price < 0) throw new Error(`商品「${p.name}」进货单价不能为负数`);
      const nextStock = round2((simStock.get(it.product_id) || 0) + it.qty);
      if (p.max_stock > 0 && nextStock > p.max_stock) {
        throw new Error(`商品「${p.name}」入库后（${nextStock} ${p.unit}）将超过库存上限（${p.max_stock} ${p.unit}）`);
      }
      simStock.set(it.product_id, nextStock);
      total += round2(it.qty * it.price);
    }
    total = round2(total);
    const paid = o.paid !== undefined ? round2(Math.max(0, o.paid)) : total;
    const order_no = uid("PO");
    const r = await this.db
      .prepare("INSERT INTO purchase_orders (order_no,supplier_id,total,paid,operator_id,remark) VALUES (?,?,?,?,?,?)")
      .bind(order_no, o.supplier_id, total, paid, o.operator_id, o.remark || "")
      .run();
    const orderId = Number(r.meta.last_row_id);
    const stmts: D1PreparedStatement[] = [];

    const runStock = new Map<number, number>();
    const runCost = new Map<number, number>();
    for (const [id, p] of prods) {
      runStock.set(id, p.stock);
      runCost.set(id, p.purchase_price);
    }

    for (const it of o.items) {
      const beforeQty = runStock.get(it.product_id)!;
      const afterQty = round2(beforeQty + it.qty);
      const prevCost = runCost.get(it.product_id)!;
      const newCost =
        beforeQty > 0 && afterQty > 0
          ? round2((beforeQty * prevCost + it.qty * it.price) / afterQty)
          : round2(it.price);
      runStock.set(it.product_id, afterQty);
      runCost.set(it.product_id, newCost);

      const amount = round2(it.qty * it.price);
      stmts.push(
        this.db
          .prepare("INSERT INTO purchase_items (order_id,product_id,qty,price,amount) VALUES (?,?,?,?,?)")
          .bind(orderId, it.product_id, round2(it.qty), round2(it.price), amount)
      );
      stmts.push(
        this.db
          .prepare(
            "UPDATE products SET stock=?, purchase_price=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
          )
          .bind(afterQty, newCost, it.product_id)
      );
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO stock_movements (product_id,change,before_qty,after_qty,type,ref_type,ref_id,operator_id,remark)
             VALUES (?,?,?,?, 'purchase_in','purchase',?,?,?)`
          )
          .bind(it.product_id, round2(it.qty), beforeQty, afterQty, orderId, o.operator_id, `进货单 ${order_no}`)
      );
    }
    await this.db.batch(stmts);
    return order_no;
  }
  async listPurchaseOrders(o: {
    page: number;
    pageSize: number;
    q?: string;
    status?: string;
  }): Promise<{ rows: PurchaseOrder[]; total: number }> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (o.q) {
      where.push("(po.order_no LIKE ? OR s.name LIKE ?)");
      args.push(`%${o.q}%`, `%${o.q}%`);
    }
    if (o.status) {
      where.push("po.status=?");
      args.push(o.status);
    }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const total =
      (
        await this.db
          .prepare(`SELECT COUNT(*) AS c FROM purchase_orders po LEFT JOIN suppliers s ON s.id=po.supplier_id ${w}`)
          .bind(...args)
          .first<{ c: number }>()
      )?.c || 0;
    const rows =
      (
        await this.db
          .prepare(
            `SELECT po.*, s.name AS supplier_name, u.nickname AS operator_name FROM purchase_orders po
             LEFT JOIN suppliers s ON s.id=po.supplier_id LEFT JOIN users u ON u.id=po.operator_id
             ${w} ORDER BY po.id DESC LIMIT ? OFFSET ?`
          )
          .bind(...args, o.pageSize, (o.page - 1) * o.pageSize)
          .all<PurchaseOrder>()
      ).results || [];
    return { rows, total };
  }
  async getPurchaseOrder(id: number): Promise<PurchaseOrder | null> {
    const o = await this.db
      .prepare(
        `SELECT po.*, s.name AS supplier_name, u.nickname AS operator_name FROM purchase_orders po
         LEFT JOIN suppliers s ON s.id=po.supplier_id LEFT JOIN users u ON u.id=po.operator_id WHERE po.id=?`
      )
      .bind(id)
      .first<PurchaseOrder>();
    if (!o) return null;
    o.items =
      (
        await this.db
          .prepare(
            `SELECT pi.*, p.name AS product_name, p.sku AS sku, p.unit AS unit
             FROM purchase_items pi LEFT JOIN products p ON p.id=pi.product_id WHERE pi.order_id=?`
          )
          .bind(id)
          .all<PurchaseItem>()
      ).results || [];
    return o;
  }
  async voidPurchaseOrder(id: number, operatorId: number): Promise<void> {
    const o = await this.getPurchaseOrder(id);
    if (!o || o.status !== "done") throw new Error("该进货单不存在或已作废");
    const runStock = new Map<number, number>();
    const prods = new Map<number, Product>();
    for (const it of o.items || []) {
      if (!prods.has(it.product_id)) {
        const p = await this.getProduct(it.product_id);
        if (p) {
          prods.set(it.product_id, p);
          runStock.set(it.product_id, p.stock);
        }
      }
    }
    const stmts: D1PreparedStatement[] = [
      this.db.prepare("UPDATE purchase_orders SET status='void' WHERE id=?").bind(id),
    ];
    for (const it of o.items || []) {
      const p = prods.get(it.product_id);
      if (!p) continue;
      const beforeQty = runStock.get(it.product_id)!;
      if (beforeQty < it.qty) {
        throw new Error(`商品「${p.name}」当前库存（${beforeQty}）不足以扣回进货数（${it.qty}），无法作废`);
      }
      const afterQty = round2(beforeQty - it.qty);
      runStock.set(it.product_id, afterQty);
      stmts.push(this.db.prepare("UPDATE products SET stock=? WHERE id=?").bind(afterQty, it.product_id));
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO stock_movements (product_id,change,before_qty,after_qty,type,ref_type,ref_id,operator_id,remark)
             VALUES (?,?,?,?, 'void','purchase',?,?,?)`
          )
          .bind(it.product_id, -round2(it.qty), beforeQty, afterQty, id, operatorId, `作废进货单 ${o.order_no}`)
      );
    }
    await this.db.batch(stmts);
  }

  // ============ 销售 ============
  async createSalesOrder(o: {
    customer_id: number | null;
    sales_id: number | null;
    operator_id: number;
    discount?: number;
    paid?: number;
    payment?: string;
    shipping_name?: string;
    shipping_phone?: string;
    shipping_address?: string;
    remark?: string;
    items: { product_id: number; qty: number; price: number }[];
  }): Promise<string> {
    if (!o.items.length) throw new Error("请至少添加一件商品");
    const settings = await this.getSettings();
    const prods = new Map<number, Product>();
    for (const id of [...new Set(o.items.map((i) => i.product_id))]) {
      const p = await this.getProduct(id);
      if (!p) throw new Error("所选商品不存在");
      prods.set(id, p);
    }
    const simStock = new Map<number, number>();
    for (const [id, p] of prods) simStock.set(id, p.stock);

    let subtotal = 0;
    let rawProfit = 0;
    for (const it of o.items) {
      const p = prods.get(it.product_id)!;
      if (p.status !== "on") throw new Error(`商品「${p.name}」已下架，无法销售`);
      if (it.qty <= 0) throw new Error(`商品「${p.name}」销售数量必须大于 0`);
      if (it.price < 0) throw new Error(`商品「${p.name}」售价不能为负数`);
      const avail = simStock.get(it.product_id)!;
      if (avail < it.qty) {
        throw new Error(`商品「${p.name}」库存不足（当前可用 ${avail} ${p.unit}，需扣减 ${it.qty} ${p.unit}）`);
      }
      simStock.set(it.product_id, round2(avail - it.qty));
      subtotal += round2(it.qty * it.price);
      rawProfit += (it.price - p.purchase_price) * it.qty;
    }
    subtotal = round2(subtotal);
    const discount = round2(Math.max(0, o.discount || 0));
    if (discount > subtotal) {
      throw new Error(`折扣金额（¥${discount}）不能超过商品小计总额（¥${subtotal}）`);
    }
    const total = round2(Math.max(0, subtotal - discount));
    const profit = round2(rawProfit - discount);
    const payment = (o.payment || "cash").trim() || "cash";
    let paid = round2(Math.max(0, o.paid ?? 0));
    if (paid > total) {
      throw new Error(`实收金额（¥${paid}）不能超过应收总额（¥${total}）`);
    }
    let orderDebt = round2(total - paid);

    // 余额支付：仅限已建档客户，按应收全额扣减余额（不允许部分余额 + 部分挂账，避免账目混乱）
    let balanceBefore = 0;
    let balanceDeduct = 0;
    if (payment === "balance") {
      if (!o.customer_id) throw new Error("余额支付需先选择客户，散客（不记名）没有余额账户");
      const bu = await this.getUserById(o.customer_id);
      if (!bu || bu.role !== "customer") throw new Error("余额支付需先选择客户，散客（不记名）没有余额账户");
      balanceBefore = round2(bu.balance || 0);
      if (balanceBefore < total) {
        throw new Error(
          `客户「${bu.nickname || bu.username}」余额不足：当前可用余额 ¥${balanceBefore.toFixed(2)}，本单需支付 ¥${total.toFixed(2)}，请先充值或更换结算方式`
        );
      }
      balanceDeduct = total;
      paid = total;
      orderDebt = 0;
    }

    // 读取关联客户信息：校验授信额度 + 自动补全/回写默认收货信息
    let shipName = (o.shipping_name || "").trim();
    let shipPhone = (o.shipping_phone || "").trim();
    let shipAddr = (o.shipping_address || "").trim();

    if (o.customer_id) {
      const customer = await this.getUserById(o.customer_id);
      if (customer && customer.role === "customer") {
        if (!shipName) shipName = customer.shipping_name || customer.nickname || customer.username;
        if (!shipPhone) shipPhone = customer.phone || "";
        if (!shipAddr) shipAddr = customer.address || "";

        if (orderDebt > 0 && customer.credit_limit > 0) {
          const st = await this.customerStats(customer.id);
          if (round2(st.debt + orderDebt) > customer.credit_limit) {
            const remain = Math.max(0, round2(customer.credit_limit - st.debt));
            throw new Error(
              `超出客户「${customer.nickname || customer.username}」的赊账额度上限（额度 ¥${customer.credit_limit}，已欠 ¥${st.debt}，剩余可赊 ¥${remain}）`
            );
          }
        }
        // 如客户档案尚未保存默认联系电话或收货地址，下单填写后自动同步回写到客户档案
        const userPatch: Partial<Pick<User, "shipping_name" | "phone" | "address">> = {};
        if (shipName && !customer.shipping_name) userPatch.shipping_name = shipName;
        if (shipPhone && !customer.phone) userPatch.phone = shipPhone;
        if (shipAddr && !customer.address) userPatch.address = shipAddr;
        if (Object.keys(userPatch).length > 0) {
          await this.updateUser(customer.id, userPatch);
        }
      }
    }

    const order_no = uid("SO");
    const r = await this.db
      .prepare(
        `INSERT INTO sales_orders (order_no,customer_id,sales_id,total,discount,paid,payment,shipping_name,shipping_phone,shipping_address,remark)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        order_no,
        o.customer_id ?? null,
        o.sales_id ?? null,
        total,
        discount,
        paid,
        payment,
        shipName,
        shipPhone,
        shipAddr,
        o.remark || ""
      )
      .run();
    const orderId = Number(r.meta.last_row_id);
    const stmts: D1PreparedStatement[] = [];

    // 余额支付：与订单、库存、佣金同批提交，保证「扣款成功 ⇔ 订单成立」
    if (balanceDeduct > 0 && o.customer_id) {
      const afterBalance = round2(balanceBefore - balanceDeduct);
      stmts.push(this.db.prepare("UPDATE users SET balance=? WHERE id=?").bind(afterBalance, o.customer_id));
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO balance_logs (user_id,change,before_balance,after_balance,type,ref_type,ref_id,ref_no,operator_id,remark)
             VALUES (?,?,?,?, 'consume','sales',?,?,?,?)`
          )
          .bind(
            o.customer_id,
            -balanceDeduct,
            balanceBefore,
            afterBalance,
            orderId,
            order_no,
            o.operator_id,
            `余额支付销售单 ${order_no}`
          )
      );
    }

    const runStock = new Map<number, number>();
    for (const [id, p] of prods) runStock.set(id, p.stock);

    for (const it of o.items) {
      const p = prods.get(it.product_id)!;
      const beforeQty = runStock.get(it.product_id)!;
      const afterQty = round2(beforeQty - it.qty);
      runStock.set(it.product_id, afterQty);
      const amount = round2(it.qty * it.price);
      stmts.push(
        this.db
          .prepare("INSERT INTO sales_items (order_id,product_id,qty,price,cost,amount) VALUES (?,?,?,?,?,?)")
          .bind(orderId, it.product_id, round2(it.qty), round2(it.price), p.purchase_price, amount)
      );
      stmts.push(
        this.db
          .prepare("UPDATE products SET stock=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
          .bind(afterQty, it.product_id)
      );
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO stock_movements (product_id,change,before_qty,after_qty,type,ref_type,ref_id,operator_id,remark)
             VALUES (?,?,?,?, 'sale_out','sales',?,?,?)`
          )
          .bind(it.product_id, -round2(it.qty), beforeQty, afterQty, orderId, o.operator_id, `销售单 ${order_no}`)
      );
    }
    // ---- 二级分销自动计提佣金 ----
    if (o.sales_id) {
      const s = await this.getUserById(o.sales_id);
      if (s && s.role === "sales" && s.status === "active") {
        const base = (settings.commission_base || "profit") === "profit" ? profit : total;
        if (s.sales_level === 2) {
          const r2 = s.commission_rate > 0 ? s.commission_rate : parseFloat(settings.commission_l2_default || "8");
          if (r2 > 0 && base > 0) {
            stmts.push(
              this.db
                .prepare("INSERT INTO commissions (order_id,sales_id,level,base_amount,rate,amount) VALUES (?,?,?,?,?,?)")
                .bind(orderId, s.id, 2, round2(base), r2, round2((base * r2) / 100))
            );
          }
          if (s.parent_id) {
            const parent = await this.getUserById(s.parent_id);
            const ro = parseFloat(settings.commission_l1_override || "2");
            if (parent && parent.role === "sales" && parent.status === "active" && ro > 0 && base > 0) {
              stmts.push(
                this.db
                  .prepare("INSERT INTO commissions (order_id,sales_id,level,base_amount,rate,amount) VALUES (?,?,?,?,?,?)")
                  .bind(orderId, parent.id, 1, round2(base), ro, round2((base * ro) / 100))
              );
            }
          }
        } else {
          const r1 = s.commission_rate > 0 ? s.commission_rate : parseFloat(settings.commission_l1_default || "5");
          if (r1 > 0 && base > 0) {
            stmts.push(
              this.db
                .prepare("INSERT INTO commissions (order_id,sales_id,level,base_amount,rate,amount) VALUES (?,?,?,?,?,?)")
                .bind(orderId, s.id, 1, round2(base), r1, round2((base * r1) / 100))
            );
          }
        }
      }
    }
    await this.db.batch(stmts);
    return order_no;
  }

  /** 销售单欠款补收/核销（支持现金 / 微信 / 支付宝 / 银行 / 余额） */
  async paySalesOrderDebt(id: number, amount: number, payment?: string, operatorId?: number): Promise<SalesOrder> {
    const o = await this.getSalesOrder(id);
    if (!o || o.status !== "done") throw new Error("该销售单不存在或已作废");
    const debt = round2(o.total - o.paid);
    if (debt <= 0) throw new Error("该销售单已全额结清，无需补收");
    const payAmt = round2(amount);
    if (payAmt <= 0 || payAmt > debt) {
      throw new Error(`收款金额需在 ¥0.01 ~ ¥${debt.toFixed(2)} 之间`);
    }
    const newPaid = round2(o.paid + payAmt);
    const newPayment = payment && payment !== "credit" ? payment : o.payment === "credit" && newPaid >= o.total ? "cash" : o.payment;
    // 余额补收：先从客户余额扣款，扣款失败则不落账（余额不足会直接抛错）
    if (newPayment === "balance") {
      if (!o.customer_id) throw new Error("该销售单未关联客户，无法使用余额支付");
      await this.adjustBalance({
        user_id: o.customer_id,
        change: -payAmt,
        type: "consume",
        ref_type: "sales",
        ref_id: id,
        ref_no: o.order_no,
        operator_id: operatorId ?? null,
        remark: `欠款补收（余额支付）${o.order_no}`,
      });
    }
    await this.db
      .prepare("UPDATE sales_orders SET paid=?, payment=? WHERE id=?")
      .bind(newPaid, newPayment, id)
      .run();
    return (await this.getSalesOrder(id))!;
  }

  async listSalesOrders(o: {
    page: number;
    pageSize: number;
    q?: string;
    salesId?: number;
    customerId?: number;
    status?: string;
    debtOnly?: boolean;
  }): Promise<{ rows: SalesOrder[]; total: number }> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (o.q) {
      where.push("(so.order_no LIKE ? OR cu.nickname LIKE ? OR cu.username LIKE ? OR so.shipping_phone LIKE ?)");
      args.push(`%${o.q}%`, `%${o.q}%`, `%${o.q}%`, `%${o.q}%`);
    }
    if (o.salesId) {
      where.push("so.sales_id=?");
      args.push(o.salesId);
    }
    if (o.customerId) {
      where.push("so.customer_id=?");
      args.push(o.customerId);
    }
    if (o.status) {
      where.push("so.status=?");
      args.push(o.status);
    }
    if (o.debtOnly) {
      where.push("so.status='done' AND so.total > so.paid");
    }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const total =
      (
        await this.db
          .prepare(`SELECT COUNT(*) AS c FROM sales_orders so LEFT JOIN users cu ON cu.id=so.customer_id ${w}`)
          .bind(...args)
          .first<{ c: number }>()
      )?.c || 0;
    const rows =
      (
        await this.db
          .prepare(
            `SELECT so.*, cu.nickname AS customer_name, sa.nickname AS sales_name,
               (SELECT COUNT(*) FROM return_orders ro WHERE ro.sales_order_id=so.id AND ro.status='done') AS return_cnt
             FROM sales_orders so
             LEFT JOIN users cu ON cu.id=so.customer_id LEFT JOIN users sa ON sa.id=so.sales_id
             ${w} ORDER BY so.id DESC LIMIT ? OFFSET ?`
          )
          .bind(...args, o.pageSize, (o.page - 1) * o.pageSize)
          .all<SalesOrder>()
      ).results || [];
    return { rows, total };
  }
  /** 按单号精确查单（办理退货时用，避免模糊搜索命中别的单） */
  async getSalesOrderByNo(order_no: string): Promise<SalesOrder | null> {
    const hit = await this.db
      .prepare("SELECT id FROM sales_orders WHERE order_no=?")
      .bind(order_no)
      .first<{ id: number }>();
    return hit ? this.getSalesOrder(hit.id) : null;
  }
  async getSalesOrder(id: number): Promise<SalesOrder | null> {
    const o = await this.db
      .prepare(
        `SELECT so.*, cu.nickname AS customer_name, cu.username AS customer_username, sa.nickname AS sales_name
         FROM sales_orders so LEFT JOIN users cu ON cu.id=so.customer_id LEFT JOIN users sa ON sa.id=so.sales_id WHERE so.id=?`
      )
      .bind(id)
      .first<SalesOrder & { customer_username?: string }>();
    if (!o) return null;
    o.items =
      (
        await this.db
          .prepare(
            `SELECT si.*, p.name AS product_name, p.sku AS sku, p.unit AS unit
             FROM sales_items si LEFT JOIN products p ON p.id=si.product_id WHERE si.order_id=?`
          )
          .bind(id)
          .all<SalesItem>()
      ).results || [];
    return o;
  }
  async voidSalesOrder(id: number, operatorId: number): Promise<void> {
    const o = await this.getSalesOrder(id);
    if (!o || o.status !== "done") throw new Error("该销售单不存在或已作废");
    const runStock = new Map<number, number>();
    const prods = new Map<number, Product>();
    for (const it of o.items || []) {
      if (!prods.has(it.product_id)) {
        const p = await this.getProduct(it.product_id);
        if (p) {
          prods.set(it.product_id, p);
          runStock.set(it.product_id, p.stock);
        }
      }
    }
    const stmts: D1PreparedStatement[] = [
      this.db.prepare("UPDATE sales_orders SET status='void' WHERE id=?").bind(id),
      this.db.prepare("DELETE FROM commissions WHERE order_id=? AND status='pending'").bind(id),
    ];
    for (const it of o.items || []) {
      const p = prods.get(it.product_id);
      if (!p) continue;
      const beforeQty = runStock.get(it.product_id)!;
      const afterQty = round2(beforeQty + it.qty);
      runStock.set(it.product_id, afterQty);
      stmts.push(this.db.prepare("UPDATE products SET stock=? WHERE id=?").bind(afterQty, it.product_id));
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO stock_movements (product_id,change,before_qty,after_qty,type,ref_type,ref_id,operator_id,remark)
             VALUES (?,?,?,?, 'void','sales',?,?,?)`
          )
          .bind(it.product_id, round2(it.qty), beforeQty, afterQty, id, operatorId, `作废销售单 ${o.order_no}`)
      );
    }
    // 作废时把该单已从客户余额扣走的金额原路退回（扣除退货单已退回的部分，避免重复退款）
    const refundedByReturns = o.customer_id ? await this.returnsBalanceRefund(id) : 0;
    const usedBalance = round2((await this.salesBalanceNet(id)) - refundedByReturns);
    if (usedBalance > 0 && o.customer_id) {
      const cu = await this.getUserById(o.customer_id);
      if (cu) {
        const before = round2(cu.balance || 0);
        const after = round2(before + usedBalance);
        stmts.push(this.db.prepare("UPDATE users SET balance=? WHERE id=?").bind(after, o.customer_id));
        stmts.push(
          this.db
            .prepare(
              `INSERT INTO balance_logs (user_id,change,before_balance,after_balance,type,ref_type,ref_id,ref_no,operator_id,remark)
               VALUES (?,?,?,?, 'void','sales',?,?,?,?)`
            )
            .bind(
              o.customer_id,
              usedBalance,
              before,
              after,
              id,
              o.order_no,
              operatorId,
              `作废销售单 ${o.order_no}，余额原路退回`
            )
        );
      }
    }
    await this.db.batch(stmts);
  }

  // ============ 销售退货 ============
  async createReturnOrder(o: {
    sales_order_id: number | null;
    customer_id: number | null;
    operator_id: number;
    remark: string;
    items: { product_id: number; qty: number; price: number }[];
  }): Promise<string> {
    if (!o.items.length) throw new Error("请至少添加一件商品");
    let total = 0;
    const prods = new Map<number, Product>();
    for (const id of [...new Set(o.items.map((i) => i.product_id))]) {
      const p = await this.getProduct(id);
      if (!p) throw new Error("所选商品不存在");
      prods.set(id, p);
    }
    let linkedOrder: SalesOrder | null = null;
    if (o.sales_order_id) {
      linkedOrder = await this.getSalesOrder(o.sales_order_id);
      if (!linkedOrder || linkedOrder.status !== "done") {
        throw new Error("关联的原销售单不存在或已作废");
      }
      if (!o.customer_id && linkedOrder.customer_id) {
        o.customer_id = linkedOrder.customer_id;
      }
      if (o.customer_id && linkedOrder.customer_id && o.customer_id !== linkedOrder.customer_id) {
        throw new Error(`退货客户与原销售单 ${linkedOrder.order_no} 的客户不一致，请重新选择`);
      }
      // 可退数量与退货单价均以原单为准：可退 = 售出 - 有效退货单已退
      const returnable = await this.returnableQtyByOrder(linkedOrder.id);
      const priceCap = new Map<number, number>();
      for (const si of linkedOrder.items || []) {
        priceCap.set(si.product_id, Math.max(priceCap.get(si.product_id) || 0, round2(si.price)));
      }
      const reqQtyMap = new Map<number, number>();
      for (const it of o.items) {
        reqQtyMap.set(it.product_id, round2((reqQtyMap.get(it.product_id) || 0) + it.qty));
      }
      for (const [pid, reqQty] of reqQtyMap) {
        const pName = prods.get(pid)?.name || `#${pid}`;
        const e = returnable.get(pid);
        if (!e) throw new Error(`原销售单 ${linkedOrder.order_no} 中不包含商品「${pName}」，无法办理退货`);
        if (e.avail <= 0) {
          throw new Error(
            `商品「${pName}」在原销售单 ${linkedOrder.order_no} 中已全部退完（售出 ${e.sold}，已退 ${e.returned}），无可退数量`
          );
        }
        if (reqQty > e.avail) {
          throw new Error(
            `商品「${pName}」本次退货 ${reqQty}，超过可退数量 ${e.avail}（原单售出 ${e.sold}，已退 ${e.returned}）`
          );
        }
      }
      for (const it of o.items) {
        const cap = priceCap.get(it.product_id);
        if (cap !== undefined && round2(it.price) > cap) {
          throw new Error(
            `商品「${prods.get(it.product_id)?.name || `#${it.product_id}`}」退货单价 ${round2(it.price)} 高于原成交单价 ${cap}`
          );
        }
      }
    }

    for (const it of o.items) {
      if (it.qty <= 0) throw new Error("退货数量必须大于 0");
      if (it.price < 0) throw new Error("退货单价不能为负数");
      total += round2(it.qty * it.price);
    }
    total = round2(total);
    const order_no = uid("RT");
    const r = await this.db
      .prepare(
        "INSERT INTO return_orders (order_no,sales_order_id,customer_id,total,operator_id,remark) VALUES (?,?,?,?,?,?)"
      )
      .bind(order_no, o.sales_order_id ?? null, o.customer_id ?? null, total, o.operator_id, o.remark || "")
      .run();
    const orderId = Number(r.meta.last_row_id);
    const stmts: D1PreparedStatement[] = [];

    const runStock = new Map<number, number>();
    for (const [id, p] of prods) runStock.set(id, p.stock);

    for (const it of o.items) {
      const beforeQty = runStock.get(it.product_id)!;
      const afterQty = round2(beforeQty + it.qty);
      runStock.set(it.product_id, afterQty);
      const amount = round2(it.qty * it.price);
      stmts.push(
        this.db
          .prepare("INSERT INTO return_items (order_id,product_id,qty,price,amount) VALUES (?,?,?,?,?)")
          .bind(orderId, it.product_id, round2(it.qty), round2(it.price), amount)
      );
      stmts.push(
        this.db
          .prepare("UPDATE products SET stock=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
          .bind(afterQty, it.product_id)
      );
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO stock_movements (product_id,change,before_qty,after_qty,type,ref_type,ref_id,operator_id,remark)
             VALUES (?,?,?,?, 'return_in','returns',?,?,?)`
          )
          .bind(it.product_id, round2(it.qty), beforeQty, afterQty, orderId, o.operator_id, `退货单 ${order_no}`)
      );
    }
    // 原单为「余额支付」时，退货金额原路退回客户余额（与库存回补同批提交）
    if (linkedOrder && linkedOrder.payment === "balance" && o.customer_id && total > 0) {
      const cu = await this.getUserById(o.customer_id);
      if (cu && cu.role === "customer") {
        const before = round2(cu.balance || 0);
        const after = round2(before + total);
        stmts.push(this.db.prepare("UPDATE users SET balance=? WHERE id=?").bind(after, o.customer_id));
        stmts.push(
          this.db
            .prepare(
              `INSERT INTO balance_logs (user_id,change,before_balance,after_balance,type,ref_type,ref_id,ref_no,operator_id,remark)
               VALUES (?,?,?,?, 'refund','returns',?,?,?,?)`
            )
            .bind(o.customer_id, total, before, after, orderId, order_no, o.operator_id, `退货单 ${order_no} 退款回余额`)
        );
      }
    }
    await this.db.batch(stmts);
    return order_no;
  }

  async voidReturnOrder(id: number, operatorId: number): Promise<void> {
    const o = await this.getReturnOrder(id);
    if (!o || o.status !== "done") throw new Error("该退货单不存在或已作废");
    const runStock = new Map<number, number>();
    const prods = new Map<number, Product>();
    for (const it of o.items || []) {
      if (!prods.has(it.product_id)) {
        const p = await this.getProduct(it.product_id);
        if (p) {
          prods.set(it.product_id, p);
          runStock.set(it.product_id, p.stock);
        }
      }
    }
    const stmts: D1PreparedStatement[] = [
      this.db.prepare("UPDATE return_orders SET status='void' WHERE id=?").bind(id),
    ];
    for (const it of o.items || []) {
      const p = prods.get(it.product_id);
      if (!p) continue;
      const beforeQty = runStock.get(it.product_id)!;
      if (beforeQty < it.qty) {
        throw new Error(`商品「${p.name}」当前库存（${beforeQty}）不足以扣回退货数（${it.qty}），无法作废`);
      }
      const afterQty = round2(beforeQty - it.qty);
      runStock.set(it.product_id, afterQty);
      stmts.push(this.db.prepare("UPDATE products SET stock=? WHERE id=?").bind(afterQty, it.product_id));
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO stock_movements (product_id,change,before_qty,after_qty,type,ref_type,ref_id,operator_id,remark)
             VALUES (?,?,?,?, 'void','returns',?,?,?)`
          )
          .bind(it.product_id, -round2(it.qty), beforeQty, afterQty, id, operatorId, `作废退货单 ${o.order_no}`)
      );
    }
    // 作废退货单：把该单已退回客户余额的金额扣回，避免「退了货又退钱」
    const refundRow = await this.db
      .prepare("SELECT COALESCE(SUM(change),0) AS s FROM balance_logs WHERE ref_type='returns' AND ref_id=?")
      .bind(id)
      .first<{ s: number }>();
    const refunded = round2(refundRow?.s || 0);
    if (refunded > 0 && o.customer_id) {
      const cu = await this.getUserById(o.customer_id);
      if (cu && cu.role === "customer") {
        const before = round2(cu.balance || 0);
        if (before < refunded) {
          throw new Error(
            `客户当前余额 ¥${before.toFixed(2)} 不足以扣回该退货单已退的 ¥${refunded.toFixed(2)}，请先充值或线下追回后再作废`
          );
        }
        const after = round2(before - refunded);
        stmts.push(this.db.prepare("UPDATE users SET balance=? WHERE id=?").bind(after, o.customer_id));
        stmts.push(
          this.db
            .prepare(
              `INSERT INTO balance_logs (user_id,change,before_balance,after_balance,type,ref_type,ref_id,ref_no,operator_id,remark)
               VALUES (?,?,?,?, 'void','returns',?,?,?,?)`
            )
            .bind(o.customer_id, -refunded, before, after, id, o.order_no, operatorId, `作废退货单 ${o.order_no}，扣回已退余额`)
        );
      }
    }
    await this.db.batch(stmts);
  }

  async listReturnOrders(o: { page: number; pageSize: number; q?: string }): Promise<{ rows: ReturnOrder[]; total: number }> {
    const where = o.q ? "WHERE (ro.order_no LIKE ? OR so.order_no LIKE ?)" : "";
    const args: unknown[] = o.q ? [`%${o.q}%`, `%${o.q}%`] : [];
    const total =
      (
        await this.db
          .prepare(`SELECT COUNT(*) AS c FROM return_orders ro LEFT JOIN sales_orders so ON so.id=ro.sales_order_id ${where}`)
          .bind(...args)
          .first<{ c: number }>()
      )?.c || 0;
    const rows =
      (
        await this.db
          .prepare(
            `SELECT ro.*, so.order_no AS sales_order_no, cu.nickname AS customer_name, u.nickname AS operator_name
             FROM return_orders ro LEFT JOIN sales_orders so ON so.id=ro.sales_order_id
             LEFT JOIN users cu ON cu.id=ro.customer_id LEFT JOIN users u ON u.id=ro.operator_id
             ${where} ORDER BY ro.id DESC LIMIT ? OFFSET ?`
          )
          .bind(...args, o.pageSize, (o.page - 1) * o.pageSize)
          .all<ReturnOrder>()
      ).results || [];
    return { rows, total };
  }
  async getReturnOrder(id: number): Promise<ReturnOrder | null> {
    const o = await this.db
      .prepare(
        `SELECT ro.*, so.order_no AS sales_order_no, cu.nickname AS customer_name, u.nickname AS operator_name
         FROM return_orders ro LEFT JOIN sales_orders so ON so.id=ro.sales_order_id
         LEFT JOIN users cu ON cu.id=ro.customer_id LEFT JOIN users u ON u.id=ro.operator_id WHERE ro.id=?`
      )
      .bind(id)
      .first<ReturnOrder>();
    if (!o) return null;
    o.items =
      (
        await this.db
          .prepare(
            `SELECT ri.*, p.name AS product_name, p.sku AS sku, p.unit AS unit
             FROM return_items ri LEFT JOIN products p ON p.id=ri.product_id WHERE ri.order_id=?`
          )
          .bind(id)
          .all<ReturnItem>()
      ).results || [];
    return o;
  }

  /** 某张销售单各商品的历史已退数量（只统计有效退货单） */
  async returnedQtyByOrder(salesOrderId: number): Promise<Map<number, number>> {
    const rows =
      (
        await this.db
          .prepare(
            `SELECT ri.product_id, SUM(ri.qty) AS qty FROM return_items ri
             JOIN return_orders ro ON ro.id=ri.order_id
             WHERE ro.sales_order_id=? AND ro.status='done' GROUP BY ri.product_id`
          )
          .bind(salesOrderId)
          .all<{ product_id: number; qty: number }>()
      ).results || [];
    const m = new Map<number, number>();
    for (const r of rows) m.set(r.product_id, round2(r.qty || 0));
    return m;
  }

  /** 原单每款商品的售出 / 已退 / 可退数量（可退 = 售出 - 有效退货单已退） */
  async returnableQtyByOrder(
    salesOrderId: number
  ): Promise<Map<number, { sold: number; returned: number; avail: number }>> {
    const m = new Map<number, { sold: number; returned: number; avail: number }>();
    const order = await this.getSalesOrder(salesOrderId);
    if (!order) return m;
    const sold = new Map<number, number>();
    for (const si of order.items || []) {
      sold.set(si.product_id, round2((sold.get(si.product_id) || 0) + si.qty));
    }
    const returned = await this.returnedQtyByOrder(salesOrderId);
    for (const [pid, s] of sold) {
      const r = round2(returned.get(pid) || 0);
      m.set(pid, { sold: s, returned: r, avail: round2(s - r) });
    }
    return m;
  }

  /** 某张销售单关联的全部退货单（含已作废，供原单页面展示退货记录） */  async listReturnsBySalesOrder(salesOrderId: number): Promise<ReturnOrder[]> {
    return (
      (
        await this.db
          .prepare(
            `SELECT ro.*, u.nickname AS operator_name FROM return_orders ro
             LEFT JOIN users u ON u.id=ro.operator_id
             WHERE ro.sales_order_id=? ORDER BY ro.id DESC`
          )
          .bind(salesOrderId)
          .all<ReturnOrder>()
      ).results || []
    );
  }

  // ============ 客户退换货申请（客户提交 → 管理员审核） ============
  async createReturnRequest(o: {
    customer_id: number;
    sales_order_id: number;
    type: string;
    reason: string;
    items: { product_id: number; qty: number }[];
  }): Promise<string> {
    const type = o.type === "exchange" ? "exchange" : "return";
    if (!o.items.length) throw new Error("请至少选择一件需要退换的商品");
    const reason = (o.reason || "").trim();
    if (reason.length < 2) throw new Error("请填写退换货原因，便于商家快速处理");

    const order = await this.getSalesOrder(o.sales_order_id);
    if (!order) throw new Error("原销售单不存在");
    if (order.customer_id !== o.customer_id) throw new Error("只能对自己名下的订单申请退换货");
    if (order.status !== "done") throw new Error("该订单已作废，无法申请退换货");

    const soldQty = new Map<number, number>();
    const priceOf = new Map<number, number>();
    const nameOf = new Map<number, { name: string; sku: string; unit: string }>();
    for (const it of order.items || []) {
      soldQty.set(it.product_id, round2((soldQty.get(it.product_id) || 0) + it.qty));
      priceOf.set(it.product_id, it.price);
      nameOf.set(it.product_id, { name: it.product_name || "", sku: it.sku || "", unit: it.unit || "" });
    }
    const returned = await this.returnedQtyByOrder(order.id);
    // 待审核中的申请也要占用量，避免同一件商品被重复申请
    const pending = await this.pendingQtyByOrder(order.id);

    const reqQty = new Map<number, number>();
    for (const it of o.items) {
      if (it.qty <= 0) continue;
      reqQty.set(it.product_id, round2((reqQty.get(it.product_id) || 0) + it.qty));
    }
    if (reqQty.size === 0) throw new Error("请至少填写一件商品的数量");

    const snapshot: ReturnRequestItem[] = [];
    let total = 0;
    for (const [pid, q] of reqQty) {
      const meta = nameOf.get(pid);
      if (!meta) throw new Error("所选商品不在该销售单中");
      const avail = round2((soldQty.get(pid) || 0) - (returned.get(pid) || 0) - (pending.get(pid) || 0));
      if (q > avail) {
        throw new Error(
          `商品「${meta.name || "#" + pid}」可申请数量为 ${Math.max(0, avail)}，您填写了 ${q}${
            (pending.get(pid) || 0) > 0 ? "（另有待审核申请占用）" : ""
          }`
        );
      }
      const price = round2(priceOf.get(pid) || 0);
      snapshot.push({ product_id: pid, qty: q, price, name: meta.name, sku: meta.sku, unit: meta.unit });
      total += round2(q * price);
    }

    const request_no = uid("RQ");
    await this.db
      .prepare(
        `INSERT INTO return_requests (request_no,customer_id,sales_order_id,sales_order_no,type,reason,items_json,total)
         VALUES (?,?,?,?,?,?,?,?)`
      )
      .bind(request_no, o.customer_id, order.id, order.order_no, type, reason, JSON.stringify(snapshot), round2(total))
      .run();
    return request_no;
  }

  /** 某张销售单当前「待审核」申请占用的数量 */
  async pendingQtyByOrder(salesOrderId: number): Promise<Map<number, number>> {
    const rows =
      (await this.db.prepare("SELECT items_json FROM return_requests WHERE sales_order_id=? AND status='pending'").bind(salesOrderId).all<{ items_json: string }>()).results || [];
    const m = new Map<number, number>();
    for (const r of rows) {
      let items: ReturnRequestItem[] = [];
      try {
        items = JSON.parse(r.items_json || "[]") as ReturnRequestItem[];
      } catch {
        items = [];
      }
      for (const it of items) m.set(it.product_id, round2((m.get(it.product_id) || 0) + (it.qty || 0)));
    }
    return m;
  }

  private parseRequest(r: ReturnRequest & { items_json?: string }): ReturnRequest {
    let items: ReturnRequestItem[] = [];
    try {
      items = JSON.parse(r.items_json || "[]") as ReturnRequestItem[];
    } catch {
      items = [];
    }
    return { ...r, items };
  }

  async listReturnRequests(o: {
    page: number;
    pageSize: number;
    customerId?: number;
    status?: string;
  }): Promise<{ rows: ReturnRequest[]; total: number }> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (o.customerId) {
      where.push("rr.customer_id=?");
      args.push(o.customerId);
    }
    if (o.status) {
      where.push("rr.status=?");
      args.push(o.status);
    }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const total =
      (await this.db.prepare(`SELECT COUNT(*) AS c FROM return_requests rr ${w}`).bind(...args).first<{ c: number }>())?.c ||
      0;
    const rows =
      (
        await this.db
          .prepare(
            `SELECT rr.*, cu.nickname AS customer_name, cu.username AS customer_username, rv.nickname AS reviewer_name
             FROM return_requests rr LEFT JOIN users cu ON cu.id=rr.customer_id LEFT JOIN users rv ON rv.id=rr.reviewer_id
             ${w} ORDER BY rr.id DESC LIMIT ? OFFSET ?`
          )
          .bind(...args, o.pageSize, (o.page - 1) * o.pageSize)
          .all<ReturnRequest & { items_json?: string }>()
      ).results || [];
    return { rows: rows.map((r) => this.parseRequest(r)), total };
  }

  async getReturnRequest(id: number): Promise<ReturnRequest | null> {
    const r = await this.db
      .prepare(
        `SELECT rr.*, cu.nickname AS customer_name, cu.username AS customer_username, rv.nickname AS reviewer_name
         FROM return_requests rr LEFT JOIN users cu ON cu.id=rr.customer_id LEFT JOIN users rv ON rv.id=rr.reviewer_id
         WHERE rr.id=?`
      )
      .bind(id)
      .first<ReturnRequest & { items_json?: string }>();
    return r ? this.parseRequest(r) : null;
  }

  /** 管理员审核：approve 通过（生成正式退货单并回补库存）/ reject 驳回 */
  async reviewReturnRequest(
    id: number,
    action: "approve" | "reject",
    reviewerId: number,
    remark: string
  ): Promise<{ status: string; returnOrderNo?: string }> {
    const r = await this.getReturnRequest(id);
    if (!r) throw new Error("退换货申请不存在");
    if (r.status !== "pending") throw new Error("该申请已处理，无需重复审核");
    const now = new Date().toISOString();
    if (action === "reject") {
      await this.db
        .prepare("UPDATE return_requests SET status='rejected', reviewer_id=?, reviewed_at=?, review_remark=? WHERE id=?")
        .bind(reviewerId, now, remark || "未通过审核", id)
        .run();
      return { status: "rejected" };
    }
    // 通过：生成正式退货单（库存回补 + 可退数量二次校验）
    const orderNo = await this.createReturnOrder({
      sales_order_id: r.sales_order_id,
      customer_id: r.customer_id,
      operator_id: reviewerId,
      remark: `客户${requestTypeName(r.type)}申请 ${r.request_no}：${r.reason}`,
      items: r.items.map((it) => ({ product_id: it.product_id, qty: it.qty, price: it.price })),
    });
    const created = await this.db
      .prepare("SELECT id FROM return_orders WHERE order_no=?")
      .bind(orderNo)
      .first<{ id: number }>();
    await this.db
      .prepare(
        "UPDATE return_requests SET status='approved', reviewer_id=?, reviewed_at=?, review_remark=?, return_order_id=? WHERE id=?"
      )
      .bind(reviewerId, now, remark || "", created?.id ?? null, id)
      .run();
    return { status: "approved", returnOrderNo: orderNo };
  }

  /** 客户撤销待审核的申请 */
  async cancelReturnRequest(id: number, customerId: number): Promise<void> {
    const r = await this.getReturnRequest(id);
    if (!r) throw new Error("退换货申请不存在");
    if (r.customer_id !== customerId) throw new Error("只能撤销自己提交的申请");
    if (r.status !== "pending") throw new Error("该申请已处理，无法撤销");
    await this.db.prepare("UPDATE return_requests SET status='cancelled' WHERE id=?").bind(id).run();
  }

  async listMovements(o: {
    productId?: number;
    type?: string;
    from?: string;
    to?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: StockMovement[]; total: number }> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (o.productId) {
      where.push("m.product_id=?");
      args.push(o.productId);
    }
    if (o.type) {
      where.push("m.type=?");
      args.push(o.type);
    }
    if (o.from) {
      where.push("m.created_at>=?");
      args.push(o.from);
    }
    if (o.to) {
      where.push("m.created_at<?");
      args.push(o.to);
    }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const total =
      (await this.db.prepare(`SELECT COUNT(*) AS c FROM stock_movements m ${w}`).bind(...args).first<{ c: number }>())?.c || 0;
    const rows =
      (
        await this.db
          .prepare(
            `SELECT m.*, p.name AS product_name, p.sku AS sku, p.unit AS unit, u.nickname AS operator_name
             FROM stock_movements m
             LEFT JOIN products p ON p.id=m.product_id LEFT JOIN users u ON u.id=m.operator_id
             ${w} ORDER BY m.id DESC LIMIT ? OFFSET ?`
          )
          .bind(...args, o.pageSize, (o.page - 1) * o.pageSize)
          .all<StockMovement>()
      ).results || [];
    return { rows, total };
  }
  async adjustStock(o: { product_id: number; actual_qty: number; operator_id: number; remark: string }): Promise<void> {
    const p = await this.getProduct(o.product_id);
    if (!p) throw new Error("商品不存在");
    const actual = round2(o.actual_qty);
    const change = round2(actual - p.stock);
    if (change === 0) throw new Error("实盘数量与当前账面库存一致，无需调整");
    if (p.max_stock > 0 && actual > p.max_stock) {
      throw new Error(`实盘数量（${actual}）超过该商品设定的库存上限（${p.max_stock}）`);
    }
    await this.db.batch([
      this.db
        .prepare("UPDATE products SET stock=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
        .bind(actual, o.product_id),
      this.db
        .prepare(
          `INSERT INTO stock_movements (product_id,change,before_qty,after_qty,type,ref_type,ref_id,operator_id,remark)
           VALUES (?,?,?,?, 'adjust','',0,?,?)`
        )
        .bind(
          o.product_id,
          change,
          p.stock,
          actual,
          o.operator_id,
          o.remark || `库存盘点：账面 ${p.stock} → 实盘 ${actual}`
        ),
    ]);
  }

  // ============ 分佣 ============
  async listCommissions(o: {
    salesId?: number;
    status?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: Commission[]; total: number }> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (o.salesId) {
      where.push("cm.sales_id=?");
      args.push(o.salesId);
    }
    if (o.status) {
      where.push("cm.status=?");
      args.push(o.status);
    }
    const w = where.length ? "WHERE " + where.join(" AND ") : "";
    const total =
      (await this.db.prepare(`SELECT COUNT(*) AS c FROM commissions cm ${w}`).bind(...args).first<{ c: number }>())?.c || 0;
    const rows =
      (
        await this.db
          .prepare(
            `SELECT cm.*, so.order_no, u.nickname AS sales_name FROM commissions cm
             LEFT JOIN sales_orders so ON so.id=cm.order_id LEFT JOIN users u ON u.id=cm.sales_id
             ${w} ORDER BY cm.id DESC LIMIT ? OFFSET ?`
          )
          .bind(...args, o.pageSize, (o.page - 1) * o.pageSize)
          .all<Commission>()
      ).results || [];
    return { rows, total };
  }
  async settleCommission(id: number): Promise<void> {
    await this.db.prepare("UPDATE commissions SET status='settled' WHERE id=? AND status='pending'").bind(id).run();
  }
  async settleAll(salesId?: number): Promise<number> {
    const r = salesId
      ? await this.db
          .prepare("UPDATE commissions SET status='settled' WHERE sales_id=? AND status='pending'")
          .bind(salesId)
          .run()
      : await this.db.prepare("UPDATE commissions SET status='settled' WHERE status='pending'").run();
    return r.meta.changes || 0;
  }
  async commissionSummary(salesId?: number): Promise<{ pending: number; settled: number }> {
    const w = salesId ? "WHERE sales_id=?" : "";
    const args = salesId ? [salesId] : [];
    const rows =
      (
        await this.db
          .prepare(`SELECT status, COALESCE(SUM(amount),0) AS s FROM commissions ${w} GROUP BY status`)
          .bind(...args)
          .all<{ status: string; s: number }>()
      ).results || [];
    let pending = 0;
    let settled = 0;
    for (const r of rows) {
      if (r.status === "pending") pending = round2(r.s);
      else settled = round2(r.s);
    }
    return { pending, settled };
  }
  async salesStats(
    salesId: number,
    from: string,
    to: string
  ): Promise<{ orderCount: number; total: number; profit: number; teamOrderCount: number; teamTotal: number }> {
    const r1 = await this.db
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS t, COALESCE(SUM(discount),0) AS d
         FROM sales_orders WHERE sales_id=? AND status='done' AND created_at>=? AND created_at<?`
      )
      .bind(salesId, from, to)
      .first<{ c: number; t: number; d: number }>();
    const r2 = await this.db
      .prepare(
        `SELECT COALESCE(SUM((si.price-si.cost)*si.qty),0) AS p FROM sales_items si
         JOIN sales_orders so ON so.id=si.order_id WHERE so.sales_id=? AND so.status='done' AND so.created_at>=? AND so.created_at<?`
      )
      .bind(salesId, from, to)
      .first<{ p: number }>();
    const r3 = await this.db
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(so.total),0) AS t FROM sales_orders so
         JOIN users u ON u.id=so.sales_id WHERE u.parent_id=? AND so.status='done' AND so.created_at>=? AND so.created_at<?`
      )
      .bind(salesId, from, to)
      .first<{ c: number; t: number }>();
    return {
      orderCount: r1?.c || 0,
      total: round2(r1?.t || 0),
      profit: round2((r2?.p || 0) - (r1?.d || 0)),
      teamOrderCount: r3?.c || 0,
      teamTotal: round2(r3?.t || 0),
    };
  }

  // ============ 客户 ============
  async customerStats(customerId: number): Promise<{ orderCount: number; total: number; paid: number; debt: number }> {
    const r = await this.db
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(total),0) AS t, COALESCE(SUM(paid),0) AS p
         FROM sales_orders WHERE customer_id=? AND status='done'`
      )
      .bind(customerId)
      .first<{ c: number; t: number; p: number }>();
    const total = round2(r?.t || 0);
    const paid = round2(r?.p || 0);
    return { orderCount: r?.c || 0, total, paid, debt: round2(total - paid) };
  }

  // ============ 数据看板 ============
  async dashboardStats(): Promise<{
    todaySales: number;
    todayOrders: number;
    monthSales: number;
    monthOrders: number;
    monthProfit: number;
    monthPurchase: number;
    stockValue: number;
    productCount: number;
    lowCount: number;
    customerCount: number;
    pendingCommission: number;
    totalReceivable: number;
  }> {
    const today = todayUTC8();
    const t = utc8Range(today);
    const m = { start: utc8Range(today.slice(0, 7) + "-01").start, end: new Date().toISOString() };
    const [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10] = await this.db.batch([
      this.db
        .prepare("SELECT COALESCE(SUM(total),0) AS t, COUNT(*) AS c FROM sales_orders WHERE status='done' AND created_at>=? AND created_at<?")
        .bind(t.start, t.end),
      this.db
        .prepare(
          "SELECT COALESCE(SUM(total),0) AS t, COUNT(*) AS c, COALESCE(SUM(discount),0) AS d FROM sales_orders WHERE status='done' AND created_at>=? AND created_at<?"
        )
        .bind(m.start, m.end),
      this.db
        .prepare(
          `SELECT COALESCE(SUM((si.price-si.cost)*si.qty),0) AS p FROM sales_items si
           JOIN sales_orders so ON so.id=si.order_id WHERE so.status='done' AND so.created_at>=? AND so.created_at<?`
        )
        .bind(m.start, m.end),
      this.db.prepare("SELECT COALESCE(SUM(stock*purchase_price),0) AS v FROM products"),
      this.db.prepare("SELECT COUNT(*) AS c FROM products"),
      this.db.prepare("SELECT COUNT(*) AS c FROM products WHERE status='on' AND stock <= min_stock"),
      this.db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='customer' AND status='active'"),
      this.db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM commissions WHERE status='pending'"),
      this.db
        .prepare("SELECT COALESCE(SUM(total),0) AS t FROM purchase_orders WHERE status='done' AND created_at>=? AND created_at<?")
        .bind(m.start, m.end),
      this.db.prepare("SELECT COALESCE(SUM(total - paid),0) AS debt FROM sales_orders WHERE status='done' AND total > paid"),
    ]);
    const g = (r: D1Result, k: string) => Number((r.results?.[0] as Record<string, number>)?.[k] || 0);
    return {
      todaySales: round2(g(r1, "t")),
      todayOrders: g(r1, "c"),
      monthSales: round2(g(r2, "t")),
      monthOrders: g(r2, "c"),
      monthProfit: round2(g(r3, "p") - g(r2, "d")),
      monthPurchase: round2(g(r9, "t")),
      stockValue: round2(g(r4, "v")),
      productCount: g(r5, "c"),
      lowCount: g(r6, "c"),
      customerCount: g(r7, "c"),
      pendingCommission: round2(g(r8, "s")),
      totalReceivable: round2(g(r10, "debt")),
    };
  }

  async salesTrend(days = 14): Promise<{ date: string; total: number; count: number }[]> {
    const map = new Map<string, { total: number; count: number }>();
    const nowBj = Date.now() + 8 * 3600 * 1000;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(nowBj - i * 86400000).toISOString().slice(0, 10);
      map.set(d, { total: 0, count: 0 });
    }
    const firstDate = [...map.keys()][0];
    const startISO = utc8Range(firstDate).start;
    const rows =
      (
        await this.db
          .prepare(
            `SELECT substr(datetime(created_at, '+8 hours'), 1, 10) AS d,
                    COALESCE(SUM(total),0) AS t, COUNT(*) AS c
             FROM sales_orders
             WHERE status='done' AND created_at>=?
             GROUP BY d ORDER BY d`
          )
          .bind(startISO)
          .all<{ d: string; t: number; c: number }>()
      ).results || [];
    for (const r of rows) {
      const e = map.get(r.d);
      if (e) {
        e.total = round2(e.total + r.t);
        e.count += r.c;
      }
    }
    return [...map.entries()].map(([date, v]) => ({ date, total: v.total, count: v.count }));
  }

  async topProducts(days = 30, limit = 8): Promise<{ name: string; qty: number; amount: number }[]> {
    const start = new Date(Date.now() - days * 86400000).toISOString();
    return (
      (
        await this.db
          .prepare(
            `SELECT COALESCE(p.name, '已删商品#' || si.product_id) AS name,
                    COALESCE(SUM(si.qty),0) AS qty,
                    COALESCE(SUM(si.amount),0) AS amount
             FROM sales_items si JOIN sales_orders so ON so.id=si.order_id
             LEFT JOIN products p ON p.id=si.product_id
             WHERE so.status='done' AND so.created_at>=?
             GROUP BY si.product_id ORDER BY amount DESC LIMIT ?`
          )
          .bind(start, limit)
          .all<{ name: string; qty: number; amount: number }>()
      ).results || []
    );
  }

  async categoryValue(): Promise<{ name: string; value: number; count: number }[]> {
    return (
      (
        await this.db
          .prepare(
            `SELECT COALESCE(c.name,'未分类') AS name,
                    COALESCE(SUM(p.stock*p.purchase_price),0) AS value,
                    COUNT(p.id) AS count
             FROM products p LEFT JOIN categories c ON c.id=p.category_id
             GROUP BY p.category_id ORDER BY value DESC`
          )
          .all<{ name: string; value: number; count: number }>()
      ).results || []
    );
  }

  // ============ 审计 ============
  async audit(userId: number | null, action: string, target: string, detail: string, ip: string): Promise<void> {
    try {
      await this.db
        .prepare("INSERT INTO audit_logs (user_id,action,target,detail,ip) VALUES (?,?,?,?,?)")
        .bind(userId, action, target, detail.slice(0, 500), ip)
        .run();
    } catch {
      /* 审计失败不阻断业务 */
    }
  }
  async listAuditLogs(o: {
    page: number;
    pageSize: number;
    q?: string;
  }): Promise<{
    rows: {
      id: number;
      user_id: number | null;
      username?: string;
      action: string;
      target: string;
      detail: string;
      ip: string;
      created_at: string;
    }[];
    total: number;
  }> {
    const w = o.q ? "WHERE a.action LIKE ? OR a.target LIKE ? OR a.detail LIKE ? OR u.username LIKE ?" : "";
    const args: unknown[] = o.q ? [`%${o.q}%`, `%${o.q}%`, `%${o.q}%`, `%${o.q}%`] : [];
    const total =
      (
        await this.db
          .prepare(`SELECT COUNT(*) AS c FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ${w}`)
          .bind(...args)
          .first<{ c: number }>()
      )?.c || 0;
    const rows =
      ((
        await this.db
          .prepare(
            `SELECT a.*, u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ${w} ORDER BY a.id DESC LIMIT ? OFFSET ?`
          )
          .bind(...args, o.pageSize, (o.page - 1) * o.pageSize)
          .all()
      ).results as never[]) || [];
    return {
      rows: rows as never as {
        id: number;
        user_id: number | null;
        username?: string;
        action: string;
        target: string;
        detail: string;
        ip: string;
        created_at: string;
      }[],
      total,
    };
  }

  // ============ 备份 / 恢复 ============
  static backupTables(): string[] {
    return [
      "users",
      "security_questions",
      "categories",
      "suppliers",
      "products",
      "purchase_orders",
      "purchase_items",
      "sales_orders",
      "sales_items",
      "return_orders",
      "return_items",
      "return_requests",
      "stock_movements",
      "commissions",
      "balance_logs",
      "audit_logs",
      "settings",
    ];
  }
  async exportBackup(): Promise<{
    version: number;
    exported_at: string;
    tables: Record<string, Record<string, unknown>[]>;
  }> {
    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const t of Store.backupTables()) {
      tables[t] = ((await this.db.prepare(`SELECT * FROM ${t}`).all()).results || []) as Record<string, unknown>[];
    }
    return { version: 2, exported_at: new Date().toISOString(), tables };
  }
  async importBackup(data: { tables: Record<string, Record<string, unknown>[]> }): Promise<void> {
    const allowedTables = Store.backupTables();
    const order = [...allowedTables].reverse();
    const del: D1PreparedStatement[] = order.map((t) => this.db.prepare(`DELETE FROM ${t}`));
    for (let i = 0; i < del.length; i += 40) await this.db.batch(del.slice(i, i + 40));

    for (const t of allowedTables) {
      const rows = data.tables?.[t] || [];
      if (!Array.isArray(rows) || !rows.length) continue;
      for (let i = 0; i < rows.length; i += 40) {
        const chunk = rows.slice(i, i + 40);
        const stmts = chunk.map((row) => {
          const keys = Object.keys(row).filter((k) => /^[a-zA-Z0-9_]+$/.test(k));
          return this.db
            .prepare(`INSERT INTO ${t} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
            .bind(...keys.map((k) => row[k] as unknown));
        });
        await this.db.batch(stmts);
      }
    }
    schemaReady = false;
  }

  // ============ 数据清空 ============

  /** 清空动作的表清单与展示口径：business 属于两档共有，factory 仅在恢复出厂时清空 */
  static clearPlan(): { table: string; label: string; scope: ClearScope }[] {
    return [
      { table: "purchase_items", label: "进货商品明细", scope: "business" },
      { table: "purchase_orders", label: "进货单", scope: "business" },
      { table: "sales_items", label: "销售商品明细", scope: "business" },
      { table: "sales_orders", label: "销售单", scope: "business" },
      { table: "return_items", label: "退货商品明细", scope: "business" },
      { table: "return_orders", label: "退货单", scope: "business" },
      { table: "return_requests", label: "客户退换货申请", scope: "business" },
      { table: "stock_movements", label: "库存流水", scope: "business" },
      { table: "commissions", label: "分佣记录", scope: "business" },
      { table: "balance_logs", label: "客户余额流水", scope: "business" },
      { table: "products", label: "商品档案", scope: "factory" },
      { table: "categories", label: "商品分类", scope: "factory" },
      { table: "suppliers", label: "供应商", scope: "factory" },
      { table: "login_attempts", label: "登录尝试记录", scope: "factory" },
      { table: "recovery_attempts", label: "找回密码尝试记录", scope: "factory" },
      { table: "audit_logs", label: "审计日志", scope: "factory" },
    ];
  }

  /** 清空前预览：key 为表名，users / sessions 按「实际会被删除的行数」统计 */
  async clearCounts(keepUserId: number, keepSessionDigest: string): Promise<Record<string, number>> {
    const items = [
      ...Store.clearPlan().map((p) => ({
        table: p.table,
        stmt: this.db.prepare(`SELECT COUNT(*) AS c FROM ${p.table}`),
      })),
      { table: "users", stmt: this.db.prepare("SELECT COUNT(*) AS c FROM users WHERE id<>?").bind(keepUserId) },
      {
        table: "sessions",
        stmt: this.db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE id<>?").bind(keepSessionDigest),
      },
    ];
    const res = await this.db.batch(items.map((i) => i.stmt));
    const out: Record<string, number> = {};
    res.forEach((r, idx) => {
      const row = (r.results || [])[0] as { c: number } | undefined;
      out[items[idx].table] = Number(row?.c || 0);
    });
    return out;
  }

  /**
   * 执行清空，返回各表删除前的行数。
   * business：单据与各类流水清空后，商品库存、客户余额同步归零（否则与已清空的流水对不上账）；
   * factory：额外清空基础资料与除当前管理员外的全部账号，并注销除当前会话外的所有会话。
   * 两档均保留 settings 表与 R2 中的图片对象。
   */
  async clearData(
    scope: ClearScope,
    keep: { userId: number; sessionDigest: string }
  ): Promise<Record<string, number>> {
    const plan = Store.clearPlan().filter((p) => scope === "factory" || p.scope === "business");
    const before = await this.clearCounts(keep.userId, keep.sessionDigest);
    const stmts: D1PreparedStatement[] = plan.map((p) => this.db.prepare(`DELETE FROM ${p.table}`));
    if (scope === "business") {
      stmts.push(this.db.prepare("UPDATE products SET stock=0"));
      stmts.push(this.db.prepare("UPDATE users SET balance=0"));
    } else {
      stmts.push(this.db.prepare("DELETE FROM users WHERE id<>?").bind(keep.userId));
      stmts.push(this.db.prepare("DELETE FROM security_questions WHERE user_id<>?").bind(keep.userId));
      stmts.push(this.db.prepare("DELETE FROM sessions WHERE id<>?").bind(keep.sessionDigest));
    }
    for (let i = 0; i < stmts.length; i += 40) await this.db.batch(stmts.slice(i, i + 40));

    const deleted: Record<string, number> = {};
    for (const p of plan) deleted[p.table] = before[p.table] || 0;
    if (scope === "factory") {
      deleted["users"] = before["users"] || 0;
      deleted["sessions"] = before["sessions"] || 0;
    }
    return deleted;
  }
}

/** 清空数据范围：business 仅业务流水，factory 恢复出厂 */
export type ClearScope = "business" | "factory";

/** 清空数据确认口令：服务端精确比对，前端仅负责展示 */
export const CLEAR_DATA_KEYWORD = "清空所有数据";
