// 商品 / 分类 / 供应商 / 客户商品目录（返回纯 HTML 片段，由路由层包裹 layout）
import { esc, money, qty, round2 } from "../lib";
import {
  pageHead,
  badge,
  emptyRow,
  pagerHtml,
  csrfInput,
  field,
  type ViewCtx,
} from "./layout";
import type { Category, Supplier, Product } from "../db";

/** R2 图片访问地址（key 按段编码，保留 / 分隔） */
export function fileUrl(key: string): string {
  if (!key) return "";
  return "/files/" + key.split("/").map(encodeURIComponent).join("/");
}

/** 无图占位（内联 SVG data URI） */
const PLACEHOLDER =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="320"><rect width="400" height="320" fill="#f1f5f9"/><text x="200" y="175" font-size="64" text-anchor="middle">📦</text></svg>`
  );

function statusBadge(p: Product): string {
  return p.status === "on" ? badge("上架中", "green") : badge("已下架", "gray");
}

// ---------- 商品列表 ----------

export interface ProductListData {
  rows: Product[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  categories: Category[];
  categoryId: string;
  status?: string;
  canEdit: boolean;
}

export function productListPage(ctx: ViewCtx, d: ProductListData): string {
  const totalPages = Math.max(1, Math.ceil(d.total / d.pageSize));
  const catOptions = [`<option value="">全部分类</option>`]
    .concat(
      d.categories.map(
        (c) =>
          `<option value="${c.id}"${String(d.categoryId) === String(c.id) ? " selected" : ""}>${esc(c.name)}</option>`
      )
    )
    .join("");
  const statusOptions = [
    `<option value="">全部状态</option>`,
    `<option value="on"${d.status === "on" ? " selected" : ""}>上架中</option>`,
    `<option value="off"${d.status === "off" ? " selected" : ""}>已下架</option>`,
  ].join("");

  const rows =
    d.rows.length > 0
      ? d.rows
          .map((p) => {
            const low = p.status === "on" && p.stock <= p.min_stock;
            const margin = p.sale_price > 0 ? round2(((p.sale_price - p.purchase_price) / p.sale_price) * 100) : 0;
            const img = p.image_key
              ? `<img class="thumb" src="${fileUrl(p.image_key)}" alt="${esc(p.name)}" loading="lazy">`
              : `<img class="thumb" src="${PLACEHOLDER}" alt="无图片" loading="lazy">`;
            const actions = d.canEdit
              ? `<div class="btn-row">
                  <a class="btn small secondary" href="/products/${p.id}/edit">编辑</a>
                  <form class="inline-form" method="post" action="/products/${p.id}/toggle">${csrfInput(ctx.csrf)}<button class="btn small secondary" type="submit">${p.status === "on" ? "下架" : "上架"}</button></form>
                  <form class="inline-form" method="post" action="/products/${p.id}/delete" data-confirm="确定删除商品「${esc(p.name)}」吗？已有库存流水的商品不可删除。">${csrfInput(ctx.csrf)}<button class="btn small danger" type="submit">删除</button></form>
                </div>`
              : `<span class="muted small">只读</span>`;
            return `<tr>
              <td>${img}</td>
              <td>
                <strong>${esc(p.name)}</strong>
                <div class="muted small">SKU：<code>${esc(p.sku || "—")}</code>${p.barcode ? ` · 条码：${esc(p.barcode)}` : ""}</div>
              </td>
              <td>${esc(p.category_name || "未分类")}<div class="muted small">${esc(p.supplier_name || "—")}</div></td>
              <td class="num">${money(p.purchase_price)}</td>
              <td class="num"><strong>${money(p.sale_price)}</strong><div class="muted small">毛利 ${margin}%</div></td>
              <td class="num ${low ? "neg" : ""}">
                <strong>${qty(p.stock)}</strong> ${esc(p.unit)}
                ${low ? `<div class="small neg">⚠️ 低于安全线(${qty(p.min_stock)})</div>` : `<div class="muted small">安全线 ${qty(p.min_stock)}</div>`}
              </td>
              <td>${statusBadge(p)}</td>
              <td>${actions}</td>
            </tr>`;
          })
          .join("")
      : emptyRow(8, "暂无符合条件的商品档案");

  return `
    ${pageHead(
      "📦 商品档案管理",
      `共 ${d.total} 款商品 · 支持加权平均成本自动核算与安全库存预警`,
      d.canEdit
        ? `<a class="btn secondary" href="/categories">🗂️ 分类与供应商</a>
           <a class="btn secondary" href="/reports/export?type=products">📥 导出 CSV</a>
           <a class="btn primary" href="/products/new">＋ 新建商品</a>`
        : ""
    )}
    <form class="toolbar" method="get" action="/products">
      <input type="text" name="q" value="${esc(d.q)}" placeholder="🔍 搜索商品名称 / SKU / 条码..." maxlength="64" class="grow">
      <select name="category_id">${catOptions}</select>
      <select name="status">${statusOptions}</select>
      <button class="btn primary" type="submit">筛选</button>
      ${d.q || d.categoryId || d.status ? `<a class="btn secondary" href="/products">重置</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>缩略图</th><th>商品名称 / 编码</th><th>分类 / 供应商</th><th class="num">成本进价</th><th class="num">标准售价</th><th class="num">当前库存</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/products", { q: d.q, category_id: d.categoryId, status: d.status || "" }, d.page, totalPages)}
    </div>`;
}

