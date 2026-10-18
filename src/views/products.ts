// 商品 / 分类 / 供应商 / 客户商品目录
import { esc, money, qty } from "../lib";
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
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="320"><rect width="400" height="320" fill="#f3f4f6"/><text x="200" y="180" font-size="72" text-anchor="middle">📦</text></svg>`
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

  const rows =
    d.rows.length > 0
      ? d.rows
          .map((p) => {
            const low = p.stock <= p.min_stock;
            const img = p.image_key
              ? `<img class="thumb" src="${fileUrl(p.image_key)}" alt="${esc(p.name)}" loading="lazy">`
              : `<img class="thumb" src="${PLACEHOLDER}" alt="无图片" loading="lazy">`;
            const actions = d.canEdit
              ? `<div class="btn-row">
                  <a class="btn small secondary" href="/products/${p.id}/edit">编辑</a>
                  <form class="inline-form" method="post" action="/products/${p.id}/toggle">${csrfInput(ctx.csrf)}<button class="btn small secondary" type="submit">${p.status === "on" ? "下架" : "上架"}</button></form>
                  <form class="inline-form" method="post" action="/products/${p.id}/delete" data-confirm="确定删除商品「${esc(p.name)}」吗？已有库存流水的商品不可删除。">${csrfInput(ctx.csrf)}<button class="btn small danger" type="submit">删除</button></form>
                </div>`
              : `<span class="muted small">—</span>`;
            return `<tr>
              <td>${img}</td>
              <td><strong>${esc(p.name)}</strong><br><span class="muted small">SKU：${esc(p.sku || "—")}</span></td>
              <td>${esc(p.category_name || "未分类")}</td>
              <td class="num">${money(p.purchase_price)}</td>
              <td class="num">${money(p.sale_price)}</td>
              <td class="num ${low ? "neg" : ""}">${qty(p.stock)} ${esc(p.unit)}</td>
              <td>${statusBadge(p)}</td>
              <td>${actions}</td>
            </tr>`;
          })
          .join("")
      : emptyRow(8, "暂无商品，点击右上角新建");

  const content = `
    ${pageHead("📦 商品管理", `共 ${d.total} 件商品`, d.canEdit ? `<a class="btn primary" href="/products/new">＋ 新建商品</a>` : "")}
    <form class="toolbar" method="get" action="/products">
      <input type="text" name="q" value="${esc(d.q)}" placeholder="🔍 名称 / SKU / 条码" maxlength="64">
      <select name="categoryId">${catOptions}</select>
      <button class="btn secondary" type="submit">搜索</button>
      ${d.q || d.categoryId ? `<a class="btn secondary" href="/products">清除</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>图片</th><th>商品</th><th>分类</th><th class="num">进价</th><th class="num">售价</th><th class="num">库存</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/products", { q: d.q, categoryId: d.categoryId }, d.page, totalPages)}
    </div>`;

  return layout({ title: "商品管理", ctx, active: "products", content });
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
  const supOptions = [`<option value="">— 无 —</option>`]
    .concat(
      d.suppliers.map(
        (s) =>
          `<option value="${s.id}"${p && p.supplier_id === s.id ? " selected" : ""}>${esc(s.name)}</option>`
      )
    )
    .join("");

  const imgBlock = p?.image_key
    ? `<img id="imgPrev" class="img-preview" src="${fileUrl(p.image_key)}" alt="商品图片"><div class="hint">重新上传将替换原图</div>`
    : `<img id="imgPrev" class="img-preview" alt="">`;

  const content = `
    ${pageHead(isNew ? "＋ 新建商品" : "✏️ 编辑商品", p ? esc(p.name) : "填写商品资料", `<a class="btn secondary" href="/products">← 返回列表</a>`)}
    <form method="post" action="${action}" enctype="multipart/form-data">
      ${csrfInput(ctx.csrf)}
      <div class="card"><h3>📝 基本信息</h3>
        <div class="form-row">
          ${field("商品名称", `<input type="text" name="name" required maxlength="100" value="${v(p?.name)}">`, "", true)}
          ${field("SKU（货号）", `<input type="text" name="sku" maxlength="64" value="${v(p?.sku)}" placeholder="选填，留空自动生成">`)}
        </div>
        <div class="form-row">
          ${field("商品分类", `<select name="category_id">${catOptions}</select>`)}
          ${field("供应商", `<select name="supplier_id">${supOptions}</select>`)}
        </div>
        <div class="form-row cols-3">
          ${field("条码", `<input type="text" name="barcode" maxlength="64" value="${v(p?.barcode)}">`)}
          ${field("单位", `<input type="text" name="unit" maxlength="16" value="${v(p?.unit) || "件"}">`)}
          ${field("状态", `<select name="status"><option value="on"${!p || p.status === "on" ? " selected" : ""}>上架中</option><option value="off"${p && p.status === "off" ? " selected" : ""}>已下架</option></select>`)}
        </div>
      </div>
      <div class="card"><h3>💰 价格与库存</h3>
        <div class="form-row cols-3">
          ${field("进价（元）", `<input type="number" name="purchase_price" min="0" step="0.01" value="${v(p?.purchase_price ?? 0)}">`, "", true)}
          ${field("售价（元）", `<input type="number" name="sale_price" min="0" step="0.01" value="${v(p?.sale_price ?? 0)}">`, "", true)}
          ${
            isNew
              ? field("初始库存", `<input type="number" name="stock" min="0" step="0.01" value="0">`, "新建商品可直接录入期初库存")
              : field("当前库存", `<input type="text" value="${qty(p!.stock)} ${esc(p!.unit)}" disabled>`, "库存变动请通过进货 / 销售 / 盘点")
          }
        </div>
        <div class="form-row">
          ${field("安全库存", `<input type="number" name="min_stock" min="0" step="0.01" value="${v(p?.min_stock ?? 0)}">`, "低于此数量将触发预警")}
          ${field("库存上限", `<input type="number" name="max_stock" min="0" step="0.01" value="${v(p?.max_stock ?? 0)}">`, "0 表示不限制；进货超上限将被拦截")}
        </div>
      </div>
      <div class="card"><h3>🖼️ 图片与备注</h3>
        ${field("商品图片", `${imgBlock}<input type="file" name="image" accept="image/*" data-preview="#imgPrev" class="mt">`, "支持 JPG / PNG / WebP / GIF")}
        ${field("备注", `<textarea name="remark" maxlength="500">${v(p?.remark)}</textarea>`)}
      </div>
      <div class="btn-row">
        <button class="btn primary" type="submit">${isNew ? "✅ 创建商品" : "💾 保存修改"}</button>
        <a class="btn secondary" href="/products">取消</a>
      </div>
    </form>`;

  return layout({ title: isNew ? "新建商品" : "编辑商品", ctx, active: "products", content });
}

