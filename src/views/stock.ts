// 进货 / 销售（含收货人、电话、地址及微信/支付宝收款二维码展示） / 退货 / 库存流水 / 盘点 / 预警
import { esc, money, qty, fmtDT, round2 } from "../lib";
import {
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
  SalesItem,
  ReturnOrder,
  ReturnRequest,
  StockMovement,
} from "../db";
import { movementTypeName, paymentName, requestStatusName, requestTypeName } from "../db";
import { fileUrl } from "./products";

function orderStatusBadge(status: string): string {
  if (status === "void") return badge("已作废", "gray");
  if (status === "done") return badge("已完成", "green");
  return badge(status, "blue");
}

function tp(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** 渲染收款信息面板（微信码 / 支付宝码 / 银行转账信息）
 *  只展示当前「结算方式」对应的那一块，其余由 app.js 在切换下拉框时联动显隐。 */
export function paymentQrWidget(
  ctx: ViewCtx,
  activeMethod?: string,
  heading = "💳 结算与收款信息"
): string {
  const wechatKey = ctx.settings?.wechat_qr_key || "";
  const alipayKey = ctx.settings?.alipay_qr_key || "";
  const note = ctx.settings?.payment_note || "";
  const wechatUrl = wechatKey ? fileUrl(wechatKey) : "";
  const alipayUrl = alipayKey ? fileUrl(alipayKey) : "";

  const bankAccountName = (ctx.settings?.bank_account_name || "").trim();
  const bankName = (ctx.settings?.bank_name || "").trim();
  const bankAccountNo = (ctx.settings?.bank_account_no || "").trim();
  const hasBank = !!(bankAccountName || bankName || bankAccountNo);

  const active: "wechat" | "alipay" | "bank" | "none" =
    activeMethod === "alipay"
      ? "alipay"
      : activeMethod === "bank"
        ? "bank"
        : activeMethod === "cash" || activeMethod === "credit" || activeMethod === "balance"
          ? "none"
          : "wechat";
  const activeExists = active === "wechat" ? !!wechatUrl : active === "alipay" ? !!alipayUrl : active === "bank" ? hasBank : false;

  if (!wechatUrl && !alipayUrl && !hasBank) {
    if (ctx.user?.role === "admin") {
      return `<div class="payqr-hint-bar no-print">
        <span>💡 暂未配置收款信息（上传微信/支付宝收款码或填写银行转账信息后，客户下单时可直接看到）</span>
        <a class="btn small secondary" href="/settings#payqr">⚙️ 前往设置收款方式 →</a>
      </div>`;
    }
    return "";
  }

  const emptyText = activeExists
    ? ""
    : active === "bank"
      ? "商家暂未填写银行转账收款信息，请更换结算方式或联系客服确认。"
      : active === "none"
        ? activeMethod === "balance"
          ? "「余额支付」将从客户账户余额中直接扣减，无需扫码。"
          : `「${paymentName(activeMethod || "cash")}」无需扫码支付，按约定结算即可。`
        : `商家暂未上传${active === "alipay" ? "支付宝" : "微信"}收款码，请更换结算方式或联系客服确认。`;

  return `<div class="payqr-panel" id="paymentQrBox" data-active-method="${active}">
    <div class="payqr-panel-head">
      <strong>${esc(heading)}</strong>
      ${
        ctx.user?.role === "admin"
          ? `<a class="small no-print" href="/settings#payqr">⚙️ 管理收款方式</a>`
          : `<span class="muted small">切换结算方式将自动显示对应收款信息</span>`
      }
    </div>
    <div class="payqr-cards">
      ${
        wechatUrl
          ? `<div class="payqr-item wechat${active === "wechat" ? " active" : ""}" data-payqr-card="wechat"${
              active === "wechat" ? "" : " hidden"
            }>
              <div class="payqr-tag wechat">💚 微信扫码支付</div>
              <img src="${esc(wechatUrl)}" alt="微信收款码" class="payqr-display-img">
            </div>`
          : ""
      }
      ${
        alipayUrl
          ? `<div class="payqr-item alipay${active === "alipay" ? " active" : ""}" data-payqr-card="alipay"${
              active === "alipay" ? "" : " hidden"
            }>
              <div class="payqr-tag alipay">💙 支付宝扫码支付</div>
              <img src="${esc(alipayUrl)}" alt="支付宝收款码" class="payqr-display-img">
            </div>`
          : ""
      }
      ${
        hasBank
          ? `<div class="payqr-item bank${active === "bank" ? " active" : ""}" data-payqr-card="bank"${
              active === "bank" ? "" : " hidden"
            }>
              <div class="payqr-tag bank">🏦 银行转账信息</div>
              <dl class="bank-kv">
                <div><dt>收款户名</dt><dd>${esc(bankAccountName || "—")}</dd></div>
                <div><dt>开户银行</dt><dd>${esc(bankName || "—")}</dd></div>
                <div><dt>银行账号</dt><dd><code class="bank-no">${esc(bankAccountNo || "—")}</code>${
                  bankAccountNo
                    ? ` <button type="button" class="btn small secondary no-print" data-copy-text="${esc(bankAccountNo)}">复制</button>`
                    : ""
                }</dd></div>
              </dl>
              <p class="bank-tip">转账后请保留回单并联系客服核对到账，备注中建议填写订单号。</p>
            </div>`
          : ""
      }
    </div>
    <div class="payqr-empty-method" data-payqr-empty${activeExists ? " hidden" : ""}>${esc(emptyText)}</div>
    ${note ? `<div class="payqr-note">📌 ${esc(note)}</div>` : ""}
  </div>`;
}

function productOptions(
  products: Product[],
  priceKey: "purchase_price" | "sale_price",
  preselectPid?: number
): string {
  return products
    .map(
      (p) =>
        `<option value="${p.id}" data-price="${p[priceKey]}" data-stock="${p.stock}" data-unit="${esc(p.unit)}"${
          preselectPid === p.id ? " selected" : ""
        }>${esc(p.name)}${p.sku ? ` [${esc(p.sku)}]` : ""} · 库存:${qty(p.stock)}${esc(p.unit)} · ¥${p[priceKey]}</option>`
    )
    .join("");
}

interface ItemRowOpts {
  preselectPid?: number;
  initQty?: number;
  /** 来自购物车时写入 data-cart-id，删行时同步清理购物车 */
  cartId?: number;
  lockPrice?: boolean;
  /** 预填单价（退货单从原销售单带入，优先于商品标准价） */
  priceOverride?: number;
}

function itemRow(
  products: Product[],
  priceKey: "purchase_price" | "sale_price",
  o: ItemRowOpts = {}
): string {
  const initQty = o.initQty ?? 1;
  const preProd = o.preselectPid ? products.find((x) => x.id === o.preselectPid) : undefined;
  const unitPrice = o.priceOverride !== undefined ? o.priceOverride : preProd ? preProd[priceKey] : undefined;
  const initPrice = unitPrice !== undefined ? String(unitPrice) : "";
  const initAmt = unitPrice !== undefined ? money(round2(unitPrice * initQty)) : "¥0.00";
  return `<div class="item-row"${o.cartId ? ` data-cart-id="${o.cartId}"` : ""}>
    <select name="product_id" data-role="item-product" required><option value="">— 请选择商品（支持名称/SKU检索） —</option>${productOptions(products, priceKey, o.preselectPid)}</select>
    <input type="number" name="qty" data-role="item-qty" min="0.01" step="0.01" value="${initQty}" placeholder="数量" required>
    <input type="number" name="price" data-role="item-price" min="0" step="0.01" value="${initPrice}" placeholder="单价(元)" required${
      o.lockPrice ? ' readonly title="客户自助下单按系统标准售价结算，不可改价"' : ""
    }>
    <span class="amount" data-role="item-amount">${initAmt}</span>
    <button type="button" class="row-del" data-action="remove-row" title="删除该明细行">✕</button>
  </div>`;
}

export interface OrderItemsOptions {
  preselectPid?: number;
  /** 购物车带入的明细（客户自助下单） */
  cartLines?: { product: Product; qty: number }[];
  /** 从原销售单带入的退货明细（可带原成交单价） */
  prefillLines?: { product: Product; qty: number; price?: number }[];
  /** 是否保留「＋ 添加商品行」按钮（自助下单 / 退货单场景关闭） */
  allowAddRow?: boolean;
  /** 底部「＋ 继续添加商品」改为跳转链接（自助下单 → 商品目录） */
  addRowHref?: string;
  /** 明细区头部提示（允许传 HTML） */
  headHint?: string;
  /** 锁定单价（客户自助下单按系统售价结算） */
  lockPrice?: boolean;
  /** 允许把明细行全部删空（自助下单场景），删空后显示占位提示 */
  allowEmptyRows?: boolean;
}

function orderItemsBlock(
  products: Product[],
  priceKey: "purchase_price" | "sale_price",
  opts: OrderItemsOptions = {}
): string {
  const allowAddRow = opts.allowAddRow !== false;
  const prefill = opts.prefillLines || [];
  const cart = opts.cartLines || [];
  const rows =
    prefill.length > 0
      ? prefill
          .map((l) =>
            itemRow(products, priceKey, {
              preselectPid: l.product.id,
              initQty: l.qty,
              lockPrice: opts.lockPrice,
              priceOverride: l.price,
            })
          )
          .join("")
      : cart.length > 0
        ? cart
            .map((l) =>
              itemRow(products, priceKey, {
                preselectPid: l.product.id,
                initQty: l.qty,
                cartId: l.product.id,
                lockPrice: opts.lockPrice,
              })
            )
            .join("")
        : itemRow(products, priceKey, { preselectPid: opts.preselectPid, lockPrice: opts.lockPrice });

  // 底部「继续添加」：给了跳转链接就渲染链接；否则仅在允许加行时渲染按钮
  const bottomAdd = opts.addRowHref
    ? `<a class="btn secondary" href="${esc(opts.addRowHref)}">＋ 继续添加商品</a>`
    : allowAddRow
      ? `<button type="button" class="btn secondary" data-action="add-row">＋ 继续添加商品</button>`
      : "";

  return `<div class="card">
    <div class="card-head">
      <h3>🧾 单据商品明细</h3>
      ${allowAddRow ? `<button type="button" class="btn small secondary" data-action="add-row">＋ 添加商品行</button>` : ""}
    </div>
    ${opts.headHint ? `<div class="items-hint">${opts.headHint}</div>` : ""}
    <div class="item-row item-row-head">
      <span>商品名称 / 编码 / 当前库存</span>
      <span>数量</span>
      <span>单价（元）</span>
      <span class="num">行小计</span>
      <span></span>
    </div>
    <div id="orderItems"${opts.allowEmptyRows ? ' data-allow-empty="1"' : ""}>${rows}</div>
    ${
      opts.allowEmptyRows
        ? `<div class="items-empty" data-role="items-empty" hidden>🛒 商品明细已清空，点击下方「＋ 继续添加商品」重新选购</div>`
        : ""
    }
    <div class="order-summary-bar">
      ${bottomAdd}
      <div class="order-total" id="orderTotal">合计：<span>¥0.00</span></div>
    </div>
  </div>`;
}

// ================= 进货 =================

export function purchaseListPage(
  ctx: ViewCtx,
  d: { rows: PurchaseOrder[]; total: number; page: number; pageSize: number; q: string; status?: string }
): string {
  const statusOptions = [
    `<option value="">全部状态</option>`,
    `<option value="done"${d.status === "done" ? " selected" : ""}>已完成</option>`,
    `<option value="void"${d.status === "void" ? " selected" : ""}>已作废</option>`,
  ].join("");

  const rows =
    d.rows.length > 0
      ? d.rows
          .map(
            (o) => `<tr>
              <td><a href="/purchase/${o.id}"><strong>${esc(o.order_no)}</strong></a></td>
              <td>${esc(o.supplier_name || "直接采购")}</td>
              <td class="num"><strong>${money(o.total)}</strong></td>
              <td class="num">${money(o.paid)}</td>
              <td>${esc(o.operator_name || "—")}</td>
              <td>${orderStatusBadge(o.status)}</td>
              <td class="muted small">${fmtDT(o.created_at)}</td>
              <td><div class="btn-row">
                <a class="btn small secondary" href="/purchase/${o.id}">详情</a>
                ${
                  o.status === "done"
                    ? `<form class="inline-form" method="post" action="/purchase/${o.id}/void" data-confirm="作废后将扣回入库数量并生成冲销流水，确定作废进货单 ${esc(o.order_no)} 吗？">${csrfInput(ctx.csrf)}<button class="btn small danger" type="submit">作废</button></form>`
                    : ""
                }
              </div></td>
            </tr>`
          )
          .join("")
      : emptyRow(8, "暂无采购进货单据");

  return `
    ${pageHead("📥 采购进货管理", `共 ${d.total} 张进货单 · 入库自动按加权平均法更新商品成本`, `<a class="btn secondary" href="/reports/export?type=purchase">📥 导出 CSV</a> <a class="btn primary" href="/purchase/new">＋ 新建进货单</a>`)}
    <form class="toolbar" method="get" action="/purchase">
      <input type="text" name="q" value="${esc(d.q)}" placeholder="🔍 搜索进货单号 / 供应商名称..." maxlength="64" class="grow">
      <select name="status">${statusOptions}</select>
      <button class="btn primary" type="submit">搜索</button>
      ${d.q || d.status ? `<a class="btn secondary" href="/purchase">重置</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>进货单号</th><th>供应商</th><th class="num">采购总额</th><th class="num">已付金额</th><th>经办人</th><th>状态</th><th>入库时间</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/purchase", { q: d.q, status: d.status || "" }, d.page, tp(d.total, d.pageSize))}
    </div>`;
}

export function purchaseFormPage(
  ctx: ViewCtx,
  d: { products: Product[]; suppliers: Supplier[]; preselectPid?: number }
): string {
  const supOptions = [`<option value="">— 直接采购 / 零散供货商 —</option>`]
    .concat(d.suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`))
    .join("");

  return `
    ${pageHead("＋ 新建采购进货单", "录入供应商与采购商品明细，提交后自动增加库存并更新加权成本", `<a class="btn secondary" href="/purchase">← 返回进货列表</a>`)}
    <form method="post" action="/purchase/new">
      ${csrfInput(ctx.csrf)}
      <div class="card"><h3>📝 采购单头信息</h3>
        <div class="form-row cols-3">
          ${field("供货商", `<select name="supplier_id">${supOptions}</select>`)}
          ${field("本次实付金额（元）", `<input type="number" id="paidInput" name="paid" min="0" step="0.01" placeholder="留空默认全额付清">`, "留空默认按采购合计全额付清")}
          ${field("采购备注", `<input type="text" name="remark" maxlength="200" placeholder="选填，如：发票号、物流单号">`)}
        </div>
      </div>
      ${orderItemsBlock(d.products, "purchase_price", { preselectPid: d.preselectPid, allowAddRow: false })}
      <div class="btn-row">
        <button class="btn primary" type="submit">✅ 确认审核并入库</button>
        <a class="btn secondary" href="/purchase">取消</a>
      </div>
    </form>`;
}

