// 进货 / 销售 / 退货 / 库存流水 / 盘点 / 预警
import { esc, money, qty, fmtDT } from "../lib";
import {
  layout,
  pageHead,
  badge,
  emptyRow,
  pagerHtml,
  csrfInput,
  field,
  type ViewCtx,
} from "./layout";
import type {
  User,
  Supplier,
  Product,
  PurchaseOrder,
  SalesOrder,
  ReturnOrder,
  StockMovement,
} from "../db";
import { movementTypeName, paymentName } from "../db";
import { fileUrl } from "./products";

/** 单据状态徽章 */
function orderStatusBadge(status: string): string {
  if (status === "void") return badge("已作废", "gray");
  if (status === "done") return badge("已完成", "green");
  return badge(status, "blue");
}

function tp(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

// ---------- 动态明细行（app.js 负责增删行与合计计算） ----------
// 服务端约定：每行 product_id / qty / price 三个字段重复提交，
// Hono parseBody 会将同名字段解析为数组，按下标一一对应；空行由服务端过滤。

function productOptions(products: Product[], priceKey: "purchase_price" | "sale_price"): string {
  return products
    .map(
      (p) =>
        `<option value="${p.id}" data-price="${p[priceKey]}">${esc(p.name)}${p.sku ? `（${esc(p.sku)}）` : ""} · 库存 ${qty(p.stock)}</option>`
    )
    .join("");
}

function itemRow(products: Product[], priceKey: "purchase_price" | "sale_price"): string {
  return `<div class="item-row">
    <select name="product_id" data-role="item-product" required><option value="">请选择商品</option>${productOptions(products, priceKey)}</select>
    <input type="number" name="qty" data-role="item-qty" min="0" step="0.01" value="1" required>
    <input type="number" name="price" data-role="item-price" min="0" step="0.01" placeholder="单价" required>
    <span class="amount" data-role="item-amount">¥0.00</span>
    <button type="button" class="row-del" data-action="remove-row" title="删除该行">✕</button>
  </div>`;
}

function orderItemsBlock(products: Product[], priceKey: "purchase_price" | "sale_price"): string {
  return `<div class="card"><h3>🧾 商品明细</h3>
    <div id="orderItems">${itemRow(products, priceKey)}</div>
    <div class="btn-row"><button type="button" class="btn secondary" data-action="add-row">＋ 添加商品</button></div>
    <div class="order-total" id="orderTotal">合计：<span>¥0.00</span></div>
  </div>`;
}

// ================= 进货 =================

export function purchaseListPage(
  ctx: ViewCtx,
  d: { rows: PurchaseOrder[]; total: number; page: number; pageSize: number; q: string }
): string {
  const rows =
    d.rows.length > 0
      ? d.rows
          .map(
            (o) => `<tr>
              <td><a href="/purchase/${o.id}">${esc(o.order_no)}</a></td>
              <td>${esc(o.supplier_name || "—")}</td>
              <td class="num">${money(o.total)}</td>
              <td>${esc(o.operator_name || "—")}</td>
              <td>${orderStatusBadge(o.status)}</td>
              <td class="muted small">${fmtDT(o.created_at)}</td>
              <td><div class="btn-row">
                <a class="btn small secondary" href="/purchase/${o.id}">查看</a>
                ${
                  o.status === "done"
                    ? `<form class="inline-form" method="post" action="/purchase/${o.id}/void" data-confirm="作废后将扣减库存并生成流水记录，确定作废进货单 ${esc(o.order_no)} 吗？">${csrfInput(ctx.csrf)}<button class="btn small danger" type="submit">作废</button></form>`
                    : ""
                }
              </div></td>
            </tr>`
          )
          .join("")
      : emptyRow(7, "暂无进货单");

  const content = `
    ${pageHead("📥 进货管理", `共 ${d.total} 张进货单`, `<a class="btn primary" href="/purchase/new">＋ 新建进货单</a>`)}
    <form class="toolbar" method="get" action="/purchase">
      <input type="text" name="q" value="${esc(d.q)}" placeholder="🔍 进货单号" maxlength="64">
      <button class="btn secondary" type="submit">搜索</button>
      ${d.q ? `<a class="btn secondary" href="/purchase">清除</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>单号</th><th>供应商</th><th class="num">金额</th><th>操作人</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/purchase", { q: d.q }, d.page, tp(d.total, d.pageSize))}
    </div>`;

  return layout({ title: "进货管理", ctx, active: "purchase", content });
}

export function purchaseFormPage(
  ctx: ViewCtx,
  d: { products: Product[]; suppliers: Supplier[] }
): string {
  const supOptions = [`<option value="">— 直接采购 / 无供应商 —</option>`]
    .concat(d.suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`))
    .join("");

  const content = `
    ${pageHead("＋ 新建进货单", "选择供应商并添加商品明细", `<a class="btn secondary" href="/purchase">← 返回列表</a>`)}
    <form method="post" action="/purchase/new">
      ${csrfInput(ctx.csrf)}
      <div class="card"><h3>📝 单据信息</h3>
        <div class="form-row">
          ${field("供应商", `<select name="supplier_id">${supOptions}</select>`)}
          ${field("备注", `<input type="text" name="remark" maxlength="200" placeholder="选填">`)}
        </div>
      </div>
      ${orderItemsBlock(d.products, "purchase_price")}
      <div class="btn-row">
        <button class="btn primary" type="submit">✅ 提交进货单</button>
        <a class="btn secondary" href="/purchase">取消</a>
      </div>
      <p class="muted small mt">提交后将增加商品库存、更新进价并生成入库流水。</p>
    </form>`;

  return layout({ title: "新建进货单", ctx, active: "purchase", content });
}