// ---------- 商品表单（新建 / 编辑） ----------

export interface ProductFormData {
  product?: Product | null;
  categories: Category[];
  suppliers: Supplier[];
}

export function productFormPage(ctx: ViewCtx, d: ProductFormData): string {
  const p = d.product || null;
  const isNew = !p;
  const action = isNew ? "/products" : `/products/${p!.id}`;
  const v = (x: unknown): string => esc(x ?? "");

  const catOptions = [`<option value="">— 未分类 —</option>`]
    .concat(
      d.categories.map(
        (c) =>
          `<option value="${c.id}"${p && p.category_id === c.id ? " selected" : ""}>${esc(c.name)}</option>`
      )
    )
    .join("");
  const supOptions = [`<option value="">— 无默认供应商 —</option>`]
    .concat(
      d.suppliers.map(
        (s) =>
          `<option value="${s.id}"${p && p.supplier_id === s.id ? " selected" : ""}>${esc(s.name)}</option>`
      )
    )
    .join("");

  const imgBlock = p?.image_key
    ? `<img id="imgPrev" class="img-preview" src="${fileUrl(p.image_key)}" alt="商品图片"><div class="hint">上传新图片将自动替换原图</div>`
    : `<img id="imgPrev" class="img-preview" style="display:none" alt="">`;

  return `
    ${pageHead(isNew ? "＋ 新建商品档案" : "✏️ 编辑商品档案", p ? `${p.name}（${p.sku || "无SKU"}）` : "录入商品基础资料、价格体系与库存预警阈值", `<a class="btn secondary" href="/products">← 返回商品列表</a>`)}
    <form method="post" action="${action}" enctype="multipart/form-data">
      ${csrfInput(ctx.csrf)}
      <div class="card"><h3>📝 基础档案信息</h3>
        <div class="form-row">
          ${field("商品名称", `<input type="text" name="name" required maxlength="100" value="${v(p?.name)}" placeholder="例如：iPhone 16 Pro 256G 原色钛金属">`, "", true)}
          ${field("SKU（货号编码）", `<input type="text" name="sku" maxlength="64" value="${v(p?.sku)}" placeholder="选填，留空将自动生成唯一 SKU">`)}
        </div>
        <div class="form-row">
          ${field("所属分类", `<select name="category_id">${catOptions}</select>`)}
          ${field("首选供应商", `<select name="supplier_id">${supOptions}</select>`)}
        </div>
        <div class="form-row cols-3">
          ${field("国际条形码 (Barcode)", `<input type="text" name="barcode" maxlength="64" value="${v(p?.barcode)}" placeholder="支持扫码枪直接录入">`)}
          ${field("计量单位", `<input type="text" name="unit" maxlength="16" value="${v(p?.unit) || "件"}" placeholder="件 / 台 / 箱 / kg">`)}
          ${field("销售状态", `<select name="status"><option value="on"${!p || p.status === "on" ? " selected" : ""}>上架销售中</option><option value="off"${p && p.status === "off" ? " selected" : ""}>暂停销售（下架）</option></select>`)}
        </div>
      </div>
      <div class="card"><h3>💰 价格核算与库存控制</h3>
        <div class="form-row cols-3">
          ${field("成本进价（元）", `<input type="number" name="purchase_price" min="0" step="0.01" value="${v(p?.purchase_price ?? 0)}" required>`, "后续进货入库将按加权平均法更新", true)}
          ${field("标准售价（元）", `<input type="number" name="sale_price" min="0" step="0.01" value="${v(p?.sale_price ?? 0)}" required>`, "销售开单时的默认带出单价", true)}
          ${
            isNew
              ? field("期初库存数量", `<input type="number" name="stock" min="0" step="0.01" value="0">`, "大于 0 时将自动生成「期初入库」流水记录")
              : field("当前账面库存", `<input type="text" value="${qty(p!.stock)} ${esc(p!.unit)}" disabled>`, "库存变动请通过采购 / 销售 / 盘点单据执行")
          }
        </div>
        <div class="form-row">
          ${field("安全库存预警线", `<input type="number" name="min_stock" min="0" step="0.01" value="${v(p?.min_stock ?? 5)}">`, "当账面库存 ≤ 此数值时触发全局低库存预警")}
          ${field("最大库存上限", `<input type="number" name="max_stock" min="0" step="0.01" value="${v(p?.max_stock ?? 0)}">`, "0 表示不限制；设置后采购入库超出上限将自动拦截")}
        </div>
      </div>
      <div class="card"><h3>🖼️ 商品图片与备注说明</h3>
        ${field("商品实拍图（存储在 Cloudflare R2）", `${imgBlock}<input type="file" name="image" accept="image/*" data-preview="#imgPrev" class="mt">`, "支持 JPG / PNG / WebP / GIF 格式")}
        ${field("规格与内部备注", `<textarea name="remark" maxlength="500" placeholder="选填，可填写保修期、存放库位或拿货注意事项">${v(p?.remark)}</textarea>`)}
      </div>
      <div class="btn-row">
        <button class="btn primary" type="submit">${isNew ? "✅ 保存并创建商品" : "💾 保存商品修改"}</button>
        <a class="btn secondary" href="/products">取消</a>
      </div>
    </form>`;
}

