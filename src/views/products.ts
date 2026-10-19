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

/**
 * 分类下拉（建档与商品列表筛选共用）：一级作为 optgroup 分组，
 * 组内第一项是该一级本身（直属商品），后面是它的二级；无子级的一级直接平铺。
 */
export function categoryOptions(
  cats: Category[],
  selected: number | string | null | undefined,
  emptyLabel: string,
  emptyValue = ""
): string {
  const sel = String(selected ?? "");
  const opt = (c: Category, label: string) =>
    `<option value="${c.id}"${sel === String(c.id) ? " selected" : ""}>${esc(label)}</option>`;
  const roots = cats.filter((c) => !c.parent_id);
  const rootIds = new Set(roots.map((r) => r.id));
  const head = `<option value="${esc(emptyValue)}"${sel === emptyValue ? " selected" : ""}>${esc(emptyLabel)}</option>`;
  const body = roots
    .map((r) => {
      const kids = cats.filter((c) => c.parent_id === r.id);
      if (kids.length === 0) return opt(r, r.name);
      return `<optgroup label="${esc(r.name)}">${opt(r, r.name + "（直属）")}${kids
        .map((k) => opt(k, "　" + k.name))
        .join("")}</optgroup>`;
    })
    .join("");
  // 兜底：上级已不存在的孤儿分类也要能选到，不能在下拉里隐身
  const orphans = cats.filter((c) => c.parent_id && !rootIds.has(c.parent_id));
  return head + body + orphans.map((o) => opt(o, o.name)).join("");
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
  /** 可开销售单（管理员 / 销售员） */
  canSell?: boolean;
  /** 可办理进货入库（仅管理员） */
  canPurchase?: boolean;
}