export function purchaseDetailPage(ctx: ViewCtx, o: PurchaseOrder): string {
  const items = (o.items || [])
    .map(
      (it, i) =>
        `<tr><td>${i + 1}</td><td>${esc(it.product_name || "—")}</td><td class="num">${qty(it.qty)}</td><td class="num">${money(it.price)}</td><td class="num">${money(it.amount)}</td></tr>`
    )
    .join("");

  const content = `
    ${pageHead(
      `进货单 ${o.order_no}`,
      `${fmtDT(o.created_at)}`,
      `<a class="btn secondary" href="/purchase">← 返回列表</a>
       ${
         o.status === "done"
           ? `<form class="inline-form" method="post" action="/purchase/${o.id}/void" data-confirm="作废后将扣减库存并生成流水记录，确定作废吗？">${csrfInput(ctx.csrf)}<button class="btn danger" type="submit">作废此单</button></form>`
           : ""
       }`
    )}
    <div class="card"><h3>📝 单据信息 ${orderStatusBadge(o.status)}</h3>
      <dl class="kv">
        <dt>单号</dt><dd>${esc(o.order_no)}</dd>
        <dt>供应商</dt><dd>${esc(o.supplier_name || "—")}</dd>
        <dt>操作人</dt><dd>${esc(o.operator_name || "—")}</dd>
        <dt>总金额</dt><dd><strong>${money(o.total)}</strong></dd>
        <dt>备注</dt><dd>${esc(o.remark || "—")}</dd>
        <dt>创建时间</dt><dd>${fmtDT(o.created_at)}</dd>
      </dl>
    </div>
    <div class="card"><h3>🧾 商品明细</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>#</th><th>商品</th><th class="num">数量</th><th class="num">单价</th><th class="num">金额</th></tr></thead>
        <tbody>${items || emptyRow(5)}</tbody>
      </table></div>
    </div>`;

  return layout({ title: `进货单 ${o.order_no}`, ctx, active: "purchase", content });
}

// ================= 销售 =================