// ---------- 分类管理 ----------

export function categoryPage(ctx: ViewCtx, cats: Category[]): string {
  const rows =
    cats.length > 0
      ? cats
          .map(
            (c) => `<tr>
              <td>
                <form class="inline-edit-form" method="post" action="/categories/${c.id}/rename">
                  ${csrfInput(ctx.csrf)}
                  <input type="text" name="name" value="${esc(c.name)}" required maxlength="32" class="inline-input">
                  <input type="number" name="sort" value="${c.sort}" style="width:72px" title="排序权重（越小越靠前）">
                  <button class="btn small secondary" type="submit">保存</button>
                </form>
              </td>
              <td class="num"><span class="badge blue">${c.product_count ?? 0} 款商品</span></td>
              <td class="num">
                <form class="inline-form" method="post" action="/categories/${c.id}/delete" data-confirm="确定删除分类「${esc(c.name)}」吗？该分类下的商品将自动归为未分类。">
                  ${csrfInput(ctx.csrf)}
                  <button class="btn small danger" type="submit">删除</button>
                </form>
              </td>
            </tr>`
          )
          .join("")
      : emptyRow(3, "暂无商品分类");

  return `
    ${pageHead("🗂️ 商品分类与供应商", "管理商品类目结构与上游供应商通讯录", `<a class="btn primary" href="/suppliers">🏭 进入供应商管理 →</a>`)}
    <div class="grid cols-2">
      <div class="card"><h3>📁 商品分类列表（支持直接改名与排序）</h3>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>分类名称 / 排序权重</th><th class="num">关联商品</th><th class="num">操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>
      <div>
        <div class="card"><h3>➕ 新增商品分类</h3>
          <form method="post" action="/categories">
            ${csrfInput(ctx.csrf)}
            <div class="form-row">
              ${field("分类名称", `<input type="text" name="name" required maxlength="32" placeholder="例如：智能穿戴 / 数码配件">`, "", true)}
              ${field("排序权重", `<input type="number" name="sort" value="0" step="1">`, "数字越小排在越前面")}
            </div>
            <button class="btn primary" type="submit">＋ 创建分类</button>
          </form>
        </div>
        <div class="card"><h3>🏭 上游供应商档案</h3>
          <p class="muted">维护供应商联系人、电话与地址，采购进货时可一键关联并在报表中按供应商追溯。</p>
          <div class="btn-row mt">
            <a class="btn primary" href="/suppliers">管理供应商列表 →</a>
            <a class="btn secondary" href="/suppliers/new">＋ 新增供应商</a>
          </div>
        </div>
      </div>
    </div>`;
}

