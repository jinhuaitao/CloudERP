// 数据看板（返回纯 HTML 片段，由路由层包裹 layout）
import { esc, money, qty, fmtDT } from "../lib";
import { pageHead, statCard, badge, type ViewCtx } from "./layout";
import type { Product, SalesOrder } from "../db";

export interface DashboardStats {
  todaySales: number;
  todayOrders: number;
  monthSales: number;
  monthOrders: number;
  monthProfit: number;
  monthPurchase?: number;
  stockValue: number;
  productCount: number;
  lowCount: number;
  customerCount: number;
  pendingCommission: number;
  totalReceivable?: number;
}

export interface DashboardData {
  stats: DashboardStats;
  trend: { date: string; total: number; count: number }[];
  low: Product[];
  recent: SalesOrder[];
  top: { name: string; qty: number; amount: number }[];
  catVal?: { name: string; value: number; count: number }[];
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
  const marginPct = s.monthSales > 0 ? ((s.monthProfit / s.monthSales) * 100).toFixed(1) + "%" : "0.0%";

  const personal =
    d.personal && role === "sales"
      ? `<div class="card highlight-card">
          <div class="card-head">
            <h3>🙋 我的本月销售业绩</h3>
            <a class="btn small secondary" href="/commissions">查看佣金明细 →</a>
          </div>
          <div class="grid cols-4">
            ${statCard("🧾", "个人成交单数", `${d.personal.orderCount} 笔`, "本月已完成订单", "blue")}
            ${statCard("💰", "个人销售额", money(d.personal.total), "折后实算业绩", "green")}
            ${statCard("📈", "个人创造毛利", money(d.personal.profit), "佣金计提基数参考", "yellow")}
            ${statCard("🤝", "下级团队业绩", money(d.personal.teamTotal), `团队共 ${d.personal.teamOrderCount} 笔订单`, "purple")}
          </div>
        </div>`
      : "";

  const trendJson = esc(JSON.stringify(d.trend));
  const total14d = d.trend.reduce((acc, x) => acc + x.total, 0);
  const orders14d = d.trend.reduce((acc, x) => acc + x.count, 0);

  const catList = (d.catVal || []).slice(0, 6);
  const maxCatVal = Math.max(1, ...catList.map((c) => c.value));
  const catBars =
    catList.length > 0
      ? catList
          .map((c) => {
            const pct = Math.min(100, Math.round((c.value / maxCatVal) * 100));
            return `<div class="cat-bar-item">
              <div class="cat-bar-meta">
                <span><strong>${esc(c.name)}</strong> <span class="muted small">(${c.count}款)</span></span>
                <span class="num">${money(c.value)}</span>
              </div>
              <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
            </div>`;
          })
          .join("")
      : `<p class="muted small">暂无库存分类数据</p>`;

  const lowRows =
    d.low.length > 0
      ? d.low
          .slice(0, 6)
          .map(
            (p) =>
              `<tr>
                <td><strong>${esc(p.name)}</strong><br><span class="muted small">${esc(p.sku || "—")}</span></td>
                <td class="num neg">${qty(p.stock)} ${esc(p.unit)}</td>
                <td class="num">${qty(p.min_stock)} ${esc(p.unit)}</td>
                <td class="num"><a class="btn small primary" href="/purchase/new?product_id=${p.id}">补货</a></td>
              </tr>`
          )
          .join("")
      : `<tr><td colspan="4" class="empty-cell"><div class="empty-state"><span>🎉 库存充足，无预警商品</span></div></td></tr>`;

  const topRows =
    d.top.length > 0
      ? d.top
          .slice(0, 6)
          .map(
            (t, i) =>
              `<tr>
                <td><span class="rank-badge rank-${i + 1}">${i + 1}</span></td>
                <td><strong>${esc(t.name)}</strong></td>
                <td class="num">${qty(t.qty)}</td>
                <td class="num"><strong>${money(t.amount)}</strong></td>
              </tr>`
          )
          .join("")
      : `<tr><td colspan="4" class="empty-cell"><div class="empty-state"><span>📭 近30天暂无销售数据</span></div></td></tr>`;

