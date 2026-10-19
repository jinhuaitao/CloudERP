// 路由公共辅助函数：Store 取用、鉴权、表单解析、跳转、上传
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { Store, ensureSchema } from "../db";
import type { AppEnv, SafeUser } from "../env";
import { errorPage } from "../views/layout";
import type { ViewCtx } from "../views/layout";
import { r2Key, validImage } from "../lib";

/** 取 Store（附带空库自愈建表，不阻塞请求） */
export function store(c: Context<AppEnv>): Store {
  ensureSchema(c.env.DB).catch(() => {});
  return new Store(c.env.DB);
}

/** 标准页面上下文（要求已登录） */
export function pageCtx(c: Context<AppEnv>): ViewCtx {
  const settings = c.get("settings") || {};
  return {
    user: c.get("user")!,
    csrf: c.get("csrfToken"),
    settings,
    appName: settings.site_name || "进销通",
    lowStockCount: c.get("lowStockCount") || 0,
  };
}

/** 宽松页面上下文（user 允许为 null，用于登录/注册/找回等公开页） */
export function looseCtx(c: Context<AppEnv>): ViewCtx {
  const settings = c.get("settings") || {};
  return {
    user: c.get("user") ?? null,
    csrf: c.get("csrfToken") || "",
    settings,
    appName: settings.site_name || "进销通",
    lowStockCount: c.get("lowStockCount") || 0,
  };
}

/** 取当前登录用户；未登录时抛出 302 跳转到 /login */
export function me(c: Context<AppEnv>): SafeUser {
  const u = c.get("user");
  if (!u) throw new HTTPException(302, { res: c.redirect("/login", 302) });
  return u;
}

/** 角色守卫：未登录→302 /login；角色不符→403 */
export function needRoles(c: Context<AppEnv>, roles: SafeUser["role"][]): SafeUser {
  const u = c.get("user");
  if (!u) throw new HTTPException(302, { res: c.redirect("/login", 302) });
  if (!roles.includes(u.role)) {
    throw new HTTPException(403, {
      res: c.html(errorPage(pageCtx(c), 403, "无权访问", "您的账号角色无权访问此页面。"), 403),
    });
  }
  return u;
}

function cookieVal(c: Context<AppEnv>, name: string): string | null {
  const m = (c.req.header("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** 从 cookie 取会话 token（sid） */
export function sidFromCookie(c: Context<AppEnv>): string | null {
  return cookieVal(c, "sid");
}

export interface ParsedForm {
  fields: Record<string, string>;
  all: (name: string) => string[];
  file: (name: string) => File | null;
  files: (name: string) => File[];
}

/**
 * 解析 multipart/urlencoded 表单（只解析一次），并校验 CSRF。
 * CSRF 校验失败时抛出 403 Response。
 */
export async function parseForm(c: Context<AppEnv>): Promise<ParsedForm> {
  const fd = await c.req.formData();
  const token = cookieVal(c, "csrf_token") || "";
  if (!token || String(fd.get("csrf") ?? "") !== token) {
    throw new HTTPException(403, {
      res: c.html(
        errorPage(looseCtx(c), 403, "请求无效", "表单已过期或安全校验失败，请刷新页面后重试。"),
        403
      ),
    });
  }
  const fields: Record<string, string> = {};
  for (const [k, v] of fd.entries() as IterableIterator<[string, unknown]>) {
    if (v instanceof File) continue;
    fields[k] = String(v);
  }
  return {
    fields,
    all: (name: string) => (fd.getAll(name) as unknown[]).map((v) => (v instanceof File ? "" : String(v))),
    file: (name: string) => {
      const v: unknown = fd.get(name);
      return v instanceof File && v.size > 0 ? v : null;
    },
    files: (name: string) => (fd.getAll(name) as unknown[]).filter((v): v is File => v instanceof File && v.size > 0),
  };
}

/** 302 跳转，msg/err 以查询参数携带（前端 app.js 读取后展示） */
export function redirectWith(c: Context<AppEnv>, url: string, msg?: string, err?: string): Response {
  const q: string[] = [];
  if (msg) q.push("msg=" + encodeURIComponent(msg));
  if (err) q.push("err=" + encodeURIComponent(err));
  const sep = url.includes("?") ? "&" : "?";
  return c.redirect(url + (q.length ? sep + q.join("&") : ""), 302);
}

/**
 * 保存上传图片到 R2，返回对象 key。
 * file 为 null 时返回 null；图片不合法时抛出 Error。
 */
export async function saveUpload(c: Context<AppEnv>, file: File | null, prefix: string): Promise<string | null> {
  if (!file) return null;
  const maxMB = parseFloat(c.env.MAX_UPLOAD_MB || "5") || 5;
  const bad = validImage(file, maxMB);
  if (bad) throw new Error(bad);
  const key = r2Key(prefix, file.name || "upload.bin");
  await c.env.R2.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });
  return key;
}

/** 判断当前请求是否为 HTTPS（用于决定 cookie 是否加 Secure） */
export function isHttps(c: Context<AppEnv>): boolean {
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
}