// ---------- 供应商 ----------

export function supplierPage(ctx: ViewCtx, d: { rows: Supplier[]; q: string }): string {
  const rows =
    d.rows.length > 0
      ? d.rows
          .map(
            (s) => `<tr>
              <td><strong>${esc(s.name)}</strong></td>
              <td>${esc(s.contact || "—")}</td>
              <td>${esc(s.phone || "—")}</td>
              <td>${esc(s.address || "—")}</td>
              <td class="num"><span class="badge blue">${s.product_count ?? 0} 款</span></td>
              <td><div class="btn-row">
                <a class="btn small secondary" href="/suppliers/${s.id}/edit">编辑</a>
                <form class="inline-form" method="post" action="/suppliers/${s.id}/delete" data-confirm="确定删除供应商「${esc(s.name)}」吗？">
                  ${csrfInput(ctx.csrf)}
                  <button class="btn small danger" type="submit">删除</button>
                </form>
              </div></td>
            </tr>`
          )
          .join("")
      : emptyRow(6, "暂无供应商档案");

  return `
    ${pageHead("🏭 供应商管理", `共 ${d.rows.length} 家合作供应商`, `<a class="btn primary" href="/suppliers/new">＋ 新增供应商</a> <a class="btn secondary" href="/categories">← 返回分类管理</a>`)}
    <form class="toolbar" method="get" action="/suppliers">
      <input type="text" name="q" value="${esc(d.q)}" placeholder="🔍 搜索供应商名称 / 联系人 / 电话..." maxlength="64" class="grow">
      <button class="btn primary" type="submit">搜索</button>
      ${d.q ? `<a class="btn secondary" href="/suppliers">清除</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>供应商名称</th><th>联系人</th><th>联系电话</th><th>地址</th><th class="num">供货商品数</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`;
}

export function supplierFormPage(ctx: ViewCtx, s?: Supplier | null): string {
  const isNew = !s;
  const action = isNew ? "/suppliers" : `/suppliers/${s!.id}`;
  const v = (x: unknown): string => esc(x ?? "");
  return `
    ${pageHead(isNew ? "＋ 新增供应商" : "✏️ 编辑供应商", s ? esc(s.name) : "填写上游供应商联系资料", `<a class="btn secondary" href="/suppliers">← 返回供应商列表</a>`)}
    <div class="card">
      <form method="post" action="${action}">
        ${csrfInput(ctx.csrf)}
        ${field("供应商企业名称", `<input type="text" name="name" required maxlength="100" value="${v(s?.name)}" placeholder="例如：深圳市华强电子供应链有限公司">`, "", true)}
        <div class="form-row">
          ${field("业务联系人", `<input type="text" name="contact" maxlength="32" value="${v(s?.contact)}" placeholder="如：王经理">`)}
          ${field("联系电话", `<input type="tel" name="phone" maxlength="32" value="${v(s?.phone)}" placeholder="手机号或座机">`)}
        </div>
        ${field("经营/发货地址", `<input type="text" name="address" maxlength="200" value="${v(s?.address)}" placeholder="详细仓库或办公地址">`)}
        <div class="btn-row">
          <button class="btn primary" type="submit">${isNew ? "✅ 创建供应商" : "💾 保存修改"}</button>
          <a class="btn secondary" href="/suppliers">取消</a>
        </div>
      </form>
    </div>`;
}

// ---------- 客户商品目录 ----------

export function catalogPage(
  ctx: ViewCtx,
  rows: Product[],
  f?: { q?: string; categories?: Category[]; categoryId?: string }
): string {
  const isCustomer = ctx.user?.role === "customer";
  const catOptions = [`<option value="">全部分类</option>`]
    .concat(
      (f?.categories || []).map(
        (c) =>
          `<option value="${c.id}"${String(f?.categoryId || "") === String(c.id) ? " selected" : ""}>${esc(c.name)}</option>`
      )
    )
    .join("");

  const cards =
    rows.length > 0
      ? rows
          .map((p) => {
            const soldout = p.stock <= 0;
            const stockBadge = soldout
              ? badge("暂时缺货", "gray")
              : p.stock <= p.min_stock
                ? badge("库存紧张", "yellow")
                : badge("现货充足", "green");
            return `<div class="goods-card${soldout ? " soldout" : ""}">
              <div class="goods-img-wrap">
                <img src="${p.image_key ? fileUrl(p.image_key) : PLACEHOLDER}" alt="${esc(p.name)}" loading="lazy">
                <div class="goods-badge-pos">${stockBadge}</div>
              </div>
              <div class="body">
                <div class="goods-cat">${esc(p.category_name || "精选商品")}</div>
                <div class="name" title="${esc(p.name)}">${esc(p.name)}</div>
                <div class="goods-bottom">
                  <div class="price">${money(p.sale_price)} <span class="unit-label">/ ${esc(p.unit)}</span></div>
                  <div class="small muted">余 ${qty(p.stock)} ${esc(p.unit)}</div>
                </div>
                <div class="small muted mt-xs">编码：${esc(p.sku || "—")}</div>
              </div>
            </div>`;
          })
          .join("")
      : `<div class="card"><div class="empty-state"><span class="empty-ico">📭</span><span>暂无符合条件的上架商品</span></div></div>`;

  return `
    ${pageHead(
      "🛍️ 在线商品画册",
      `共展示 ${rows.length} 款在售商品`,
      isCustomer
        ? `<a class="btn primary" href="/shop">🛒 前往自助下单</a>`
        : `<a class="btn primary" href="/sales/new">＋ 代客开单</a>`
    )}
    <form class="toolbar" method="get" action="/catalog">
      <input type="text" name="q" value="${esc(f?.q || "")}" placeholder="🔍 搜索商品名称或编码..." maxlength="64" class="grow">
      <select name="category_id">${catOptions}</select>
      <button class="btn primary" type="submit">查找</button>
      ${f?.q || f?.categoryId ? `<a class="btn secondary" href="/catalog">重置</a>` : ""}
    </form>
    <div class="goods-grid">${cards}</div>`;
}
