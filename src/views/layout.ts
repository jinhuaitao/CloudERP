// 视图层基础：布局 + 共享组件（所有页面都依赖本文件）
import type { SafeUser } from "../env";

export interface ViewCtx {
  user: SafeUser | null;
  csrf: string;
  settings: Record<string, string>;
  appName: string;
}

// ---------- 侧边栏菜单 ----------

interface MenuItem {
  key: string;
  icon: string;
  label: string;
  href: string;
}

const ADMIN_MENU: MenuItem[] = [
  { key: "dashboard", icon: "📊", label: "数据看板", href: "/dashboard" },
  { key: "products", icon: "📦", label: "商品管理", href: "/products" },
  { key: "categories", icon: "🗂️", label: "分类与供应商", href: "/categories" },
  { key: "purchase", icon: "📥", label: "进货管理", href: "/purchase" },
  { key: "sales", icon: "📤", label: "销售管理", href: "/sales" },
  { key: "returns", icon: "↩️", label: "销售退货", href: "/returns" },
  { key: "movements", icon: "🧾", label: "库存流水", href: "/movements" },
  { key: "warnings", icon: "⚠️", label: "库存预警", href: "/warnings" },
  { key: "adjust", icon: "🧮", label: "库存盘点", href: "/adjust" },
  { key: "customers", icon: "👥", label: "客户管理", href: "/customers" },
  { key: "team", icon: "🤝", label: "销售团队", href: "/team" },
  { key: "commissions", icon: "💰", label: "分佣结算", href: "/commissions" },
  { key: "reports", icon: "📈", label: "经营报表", href: "/reports" },
  { key: "users", icon: "👤", label: "用户管理", href: "/users" },
  { key: "settings", icon: "⚙️", label: "系统设置", href: "/settings" },
  { key: "maintenance", icon: "🗄️", label: "数据维护", href: "/maintenance" },
  { key: "audit", icon: "📜", label: "操作日志", href: "/audit" },
];

const SALES_MENU: MenuItem[] = [
  { key: "dashboard", icon: "📊", label: "数据看板", href: "/dashboard" },
  { key: "products", icon: "📦", label: "商品管理", href: "/products" },
  { key: "sales-new", icon: "➕", label: "销售开单", href: "/sales/new" },
  { key: "sales", icon: "📤", label: "销售管理", href: "/sales" },
  { key: "returns", icon: "↩️", label: "销售退货", href: "/returns" },
  { key: "movements", icon: "🧾", label: "库存流水", href: "/movements" },
  { key: "warnings", icon: "⚠️", label: "库存预警", href: "/warnings" },
  { key: "customers", icon: "👥", label: "客户管理", href: "/customers" },
  { key: "team", icon: "🤝", label: "我的团队", href: "/team" },
  { key: "commissions", icon: "💰", label: "我的佣金", href: "/commissions" },
];

const CUSTOMER_MENU: MenuItem[] = [
  { key: "catalog", icon: "🛍️", label: "商品目录", href: "/catalog" },
  { key: "shop", icon: "🛒", label: "我要下单", href: "/shop" },
  { key: "sales", icon: "📋", label: "我的订单", href: "/sales" },
];

function menuFor(role: string): MenuItem[] {
  if (role === "admin") return ADMIN_MENU;
  if (role === "sales") return SALES_MENU;
  return CUSTOMER_MENU;
}

// ---------- 主布局 ----------

export function layout(o: {
  title: string;
  ctx: ViewCtx;
  active?: string;
  content: string;
  head?: string;
}): string {
  const { ctx } = o;
  const siteName = ctx.settings.site_name || ctx.appName || "进销通";
  const fullTitle = `${o.title} - ${siteName}`;
  const head = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(fullTitle)}</title>
<link rel="icon" href="/favicon.svg">
<link rel="stylesheet" href="/static/css/app.css">
<script src="/static/js/app.js" defer></script>
${o.head || ""}
</head>`;

  // 未登录：居中卡片（登录 / 注册 / 找回 / 初始化 / 错误页）
  if (!ctx.user) {
    return `${head}
<body>
<div class="center-wrap">
  <div class="auth-card">
    <div class="auth-logo">🏪</div>
    <div id="flashBox" class="flash"></div>
    ${o.content}
  </div>
</div>
</body>
</html>`;
  }

  const nav = menuFor(ctx.user.role)
    .map(
      (m) =>
        `<a href="${m.href}"${o.active === m.key ? ' class="active"' : ""}><span class="ico">${m.icon}</span><span>${escHtml(m.label)}</span></a>`
    )
    .join("");

  return `${head}