export function purchaseDetailPage(ctx: ViewCtx, o: PurchaseOrder): string {
  const items = (o.items || [])
    .map(
      (it, i) =>
        `<tr>
          <td>${i + 1}</td>
          <td><strong>${esc(it.product_name || "—")}</strong>${it.sku ? `<br><span class="muted small">SKU: ${esc(it.sku)}</span>` : ""}</td>
          <td class="num">${qty(it.qty)} ${esc(it.unit || "")}</td>
          <td class="num">${money(it.price)}</td>
          <td class="num"><strong>${money(it.amount)}</strong></td>
        </tr>`
    )
    .join("");

  return `
    ${pageHead(
      `采购进货单 ${o.order_no}`,
      `创建时间：${fmtDT(o.created_at)}`,
      `<button type="button" class="btn secondary" data-action="print-doc">🖨️ 打印单据</button>
       <a class="btn secondary" href="/purchase">← 返回列表</a>
       ${
         o.status === "done"
           ? `<form class="inline-form" method="post" action="/purchase/${o.id}/void" data-confirm="作废后将扣减库存并生成冲销流水记录，确定作废吗？">${csrfInput(ctx.csrf)}<button class="btn danger" type="submit">作废此单</button></form>`
           : ""
       }`
    )}
    <div class="card voucher-card">
      <div class="voucher-head">
        <div>
          <div class="voucher-title">${esc(ctx.appName)} · 采购入库单</div>
          <div class="muted small">单据编号：<strong>${esc(o.order_no)}</strong></div>
        </div>
        <div>${orderStatusBadge(o.status)}</div>
      </div>
      <dl class="kv kv-grid">
        <div><dt>供应商</dt><dd><strong>${esc(o.supplier_name || "直接采购")}</strong></dd></div>
        <div><dt>经办操作人</dt><dd>${esc(o.operator_name || "—")}</dd></div>
        <div><dt>采购总金额</dt><dd><strong class="pos">${money(o.total)}</strong></dd></div>
        <div><dt>已付金额</dt><dd>${money(o.paid)}</dd></div>
        <div><dt>入库时间</dt><dd>${fmtDT(o.created_at)}</dd></div>
        <div><dt>单据备注</dt><dd>${esc(o.remark || "无")}</dd></div>
      </dl>
      <hr class="divider">
      <h3>🧾 入库商品明细</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>序号</th><th>商品名称 / SKU</th><th class="num">入库数量</th><th class="num">采购单价</th><th class="num">金额小计</th></tr></thead>
        <tbody>${items || emptyRow(5)}</tbody>
        <tfoot>
          <tr class="table-foot-row">
            <td colspan="4" class="num"><strong>采购合计金额：</strong></td>
            <td class="num"><strong>${money(o.total)}</strong></td>
          </tr>
        </tfoot>
      </table></div>
    </div>`;
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
    status?: string;
    debtOnly?: boolean;
    canCreate: boolean;
    showSales: boolean;
  }
): string {
  const isCustomer = ctx.user?.role === "customer";
  const newBtn = d.canCreate
    ? `<a class="btn primary" href="/sales/new">＋ 新建销售单</a>`
    : `<a class="btn secondary" href="/profile">📍 收货信息设置</a> <a class="btn primary" href="/shop">🛒 自助下单</a>`;

  const statusOptions = [
    `<option value="">全部状态</option>`,
    `<option value="done"${d.status === "done" ? " selected" : ""}>已完成</option>`,
    `<option value="void"${d.status === "void" ? " selected" : ""}>已作废</option>`,
  ].join("");

  const rows =
    d.rows.length > 0
      ? d.rows
          .map((o) => {
            const debt = round2(o.total - o.paid);
            const shipInfo =
              o.shipping_phone || o.shipping_address
                ? `<div class="muted small">📍 ${esc(o.shipping_name || "")} ${esc(o.shipping_phone || "")} · ${esc(
                    (o.shipping_address || "").slice(0, 24)
                  )}</div>`
                : "";
            return `<tr>
              <td><a href="/sales/${o.id}"><strong>${esc(o.order_no)}</strong></a></td>
              <td><strong>${esc(o.customer_name || "零售散客")}</strong>${shipInfo}</td>
              ${d.showSales ? `<td>${esc(o.sales_name || "—")}</td>` : ""}
              <td class="num"><strong>${money(o.total)}</strong>${o.discount > 0 ? `<div class="muted small">已减 ${money(o.discount)}</div>` : ""}</td>
              <td class="num">${money(o.paid)}</td>
              <td class="num ${debt > 0 ? "neg" : "muted"}">${debt > 0 ? money(debt) : "已结清"}</td>
              <td>${esc(paymentName(o.payment))}</td>
              <td>${orderStatusBadge(o.status)}${
                (o.return_cnt || 0) > 0 ? `<div class="small" style="margin-top:4px">${badge(`已退 ${o.return_cnt} 单`, "red")}</div>` : ""
              }</td>
              <td class="muted small">${fmtDT(o.created_at)}</td>
              <td><a class="btn small secondary" href="/sales/${o.id}">查看</a></td>
            </tr>`;
          })
          .join("")
      : emptyRow(d.showSales ? 10 : 9, "暂无符合条件的销售订单");

  return `
    ${pageHead(isCustomer ? "📋 我的历史订单" : "📤 销售订单管理", `共 ${d.total} 张销售单`, newBtn)}
    <form class="toolbar" method="get" action="/sales">
      <input type="text" name="q" value="${esc(d.q)}" placeholder="🔍 搜索销售单号 / 客户名称 / 收货电话..." maxlength="64" class="grow">
      <select name="status">${statusOptions}</select>
      <label class="checkbox-row"><input type="checkbox" name="debt" value="1"${d.debtOnly ? " checked" : ""}><span>仅看未结清欠款单</span></label>
      <button class="btn primary" type="submit">查询</button>
      ${d.q || d.status || d.debtOnly ? `<a class="btn secondary" href="/sales">重置</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>销售单号</th><th>客户 / 收货信息</th>${d.showSales ? "<th>归属销售</th>" : ""}<th class="num">应收总额</th><th class="num">实收</th><th class="num">待收欠款</th><th>收款方式</th><th>状态</th><th>开单时间</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/sales", { q: d.q, status: d.status || "", debt: d.debtOnly ? "1" : "" }, d.page, tp(d.total, d.pageSize))}
    </div>`;
}

export interface SalesFormData {
  products: Product[];
  customers: User[];
  salesTeam: User[];
  action: string;
  forCustomer: boolean;
  defaultSalesId?: number | null;
  customerProfile?: User | null;
  /** 从「商品档案」点「开单」带入的商品 */
  preselectPid?: number;
  /** 客户自助下单：由「商品目录」购物车带入的明细 */
  cart?: {
    lines: { product: Product; qty: number }[];
    /** 因下架 / 缺货被移除的款数 */
    removed: number;
    /** 因可用库存不足被下调数量的款数 */
    adjusted: number;
  };
}

/** 客户自助下单可用的结算方式：
 *  微信 / 支付宝 / 银行转账只有商家在系统设置里配置过才展示，未配置直接不出现在下拉框。 */
export function customerPayMethods(ctx: ViewCtx): string[] {
  const s = ctx.settings || {};
  const has = (v?: string) => !!(v || "").trim();
  const list: string[] = ["balance"];
  if (has(s.wechat_qr_key)) list.push("wechat");
  if (has(s.alipay_qr_key)) list.push("alipay");
  if (has(s.bank_account_name) || has(s.bank_name) || has(s.bank_account_no)) list.push("bank");
  list.push("cash", "credit");
  return list;
}

export function salesFormPage(ctx: ViewCtx, d: SalesFormData): string {
  const sellable = d.products.filter((p) => p.status === "on");
  const isCustomer = d.forCustomer;
  const cp = d.customerProfile || null;
  const cartLines = d.cart?.lines || [];
  const cartCount = cartLines.length;

  const customerField = isCustomer
    ? ""
    : field(
        "客户选择（选中后自动带出该客户的默认收货信息）",
        `<select name="customer_id" id="customerSelect"><option value="" data-shipping-name="" data-phone="" data-address="" data-balance="0">— 零售散客（不记名）—</option>${d.customers
          .map(
            (u) =>
              `<option value="${u.id}" data-credit="${u.credit_limit}" data-balance="${round2(u.balance || 0)}" data-shipping-name="${esc(
                u.shipping_name || u.nickname
              )}" data-phone="${esc(u.phone)}" data-address="${esc(u.address)}">${esc(u.nickname)}（@${esc(
                u.username
              )}${u.phone ? ` · ${esc(u.phone)}` : ""}${u.credit_limit > 0 ? ` · 授信 ¥${u.credit_limit}` : ""}${
                u.balance > 0 ? ` · 余额 ¥${round2(u.balance)}` : ""
              }）</option>`
          )
          .join("")}</select>`,
        "关联客户可统计累计消费、自动填入收货地址并校验赊账授信额度；选择「余额支付」将全额扣减该客户余额"
      );

  const salesField = isCustomer
    ? ""
    : ctx.user?.role === "sales"
      ? field(
          "归属销售员",
          `<input type="text" value="${esc(ctx.user.nickname)}（本人开单）" disabled><input type="hidden" name="sales_id" value="${ctx.user.id}">`,
          "订单完成后将自动按您的分销级别计提佣金"
        )
      : field(
          "业绩归属销售员",
          `<select name="sales_id"><option value="">— 公司直营（不计提销售佣金） —</option>${d.salesTeam
            .map(
              (u) =>
                `<option value="${u.id}"${d.defaultSalesId === u.id ? " selected" : ""}>${esc(u.nickname)}（@${esc(
                  u.username
                )} · ${u.sales_level === 2 ? "二级" : "一级"}）</option>`
            )
            .join("")}</select>`,
          "选择后将按二级分销规则自动生成销售提成与上级津贴"
        );

  // 结算方式：客户自助下单只列出「已配置」的渠道，并默认选中余额支付（余额为 0 时回退到首个可用渠道）
  const myBalance = round2(cp?.balance ?? ctx.user?.balance ?? 0);
  const payMethods = isCustomer ? customerPayMethods(ctx) : ["wechat", "alipay", "cash", "bank", "balance", "credit"];
  const fallbackPay = payMethods.find((k) => k !== "balance") || "balance";
  const defaultPay = isCustomer ? (myBalance > 0 ? "balance" : fallbackPay) : "wechat";
  const payOptions = payMethods
    .map((k) => {
      const label =
        k === "balance"
          ? isCustomer
            ? `余额支付（可用 ¥${myBalance.toFixed(2)}）`
            : "余额支付（扣客户余额）"
          : paymentName(k);
      return `<option value="${k}"${k === defaultPay ? " selected" : ""}${k === "balance" ? ' data-balance-opt="1"' : ""}>${esc(
        label
      )}</option>`;
    })
    .join("");

  const cartHint = cartCount
    ? `🛒 已从 <a href="/catalog">商品目录</a> 的购物车带入 <strong>${cartCount}</strong> 款商品，请核对数量与单价后提交。${
        d.cart && d.cart.removed > 0 ? `<span class="neg">其中 ${d.cart.removed} 款商品已下架或缺货，已自动移除。</span>` : ""
      }${d.cart && d.cart.adjusted > 0 ? `<span class="neg">${d.cart.adjusted} 款商品数量超出可用库存，已按库存上限调整。</span>` : ""}`
    : d.cart && d.cart.removed > 0
      ? `购物车中 ${d.cart.removed} 款商品已下架或缺货，已自动移除；可返回 <a href="/catalog">商品目录</a> 重新选购。`
      : `购物车暂为空，可先前往 <a href="/catalog">商品目录</a> 挑选商品并加入购物车，或直接在下方选择商品开单。`;

  return `
    ${pageHead(
      isCustomer ? "🛒 在线自助订货" : "＋ 新建销售开单",
      isCustomer ? "核对购物车带入的商品与数量，确认收货信息后即可提交订单" : "支持客户默认收货地址带出、微信/支付宝收款码展示、折扣核算与二级分销计提",
      isCustomer
        ? `<a class="btn secondary" href="/profile">📍 修改默认收货地址</a> <a class="btn secondary" href="/catalog">🛍️ 继续选购</a> <a class="btn secondary" href="/sales">← 我的订单</a>`
        : `<a class="btn secondary" href="/sales">← 返回订单列表</a>`
    )}
    <form method="post" action="${esc(d.action)}">
      ${csrfInput(ctx.csrf)}
      ${
        isCustomer
          ? `<div class="card highlight-card">
              <div class="card-head">
                <h3>📍 收货与配送信息</h3>
                <a class="small" href="/profile">在个人中心管理默认地址 →</a>
              </div>
              <div class="form-row cols-3">
                ${field(
                  "收货人姓名",
                  `<input type="text" name="shipping_name" required maxlength="32" value="${esc(
                    cp?.shipping_name || cp?.nickname || ctx.user?.nickname || ""
                  )}" placeholder="收件人姓名">`,
                  "",
                  true
                )}
                ${field(
                  "联系电话",
                  `<input type="tel" name="shipping_phone" required maxlength="20" value="${esc(
                    cp?.phone || ""
                  )}" placeholder="收件人手机或电话">`,
                  "",
                  true
                )}
                ${field("意向结算方式", `<select name="payment" id="paymentSelect">${payOptions}</select>`)}
              </div>
              <div class="items-hint" id="balanceHint" data-balance="${myBalance}" hidden></div>
              <div class="form-row">
                ${field(
                  "详细收货地址",
                  `<input type="text" name="shipping_address" required maxlength="200" value="${esc(
                    cp?.address || ""
                  )}" placeholder="省 / 市 / 区 / 街道门牌号">`,
                  "首次填写后系统将自动保存为您的默认收货地址",
                  true
                )}
                ${field("订单备注", `<input type="text" name="remark" maxlength="200" placeholder="选填，如期望送达时间、发票抬头等">`)}
              </div>
              ${paymentQrWidget(ctx, defaultPay)}
            </div>`
          : `<div class="card"><h3>📝 客户与结算信息</h3>
              <div class="form-row">
                ${customerField}
                ${salesField}
              </div>
              <div class="form-row cols-4">
                ${field("整单优惠折扣（元）", `<input type="number" id="discountInput" name="discount" min="0" step="0.01" value="0">`, "折后应收将自动重算")}
                ${field(
                  "本次实收金额（元）",
                  `<div class="input-with-btn"><input type="number" id="paidInput" name="paid" min="0" step="0.01" value="0"><button type="button" class="btn small secondary" id="fillFullPaidBtn" title="按折后应收全额填入">全额</button></div>`,
                  "少于应收的部分将自动记为客户欠款"
                )}
                ${field("收款方式", `<select name="payment" id="paymentSelect">${payOptions}</select>`)}
                ${field("单据备注", `<input type="text" name="remark" maxlength="200" placeholder="选填，发货或收款说明">`)}
              </div>
              <div class="items-hint" id="balanceHint" hidden></div>
              <div class="form-row cols-3">
                ${field("收货人姓名", `<input type="text" id="shippingNameInput" name="shipping_name" maxlength="32" placeholder="选择客户后自动带出，或手动填写">`)}
                ${field("收货联系电话", `<input type="tel" id="shippingPhoneInput" name="shipping_phone" maxlength="20" placeholder="选择客户后自动带出">`)}
                ${field("收货详细地址", `<input type="text" id="shippingAddressInput" name="shipping_address" maxlength="200" placeholder="选择客户后自动带出收货地址">`)}
              </div>
              ${paymentQrWidget(ctx, "wechat")}
            </div>`
      }
      ${
        isCustomer
          ? orderItemsBlock(sellable, "sale_price", {
              cartLines,
              allowAddRow: false,
              addRowHref: "/catalog",
              headHint: cartHint,
              lockPrice: true,
              allowEmptyRows: true,
            })
          : orderItemsBlock(sellable, "sale_price", { preselectPid: d.preselectPid })
      }
      <div class="btn-row" id="orderSubmitBar">
        <button class="btn primary" type="submit">${isCustomer ? "🛒 确认提交订单" : "✅ 确认开单并出库"}</button>
        <a class="btn secondary" href="/sales">取消</a>
      </div>
    </form>`;
}

