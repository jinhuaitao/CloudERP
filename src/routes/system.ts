// 经营报表 / 用户管理 / 个人中心（含客户收货信息管理） / 系统设置（含微信与支付宝收款码设置） / 备份维护 / 审计日志 / 文件服务
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv, SafeUser } from "../env";
import { Store, paymentName, movementTypeName } from "../db";
import { layout, errorPage } from "../views/layout";
import {
  reportPage,
  userListPage,
  userFormPage,
  profilePage,
  passwordFormPage,
  securityFormPage,
  settingsPage,
  maintenancePage,
  auditPage,
} from "../views/system";
import {
  store,
  pageCtx,
  me,
  needRoles,
  parseForm,
  redirectWith,
  sidFromCookie,
  saveUpload,
} from "./helpers";
import {
  getPagination,
  clientIP,
  hashPassword,
  verifyPassword,
  hashAnswer,
  sha256hex,
  validateUsername,
  validatePassword,
  toCSV,
  fmtDT,
  todayUTC8,
  utc8Range,
  round2,
} from "../lib";

function notFound(c: Parameters<typeof pageCtx>[0]) {
  return c.html(errorPage(pageCtx(c), 404, "页面不存在", "请求的记录不存在或已被删除。"), 404);
}

type Role = SafeUser["role"];

function reportRange(c: Parameters<typeof getPagination>[0]): { from: string; to: string; start: string; end: string } {
  const from = (c.req.query("from") || "").trim() || todayUTC8().slice(0, 7) + "-01";
  const to = (c.req.query("to") || "").trim() || todayUTC8();
  return { from, to, start: utc8Range(from).start, end: utc8Range(to).end };
}

