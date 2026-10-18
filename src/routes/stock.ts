// 进货 / 销售 / 退货 / 库存流水 / 盘点 / 预警 / 客户下单
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import { layout, errorPage } from "../views/layout";
import {
  purchaseListPage,
  purchaseFormPage,
  purchaseDetailPage,
  salesListPage,
  salesFormPage,
  salesDetailPage,
  returnListPage,
  returnFormPage,
  returnDetailPage,
  movementPage,
  adjustPage,
  warningPage,
} from "../views/stock";
import { store, pageCtx, needRoles, parseForm, redirectWith } from "./helpers";
import { getPagination, clientIP, utc8Range } from "../lib";

/** 从平行数组组装单据明细（过滤空行） */
function parseItems(all: (name: string) => string[]): { product_id: number; qty: number; price: number }[] {
  const pids = all("product_id");
  const qtys = all("qty");
  const prices = all("price");
  const items: { product_id: number; qty: number; price: number }[] = [];
  for (let i = 0; i < pids.length; i++) {
    const pid = parseInt(pids[i] || "", 10) || 0;
    const qty = parseFloat(qtys[i] || "") || 0;
    const price = parseFloat(prices[i] || "") || 0;
    if (pid > 0 && qty > 0) items.push({ product_id: pid, qty, price });
  }
  return items;
}

function notFound(c: Parameters<typeof pageCtx>[0]) {
  return c.html(errorPage(pageCtx(c), 404, "页面不存在", "请求的单据不存在或已被删除。"), 404);
}

