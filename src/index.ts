// 进销通 · Worker 入口：中间件链 + 路由挂载 + 定时任务
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Store, ensureSchema } from "./db";
import { sha256hex } from "./lib";
import { toSafeUser, type AppEnv, type Env } from "./env";
import { layout, errorPage } from "./views/layout";
import { registerSetupAuth } from "./routes/setup-auth";
import { registerDashboard } from "./routes/dashboard";
import { registerProducts } from "./routes/products";
import { registerStock } from "./routes/stock";
import { registerTeam } from "./routes/team";
import { registerSystem } from "./routes/system";

const app = new Hono<AppEnv>();

// ---------- 安全响应头 ----------
app.use("*", async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
});

// ---------- 上下文准备：建表自愈 + 设置 + 会话认证 + CSRF 令牌 ----------
function getCookie(cookie: string, name: string): string | null {
  const m = cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([a-f0-9]{64})"));
  return m ? m[1] : null;
}

app.use("*", async (c, next) => {
  const store = new Store(c.env.DB);
  await ensureSchema(c.env.DB);
  const settings = await store.getSettings().catch(() => ({}));
  c.set("settings", settings);

  // 会话认证：cookie 里是原始 token，库里存的是其 SHA-256 摘要
  const cookie = c.req.header("cookie") || "";
  let user = null;
  const sid = getCookie(cookie, "sid");
  if (sid) {
    const digest = await sha256hex(sid);
    const s = await store.getSessionWithUser(digest).catch(() => null);
    if (s) user = toSafeUser(s.user);
  }
  c.set("user", user);

  // CSRF 双重提交令牌
  let csrf = getCookie(cookie, "csrf_token");
  let needSetCsrf = false;
  if (!csrf) {
    csrf = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    needSetCsrf = true;
  }
  c.set("csrfToken", csrf);

  // 未初始化时强制进入设置向导（静态资源与公开路径除外）
  const path = new URL(c.req.url).pathname;
  const isAsset = path.startsWith("/static/") || path === "/favicon.ico" || path === "/favicon.svg";
  const publicPaths = ["/setup", "/login", "/register", "/forgot", "/healthz"];
  const isPublic = publicPaths.some((p) => path === p || path.startsWith(p + "/"));
  if (!isAsset && !isPublic) {
    const admins = await store.countAdmins().catch(() => 1);
    if (admins === 0) return c.redirect("/setup", 302);
  }

  await next();

  if (needSetCsrf) {
    const secure = new URL(c.req.url).protocol === "https:" ? "; Secure" : "";
    c.res.headers.append("Set-Cookie", `csrf_token=${csrf}; Path=/; SameSite=Lax; Max-Age=31536000${secure}`);
  }
});

// ---------- 路由挂载 ----------
app.get("/healthz", (c) => c.json({ status: "ok", time: new Date().toISOString() }));

registerSetupAuth(app);
registerDashboard(app);
registerProducts(app);
registerStock(app);
registerTeam(app);
registerSystem(app);

// ---------- 错误处理 ----------
app.onError((err, c) => {
  // HTTPException（鉴权跳转 / 403 / CSRF 拦截）直接返回其携带的 Response
  if (err instanceof HTTPException) return err.getResponse();
  console.error("Unhandled error:", err);
  const ctx = {
    user: c.get("user") || null,
    csrf: c.get("csrfToken") || "",
    settings: c.get("settings") || {},
    appName: "进销通",
  };
  return c.html(errorPage(ctx, 500, "出错了", "服务器内部错误，请稍后再试。"), 500);
});

app.notFound((c) => {
  const ctx = {
    user: c.get("user") || null,
    csrf: c.get("csrfToken") || "",
    settings: c.get("settings") || {},
    appName: "进销通",
  };
  return c.html(errorPage(ctx, 404, "页面不存在", "你访问的页面不存在或已被移动。"), 404);
});

// ---------- 定时任务 ----------
// "0 * * * *": 清理过期会话与陈旧登录记录
// "0 3 * * *": 自动备份全量数据到 R2 并按保留份数轮转
async function scheduled(event: ScheduledEvent, env: Env) {
  const store = new Store(env.DB);
  await ensureSchema(env.DB);
  if (event.cron === "0 3 * * *") {
    const keep = parseInt(await store.getSetting("backup_keep", "14"), 10) || 14;
    const data = await store.exportBackup();
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    const p = (x: number) => String(x).padStart(2, "0");
    const key = `backups/auto-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}.json`;
    await env.R2.put(key, JSON.stringify(data), {
      httpMetadata: { contentType: "application/json" },
    });
    const listed = await env.R2.list({ prefix: "backups/auto-" });
    const objs = (listed.objects || []).sort((a, b) => (a.key < b.key ? -1 : 1));
    const overflow = objs.slice(0, Math.max(0, objs.length - keep));
    await Promise.all(overflow.map((o) => env.R2.delete(o.key)));
    console.log(`[cron] auto backup done: ${key}, pruned ${overflow.length}`);
  } else {
    await store.cleanExpiredSessions();
    await store.cleanOldAttempts();
    console.log("[cron] session/attempt cleanup done");
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
