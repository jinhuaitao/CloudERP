// 经营报表 / 用户管理 / 个人中心（含收货信息设置） / 系统设置（含微信与支付宝收款二维码设置） / 数据维护 / 操作日志
import { esc, money, fmtDT, round2 } from "../lib";
import {
  pageHead,
  statCard,
  badge,
  emptyRow,
  pagerHtml,
  csrfInput,
  field,
  roleName,
  type ViewCtx,
} from "./layout";
import type { User } from "../db";
import { fileUrl } from "./products";

function tp(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

function statusBadge(status: string): string {
  return status === "active" ? badge("正常", "green") : badge("已禁用", "gray");
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ================= 经营报表 =================

export interface ReportData {
  from: string;
  to: string;
  purchaseTotal: number;
  salesTotal: number;
  salesPaid?: number;
  profit: number;
  returnTotal: number;
  commissionTotal?: number;
  orderCount: number;
}

export function reportPage(ctx: ViewCtx, d: ReportData): string {
  const q = `from=${encodeURIComponent(d.from)}&to=${encodeURIComponent(d.to)}`;
  const salesPaid = d.salesPaid ?? d.salesTotal;
  const unpaid = round2(Math.max(0, d.salesTotal - salesPaid));
  const marginPct = d.salesTotal > 0 ? ((d.profit / d.salesTotal) * 100).toFixed(1) + "%" : "0.0%";
  const netProfit = round2(d.profit - (d.commissionTotal || 0));

  const exports = [
    { t: "sales", label: "📤 导出销售单明细 (.csv)" },
    { t: "purchase", label: "📥 导出进货单明细 (.csv)" },
    { t: "movements", label: "🧾 导出库存流水台账 (.csv)" },
    { t: "products", label: "📦 导出全量商品库存表 (.csv)" },
  ]
    .map((e) => `<a class="btn secondary" href="/reports/export?type=${e.t}&${q}">${e.label}</a>`)
    .join("");

  return `
    ${pageHead("📈 财务与经营汇总报表", `核算区间：${d.from} 至 ${d.to}（东八区标准时间）`)}
    <form class="toolbar" method="get" action="/reports">
      <label class="muted">起始日期：</label>
      <input type="date" name="from" value="${esc(d.from)}">
      <span class="muted">至</span>
      <input type="date" name="to" value="${esc(d.to)}">
      <button class="btn primary" type="submit">📊 重新统计</button>
    </form>
    <div class="grid cols-4 mb">
      ${statCard("📤", "区间销售总额", money(d.salesTotal), `共成交 ${d.orderCount} 笔有效销售单`, "green")}
      ${statCard("✅", "销售实收回款", money(salesPaid), unpaid > 0 ? `区间新增挂账 ${money(unpaid)}` : "区间订单100%回款", "blue")}
      ${statCard("📈", "销售毛利润", money(d.profit), `扣减折扣后毛利率 ${marginPct}`, "yellow")}
      ${statCard("💎", "扣除佣金后净毛利", money(netProfit), `区间计提分销佣金 ${money(d.commissionTotal || 0)}`, "purple")}
    </div>
    <div class="grid cols-2 mb">
      ${statCard("📥", "区间采购进货总额", money(d.purchaseTotal), "已完成入库的采购单合计", "blue")}
      ${statCard("↩️", "区间销售退货总额", money(d.returnTotal), "已完成退货入库的冲销总额", "red")}
    </div>
    <div class="card">
      <h3>📥 财务数据报表导出（含 UTF-8 BOM 头，Excel 直接打开不乱码）</h3>
      <p class="muted small mb">所有导出文件已内置 CSV 公式注入防护，日期范围与上方所选统计周期保持一致。</p>
      <div class="btn-row">${exports}</div>
    </div>`;
}

// ================= 用户管理 =================

export function userListPage(
  ctx: ViewCtx,
  d: { rows: User[]; total: number; page: number; pageSize: number; q: string; role?: string }
): string {
  const roleBadge = (r: string): string =>
    r === "admin" ? badge(roleName(r), "blue") : r === "sales" ? badge(roleName(r), "green") : badge(roleName(r), "gray");

  const roleOptions = [
    `<option value="">全部角色</option>`,
    `<option value="admin"${d.role === "admin" ? " selected" : ""}>管理员</option>`,
    `<option value="sales"${d.role === "sales" ? " selected" : ""}>销售员</option>`,
    `<option value="customer"${d.role === "customer" ? " selected" : ""}>客户</option>`,
  ].join("");

  const rows =
    d.rows.length > 0
      ? d.rows
          .map((u) => {
            const isSelf = ctx.user?.id === u.id;
            return `<tr>
              <td><strong>${esc(u.username)}</strong></td>
              <td>${esc(u.nickname)}${u.role === "customer" && u.address ? `<div class="muted small">📍 ${esc(u.address)}</div>` : ""}</td>
              <td>${roleBadge(u.role)}</td>
              <td>${
                u.role === "sales"
                  ? u.sales_level === 2
                    ? badge("二级销售", "yellow")
                    : badge("一级主管", "blue")
                  : u.role === "customer" && u.credit_limit > 0
                    ? `<span class="small muted">授信 ${money(u.credit_limit)}</span>`
                    : "—"
              }</td>
              <td>${esc(u.phone || "—")}</td>
              <td>${statusBadge(u.status)}</td>
              <td><div class="btn-row">
                <a class="btn small secondary" href="/users/${u.id}/edit">编辑</a>
                ${
                  isSelf
                    ? `<span class="badge gray">当前账号</span>`
                    : `<form class="inline-form" method="post" action="/users/${u.id}/toggle" data-confirm="确定${
                        u.status === "active" ? "禁用" : "启用"
                      }用户「${esc(u.username)}」吗？">${csrfInput(ctx.csrf)}<button class="btn small ${
                        u.status === "active" ? "danger" : "success"
                      }" type="submit">${u.status === "active" ? "禁用" : "启用"}</button></form>`
                }
                <form class="inline-edit-form" method="post" action="/users/${u.id}/reset-password">
                  ${csrfInput(ctx.csrf)}
                  <input type="password" name="new_password" required minlength="6" maxlength="64" placeholder="输入新密码(≥6位)" autocomplete="new-password" style="width:135px">
                  <button class="btn small secondary" type="submit">重置密码</button>
                </form>
              </div></td>
            </tr>`;
          })
          .join("")
      : emptyRow(7, "暂无符合条件的用户");

  return `
    ${pageHead("👤 系统用户与权限管理", `共 ${d.total} 个账户 · 支持管理员、一/二级销售员与客户分级管控`, `<a class="btn primary" href="/users/new">＋ 新建用户</a>`)}
    <form class="toolbar" method="get" action="/users">
      <input type="text" name="q" value="${esc(d.q)}" placeholder="🔍 搜索用户名 / 昵称 / 电话 / 收货地址..." maxlength="64" class="grow">
      <select name="role">${roleOptions}</select>
      <button class="btn primary" type="submit">搜索</button>
      ${d.q || d.role ? `<a class="btn secondary" href="/users">重置</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>用户名</th><th>昵称 / 收货地址</th><th>系统角色</th><th>级别 / 授信</th><th>电话</th><th>状态</th><th>管理操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/users", { q: d.q, role: d.role || "" }, d.page, tp(d.total, d.pageSize))}
    </div>`;
}

export interface UserFormData {
  user?: User | null;
  salesTeam: User[];
}

export function userFormPage(ctx: ViewCtx, d: UserFormData): string {
  const u = d.user || null;
  const isNew = !u;
  const action = isNew ? "/users" : `/users/${u!.id}`;
  const v = (x: unknown): string => esc(x ?? "");
  const parents = d.salesTeam.filter((p) => !u || p.id !== u.id);

  return `
    ${pageHead(isNew ? "＋ 新建系统用户" : "✏️ 编辑用户权限与资料", u ? `@${u.username}（${roleName(u.role)}）` : "配置用户角色、分销层级或客户收货与授信档案", `<a class="btn secondary" href="/users">← 返回用户列表</a>`)}
    <div class="card">
      <form method="post" action="${action}">
        ${csrfInput(ctx.csrf)}
        <div class="form-row">
          ${
            isNew
              ? field("登录用户名", `<input type="text" name="username" required minlength="3" maxlength="32" autocomplete="off" placeholder="3-32 位字符">`, "", true)
              : field("登录用户名", `<input type="text" value="${v(u!.username)}" disabled>`, "用户名创建后不可更改")
          }
          ${field(
            "登录密码",
            `<input type="password" name="password" ${isNew ? "required" : ""} minlength="6" maxlength="64" autocomplete="new-password" placeholder="${isNew ? "至少 6 位" : "留空则保持原密码不变"}">`,
            isNew ? "" : "修改密码后将自动强制该用户所有已登录设备重新登录",
            isNew
          )}
        </div>
        <div class="form-row cols-3">
          ${field("显示昵称 / 客户名", `<input type="text" name="nickname" maxlength="32" value="${v(u?.nickname)}" required>`, "", true)}
          ${field("联系电话", `<input type="tel" name="phone" maxlength="20" value="${v(u?.phone)}" placeholder="手机号或座机">`)}
          ${field("电子邮箱", `<input type="email" name="email" maxlength="100" value="${v(u?.email)}">`)}
        </div>
        <div class="form-row">
          ${field(
            "系统角色",
            `<select id="roleSelect" name="role">
              <option value="admin"${u?.role === "admin" ? " selected" : ""}>管理员（全权管理）</option>
              <option value="sales"${!u || u?.role === "sales" ? " selected" : ""}>销售员（开单/分销/客户）</option>
              <option value="customer"${u?.role === "customer" ? " selected" : ""}>客户（浏览画册/自助订货）</option>
            </select>`,
            "",
            true
          )}
          ${field(
            "账号状态",
            `<select name="status">
              <option value="active"${!u || u?.status === "active" ? " selected" : ""}>正常启用</option>
              <option value="disabled"${u?.status === "disabled" ? " selected" : ""}>禁用封停（立即踢出所有会话）</option>
            </select>`
          )}
        </div>
        <div data-show-for="sales" class="role-extra-panel">
          <h3>💼 二级分销体系配置 <span class="muted small">（仅当角色为「销售员」时生效）</span></h3>
          <div class="form-row">
            ${field(
              "销售层级",
              `<select name="sales_level" data-role="sales-level">
                <option value="1"${!u || u?.sales_level !== 2 ? " selected" : ""}>一级分销主管（可发展下级）</option>
                <option value="2"${u?.sales_level === 2 ? " selected" : ""}>二级分销员（需绑定一级上级）</option>
              </select>`
            )}
            ${field("个人专属分佣比例（%）", `<input type="number" name="commission_rate" min="0" max="100" step="0.01" value="${v(u?.commission_rate || "")}" placeholder="0 或留空表示使用系统默认比例">`)}
          </div>
          <div id="parentRow">
            ${field(
              "直属上级（一级销售主管）",
              `<select name="parent_id"><option value="">— 请选择上级一级销售 —</option>${parents
                .map(
                  (p) =>
                    `<option value="${p.id}"${u?.parent_id === p.id ? " selected" : ""}>${esc(p.nickname)}（@${esc(
                      p.username
                    )}）</option>`
                )
                .join("")}</select>`,
              "二级销售出单时，其绑定的上级自动获得管理津贴"
            )}
          </div>
        </div>
        <div data-show-for="customer" class="role-extra-panel">
          <h3>📍 客户收货信息与授信风控配置 <span class="muted small">（仅当角色为「客户」时生效）</span></h3>
          <div class="form-row">
            ${field("默认收货人姓名", `<input type="text" name="shipping_name" maxlength="32" value="${v(u?.shipping_name)}" placeholder="默认同客户昵称">`)}
            ${field("最大允许赊账额度（元）", `<input type="number" name="credit_limit" min="0" step="0.01" value="${v(u?.credit_limit ?? 0)}">`, "当客户累计欠款超过此额度时自动拦截赊销")}
          </div>
          ${field("默认收货详细地址", `<input type="text" name="address" maxlength="200" value="${v(u?.address)}" placeholder="省 / 市 / 区 / 街道详细门牌号">`)}
        </div>
        <div class="btn-row mt">
          <button class="btn primary" type="submit">${isNew ? "✅ 创建用户" : "💾 保存修改"}</button>
          <a class="btn secondary" href="/users">取消</a>
        </div>
      </form>
    </div>`;
}

// ================= 个人中心（含客户收货信息专属设置卡片） =================

export interface SessionInfo {
  id: string;
  created_at: string;
  expires_at: string;
  ip: string;
  ua: string;
}

export function profilePage(
  ctx: ViewCtx,
  d: { user: User; sessions: SessionInfo[]; currentDigest: string; hasSecQ: boolean; onboarding?: boolean }
): string {
  const u = d.user;
  const isCustomer = u.role === "customer";
  const otherSessionsCount = d.sessions.filter((s) => s.id !== d.currentDigest).length;

  const steps = [
    { ok: !!u.shipping_name, label: "收货人姓名" },
    { ok: !!u.phone, label: "联系电话" },
    { ok: !!u.address, label: "详细地址" },
  ];
  const doneCount = steps.filter((s) => s.ok).length;
  const pct = Math.round((doneCount / steps.length) * 100);
  const complete = doneCount === steps.length;

  // 客户完善引导：注册后 / 缺信息时置顶展示完善进度，已完善则转为选购入口
  const customerBanner = isCustomer
    ? `<div class="card highlight-card profile-progress${complete ? " is-done" : ""}">
        <div class="card-head">
          <h3>${
            complete
              ? "✅ 收货信息已完善，随时可以下单"
              : `👋 ${d.onboarding ? `欢迎使用 ${esc(ctx.appName)}，` : ""}请完善收货信息（${doneCount}/${steps.length}）`
          }</h3>
          ${
            complete
              ? `<div class="btn-row no-print">
                   <a class="btn small primary" href="/catalog">🛍️ 去商品目录选购</a>
                   <a class="btn small secondary" href="/shop">🛒 自助下单</a>
                 </div>`
              : badge("待完善", "yellow")
          }
        </div>
        <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
        <div class="step-list">
          ${steps
            .map(
              (s) =>
                `<span class="step-item ${s.ok ? "ok" : "todo"}"><span class="dot">${s.ok ? "✓" : "•"}</span>${esc(
                  s.label
                )}</span>`
            )
            .join("")}
        </div>
        <p class="muted small" style="margin:10px 0 0">${
          complete
            ? "下单时系统会自动带出收货人、电话与地址，无需重复填写；在商品目录点「加入购物车」即可批量选购。"
            : "完善后，下单时系统将自动带出配送信息，商家也能更快安排发货。"
        }</p>
      </div>`
    : "";

  const shippingCard = `
    <div class="card highlight-card" id="shipping">
      <div class="card-head">
        <h3>📍 默认收货信息设置（收货人 / 联系电话 / 收货地址）</h3>
        ${
          u.phone && u.address
            ? badge("已配置完整收货地址", "green")
            : badge("待完善收货地址", "yellow")
        }
      </div>
      <p class="muted small mb">用于订单发货与物流配送，保存后在「自助下单」与商家代客开单时将自动填充，也是加入购物车后快速结算的前提。</p>
      <form method="post" action="/profile/shipping">
        ${csrfInput(ctx.csrf)}
        <div class="form-row">
          ${field(
            "收货人姓名",
            `<input type="text" name="shipping_name" required maxlength="32" value="${esc(u.shipping_name || u.nickname)}" placeholder="请填写收件人真实姓名或联系人">`,
            "",
            true
          )}
          ${field(
            "收货联系电话",
            `<input type="tel" name="phone" required maxlength="20" value="${esc(u.phone)}" placeholder="请填写手机号码或座机，保持畅通">`,
            "",
            true
          )}
        </div>
        ${field(
          "详细收货地址",
          `<input type="text" name="address" required maxlength="200" value="${esc(u.address)}" placeholder="请填写省、市、区（县）、街道及详细门牌号 / 仓库地址">`,
          "请确保地址准确完整，以便安排物流配送",
          true
        )}
        <div class="btn-row">
          <button class="btn primary" type="submit">💾 保存收货信息</button>
        </div>
      </form>
    </div>`;

  const sessions =
    d.sessions.length > 0
      ? d.sessions
          .map((s) => {
            const isCur = s.id === d.currentDigest;
            return `<tr>
              <td class="muted small">${fmtDT(s.created_at)}</td>
              <td class="muted small">${fmtDT(s.expires_at)}</td>
              <td><code>${esc(s.ip)}</code></td>
              <td class="muted small">${esc(s.ua.slice(0, 80))}</td>
              <td>${isCur ? badge("当前在线设备", "green") : badge("其他设备", "blue")}</td>
              <td>${
                isCur
                  ? `<span class="muted small">本机会话</span>`
                  : `<form class="inline-form" method="post" action="/profile/sessions/${esc(s.id)}/revoke" data-confirm="确定强制下线该登录设备吗？">${csrfInput(ctx.csrf)}<button class="btn small danger" type="submit">强制踢出</button></form>`
              }</td>
            </tr>`;
          })
          .join("")
      : emptyRow(6, "暂无活跃登录设备");

  return `
    ${pageHead(
      isCustomer ? "📍 收货信息与个人中心" : "🛡️ 个人中心与账号安全",
      `当前登录：@${u.username}（${roleName(u.role)}）`,
      isCustomer ? `<a class="btn primary" href="/shop">🛒 我要下单</a>` : ""
    )}
    ${customerBanner}
    ${shippingCard}
    <div class="grid cols-2">
      <div class="card"><h3>📝 账号基础资料</h3>
        <form method="post" action="/profile">
          ${csrfInput(ctx.csrf)}
          ${field("显示昵称 / 企业名称", `<input type="text" name="nickname" maxlength="32" value="${esc(u.nickname)}" required>`, "", true)}
          ${field("联系电话", `<input type="tel" name="phone" maxlength="20" value="${esc(u.phone)}">`)}
          ${field("电子邮箱", `<input type="email" name="email" maxlength="100" value="${esc(u.email)}">`)}
          <button class="btn secondary" type="submit">💾 更新账号资料</button>
        </form>
      </div>
      <div>
        <div class="card"><h3>🔒 登录凭证与密保防护</h3>
          <dl class="kv">
            <dt>账号角色</dt><dd>${badge(roleName(u.role), "blue")}</dd>
            <dt>登录密码</dt><dd><a class="btn small secondary" href="/profile/password">🔑 修改登录密码</a></dd>
            <dt>密保找回</dt><dd>${d.hasSecQ ? badge("已配置密保", "green") : badge("未配置密保", "yellow")}
              <a class="btn small secondary" href="/profile/security">${d.hasSecQ ? "更新密保问题" : "立即设置"}</a></dd>
          </dl>
          <p class="muted small mt">💡 修改密码后系统会自动注销除本机以外的所有其他登录设备会话。</p>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-head">
        <h3>📱 活跃登录设备管理 <span class="muted small">（共 ${d.sessions.length} 台设备在线）</span></h3>
        ${
          otherSessionsCount > 0
            ? `<form class="inline-form" method="post" action="/profile/sessions/revoke-others" data-confirm="确定一键注销除本机以外的其他 ${otherSessionsCount} 台登录设备吗？">
                ${csrfInput(ctx.csrf)}
                <button class="btn small danger" type="submit">🚫 一键踢出其他全部设备 (${otherSessionsCount})</button>
              </form>`
            : ""
        }
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>登录时间</th><th>有效期至</th><th>来源 IP</th><th>浏览器 / 终端标识</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${sessions}</tbody>
      </table></div>
    </div>`;
}

export function passwordFormPage(ctx: ViewCtx): string {
  return `
    ${pageHead("🔒 修改登录密码", "修改成功后其他设备上的登录会话将自动失效", `<a class="btn secondary" href="/profile">← 返回个人中心</a>`)}
    <div class="card" style="max-width:560px">
      <form method="post" action="/profile/password">
        ${csrfInput(ctx.csrf)}
        ${field("当前原密码", `<input type="password" name="old_password" required maxlength="64" autocomplete="current-password" placeholder="请输入当前使用的密码">`, "", true)}
        ${field("设置新密码", `<input type="password" name="new_password" required minlength="6" maxlength="64" autocomplete="new-password" placeholder="至少 6 位字符">`, "", true)}
        ${field("确认新密码", `<input type="password" name="confirm_password" required minlength="6" maxlength="64" autocomplete="new-password" placeholder="再次输入新密码">`, "", true)}
        <div class="btn-row mt">
          <button class="btn primary" type="submit">✅ 确认修改密码</button>
          <a class="btn secondary" href="/profile">取消</a>
        </div>
      </form>
    </div>`;
}

export function securityFormPage(ctx: ViewCtx, has: boolean): string {
  return `
    ${pageHead("🔑 密保问题设置", has ? "提交后将覆盖您原有的密保问题与答案" : "设置两道密保问题，用于忘记密码时自助验证身份", `<a class="btn secondary" href="/profile">← 返回个人中心</a>`)}
    <div class="card" style="max-width:620px">
      <form method="post" action="/profile/security">
        ${csrfInput(ctx.csrf)}
        ${field("密保问题 1", `<input type="text" name="q1" required maxlength="100" placeholder="例如：我的第一所学校名称是什么？">`, "", true)}
        ${field("问题 1 答案", `<input type="text" name="a1" required minlength="2" maxlength="100" autocomplete="off" placeholder="至少 2 个字符">`, "验证时不区分大小写及全半角", true)}
        ${field("密保问题 2", `<input type="text" name="q2" required maxlength="100" placeholder="例如：我最喜欢的运动或城市？">`, "", true)}
        ${field("问题 2 答案", `<input type="text" name="a2" required minlength="2" maxlength="100" autocomplete="off" placeholder="至少 2 个字符">`, "两个密保问题不能相同", true)}
        <div class="btn-row mt">
          <button class="btn primary" type="submit">${has ? "🔄 更新密保设置" : "✅ 保存密保设置"}</button>
          <a class="btn secondary" href="/profile">取消</a>
        </div>
      </form>
    </div>`;
}

// ================= 系统设置（含微信收款码与支付宝收款码设置） =================

export function settingsPage(ctx: ViewCtx, s: Record<string, string>): string {
  const v = (k: string): string => esc(s[k] ?? "");
  const wechatQr = s["wechat_qr_key"] ? fileUrl(s["wechat_qr_key"]) : "";
  const alipayQr = s["alipay_qr_key"] ? fileUrl(s["alipay_qr_key"]) : "";
  const hasBank = !!(s["bank_account_name"] || s["bank_name"] || s["bank_account_no"]);

  return `
    ${pageHead("⚙️ 全局系统参数与收款设置", "配置品牌名称、微信/支付宝收款二维码、银行转账信息、客户注册开关、二级分销默认比例与自动备份策略")}
    <form method="post" action="/settings" enctype="multipart/form-data">
      ${csrfInput(ctx.csrf)}
      <div class="card highlight-card" id="payqr">
        <div class="card-head">
          <h3>💳 收款设置（微信 / 支付宝收款码 · 银行转账信息）</h3>
          <span>
            ${wechatQr ? badge("微信码已配置", "green") : badge("微信码未上传", "gray")}
            ${alipayQr ? badge("支付宝码已配置", "blue") : badge("支付宝码未上传", "gray")}
            ${hasBank ? badge("银行转账已配置", "green") : badge("银行转账未填写", "gray")}
          </span>
        </div>
        <p class="muted small mb">配置后将在<strong>销售开单、客户自助下单、订单详情及欠款补收核销</strong>页面按客户所选结算方式自动展示对应收款信息。</p>
        <div class="grid cols-2 mb">
          <div class="payqr-upload-box wechat">
            <div class="payqr-box-head">
              <span class="payqr-brand-tag wechat">💚 微信支付收款码（WeChat Pay）</span>
              ${wechatQr ? badge("已生效", "green") : badge("待上传", "yellow")}
            </div>
            <div class="payqr-preview-wrap">
              <img id="wechatQrPrev" class="payqr-img" src="${esc(wechatQr)}" alt="微信收款二维码" ${wechatQr ? "" : 'style="display:none"'}>
              ${
                !wechatQr
                  ? `<div class="payqr-empty" id="wechatQrEmpty"><span>📲</span><span class="small muted">暂未上传微信收款码<br>选择图片后即时预览</span></div>`
                  : ""
              }
            </div>
            ${field(
              "上传 / 更换微信收款码图片",
              `<input type="file" name="wechat_qr" accept="image/jpeg,image/png,image/webp,image/gif" data-preview="#wechatQrPrev">`,
              "建议使用清晰的方形微信收款码截图（≤5MB）"
            )}
            ${
              wechatQr
                ? `<label class="checkbox-row small neg"><input type="checkbox" name="clear_wechat_qr" value="1"><span>清除当前已上传的微信收款码</span></label>`
                : ""
            }
          </div>

          <div class="payqr-upload-box alipay">
            <div class="payqr-box-head">
              <span class="payqr-brand-tag alipay">💙 支付宝收款码（Alipay）</span>
              ${alipayQr ? badge("已生效", "blue") : badge("待上传", "yellow")}
            </div>
            <div class="payqr-preview-wrap">
              <img id="alipayQrPrev" class="payqr-img" src="${esc(alipayQr)}" alt="支付宝收款二维码" ${alipayQr ? "" : 'style="display:none"'}>
              ${
                !alipayQr
                  ? `<div class="payqr-empty" id="alipayQrEmpty"><span>📲</span><span class="small muted">暂未上传支付宝收款码<br>选择图片后即时预览</span></div>`
                  : ""
              }
            </div>
            ${field(
              "上传 / 更换支付宝收款码图片",
              `<input type="file" name="alipay_qr" accept="image/jpeg,image/png,image/webp,image/gif" data-preview="#alipayQrPrev">`,
              "建议使用清晰的方形支付宝收款码截图（≤5MB）"
            )}
            ${
              alipayQr
                ? `<label class="checkbox-row small neg"><input type="checkbox" name="clear_alipay_qr" value="1"><span>清除当前已上传的支付宝收款码</span></label>`
                : ""
            }
          </div>
        </div>
        <div class="payqr-upload-box bank">
          <div class="payqr-box-head">
            <span class="payqr-brand-tag bank">🏦 银行转账收款信息（Bank Transfer）</span>
            ${hasBank ? badge("已生效", "green") : badge("待填写", "yellow")}
          </div>
          <p class="muted small" style="margin:0">客户选择「银行转账」结算时，将直接展示以下信息供其网银/手机银行转账。</p>
          <div class="form-row cols-3">
            ${field("收款户名", `<input type="text" name="bank_account_name" maxlength="64" value="${v("bank_account_name")}" placeholder="如：深圳市进销通科技有限公司">`, "与银行开户名称完全一致")}
            ${field("开户银行（含支行）", `<input type="text" name="bank_name" maxlength="100" value="${v("bank_name")}" placeholder="如：中国工商银行深圳科技园支行">`, "建议写到支行，便于客户准确选择")}
            ${field("银行账号", `<input type="text" name="bank_account_no" maxlength="64" value="${v("bank_account_no")}" placeholder="如：4000 0123 4567 8901">`, "支持对公账户或对私账户")}
          </div>
        </div>
        ${field(
          "收款备注说明（选填）",
          `<input type="text" name="payment_note" maxlength="200" value="${v("payment_note")}" placeholder="例如：付款请备注【客户名称+订单号】，转账后请联系客服确认核销">`,
          "将展示在收款二维码 / 银行转账信息下方提示客户"
        )}
      </div>

      <div class="card"><h3>🏪 站点与门户配置</h3>
        ${field("系统品牌名称", `<input type="text" name="site_name" maxlength="32" value="${v("site_name")}" placeholder="默认：进销通">`, "展示于侧边栏、顶部导航栏、打印单据抬头及登录页")}
        <label class="checkbox-row mt">
          <input type="checkbox" id="allow_register" name="allow_register" value="1"${s["allow_register"] === "1" ? " checked" : ""}>
          <span><strong>开放客户自助注册</strong>（关闭后仅允许管理员在后台手动创建客户账号）</span>
        </label>
      </div>
      <div class="card"><h3>💰 二级分销提成核算规则</h3>
        ${field(
          "佣金计算基数",
          `<select name="commission_base">
            <option value="profit"${(s["commission_base"] || "profit") === "profit" ? " selected" : ""}>按订单实际毛利润（折后销售额 - 加权成本）</option>
            <option value="total"${s["commission_base"] === "total" ? " selected" : ""}>按订单折后销售额</option>
          </select>`,
          "建议选择「按订单实际毛利润」，避免低毛利订单亏损发佣"
        )}
        <div class="form-row cols-3">
          ${field("一级销售默认提成（%）", `<input type="number" name="commission_l1_default" min="0" max="100" step="0.01" value="${v("commission_l1_default") || "5"}">`, "一级销售本人开单时的默认比例")}
          ${field("二级销售默认提成（%）", `<input type="number" name="commission_l2_default" min="0" max="100" step="0.01" value="${v("commission_l2_default") || "8"}">`, "二级销售本人开单时的默认比例")}
          ${field("上级一级管理津贴（%）", `<input type="number" name="commission_l1_override" min="0" max="100" step="0.01" value="${v("commission_l1_override") || "2"}">`, "二级销售开单时，其直属一级上级获得的津贴")}
        </div>
      </div>
      <div class="card"><h3>🗄️ R2 云端备份策略</h3>
        ${field("自动备份保留份数", `<input type="number" name="backup_keep" min="1" max="60" step="1" value="${v("backup_keep") || "14"}">`, "每日凌晨 3:00 定时任务自动备份至 R2，超出保留份数的旧备份将自动轮转清理")}
      </div>
      <div class="btn-row">
        <button class="btn primary" type="submit">💾 保存系统设置与收款信息</button>
      </div>
    </form>`;
}

// ================= 数据维护 =================

export interface BackupInfo {
  key: string;
  size: number;
  uploaded: string;
}

export function maintenancePage(ctx: ViewCtx, d: { backups: BackupInfo[]; keep: string }): string {
  const rows =
    d.backups.length > 0
      ? d.backups
          .map(
            (b) => `<div class="backup-row">
              <div>
                <strong>📦 ${esc(b.key.split("/").pop() || b.key)}</strong>
                <div class="muted small">大小：${fmtSize(b.size)} · 备份时间：${fmtDT(b.uploaded)}</div>
              </div>
              <div class="btn-row">
                <a class="btn small secondary" href="/maintenance/backup/download?key=${encodeURIComponent(b.key)}">⬇️ 下载 JSON</a>
                <form class="inline-form" method="post" action="/maintenance/delete" data-confirm="删除后不可恢复，确定删除备份文件 ${esc(b.key)} 吗？">
                  ${csrfInput(ctx.csrf)}
                  <input type="hidden" name="key" value="${esc(b.key)}">
                  <button class="btn small danger" type="submit">删除</button>
                </form>
              </div>
            </div>`
          )
          .join("")
      : `<div class="empty-state"><span class="empty-ico">🗄️</span><span>R2 存储桶中暂无备份快照，点击上方按钮立即创建</span></div>`;

  return `
    ${pageHead("🗄️ 云端数据备份与灾难恢复", "全量业务数据支持一键快照至 Cloudflare R2 对象存储或导出至本地")}
    <div class="grid cols-2">
      <div class="card">
        <div class="card-head">
          <h3>📦 R2 云端备份列表（保留最近 ${esc(d.keep)} 份自动备份）</h3>
          <form method="post" action="/maintenance/backup" class="inline-form">
            ${csrfInput(ctx.csrf)}
            <button class="btn small primary" type="submit">＋ 立即创建快照</button>
          </form>
        </div>
        <p class="muted small mb">包含用户、密保、商品、分类、供应商、进销退单据、库存流水、分佣记录与系统设置全量表。</p>
        <div class="backup-list">${rows}</div>
      </div>
      <div class="card">
        <h3>♻️ 从备份快照恢复系统</h3>
        <p class="muted small mb">上传本系统导出的 <code>.json</code> 备份文件，全量回滚替换当前 D1 数据库并强制注销所有在线会话。</p>
        <form method="post" action="/maintenance/restore" enctype="multipart/form-data" data-confirm="⚠️ 高危操作确认：恢复将用备份文件完全覆盖当前数据库中的所有数据，确定继续吗？">
          ${csrfInput(ctx.csrf)}
          ${field("选择备份 JSON 文件", `<input type="file" name="backup" accept=".json,application/json" required>`, "仅支持进销通导出的标准备份结构", true)}
          <button class="btn danger" type="submit">♻️ 确认覆盖并恢复数据</button>
        </form>
        <hr class="divider">
        <h3>🛡️ 数据安全运维建议</h3>
        <ul class="guide-list">
          <li>在进行大批量调价、盘点或人员结构调整前，建议先点击「立即创建快照」。</li>
          <li>建议每月定期下载一份备份 JSON 文件保存在本地离线介质中，实现异地双备份。</li>
        </ul>
      </div>
    </div>`;
}

// ================= 操作日志 =================

export interface AuditRow {
  id: number;
  username?: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
  created_at: string;
}

export function auditPage(
  ctx: ViewCtx,
  d: { rows: AuditRow[]; total: number; page: number; pageSize: number; q: string }
): string {
  const rows =
    d.rows.length > 0
      ? d.rows
          .map(
            (r) => `<tr>
              <td class="muted small">#${r.id}</td>
              <td><strong>${esc(r.username || "系统任务")}</strong></td>
              <td>${badge(r.action, /删除|作废|禁用|恢复/.test(r.action) ? "red" : /新建|新增|结算/.test(r.action) ? "green" : "blue")}</td>
              <td>${esc(r.target)}</td>
              <td class="small">${esc(r.detail.slice(0, 150))}</td>
              <td><code>${esc(r.ip)}</code></td>
              <td class="muted small">${fmtDT(r.created_at)}</td>
            </tr>`
          )
          .join("")
      : emptyRow(7, "暂无操作审计记录");

  return `
    ${pageHead("📜 安全操作审计日志", `共 ${d.total} 条关键业务与安全操作留痕`)}
    <form class="toolbar" method="get" action="/audit">
      <input type="text" name="q" value="${esc(d.q)}" placeholder="🔍 搜索操作类型 / 目标对象 / 详情 / 操作人用户名..." maxlength="64" class="grow">
      <button class="btn primary" type="submit">检索</button>
      ${d.q ? `<a class="btn secondary" href="/audit">重置</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>流水号</th><th>操作账号</th><th>动作类型</th><th>操作模块</th><th>详细操作内容</th><th>来源 IP</th><th>记录时间</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/audit", { q: d.q }, d.page, tp(d.total, d.pageSize))}
    </div>`;
}
