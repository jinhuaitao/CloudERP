// 数据看板
import { esc, money, qty, fmtDT } from "../lib";
import { layout, pageHead, statCard, type ViewCtx } from "./layout";
import type { Product, SalesOrder } from "../db";

export interface DashboardStats {
  todaySales: number;
  todayOrders: number;
  monthSales: number;
  monthOrders: number;
  monthProfit: number;
  stockValue: number;
  productCount: number;
  lowCount: number;
  customerCount: number;
  pendingCommission: number;
}

export interface DashboardData {
  stats: DashboardStats;
  trend: { date: string; total: number; count: number }[];
  low: Product[];
  recent: SalesOrder[];
  top: { name: string; qty: number; amount: number }[];
  personal?: {
    orderCount: number;
    total: number;
    profit: number;
    teamOrderCount: number;
    teamTotal: number;
  } | null;
}

export function dashboardPage(ctx: ViewCtx, d: DashboardData): string {
  const s = d.stats;
  const role = ctx.user?.role;

  const personal =
    d.personal && role === "sales"
      ? `<div class="card"><h3>🙋 我的业绩（本月）</h3>
        <div class="grid cols-4">
          ${statCard("🧾", "我的订单数", `${d.personal.orderCount} 笔`, "", "blue")}
          ${statCard("💰", "我的销售额", money(d.personal.total), "", "green")}
          ${statCard("📈", "我的毛利润", money(d.personal.profit), "", "yellow")}
          ${statCard("🤝", "团队销售额", money(d.personal.teamTotal), `${d.personal.teamOrderCount} 笔团队订单`, "red")}
        </div></div>`
      : "";

  const trendJson = esc(JSON.stringify(d.trend));
  const trendBlock =
    d.trend.length > 0
      ? `<canvas id="trendChart" class="chart" data-trend='${trendJson}'></canvas>`
      : `<p class="muted">📭 暂无销售数据</p>`;

  const lowRows =
    d.low.length > 0
      ? d.low
          .slice(0, 8)
          .map(
            (p) =>
              `<tr><td>${esc(p.name)}</td><td class="num neg">${qty(p.stock)}</td><td class="num">${qty(p.min_stock)}</td></tr>`
          )
          .join("")
      : `<tr><td colspan="3" class="muted" align="center">🎉 库存充足，无预警商品</td></tr>`;

  const topRows =
    d.top.length > 0
      ? d.top
          .map(
            (t, i) =>
              `<tr><td>${i + 1}</td><td>${esc(t.name)}</td><td class="num">${qty(t.qty)}</td><td class="num">${money(t.amount)}</td></tr>`
          )
          .join("")
      : `<tr><td colspan="4" class="muted" align="center">📭 暂无销售数据</td></tr>`;

  const recentRows =
    d.recent.length > 0
      ? d.recent
          .map(
            (o) =>
              `<tr><td><a href="/sales/${o.id}">${esc(o.order_no)}</a></td><td>${esc(o.customer_name || "散客")}</td><td class="num">${money(o.total)}</td><td class="muted small">${fmtDT(o.created_at)}</td></tr>`
          )
          .join("")
      : `<tr><td colspan="4" class="muted" align="center">📭 暂无销售单</td></tr>`;

  const content = `
    ${pageHead("📊 数据看板", "今日经营概况一览")}
    <div class="grid cols-4 mb">
      ${statCard("💰", "今日销售额", money(s.todaySales), `今日订单 ${s.todayOrders} 笔`, "green")}
      ${statCard("📅", "本月销售额", money(s.monthSales), `本月订单 ${s.monthOrders} 笔`, "blue")}
      ${statCard("📈", "本月毛利润", money(s.monthProfit), "", "yellow")}
      ${statCard("🏦", "库存总值", money(s.stockValue), `按进价估算`, "red")}
    </div>
    <div class="grid cols-4 mb">
      ${statCard("⚠️", "库存预警", `${s.lowCount} 件`, s.lowCount > 0 ? "有商品低于安全库存" : "库存充足", s.lowCount > 0 ? "red" : "green")}
      ${statCard("📦", "商品总数", `${s.productCount} 件`, "", "blue")}
      ${statCard("👥", "客户数", `${s.customerCount} 位`, "", "green")}
      ${statCard("💸", "待结算佣金", money(s.pendingCommission), "", "yellow")}
    </div>
    ${personal}
    <div class="card">
      <h3>📊 近 14 天销售趋势</h3>
      ${trendBlock}
    </div>
    <div class="grid cols-3">
      <div class="card">
        <h3>⚠️ 库存预警 <a class="small" href="/warnings">查看全部 →</a></h3>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>商品</th><th class="num">库存</th><th class="num">安全库存</th></tr></thead>
          <tbody>${lowRows}</tbody>
        </table></div>
      </div>
      <div class="card">
        <h3>🔥 热销商品 TOP</h3>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>#</th><th>商品</th><th class="num">销量</th><th class="num">金额</th></tr></thead>
          <tbody>${topRows}</tbody>
        </table></div>
      </div>
      <div class="card">
        <h3>🧾 最近销售单 <a class="small" href="/sales">更多 →</a></h3>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>单号</th><th>客户</th><th class="num">金额</th><th>时间</th></tr></thead>
          <tbody>${recentRows}</tbody>
        </table></div>
      </div>
    </div>`;

  return layout({ title: "数据看板", ctx, active: "dashboard", content });
}