  const recentRows =
    d.recent.length > 0
      ? d.recent
          .map((o) => {
            const debt = o.total - o.paid;
            return `<tr>
              <td><a href="/sales/${o.id}"><strong>${esc(o.order_no)}</strong></a></td>
              <td>${esc(o.customer_name || "散客")}</td>
              <td class="num"><strong>${money(o.total)}</strong>${debt > 0.009 ? `<br><span class="neg small">欠 ${money(debt)}</span>` : ""}</td>
              <td>${o.status === "done" ? badge("已完成", "green") : badge("已作废", "gray")}</td>
              <td class="muted small">${fmtDT(o.created_at)}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="5" class="empty-cell"><div class="empty-state"><span>📭 暂无近期销售单</span></div></td></tr>`;

  return `
    ${pageHead(
      "📊 经营数据看板",
      "实时掌握销售趋势、库存健康度、毛利水平与应收账款",
      role === "admin"
        ? `<a class="btn primary" href="/sales/new">＋ 销售开单</a>
           <a class="btn secondary" href="/purchase/new">📥 采购入库</a>
           <a class="btn secondary" href="/reports">📈 经营报表</a>`
        : `<a class="btn primary" href="/sales/new">＋ 立即开单</a>`
    )}
    ${personal}
    <div class="grid cols-4 mb">
      ${statCard("💰", "今日销售额", money(s.todaySales), `今日成交 ${s.todayOrders} 笔订单`, "green")}
      ${statCard("📅", "本月销售额", money(s.monthSales), `本月累计 ${s.monthOrders} 笔 · 采购 ${money(s.monthPurchase || 0)}`, "blue")}
      ${statCard("📈", "本月毛利润", money(s.monthProfit), `综合毛利率 ${marginPct}`, "yellow")}
      ${statCard("🏦", "库存总货值", money(s.stockValue), `在库商品共 ${s.productCount} 款`, "purple")}
    </div>
    <div class="grid cols-4 mb">
      ${statCard("⚠️", "库存预警商品", `${s.lowCount} 款`, s.lowCount > 0 ? "低于安全线，建议及时补货" : "全部商品库存健康", s.lowCount > 0 ? "red" : "green")}
      ${statCard("🧾", "客户应收欠款", money(s.totalReceivable || 0), s.totalReceivable ? "待核销挂账金额" : "全部账款已结清", (s.totalReceivable || 0) > 0 ? "red" : "blue")}
      ${statCard("👥", "活跃客户数", `${s.customerCount} 位`, "已注册正常状态客户", "green")}
      ${statCard("💸", "待结算佣金", money(s.pendingCommission), "二级分销待发提成", "yellow")}
    </div>

    <div class="grid cols-chart mb">
      <div class="card">
        <div class="card-head">
          <div>
            <h3>📊 近 14 天销售与订单趋势（北京时间）</h3>
            <p class="muted small">近 14 日累计销售额 <strong>${money(total14d)}</strong> · 共 <strong>${orders14d}</strong> 笔有效订单（悬停查看每日明细）</p>
          </div>
        </div>
        <div class="chart-box">
          <canvas id="trendChart" class="chart" data-trend='${trendJson}'></canvas>
          <div id="chartTooltip" class="chart-tooltip"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>🗂️ 分类库存资金占比</h3>
          <a class="small" href="/products">商品管理 →</a>
        </div>
        <div class="cat-bars-wrap">${catBars}</div>
      </div>
    </div>

    <div class="grid cols-3">
      <div class="card">
        <div class="card-head">
          <h3>⚠️ 急需补货预警</h3>
          <a class="small" href="/warnings">全部 (${s.lowCount}) →</a>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>商品</th><th class="num">当前</th><th class="num">安全线</th><th class="num">操作</th></tr></thead>
          <tbody>${lowRows}</tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>🔥 近 30 天热销商品 TOP</h3>
          <a class="small" href="/reports">报表 →</a>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>排名</th><th>商品</th><th class="num">销量</th><th class="num">销售额</th></tr></thead>
          <tbody>${topRows}</tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-head">
          <h3>🧾 最新销售单据</h3>
          <a class="small" href="/sales">全部 →</a>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>单号</th><th>客户</th><th class="num">金额</th><th>状态</th><th>时间</th></tr></thead>
          <tbody>${recentRows}</tbody>
        </table></div>
      </div>
    </div>`;
}