export function salesDetailPage(
  ctx: ViewCtx,
  o: SalesOrder,
  canVoid: boolean,
  customerBalance?: number,
  /** 本单的退货情况：有效退货单的已退数量 + 全部退货单记录 */
  ret?: { returnedQty: Map<number, number>; orders: ReturnOrder[] }
): string {
  const isAdmin = ctx.user?.role === "admin";
  const canCollectDebt = ctx.user?.role === "admin" || (ctx.user?.role === "sales" && o.sales_id === ctx.user.id);
  // 每款商品按原单聚合：同一商品在原单里可能有多行，已退数量是商品级的
  const soldByPid = new Map<number, number>();
  for (const it of o.items || []) {
    soldByPid.set(it.product_id, round2((soldByPid.get(it.product_id) || 0) + it.qty));
  }
  const availOf = (pid: number) => round2((soldByPid.get(pid) || 0) - (ret?.returnedQty.get(pid) || 0));
  const totalAvail = [...soldByPid.keys()].reduce((s, pid) => s + Math.max(0, availOf(pid)), 0);
  const returnedOrders = (ret?.orders || []).filter((r) => r.status === "done");
  const returnedAmount = round2(returnedOrders.reduce((s, r) => s + (r.total || 0), 0));
  const seen = new Set<number>();
  const items = (o.items || [])
    .map((it, i) => {
      const profit = round2((it.price - it.cost) * it.qty);
      const back = ret?.returnedQty.get(it.product_id) || 0;
      // 已退数量是商品级的：同一商品在原单里有多行时只在首行显示，避免逐行相加产生误读
      const first = !seen.has(it.product_id);
      seen.add(it.product_id);
      const returnCell = !first
        ? `<td class="num muted small">同上行</td>`
        : `<td class="num ${back > 0 ? "neg" : "muted"}">${back > 0 ? qty(back) : "—"}</td>`;
      return `<tr>
        <td>${i + 1}</td>
        <td><strong>${esc(it.product_name || "—")}</strong>${it.sku ? `<br><span class="muted small">SKU: ${esc(it.sku)}</span>` : ""}</td>
        <td class="num">${qty(it.qty)} ${esc(it.unit || "")}</td>
        ${ret ? returnCell : ""}
        <td class="num">${money(it.price)}</td>
        ${isAdmin ? `<td class="num muted">${money(it.cost)}</td>` : ""}
        <td class="num"><strong>${money(it.amount)}</strong></td>
        ${isAdmin ? `<td class="num ${profit >= 0 ? "pos" : "neg"}">${money(profit)}</td>` : ""}
      </tr>`;
    })
    .join("");
  const debt = round2(o.total - o.paid);
  const allReturned = !!ret && returnedOrders.length > 0 && totalAvail <= 0;
  const returnBtnNote = `<span class="muted small">↩️ 该单商品已全部退回</span>`;
  // 默认选中订单原结算方式，使下方收款码与下拉框初始状态一致
  const payMethods = ["wechat", "alipay", "cash", "bank"];
  // 仅关联了客户的订单才能用余额补收
  if (o.customer_id && customerBalance !== undefined) payMethods.push("balance");
  const payOptions = payMethods
    .map((k) => {
      const label =
        k === "balance" ? `余额支付（可用 ¥${round2(customerBalance || 0).toFixed(2)}）` : paymentName(k);
      return `<option value="${k}"${o.payment === k ? " selected" : ""}>${esc(label)}</option>`;
    })
    .join("");

  const debtCard =
    o.status === "done" && debt > 0
      ? `<div class="card highlight-card no-print">
          <h3>💳 ${canCollectDebt ? `欠款补收核销（当前待收：${money(debt)}）` : `待付尾款扫码支付（待付金额：${money(debt)}）`}</h3>
          ${
            canCollectDebt
              ? `<form method="post" action="/sales/${o.id}/pay" class="toolbar" style="margin-bottom:12px;border:none;padding:0;box-shadow:none;background:transparent">
                  ${csrfInput(ctx.csrf)}
                  <label>补收金额（元）：</label>
                  <input type="number" name="amount" min="0.01" max="${debt}" step="0.01" value="${debt}" required>
                  <label>收款方式：</label>
                  <select name="payment" id="paymentSelect">${payOptions}</select>
                  <button class="btn success" type="submit">✅ 确认登记收款</button>
                </form>`
              : ""
          }
          ${paymentQrWidget(ctx, o.payment, "📲 支付尾款（微信 / 支付宝 / 银行转账）")}
        </div>`
      : "";

  const returnCard =
    ret && ret.orders.length
      ? `<div class="card no-print"><h3>↩️ 本单退货记录（有效退货单 ${returnedOrders.length} 张）</h3>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>退货单号</th><th class="num">退款金额</th><th>经办人</th><th>状态</th><th>退货时间</th><th>原因备注</th></tr></thead>
            <tbody>${ret.orders
              .map(
                (r) => `<tr>
                  <td><a href="/returns/${r.id}"><strong>${esc(r.order_no)}</strong></a></td>
                  <td class="num"><strong>${money(r.total)}</strong></td>
                  <td>${esc(r.operator_name || "—")}</td>
                  <td>${orderStatusBadge(r.status)}</td>
                  <td class="muted small">${fmtDT(r.created_at)}</td>
                  <td class="muted small">${esc(r.remark || "—")}</td>
                </tr>`
              )
              .join("")}</tbody>
          </table></div>
          <div class="items-hint">本单应收 ${money(o.total)} · 已退 ${money(returnedAmount)} · 实际成交 ${money(
            round2(o.total - returnedAmount)
          )}${allReturned ? " · 商品已全部退回，不可再次办理退货" : ""}</div>
        </div>`
      : "";

  return `
    ${pageHead(
      `销售出库单 ${o.order_no}`,
      `开单时间：${fmtDT(o.created_at)}`,
      `<button type="button" class="btn secondary" data-action="print-doc">🖨️ 打印销售单</button>
       ${
         o.status === "done" && (ctx.user?.role === "admin" || ctx.user?.role === "sales")
           ? allReturned
             ? returnBtnNote
             : `<a class="btn secondary" href="/returns/new?order_no=${encodeURIComponent(o.order_no)}">↩️ 办理退货</a>`
           : ""
       }
       ${
         o.status === "done" && ctx.user?.role === "customer"
           ? allReturned
             ? returnBtnNote
             : `<a class="btn secondary" href="/returns/apply?order_id=${o.id}">↩️ 申请退换货</a>`
           : ""
       }
       <a class="btn secondary" href="/sales">← 返回列表</a>
       ${
         canVoid && o.status === "done"
           ? `<form class="inline-form" method="post" action="/sales/${o.id}/void" data-confirm="作废后将返还商品库存、撤销待结算佣金并生成冲销流水，确定作废吗？">${csrfInput(ctx.csrf)}<button class="btn danger" type="submit">作废此单</button></form>`
           : ""
       }`
    )}
    ${debtCard}
    ${returnCard}
    <div class="card voucher-card">
      <div class="voucher-head">
        <div>
          <div class="voucher-title">${esc(ctx.appName)} · 销售出库单</div>
          <div class="muted small">单据编号：<strong>${esc(o.order_no)}</strong></div>
        </div>
        <div>${orderStatusBadge(o.status)}</div>
      </div>
      <dl class="kv kv-grid">
        <div><dt>客户名称</dt><dd><strong>${
          o.customer_id && ctx.user?.role !== "customer"
            ? `<a href="/customers/${o.customer_id}">${esc(o.customer_name || "客户")}</a>`
            : esc(o.customer_name || "零售散客")
        }</strong></dd></div>
        <div><dt>归属销售员</dt><dd>${esc(o.sales_name || "公司直营")}</dd></div>
        <div><dt>折后应收总额</dt><dd><strong>${money(o.total)}</strong>${o.discount > 0 ? ` <span class="muted small">（已优惠 ${money(o.discount)}）</span>` : ""}</dd></div>
        <div><dt>累计已收金额</dt><dd class="pos"><strong>${money(o.paid)}</strong></dd></div>
        <div><dt>待收挂账欠款</dt><dd class="${debt > 0 ? "neg" : ""}"><strong>${debt > 0 ? money(debt) : "¥0.00（已结清）"}</strong></dd></div>
        ${
          returnedAmount > 0
            ? `<div><dt>本单已退</dt><dd class="neg"><strong>${money(returnedAmount)}</strong> <span class="muted small">（有效退货单 ${returnedOrders.length} 张，实际成交 ${money(round2(o.total - returnedAmount))}）</span></dd></div>`
            : ""
        }
        <div><dt>结算方式</dt><dd>${esc(paymentName(o.payment))}</dd></div>
        <div><dt>收货人 / 电话</dt><dd><strong>${esc(o.shipping_name || "—")}</strong> ${esc(o.shipping_phone || "")}</dd></div>
        <div><dt>收货地址</dt><dd>${esc(o.shipping_address || "门店自提 / 未填地址")}</dd></div>
        <div><dt>开单时间</dt><dd>${fmtDT(o.created_at)}</dd></div>
        <div><dt>单据备注</dt><dd>${esc(o.remark || "无")}</dd></div>
      </dl>
      <hr class="divider">
      <h3>🧾 销售商品明细${isAdmin ? "（含加权成本与单品毛利，仅管理员可见）" : ""}</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>序号</th><th>商品名称 / SKU</th><th class="num">数量</th>${ret ? `<th class="num">已退数量</th>` : ""}<th class="num">销售单价</th>${isAdmin ? `<th class="num">成本价</th>` : ""}<th class="num">金额小计</th>${isAdmin ? `<th class="num">单品毛利</th>` : ""}</tr></thead>
        <tbody>${items || emptyRow(isAdmin ? (ret ? 8 : 7) : ret ? 6 : 5)}</tbody>
        <tfoot>
          <tr class="table-foot-row">
            <td colspan="${isAdmin ? (ret ? 6 : 5) : ret ? 5 : 4}" class="num"><strong>应收总计（已扣优惠 ${money(o.discount)}）：</strong></td>
            <td class="num"><strong>${money(o.total)}</strong></td>
            ${isAdmin ? `<td></td>` : ""}
          </tr>
        </tfoot>
      </table></div>
    </div>`;
}