export function salesListPage(
  ctx: ViewCtx,
  d: {
    rows: SalesOrder[];
    total: number;
    page: number;
    pageSize: number;
    q: string;
    canCreate: boolean;
    showSales: boolean;
  }
): string {
  const isCustomer = ctx.user?.role === "customer";
  const newBtn = d.canCreate
    ? `<a class="btn primary" href="${isCustomer ? "/shop" : "/sales/new"}">${isCustomer ? "🛒 我要下单" : "＋ 新建销售单"}</a>`
    : "";

  const rows =
    d.rows.length > 0
      ? d.rows
          .map(
            (o) => `<tr>
              <td><a href="/sales/${o.id}">${esc(o.order_no)}</a></td>
              <td>${esc(o.customer_name || "散客")}</td>
              ${d.showSales ? `<td>${esc(o.sales_name || "—")}</td>` : ""}
              <td class="num">${money(o.total)}</td>
              <td class="num">${money(o.paid)}</td>
              <td>${esc(paymentName(o.payment))}</td>
              <td>${orderStatusBadge(o.status)}</td>
              <td class="muted small">${fmtDT(o.created_at)}</td>
              <td><a class="btn small secondary" href="/sales/${o.id}">查看</a></td>
            </tr>`
          )
          .join("")
      : emptyRow(d.showSales ? 9 : 8, "暂无销售单");

  const content = `
    ${pageHead(isCustomer ? "📋 我的订单" : "📤 销售管理", `共 ${d.total} 张销售单`, newBtn)}
    <form class="toolbar" method="get" action="/sales">
      <input type="text" name="q" value="${esc(d.q)}" placeholder="🔍 销售单号" maxlength="64">
      <button class="btn secondary" type="submit">搜索</button>
      ${d.q ? `<a class="btn secondary" href="/sales">清除</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>单号</th><th>客户</th>${d.showSales ? "<th>销售员</th>" : ""}<th class="num">金额</th><th class="num">实收</th><th>支付方式</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/sales", { q: d.q }, d.page, tp(d.total, d.pageSize))}
    </div>`;

  return layout({ title: isCustomer ? "我的订单" : "销售管理", ctx, active: "sales", content });
}

export interface SalesFormData {
  products: Product[];
  customers: User[];
  salesTeam: User[];
  action: string;
  forCustomer: boolean;
  defaultSalesId?: number | null;
}

export function salesFormPage(ctx: ViewCtx, d: SalesFormData): string {
  const sellable = d.products.filter((p) => p.status === "on");
  const isCustomer = d.forCustomer;

  const customerField = isCustomer
    ? `<div class="card"><p>🛒 <strong>自助下单</strong>：订单将自动关联到您的账号（${esc(ctx.user?.nickname || "")}）。</p></div>`
    : d.customers.length
      ? field(
          "客户",
          `<select name="customer_id"><option value="">— 散客（不关联客户）—</option>${d.customers
            .map((u) => `<option value="${u.id}">${esc(u.nickname)}（${esc(u.username)}）</option>`)
            .join("")}</select>`,
          "关联客户可统计其消费与欠款"
        )
      : "";

  const salesField = isCustomer
    ? ""
    : d.salesTeam.length
      ? field(
          "归属销售",
          `<select name="sales_id"><option value="">— 无 —</option>${d.salesTeam
            .map(
              (u) =>
                `<option value="${u.id}"${d.defaultSalesId === u.id ? " selected" : ""}>${esc(u.nickname)}（${esc(u.username)}）</option>`
            )
            .join("")}</select>`,
          "该笔订单的业绩归属，用于统计与分佣"
        )
      : d.defaultSalesId
        ? `<input type="hidden" name="sales_id" value="${d.defaultSalesId}">`
        : "";

  const payOptions = ["cash", "wechat", "alipay", "bank", "credit"]
    .map((k) => `<option value="${k}">${esc(paymentName(k))}</option>`)
    .join("");

  const content = `
    ${pageHead(isCustomer ? "🛒 我要下单" : "＋ 新建销售单", isCustomer ? "挑选商品，提交后等待商家确认" : "选择客户并添加商品明细", `<a class="btn secondary" href="${isCustomer ? "/sales" : "/sales"}">← 返回</a>`)}
    <form method="post" action="${esc(d.action)}">
      ${csrfInput(ctx.csrf)}
      ${
        isCustomer
          ? customerField
          : `<div class="card"><h3>📝 单据信息</h3>
          <div class="form-row">
            ${customerField}
            ${salesField}
          </div>
          <div class="form-row cols-4">
            ${field("折扣（元）", `<input type="number" name="discount" min="0" step="0.01" value="0">`)}
            ${field("实收（元）", `<input type="number" name="paid" min="0" step="0.01" value="0">`, "未收足将计入客户欠款")}
            ${field("支付方式", `<select name="payment">${payOptions}</select>`)}
            ${field("备注", `<input type="text" name="remark" maxlength="200" placeholder="选填">`)}
          </div>
        </div>`
      }
      ${orderItemsBlock(sellable, "sale_price")}
      <div class="btn-row">
        <button class="btn primary" type="submit">${isCustomer ? "🛒 提交订单" : "✅ 提交销售单"}</button>
        <a class="btn secondary" href="/sales">取消</a>
      </div>
      <p class="muted small mt">${isCustomer ? "提交后商家将尽快处理您的订单。" : "提交后将扣减库存、生成出库流水，并按规则计算销售佣金。"}</p>
    </form>`;

  return layout({ title: isCustomer ? "我要下单" : "新建销售单", ctx, active: isCustomer ? "shop" : "sales-new", content });
}

export function salesDetailPage(ctx: ViewCtx, o: SalesOrder, canVoid: boolean): string {
  const isAdmin = ctx.user?.role === "admin";
  const items = (o.items || [])
    .map((it, i) => {
      const profit = (it.price - it.cost) * it.qty;
      return `<tr><td>${i + 1}</td><td>${esc(it.product_name || "—")}</td><td class="num">${qty(it.qty)}</td><td class="num">${money(it.price)}</td>${
        isAdmin ? `<td class="num">${money(it.cost)}</td>` : ""
      }<td class="num">${money(it.amount)}</td>${
        isAdmin ? `<td class="num ${profit >= 0 ? "pos" : "neg"}">${money(profit)}</td>` : ""
      }</tr>`;
    })
    .join("");
  const debt = Math.round((o.total - o.paid) * 100) / 100;

  const content = `
    ${pageHead(
      `销售单 ${o.order_no}`,
      `${fmtDT(o.created_at)}`,
      `<a class="btn secondary" href="/sales">← 返回列表</a>
       ${
         canVoid && o.status === "done"
           ? `<form class="inline-form" method="post" action="/sales/${o.id}/void" data-confirm="作废后将返还库存、删除未结算佣金并生成流水记录，确定作废吗？">${csrfInput(ctx.csrf)}<button class="btn danger" type="submit">作废此单</button></form>`
           : ""
       }`
    )}
    <div class="card"><h3>📝 单据信息 ${orderStatusBadge(o.status)}</h3>
      <dl class="kv">
        <dt>单号</dt><dd>${esc(o.order_no)}</dd>
        <dt>客户</dt><dd>${esc(o.customer_name || "散客")}</dd>
        <dt>销售员</dt><dd>${esc(o.sales_name || "—")}</dd>
        <dt>总金额</dt><dd><strong>${money(o.total)}</strong>${o.discount > 0 ? `（含折扣 ${money(o.discount)}）` : ""}</dd>
        <dt>实收</dt><dd>${money(o.paid)}</dd>
        <dt>欠款</dt><dd class="${debt > 0 ? "neg" : ""}">${money(debt)}</dd>
        <dt>支付方式</dt><dd>${esc(paymentName(o.payment))}</dd>
        <dt>备注</dt><dd>${esc(o.remark || "—")}</dd>
        <dt>创建时间</dt><dd>${fmtDT(o.created_at)}</dd>
      </dl>
    </div>
    <div class="card"><h3>🧾 商品明细${isAdmin ? "（含成本与利润，仅管理员可见）" : ""}</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>#</th><th>商品</th><th class="num">数量</th><th class="num">单价</th>${isAdmin ? `<th class="num">成本价</th>` : ""}<th class="num">小计</th>${isAdmin ? `<th class="num">利润</th>` : ""}</tr></thead>
        <tbody>${items || emptyRow(isAdmin ? 7 : 5)}</tbody>
      </table></div>
    </div>`;

  return layout({ title: `销售单 ${o.order_no}`, ctx, active: "sales", content });
}

// ================= 销售退货 =================

export function returnListPage(
  ctx: ViewCtx,
  d: { rows: ReturnOrder[]; total: number; page: number; pageSize: number }
): string {
  const rows =
    d.rows.length > 0
      ? d.rows
          .map(
            (o) => `<tr>
              <td><a href="/returns/${o.id}">${esc(o.order_no)}</a></td>
              <td>${o.sales_order_no ? esc(o.sales_order_no) : `<span class="muted">—</span>`}</td>
              <td>${esc(o.customer_name || "—")}</td>
              <td class="num">${money(o.total)}</td>
              <td>${esc(o.operator_name || "—")}</td>
              <td class="muted small">${fmtDT(o.created_at)}</td>
              <td><a class="btn small secondary" href="/returns/${o.id}">查看</a></td>
            </tr>`
          )
          .join("")
      : emptyRow(7, "暂无退货单");

  const content = `
    ${pageHead("↩️ 销售退货", `共 ${d.total} 张退货单`, `<a class="btn primary" href="/returns/new">＋ 新建退货单</a>`)}
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>单号</th><th>关联销售单</th><th>客户</th><th class="num">金额</th><th>操作人</th><th>时间</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/returns", {}, d.page, tp(d.total, d.pageSize))}
    </div>`;

  return layout({ title: "销售退货", ctx, active: "returns", content });
}

export function returnFormPage(ctx: ViewCtx, d: { products: Product[]; customers: User[] }): string {
  const sellable = d.products.filter((p) => p.status === "on");
  const cusOptions = [`<option value="">— 不关联客户 —</option>`]
    .concat(d.customers.map((u) => `<option value="${u.id}">${esc(u.nickname)}（${esc(u.username)}）</option>`))
    .join("");

  const content = `
    ${pageHead("＋ 新建退货单", "退货将返还商品库存", `<a class="btn secondary" href="/returns">← 返回列表</a>`)}
    <form method="post" action="/returns/new">
      ${csrfInput(ctx.csrf)}
      <div class="card"><h3>📝 单据信息</h3>
        <div class="form-row">
          ${field("关联销售单号", `<input type="text" name="sales_order_no" maxlength="32" placeholder="选填，如 SO202610180123">`, "填写原销售单号便于追溯")}
          ${field("客户", `<select name="customer_id">${cusOptions}</select>`)}
        </div>
        ${field("备注", `<input type="text" name="remark" maxlength="200" placeholder="选填，退货原因等">`)}
      </div>
      ${orderItemsBlock(sellable, "sale_price")}
      <div class="btn-row">
        <button class="btn primary" type="submit">✅ 提交退货单</button>
        <a class="btn secondary" href="/returns">取消</a>
      </div>
      <p class="muted small mt">提交后将增加商品库存并生成退货入库流水。</p>
    </form>`;

  return layout({ title: "新建退货单", ctx, active: "returns", content });
}

export function returnDetailPage(ctx: ViewCtx, o: ReturnOrder): string {
  const items = (o.items || [])
    .map(
      (it, i) =>
        `<tr><td>${i + 1}</td><td>${esc(it.product_name || "—")}</td><td class="num">${qty(it.qty)}</td><td class="num">${money(it.price)}</td><td class="num">${money(it.amount)}</td></tr>`
    )
    .join("");

  const content = `
    ${pageHead(`退货单 ${o.order_no}`, `${fmtDT(o.created_at)}`, `<a class="btn secondary" href="/returns">← 返回列表</a>`)}
    <div class="card"><h3>📝 单据信息 ${orderStatusBadge(o.status)}</h3>
      <dl class="kv">
        <dt>单号</dt><dd>${esc(o.order_no)}</dd>
        <dt>关联销售单</dt><dd>${o.sales_order_no ? esc(o.sales_order_no) : "—"}</dd>
        <dt>客户</dt><dd>${esc(o.customer_name || "—")}</dd>
        <dt>操作人</dt><dd>${esc(o.operator_name || "—")}</dd>
        <dt>总金额</dt><dd><strong>${money(o.total)}</strong></dd>
        <dt>备注</dt><dd>${esc(o.remark || "—")}</dd>
        <dt>创建时间</dt><dd>${fmtDT(o.created_at)}</dd>
      </dl>
    </div>
    <div class="card"><h3>🧾 商品明细</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>#</th><th>商品</th><th class="num">数量</th><th class="num">单价</th><th class="num">金额</th></tr></thead>
        <tbody>${items || emptyRow(5)}</tbody>
      </table></div>
    </div>`;

  return layout({ title: `退货单 ${o.order_no}`, ctx, active: "returns", content });
}

// ================= 库存流水 =================

const MOVEMENT_TYPES = ["purchase_in", "sale_out", "return_in", "adjust", "void"] as const;

function movementBadge(t: string): string {
  const kind =
    t === "purchase_in" ? "green" : t === "sale_out" ? "blue" : t === "return_in" ? "yellow" : t === "void" ? "red" : "gray";
  return badge(movementTypeName(t), kind as "green" | "blue" | "yellow" | "red" | "gray");
}

function refDoc(m: StockMovement): string {
  const label =
    m.ref_type === "purchase" ? "进货单" : m.ref_type === "sales" ? "销售单" : m.ref_type === "returns" ? "退货单" : "";
  if (!label || !m.ref_id) return `<span class="muted">—</span>`;
  return esc(`${label} #${m.ref_id}`);
}

