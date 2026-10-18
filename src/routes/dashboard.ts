// 首页跳转与数据看板
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../env";
import { layout, errorPage } from "../views/layout";
import { dashboardPage } from "../views/dashboard";
import { store, pageCtx, needRoles } from "./helpers";
import { todayUTC8, utc8Range } from "../lib";

export function registerDashboard(app: Hono<AppEnv>) {
  // 首页：按登录状态与角色分流
  app.get("/", async (c) => {
    const u = c.get("user");
    if (!u) return c.redirect("/login", 302);
    if ((await store(c).countAdmins()) === 0) return c.redirect("/setup", 302);
    return c.redirect(u.role === "customer" ? "/catalog" : "/dashboard", 302);
  });

  // 数据看板（管理员 / 销售）
  app.get("/dashboard", async (c) => {
    try {
      const me = needRoles(c, ["admin", "sales"]);
      const s = store(c);
      const [stats, trend, low, recentRes, top] = await Promise.all([
        s.dashboardStats(),
        s.salesTrend(14),
        s.lowStockProducts(),
        s.listSalesOrders({ page: 1, pageSize: 5 }),
        s.topProducts(30, 8),
      ]);
      let personal: {
        orderCount: number;
        total: number;
        profit: number;
        teamOrderCount: number;
        teamTotal: number;
      } | null = null;
      if (me.role === "sales") {
        const monthStart = utc8Range(todayUTC8().slice(0, 7) + "-01").start;
        personal = await s.salesStats(me.id, monthStart, new Date().toISOString());
      }
      const ctx = pageCtx(c);
      return c.html(
        layout({
          title: "数据看板",
          ctx,
          active: "dashboard",
          content: dashboardPage(ctx, {
            stats,
            trend,
            low,
            recent: recentRes.rows,
            top,
            personal,
          }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const ctx = pageCtx(c);
      return c.html(errorPage(ctx, 500, "出错了", "加载数据看板失败：" + (e as Error).message), 500);
    }
  });
}