export function registerStock(app: Hono<AppEnv>) {
  // ================= 进货（管理员） =================
  app.get("/purchase", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const s = store(c);
      const { page, pageSize } = getPagination(c);
      const q = (c.req.query("q") || "").trim();
      const res = await s.listPurchaseOrders({ page, pageSize, q: q || undefined });
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "进货单",
          ctx,
          active: "purchase",
          content: purchaseListPage(ctx, { rows: res.rows, total: res.total, page, pageSize, q }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载进货单失败：" + (e as Error).message), 500);
    }
  });

  app.get("/purchase/new", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const s = store(c);
      const [prods, suppliers] = await Promise.all([
        s.listProducts({ page: 1, pageSize: 200 }),
        s.listSuppliers(),
      ]);
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "新增进货单",
          ctx,
          active: "purchase",
          content: purchaseFormPage(ctx, { products: prods.rows, suppliers }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载页面失败：" + (e as Error).message), 500);
    }
  });

  app.post("/purchase/new", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    try {
      const f = await parseForm(c);
      const fields = f.fields;
      const supplier_id = parseInt(fields.supplier_id || "", 10) || null;
      const items = parseItems(f.all);
      const order_no = await s.createPurchaseOrder({
        supplier_id,
        operator_id: me.id,
        remark: (fields.remark || "").trim(),
        items,
      });
      await s.audit(me.id, "新建进货单", "进货单", `创建进货单 ${order_no}`, clientIP(c));
      return redirectWith(c, "/purchase", `进货单 ${order_no} 创建成功`);
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/purchase/new", undefined, "创建失败：" + (e as Error).message);
    }
  });

  app.get("/purchase/:id", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const s = store(c);
      const id = parseInt(c.req.param("id") || "", 10) || 0;
      const o = id ? await s.getPurchaseOrder(id) : null;
      if (!o) return notFound(c);
      const ctx = pageCtx(c);
      return c.html(
        layout({ title: `进货单 ${o.order_no}`, ctx, active: "purchase", content: purchaseDetailPage(ctx, o) })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载进货单失败：" + (e as Error).message), 500);
    }
  });

  app.post("/purchase/:id/void", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      await s.voidPurchaseOrder(id, me.id);
      await s.audit(me.id, "作废进货单", "进货单", `作废进货单 #${id}`, clientIP(c));
      return redirectWith(c, "/purchase", "进货单已作废，库存已回滚");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/purchase", undefined, "作废失败：" + (e as Error).message);
    }
  });

  // ================= 销售 =================
  app.get("/sales", async (c) => {
    try {
      const me = needRoles(c, ["admin", "sales", "customer"]);
      const s = store(c);
      const { page, pageSize } = getPagination(c);
      const q = (c.req.query("q") || "").trim();
      const res = await s.listSalesOrders({
        page,
        pageSize,
        q: q || undefined,
        salesId: me.role === "sales" ? me.id : undefined,
        customerId: me.role === "customer" ? me.id : undefined,
      });
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "销售单",
          ctx,
          active: "sales",
          content: salesListPage(ctx, {
            rows: res.rows,
            total: res.total,
            page,
            pageSize,
            q,
            canCreate: me.role !== "customer",
            showSales: me.role === "admin",
          }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载销售单失败：" + (e as Error).message), 500);
    }
  });

  app.get("/sales/new", async (c) => {
    try {
      const me = needRoles(c, ["admin", "sales"]);
      const s = store(c);
      const [prods, customersRes, salesTeam] = await Promise.all([
        s.listProducts({ status: "on", page: 1, pageSize: 200 }),
        s.listUsers({ role: "customer", page: 1, pageSize: 200 }),
        s.listSalesUsers(),
      ]);
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "新增销售单",
          ctx,
          active: me.role === "sales" ? "sales-new" : "sales",
          content: salesFormPage(ctx, {
            products: prods.rows,
            customers: customersRes.rows,
            salesTeam,
            action: "/sales/new",
            forCustomer: false,
            defaultSalesId: me.role === "sales" ? me.id : undefined,
          }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载页面失败：" + (e as Error).message), 500);
    }
  });

  app.post("/sales/new", async (c) => {
    const me = needRoles(c, ["admin", "sales"]);
    const s = store(c);
    try {
      const f = await parseForm(c);
      const fields = f.fields;
      const items = parseItems(f.all);
      const customer_id = parseInt(fields.customer_id || "", 10) || null;
      // 销售员只能以自己名义开单；管理员可指定
      const sales_id = me.role === "sales" ? me.id : parseInt(fields.sales_id || "", 10) || null;
      const order_no = await s.createSalesOrder({
        customer_id,
        sales_id,
        operator_id: me.id,
        discount: parseFloat(fields.discount || "") || 0,
        paid: parseFloat(fields.paid || "") || 0,
        payment: (fields.payment || "").trim() || "cash",
        remark: (fields.remark || "").trim(),
        items,
      });
      await s.audit(me.id, "新建销售单", "销售单", `创建销售单 ${order_no}`, clientIP(c));
      return redirectWith(c, "/sales", `销售单 ${order_no} 创建成功`);
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/sales/new", undefined, "创建失败：" + (e as Error).message);
    }
  });

  app.get("/sales/:id", async (c) => {
    try {
      const me = needRoles(c, ["admin", "sales", "customer"]);
      const s = store(c);
      const id = parseInt(c.req.param("id") || "", 10) || 0;
      const o = id ? await s.getSalesOrder(id) : null;
      if (!o) return notFound(c);
      if (me.role === "sales" && o.sales_id !== me.id) {
        throw new HTTPException(403, { res: c.html(errorPage(pageCtx(c), 403, "无权访问", "您只能查看自己的销售单。"), 403) });
      }
      if (me.role === "customer" && o.customer_id !== me.id) {
        throw new HTTPException(403, { res: c.html(errorPage(pageCtx(c), 403, "无权访问", "您只能查看自己的订单。"), 403) });
      }
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: `销售单 ${o.order_no}`,
          ctx,
          active: "sales",
          content: salesDetailPage(ctx, o, me.role === "admin"),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载销售单失败：" + (e as Error).message), 500);
    }
  });

  app.post("/sales/:id/void", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      await s.voidSalesOrder(id, me.id);
      await s.audit(me.id, "作废销售单", "销售单", `作废销售单 #${id}`, clientIP(c));
      return redirectWith(c, "/sales", "销售单已作废，库存与待结算佣金已回滚");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/sales", undefined, "作废失败：" + (e as Error).message);
    }
  });

  // ================= 销售退货（管理员 / 销售） =================
  app.get("/returns", async (c) => {
    try {
      needRoles(c, ["admin", "sales"]);
      const s = store(c);
      const { page, pageSize } = getPagination(c);
      const res = await s.listReturnOrders({ page, pageSize });
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "退货单",
          ctx,
          active: "returns",
          content: returnListPage(ctx, { rows: res.rows, total: res.total, page, pageSize }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载退货单失败：" + (e as Error).message), 500);
    }
  });

  app.get("/returns/new", async (c) => {
    try {
      needRoles(c, ["admin", "sales"]);
      const s = store(c);
      const [prods, customersRes] = await Promise.all([
        s.listProducts({ page: 1, pageSize: 200 }),
        s.listUsers({ role: "customer", page: 1, pageSize: 200 }),
      ]);
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "新增退货单",
          ctx,
          active: "returns",
          content: returnFormPage(ctx, { products: prods.rows, customers: customersRes.rows }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载页面失败：" + (e as Error).message), 500);
    }
  });

  app.post("/returns/new", async (c) => {
    const me = needRoles(c, ["admin", "sales"]);
    const s = store(c);
    try {
      const f = await parseForm(c);
      const fields = f.fields;
      const items = parseItems(f.all);
      const customer_id = parseInt(fields.customer_id || "", 10) || null;
      // 关联原销售单：按单号精确匹配
      let sales_order_id: number | null = null;
      const soNo = (fields.sales_order_no || "").trim();
      if (soNo) {
        const r = await s.listSalesOrders({ q: soNo, page: 1, pageSize: 10 });
        const hit = r.rows.find((x) => x.order_no === soNo);
        if (!hit) return redirectWith(c, "/returns/new", undefined, `未找到销售单号 ${soNo}`);
        sales_order_id = hit.id;
      }
      const order_no = await s.createReturnOrder({
        sales_order_id,
        customer_id,
        operator_id: me.id,
        remark: (fields.remark || "").trim(),
        items,
      });
      await s.audit(me.id, "新建退货单", "退货单", `创建退货单 ${order_no}`, clientIP(c));
      return redirectWith(c, "/returns", `退货单 ${order_no} 创建成功`);
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/returns/new", undefined, "创建失败：" + (e as Error).message);
    }
  });

  app.get("/returns/:id", async (c) => {
    try {
      needRoles(c, ["admin", "sales"]);
      const s = store(c);
      const id = parseInt(c.req.param("id") || "", 10) || 0;
      const o = id ? await s.getReturnOrder(id) : null;
      if (!o) return notFound(c);
      const ctx = pageCtx(c);
      return c.html(
        layout({ title: `退货单 ${o.order_no}`, ctx, active: "returns", content: returnDetailPage(ctx, o) })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载退货单失败：" + (e as Error).message), 500);
    }
  });

  // ================= 库存流水 =================
  app.get("/movements", async (c) => {
    try {
      needRoles(c, ["admin", "sales"]);
      const s = store(c);
      const { page, pageSize } = getPagination(c);
      const productIdQ = (c.req.query("product_id") || "").trim();
      const productId = parseInt(productIdQ, 10) || null;
      const type = (c.req.query("type") || "").trim();
      const fromQ = (c.req.query("from") || "").trim();
      const toQ = (c.req.query("to") || "").trim();
      const from = fromQ ? utc8Range(fromQ).start : undefined;
      const to = toQ ? utc8Range(toQ).end : undefined;
      const [res, prods] = await Promise.all([
        s.listMovements({ productId: productId || undefined, type: type || undefined, from, to, page, pageSize }),
        s.listProducts({ page: 1, pageSize: 200 }),
      ]);
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "库存流水",
          ctx,
          active: "movements",
          content: movementPage(ctx, {
            rows: res.rows,
            total: res.total,
            page,
            pageSize,
            products: prods.rows,
            f: { productId: productIdQ, type, from: fromQ, to: toQ },
          }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载库存流水失败：" + (e as Error).message), 500);
    }
  });

  // ================= 库存盘点（管理员） =================
  app.get("/adjust", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const { rows } = await store(c).listProducts({ page: 1, pageSize: 200 });
      const ctx = pageCtx(c);
      return c.html(layout({ title: "库存盘点", ctx, active: "adjust", content: adjustPage(ctx, rows) }));
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载页面失败：" + (e as Error).message), 500);
    }
  });

  app.post("/adjust", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    try {
      const { fields } = await parseForm(c);
      const product_id = parseInt(fields.product_id || "", 10) || 0;
      const actual_qty = parseFloat(fields.actual_qty || "");
      if (!product_id) return redirectWith(c, "/adjust", undefined, "请选择商品");
      if (isNaN(actual_qty) || actual_qty < 0) return redirectWith(c, "/adjust", undefined, "实盘数量无效");
      await s.adjustStock({
        product_id,
        actual_qty,
        operator_id: me.id,
        remark: (fields.remark || "").trim(),
      });
      await s.audit(me.id, "库存盘点", "商品", `盘点商品 #${product_id}，实盘 ${actual_qty}`, clientIP(c));
      return redirectWith(c, "/movements", "盘点调整已入账");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/adjust", undefined, "盘点失败：" + (e as Error).message);
    }
  });

  // ================= 库存预警 =================
  app.get("/warnings", async (c) => {
    try {
      needRoles(c, ["admin", "sales"]);
      const rows = await store(c).lowStockProducts();
      const ctx = pageCtx(c);
      return c.html(layout({ title: "库存预警", ctx, active: "warnings", content: warningPage(ctx, rows) }));
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载预警失败：" + (e as Error).message), 500);
    }
  });

  // ================= 客户自助下单 =================
  app.get("/shop", async (c) => {
    try {
      needRoles(c, ["customer"]);
      const { rows } = await store(c).listProducts({ status: "on", page: 1, pageSize: 200 });
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "自助下单",
          ctx,
          active: "shop",
          content: salesFormPage(ctx, {
            products: rows,
            customers: [],
            salesTeam: [],
            action: "/shop",
            forCustomer: true,
          }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载下单页失败：" + (e as Error).message), 500);
    }
  });

  app.post("/shop", async (c) => {
    const me = needRoles(c, ["customer"]);
    const s = store(c);
    try {
      const f = await parseForm(c);
      const fields = f.fields;
      const items = parseItems(f.all);
      const order_no = await s.createSalesOrder({
        customer_id: me.id,
        sales_id: null,
        operator_id: me.id,
        discount: 0,
        paid: 0,
        payment: (fields.payment || "").trim() || "cash",
        remark: (fields.remark || "").trim(),
        items,
      });
      await s.audit(me.id, "客户下单", "销售单", `客户自助下单 ${order_no}`, clientIP(c));
      return redirectWith(c, "/sales", "下单成功，等待商家处理");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/shop", undefined, "下单失败：" + (e as Error).message);
    }
  });
}