export interface MovementFilter {
  productId: string;
  type: string;
  from: string;
  to: string;
}

export function movementPage(
  ctx: ViewCtx,
  d: { rows: StockMovement[]; total: number; page: number; pageSize: number; products: Product[]; f: MovementFilter }
): string {
  const prodOptions = [`<option value="">全部商品</option>`]
    .concat(
      d.products.map(
        (p) => `<option value="${p.id}"${d.f.productId === String(p.id) ? " selected" : ""}>${esc(p.name)}</option>`
      )
    )
    .join("");
  const typeOptions = [`<option value="">全部类型</option>`]
    .concat(
      MOVEMENT_TYPES.map(
        (t) => `<option value="${t}"${d.f.type === t ? " selected" : ""}>${esc(movementTypeName(t))}</option>`
      )
    )
    .join("");

  const rows =
    d.rows.length > 0
      ? d.rows
          .map((m) => {
            const chg = m.change > 0 ? `+${qty(m.change)}` : qty(m.change);
            return `<tr>
              <td>${esc(m.product_name || "—")}</td>
              <td class="num ${m.change > 0 ? "pos" : m.change < 0 ? "neg" : ""}">${chg}</td>
              <td class="num muted small">${qty(m.before_qty)} → ${qty(m.after_qty)}</td>
              <td>${movementBadge(m.type)}</td>
              <td>${refDoc(m)}</td>
              <td>${esc(m.operator_name || "—")}</td>
              <td class="muted small">${esc(m.remark || "—")}</td>
              <td class="muted small">${fmtDT(m.created_at)}</td>
            </tr>`;
          })
          .join("")
      : emptyRow(8, "暂无库存流水");

  const content = `
    ${pageHead("🧾 库存流水", `共 ${d.total} 条记录`)}
    <form class="toolbar" method="get" action="/movements">
      <select name="productId">${prodOptions}</select>
      <select name="type">${typeOptions}</select>
      <input type="date" name="from" value="${esc(d.f.from)}">
      <span class="muted">至</span>
      <input type="date" name="to" value="${esc(d.f.to)}">
      <button class="btn secondary" type="submit">筛选</button>
      <a class="btn secondary" href="/movements">清除</a>
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>商品</th><th class="num">变动</th><th class="num">前后库存</th><th>类型</th><th>关联单据</th><th>操作人</th><th>备注</th><th>时间</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/movements", { productId: d.f.productId, type: d.f.type, from: d.f.from, to: d.f.to }, d.page, tp(d.total, d.pageSize))}
    </div>`;

  return layout({ title: "库存流水", ctx, active: "movements", content });
}

