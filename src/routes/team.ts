// 客户 / 销售团队 / 佣金
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import type { User } from "../db";
import { layout, errorPage } from "../views/layout";
import {
  customerListPage,
  customerDetailPage,
  teamPage,
  salesFormPage,
  commissionPage,
} from "../views/team";
import { store, pageCtx, needRoles, parseForm, redirectWith } from "./helpers";
import { getPagination, clientIP, hashPassword, validateUsername, validatePassword, todayUTC8, utc8Range, round2 } from "../lib";

type TeamNode = User & { children: TeamNode[] };

/** 按 parent_id 组装销售团队树；顶层为一级销售或无上级的销售 */
function buildTree(users: User[]): TeamNode[] {
  const map = new Map<number, TeamNode>();
  for (const u of users) map.set(u.id, { ...u, children: [] });
  const roots: TeamNode[] = [];
  for (const n of map.values()) {
    const parent = n.parent_id ? map.get(n.parent_id) : undefined;
    if (parent && parent.id !== n.id) parent.children.push(n);
    else roots.push(n);
  }
  return roots;
}

function flatten(nodes: TeamNode[]): TeamNode[] {
  const out: TeamNode[] = [];
  const walk = (ns: TeamNode[]) => {
    for (const n of ns) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

function notFound(c: Parameters<typeof pageCtx>[0]) {
  return c.html(errorPage(pageCtx(c), 404, "页面不存在", "请求的记录不存在或已被删除。"), 404);
}

export function registerTeam(app: Hono<AppEnv>) {
  // ---------- 客户列表 ----------
  app.get("/customers", async (c) => {
    try {
      needRoles(c, ["admin", "sales"]);
      const s = store(c);
      const { page, pageSize } = getPagination(c);
      const q = (c.req.query("q") || "").trim();
      const res = await s.listUsers({ role: "customer", q: q || undefined, page, pageSize });
      const rows = await Promise.all(
        res.rows.map(async (u) => {
          const st = await s.customerStats(u.id);
          return { ...u, orderCount: st.orderCount, total: st.total, debt: st.debt };
        })
      );
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "客户管理",
          ctx,
          active: "customers",
          content: customerListPage(ctx, { rows, total: res.total, page, pageSize, q }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载客户列表失败：" + (e as Error).message), 500);
    }
  });

  // ---------- 客户详情 ----------
  app.get("/customers/:id", async (c) => {
    try {
      needRoles(c, ["admin", "sales"]);
      const s = store(c);
      const id = parseInt(c.req.param("id") || "", 10) || 0;
      const u = id ? await s.getUserById(id) : null;
      if (!u || u.role !== "customer") return notFound(c);
      const [stats, ordersRes, logsRes] = await Promise.all([
        s.customerStats(id),
        s.listSalesOrders({ customerId: id, page: 1, pageSize: 20 }),
        s.listBalanceLogs({ userId: id, page: 1, pageSize: 20 }),
      ]);
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: `客户 ${u.nickname || u.username}`,
          ctx,
          active: "customers",
          content: customerDetailPage(ctx, { user: u, stats, orders: ordersRes.rows, logs: logsRes.rows }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载客户详情失败：" + (e as Error).message), 500);
    }
  });

  // ---------- 客户余额充值 / 扣减 ----------
  app.post("/customers/:id/balance", async (c) => {
    const me = needRoles(c, ["admin", "sales"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      const u = id ? await s.getUserById(id) : null;
      if (!u || u.role !== "customer") return notFound(c);
      const { fields } = await parseForm(c);
      const amount = round2(parseFloat(fields.amount || "") || 0);
      if (!amount) return redirectWith(c, `/customers/${id}`, undefined, "请输入不为 0 的充值 / 扣减金额");
      if (amount < 0 && me.role !== "admin") {
        return redirectWith(c, `/customers/${id}`, undefined, "仅管理员可执行余额扣减，销售员只能为客户充值");
      }
      const remark = (fields.remark || "").trim() || (amount > 0 ? "余额充值" : "余额扣减");
      const r = await s.adjustBalance({
        user_id: id,
        change: amount,
        type: amount > 0 ? "recharge" : "adjust",
        ref_type: "manual",
        operator_id: me.id,
        remark,
      });
      await s.audit(
        me.id,
        amount > 0 ? "客户充值" : "客户余额扣减",
        "客户",
        `${u.nickname || u.username} 余额 ${amount > 0 ? "+" : ""}${amount}（¥${r.before.toFixed(2)} → ¥${r.after.toFixed(2)}）`,
        clientIP(c)
      );
      return redirectWith(
        c,
        `/customers/${id}`,
        `已${amount > 0 ? "充值" : "扣减"} ¥${Math.abs(amount).toFixed(2)}，客户当前余额 ¥${r.after.toFixed(2)}`
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, `/customers/${id}`, undefined, "操作失败：" + (e as Error).message);
    }
  });

  // ---------- 销售团队 ----------
  app.get("/team", async (c) => {
    try {
      const me = needRoles(c, ["admin", "sales"]);
      const s = store(c);
      const users = await s.listSalesUsers();
      let tree = buildTree(users);
      if (me.role === "sales") {
        // 销售只能看以自己为根的子树（自己 + 下级）
        const self = flatten(tree).find((n) => n.id === me.id);
        tree = self ? [self] : [];
      }
      const monthStart = utc8Range(todayUTC8().slice(0, 7) + "-01").start;
      const now = new Date().toISOString();
      const monthStats: Record<
        number,
        { orderCount: number; total: number; profit: number; teamOrderCount: number; teamTotal: number }
      > = {};
      for (const n of flatten(tree)) {
        monthStats[n.id] = await s.salesStats(n.id, monthStart, now);
      }
      // 修复：仅管理员或一级销售员可以发展下级（二级销售不可再发展三级）
      const canAdd = me.role === "admin" || me.sales_level === 1;
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "销售团队",
          ctx,
          active: "team",
          content: teamPage(ctx, { tree, monthStats, canAdd, isAdmin: me.role === "admin" }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载销售团队失败：" + (e as Error).message), 500);
    }
  });

  // ---------- 新增销售 ----------
  app.get("/team/new", async (c) => {
    try {
      const me = needRoles(c, ["admin", "sales"]);
      if (me.role === "sales" && me.sales_level !== 1) {
        return redirectWith(c, "/team", undefined, "二级销售无法继续发展下级");
      }
      const s = store(c);
      const users = await s.listSalesUsers();
      const parents = me.role === "admin" ? users.filter((u) => u.sales_level === 1) : [];
      const fixedParent = me.role === "sales" ? await s.getUserById(me.id) : null;
      const preselectParent = (c.req.query("parent") || "").trim() || undefined;
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "新增销售",
          ctx,
          active: "team",
          content: salesFormPage(ctx, {
            parents,
            fixedParent: fixedParent || undefined,
            preselectParent,
          }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载页面失败：" + (e as Error).message), 500);
    }
  });

  app.post("/team/new", async (c) => {
    const me = needRoles(c, ["admin", "sales"]);
    const s = store(c);
    try {
      if (me.role === "sales" && me.sales_level !== 1) {
        return redirectWith(c, "/team", undefined, "二级销售无法继续发展下级");
      }
      const { fields } = await parseForm(c);
      const username = (fields.username || "").trim();
      const password = fields.password || "";
      const nickname = (fields.nickname || "").trim() || username;
      const phone = (fields.phone || "").trim();
      const err = validateUsername(username) || validatePassword(password);
      if (err) return redirectWith(c, "/team/new", undefined, err);
      if (await s.getUserByUsername(username)) return redirectWith(c, "/team/new", undefined, "用户名已存在");
      let level = 1;
      let parent_id: number | null = null;
      if (me.role === "admin") {
        level = parseInt(fields.level || "1", 10) || 1;
        if (level !== 1 && level !== 2) level = 1;
        if (level === 2) {
          parent_id = parseInt(fields.parent_id || "", 10) || null;
          if (!parent_id) return redirectWith(c, "/team/new", undefined, "二级销售必须选择一名上级销售");
          const pUser = await s.getUserById(parent_id);
          if (!pUser || pUser.role !== "sales" || pUser.sales_level !== 1) {
            return redirectWith(c, "/team/new", undefined, "所选上级必须为有效的一级销售");
          }
        }
      } else {
        level = 2;
        parent_id = me.id;
      }
      const commission_rate = Math.max(0, Math.min(100, parseFloat(fields.commission_rate || "") || 0));
      await s.createUser({
        username,
        password_hash: await hashPassword(password),
        role: "sales",
        nickname,
        phone,
        parent_id,
        sales_level: level,
        commission_rate,
      });
      await s.audit(me.id, "新增销售", "销售团队", `新增${level === 2 ? "二级" : "一级"}销售 ${username}`, clientIP(c));
      return redirectWith(c, "/team", "销售账号创建成功");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/team/new", undefined, "创建失败：" + (e as Error).message);
    }
  });

  // ---------- 佣金 ----------
  app.get("/commissions", async (c) => {
    try {
      const me = needRoles(c, ["admin", "sales"]);
      const s = store(c);
      const { page, pageSize } = getPagination(c);
      // 兼容 sales_id 与 salesId 两种查询参数名
      const qSalesId = parseInt(c.req.query("sales_id") || c.req.query("salesId") || "", 10) || undefined;
      const status = (c.req.query("status") || "").trim();
      const salesId = me.role === "sales" ? me.id : qSalesId;
      const [res, summary, salesTeam] = await Promise.all([
        s.listCommissions({ salesId, status: status || undefined, page, pageSize }),
        s.commissionSummary(salesId),
        s.listSalesUsers(),
      ]);
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "佣金管理",
          ctx,
          active: "commissions",
          content: commissionPage(ctx, {
            rows: res.rows,
            total: res.total,
            page,
            pageSize,
            summary,
            salesTeam,
            f: { salesId: salesId ? String(salesId) : "", status },
            canSettle: me.role === "admin",
          }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载佣金失败：" + (e as Error).message), 500);
    }
  });

  app.post("/commissions/:id/settle", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      if (!id) return redirectWith(c, "/commissions", undefined, "参数错误");
      await s.settleCommission(id);
      await s.audit(me.id, "结算佣金", "佣金", `结算佣金 #${id}`, clientIP(c));
      return redirectWith(c, "/commissions", "佣金已结算");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/commissions", undefined, "结算失败：" + (e as Error).message);
    }
  });

  app.post("/commissions/settle-all", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    try {
      const f = await parseForm(c);
      const salesId =
        parseInt(f.fields.salesId || c.req.query("salesId") || c.req.query("sales_id") || "", 10) || undefined;
      const n = await s.settleAll(salesId);
      await s.audit(me.id, "批量结算佣金", "佣金", `批量结算 ${n} 笔待结算佣金`, clientIP(c));
      return redirectWith(c, "/commissions", n > 0 ? `已成功结算 ${n} 笔待结算佣金` : "当前没有待结算的佣金");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/commissions", undefined, "结算失败：" + (e as Error).message);
    }
  });
}
