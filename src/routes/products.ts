// 商品 / 分类 / 供应商 / 选购目录
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import { layout, errorPage } from "../views/layout";
import {
  productListPage,
  productFormPage,
  categoryPage,
  supplierPage,
  supplierFormPage,
  catalogPage,
  type GalleryImage,
} from "../views/products";
import { store, pageCtx, needRoles, parseForm, redirectWith, saveUpload } from "./helpers";
import { getPagination, clientIP } from "../lib";

function num(v: string | undefined): number {
  return parseFloat(v || "") || 0;
}
function intOrNull(v: string | undefined): number | null {
  const n = parseInt(v || "", 10);
  return n > 0 ? n : null;
}
function notFound(c: Parameters<typeof pageCtx>[0]) {
  return c.html(errorPage(pageCtx(c), 404, "页面不存在", "请求的记录不存在或已被删除。"), 404);
}

/** 画册图库 = R2 的 products/ 前缀对象清单 + 每张图的被引用数（不建表，R2 即图库） */
async function listGallery(
  c: Parameters<typeof pageCtx>[0],
  s: ReturnType<typeof store>
): Promise<{ images: GalleryImage[]; truncated: boolean }> {
  const [listed, usage] = await Promise.all([c.env.R2.list({ prefix: "products/" }), s.imageUsage()]);
  const images = (listed.objects || [])
    .map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded.toISOString(), usedBy: usage[o.key] || 0 }))
    .sort((a, b) => b.uploaded.localeCompare(a.uploaded));
  return { images, truncated: !!listed.truncated };
}

/** 商品图最终 key：本次新上传 > 表单点选（空值=不显示图片）> 原图 */
async function resolveImageKey(
  c: Parameters<typeof pageCtx>[0],
  f: Awaited<ReturnType<typeof parseForm>>,
  current: string
): Promise<string> {
  const uploaded = await saveUpload(c, f.file("image"), "products");
  if (uploaded) return uploaded;
  const picked = f.fields.image_key;
  if (picked === undefined) return current;
  const key = picked.trim();
  return key === "" || key.startsWith("products/") ? key : current;
}