// ================= 库存盘点 =================

export function adjustPage(ctx: ViewCtx, products: Product[]): string {
  const options = products
    .map((p) => `<option value="${p.id}" data-stock="${p.stock}">${esc(p.name)}（当前 ${qty(p.stock)}${esc(p.unit)}）</option>`)
    .join("");

  const content = `
    ${pageHead("🧮 库存盘点", "按实盘数量校准账面库存，差异将生成盘点流水")}
    <div class="card">
      <form method="post" action="/adjust" data-confirm="确认按实盘数量调整库存吗？差异将记入库存流水。">
        ${csrfInput(ctx.csrf)}
        ${field(
          "盘点商品",
          `<select id="adjustProduct" name="product_id" data-role="adjust-product" required><option value="">请选择商品</option>${options}</select>`,
          "",
          true
        )}
        <p>📦 当前账面库存：<b id="adjustCurrentStock">—</b> <span class="muted small">（选择商品后显示）</span></p>
        ${field("实盘数量", `<input type="number" name="actual_qty" min="0" step="0.01" required placeholder="实际清点到的数量">`, "", true)}
        ${field("备注", `<input type="text" name="remark" maxlength="200" placeholder="选填，如：月末盘点">`)}
        <button class="btn primary" type="submit">✅ 提交盘点</button>
      </form>
    </div>`;

  return layout({ title: "库存盘点", ctx, active: "adjust", content });
}