// ================= 销售退货 =================

export function returnListPage(
  ctx: ViewCtx,
  d: { rows: ReturnOrder[]; total: number; page: number; pageSize: number; q?: string }
): string {
  const rows =
    d.rows.length > 0
      ? d.rows
          .map(
            (o) => `<tr>
              <td><a href="/returns/${o.id}"><strong>${esc(o.order_no)}</strong></a></td>
              <td>${
                o.sales_order_id && o.sales_order_no
                  ? `<a href="/sales/${o.sales_order_id}">${esc(o.sales_order_no)}</a>`
                  : `<span class="muted">—</span>`
              }</td>
              <td>${esc(o.customer_name || "零售散客")}</td>
              <td class="num"><strong>${money(o.total)}</strong></td>
              <td>${esc(o.operator_name || "—")}</td>
              <td>${orderStatusBadge(o.status)}</td>
              <td class="muted small">${fmtDT(o.created_at)}</td>
              <td><a class="btn small secondary" href="/returns/${o.id}">详情</a></td>
            </tr>`
          )
          .join("")
      : emptyRow(8, "暂无销售退货记录");

  return `
    ${pageHead("↩️ 销售退货管理", `共 ${d.total} 张退货单 · 退货自动回补商品库存`, `<a class="btn primary" href="/returns/new">＋ 新建退货单</a>`)}
    <form class="toolbar" method="get" action="/returns">
      <input type="text" name="q" value="${esc(d.q || "")}" placeholder="🔍 搜索退货单号 / 关联销售单号..." maxlength="64" class="grow">
      <button class="btn primary" type="submit">搜索</button>
      ${d.q ? `<a class="btn secondary" href="/returns">重置</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>退货单号</th><th>关联原销售单</th><th>客户</th><th class="num">应退金额</th><th>经办人</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/returns", { q: d.q || "" }, d.page, tp(d.total, d.pageSize))}
    </div>`;
}

export interface ReturnFormData {
  products: Product[];
  customers: User[];
  defaultOrderNo?: string;
  defaultCustomerId?: number | null;
  /** 从销售单「办理退货」进入时锁定的原单 id */
  linkedOrderId?: number;
  /** 原单每款商品的售出 / 已退 / 可退数量 */
  returnableLines?: { name: string; sold: number; returned: number; avail: number }[];
  /** 从原销售单带入的退货明细 */
  prefillLines?: { product: Product; qty: number; price?: number }[];
  /** 原销售单校验失败 / 未找到时的提示 */
  orderHint?: string;
}

export function returnFormPage(ctx: ViewCtx, d: ReturnFormData): string {
  const cusOptions = [`<option value="">— 不关联客户（或从原销售单自动带出） —</option>`]
    .concat(
      d.customers.map(
        (u) =>
          `<option value="${u.id}"${d.defaultCustomerId === u.id ? " selected" : ""}>${esc(u.nickname)}（@${esc(
            u.username
          )}）</option>`
      )
    )
    .join("");

  const prefill = d.prefillLines || [];
  const hasPrefill = prefill.length > 0;
  const rl = d.returnableLines || [];
  const linked = !!d.linkedOrderId;
  const returnableDetail = rl
    .map(
      (x) =>
        `<div class="small">· ${esc(x.name)}：售出 ${qty(x.sold)} · 已退 ${qty(x.returned)} · 本次可退 <strong>${qty(
          x.avail
        )}</strong></div>`
    )
    .join("");
  const headHint = hasPrefill
    ? `↩️ 已按原销售单 <strong>${esc(d.defaultOrderNo || "")}</strong> 带入 <strong>${prefill.length}</strong> 款商品的<strong>可退数量</strong>（售出数已扣除历史退货），单价沿用原成交单价；不需要退货的行可直接删除。${
        rl.length > 1 || rl.some((x) => x.returned > 0) ? returnableDetail : ""
      }`
    : d.orderHint
      ? `<span class="neg">${esc(d.orderHint)}</span>${returnableDetail ? returnableDetail : ""}`
      : "";

  // 从订单页进入时原单被锁定：单号只读并附隐藏 id，避免清空单号后绕过可退数量校验
  const orderNoField = linked
    ? `<input type="hidden" name="sales_order_id" value="${d.linkedOrderId}">` +
      field(
        "关联原销售单",
        `<input type="text" name="sales_order_no" maxlength="32" value="${esc(d.defaultOrderNo || "")}" readonly>`,
        "由订单页带入，退货数量与单价均按该单校验"
      )
    : field(
        "关联原销售单号",
        `<input type="text" name="sales_order_no" maxlength="32" placeholder="选填，如 SO202610191234">`,
        "填写后系统将自动校验原单商品与可退数量；留空即为无原单的零售退货"
      );

  return `
    ${pageHead("＋ 新建销售退货单", "校验原销售单可退数量并自动回补商品库存", `<a class="btn secondary" href="/returns">← 返回退货列表</a>`)}
    <form method="post" action="/returns/new">
      ${csrfInput(ctx.csrf)}
      <div class="card"><h3>📝 退货单头信息</h3>
        <div class="form-row cols-3">
          ${orderNoField}
          ${field("退货客户", `<select name="customer_id">${cusOptions}</select>`, linked ? "已锁定为原单客户" : "若已填原销售单号，将自动关联原单客户")}
          ${field("退货原因及备注", `<input type="text" name="remark" maxlength="200" placeholder="选填，如：尺码不符 / 包装破损换退">`)}
        </div>
      </div>
      ${orderItemsBlock(d.products, "sale_price", {
        prefillLines: prefill,
        allowAddRow: false,
        headHint,
      })}
      <div class="btn-row">
        <button class="btn primary" type="submit">✅ 确认退货并入库</button>
        <a class="btn secondary" href="/returns">取消</a>
      </div>
    </form>`;
}

export function returnDetailPage(ctx: ViewCtx, o: ReturnOrder, canVoid = false): string {
  const items = (o.items || [])
    .map(
      (it, i) =>
        `<tr>
          <td>${i + 1}</td>
          <td><strong>${esc(it.product_name || "—")}</strong>${it.sku ? `<br><span class="muted small">SKU: ${esc(it.sku)}</span>` : ""}</td>
          <td class="num">${qty(it.qty)} ${esc(it.unit || "")}</td>
          <td class="num">${money(it.price)}</td>
          <td class="num"><strong>${money(it.amount)}</strong></td>
        </tr>`
    )
    .join("");

  return `
    ${pageHead(
      `销售退货单 ${o.order_no}`,
      `退货时间：${fmtDT(o.created_at)}`,
      `<button type="button" class="btn secondary" data-action="print-doc">🖨️ 打印退货单</button>
       <a class="btn secondary" href="/returns">← 返回列表</a>
       ${
         canVoid && o.status === "done"
           ? `<form class="inline-form" method="post" action="/returns/${o.id}/void" data-confirm="作废退货单将从当前库存中扣回已入库的退货数量，确定作废吗？">${csrfInput(ctx.csrf)}<button class="btn danger" type="submit">作废此单</button></form>`
           : ""
       }`
    )}
    <div class="card voucher-card">
      <div class="voucher-head">
        <div>
          <div class="voucher-title">${esc(ctx.appName)} · 销售退货单</div>
          <div class="muted small">单据编号：<strong>${esc(o.order_no)}</strong></div>
        </div>
        <div>${orderStatusBadge(o.status)}</div>
      </div>
      <dl class="kv kv-grid">
        <div><dt>关联原销售单</dt><dd>${
          o.sales_order_id && o.sales_order_no
            ? `<a href="/sales/${o.sales_order_id}"><strong>${esc(o.sales_order_no)}</strong></a>`
            : "—"
        }</dd></div>
        <div><dt>退货客户</dt><dd>${esc(o.customer_name || "零售散客")}</dd></div>
        <div><dt>应退总金额</dt><dd><strong class="neg">${money(o.total)}</strong></dd></div>
        <div><dt>经办操作人</dt><dd>${esc(o.operator_name || "—")}</dd></div>
        <div><dt>退货时间</dt><dd>${fmtDT(o.created_at)}</dd></div>
        <div><dt>退货原因/备注</dt><dd>${esc(o.remark || "无")}</dd></div>
      </dl>
      <hr class="divider">
      <h3>🧾 退货商品明细</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>序号</th><th>商品名称 / SKU</th><th class="num">退货数量</th><th class="num">退货单价</th><th class="num">退款小计</th></tr></thead>
        <tbody>${items || emptyRow(5)}</tbody>
      </table></div>
    </div>`;
}

// ================= 客户退换货申请（客户提交 → 管理员审核） =================

function reqStatusBadge(s: string): string {
  const kind = s === "approved" ? "green" : s === "rejected" ? "red" : s === "cancelled" ? "gray" : "yellow";
  return badge(requestStatusName(s), kind as "green" | "red" | "gray" | "yellow");
}
function reqTypeBadge(t: string): string {
  return badge(requestTypeName(t), t === "exchange" ? "blue" : "gray");
}

export interface RequestApplyRow {
  item: SalesItem;
  returned: number;
  pending: number;
  avail: number;
}

/** 客户提交退换货申请 */
export function returnApplyPage(
  ctx: ViewCtx,
  d: { order: SalesOrder; rows: RequestApplyRow[]; type: string; reason: string; error?: string }
): string {
  const rows = d.rows
    .map(({ item, returned, pending, avail }) => {
      const disabled = avail <= 0;
      return `<tr>
        <td><strong>${esc(item.product_name || "—")}</strong>${item.sku ? `<br><span class="muted small">SKU: ${esc(item.sku)}</span>` : ""}</td>
        <td class="num col-hide-sm">${money(item.price)}</td>
        <td class="num col-hide-sm">${qty(item.qty)} ${esc(item.unit || "")}</td>
        <td class="num">
          <strong class="${avail > 0 ? "pos" : "muted"}">${qty(avail)}</strong>
          ${
            returned > 0 || pending > 0
              ? `<div class="muted small">已退 ${qty(returned)}${pending > 0 ? ` · 待审 ${qty(pending)}` : ""}</div>`
              : ""
          }
        </td>
        <td>
          <input type="hidden" name="product_id" value="${item.product_id}">
          <input type="number" class="qty-input" name="qty" min="0" max="${avail}" step="0.01" value="0"${disabled ? " disabled" : ""}>
        </td>
      </tr>`;
    })
    .join("");

  const typeRadio = (k: string, label: string, desc: string) => `
    <label class="radio-card${d.type === k ? " active" : ""}">
      <input type="radio" name="type" value="${k}"${d.type === k ? " checked" : ""}>
      <span><strong>${label}</strong><br><span class="muted small">${desc}</span></span>
    </label>`;

  return `
    ${pageHead(
      "↩️ 申请退换货",
      `原销售单 ${d.order.order_no} · ${d.order.items?.length || 0} 款商品`,
      `<a class="btn secondary" href="/sales/${d.order.id}">← 返回订单详情</a>`
    )}
    ${d.error ? `<div class="flash err">${esc(d.error)}</div>` : ""}
    <form method="post" action="/returns/apply">
      ${csrfInput(ctx.csrf)}
      <input type="hidden" name="order_id" value="${d.order.id}">
      <div class="card"><h3>📝 申请信息</h3>
        <div class="radio-cards">
          ${typeRadio("return", "🔄 退货退款", "商品退回，商家审核通过后回补库存并按原成交价退款")}
          ${typeRadio("exchange", "🔁 换货", "商品退回后由商家重新寄出同款或等价商品")}
        </div>
        ${field(
          "退换货原因",
          `<textarea name="reason" rows="3" maxlength="300" placeholder="请描述具体问题，如：收到时外包装破损、颜色与图片不符、尺寸偏小等" required>${esc(
            d.reason
          )}</textarea>`,
          "请尽量描述清楚，便于商家快速审核处理",
          true
        )}
      </div>
      <div class="card">
        <div class="card-head"><h3>🧾 选择需要退换的商品</h3><span class="muted small">数量填 0 表示不申请</span></div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>商品名称 / SKU</th><th class="num col-hide-sm">成交单价</th><th class="num col-hide-sm">已购数量</th><th class="num">可申请数量</th><th>本次申请数量</th></tr></thead>
          <tbody>${rows || emptyRow(5, "该订单没有可申请退换的商品")}</tbody>
        </table></div>
      </div>
      <div class="btn-row">
        <button class="btn primary" type="submit">📮 提交申请</button>
        <a class="btn secondary" href="/sales/${d.order.id}">取消</a>
      </div>
    </form>`;
}

/** 退换货申请列表（管理员/销售看全部，客户只看自己的） */
export function returnRequestListPage(
  ctx: ViewCtx,
  d: {
    rows: ReturnRequest[];
    total: number;
    page: number;
    pageSize: number;
    status: string;
    forCustomer: boolean;
    pendingCount?: number;
  }
): string {
  const statusOptions = [
    ["", "全部状态"],
    ["pending", "待审核"],
    ["approved", "已通过"],
    ["rejected", "已驳回"],
    ["cancelled", "已撤销"],
  ]
    .map(([v, label]) => `<option value="${v}"${d.status === v ? " selected" : ""}>${label}</option>`)
    .join("");

  const rows =
    d.rows.length > 0
      ? d.rows
          .map((r) => {
            const act = d.forCustomer
              ? r.status === "pending"
                ? `<form class="inline-form" method="post" action="/returns/my/${r.id}/cancel" data-confirm="确定撤销这条退换货申请吗？">${csrfInput(
                    ctx.csrf
                  )}<button class="btn small danger" type="submit">撤销</button></form>`
                : `<a class="btn small secondary" href="/returns/my/${r.id}">查看</a>`
              : `<a class="btn small ${r.status === "pending" ? "primary" : "secondary"}" href="/returns/requests/${r.id}">${
                  r.status === "pending" ? "审核" : "查看"
                }</a>`;
            return `<tr>
              <td><a href="${d.forCustomer ? "/returns/my" : "/returns/requests"}/${r.id}"><strong>${esc(r.request_no)}</strong></a></td>
              ${d.forCustomer ? "" : `<td><strong>${esc(r.customer_name || "—")}</strong><div class="muted small">@${esc(r.customer_username || "")}</div></td>`}
              <td><a href="/sales/${r.sales_order_id}">${esc(r.sales_order_no)}</a></td>
              <td>${reqTypeBadge(r.type)}</td>
              <td class="num"><strong>${money(r.total)}</strong></td>
              <td>${reqStatusBadge(r.status)}</td>
              <td class="muted small" style="white-space:nowrap">${fmtDT(r.created_at)}</td>
              <td>${act}</td>
            </tr>`;
          })
          .join("")
      : emptyRow(d.forCustomer ? 7 : 8, "暂无退换货申请");

  return `
    ${pageHead(
      d.forCustomer ? "↩️ 我的退换货申请" : "📮 客户退换货审核",
      d.forCustomer
        ? `共 ${d.total} 条申请 · 提交后由商家审核，审核通过将自动回补库存`
        : `共 ${d.total} 条申请${d.pendingCount ? ` · ${d.pendingCount} 条待审核` : ""}`,
      d.forCustomer
        ? `<a class="btn secondary" href="/sales">← 我的订单</a>`
        : `<a class="btn secondary" href="/returns">↩️ 销售退货单</a>`
    )}
    <form class="toolbar" method="get" action="${d.forCustomer ? "/returns/my" : "/returns/requests"}">
      <select name="status">${statusOptions}</select>
      <button class="btn primary" type="submit">筛选</button>
      ${d.status ? `<a class="btn secondary" href="${d.forCustomer ? "/returns/my" : "/returns/requests"}">重置</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>申请单号</th>${d.forCustomer ? "" : "<th>客户</th>"}<th>原销售单</th><th>类型</th><th class="num">申请金额</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml(d.forCustomer ? "/returns/my" : "/returns/requests", { status: d.status }, d.page, Math.max(1, Math.ceil(d.total / d.pageSize)))}
    </div>`;
}

/** 退换货申请详情 + 审核操作 */
export function returnRequestDetailPage(
  ctx: ViewCtx,
  d: { req: ReturnRequest; canReview: boolean; isOwner: boolean }
): string {
  const r = d.req;
  const items = r.items
    .map(
      (it, i) => `<tr>
        <td>${i + 1}</td>
        <td><strong>${esc(it.name || "—")}</strong>${it.sku ? `<br><span class="muted small">SKU: ${esc(it.sku)}</span>` : ""}</td>
        <td class="num">${qty(it.qty)} ${esc(it.unit || "")}</td>
        <td class="num">${money(it.price)}</td>
        <td class="num"><strong>${money(round2(it.qty * it.price))}</strong></td>
      </tr>`
    )
    .join("");

  const reviewCard =
    d.canReview && r.status === "pending"
      ? `<div class="card highlight-card">
          <h3>🔍 审核处理</h3>
          <form method="post" action="/returns/requests/${r.id}/review">
            ${csrfInput(ctx.csrf)}
            ${field("审核意见 / 驳回原因", `<input type="text" name="remark" maxlength="200" placeholder="选填；驳回时建议填写原因，客户可在详情页看到">`, "")}
            <div class="btn-row">
              <button class="btn success" type="submit" name="action" value="approve" data-confirm="通过后将自动生成正式退货单并回补商品库存，确定通过吗？">✅ 审核通过并生成退货单</button>
              <button class="btn danger" type="submit" name="action" value="reject" data-confirm="确定驳回该退换货申请吗？">✖ 驳回申请</button>
            </div>
          </form>
        </div>`
      : d.isOwner && r.status === "pending"
        ? `<div class="card"><h3>⏳ 等待商家审核</h3>
            <p class="muted small">申请已提交，商家审核后会在此显示结果。如需撤回，可点击下方按钮撤销。</p>
            <form method="post" action="/returns/my/${r.id}/cancel" data-confirm="确定撤销这条退换货申请吗？">${csrfInput(
              ctx.csrf
            )}<button class="btn danger" type="submit">撤销申请</button></form>
          </div>`
        : "";

  const resultCard =
    r.status === "approved"
      ? `<div class="card highlight-card"><h3>✅ 审核已通过</h3>
          <p class="muted small">${
            r.return_order_id
              ? `已自动生成退货单 <a href="/returns/${r.return_order_id}"><strong>查看退货单</strong></a>，商品库存已回补。`
              : "商家已确认，请留意后续处理。"
          }${r.type === "exchange" ? "换货商品将由商家另行安排寄出。" : "退款将由商家按原支付方式或余额退回。"}</p>
          ${r.review_remark ? `<p class="small">审核意见：${esc(r.review_remark)}</p>` : ""}
        </div>`
      : r.status === "rejected"
        ? `<div class="card"><h3>✖ 申请已驳回</h3><p class="small">${esc(r.review_remark || "商家未通过该申请")}</p></div>`
        : r.status === "cancelled"
          ? `<div class="card"><h3>已撤销</h3><p class="muted small">该申请已被客户撤销。</p></div>`
          : "";

  return `
    ${pageHead(
      `退换货申请 ${r.request_no}`,
      `提交时间：${fmtDT(r.created_at)}`,
      d.canReview
        ? `<a class="btn secondary" href="/returns/requests">← 返回审核列表</a>`
        : `<a class="btn secondary" href="/returns/my">← 我的退换货</a>`
    )}
    <div class="card"><h3>📋 申请信息 ${reqStatusBadge(r.status)}</h3>
      <dl class="kv kv-grid">
        <div><dt>申请类型</dt><dd>${reqTypeBadge(r.type)}</dd></div>
        <div><dt>原销售单</dt><dd><a href="/sales/${r.sales_order_id}"><strong>${esc(r.sales_order_no)}</strong></a></dd></div>
        <div><dt>申请人</dt><dd><strong>${esc(r.customer_name || "—")}</strong></dd></div>
        <div><dt>申请退款金额</dt><dd><strong>${money(r.total)}</strong></dd></div>
        <div style="grid-column: 1 / -1"><dt>申请原因</dt><dd>${esc(r.reason || "—")}</dd></div>
        ${
          r.reviewed_at
            ? `<div><dt>审核人</dt><dd>${esc(r.reviewer_name || "—")}</dd></div>
               <div><dt>审核时间</dt><dd>${fmtDT(r.reviewed_at)}</dd></div>`
            : ""
        }
      </dl>
      <hr class="divider">
      <h3>🧾 申请退换的商品</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>序号</th><th>商品名称 / SKU</th><th class="num">数量</th><th class="num">成交单价</th><th class="num">小计</th></tr></thead>
        <tbody>${items || emptyRow(5)}</tbody>
      </table></div>
    </div>
    ${resultCard}
    ${reviewCard}`;
}

// ================= 库存流水 =================

const MOVEMENT_TYPES = ["initial_in", "purchase_in", "sale_out", "return_in", "adjust", "void"] as const;

function movementBadge(t: string): string {
  const kind =
    t === "purchase_in" || t === "initial_in"
      ? "green"
      : t === "sale_out"
        ? "blue"
        : t === "return_in"
          ? "yellow"
          : t === "void"
            ? "red"
            : "gray";
  return badge(movementTypeName(t), kind as "green" | "blue" | "yellow" | "red" | "gray");
}

function refDoc(m: StockMovement): string {
  if (!m.ref_id) return `<span class="muted">—</span>`;
  if (m.ref_type === "purchase") return `<a href="/purchase/${m.ref_id}">进货单 #${m.ref_id}</a>`;
  if (m.ref_type === "sales") return `<a href="/sales/${m.ref_id}">销售单 #${m.ref_id}</a>`;
  if (m.ref_type === "returns") return `<a href="/returns/${m.ref_id}">退货单 #${m.ref_id}</a>`;
  if (m.ref_type === "product") return `<a href="/products/${m.ref_id}/edit">商品建档 #${m.ref_id}</a>`;
  return esc(`${m.ref_type} #${m.ref_id}`);
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
  const typeOptions = [`<option value="">全部变动类型</option>`]
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
              <td><strong>${esc(m.product_name || "—")}</strong>${m.sku ? `<br><span class="muted small">${esc(m.sku)}</span>` : ""}</td>
              <td class="num ${m.change > 0 ? "pos" : m.change < 0 ? "neg" : ""}"><strong>${chg}</strong> ${esc(m.unit || "")}</td>
              <td class="num muted small">${qty(m.before_qty)} → <strong>${qty(m.after_qty)}</strong></td>
              <td>${movementBadge(m.type)}</td>
              <td>${refDoc(m)}</td>
              <td>${esc(m.operator_name || "系统")}</td>
              <td class="muted small">${esc(m.remark || "—")}</td>
              <td class="muted small">${fmtDT(m.created_at)}</td>
            </tr>`;
          })
          .join("")
      : emptyRow(8, "暂无符合条件的库存变动流水");

  return `
    ${pageHead("🧾 库存变动流水台账", `共 ${d.total} 条出入库留痕记录`, `<a class="btn secondary" href="/reports/export?type=movements&from=${encodeURIComponent(d.f.from)}&to=${encodeURIComponent(d.f.to)}">📥 导出流水 CSV</a>`)}
    <form class="toolbar" method="get" action="/movements">
      <select name="product_id">${prodOptions}</select>
      <select name="type">${typeOptions}</select>
      <input type="date" name="from" value="${esc(d.f.from)}">
      <span class="muted">至</span>
      <input type="date" name="to" value="${esc(d.f.to)}">
      <button class="btn primary" type="submit">筛选</button>
      ${d.f.productId || d.f.type || d.f.from || d.f.to ? `<a class="btn secondary" href="/movements">重置</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>商品名称 / SKU</th><th class="num">变动数量</th><th class="num">变动前 → 变动后</th><th>业务类型</th><th>关联单据</th><th>操作人</th><th>摘要备注</th><th>发生时间</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/movements", { product_id: d.f.productId, type: d.f.type, from: d.f.from, to: d.f.to }, d.page, tp(d.total, d.pageSize))}
    </div>`;
}

// ================= 库存盘点 =================

export function adjustPage(ctx: ViewCtx, products: Product[]): string {
  const options = products
    .map(
      (p) =>
        `<option value="${p.id}" data-stock="${p.stock}" data-unit="${esc(p.unit)}">${esc(p.name)}${
          p.sku ? ` [${esc(p.sku)}]` : ""
        }（账面：${qty(p.stock)} ${esc(p.unit)}）</option>`
    )
    .join("");

  return `
    ${pageHead("🧮 仓库库存盘点校准", "录入仓库实盘数量，系统自动计算盘盈/盘亏差额并写入库存流水", `<a class="btn secondary" href="/movements?type=adjust">查看历史盘点记录 →</a>`)}
    <div class="grid cols-2">
      <div class="card">
        <h3>📋 执行库存盘点</h3>
        <form method="post" action="/adjust" data-confirm="确认按实盘数量校准库存吗？盘盈或盘亏差异将永久记入库存流水。">
          ${csrfInput(ctx.csrf)}
          ${field(
            "选择盘点商品",
            `<select id="adjustProduct" name="product_id" data-role="adjust-product" required><option value="">— 请选择要盘点的商品 —</option>${options}</select>`,
            "",
            true
          )}
          <div class="adjust-info-box">
            <div><span class="muted">当前账面库存：</span><strong id="adjustCurrentStock">—</strong></div>
            <div><span class="muted">预计盈亏差额：</span><strong id="adjustDiffPreview">—</strong></div>
          </div>
          ${field("仓库实盘数量", `<input type="number" id="adjustActualQty" name="actual_qty" min="0" step="0.01" required placeholder="输入实际清点到的准确数量">`, "", true)}
          ${field("盘点原因/备注", `<input type="text" name="remark" maxlength="200" placeholder="例如：月末例行盘点 / 损耗核销">`)}
          <button class="btn primary" type="submit">✅ 确认校准库存</button>
        </form>
      </div>
      <div class="card">
        <h3>💡 盘点作业规范</h3>
        <ul class="guide-list">
          <li><strong>实盘大于账面（盘盈）</strong>：系统自动调增账面库存，生成正数「盘点调整」流水。</li>
          <li><strong>实盘小于账面（盘亏）</strong>：系统自动调减账面库存，生成负数「盘点调整」流水。</li>
          <li><strong>审计留痕</strong>：每次盘点均自动记录操作员账号、盘点前库存、实盘后库存及时间戳，不可篡改。</li>
        </ul>
      </div>
    </div>`;
}

// ================= 库存预警 =================

export function warningPage(ctx: ViewCtx, rows: Product[]): string {
  const isAdmin = ctx.user?.role === "admin";
  const body =
    rows.length > 0
      ? `<div class="card"><div class="table-wrap"><table class="table">
          <thead><tr><th>缩略图</th><th>商品名称 / 编码</th><th>首选供应商</th><th class="num">当前库存</th><th class="num">安全库存线</th><th class="num">缺口数量</th><th>建议操作</th></tr></thead>
          <tbody>${rows
            .map((p) => {
              const gap = round2(Math.max(0, p.min_stock - p.stock));
              const img = p.image_key
                ? `<img class="thumb" src="${fileUrl(p.image_key)}" alt="">`
                : `<span class="empty-thumb">📦</span>`;
              return `<tr>
                <td>${img}</td>
                <td><strong>${esc(p.name)}</strong>${p.sku ? `<br><span class="muted small">SKU: ${esc(p.sku)}</span>` : ""}</td>
                <td>${esc(p.supplier_name || "—")}</td>
                <td class="num neg"><strong>${qty(p.stock)}</strong> ${esc(p.unit)}</td>
                <td class="num">${qty(p.min_stock)} ${esc(p.unit)}</td>
                <td class="num neg">${gap > 0 ? `缺 ${qty(gap)} ${esc(p.unit)}` : "触及警戒线"}</td>
                <td>${
                  isAdmin
                    ? `<a class="btn small primary" href="/purchase/new?product_id=${p.id}">📥 一键去补货</a>`
                    : `<span class="muted small">请联系管理员采购补货</span>`
                }</td>
              </tr>`;
            })
            .join("")}</tbody>
        </table></div></div>`
      : `<div class="card"><div class="empty-state"><span class="empty-ico">🎉</span><span>太棒了！当前所有上架商品库存均高于安全预警线</span></div></div>`;

  return `${pageHead("⚠️ 低库存安全预警", `共 ${rows.length} 款上架商品库存低于或等于安全库存线`)}${body}`;
}
