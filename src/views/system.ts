// 经营报表 / 用户管理 / 个人中心 / 系统设置 / 数据维护 / 操作日志
import { esc, money, fmtDT } from "../lib";
import {
  layout,
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
  profit: number;
  returnTotal: number;
  orderCount: number;
}

export function reportPage(ctx: ViewCtx, d: ReportData): string {
  const q = `from=${encodeURIComponent(d.from)}&to=${encodeURIComponent(d.to)}`;
  const exports = [
    { t: "sales", label: "📤 导出销售明细" },
    { t: "purchase", label: "📥 导出进货明细" },
    { t: "movements", label: "🧾 导出库存流水" },
    { t: "products", label: "📦 导出商品清单" },
  ]
    .map((e) => `<a class="btn secondary" href="/reports/export?type=${e.t}&${q}">${e.label}</a>`)
    .join("");

  const content = `
    ${pageHead("📈 经营报表", "按日期区间统计进销存经营数据")}
    <form class="toolbar" method="get" action="/reports">
      <input type="date" name="from" value="${esc(d.from)}">
      <span class="muted">至</span>
      <input type="date" name="to" value="${esc(d.to)}">
      <button class="btn secondary" type="submit">查询</button>
    </form>
    <div class="grid cols-4 mb">
      ${statCard("📥", "进货总额", money(d.purchaseTotal), `${esc(d.from)} ~ ${esc(d.to)}`, "blue")}
      ${statCard("📤", "销售总额", money(d.salesTotal), `${d.orderCount} 笔订单`, "green")}
      ${statCard("📈", "毛利润", money(d.profit), "销售额 - 销售成本", "yellow")}
      ${statCard("↩️", "退货总额", money(d.returnTotal), "", "red")}
    </div>
    <div class="card"><h3>📥 数据导出（CSV，Excel 可直接打开）</h3>
      <div class="btn-row">${exports}</div>
      <p class="muted small mt">导出范围与上方查询的日期区间一致。</p>
    </div>`;

  return layout({ title: "经营报表", ctx, active: "reports", content });
}

// ================= 用户管理 =================