export function productListPage(ctx: ViewCtx, d: ProductListData): string {
  const totalPages = Math.max(1, Math.ceil(d.total / d.pageSize));
  const catOptions = categoryOptions(d.categories, d.categoryId, "全部分类");
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
            const bizBtns = [
              d.canPurchase
                ? `<a class="btn small secondary" href="/purchase/new?product_id=${p.id}" title="以该商品新建进货单">📥 进货</a>`
                : "",
              d.canSell && p.status === "on"
                ? `<a class="btn small primary" href="/sales/new?product_id=${p.id}" title="以该商品新建销售单">🧾 开单</a>`
                : "",
            ]
              .filter(Boolean)
              .join("");
            const manageBtns = d.canEdit
              ? `<a class="btn small secondary" href="/products/${p.id}/edit">编辑</a>
                 <form class="inline-form" method="post" action="/products/${p.id}/toggle">${csrfInput(ctx.csrf)}<button class="btn small secondary" type="submit">${p.status === "on" ? "下架" : "上架"}</button></form>
                 <form class="inline-form" method="post" action="/products/${p.id}/delete" data-confirm="确定删除商品「${esc(p.name)}」吗？已有库存流水的商品不可删除。">${csrfInput(ctx.csrf)}<button class="btn small danger" type="submit">删除</button></form>`
              : "";
            const actions =
              bizBtns || manageBtns
                ? `<div class="btn-row product-actions">${bizBtns}${manageBtns}</div>`
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

  const headActions = d.canEdit
    ? [
        d.canPurchase ? `<a class="btn secondary" href="/purchase">📥 进货单记录</a>` : "",
        d.canSell ? `<a class="btn secondary" href="/sales">📤 销售单记录</a>` : "",
        `<a class="btn secondary" href="/categories">🗂️ 分类与供应商</a>`,
        `<a class="btn secondary" href="/reports/export?type=products">📥 导出 CSV</a>`,
        `<a class="btn primary" href="/products/new">＋ 新建商品</a>`,
      ]
        .filter(Boolean)
        .join("")
    : "";

  return `
    ${pageHead("📦 商品档案管理", `共 ${d.total} 款商品 · 支持加权平均成本自动核算与安全库存预警`, headActions)}
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

/** 画册图库中的一张图片：R2 products/ 前缀对象 + 被多少商品引用 */
export interface GalleryImage {
  key: string;
  size: number;
  uploaded: string;
  usedBy: number;
}

export interface ProductFormData {
  product?: Product | null;
  categories: Category[];
  suppliers: Supplier[];
  /** 画册图库（供点选） */
  gallery: GalleryImage[];
}

export function productFormPage(ctx: ViewCtx, d: ProductFormData): string {
  const p = d.product || null;
  const isNew = !p;
  const action = isNew ? "/products" : `/products/${p!.id}`;
  const v = (x: unknown): string => esc(x ?? "");

  const catOptions = categoryOptions(d.categories, p?.category_id, "— 未分类 —");
  const supOptions = [`<option value="">— 无默认供应商 —</option>`]
    .concat(
      d.suppliers.map(
        (s) =>
          `<option value="${s.id}"${p && p.supplier_id === s.id ? " selected" : ""}>${esc(s.name)}</option>`
      )
    )
    .join("");

  const imgBlock = p?.image_key
    ? `<img id="imgPrev" class="img-preview" src="${fileUrl(p.image_key)}" alt="商品图片"><div class="hint">当前使用画册图库中的 ${esc(p.image_key.split("/").pop() || p.image_key)}</div>`
    : `<img id="imgPrev" class="img-preview" style="display:none" alt=""><div class="hint">尚未选择商品图片</div>`;

  const gallery = d.gallery || [];
  const pickTile = (g: GalleryImage) => `<label class="gallery-pick">
      <input type="radio" name="image_key" value="${esc(g.key)}"${p?.image_key === g.key ? " checked" : ""}>
      <img src="${fileUrl(g.key)}" alt="" loading="lazy">
    </label>`;
  const pickBlock =
    `<label class="gallery-pick gallery-pick-none">
      <input type="radio" name="image_key" value=""${!p || !p.image_key ? " checked" : ""}>
      <span class="none-ico">🚫</span><span class="none-txt">不显示图片</span>
    </label>` + gallery.map(pickTile).join("");

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
        <div class="form-row">
          ${field("当前商品图", imgBlock)}
          ${field(
            "上传新图片",
            `<input type="file" name="image" accept="image/*" data-preview="#imgPrev">`,
            "JPG / PNG / WebP / GIF；新图会自动存入画册图库并作为本商品图片"
          )}
        </div>
        <div class="hint mt">或从下方画册图库点选一张已有图片（换图不会删除原图片，原图仍保留在图库中）：</div>
        ${
          gallery.length > 0
            ? `<div class="gallery-picks">${pickBlock}</div>`
            : `<p class="muted small mt">画册图库暂无图片，可先在此上传，或前往 <a href="/catalog">商品画册</a> 批量上传后再来点选。</p>`
        }
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
  const roots = cats.filter((c) => !c.parent_id);
  const rootIds = new Set(roots.map((r) => r.id));
  const kidsOf = (id: number) => cats.filter((c) => c.parent_id === id);
  /** 上级选择：只能选一级；带二级子级的一级不允许降级，故直接禁用 */
  const parentSelect = (self: Category) => {
    const locked = self.parent_id === null && (self.child_count || 0) > 0;
    const opts = [`<option value="">＋ 一级分类</option>`]
      .concat(
        roots
          .filter((r) => r.id !== self.id)
          .map((r) => `<option value="${r.id}"${self.parent_id === r.id ? " selected" : ""}>${esc(r.name)}</option>`)
      )
      .join("");
    return `<select name="parent_id" class="cat-parent-select"${locked ? ` disabled title="该一级分类下还有 ${self.child_count} 个二级分类，需先处理子分类才能降级"` : ""}>${opts}</select>`;
  };
  const row = (c: Category, isSub: boolean) => {
    const kids = kidsOf(c.id);
    const total = (c.product_count || 0) + kids.reduce((n, k) => n + (k.product_count || 0), 0);
    const countCell = isSub
      ? `<span class="badge blue">${c.product_count ?? 0} 款商品</span>`
      : `<span class="badge blue">直属 ${c.product_count ?? 0} 款</span>${
          kids.length ? `<div class="muted small">含 ${kids.length} 个二级共 ${total} 款</div>` : ""
        }`;
    return `<tr class="${isSub ? "cat-sub" : "cat-root"}">
      <td>
        <form class="inline-edit-form" method="post" action="/categories/${c.id}/rename">
          ${csrfInput(ctx.csrf)}
          ${isSub ? `<span class="cat-branch" aria-hidden="true">└</span>` : ""}
          <input type="text" name="name" value="${esc(c.name)}" required maxlength="32" class="inline-input" placeholder="分类名称">
          ${parentSelect(c)}
          <input type="number" name="sort" value="${c.sort}" style="width:64px" title="排序权重（越小越靠前）">
          <button class="btn small secondary" type="submit">保存</button>
        </form>
      </td>
      <td class="num">${countCell}</td>
      <td class="num">
        <form class="inline-form" method="post" action="/categories/${c.id}/delete" data-confirm="确定删除分类「${esc(c.name)}」吗？该分类下的商品将自动归为未分类。">
          ${csrfInput(ctx.csrf)}
          <button class="btn small danger" type="submit"${kids.length ? ` disabled title="下还有 ${kids.length} 个二级分类，请先删除或改挂子分类"` : ""}>删除</button>
        </form>
      </td>
    </tr>`;
  };
  const rows =
    cats.length > 0
      ? roots
          .map((r) => row(r, false) + kidsOf(r.id).map((k) => row(k, true)).join(""))
          .join("") +
        // 兜底：上级已不存在的孤儿二级也要可见可改，否则会卡在列表里看不见
        cats
          .filter((c) => c.parent_id && !rootIds.has(c.parent_id))
          .map((c) => row(c, true))
          .join("")
      : emptyRow(3, "暂无商品分类，右侧先建一个一级分类");

  const parentOptions = `<option value="">＋ 作为一级分类</option>`
    + roots.map((r) => `<option value="${r.id}">挂在「${esc(r.name)}」下</option>`).join("");

  return `
    ${pageHead("🗂️ 商品分类与供应商", "两级类目结构：一级用于分组与筛选，二级用于精细建档", `<a class="btn primary" href="/suppliers">🏭 进入供应商管理 →</a>`)}
    <div class="grid cols-2">
      <div class="card"><h3>📁 分类结构（${roots.length} 个一级 · ${cats.length - roots.length} 个二级）</h3>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>分类名称 / 上级 / 排序</th><th class="num">关联商品</th><th class="num">操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <p class="muted small mt">「上级」改成一级分类即把该行降为二级，改成「＋ 一级分类」即升为一级；商品挂在哪一级都支持，商品档案里按一级筛选会自动连带其下全部二级。</p>
      </div>
      <div>
        <div class="card"><h3>➕ 新增商品分类</h3>
          <form method="post" action="/categories">
            ${csrfInput(ctx.csrf)}
            <div class="form-row">
              ${field("分类名称", `<input type="text" name="name" required maxlength="32" placeholder="例如：智能穿戴 / 数码配件">`, "", true)}
              ${field("排序权重", `<input type="number" name="sort" value="0" step="1">`, "数字越小排在越前面")}
            </div>
            ${field("上级分类", `<select name="parent_id">${parentOptions}</select>`, "选「＋ 作为一级分类」即新建顶级类目；不同一级下允许同名二级")}
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
  d: { gallery: GalleryImage[]; truncated: boolean }
): string {
  const isCustomer = ctx.user?.role === "customer";
  const isAdmin = ctx.user?.role === "admin";

  const cards = isAdmin
    ? ""
    : rows.length > 0
      ? rows
          .map((p) => {
            const soldout = p.stock <= 0;
            const stockBadge = soldout
              ? badge("暂时缺货", "gray")
              : p.stock <= p.min_stock
                ? badge("库存紧张", "yellow")
                : badge("现货充足", "green");
            // 客户可直接加入购物车；商家侧仅浏览
            const buyBar = isCustomer
              ? `<div class="goods-buy">
                  <input type="number" class="qty-input" data-cart-qty value="1" min="0.01" max="${p.stock > 0 ? p.stock : 1}" step="1" aria-label="购买数量">
                  <button type="button" class="btn small primary" data-add-cart="${p.id}"${soldout ? " disabled" : ""}>${soldout ? "暂时缺货" : "🛒 加入购物车"}</button>
                </div>
                <div class="goods-incart" data-incart hidden></div>`
              : "";
            return `<div class="goods-card${soldout ? " soldout" : ""}" data-pid="${p.id}" data-name="${esc(p.name)}" data-price="${p.sale_price}" data-stock="${p.stock}" data-unit="${esc(p.unit)}">
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
                ${buyBar}
              </div>
            </div>`;
          })
          .join("")
      : `<div class="card"><div class="empty-state"><span class="empty-ico">📭</span><span>暂无符合条件的上架商品</span></div></div>`;

  const cartBar = isCustomer
    ? `<div class="cart-bar" id="cartBar" hidden>
        <div class="cart-bar-main">
          <span class="cart-bar-count">🛒 购物车已选 <strong id="cartBarCount">0</strong> 款商品</span>
          <span class="cart-bar-total">预估合计 <strong id="cartBarTotal">¥0.00</strong></span>
        </div>
        <div class="cart-bar-actions">
          <button type="button" class="btn small secondary" data-action="cart-clear">清空</button>
          <a class="btn small primary" href="/shop">去结算 →</a>
        </div>
      </div>`
    : "";

  const galleryTile = (g: GalleryImage) => `<div class="gallery-tile">
      <div class="gallery-img"><img src="${fileUrl(g.key)}" alt="" loading="lazy"></div>
      <div class="gallery-meta">
        <span class="muted small">${esc(g.uploaded.slice(0, 10))}</span>
        ${g.usedBy > 0 ? badge(`${g.usedBy} 款在用`, "blue") : badge("未引用", "gray")}
      </div>
      <form method="post" action="/catalog/image/delete" data-confirm="从 R2 删除图片 ${esc(g.key)} 后不可恢复，确定删除吗？">
        ${csrfInput(ctx.csrf)}
        <input type="hidden" name="key" value="${esc(g.key)}">
        <button class="btn small danger" type="submit"${g.usedBy > 0 ? " disabled title=\"该图片正被商品使用，请先为商品换图\"" : ""}>删除</button>
      </form>
    </div>`;

  const galleryCard = isAdmin
    ? `<div class="card gallery-card">
        <div class="card-head">
          <h3>🖼️ 画册图库（${d.gallery.length} 张）</h3>
          <form method="post" action="/catalog/images" enctype="multipart/form-data" class="upload-form">
            ${csrfInput(ctx.csrf)}
            <input type="file" name="images" accept="image/*" multiple required>
            <button class="btn small primary" type="submit">📤 上传到画册</button>
          </form>
        </div>
        <p class="muted small mb">图库里的图片可在「新建 / 编辑商品档案」时直接点选复用；删除商品不会删除图片，只有在这里删除才会真正移除 R2 对象。正在被商品使用的图片不可删除。</p>
        ${
          d.gallery.length > 0
            ? `<div class="gallery-grid">${d.gallery.map(galleryTile).join("")}</div>${
                d.truncated ? `<p class="muted small mt">图库共 ${d.gallery.length} 张（单次最多展示 1000 张，更早的图片需按 key 直接引用）。</p>` : ""
              }`
            : `<div class="empty-state"><span class="empty-ico">🖼️</span><span>画册图库为空，上方可批量上传商品图片</span></div>`
        }
      </div>`
    : "";

  return `
    ${pageHead(
      "🛍️ 在线商品画册",
      isAdmin
        ? `画册图库共 ${d.gallery.length} 张图片 · 商品卡片请在「商品档案」页查看`
        : `共展示 ${rows.length} 款在售商品${isCustomer ? " · 选好数量点「加入购物车」，到「自助下单」统一结算" : ""}`,
      isCustomer
        ? `<a class="btn primary" href="/shop">🛒 购物车 / 去结算</a>`
        : `<a class="btn primary" href="/sales/new">＋ 代客开单</a>`
    )}
    ${galleryCard}
    ${cards ? `<div class="goods-grid">${cards}</div>` : ""}
    ${cartBar}`;
}
