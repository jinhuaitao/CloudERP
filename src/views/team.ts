// 客户管理 / 销售团队 / 分佣结算（返回纯 HTML 片段，由路由层包裹 layout）
import { esc, money, qty, fmtDT } from "../lib";
import {
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
  return level === 2 ? badge("二级分销员", "yellow") : badge("一级分销主管", "blue");
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
  const isAdmin = ctx.user?.role === "admin";
  const rows =
    d.rows.length > 0
      ? d.rows
          .map(
            (u) => `<tr>
              <td><strong>${esc(u.nickname)}</strong><div class="muted small">@${esc(u.username)}</div></td>
              <td>${esc(u.phone || "—")}<div class="muted small">${esc(u.email || "")}</div></td>
              <td class="num">${u.orderCount} 笔</td>
              <td class="num"><strong>${money(u.total)}</strong></td>
              <td class="num">${u.credit_limit > 0 ? money(u.credit_limit) : `<span class="muted">不可赊账</span>`}</td>
              <td class="num ${u.debt > 0 ? "neg" : "muted"}"><strong>${u.debt > 0 ? money(u.debt) : "¥0.00"}</strong></td>
              <td class="muted small">${fmtDT(u.created_at)}</td>
              <td>
                <div class="btn-row">
                  <a class="btn small secondary" href="/customers/${u.id}">对账详情</a>
                  ${isAdmin ? `<a class="btn small secondary" href="/users/${u.id}/edit">授信设置</a>` : ""}
                </div>
              </td>
            </tr>`
          )
          .join("")
      : emptyRow(8, "暂无客户档案");

  return `
    ${pageHead("👥 客户档案与往来对账", `共 ${d.total} 位客户 · 实时跟踪累计消费、授信额度与待收挂账`, isAdmin ? `<a class="btn primary" href="/users/new">＋ 新增客户账号</a>` : "")}
    <form class="toolbar" method="get" action="/customers">
      <input type="text" name="q" value="${esc(d.q)}" placeholder="🔍 搜索客户名称 / 用户名 / 联系电话..." maxlength="64" class="grow">
      <button class="btn primary" type="submit">搜索</button>
      ${d.q ? `<a class="btn secondary" href="/customers">重置</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>客户名称 / 账号</th><th>联系方式</th><th class="num">成交单数</th><th class="num">累计消费额</th><th class="num">授信额度</th><th class="num">当前欠款</th><th>注册时间</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/customers", { q: d.q }, d.page, tp(d.total, d.pageSize))}
    </div>`;
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
  const isAdmin = ctx.user?.role === "admin";
  const remainCredit = u.credit_limit > 0 ? Math.max(0, u.credit_limit - st.debt) : 0;

  const orders =
    d.orders.length > 0
      ? d.orders
          .map((o) => {
            const oDebt = o.total - o.paid;
            return `<tr>
              <td><a href="/sales/${o.id}"><strong>${esc(o.order_no)}</strong></a></td>
              <td class="num">${money(o.total)}</td>
              <td class="num pos">${money(o.paid)}</td>
              <td class="num ${oDebt > 0.009 ? "neg" : "muted"}">${oDebt > 0.009 ? money(oDebt) : "已结清"}</td>
              <td>${orderStatusBadge(o.status)}</td>
              <td class="muted small">${fmtDT(o.created_at)}</td>
              <td><a class="btn small secondary" href="/sales/${o.id}">${oDebt > 0.009 && o.status === "done" ? "💳 去收款" : "查看"}</a></td>
            </tr>`;
          })
          .join("")
      : emptyRow(7, "该客户暂无历史订单");

  return `
    ${pageHead(
      `👤 客户往来账目：${u.nickname}`,
      `登录账号：@${u.username}`,
      `${isAdmin ? `<a class="btn secondary" href="/users/${u.id}/edit">⚙️ 调整授信额度</a>` : ""}
       <a class="btn secondary" href="/customers">← 返回客户列表</a>`
    )}
    <div class="grid cols-4 mb">
      ${statCard("🧾", "有效订单总数", `${st.orderCount} 笔`, "历史累计成交", "blue")}
      ${statCard("💰", "累计消费总额", money(st.total), "折后应收总计", "green")}
      ${statCard("✅", "累计已回款", money(st.paid), "实收总金额", "yellow")}
      ${statCard("⚠️", "当前挂账欠款", money(st.debt), u.credit_limit > 0 ? `授信额度 ${money(u.credit_limit)} · 剩余可用 ${money(remainCredit)}` : "未开通赊账额度", st.debt > 0 ? "red" : "green")}
    </div>
    <div class="card"><h3>📇 客户档案信息 ${u.status === "active" ? badge("正常", "green") : badge("已禁用", "gray")}</h3>
      <dl class="kv kv-grid">
        <div><dt>客户名称</dt><dd><strong>${esc(u.nickname)}</strong></dd></div>
        <div><dt>登录账号</dt><dd>@${esc(u.username)}</dd></div>
        <div><dt>联系电话</dt><dd>${esc(u.phone || "—")}</dd></div>
        <div><dt>电子邮箱</dt><dd>${esc(u.email || "—")}</dd></div>
        <div><dt>授信额度上限</dt><dd><strong>${money(u.credit_limit)}</strong></dd></div>
        <div><dt>注册建档时间</dt><dd>${fmtDT(u.created_at)}</dd></div>
      </dl>
    </div>
    <div class="card"><h3>🧾 客户历史订单明细（点击未结清订单可登记补收款）</h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>销售单号</th><th class="num">应收金额</th><th class="num">已收金额</th><th class="num">待收欠款</th><th>状态</th><th>下单时间</th><th>操作</th></tr></thead>
        <tbody>${orders}</tbody>
      </table></div>
    </div>`;
}

// ---------- 销售团队 ----------

function renderTeamNode(n: TeamNode, stats: Record<number, MonthStat>, canAdd: boolean): string {
  const st: MonthStat = stats[n.id] || { orderCount: 0, total: 0, profit: 0, teamOrderCount: 0, teamTotal: 0 };
  const kids = n.children.map((c) => renderTeamNode(c, stats, canAdd)).join("");
  const rate = n.commission_rate > 0 ? `专属 ${n.commission_rate}%` : "按系统默认比例";
  return `<div class="team-node">
    <div class="head">
      <div class="avatar">${esc((n.nickname || n.username).slice(0, 1).toUpperCase())}</div>
      <div class="team-info">
        <div class="team-name-row">
          <strong>${esc(n.nickname)}</strong>
          <span class="muted small">@${esc(n.username)}</span>
          ${levelBadge(n.sales_level)}
          <span class="badge gray">提成：${esc(rate)}</span>
        </div>
        <div class="meta">
          <span>📞 ${esc(n.phone || "未填电话")}</span>
          <span>· 本月个人业绩：<strong>${st.orderCount} 单 / ${money(st.total)}</strong>（毛利 ${money(st.profit)}）</span>
          ${
            n.sales_level === 1
              ? `<span>· 下属团队业绩：<strong>${st.teamOrderCount} 单 / ${money(st.teamTotal)}</strong>（直属下级 ${n.children.length} 人）</span>`
              : ""
          }
        </div>
      </div>
      <div class="btn-row">${
        canAdd && n.sales_level === 1
          ? `<a class="btn small secondary" href="/team/new?parent=${n.id}">➕ 新增下属二级</a>`
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
  const title = isSales ? "🤝 我的分销团队架构" : "🤝 二级销售团队管理";
  const tree =
    d.tree.length > 0
      ? d.tree.map((n) => renderTeamNode(n, d.monthStats, d.canAdd)).join("")
      : `<div class="card"><div class="empty-state"><span class="empty-ico">🌳</span><span>暂无销售团队成员${d.canAdd ? "，请点击右上角新增" : ""}</span></div></div>`;

  return `
    ${pageHead(
      title,
      "一级分销主管可发展二级分销员；二级开单时自动拆算个人销售佣金与上级管理津贴",
      d.canAdd ? `<a class="btn primary" href="/team/new">➕ 新增销售员</a>` : ""
    )}
    ${tree}`;
}

// ---------- 新增销售员 ----------

export function salesFormPage(
  ctx: ViewCtx,
  d: { parents: User[]; fixedParent?: User | null; preselectParent?: string }
): string {
  const levelBlock = d.fixedParent
    ? `<div class="field"><label>分销层级</label>
        <div class="secq-prompt">二级分销员（直属上级主管：<strong>${esc(d.fixedParent.nickname)}</strong> @${esc(d.fixedParent.username)}）</div>
        <input type="hidden" name="level" value="2">
        <input type="hidden" name="parent_id" value="${d.fixedParent.id}">
      </div>`
    : `<div class="form-row">
        ${field(
          "分销级别",
          `<select name="level" data-role="sales-level">
            <option value="1"${!d.preselectParent ? " selected" : ""}>一级分销主管（可发展二级下属）</option>
            <option value="2"${d.preselectParent ? " selected" : ""}>二级分销员（需挂靠一级主管）</option>
          </select>`,
          "",
          true
        )}
        <div id="parentRow">
          ${field(
            "直属上级（一级销售主管）",
            `<select name="parent_id">
              <option value="">— 请选择上级一级销售 —</option>
              ${d.parents
                .map(
                  (p) =>
                    `<option value="${p.id}"${d.preselectParent === String(p.id) ? " selected" : ""}>${esc(
                      p.nickname
                    )}（@${esc(p.username)}）</option>`
                )
                .join("")}
            </select>`,
            "二级销售出单时，该上级将自动获得管理津贴",
            true
          )}
        </div>
      </div>`;

  return `
    ${pageHead("➕ 新增销售团队成员", d.fixedParent ? `为 ${d.fixedParent.nickname} 招募下级二级分销员` : "开通一级分销主管或二级分销员账号", `<a class="btn secondary" href="/team">← 返回销售团队</a>`)}
    <div class="card">
      <form method="post" action="/team/new">
        ${csrfInput(ctx.csrf)}
        <div class="form-row">
          ${field("登录用户名", `<input type="text" name="username" required minlength="3" maxlength="32" autocomplete="off" placeholder="3-32 位字母/数字">`, "", true)}
          ${field("初始登录密码", `<input type="password" name="password" required minlength="6" maxlength="64" autocomplete="new-password" placeholder="至少 6 位">`, "", true)}
        </div>
        <div class="form-row">
          ${field("姓名 / 昵称", `<input type="text" name="nickname" required maxlength="32" placeholder="用于订单与团队报表展示">`, "", true)}
          ${field("手机号码", `<input type="tel" name="phone" maxlength="20" placeholder="选填，便于团队联络">`)}
        </div>
        ${levelBlock}
        ${field("个人专属分佣比例（%）", `<input type="number" name="commission_rate" min="0" max="100" step="0.01" placeholder="留空或填 0 则使用系统设置中的默认比例">`, "如单独设置专属比例，将优先于系统默认比例计算提成")}
        <div class="btn-row mt">
          <button class="btn primary" type="submit">✅ 确认创建销售账号</button>
          <a class="btn secondary" href="/team">取消</a>
        </div>
      </form>
    </div>`;
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
        (u) =>
          `<option value="${u.id}"${d.f.salesId === String(u.id) ? " selected" : ""}>${esc(u.nickname)}（@${esc(
            u.username
          )}）</option>`
      )
    )
    .join("");
  const statusOptions = [
    `<option value="">全部结算状态</option>`,
    `<option value="pending"${d.f.status === "pending" ? " selected" : ""}>待结算</option>`,
    `<option value="settled"${d.f.status === "settled" ? " selected" : ""}>已结算</option>`,
  ].join("");

  const rows =
    d.rows.length > 0
      ? d.rows
          .map(
            (c) => `<tr>
              <td><a href="/sales/${c.order_id}"><strong>${esc(c.order_no || `#${c.order_id}`)}</strong></a></td>
              <td><strong>${esc(c.sales_name || "—")}</strong></td>
              <td>${c.level === 2 ? badge("二级销售提成", "yellow") : badge("一级提成/津贴", "blue")}</td>
              <td class="num">${money(c.base_amount)}</td>
              <td class="num">${qty(c.rate)}%</td>
              <td class="num"><strong class="pos">${money(c.amount)}</strong></td>
              <td>${c.status === "pending" ? badge("待结算", "yellow") : badge("已结算", "green")}</td>
              <td class="muted small">${fmtDT(c.created_at)}</td>
              <td>${
                d.canSettle && c.status === "pending"
                  ? `<form class="inline-form" method="post" action="/commissions/${c.id}/settle">${csrfInput(ctx.csrf)}<button class="btn small success" type="submit">结算发放</button></form>`
                  : `<span class="muted small">—</span>`
              }</td>
            </tr>`
          )
          .join("")
      : emptyRow(9, "暂无符合条件的分佣记录");

  const settleAll =
    d.canSettle && d.summary.pending > 0
      ? `<form class="inline-form" method="post" action="/commissions/settle-all" data-confirm="确定将当前筛选范围内的待结算佣金（共 ${money(d.summary.pending)}）全部标记为已结算吗？">
          ${csrfInput(ctx.csrf)}
          <input type="hidden" name="salesId" value="${esc(d.f.salesId)}">
          <button class="btn success" type="submit">💰 一键结算待发佣金 (${money(d.summary.pending)})</button>
        </form>`
      : "";

  return `
    ${pageHead(isSales ? "💰 我的佣金收益明细" : "💰 二级分销佣金结算中心", "销售单完成后自动按规则计提，销售单作废时自动冲销待结算佣金", settleAll)}
    <div class="grid cols-2 mb">
      ${statCard("⏳", "待结算佣金总额", money(d.summary.pending), "等待财务核准发放", "yellow")}
      ${statCard("✅", "已结算累计佣金", money(d.summary.settled), "历史已发放提成总额", "green")}
    </div>
    <form class="toolbar" method="get" action="/commissions">
      ${isSales ? "" : `<select name="sales_id">${salesOptions}</select>`}
      <select name="status">${statusOptions}</select>
      <button class="btn primary" type="submit">筛选</button>
      ${d.f.salesId || d.f.status ? `<a class="btn secondary" href="/commissions">重置</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>关联销售单</th><th>收益销售员</th><th>分佣类型</th><th class="num">核算基数</th><th class="num">计提比例</th><th class="num">佣金金额</th><th>状态</th><th>生成时间</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/commissions", { sales_id: d.f.salesId, status: d.f.status }, d.page, tp(d.total, d.pageSize))}
    </div>`;
}