// ================= 库存预警 =================

export function warningPage(ctx: ViewCtx, rows: Product[]): string {
  const body =
    rows.length > 0
      ? `<div class="card"><div class="table-wrap"><table class="table">
          <thead><tr><th>图片</th><th>商品</th><th class="num">当前库存</th><th class="num">安全库存</th><th class="num">差值</th><th>操作</th></tr></thead>
          <tbody>${rows
            .map(
              (p) => `<tr>
                <td>${p.image_key ? `<img class="thumb" src="${fileUrl(p.image_key)}" alt="${esc(p.name)}" loading="lazy">` : `<span class="muted">📦</span>`}</td>
                <td><strong>${esc(p.name)}</strong><br><span class="muted small">${esc(p.category_name || "未分类")}</span></td>
                <td class="num neg">${qty(p.stock)} ${esc(p.unit)}</td>
                <td class="num">${qty(p.min_stock)}</td>
                <td class="num neg">${qty(Math.round((p.min_stock - p.stock) * 100) / 100)}</td>
                <td><a class="btn small primary" href="/purchase/new">📥 去进货</a></td>
              </tr>`
            )
            .join("")}</tbody>
        </table></div></div>`
      : `<div class="card"><p align="center">🎉 <strong>所有商品库存充足</strong><br><span class="muted small">暂无低于安全库存的商品</span></p></div>`;

  const content = `
    ${pageHead("⚠️ 库存预警", `共 ${rows.length} 件商品低于安全库存`)}
    ${body}`;

  return layout({ title: "库存预警", ctx, active: "warnings", content });
}
