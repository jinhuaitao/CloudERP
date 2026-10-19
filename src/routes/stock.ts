// 进货 / 销售（含收货信息） / 退货 / 库存流水 / 盘点 / 预警 / 客户下单
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
  returnApplyPage,
  returnRequestListPage,
  returnRequestDetailPage,
  customerPayMethods,
  movementPage,
  adjustPage,
  warningPage,
} from "../views/stock";
import { store, pageCtx, needRoles, parseForm, redirectWith } from "./helpers";
import { getPagination, clientIP, utc8Range, round2 } from "../lib";
import { readCart, clearCartCookieHeader } from "../cart";
import type { Product } from "../db";

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
      const status = (c.req.query("status") || "").trim();
      const res = await s.listPurchaseOrders({ page, pageSize, q: q || undefined, status: status || undefined });
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "进货管理",
          ctx,
          active: "purchase",
          content: purchaseListPage(ctx, { rows: res.rows, total: res.total, page, pageSize, q, status }),
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
      const preselectPid = parseInt(c.req.query("product_id") || "", 10) || undefined;
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "新增进货单",
          ctx,
          active: "purchase",
          content: purchaseFormPage(ctx, { products: prods.rows, suppliers, preselectPid }),
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
      const paid = fields.paid !== undefined && fields.paid !== "" ? parseFloat(fields.paid) || 0 : undefined;
      const items = parseItems(f.all);
      const order_no = await s.createPurchaseOrder({
        supplier_id,
        operator_id: me.id,
        paid,
        remark: (fields.remark || "").trim(),
        items,
      });
      await s.audit(me.id, "新建进货单", "进货单", `创建进货单 ${order_no}`, clientIP(c));
      return redirectWith(c, "/purchase", `进货单 ${order_no} 创建成功，库存与加权成本已更新`);
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
      const status = (c.req.query("status") || "").trim();
      const debtOnly = c.req.query("debt") === "1";
      const res = await s.listSalesOrders({
        page,
        pageSize,
        q: q || undefined,
        status: status || undefined,
        debtOnly,
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
            status,
            debtOnly,
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
        s.listUsers({ role: "customer", status: "active", page: 1, pageSize: 200 }),
        s.listSalesUsers(),
      ]);
      const ctx = pageCtx(c);
      // 从「商品档案」点「开单」带入的商品（仅上架商品可开单）
      const pidQ = parseInt(c.req.query("product_id") || "", 10) || 0;
      const preselectPid = pidQ && prods.rows.some((p) => p.id === pidQ) ? pidQ : undefined;
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
            preselectPid,
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
      const sales_id = me.role === "sales" ? me.id : parseInt(fields.sales_id || "", 10) || null;
      const order_no = await s.createSalesOrder({
        customer_id,
        sales_id,
        operator_id: me.id,
        discount: parseFloat(fields.discount || "") || 0,
        paid: parseFloat(fields.paid || "") || 0,
        payment: (fields.payment || "").trim() || "cash",
        shipping_name: (fields.shipping_name || "").trim(),
        shipping_phone: (fields.shipping_phone || "").trim(),
        shipping_address: (fields.shipping_address || "").trim(),
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
        throw new HTTPException(403, {
          res: c.html(errorPage(pageCtx(c), 403, "无权访问", "您只能查看自己的销售单。"), 403),
        });
      }
      if (me.role === "customer" && o.customer_id !== me.id) {
        throw new HTTPException(403, {
          res: c.html(errorPage(pageCtx(c), 403, "无权访问", "您只能查看自己的订单。"), 403),
        });
      }
      const ctx = pageCtx(c);
      const customerBalance = o.customer_id ? await s.getBalance(o.customer_id) : undefined;
      return c.html(
        layout({
          title: `销售单 ${o.order_no}`,
          ctx,
          active: "sales",
          content: salesDetailPage(ctx, o, me.role === "admin", customerBalance),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载销售单失败：" + (e as Error).message), 500);
    }
  });

  app.post("/sales/:id/pay", async (c) => {
    const me = needRoles(c, ["admin", "sales"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      const o = id ? await s.getSalesOrder(id) : null;
      if (!o) return notFound(c);
      if (me.role === "sales" && o.sales_id !== me.id) {
        throw new HTTPException(403, {
          res: c.html(errorPage(pageCtx(c), 403, "无权访问", "您只能操作自己的销售单。"), 403),
        });
      }
      const { fields } = await parseForm(c);
      const amount = parseFloat(fields.amount || "") || 0;
      const payment = (fields.payment || "").trim() || undefined;
      const updated = await s.paySalesOrderDebt(id, amount, payment, me.id);
      await s.audit(
        me.id,
        "收款核销",
        "销售单",
        `销售单 ${updated.order_no} 补收款 ¥${amount.toFixed(2)}（累计已收 ¥${updated.paid.toFixed(2)}）`,
        clientIP(c)
      );
      return redirectWith(c, `/sales/${id}`, `已成功登记收款 ¥${amount.toFixed(2)}`);
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, `/sales/${id}`, undefined, "收款登记失败：" + (e as Error).message);
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
      const q = (c.req.query("q") || "").trim();
      const res = await s.listReturnOrders({ page, pageSize, q: q || undefined });
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "退货单",
          ctx,
          active: "returns",
          content: returnListPage(ctx, { rows: res.rows, total: res.total, page, pageSize, q }),
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
      const soNo = (c.req.query("order_no") || "").trim();

      // 带 order_no 进来时，自动按原销售单带出商品明细与成交单价
      let prefillLines: { product: Product; qty: number; price: number }[] = [];
      let defaultCustomerId: number | null = null;
      let orderHint = "";
      if (soNo) {
        const r = await s.listSalesOrders({ q: soNo, page: 1, pageSize: 10 });
        const hit = r.rows.find((x) => x.order_no === soNo);
        if (!hit) {
          orderHint = `未找到销售单号 ${soNo}，请手动选择需要退货的商品。`;
        } else if (hit.status !== "done") {
          orderHint = `销售单 ${soNo} 已作废，无法办理退货。`;
        } else {
          const full = await s.getSalesOrder(hit.id);
          defaultCustomerId = full?.customer_id ?? null;
          const byId = new Map(prods.rows.map((p) => [p.id, p]));
          for (const it of full?.items || []) {
            let p = byId.get(it.product_id);
            if (!p) {
              p = (await s.getProduct(it.product_id)) || undefined;
              if (p) {
                byId.set(p.id, p);
                prods.rows.push(p);
              }
            }
            if (p) prefillLines.push({ product: p, qty: it.qty, price: it.price });
          }
          if (prefillLines.length === 0) orderHint = `销售单 ${soNo} 未查询到可退商品明细，请手动选择。`;
        }
      }

      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "新增退货单",
          ctx,
          active: "returns",
          content: returnFormPage(ctx, {
            products: prods.rows,
            customers: customersRes.rows,
            defaultOrderNo: soNo,
            defaultCustomerId,
            prefillLines,
            orderHint,
          }),
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

  // ================= 客户退换货申请（客户提交 → 管理员审核） =================
  app.get("/returns/my", async (c) => {
    try {
      const me = needRoles(c, ["customer"]);
      const s = store(c);
      const { page, pageSize } = getPagination(c);
      const status = (c.req.query("status") || "").trim();
      const res = await s.listReturnRequests({
        page,
        pageSize,
        customerId: me.id,
        status: status || undefined,
      });
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "我的退换货申请",
          ctx,
          active: "my-returns",
          content: returnRequestListPage(ctx, {
            rows: res.rows,
            total: res.total,
            page,
            pageSize,
            status,
            forCustomer: true,
          }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载退换货申请失败：" + (e as Error).message), 500);
    }
  });

  app.get("/returns/my/:id", async (c) => {
    try {
      const me = needRoles(c, ["customer"]);
      const s = store(c);
      const id = parseInt(c.req.param("id") || "", 10) || 0;
      const req = id ? await s.getReturnRequest(id) : null;
      if (!req || req.customer_id !== me.id) return notFound(c);
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: `退换货申请 ${req.request_no}`,
          ctx,
          active: "my-returns",
          content: returnRequestDetailPage(ctx, { req, canReview: false, isOwner: true }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载申请详情失败：" + (e as Error).message), 500);
    }
  });

  app.get("/returns/apply", async (c) => {
    try {
      const me = needRoles(c, ["customer"]);
      const s = store(c);
      const orderId = parseInt(c.req.query("order_id") || "", 10) || 0;
      const order = orderId ? await s.getSalesOrder(orderId) : null;
      if (!order || order.customer_id !== me.id) return notFound(c);
      if (order.status !== "done") {
        const ctx = pageCtx(c);
        return c.html(
          errorPage(ctx, 400, "无法申请", "该订单已作废，不能申请退换货。"),
          400
        );
      }
      const [returned, pending] = await Promise.all([
        s.returnedQtyByOrder(order.id),
        s.pendingQtyByOrder(order.id),
      ]);
      const rows = (order.items || []).map((item) => {
        const r = round2(returned.get(item.product_id) || 0);
        const p = round2(pending.get(item.product_id) || 0);
        return { item, returned: r, pending: p, avail: round2(item.qty - r - p) };
      });
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "申请退换货",
          ctx,
          active: "my-returns",
          content: returnApplyPage(ctx, { order, rows, type: "return", reason: "" }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载申请页失败：" + (e as Error).message), 500);
    }
  });

  app.post("/returns/apply", async (c) => {
    const me = needRoles(c, ["customer"]);
    const s = store(c);
    let orderId = 0;
    try {
      const f = await parseForm(c);
      const fields = f.fields;
      orderId = parseInt(fields.order_id || "", 10) || 0;
      const items = parseItems(f.all).map((it) => ({ product_id: it.product_id, qty: it.qty }));
      const request_no = await s.createReturnRequest({
        customer_id: me.id,
        sales_order_id: orderId,
        type: (fields.type || "return").trim(),
        reason: (fields.reason || "").trim(),
        items,
      });
      await s.audit(me.id, "提交退换货申请", "退换货", `提交退换货申请 ${request_no}`, clientIP(c));
      return redirectWith(c, "/returns/my", `退换货申请 ${request_no} 已提交，请等待商家审核`);
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(
        c,
        orderId ? `/returns/apply?order_id=${orderId}` : "/sales",
        undefined,
        "提交失败：" + (e as Error).message
      );
    }
  });

  app.post("/returns/my/:id/cancel", async (c) => {
    const me = needRoles(c, ["customer"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      await parseForm(c);
      await s.cancelReturnRequest(id, me.id);
      await s.audit(me.id, "撤销退换货申请", "退换货", `撤销退换货申请 #${id}`, clientIP(c));
      return redirectWith(c, "/returns/my", "申请已撤销");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/returns/my", undefined, "撤销失败：" + (e as Error).message);
    }
  });

  app.get("/returns/requests", async (c) => {
    try {
      const me = needRoles(c, ["admin", "sales"]);
      const s = store(c);
      const { page, pageSize } = getPagination(c);
      const status = (c.req.query("status") || "").trim();
      const [res, pendingRes] = await Promise.all([
        s.listReturnRequests({ page, pageSize, status: status || undefined }),
        s.listReturnRequests({ page: 1, pageSize: 1, status: "pending" }),
      ]);
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "退换货审核",
          ctx,
          active: me.role === "admin" ? "return-requests" : "return-requests-sales",
          content: returnRequestListPage(ctx, {
            rows: res.rows,
            total: res.total,
            page,
            pageSize,
            status,
            forCustomer: false,
            pendingCount: pendingRes.total,
          }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载退换货申请失败：" + (e as Error).message), 500);
    }
  });

  app.get("/returns/requests/:id", async (c) => {
    try {
      const me = needRoles(c, ["admin", "sales"]);
      const s = store(c);
      const id = parseInt(c.req.param("id") || "", 10) || 0;
      const req = id ? await s.getReturnRequest(id) : null;
      if (!req) return notFound(c);
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: `退换货申请 ${req.request_no}`,
          ctx,
          active: me.role === "admin" ? "return-requests" : "return-requests-sales",
          content: returnRequestDetailPage(ctx, { req, canReview: me.role === "admin", isOwner: false }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载申请详情失败：" + (e as Error).message), 500);
    }
  });

  app.post("/returns/requests/:id/review", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      const { fields } = await parseForm(c);
      const action = fields.action === "reject" ? "reject" : "approve";
      const r = await s.reviewReturnRequest(id, action, me.id, (fields.remark || "").trim());
      await s.audit(
        me.id,
        action === "approve" ? "通过退换货申请" : "驳回退换货申请",
        "退换货",
        `申请 #${id} ${action === "approve" ? "审核通过" : "已驳回"}`,
        clientIP(c)
      );
      return redirectWith(
        c,
        `/returns/requests/${id}`,
        action === "approve"
          ? `审核通过，已生成退货单 ${r.returnOrderNo} 并回补库存`
          : "已驳回该退换货申请"
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, `/returns/requests/${id}`, undefined, "审核失败：" + (e as Error).message);
    }
  });

  app.get("/returns/:id", async (c) => {
    try {
      const me = needRoles(c, ["admin", "sales"]);
      const s = store(c);
      const id = parseInt(c.req.param("id") || "", 10) || 0;
      const o = id ? await s.getReturnOrder(id) : null;
      if (!o) return notFound(c);
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: `退货单 ${o.order_no}`,
          ctx,
          active: "returns",
          content: returnDetailPage(ctx, o, me.role === "admin"),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载退货单失败：" + (e as Error).message), 500);
    }
  });

  app.post("/returns/:id/void", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      await s.voidReturnOrder(id, me.id);
      await s.audit(me.id, "作废退货单", "退货单", `作废退货单 #${id}`, clientIP(c));
      return redirectWith(c, "/returns", "退货单已作废，库存已扣回");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/returns", undefined, "作废失败：" + (e as Error).message);
    }
  });

  // ================= 库存流水 =================
  app.get("/movements", async (c) => {
    try {
      needRoles(c, ["admin", "sales"]);
      const s = store(c);
      const { page, pageSize } = getPagination(c);
      const productIdQ = (c.req.query("product_id") || c.req.query("productId") || "").trim();
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
      if (!product_id) return redirectWith(c, "/adjust", undefined, "请选择盘点商品");
      if (isNaN(actual_qty) || actual_qty < 0) return redirectWith(c, "/adjust", undefined, "实盘数量必须为非负数值");
      await s.adjustStock({
        product_id,
        actual_qty,
        operator_id: me.id,
        remark: (fields.remark || "").trim(),
      });
      await s.audit(me.id, "库存盘点", "商品", `盘点商品 #${product_id}，实盘 ${actual_qty}`, clientIP(c));
      return redirectWith(c, "/movements", "盘点调整已入账并生成流水");
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

  // ================= 客户自助下单（自动带出并校验收货信息） =================
  app.get("/shop", async (c) => {
    try {
      const me = needRoles(c, ["customer"]);
      const s = store(c);
      const [{ rows }, customerRecord] = await Promise.all([
        s.listProducts({ status: "on", page: 1, pageSize: 200 }),
        s.getUserById(me.id),
      ]);

      // 把「商品目录」购物车渲染成订单明细：以数据库实时售价与库存为准
      const byId = new Map<number, Product>();
      for (const p of rows) byId.set(p.id, p);
      const lines: { product: Product; qty: number }[] = [];
      let removed = 0;
      let adjusted = 0;
      for (const line of readCart(c)) {
        const p = byId.get(line.id);
        if (!p || p.status !== "on" || p.stock <= 0) {
          removed++;
          continue;
        }
        const q = Math.min(line.qty, p.stock);
        if (q < line.qty) adjusted++;
        lines.push({ product: p, qty: q });
      }

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
            customerProfile: customerRecord,
            cart: { lines, removed, adjusted },
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
      const shipping_name = (fields.shipping_name || "").trim() || me.nickname;
      const shipping_phone = (fields.shipping_phone || "").trim();
      const shipping_address = (fields.shipping_address || "").trim();
      if (!shipping_phone || !shipping_address) {
        return redirectWith(c, "/shop", undefined, "请填写收货联系电话与详细收货地址以便商家发货");
      }
      if (items.length === 0) {
        return redirectWith(c, "/shop", undefined, "请至少选择一款商品并填写数量");
      }
      // 客户自助下单只认系统售价：忽略前端提交的 price，避免被改价
      const uniqIds = [...new Set(items.map((it) => it.product_id))];
      const found = await Promise.all(uniqIds.map((id) => s.getProduct(id)));
      const onSale = new Map<number, Product>();
      for (const p of found) if (p && p.status === "on") onSale.set(p.id, p);
      const pricedItems: { product_id: number; qty: number; price: number }[] = [];
      for (const it of items) {
        const p = onSale.get(it.product_id);
        if (!p) return redirectWith(c, "/shop", undefined, "部分商品已下架，请返回商品目录重新选择");
        pricedItems.push({ product_id: it.product_id, qty: it.qty, price: p.sale_price });
      }
      const payment = (fields.payment || "").trim();
      // 只接受当前「已配置」的结算方式，避免提交未开放的渠道
      const allowedPay = customerPayMethods(pageCtx(c));
      if (!payment || !allowedPay.includes(payment)) {
        return redirectWith(c, "/shop", undefined, "请选择有效的结算方式");
      }
      const order_no = await s.createSalesOrder({
        customer_id: me.id,
        sales_id: null,
        operator_id: me.id,
        discount: 0,
        paid: 0,
        payment,
        shipping_name,
        shipping_phone,
        shipping_address,
        remark: (fields.remark || "").trim(),
        items: pricedItems,
      });
      await s.audit(me.id, "客户下单", "销售单", `客户自助下单 ${order_no}`, clientIP(c));
      // 下单成功即清空购物车，避免重复下单
      const res = redirectWith(c, "/sales", `订单 ${order_no} 提交成功，已同步更新您的默认收货信息`);
      res.headers.append("Set-Cookie", clearCartCookieHeader());
      return res;
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/shop", undefined, "下单失败：" + (e as Error).message);
    }
  });
}