// ---------- 分类管理 ----------

export function categoryPage(ctx: ViewCtx, cats: Category[]): string {
  const rows =
    cats.length > 0
      ? cats
          .map(
            (c) => `<tr>
              <td>
                <form class="inline-form" method="post" action="/categories/${c.id}/rename">
                  ${csrfInput(ctx.csrf)}
                  <input type="text" name="name" value="${esc(c.name)}" required maxlength="32">
                  <button class="btn small secondary" type="submit">重命名</button>
                </form>
              </td>
              <td>
                <form class="inline-form" method="post" action="/categories/${c.id}/delete" data-confirm="确定删除分类「${esc(c.name)}」吗？分类下商品将变为未分类。">
                  ${csrfInput(ctx.csrf)}
                  <button class="btn small danger" type="submit">删除</button>
                </form>
              </td>
            </tr>`
          )
          .join("")
      : emptyRow(2, "暂无分类");

  const content = `
    ${pageHead("🗂️ 分类与供应商", "管理商品分类，供应商在右侧入口")}
    <div class="grid cols-2">
      <div class="card"><h3>📁 分类列表</h3>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>分类名称（可直接重命名）</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>
      <div>
        <div class="card"><h3>➕ 新增分类</h3>
          <form method="post" action="/categories">
            ${csrfInput(ctx.csrf)}
            ${field("分类名称", `<input type="text" name="name" required maxlength="32" placeholder="例如：手机配件">`, "", true)}
            <button class="btn primary" type="submit">创建分类</button>
          </form>
        </div>
        <div class="card"><h3>🏭 供应商</h3>
          <p class="muted">供应商资料独立管理，进货时可快速选择。</p>
          <a class="btn secondary" href="/suppliers">管理供应商 →</a>
        </div>
      </div>
    </div>`;

  return layout({ title: "分类与供应商", ctx, active: "categories", content });
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
      : emptyRow(5, "暂无供应商");

  const content = `
    ${pageHead("🏭 供应商管理", `共 ${d.rows.length} 家供应商`, `<a class="btn primary" href="/suppliers/new">＋ 新增供应商</a> <a class="btn secondary" href="/categories">← 分类管理</a>`)}
    <form class="toolbar" method="get" action="/suppliers">
      <input type="text" name="q" value="${esc(d.q)}" placeholder="🔍 名称 / 电话" maxlength="64">
      <button class="btn secondary" type="submit">搜索</button>
      ${d.q ? `<a class="btn secondary" href="/suppliers">清除</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>名称</th><th>联系人</th><th>电话</th><th>地址</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>`;

  return layout({ title: "供应商管理", ctx, active: "categories", content });
}

export function supplierFormPage(ctx: ViewCtx, s?: Supplier | null): string {
  const isNew = !s;
  const action = isNew ? "/suppliers" : `/suppliers/${s!.id}`;
  const v = (x: unknown): string => esc(x ?? "");
  const content = `
    ${pageHead(isNew ? "＋ 新增供应商" : "✏️ 编辑供应商", s ? esc(s.name) : "填写供应商资料", `<a class="btn secondary" href="/suppliers">← 返回列表</a>`)}
    <div class="card">
      <form method="post" action="${action}">
        ${csrfInput(ctx.csrf)}
        ${field("供应商名称", `<input type="text" name="name" required maxlength="100" value="${v(s?.name)}">`, "", true)}
        <div class="form-row">
          ${field("联系人", `<input type="text" name="contact" maxlength="32" value="${v(s?.contact)}">`)}
          ${field("电话", `<input type="tel" name="phone" maxlength="32" value="${v(s?.phone)}">`)}
        </div>
        ${field("地址", `<input type="text" name="address" maxlength="200" value="${v(s?.address)}">`)}
        <div class="btn-row">
          <button class="btn primary" type="submit">${isNew ? "✅ 创建" : "💾 保存"}</button>
          <a class="btn secondary" href="/suppliers">取消</a>
        </div>
      </form>
    </div>`;

  return layout({ title: isNew ? "新增供应商" : "编辑供应商", ctx, active: "categories", content });
}

// ---------- 客户商品目录 ----------

export function catalogPage(ctx: ViewCtx, rows: Product[]): string {
  const cards =
    rows.length > 0
      ? rows
          .map((p) => {
            const soldout = p.stock <= 0;
            const stockBadge = soldout
              ? badge("缺货", "gray")
              : p.stock <= p.min_stock
                ? badge("库存紧张", "yellow")
                : badge("有货", "green");
            return `<div class="goods-card${soldout ? " soldout" : ""}">
              <img src="${p.image_key ? fileUrl(p.image_key) : PLACEHOLDER}" alt="${esc(p.name)}" loading="lazy">
              <div class="body">
                <div class="name">${esc(p.name)}</div>
                <div class="price">${money(p.sale_price)}</div>
                <div class="small muted">库存：${qty(p.stock)} ${esc(p.unit)}${p.sku ? ` · ${esc(p.sku)}` : ""}</div>
                <div class="mt">${stockBadge}</div>
              </div>
            </div>`;
          })
          .join("")
      : `<div class="card"><p class="muted" align="center">📭 暂无上架商品</p></div>`;

  const content = `
    ${pageHead("🛍️ 商品目录", "精选好物，欢迎选购", `<a class="btn primary" href="/shop">🛒 我要下单</a>`)}
    <div class="goods-grid">${cards}</div>`;

  return layout({ title: "商品目录", ctx, active: "catalog", content });
}