export function userListPage(
  ctx: ViewCtx,
  d: { rows: User[]; total: number; page: number; pageSize: number; q: string }
): string {
  const roleBadge = (r: string): string =>
    r === "admin" ? badge(roleName(r), "blue") : r === "sales" ? badge(roleName(r), "green") : badge(roleName(r), "gray");

  const rows =
    d.rows.length > 0
      ? d.rows
          .map((u) => {
            const isSelf = ctx.user?.id === u.id;
            return `<tr>
              <td>${esc(u.username)}</td>
              <td><strong>${esc(u.nickname)}</strong></td>
              <td>${roleBadge(u.role)}</td>
              <td>${u.role === "sales" ? (u.sales_level === 2 ? "二级" : "一级") : "—"}</td>
              <td>${esc(u.phone || "—")}</td>
              <td>${statusBadge(u.status)}</td>
              <td><div class="btn-row">
                <a class="btn small secondary" href="/users/${u.id}/edit">编辑</a>
                ${
                  isSelf
                    ? `<span class="muted small">（自己）</span>`
                    : `<form class="inline-form" method="post" action="/users/${u.id}/toggle" data-confirm="确定${u.status === "active" ? "禁用" : "启用"}用户「${esc(u.username)}」吗？">${csrfInput(ctx.csrf)}<button class="btn small secondary" type="submit">${u.status === "active" ? "禁用" : "启用"}</button></form>`
                }
                <form class="inline-form" method="post" action="/users/${u.id}/reset-password">
                  ${csrfInput(ctx.csrf)}
                  <input type="password" name="new_password" required minlength="6" maxlength="64" placeholder="新密码" autocomplete="new-password">
                  <button class="btn small secondary" type="submit">重置密码</button>
                </form>
              </div></td>
            </tr>`;
          })
          .join("")
      : emptyRow(7, "暂无用户");

  const content = `
    ${pageHead("👤 用户管理", `共 ${d.total} 个用户`, `<a class="btn primary" href="/users/new">＋ 新建用户</a>`)}
    <form class="toolbar" method="get" action="/users">
      <input type="text" name="q" value="${esc(d.q)}" placeholder="🔍 用户名 / 昵称 / 电话" maxlength="64">
      <button class="btn secondary" type="submit">搜索</button>
      ${d.q ? `<a class="btn secondary" href="/users">清除</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>用户名</th><th>昵称</th><th>角色</th><th>销售级别</th><th>电话</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/users", { q: d.q }, d.page, tp(d.total, d.pageSize))}
    </div>
    <p class="muted small">💡 重置密码：在输入框填写新密码后点击「重置密码」即可生效，用户下次登录需使用新密码。</p>`;

  return layout({ title: "用户管理", ctx, active: "users", content });
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
  // 上级候选：排除自己
  const parents = d.salesTeam.filter((p) => !u || p.id !== u.id);

  const content = `
    ${pageHead(isNew ? "＋ 新建用户" : "✏️ 编辑用户", u ? `@${u.username}` : "填写用户资料", `<a class="btn secondary" href="/users">← 返回列表</a>`)}
    <div class="card">
      <form method="post" action="${action}">
        ${csrfInput(ctx.csrf)}
        ${
          isNew
            ? field("用户名", `<input type="text" name="username" required minlength="3" maxlength="32" autocomplete="off">`, "", true)
            : field("用户名", `<input type="text" value="${v(u!.username)}" disabled>`, "用户名创建后不可修改")
        }
        ${field(
          "密码",
          `<input type="password" name="password" ${isNew ? "required" : ""} minlength="6" maxlength="64" autocomplete="new-password" placeholder="${isNew ? "至少 6 位" : "留空则不修改"}">`,
          isNew ? "" : "留空表示不修改密码",
          isNew
        )}
        <div class="form-row">
          ${field("昵称", `<input type="text" name="nickname" maxlength="32" value="${v(u?.nickname)}">`)}
          ${field("电话", `<input type="tel" name="phone" maxlength="20" value="${v(u?.phone)}">`)}
        </div>
        ${field("邮箱", `<input type="email" name="email" maxlength="100" value="${v(u?.email)}">`)}
        <div class="form-row">
          ${field(
            "角色",
            `<select id="roleSelect" name="role">
              <option value="admin"${u?.role === "admin" ? " selected" : ""}>管理员</option>
              <option value="sales"${!u || u?.role === "sales" ? " selected" : ""}>销售员</option>
              <option value="customer"${u?.role === "customer" ? " selected" : ""}>客户</option>
            </select>`,
            "",
            true
          )}
          ${field(
            "状态",
            `<select name="status">
              <option value="active"${!u || u?.status === "active" ? " selected" : ""}>正常</option>
              <option value="disabled"${u?.status === "disabled" ? " selected" : ""}>禁用</option>
            </select>`
          )}
        </div>
        <div data-show-for="sales">
          <h3 class="mt">💼 销售设置 <span class="muted small">（角色为销售员时生效）</span></h3>
          <div class="form-row">
            ${field(
              "销售级别",
              `<select name="sales_level" data-role="sales-level">
                <option value="1"${!u || u?.sales_level !== 2 ? " selected" : ""}>一级销售</option>
                <option value="2"${u?.sales_level === 2 ? " selected" : ""}>二级销售</option>
              </select>`
            )}
            ${field("分佣比例（%）", `<input type="number" name="commission_rate" min="0" max="100" step="0.01" value="${v(u?.commission_rate || "")}" placeholder="留空用系统默认">`)}
          </div>
          <div id="parentRow">
            ${field(
              "上级销售",
              `<select name="parent_id"><option value="">— 无（顶级） —</option>${parents
                .map((p) => `<option value="${p.id}"${u?.parent_id === p.id ? " selected" : ""}>${esc(p.nickname)}（${esc(p.username)}）</option>`)
                .join("")}</select>`,
              "二级销售需指定上级；上级可获得管理津贴"
            )}
          </div>
        </div>
        <div data-show-for="customer">
          <h3 class="mt">🧾 客户设置 <span class="muted small">（角色为客户时生效）</span></h3>
          ${field("赊账额度（元）", `<input type="number" name="credit_limit" min="0" step="0.01" value="${v(u?.credit_limit ?? 0)}">`, "允许该客户的最大欠款金额，0 表示不赊账")}
        </div>
        <div class="btn-row mt">
          <button class="btn primary" type="submit">${isNew ? "✅ 创建用户" : "💾 保存修改"}</button>
          <a class="btn secondary" href="/users">取消</a>
        </div>
      </form>
    </div>`;

  return layout({ title: isNew ? "新建用户" : "编辑用户", ctx, active: "users", content });
}

// ================= 个人中心 =================

export interface SessionInfo {
  id: string;
  created_at: string;
  expires_at: string;
  ip: string;
  ua: string;
}

export function profilePage(
  ctx: ViewCtx,
  d: { user: User; sessions: SessionInfo[]; currentDigest: string; hasSecQ: boolean }
): string {
  const u = d.user;
  const sessions =
    d.sessions.length > 0
      ? d.sessions
          .map((s) => {
            const isCur = s.id === d.currentDigest;
            return `<tr>
              <td class="muted small">${fmtDT(s.created_at)}</td>
              <td class="muted small">${fmtDT(s.expires_at)}</td>
              <td>${esc(s.ip)}</td>
              <td class="muted small">${esc(s.ua.slice(0, 80))}</td>
              <td>${isCur ? badge("当前设备", "green") : `<span class="muted">—</span>`}</td>
              <td>${
                isCur
                  ? `<span class="muted small">—</span>`
                  : `<form class="inline-form" method="post" action="/profile/sessions/${esc(s.id)}/revoke" data-confirm="确定踢出该登录设备吗？对方将立即下线。">${csrfInput(ctx.csrf)}<button class="btn small danger" type="submit">踢出</button></form>`
              }</td>
            </tr>`;
          })
          .join("")
      : emptyRow(6, "暂无登录记录");

  const content = `
    ${pageHead("🙋 个人中心", `@${esc(u.username)} · ${esc(roleName(u.role))}`)}
    <div class="grid cols-2">
      <div class="card"><h3>📝 基本信息</h3>
        <form method="post" action="/profile">
          ${csrfInput(ctx.csrf)}
          ${field("昵称", `<input type="text" name="nickname" maxlength="32" value="${esc(u.nickname)}">`, "", true)}
          ${field("电话", `<input type="tel" name="phone" maxlength="20" value="${esc(u.phone)}">`)}
          ${field("邮箱", `<input type="email" name="email" maxlength="100" value="${esc(u.email)}">`)}
          <button class="btn primary" type="submit">💾 保存</button>
        </form>
      </div>
      <div>
        <div class="card"><h3>🔒 安全设置</h3>
          <dl class="kv">
            <dt>登录密码</dt><dd><a class="btn small secondary" href="/profile/password">修改密码</a></dd>
            <dt>密保问题</dt><dd>${d.hasSecQ ? badge("已设置", "green") : badge("未设置", "yellow")}
              <a class="btn small secondary" href="/profile/security">${d.hasSecQ ? "更新密保" : "去设置"}</a></dd>
          </dl>
          <p class="muted small mt">💡 密保问题用于忘记密码时验证身份，建议设置并牢记答案。</p>
        </div>
      </div>
    </div>
    <div class="card"><h3>📱 登录设备 <span class="muted small">（发现陌生设备可将其踢出）</span></h3>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>登录时间</th><th>过期时间</th><th>IP</th><th>设备</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${sessions}</tbody>
      </table></div>
    </div>`;

  return layout({ title: "个人中心", ctx, content });
}

export function passwordFormPage(ctx: ViewCtx): string {
  const content = `
    ${pageHead("🔒 修改密码", "修改后请使用新密码登录", `<a class="btn secondary" href="/profile">← 返回个人中心</a>`)}
    <div class="card">
      <form method="post" action="/profile/password">
        ${csrfInput(ctx.csrf)}
        ${field("原密码", `<input type="password" name="old_password" required maxlength="64" autocomplete="current-password">`, "", true)}
        ${field("新密码", `<input type="password" name="new_password" required minlength="6" maxlength="64" autocomplete="new-password" placeholder="至少 6 位">`, "", true)}
        ${field("确认新密码", `<input type="password" name="confirm_password" required minlength="6" maxlength="64" autocomplete="new-password">`, "", true)}
        <button class="btn primary" type="submit">✅ 确认修改</button>
      </form>
    </div>`;

  return layout({ title: "修改密码", ctx, content });
}

export function securityFormPage(ctx: ViewCtx, has: boolean): string {
  const content = `
    ${pageHead("🔑 密保问题", has ? "更新将覆盖原有密保问题" : "设置两道密保问题，用于找回密码", `<a class="btn secondary" href="/profile">← 返回个人中心</a>`)}
    <div class="card">
      <form method="post" action="/profile/security">
        ${csrfInput(ctx.csrf)}
        ${field("密保问题 1", `<input type="text" name="q1" required maxlength="100" placeholder="例如：我的小学班主任是谁？">`, "", true)}
        ${field("答案 1", `<input type="text" name="a1" required maxlength="100" autocomplete="off">`, "答案不区分大小写", true)}
        ${field("密保问题 2", `<input type="text" name="q2" required maxlength="100">`, "", true)}
        ${field("答案 2", `<input type="text" name="a2" required maxlength="100" autocomplete="off">`, "答案不区分大小写", true)}
        <button class="btn primary" type="submit">${has ? "🔄 更新密保" : "✅ 设置密保"}</button>
      </form>
    </div>`;

  return layout({ title: "密保问题", ctx, content });
}

// ================= 系统设置 =================

export function settingsPage(ctx: ViewCtx, s: Record<string, string>): string {
  const v = (k: string): string => esc(s[k] ?? "");
  const content = `
    ${pageHead("⚙️ 系统设置", "修改后立即生效")}
    <form method="post" action="/settings">
      ${csrfInput(ctx.csrf)}
      <div class="card"><h3>🏪 站点</h3>
        ${field("站点名称", `<input type="text" name="site_name" maxlength="32" value="${v("site_name")}" placeholder="默认：进销通">`, "显示在侧边栏、顶部栏与浏览器标题")}
        <div class="checkbox-row">
          <input type="checkbox" id="allow_register" name="allow_register" value="1"${s["allow_register"] === "1" ? " checked" : ""}>
          <label for="allow_register">允许客户自主注册（关闭后只能由管理员创建账号）</label>
        </div>
      </div>
      <div class="card"><h3>💰 分佣规则</h3>
        ${field(
          "分佣基数",
          `<select name="commission_base">
            <option value="profit"${(s["commission_base"] || "profit") === "profit" ? " selected" : ""}>按利润（售价 - 成本）</option>
            <option value="total"${s["commission_base"] === "total" ? " selected" : ""}>按销售额</option>
          </select>`,
          "计算佣金时的金额基数"
        )}
        <div class="form-row cols-3">
          ${field("一级默认比例（%）", `<input type="number" name="commission_l1_default" min="0" max="100" step="0.01" value="${v("commission_l1_default") || "5"}">`, "未单独设置比例的一级销售适用")}
          ${field("二级默认比例（%）", `<input type="number" name="commission_l2_default" min="0" max="100" step="0.01" value="${v("commission_l2_default") || "8"}">`, "未单独设置比例的二级销售适用")}
          ${field("一级管理津贴（%）", `<input type="number" name="commission_l1_override" min="0" max="100" step="0.01" value="${v("commission_l1_override") || "2"}">`, "二级销售出单时，其上级获得的额外比例")}
        </div>
        <p class="muted small">💡 也可在用户管理中为单个销售员设置专属分佣比例，专属比例优先于系统默认。</p>
      </div>
      <div class="card"><h3>🗄️ 备份</h3>
        ${field("备份保留份数", `<input type="number" name="backup_keep" min="1" max="30" step="1" value="${v("backup_keep") || "7"}">`, "自动清理超出数量的最旧备份")}
      </div>
      <div class="btn-row">
        <button class="btn primary" type="submit">💾 保存设置</button>
      </div>
    </form>`;

  return layout({ title: "系统设置", ctx, active: "settings", content });
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
              <div>📦 <strong>${esc(b.key.split("/").pop() || b.key)}</strong><br><span class="muted small">${fmtSize(b.size)} · ${fmtDT(b.uploaded)}</span></div>
              <div class="btn-row">
                <a class="btn small secondary" href="/maintenance/backup/download?key=${encodeURIComponent(b.key)}">下载</a>
                <form class="inline-form" method="post" action="/maintenance/delete" data-confirm="删除后无法恢复，确定删除该备份吗？">
                  ${csrfInput(ctx.csrf)}
                  <input type="hidden" name="key" value="${esc(b.key)}">
                  <button class="btn small danger" type="submit">删除</button>
                </form>
              </div>
            </div>`
          )
          .join("")
      : `<p class="muted" align="center">📭 暂无备份，点击「立即备份」创建第一份备份</p>`;

  const content = `
    ${pageHead("🗄️ 数据维护", "备份、恢复与数据安全")}
    <div class="grid cols-2">
      <div class="card"><h3>📦 数据备份</h3>
        <p class="muted small">备份包含全部业务数据（用户、商品、单据、流水、佣金等），保存为 JSON 文件存入 R2。当前保留最近 <strong>${esc(d.keep)}</strong> 份。</p>
        <form method="post" action="/maintenance/backup">
          ${csrfInput(ctx.csrf)}
          <button class="btn primary" type="submit">📦 立即备份</button>
        </form>
        <hr class="divider">
        ${rows}
      </div>
      <div class="card"><h3>♻️ 从备份恢复</h3>
        <p class="muted small">上传之前下载的备份 JSON 文件进行恢复。</p>
        <form method="post" action="/maintenance/restore" enctype="multipart/form-data" data-confirm="⚠️ 恢复将用备份数据覆盖当前全部数据，此操作不可撤销！确定继续吗？">
          ${csrfInput(ctx.csrf)}
          ${field("备份文件", `<input type="file" name="backup" accept=".json,application/json" required>`, "仅支持本系统导出的备份文件")}
          <button class="btn danger" type="submit">♻️ 从备份恢复</button>
        </form>
        <hr class="divider">
        <h3>💡 安全建议</h3>
        <p class="muted small">· 重要操作前先备份<br>· 定期将备份下载到本地保存<br>· 恢复操作会清空当前数据，请谨慎</p>
      </div>
    </div>`;

  return layout({ title: "数据维护", ctx, active: "maintenance", content });
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
              <td class="muted">#${r.id}</td>
              <td>${esc(r.username || "—")}</td>
              <td>${esc(r.action)}</td>
              <td class="small">${esc(r.target)}</td>
              <td class="muted small">${esc(r.detail.slice(0, 120))}</td>
              <td class="muted small">${esc(r.ip)}</td>
              <td class="muted small">${fmtDT(r.created_at)}</td>
            </tr>`
          )
          .join("")
      : emptyRow(7, "暂无操作日志");

  const content = `
    ${pageHead("📜 操作日志", `共 ${d.total} 条记录`, "")}
    <form class="toolbar" method="get" action="/audit">
      <input type="text" name="q" value="${esc(d.q)}" placeholder="🔍 操作 / 目标 / 用户名" maxlength="64">
      <button class="btn secondary" type="submit">搜索</button>
      ${d.q ? `<a class="btn secondary" href="/audit">清除</a>` : ""}
    </form>
    <div class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>ID</th><th>用户</th><th>操作</th><th>目标</th><th>详情</th><th>IP</th><th>时间</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${pagerHtml("/audit", { q: d.q }, d.page, tp(d.total, d.pageSize))}
    </div>`;

  return layout({ title: "操作日志", ctx, active: "audit", content });
}
