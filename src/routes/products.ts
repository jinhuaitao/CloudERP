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

export function registerProducts(app: Hono<AppEnv>) {
  // ---------- 商品列表 ----------
  app.get("/products", async (c) => {
    try {
      const me = needRoles(c, ["admin", "sales"]);
      const s = store(c);
      const { page, pageSize } = getPagination(c);
      const q = (c.req.query("q") || "").trim();
      const categoryIdQ = (c.req.query("category_id") || "").trim();
      const categoryId = parseInt(categoryIdQ, 10) || null;
      const [res, categories] = await Promise.all([
        s.listProducts({ q: q || undefined, categoryId: categoryId || undefined, page, pageSize }),
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
            canEdit: me.role === "admin",
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
      const [categories, suppliers] = await Promise.all([s.listCategories(), s.listSuppliers()]);
      const ctx = pageCtx(c);
      return c.html(
        layout({ title: "新增商品", ctx, active: "products", content: productFormPage(ctx, { categories, suppliers }) })
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
      const image_key = await saveUpload(c, f.file("image"), "products");
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
        image_key: image_key || "",
        remark: (fields.remark || "").trim(),
      });
      await s.audit(me.id, "新增商品", "商品", `新增商品 ${name}`, clientIP(c));
      return redirectWith(c, "/products", "商品创建成功");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/products/new", undefined, "创建失败：" + (e as Error).message);
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
      const [categories, suppliers] = await Promise.all([s.listCategories(), s.listSuppliers()]);
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "编辑商品",
          ctx,
          active: "products",
          content: productFormPage(ctx, { product: p, categories, suppliers }),
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
      let image_key = p.image_key;
      const img = f.file("image");
      if (img) {
        const key = await saveUpload(c, img, "products");
        if (p.image_key) {
          try {
            await c.env.R2.delete(p.image_key);
          } catch {
            /* 忽略旧图删除失败 */
          }
        }
        image_key = key || "";
      }
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
      return redirectWith(c, `/products/${id}/edit`, undefined, "更新失败：" + (e as Error).message);
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
      if (p.image_key) {
        try {
          await c.env.R2.delete(p.image_key);
        } catch {
          /* 忽略 */
        }
      }
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

  // ---------- 分类 ----------
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
      if (!name) return redirectWith(c, "/categories", undefined, "分类名称不能为空");
      await s.createCategory(name);
      await s.audit(me.id, "新增分类", "分类", `新增分类 ${name}`, clientIP(c));
      return redirectWith(c, "/categories", "分类创建成功");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const msg = /UNIQUE/i.test((e as Error).message) ? "该分类已存在" : "创建失败：" + (e as Error).message;
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
      return redirectWith(c, "/suppliers/new", undefined, "创建失败：" + (e as Error).message);
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
      needRoles(c, ["admin", "sales", "customer"]);
      const { rows } = await store(c).listProducts({ status: "on", page: 1, pageSize: 100 });
      const ctx = pageCtx(c);
      return c.html(layout({ title: "选购商品", ctx, active: "catalog", content: catalogPage(ctx, rows) }));
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载商品目录失败：" + (e as Error).message), 500);
    }
  });
}