export function registerProducts(app: Hono<AppEnv>) {
  // ---------- 商品列表 ----------
  app.get("/products", async (c) => {
    try {
      const me = needRoles(c, ["admin", "sales"]);
      const s = store(c);
      const { page, pageSize } = getPagination(c);
      const q = (c.req.query("q") || "").trim();
      // 兼容 category_id 与 categoryId 两种查询参数名
      const categoryIdQ = (c.req.query("category_id") || c.req.query("categoryId") || "").trim();
      const categoryId = parseInt(categoryIdQ, 10) || null;
      const status = (c.req.query("status") || "").trim();
      const [res, categories] = await Promise.all([
        s.listProducts({
          q: q || undefined,
          categoryId: categoryId || undefined,
          status: status || undefined,
          page,
          pageSize,
        }),
        s.listCategories(),
      ]);
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "商品管理",
          ctx,
          active: "products",
          content: productListPage(ctx, {
            rows: res.rows,
            total: res.total,
            page,
            pageSize,
            q,
            categories,
            categoryId: categoryIdQ,
            status,
            canEdit: me.role === "admin",
            canSell: me.role === "admin" || me.role === "sales",
            canPurchase: me.role === "admin",
          }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载商品列表失败：" + (e as Error).message), 500);
    }
  });

  // ---------- 新增商品 ----------
  app.get("/products/new", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const s = store(c);
      const [categories, suppliers, gallery] = await Promise.all([
        s.listCategories(),
        s.listSuppliers(),
        listGallery(c, s),
      ]);
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "新增商品",
          ctx,
          active: "products",
          content: productFormPage(ctx, { categories, suppliers, gallery: gallery.images }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载页面失败：" + (e as Error).message), 500);
    }
  });

  app.post("/products", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    try {
      const f = await parseForm(c);
      const fields = f.fields;
      const name = (fields.name || "").trim();
      if (!name) return redirectWith(c, "/products/new", undefined, "商品名称不能为空");
      const image_key = await resolveImageKey(c, f, "");
      await s.createProduct({
        name,
        category_id: intOrNull(fields.category_id),
        supplier_id: intOrNull(fields.supplier_id),
        sku: (fields.sku || "").trim() || null,
        barcode: (fields.barcode || "").trim(),
        unit: (fields.unit || "").trim() || "件",
        purchase_price: num(fields.purchase_price),
        sale_price: num(fields.sale_price),
        stock: num(fields.stock),
        min_stock: num(fields.min_stock),
        max_stock: num(fields.max_stock),
        image_key,
        remark: (fields.remark || "").trim(),
        operator_id: me.id,
      });
      await s.audit(me.id, "新增商品", "商品", `新增商品 ${name}`, clientIP(c));
      return redirectWith(c, "/products", "商品创建成功");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const msg = /UNIQUE/i.test((e as Error).message) ? "SKU 已存在，请更换或留空自动生成" : (e as Error).message;
      return redirectWith(c, "/products/new", undefined, "创建失败：" + msg);
    }
  });

  // ---------- 编辑商品 ----------
  app.get("/products/:id/edit", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const s = store(c);
      const id = parseInt(c.req.param("id") || "", 10) || 0;
      const p = id ? await s.getProduct(id) : null;
      if (!p) return notFound(c);
      const [categories, suppliers, gallery] = await Promise.all([
        s.listCategories(),
        s.listSuppliers(),
        listGallery(c, s),
      ]);
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "编辑商品",
          ctx,
          active: "products",
          content: productFormPage(ctx, { product: p, categories, suppliers, gallery: gallery.images }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载页面失败：" + (e as Error).message), 500);
    }
  });

  app.post("/products/:id", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      const p = id ? await s.getProduct(id) : null;
      if (!p) return notFound(c);
      const f = await parseForm(c);
      const fields = f.fields;
      const name = (fields.name || "").trim();
      if (!name) return redirectWith(c, `/products/${id}/edit`, undefined, "商品名称不能为空");
      // 图库中的图片可被多个商品复用，换图时不删除旧对象，只在画册页手动删除
      const image_key = await resolveImageKey(c, f, p.image_key);
      await s.updateProduct(id, {
        name,
        category_id: intOrNull(fields.category_id),
        supplier_id: intOrNull(fields.supplier_id),
        sku: (fields.sku || "").trim() || null,
        barcode: (fields.barcode || "").trim(),
        unit: (fields.unit || "").trim() || "件",
        purchase_price: num(fields.purchase_price),
        sale_price: num(fields.sale_price),
        min_stock: num(fields.min_stock),
        max_stock: num(fields.max_stock),
        image_key,
        remark: (fields.remark || "").trim(),
        status: fields.status === "off" ? "off" : "on",
      });
      await s.audit(me.id, "编辑商品", "商品", `更新商品 ${name}（#${id}）`, clientIP(c));
      return redirectWith(c, "/products", "商品更新成功");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const msg = /UNIQUE/i.test((e as Error).message) ? "SKU 已存在，请更换" : (e as Error).message;
      return redirectWith(c, `/products/${id}/edit`, undefined, "更新失败：" + msg);
    }
  });

  // ---------- 删除 / 上下架 ----------
  app.post("/products/:id/delete", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      const p = id ? await s.getProduct(id) : null;
      if (!p) return notFound(c);
      await s.deleteProduct(id);
      await s.audit(me.id, "删除商品", "商品", `删除商品 ${p.name}（#${id}）`, clientIP(c));
      return redirectWith(c, "/products", "商品已删除");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/products", undefined, "删除失败：" + (e as Error).message);
    }
  });

  app.post("/products/:id/toggle", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      const p = id ? await s.getProduct(id) : null;
      if (!p) return notFound(c);
      const status = p.status === "on" ? "off" : "on";
      await s.updateProduct(id, {
        name: p.name,
        category_id: p.category_id,
        supplier_id: p.supplier_id,
        sku: p.sku,
        barcode: p.barcode,
        unit: p.unit,
        purchase_price: p.purchase_price,
        sale_price: p.sale_price,
        min_stock: p.min_stock,
        max_stock: p.max_stock,
        image_key: p.image_key,
        remark: p.remark,
        status,
      });
      await s.audit(me.id, status === "on" ? "商品上架" : "商品下架", "商品", `${p.name}（#${id}）`, clientIP(c));
      return redirectWith(c, "/products", status === "on" ? "商品已上架" : "商品已下架");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/products", undefined, "操作失败：" + (e as Error).message);
    }
  });

  // ---------- 分类（含重命名修复） ----------
  app.get("/categories", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const cats = await store(c).listCategories();
      const ctx = pageCtx(c);
      return c.html(layout({ title: "商品分类", ctx, active: "categories", content: categoryPage(ctx, cats) }));
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载分类失败：" + (e as Error).message), 500);
    }
  });

  app.post("/categories", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    try {
      const { fields } = await parseForm(c);
      const name = (fields.name || "").trim();
      const sort = parseInt(fields.sort || "0", 10) || 0;
      if (!name) return redirectWith(c, "/categories", undefined, "分类名称不能为空");
      await s.createCategory(name, sort);
      await s.audit(me.id, "新增分类", "分类", `新增分类 ${name}`, clientIP(c));
      return redirectWith(c, "/categories", "分类创建成功");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const msg = /UNIQUE/i.test((e as Error).message) ? "该分类已存在" : "创建失败：" + (e as Error).message;
      return redirectWith(c, "/categories", undefined, msg);
    }
  });

  // 修复原版缺失的分类重命名路由
  app.post("/categories/:id/rename", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      if (!id) return redirectWith(c, "/categories", undefined, "参数错误");
      const { fields } = await parseForm(c);
      const name = (fields.name || "").trim();
      const sort = fields.sort !== undefined ? parseInt(fields.sort || "0", 10) || 0 : undefined;
      if (!name) return redirectWith(c, "/categories", undefined, "分类名称不能为空");
      await s.renameCategory(id, name, sort);
      await s.audit(me.id, "编辑分类", "分类", `更新分类 #${id} 为 ${name}`, clientIP(c));
      return redirectWith(c, "/categories", "分类已更新");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const msg = /UNIQUE/i.test((e as Error).message) ? "该分类名称已存在" : "更新失败：" + (e as Error).message;
      return redirectWith(c, "/categories", undefined, msg);
    }
  });

  app.post("/categories/:id/delete", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      if (!id) return redirectWith(c, "/categories", undefined, "参数错误");
      await s.deleteCategory(id);
      await s.audit(me.id, "删除分类", "分类", `删除分类 #${id}`, clientIP(c));
      return redirectWith(c, "/categories", "分类已删除");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/categories", undefined, "删除失败：" + (e as Error).message);
    }
  });

  // ---------- 供应商 ----------
  app.get("/suppliers", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const s = store(c);
      const q = (c.req.query("q") || "").trim();
      const rows = await s.listSuppliers(q || undefined);
      const ctx = pageCtx(c);
      return c.html(
        layout({ title: "供应商管理", ctx, active: "categories", content: supplierPage(ctx, { rows, q }) })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载供应商失败：" + (e as Error).message), 500);
    }
  });

  app.get("/suppliers/new", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const ctx = pageCtx(c);
      return c.html(layout({ title: "新增供应商", ctx, active: "categories", content: supplierFormPage(ctx) }));
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载页面失败：" + (e as Error).message), 500);
    }
  });

  app.post("/suppliers", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    try {
      const { fields } = await parseForm(c);
      const name = (fields.name || "").trim();
      if (!name) return redirectWith(c, "/suppliers/new", undefined, "供应商名称不能为空");
      await s.createSupplier({
        name,
        contact: (fields.contact || "").trim(),
        phone: (fields.phone || "").trim(),
        address: (fields.address || "").trim(),
      });
      await s.audit(me.id, "新增供应商", "供应商", `新增供应商 ${name}`, clientIP(c));
      return redirectWith(c, "/suppliers", "供应商创建成功");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const msg = /UNIQUE/i.test((e as Error).message) ? "该供应商名称已存在" : (e as Error).message;
      return redirectWith(c, "/suppliers/new", undefined, "创建失败：" + msg);
    }
  });

  app.get("/suppliers/:id/edit", async (c) => {
    try {
      needRoles(c, ["admin"]);
      const s = store(c);
      const id = parseInt(c.req.param("id") || "", 10) || 0;
      const sp = id ? await s.getSupplier(id) : null;
      if (!sp) return notFound(c);
      const ctx = pageCtx(c);
      return c.html(
        layout({ title: "编辑供应商", ctx, active: "categories", content: supplierFormPage(ctx, sp) })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载页面失败：" + (e as Error).message), 500);
    }
  });

  app.post("/suppliers/:id", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      if (!id || !(await s.getSupplier(id))) return notFound(c);
      const { fields } = await parseForm(c);
      const name = (fields.name || "").trim();
      if (!name) return redirectWith(c, `/suppliers/${id}/edit`, undefined, "供应商名称不能为空");
      await s.updateSupplier(id, {
        name,
        contact: (fields.contact || "").trim(),
        phone: (fields.phone || "").trim(),
        address: (fields.address || "").trim(),
      });
      await s.audit(me.id, "编辑供应商", "供应商", `更新供应商 ${name}（#${id}）`, clientIP(c));
      return redirectWith(c, "/suppliers", "供应商更新成功");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, `/suppliers/${id}/edit`, undefined, "更新失败：" + (e as Error).message);
    }
  });

  app.post("/suppliers/:id/delete", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    const id = parseInt(c.req.param("id") || "", 10) || 0;
    try {
      if (!id) return redirectWith(c, "/suppliers", undefined, "参数错误");
      await s.deleteSupplier(id);
      await s.audit(me.id, "删除供应商", "供应商", `删除供应商 #${id}`, clientIP(c));
      return redirectWith(c, "/suppliers", "供应商已删除");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/suppliers", undefined, "删除失败：" + (e as Error).message);
    }
  });

  // ---------- 选购目录（管理员 / 销售 / 客户） ----------
  app.get("/catalog", async (c) => {
    try {
      const me = needRoles(c, ["admin", "sales", "customer"]);
      const s = store(c);
      const [{ rows }, gallery] = await Promise.all([
        s.listProducts({ status: "on", page: 1, pageSize: 500 }),
        me.role === "admin" ? listGallery(c, s) : Promise.resolve({ images: [] as GalleryImage[], truncated: false }),
      ]);
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "选购商品",
          ctx,
          active: "catalog",
          content: catalogPage(ctx, rows, { gallery: gallery.images, truncated: gallery.truncated }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载商品目录失败：" + (e as Error).message), 500);
    }
  });

  // ---------- 画册图库：批量上传 / 删除 ----------
  app.post("/catalog/images", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    try {
      const f = await parseForm(c);
      const files = f.files("images");
      if (files.length === 0) return redirectWith(c, "/catalog", undefined, "请先选择要上传的图片");
      const keys: string[] = [];
      for (const file of files) {
        const key = await saveUpload(c, file, "products");
        if (key) keys.push(key);
      }
      await s.audit(me.id, "画册上传", "商品", `上传 ${keys.length} 张画册图片`, clientIP(c));
      return redirectWith(c, "/catalog", `已上传 ${keys.length} 张图片到画册图库`);
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/catalog", undefined, "上传失败：" + (e as Error).message);
    }
  });

  app.post("/catalog/image/delete", async (c) => {
    const me = needRoles(c, ["admin"]);
    const s = store(c);
    try {
      const f = await parseForm(c);
      const key = (f.fields.key || "").trim();
      if (!key.startsWith("products/")) return redirectWith(c, "/catalog", undefined, "参数错误：只能删除画册图库中的图片");
      const usage = await s.imageUsage();
      if ((usage[key] || 0) > 0) {
        return redirectWith(c, "/catalog", undefined, `该图片正被 ${usage[key]} 款商品使用，请先为商品换图或移除图片`);
      }
      await c.env.R2.delete(key);
      await s.audit(me.id, "画册删除", "商品", `删除画册图片 ${key}`, clientIP(c));
      return redirectWith(c, "/catalog", "图片已从图库删除");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/catalog", undefined, "删除失败：" + (e as Error).message);
    }
  });
}