<body>
<div class="layout">
  <aside class="sidebar">
    <div class="brand"><span class="logo">🏪</span><span>${escHtml(siteName)}</span></div>
    <nav class="nav">${nav}</nav>
  </aside>
  <div class="main">
    <header class="topbar">
      <button id="menuToggle" class="menu-toggle" type="button" aria-label="菜单">☰</button>
      <h1 class="page-title">${escHtml(siteName)}</h1>
      <div class="userbox">
        <span>👤 ${escHtml(ctx.user.nickname)}</span>
        ${roleBadge(ctx.user.role)}
        <form class="inline-form" method="post" action="/logout">${csrfInput(ctx.csrf)}<button class="btn small secondary" type="submit">退出</button></form>
      </div>
    </header>
    <main class="content">
      <div id="flashBox" class="flash"></div>
      ${o.content}
    </main>
  </div>
</div>
</body>
</html>`;
}

// ---------- 共享组件 ----------

/** 内部转义（layout 自身不依赖 ../lib，避免循环） */
function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 页头：标题 + 副标题 + 右侧操作区（actions 为已转义/可信 HTML） */
export function pageHead(title: string, sub?: string, actions?: string): string {
  return `<div class="page-head"><div><h2>${escHtml(title)}</h2>${
    sub ? `<p class="sub">${escHtml(sub)}</p>` : ""
  }</div>${actions ? `<div class="btn-row">${actions}</div>` : ""}</div>`;
}

/** 统计卡片：color 取值 blue | green | red | yellow */
export function statCard(icon: string, label: string, value: string, sub?: string, color?: string): string {
  const c = color || "blue";
  return `<div class="stat"><div class="icon ${c}">${icon}</div><div><div class="label">${escHtml(label)}</div><div class="value">${escHtml(value)}</div>${
    sub ? `<div class="sub">${escHtml(sub)}</div>` : ""
  }</div></div>`;
}

/** 徽章：kind 取值 green | red | yellow | blue | gray */
export function badge(text: string, kind: "green" | "red" | "yellow" | "blue" | "gray"): string {
  return `<span class="badge ${kind}">${escHtml(text)}</span>`;
}

/** 空表格行 */
export function emptyRow(cols: number, text = "暂无数据"): string {
  return `<tr><td colspan="${cols}" class="muted" align="center">📭 ${escHtml(text)}</td></tr>`;
}

/** 分页：params 为需保留的查询参数（不含 page） */
export function pagerHtml(path: string, params: Record<string, string>, page: number, total: number): string {
  if (total <= 1) return "";
  const cur = Math.min(Math.max(1, page), total);
  const href = (p: number): string => {
    const parts: string[] = [];
    for (const k of Object.keys(params)) {
      const v = params[k];
      if (v !== "" && v !== undefined && v !== null) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
    parts.push(`page=${p}`);
    return `${path}?${parts.join("&")}`;
  };
  let start = Math.max(1, cur - 2);
  const end = Math.min(total, start + 4);
  start = Math.max(1, end - 4);
  let nums = "";
  for (let p = start; p <= end; p++) {
    nums += p === cur ? `<span class="cur">${p}</span>` : `<a href="${escHtml(href(p))}">${p}</a>`;
  }
  return `<nav class="pager">${
    cur > 1 ? `<a href="${escHtml(href(cur - 1))}">‹ 上一页</a>` : `<span>‹ 上一页</span>`
  }${nums}${
    cur < total ? `<a href="${escHtml(href(cur + 1))}">下一页 ›</a>` : `<span>下一页 ›</span>`
  }<span class="muted small">共 ${total} 页</span></nav>`;
}

/** CSRF 隐藏字段：每个 POST 表单都必须包含 */
export function csrfInput(csrf: string): string {
  return `<input type="hidden" name="csrf" value="${escHtml(csrf)}">`;
}

/** 表单字段包装 */
export function field(label: string, inner: string, hint?: string, req?: boolean): string {
  return `<div class="field"><label>${escHtml(label)}${req ? ' <span class="req">*</span>' : ""}</label>${inner}${
    hint ? `<div class="hint">${escHtml(hint)}</div>` : ""
  }</div>`;
}

/** 角色中文名 */
export function roleName(role: string): string {
  if (role === "admin") return "管理员";
  if (role === "sales") return "销售员";
  if (role === "customer") return "客户";
  return role;
}

function roleBadge(role: string): string {
  const kind = role === "admin" ? "blue" : role === "sales" ? "green" : "gray";
  return badge(roleName(role), kind as "blue" | "green" | "gray");
}

/** 居中错误页 */
export function errorPage(ctx: ViewCtx, code: number, title: string, msg: string): string {
  const back = ctx.user ? "/dashboard" : "/";
  const content = `<div class="error-wrap"><div class="code">${code}</div><h2>${escHtml(title)}</h2><p class="muted">${escHtml(msg)}</p><p class="mt"><a class="btn primary" href="${back}">← 返回</a></p></div>`;
  return layout({ title: `${code} ${title}`, ctx, content });
}
