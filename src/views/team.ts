// 客户管理 / 销售团队 / 分佣结算
import { esc, money, qty, fmtDT } from "../lib";
import {
  layout,
  pageHead,
  statCard,
  badge,
  emptyRow,
  pagerHtml,
  csrfInput,
  field,
  type ViewCtx,
} from "./layout";
import type { User, SalesOrder, Commission } from "../db";

/** 团队树节点 */
export type TeamNode = User & { children: TeamNode[] };

export interface MonthStat {
  orderCount: number;
  total: number;
  profit: number;
  teamOrderCount: number;
  teamTotal: number;
}

function tp(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

function levelBadge(level: number): string {
  return level === 2 ? badge("二级销售", "yellow") : badge("一级销售", "blue");
}

function orderStatusBadge(status: string): string {
  return status === "void" ? badge("已作废", "gray") : badge("已完成", "green");
}

// ---------- 客户列表 ----------

export interface CustomerRow extends User {
  orderCount: number;
  total: number;
  debt: number;
}

export function customerListPage(
  ctx: ViewCtx,
  d: { rows: CustomerRow[]; total: number; page: number; pageSize: number; q: string }
): string {
  const rows =
    d.rows.length > 0
      ? d.rows
          .map(
            (u) => `<tr>
              <td>${esc(u.username)}</td>
              <td><strong>${esc(u.nickname)}</strong></td>
              <td>${esc(u.phone || "—")}</td>
              <td class="num">${u.orderCount}</td>
              <td class="num">${money(u.total)}</td>
              <td class="num ${u.debt > 0 ? "neg" : ""}">${money(u.debt)}</td>
              <td class="muted small">${fmtDT(u.created_at)}</td>
              <td><a class="btn small secondary" href="/customers/${u.id}">查看</a></td>
            </tr>`
          )
          .join("")
      : emptyRow(8, "暂无客户");

  const content = `
    ${pageHead("👥 客户管理", `共 ${d.total} 位客户`)}
    <form class="toolbar" method="get" action="/customers">
      <input type="text" name="q" value="${esc(d.q)}" placeholder="🔍 用户名 / 昵称 / 电话" maxlength="64">
      <button class="btn secondary" type="submit">搜索</button>
      ${d.q ? `<a class="btn secondary" href="/customers">清除</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>用户名</th><th>昵称</th><th>电话</th><th class="num">订单数</th><th class="num">累计消费</th><th class="num">欠款</th><th>注册时间</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/customers", { q: d.q }, d.page, tp(d.total, d.pageSize))}
    </div>`;

  return layout({ title: "客户管理", ctx, active: "customers", content });
}

// ---------- 客户详情 ----------

export function customerDetailPage(
  ctx: ViewCtx,
  d: {
    user: User;
    stats: { orderCount: number; total: number; paid: number; debt: number };
    orders: SalesOrder[];
  }
): string {
  const u = d.user;
  const st = d.stats;
  const orders =
    d.orders.length > 0
      ? d.orders
          .map(
            (o) => `<tr>
              <td><a href="/sales/${o.id}">${esc(o.order_no)}</a></td>
              <td class="num">${money(o.total)}</td>
              <td class="num">${money(o.paid)}</td>
              <td>${orderStatusBadge(o.status)}</td>
              <td class="muted small">${fmtDT(o.created_at)}</td>
            </tr>`
          )
          .join("")
      : emptyRow(5, "该客户暂无订单");

  const content = `
    ${pageHead(`👤 ${u.nickname}`, `客户详情 · @${u.username}`, `<a class="btn secondary" href="/customers">← 返回列表</a>`)}
    <div class="card"><h3>📇 基本信息 ${u.status === "active" ? badge("正常", "green") : badge("已禁用", "gray")}</h3>
      <dl class="kv">
        <dt>用户名</dt><dd>${esc(u.username)}</dd>
        <dt>昵称</dt><dd>${esc(u.nickname)}</dd>
        <dt>电话</dt><dd>${esc(u.phone || "—")}</dd>
        <dt>邮箱</dt><dd>${esc(u.email || "—")}</dd>
        <dt>赊账额度</dt><dd>${money(u.credit_limit)}</dd>
        <dt>注册时间</dt><dd>${fmtDT(u.created_at)}</dd>
      </dl>
    </div>
    <div class="grid cols-4 mb">
      ${statCard("🧾", "订单数", `${st.orderCount} 笔`, "", "blue")}
      ${statCard("💰", "累计消费", money(st.total), "", "green")}
      ${statCard("✅", "已付款", money(st.paid), "", "yellow")}
      ${statCard("⚠️", "欠款", money(st.debt), st.debt > 0 ? "有未结清款项" : "无欠款", st.debt > 0 ? "red" : "green")}
    </div>
    <div class="card"><h3>🧾 历史订单</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>单号</th><th class="num">金额</th><th class="num">实收</th><th>状态</th><th>时间</th></tr></thead>
        <tbody>${orders}</tbody>
      </table></div>
    </div>`;

  return layout({ title: `客户 ${u.nickname}`, ctx, active: "customers", content });
}

// ---------- 销售团队 ----------

function renderTeamNode(n: TeamNode, stats: Record<number, MonthStat>, canAdd: boolean): string {
  const st: MonthStat = stats[n.id] || { orderCount: 0, total: 0, profit: 0, teamOrderCount: 0, teamTotal: 0 };
  const kids = n.children.map((c) => renderTeamNode(c, stats, canAdd)).join("");
  const rate = n.commission_rate > 0 ? `${n.commission_rate}%` : "系统默认";
  return `<div class="team-node">
    <div class="head">
      <div class="avatar">${esc((n.nickname || n.username).slice(0, 1))}</div>
      <div>
        <div><strong>${esc(n.nickname)}</strong> <span class="muted small">@${esc(n.username)}</span> ${levelBadge(n.sales_level)}</div>
        <div class="meta">📞 ${esc(n.phone || "—")} · 分佣 ${esc(rate)} · 本月 ${st.orderCount} 单 / ${money(st.total)}${
          n.sales_level === 1 ? ` · 团队 ${st.teamOrderCount} 单 / ${money(st.teamTotal)}` : ""
        } · 下级 ${n.children.length} 人</div>
      </div>
      <div class="btn-row">${
        canAdd && n.sales_level === 1
          ? `<a class="btn small secondary" href="/team/new?parent=${n.id}">➕ 新增下级</a>`
          : ""
      }</div>
    </div>
    ${kids ? `<div class="children">${kids}</div>` : ""}
  </div>`;
}

export function teamPage(
  ctx: ViewCtx,
  d: {
    tree: TeamNode[];
    monthStats: Record<number, MonthStat>;
    canAdd: boolean;
    isAdmin: boolean;
  }
): string {
  const isSales = ctx.user?.role === "sales";
  const title = isSales ? "🤝 我的团队" : "🤝 销售团队";
  const tree =
    d.tree.length > 0
      ? d.tree.map((n) => renderTeamNode(n, d.monthStats, d.canAdd)).join("")
      : `<div class="card"><p class="muted" align="center">📭 暂无销售员${d.canAdd ? "，点击右上角新增" : ""}</p></div>`;

  const content = `
    ${pageHead(title, "一级销售可发展二级销售，二级出单时上级获得管理津贴", d.canAdd ? `<a class="btn primary" href="/team/new">➕ 新增销售员</a>` : "")}
    ${tree}`;

  return layout({ title: isSales ? "我的团队" : "销售团队", ctx, active: "team", content });
}

// ---------- 新增销售员 ----------

export function salesFormPage(
  ctx: ViewCtx,
  d: { parents: User[]; fixedParent?: User | null; preselectParent?: string }
): string {
  const levelBlock = d.fixedParent
    ? `<div class="field"><label>级别</label><div>二级销售（上级：<strong>${esc(d.fixedParent.nickname)}</strong> @${esc(d.fixedParent.username)}）</div>
        <input type="hidden" name="level" value="2">
        <input type="hidden" name="parent_id" value="${d.fixedParent.id}">
      </div>`
    : `${field(
        "级别",
        `<select name="level" data-role="sales-level">
          <option value="1">一级销售（可发展下级）</option>
          <option value="2">二级销售（需指定上级）</option>
        </select>`,
        "",
        true
      )}
      <div id="parentRow">
        ${field(
          "上级销售",
          `<select name="parent_id">
            <option value="">请选择上级</option>
            ${d.parents.map((p) => `<option value="${p.id}"${d.preselectParent === String(p.id) ? " selected" : ""}>${esc(p.nickname)}（${esc(p.username)}）</option>`).join("")}
          </select>`,
          "二级销售必须指定一位一级销售作为上级",
          true
        )}
      </div>`;

  const content = `
    ${pageHead("➕ 新增销售员", d.fixedParent ? `为 ${d.fixedParent.nickname} 新增下级销售` : "创建一级 / 二级销售账号", `<a class="btn secondary" href="/team">← 返回团队</a>`)}
    <div class="card">
      <form method="post" action="/team/new">
        ${csrfInput(ctx.csrf)}
        ${field("用户名", `<input type="text" name="username" required minlength="3" maxlength="32" autocomplete="off" placeholder="3-32 位">`, "", true)}
        ${field("登录密码", `<input type="password" name="password" required minlength="6" maxlength="64" autocomplete="new-password" placeholder="至少 6 位">`, "", true)}
        ${field("昵称", `<input type="text" name="nickname" maxlength="32" placeholder="用于界面显示">`)}
        ${field("电话", `<input type="tel" name="phone" maxlength="20">`)}
        ${levelBlock}
        ${field("分佣比例（%）", `<input type="number" name="commission_rate" min="0" max="100" step="0.01" placeholder="留空用系统默认">`, "个人专属比例；留空则使用系统设置中的默认比例")}
        <div class="btn-row">
          <button class="btn primary" type="submit">✅ 创建销售员</button>
          <a class="btn secondary" href="/team">取消</a>
        </div>
      </form>
    </div>`;

  return layout({ title: "新增销售员", ctx, active: "team", content });
}

// ---------- 分佣结算 ----------

export function commissionPage(
  ctx: ViewCtx,
  d: {
    rows: Commission[];
    total: number;
    page: number;
    pageSize: number;
    summary: { pending: number; settled: number };
    salesTeam: User[];
    f: { salesId: string; status: string };
    canSettle: boolean;
  }
): string {
  const isSales = ctx.user?.role === "sales";
  const salesOptions = [`<option value="">全部销售员</option>`]
    .concat(
      d.salesTeam.map(
        (u) => `<option value="${u.id}"${d.f.salesId === String(u.id) ? " selected" : ""}>${esc(u.nickname)}（${esc(u.username)}）</option>`
      )
    )
    .join("");
  const statusOptions = [`<option value="">全部状态</option>`, `<option value="pending"${d.f.status === "pending" ? " selected" : ""}>待结算</option>`, `<option value="settled"${d.f.status === "settled" ? " selected" : ""}>已结算</option>`].join("");

  const rows =
    d.rows.length > 0
      ? d.rows
          .map(
            (c) => `<tr>
              <td class="small">${esc(c.order_no || `#${c.order_id}`)}</td>
              <td>${esc(c.sales_name || "—")}</td>
              <td>${c.level === 2 ? badge("二级", "yellow") : badge("一级", "blue")}</td>
              <td class="num">${money(c.base_amount)}</td>
              <td class="num">${qty(c.rate)}%</td>
              <td class="num"><strong>${money(c.amount)}</strong></td>
              <td>${c.status === "pending" ? badge("待结算", "yellow") : badge("已结算", "green")}</td>
              <td>${
                d.canSettle && c.status === "pending"
                  ? `<form class="inline-form" method="post" action="/commissions/${c.id}/settle">${csrfInput(ctx.csrf)}<button class="btn small success" type="submit">结算</button></form>`
                  : `<span class="muted small">—</span>`
              }</td>
            </tr>`
          )
          .join("")
      : emptyRow(8, "暂无佣金记录");

  const settleAll = d.canSettle
    ? `<form class="inline-form" method="post" action="/commissions/settle-all" data-confirm="确定将全部待结算佣金标记为已结算吗？">${csrfInput(ctx.csrf)}<button class="btn success" type="submit">💰 一键结算全部待结算</button></form>`
    : "";

  const content = `
    ${pageHead(isSales ? "💰 我的佣金" : "💰 分佣结算", "订单完成后按规则自动生成佣金", settleAll)}
    <div class="grid cols-2 mb">
      ${statCard("⏳", "待结算佣金", money(d.summary.pending), "可结算", "yellow")}
      ${statCard("✅", "已结算佣金", money(d.summary.settled), "累计", "green")}
    </div>
    <form class="toolbar" method="get" action="/commissions">
      ${isSales ? "" : `<select name="salesId">${salesOptions}</select>`}
      <select name="status">${statusOptions}</select>
      <button class="btn secondary" type="submit">筛选</button>
      <a class="btn secondary" href="/commissions">清除</a>
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>订单号</th><th>销售员</th><th>层级</th><th class="num">基数</th><th class="num">比例</th><th class="num">金额</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/commissions", { salesId: d.f.salesId, status: d.f.status }, d.page, tp(d.total, d.pageSize))}
    </div>`;

  return layout({ title: isSales ? "我的佣金" : "分佣结算", ctx, active: "commissions", content });
}