export function registerSystem(app: Hono<AppEnv>) {
  // ================= 经营报表 =================
  app.get("/reports", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const db = c.env.DB;
      const { from, to, start, end } = reportRange(c);
      const num = async (sql: string): Promise<number> => {
        const r = await db.prepare(sql).bind(start, end).first<{ v: number }>();
        return Number(r?.v || 0);
      };
      const [purchaseTotal, salesTotal, salesPaid, salesDiscount, rawProfit, returnTotal, orderCount, commissionTotal] =
        await Promise.all([
          num("SELECT COALESCE(SUM(total),0) AS v FROM purchase_orders WHERE status='done' AND created_at>=? AND created_at<?"),
          num("SELECT COALESCE(SUM(total),0) AS v FROM sales_orders WHERE status='done' AND created_at>=? AND created_at<?"),
          num("SELECT COALESCE(SUM(paid),0) AS v FROM sales_orders WHERE status='done' AND created_at>=? AND created_at<?"),
          num("SELECT COALESCE(SUM(discount),0) AS v FROM sales_orders WHERE status='done' AND created_at>=? AND created_at<?"),
          num(`SELECT COALESCE(SUM((si.price-si.cost)*si.qty),0) AS v FROM sales_items si
               JOIN sales_orders so ON so.id=si.order_id
               WHERE so.status='done' AND so.created_at>=? AND so.created_at<?`),
          num("SELECT COALESCE(SUM(total),0) AS v FROM return_orders WHERE status='done' AND created_at>=? AND created_at<?"),
          num("SELECT COUNT(*) AS v FROM sales_orders WHERE status='done' AND created_at>=? AND created_at<?"),
          num("SELECT COALESCE(SUM(amount),0) AS v FROM commissions WHERE created_at>=? AND created_at<?"),
        ]);
      const profit = round2(rawProfit - salesDiscount);
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "经营报表",
          ctx,
          active: "reports",
          content: reportPage(ctx, {
            from,
            to,
            purchaseTotal: round2(purchaseTotal),
            salesTotal: round2(salesTotal),
            salesPaid: round2(salesPaid),
            profit,
            returnTotal: round2(returnTotal),
            commissionTotal: round2(commissionTotal),
            orderCount,
          }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载报表失败：" + (e as Error).message), 500);
    }
  });

  // ---------- 报表导出 CSV ----------
  app.get("/reports/export", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const s = store(c);
      const type = (c.req.query("type") || "sales").trim();
      const { from, to, start, end } = reportRange(c);
      const inRange = (iso: string) => iso >= start && iso < end;
      let filename = "";
      let head: string[] = [];
      let body: (string | number | null | undefined)[][] = [];
      if (type === "sales") {
        filename = `销售单_${from}_${to}.csv`;
        head = [
          "单号",
          "客户",
          "收货人",
          "联系电话",
          "收货地址",
          "销售员",
          "应收金额",
          "优惠折扣",
          "实收金额",
          "欠款金额",
          "支付方式",
          "状态",
          "创建时间",
        ];
        const { rows } = await s.listSalesOrders({ page: 1, pageSize: 5000 });
        body = rows
          .filter((o) => inRange(o.created_at))
          .map((o) => [
            o.order_no,
            o.customer_name || "散客",
            o.shipping_name || "",
            o.shipping_phone || "",
            o.shipping_address || "",
            o.sales_name || "",
            o.total,
            o.discount,
            o.paid,
            round2(o.total - o.paid),
            paymentName(o.payment),
            o.status === "done" ? "已完成" : "已作废",
            fmtDT(o.created_at),
          ]);
      } else if (type === "purchase") {
        filename = `进货单_${from}_${to}.csv`;
        head = ["单号", "供应商", "总金额", "已付金额", "操作人", "状态", "创建时间"];
        const { rows } = await s.listPurchaseOrders({ page: 1, pageSize: 5000 });
        body = rows
          .filter((o) => inRange(o.created_at))
          .map((o) => [
            o.order_no,
            o.supplier_name || "",
            o.total,
            o.paid,
            o.operator_name || "",
            o.status === "done" ? "已完成" : "已作废",
            fmtDT(o.created_at),
          ]);
      } else if (type === "movements") {
        filename = `库存流水_${from}_${to}.csv`;
        head = ["商品", "SKU", "变动数量", "变动前", "变动后", "类型", "关联单据", "操作人", "备注", "时间"];
        const { rows } = await s.listMovements({ from: start, to: end, page: 1, pageSize: 5000 });
        body = rows.map((m) => [
          m.product_name || `#${m.product_id}`,
          m.sku || "",
          m.change,
          m.before_qty,
          m.after_qty,
          movementTypeName(m.type),
          `${m.ref_type || ""}${m.ref_id ? "#" + m.ref_id : ""}`,
          m.operator_name || "",
          m.remark || "",
          fmtDT(m.created_at),
        ]);
      } else if (type === "products") {
        filename = `商品档案_${todayUTC8()}.csv`;
        head = ["商品名", "分类", "供应商", "SKU", "条码", "单位", "进货成本价", "销售价", "当前库存", "库存货值", "安全库存", "状态"];
        const { rows } = await s.listProducts({ page: 1, pageSize: 5000 });
        body = rows.map((p) => [
          p.name,
          p.category_name || "",
          p.supplier_name || "",
          p.sku || "",
          p.barcode || "",
          p.unit,
          p.purchase_price,
          p.sale_price,
          p.stock,
          round2(p.stock * p.purchase_price),
          p.min_stock,
          p.status === "on" ? "上架" : "下架",
        ]);
      } else {
        return redirectWith(c, "/reports", undefined, "未知的导出类型");
      }
      return new Response(toCSV([head, ...body]), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        },
      });
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/reports", undefined, "导出失败：" + (e as Error).message);
    }
  });

  // ================= 用户管理（管理员） =================
  app.get("/users", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const s = store(c);
      const { page, pageSize } = getPagination(c);
      const q = (c.req.query("q") || "").trim();
      const role = (c.req.query("role") || "").trim();
      const res = await s.listUsers({ q: q || undefined, role: role || undefined, page, pageSize });
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "用户管理",
          ctx,
          active: "users",
          content: userListPage(ctx, { rows: res.rows, total: res.total, page, pageSize, q, role }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载用户列表失败：" + (e as Error).message), 500);
    }
  });

  app.get("/users/new", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const s = store(c);
      const salesTeam = (await s.listSalesUsers()).filter((u) => u.sales_level === 1);
      const ctx = pageCtx(c);
      return c.html(
        layout({ title: "新增用户", ctx, active: "users", content: userFormPage(ctx, { salesTeam }) })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载页面失败：" + (e as Error).message), 500);
    }
  });

  app.post("/users", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    try {
      const { fields } = await parseForm(c);
      const username = (fields.username || "").trim();
      const password = fields.password || "";
      const role = (fields.role || "").trim() as Role;
      const status = fields.status === "disabled" ? "disabled" : "active";
      const err =
        validateUsername(username) ||
        validatePassword(password) ||
        (!["admin", "sales", "customer"].includes(role) ? "角色无效" : null);
      if (err) return redirectWith(c, "/users/new", undefined, err);
      if (await s.getUserByUsername(username)) return redirectWith(c, "/users/new", undefined, "用户名已存在");
      const nickname = (fields.nickname || "").trim() || username;
      const base: Parameters<Store["createUser"]>[0] = {
        username,
        password_hash: await hashPassword(password),
        role,
        status,
        nickname,
        phone: (fields.phone || "").trim(),
        email: (fields.email || "").trim(),
        shipping_name: (fields.shipping_name || "").trim() || (role === "customer" ? nickname : ""),
        address: (fields.address || "").trim(),
      };
      if (role === "sales") {
        const level = parseInt(fields.sales_level || "1", 10) || 1;
        base.sales_level = level === 2 ? 2 : 1;
        base.parent_id = base.sales_level === 2 ? parseInt(fields.parent_id || "", 10) || null : null;
        if (base.sales_level === 2 && !base.parent_id) {
          return redirectWith(c, "/users/new", undefined, "二级销售必须选择一名上级销售");
        }
        base.commission_rate = Math.max(0, Math.min(100, parseFloat(fields.commission_rate || "") || 0));
      }
      if (role === "customer") {
        base.credit_limit = Math.max(0, parseFloat(fields.credit_limit || "") || 0);
      }
      const id = await s.createUser(base);
      await s.audit(me.id, "新增用户", "用户", `新增${role}用户 ${username}（#${id}）`, clientIP(c));
      return redirectWith(c, "/users", "用户创建成功");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/users/new", undefined, "创建失败：" + (e as Error).message);
    }
  });

  app.get("/users/:id/edit", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const s = store(c);
      const id = parseInt(c.req.param("id") || "", 10) || 0;
      const u = id ? await s.getUserById(id) : null;
      if (!u) return notFound(c);
      const salesTeam = (await s.listSalesUsers()).filter((x) => x.sales_level === 1 && x.id !== id);
      const ctx = pageCtx(c);
      return c.html(
        layout({ title: "编辑用户", ctx, active: "users", content: userFormPage(ctx, { user: u, salesTeam }) })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载页面失败：" + (e as Error).message), 500);
    }
  });

  app.post("/users/:id", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      const target = id ? await s.getUserById(id) : null;
      if (!target) return notFound(c);
      const { fields } = await parseForm(c);
      const newRole = (["admin", "sales", "customer"].includes(fields.role) ? fields.role : target.role) as Role;
      const newStatus = (fields.status === "disabled" ? "disabled" : "active") as "active" | "disabled";

      if (target.id === me.id && newStatus === "disabled") {
        return redirectWith(c, `/users/${id}/edit`, undefined, "不能禁用当前登录的管理员账号");
      }
      if (
        target.role === "admin" &&
        (newRole !== "admin" || newStatus === "disabled") &&
        (await s.countAdmins()) <= 1
      ) {
        return redirectWith(c, `/users/${id}/edit`, undefined, "系统必须至少保留一名正常状态的管理员");
      }

      const patch: Parameters<Store["updateUser"]>[1] = {
        role: newRole,
        status: newStatus,
        nickname: (fields.nickname || "").trim() || target.username,
        phone: (fields.phone || "").trim(),
        email: (fields.email || "").trim(),
        shipping_name: (fields.shipping_name || "").trim(),
        address: (fields.address || "").trim(),
      };
      if (newRole === "sales") {
        const level = parseInt(fields.sales_level || "1", 10) || 1;
        patch.sales_level = level === 2 ? 2 : 1;
        if (patch.sales_level === 2) {
          if ((await s.countSubordinates(id)) > 0) {
            return redirectWith(
              c,
              `/users/${id}/edit`,
              undefined,
              "该一级销售名下已有下级销售员，请先转移其下级后再变更为二级"
            );
          }
          const pid = parseInt(fields.parent_id || "", 10) || null;
          if (!pid || pid === id) {
            return redirectWith(c, `/users/${id}/edit`, undefined, "二级销售必须指定一名有效的一级销售作为上级");
          }
          patch.parent_id = pid;
        } else {
          patch.parent_id = null;
        }
        patch.commission_rate = Math.max(0, Math.min(100, parseFloat(fields.commission_rate || "") || 0));
      } else {
        patch.sales_level = 0;
        patch.parent_id = null;
      }
      if (newRole === "customer") {
        patch.credit_limit = Math.max(0, parseFloat(fields.credit_limit || "") || 0);
      }
      await s.updateUser(id, patch);
      if (newStatus === "disabled") {
        await s.deleteUserSessions(id);
      }
      const newPw = fields.password || "";
      if (newPw) {
        const pv = validatePassword(newPw);
        if (pv) return redirectWith(c, `/users/${id}/edit`, undefined, pv);
        await s.setPassword(id, await hashPassword(newPw));
        await s.deleteUserSessions(id);
      }
      await s.audit(me.id, "编辑用户", "用户", `更新用户 ${target.username}（#${id}）`, clientIP(c));
      return redirectWith(c, "/users", "用户更新成功");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, `/users/${id}/edit`, undefined, "更新失败：" + (e as Error).message);
    }
  });

  app.post("/users/:id/toggle", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      const target = id ? await s.getUserById(id) : null;
      if (!target) return notFound(c);
      if (target.id === me.id) return redirectWith(c, "/users", undefined, "不能禁用自己的账号");
      const to = target.status === "active" ? "disabled" : "active";
      if (to === "disabled" && target.role === "admin" && (await s.countAdmins()) <= 1) {
        return redirectWith(c, "/users", undefined, "不能禁用最后一个管理员");
      }
      await s.updateUser(id, { status: to });
      if (to === "disabled") await s.deleteUserSessions(id);
      await s.audit(me.id, to === "disabled" ? "禁用用户" : "启用用户", "用户", `${target.username}（#${id}）`, clientIP(c));
      return redirectWith(c, "/users", to === "disabled" ? "账号已禁用" : "账号已启用");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/users", undefined, "操作失败：" + (e as Error).message);
    }
  });

  app.post("/users/:id/reset-password", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      const target = id ? await s.getUserById(id) : null;
      if (!target) return notFound(c);
      const { fields } = await parseForm(c);
      const pv = validatePassword(fields.new_password || "");
      if (pv) return redirectWith(c, `/users/${id}/edit`, undefined, pv);
      await s.setPassword(id, await hashPassword(fields.new_password));
      await s.deleteUserSessions(id);
      await s.audit(me.id, "重置密码", "用户", `重置用户 ${target.username} 的密码并注销其全部会话`, clientIP(c));
      return redirectWith(c, "/users", "密码已重置，该用户的所有会话已注销");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, `/users/${id}/edit`, undefined, "重置失败：" + (e as Error).message);
    }
  });

  // ================= 个人中心（含收货信息设置） =================
  app.get("/profile", async (c) => {
    try {
      const u = me(c);
      const s = store(c);
      const full = await s.getUserById(u.id);
      if (!full) throw new HTTPException(302, { res: c.redirect("/login", 302) });
      const sid = sidFromCookie(c);
      const [sessions, secq] = await Promise.all([
        s.listSessionsByUser(u.id),
        s.getSecurityQuestions(u.id),
      ]);
      const onboarding = c.req.query("onboarding") === "1";
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: u.role === "customer" ? "收货信息与个人中心" : "个人中心",
          ctx,
          active: "profile",
          content: profilePage(ctx, {
            user: full,
            sessions,
            currentDigest: sid ? await sha256hex(sid) : "",
            hasSecQ: !!secq,
            onboarding,
          }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载个人中心失败：" + (e as Error).message), 500);
    }
  });

  app.post("/profile", async (c) => {
    const u = me(c);
    const s = store(c);
    try {
      const { fields } = await parseForm(c);
      const patch: Parameters<Store["updateUser"]>[1] = {
        nickname: (fields.nickname || "").trim() || u.username,
        phone: (fields.phone || "").trim(),
        email: (fields.email || "").trim(),
      };
      if (fields.shipping_name !== undefined) {
        patch.shipping_name = (fields.shipping_name || "").trim();
      }
      if (fields.address !== undefined) {
        patch.address = (fields.address || "").trim();
      }
      await s.updateUser(u.id, patch);
      await s.audit(u.id, "更新资料", "账号", "更新个人资料与联系方式", clientIP(c));
      return redirectWith(c, "/profile", "个人资料已保存");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/profile", undefined, "更新失败：" + (e as Error).message);
    }
  });

  /** 客户/用户专属收货信息保存接口（收货人、联系电话、详细地址） */
  app.post("/profile/shipping", async (c) => {
    const u = me(c);
    const s = store(c);
    try {
      const { fields } = await parseForm(c);
      const shipping_name = (fields.shipping_name || "").trim() || u.nickname;
      const phone = (fields.phone || "").trim();
      const address = (fields.address || "").trim();
      if (!phone) return redirectWith(c, "/profile", undefined, "请填写收货联系电话");
      if (!address) return redirectWith(c, "/profile", undefined, "请填写详细收货地址");
      await s.updateUser(u.id, { shipping_name, phone, address });
      await s.audit(u.id, "设置收货信息", "收货地址", `更新收货人 ${shipping_name} / ${phone}`, clientIP(c));
      const nextUrl = fields.next === "shop" ? "/shop" : "/profile";
      return redirectWith(c, nextUrl, "收货信息（收货人、联系电话、地址）已保存生效");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/profile", undefined, "保存收货信息失败：" + (e as Error).message);
    }
  });

  app.get("/profile/password", async (c) => {
    try {
      me(c);
      const ctx = pageCtx(c);
      return c.html(layout({ title: "修改密码", ctx, active: "profile", content: passwordFormPage(ctx) }));
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载页面失败：" + (e as Error).message), 500);
    }
  });

  app.post("/profile/password", async (c) => {
    const u = me(c);
    const s = store(c);
    try {
      const full = await s.getUserById(u.id);
      if (!full) throw new HTTPException(302, { res: c.redirect("/login", 302) });
      const { fields } = await parseForm(c);
      if (!(await verifyPassword(fields.old_password || "", full.password_hash))) {
        return redirectWith(c, "/profile/password", undefined, "原密码不正确");
      }
      const pv = validatePassword(fields.new_password || "");
      if (pv) return redirectWith(c, "/profile/password", undefined, pv);
      const confirmPw = fields.confirm_password ?? fields.confirm ?? "";
      if (fields.new_password !== confirmPw) {
        return redirectWith(c, "/profile/password", undefined, "两次输入的新密码不一致");
      }
      await s.setPassword(u.id, await hashPassword(fields.new_password));
      const sid = sidFromCookie(c);
      await s.deleteUserSessions(u.id, sid ? await sha256hex(sid) : undefined);
      await s.audit(u.id, "修改密码", "账号", "用户修改登录密码", clientIP(c));
      return redirectWith(c, "/profile", "密码修改成功，其他设备已自动下线");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/profile/password", undefined, "修改失败：" + (e as Error).message);
    }
  });

  app.get("/profile/security", async (c) => {
    try {
      const u = me(c);
      const has = !!(await store(c).getSecurityQuestions(u.id));
      const ctx = pageCtx(c);
      return c.html(
        layout({ title: "密保设置", ctx, active: "profile", content: securityFormPage(ctx, has) })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载页面失败：" + (e as Error).message), 500);
    }
  });

  app.post("/profile/security", async (c) => {
    const u = me(c);
    const s = store(c);
    try {
      const { fields } = await parseForm(c);
      const q1 = (fields.q1 || "").trim();
      const a1 = (fields.a1 || "").trim();
      const q2 = (fields.q2 || "").trim();
      const a2 = (fields.a2 || "").trim();
      const err =
        (!q1 || !a1 || !q2 || !a2 ? "请完整填写两个密保问题及答案" : null) ||
        (q1 === q2 ? "两个密保问题不能相同" : null) ||
        (a1.length < 2 || a2.length < 2 ? "密保答案至少 2 个字符" : null);
      if (err) return redirectWith(c, "/profile/security", undefined, err);
      await s.setSecurityQuestions(u.id, q1, await hashAnswer(a1), q2, await hashAnswer(a2));
      await s.audit(u.id, "设置密保", "账号", "用户更新密保问题", clientIP(c));
      return redirectWith(c, "/profile", "密保问题设置成功");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/profile/security", undefined, "设置失败：" + (e as Error).message);
    }
  });

  app.post("/profile/sessions/revoke-others", async (c) => {
    const u = me(c);
    const s = store(c);
    try {
      await parseForm(c);
      const sid = sidFromCookie(c);
      await s.deleteUserSessions(u.id, sid ? await sha256hex(sid) : undefined);
      await s.audit(u.id, "注销会话", "账号", "注销其他登录会话", clientIP(c));
      return redirectWith(c, "/profile", "已注销其他设备上的登录会话");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/profile", undefined, "操作失败：" + (e as Error).message);
    }
  });

  app.post("/profile/sessions/:id/revoke", async (c) => {
    const u = me(c);
    const s = store(c);
    try {
      await parseForm(c);
      const target = decodeURIComponent(c.req.param("id") || "");
      const sid = sidFromCookie(c);
      const current = sid ? await sha256hex(sid) : "";
      if (!target) return redirectWith(c, "/profile", undefined, "参数错误");
      if (target === current) return redirectWith(c, "/profile", undefined, "不能注销当前会话");
      const deleted = await s.deleteUserSessionById(target, u.id);
      if (!deleted) return redirectWith(c, "/profile", undefined, "会话不存在或无权操作");
      await s.audit(u.id, "注销会话", "账号", "注销指定登录会话", clientIP(c));
      return redirectWith(c, "/profile", "会话已注销");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/profile", undefined, "操作失败：" + (e as Error).message);
    }
  });

  // ================= 系统设置（管理员：含微信收款码与支付宝收款码配置） =================
  app.get("/settings", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const ctx = pageCtx(c);
      return c.html(layout({ title: "系统设置", ctx, active: "settings", content: settingsPage(ctx, c.get("settings")) }));
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载设置失败：" + (e as Error).message), 500);
    }
  });

  app.post("/settings", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    try {
      const f = await parseForm(c);
      const { fields } = f;
      const cur = await s.getSettings();

      await s.setSetting("site_name", (fields.site_name || "").trim() || "进销通");
      await s.setSetting("allow_register", fields.allow_register ? "1" : "0");
      for (const k of [
        "commission_base",
        "commission_l1_default",
        "commission_l2_default",
        "commission_l1_override",
        "backup_keep",
        "payment_note",
      ]) {
        if (fields[k] !== undefined) {
          await s.setSetting(k, (fields[k] || "").trim().slice(0, 200));
        }
      }

      // 处理微信收款二维码上传 / 清空
      let wechatKey = cur.wechat_qr_key || "";
      if (fields.clear_wechat_qr === "1" && wechatKey) {
        await c.env.R2.delete(wechatKey).catch(() => {});
        wechatKey = "";
        await s.setSetting("wechat_qr_key", "");
      }
      const wechatFile = f.file("wechat_qr");
      if (wechatFile) {
        const uploadedWechatKey = await saveUpload(c, wechatFile, "payqr");
        if (uploadedWechatKey) {
          if (wechatKey && wechatKey !== uploadedWechatKey) {
            await c.env.R2.delete(wechatKey).catch(() => {});
          }
          await s.setSetting("wechat_qr_key", uploadedWechatKey);
        }
      }

      // 处理支付宝收款二维码上传 / 清空
      let alipayKey = cur.alipay_qr_key || "";
      if (fields.clear_alipay_qr === "1" && alipayKey) {
        await c.env.R2.delete(alipayKey).catch(() => {});
        alipayKey = "";
        await s.setSetting("alipay_qr_key", "");
      }
      const alipayFile = f.file("alipay_qr");
      if (alipayFile) {
        const uploadedAlipayKey = await saveUpload(c, alipayFile, "payqr");
        if (uploadedAlipayKey) {
          if (alipayKey && alipayKey !== uploadedAlipayKey) {
            await c.env.R2.delete(alipayKey).catch(() => {});
          }
          await s.setSetting("alipay_qr_key", uploadedAlipayKey);
        }
      }

      await s.audit(me.id, "系统设置", "设置", "更新系统参数与微信/支付宝收款二维码设置", clientIP(c));
      return redirectWith(c, "/settings", "系统设置与收款二维码已保存");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/settings", undefined, "保存失败：" + (e as Error).message);
    }
  });

  // ================= 备份维护（管理员） =================
  app.get("/maintenance", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const s = store(c);
      const [listed, settings] = await Promise.all([
        c.env.R2.list({ prefix: "backups/" }),
        s.getSettings(),
      ]);
      const backups = (listed.objects || [])
        .map((o) => ({
          key: o.key,
          size: o.size,
          uploaded: o.uploaded.toISOString(),
        }))
        .sort((a, b) => b.uploaded.localeCompare(a.uploaded));
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "备份维护",
          ctx,
          active: "maintenance",
          content: maintenancePage(ctx, { backups, keep: settings.backup_keep || "14" }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载备份列表失败：" + (e as Error).message), 500);
    }
  });

  app.post("/maintenance/backup", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    try {
      await parseForm(c);
      const data = await s.exportBackup();
      const key = `backups/manual-${Date.now()}.json`;
      await c.env.R2.put(key, JSON.stringify(data), { httpMetadata: { contentType: "application/json" } });
      await s.audit(me.id, "数据备份", "备份", `创建手动备份 ${key}`, clientIP(c));
      return redirectWith(c, "/maintenance", "备份创建成功");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/maintenance", undefined, "备份失败：" + (e as Error).message);
    }
  });

  app.get("/maintenance/backup/download", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const key = (c.req.query("key") || "").trim();
      if (!key.startsWith("backups/") || key.includes("..")) return notFound(c);
      const obj = await c.env.R2.get(key);
      if (!obj) return notFound(c);
      const buf = await obj.arrayBuffer();
      const name = key.split("/").pop() || "backup.json";
      return new Response(buf, {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        },
      });
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "下载备份失败：" + (e as Error).message), 500);
    }
  });

  app.post("/maintenance/restore", async (c) => {
    needRoles(c, ["admin"]);
    const s = store(c);
    try {
      const f = await parseForm(c);
      const file = f.file("backup");
      if (!file) return redirectWith(c, "/maintenance", undefined, "请选择备份文件");
      let data: { tables?: Record<string, Record<string, unknown>[]> };
      try {
        data = JSON.parse(await file.text());
      } catch {
        return redirectWith(c, "/maintenance", undefined, "备份文件不是有效的 JSON");
      }
      if (!data || typeof data !== "object" || !data.tables) {
        return redirectWith(c, "/maintenance", undefined, "备份文件格式不正确");
      }
      await s.importBackup(data as { tables: Record<string, Record<string, unknown>[]> });
      await c.env.DB.prepare("DELETE FROM sessions").run();
      await s.audit(null, "数据恢复", "备份", `从备份文件恢复数据（${file.name}）`, clientIP(c));
      return redirectWith(c, "/login", "恢复成功，请重新登录");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/maintenance", undefined, "恢复失败：" + (e as Error).message);
    }
  });

  app.post("/maintenance/delete", async (c) => {
    const me = needRoles(c, ["admin"]);
    try {
      const { fields } = await parseForm(c);
      const key = (fields.key || "").trim();
      if (!key.startsWith("backups/") || key.includes("..")) {
        return redirectWith(c, "/maintenance", undefined, "参数错误");
      }
      await c.env.R2.delete(key);
      await store(c).audit(me.id, "删除备份", "备份", `删除备份 ${key}`, clientIP(c));
      return redirectWith(c, "/maintenance", "备份已删除");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/maintenance", undefined, "删除失败：" + (e as Error).message);
    }
  });

  // ================= 审计日志（管理员） =================
  app.get("/audit", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const s = store(c);
      const { page, pageSize } = getPagination(c);
      const q = (c.req.query("q") || "").trim();
      const res = await s.listAuditLogs({ page, pageSize, q: q || undefined });
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "审计日志",
          ctx,
          active: "audit",
          content: auditPage(ctx, { rows: res.rows, total: res.total, page, pageSize, q }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载审计日志失败：" + (e as Error).message), 500);
    }
  });

  // ================= 文件服务（需登录） =================
  app.get("/files/*", async (c) => {
    try {
      me(c);
      const raw = new URL(c.req.url).pathname.replace(/^\/files\//, "");
      const key = decodeURIComponent(raw);
      if (!key || key.includes("..")) return notFound(c);
      const obj = await c.env.R2.get(key);
      if (!obj) return notFound(c);
      return new Response(obj.body, {
        headers: {
          "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
          "Cache-Control": "public, max-age=31536000",
        },
      });
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "读取文件失败：" + (e as Error).message), 500);
    }
  });
}
