// 视图层基础：企业级响应式布局 + 共享 UI 组件（注意：子视图只返回 HTML 片段，由路由层统一调用一次 layout）
import type { SafeUser } from "../env";

export interface ViewCtx {
  user: SafeUser | null;
  csrf: string;
  settings: Record<string, string>;
  appName: string;
  lowStockCount?: number;
}

// ---------- 分组侧边栏菜单 ----------

interface MenuItem {
  key: string;
  icon: string;
  label: string;
  href: string;
  group: string;
  badgeKey?: "lowStock";
}

const ADMIN_MENU: MenuItem[] = [
  { group: "经营概览", key: "dashboard", icon: "📊", label: "数据看板", href: "/dashboard" },
  { group: "经营概览", key: "reports", icon: "📈", label: "经营报表", href: "/reports" },
  { group: "商品与供应链", key: "products", icon: "📦", label: "商品档案", href: "/products" },
  { group: "商品与供应链", key: "categories", icon: "🗂️", label: "分类与供应商", href: "/categories" },
  { group: "商品与供应链", key: "catalog", icon: "🛍️", label: "商品画册", href: "/catalog" },
  { group: "进销业务", key: "purchase", icon: "📥", label: "采购进货", href: "/purchase" },
  { group: "进销业务", key: "sales", icon: "📤", label: "销售开单", href: "/sales" },
  { group: "进销业务", key: "returns", icon: "↩️", label: "销售退货", href: "/returns" },
  { group: "库存中心", key: "movements", icon: "🧾", label: "库存流水", href: "/movements" },
  { group: "库存中心", key: "warnings", icon: "⚠️", label: "库存预警", href: "/warnings", badgeKey: "lowStock" },
  { group: "库存中心", key: "adjust", icon: "🧮", label: "库存盘点", href: "/adjust" },
  { group: "客户与分销", key: "customers", icon: "👥", label: "客户管理", href: "/customers" },
  { group: "客户与分销", key: "team", icon: "🤝", label: "销售团队", href: "/team" },
  { group: "客户与分销", key: "commissions", icon: "💰", label: "分佣结算", href: "/commissions" },
  { group: "系统与安全", key: "users", icon: "👤", label: "用户权限", href: "/users" },
  { group: "系统与安全", key: "settings", icon: "⚙️", label: "系统设置", href: "/settings" },
  { group: "系统与安全", key: "maintenance", icon: "🗄️", label: "备份维护", href: "/maintenance" },
  { group: "系统与安全", key: "audit", icon: "📜", label: "审计日志", href: "/audit" },
  { group: "系统与安全", key: "profile", icon: "🛡️", label: "个人中心", href: "/profile" },
];

const SALES_MENU: MenuItem[] = [
  { group: "工作台", key: "dashboard", icon: "📊", label: "数据看板", href: "/dashboard" },
  { group: "工作台", key: "sales-new", icon: "➕", label: "快速开单", href: "/sales/new" },
  { group: "业务管理", key: "sales", icon: "📤", label: "我的销售单", href: "/sales" },
  { group: "业务管理", key: "returns", icon: "↩️", label: "销售退货", href: "/returns" },
  { group: "业务管理", key: "customers", icon: "👥", label: "客户管理", href: "/customers" },
  { group: "商品与库存", key: "products", icon: "📦", label: "商品库存", href: "/products" },
  { group: "商品与库存", key: "catalog", icon: "🛍️", label: "商品画册", href: "/catalog" },
  { group: "商品与库存", key: "movements", icon: "🧾", label: "库存流水", href: "/movements" },
  { group: "商品与库存", key: "warnings", icon: "⚠️", label: "库存预警", href: "/warnings", badgeKey: "lowStock" },
  { group: "团队与收益", key: "team", icon: "🤝", label: "我的团队", href: "/team" },
  { group: "团队与收益", key: "commissions", icon: "💰", label: "我的佣金", href: "/commissions" },
  { group: "账号设置", key: "profile", icon: "🛡️", label: "个人中心", href: "/profile" },
];

const CUSTOMER_MENU: MenuItem[] = [
  { group: "在线订货", key: "catalog", icon: "🛍️", label: "商品目录", href: "/catalog" },
  { group: "在线订货", key: "shop", icon: "🛒", label: "自助下单", href: "/shop" },
  { group: "订单与账户", key: "sales", icon: "📋", label: "我的订单", href: "/sales" },
  { group: "订单与账户", key: "profile", icon: "🛡️", label: "个人中心", href: "/profile" },
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
  const lowCount = ctx.lowStockCount || 0;

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

  // 未登录：企业级双栏/居中玻璃拟态认证布局
  if (!ctx.user) {
    return `${head}
<body class="auth-body">
<div class="center-wrap">
  <div class="auth-shell">
    <div class="auth-brand-panel">
      <div class="auth-brand-top">
        <div class="auth-brand-logo">📦</div>
        <div>
          <div class="auth-brand-name">${escHtml(siteName)}</div>
          <div class="auth-brand-tag">Cloudflare Edge ERP · v2.0</div>
        </div>
      </div>
      <h2 class="auth-hero-title">全链路云端进销存与二级分销协同系统</h2>
      <p class="auth-hero-desc">基于全球边缘网络 D1 + R2 构建，集采购入库、加权平均成本核算、智能库存预警、客户授信风控与二级分销自动计提于一体。</p>
      <div class="auth-feature-list">
        <div class="auth-feature-item"><span>⚡</span><div><strong>实时台账闭环</strong><p>采购、销售、退货、盘点全流程留痕，支持单据打印与回滚</p></div></div>
        <div class="auth-feature-item"><span>🌳</span><div><strong>二级分销引擎</strong><p>支持按毛利或销售额自动拆算一级/二级佣金与上级管理津贴</p></div></div>
        <div class="auth-feature-item"><span>🛡️</span><div><strong>企业级安全防护</strong><p>Bcrypt 加密、CSRF 双重校验、登录限流锁定与 R2 自动快照</p></div></div>
      </div>
    </div>
    <div class="auth-card">
      <div id="flashBox" class="flash"></div>
      ${o.content}
    </div>
  </div>
</div>
</body>
</html>`;
  }

  // 按分组渲染导航栏
  const items = menuFor(ctx.user.role);
  const groups = new Map<string, MenuItem[]>();
  for (const item of items) {
    const list = groups.get(item.group) || [];
    list.push(item);
    groups.set(item.group, list);
  }

  let navHtml = "";
  for (const [groupName, groupItems] of groups) {
    navHtml += `<div class="nav-group">${escHtml(groupName)}</div>`;
    for (const m of groupItems) {
      const badgeEl =
        m.badgeKey === "lowStock" && lowCount > 0
          ? `<span class="nav-badge">${lowCount > 99 ? "99+" : lowCount}</span>`
          : "";
      navHtml += `<a href="${m.href}"${o.active === m.key ? ' class="active"' : ""}><span class="ico">${m.icon}</span><span class="nav-label">${escHtml(m.label)}</span>${badgeEl}</a>`;
    }
  }

  const quickActions =
    ctx.user.role === "admin"
      ? `<a class="btn small primary" href="/sales/new">＋ 销售开单</a>
         <a class="btn small secondary" href="/purchase/new">📥 采购入库</a>`
      : ctx.user.role === "sales"
        ? `<a class="btn small primary" href="/sales/new">＋ 销售开单</a>`
        : `<a class="btn small primary" href="/shop">🛒 立即订货</a>`;

  const lowAlertPill =
    (ctx.user.role === "admin" || ctx.user.role === "sales") && lowCount > 0
      ? `<a href="/warnings" class="topbar-alert" title="查看库存预警商品">⚠️ <span>${lowCount} 件库存预警</span></a>`
      : "";

  return `${head}
<body>
<div class="layout">
  <div id="sidebarOverlay" class="sidebar-overlay"></div>
  <aside class="sidebar">
    <div class="brand">
      <div class="logo-box">📦</div>
      <div class="brand-text">
        <span class="brand-title">${escHtml(siteName)}</span>
        <span class="brand-sub">ERP v2.0 Pro</span>
      </div>
    </div>
    <nav class="nav">${navHtml}</nav>
    <div class="sidebar-footer">
      <a href="/profile" class="sidebar-user">
        <div class="avatar sm">${escHtml((ctx.user.nickname || ctx.user.username).slice(0, 1).toUpperCase())}</div>
        <div class="sidebar-user-info">
          <div class="sidebar-user-name">${escHtml(ctx.user.nickname)}</div>
          <div class="sidebar-user-role">@${escHtml(ctx.user.username)} · ${escHtml(roleName(ctx.user.role))}</div>
        </div>
      </a>
    </div>
  </aside>
  <div class="main">
    <header class="topbar no-print">
      <div class="topbar-left">
        <button id="menuToggle" class="menu-toggle" type="button" aria-label="展开菜单">☰</button>
        <div class="breadcrumb">
          <span class="breadcrumb-app">${escHtml(siteName)}</span>
          <span class="breadcrumb-sep">/</span>
          <h1 class="page-title">${escHtml(o.title)}</h1>
        </div>
      </div>
      <div class="userbox">
        <div class="quick-actions">${quickActions}</div>
        ${lowAlertPill}
        <button id="themeToggle" class="btn-icon" type="button" title="切换深浅色主题">🌓</button>
        <a href="/profile" class="user-pill" title="个人中心与安全设置">
          <span class="user-avatar-dot">${escHtml((ctx.user.nickname || ctx.user.username).slice(0, 1))}</span>
          <span class="user-name-text">${escHtml(ctx.user.nickname)}</span>
          ${roleBadge(ctx.user.role)}
        </a>
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

function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 页头：标题 + 副标题 + 右侧操作区 */
export function pageHead(title: string, sub?: string, actions?: string): string {
  return `<div class="page-head"><div><h2>${escHtml(title)}</h2>${
    sub ? `<p class="sub">${escHtml(sub)}</p>` : ""
  }</div>${actions ? `<div class="btn-row no-print">${actions}</div>` : ""}</div>`;
}

/** 统计卡片：color 取值 blue | green | red | yellow | purple */
export function statCard(icon: string, label: string, value: string, sub?: string, color?: string): string {
  const c = color || "blue";
  return `<div class="stat stat-${c}"><div class="icon ${c}">${icon}</div><div class="stat-body"><div class="label">${escHtml(label)}</div><div class="value">${escHtml(value)}</div>${
    sub ? `<div class="sub">${escHtml(sub)}</div>` : ""
  }</div></div>`;
}

/** 徽章：kind 取值 green | red | yellow | blue | gray */
export function badge(text: string, kind: "green" | "red" | "yellow" | "blue" | "gray"): string {
  return `<span class="badge ${kind}">${escHtml(text)}</span>`;
}

/** 空表格行 */
export function emptyRow(cols: number, text = "暂无符合条件的数据记录"): string {
  return `<tr><td colspan="${cols}" class="empty-cell"><div class="empty-state"><span class="empty-ico">📭</span><span>${escHtml(text)}</span></div></td></tr>`;
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
  return `<nav class="pager no-print">${
    cur > 1 ? `<a href="${escHtml(href(cur - 1))}">‹ 上一页</a>` : `<span class="disabled">‹ 上一页</span>`
  }${nums}${
    cur < total ? `<a href="${escHtml(href(cur + 1))}">下一页 ›</a>` : `<span class="disabled">下一页 ›</span>`
  }<span class="pager-info">第 ${cur} / ${total} 页</span></nav>`;
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
  const back = ctx.user ? (ctx.user.role === "customer" ? "/catalog" : "/dashboard") : "/login";
  const content = `<div class="error-wrap"><div class="code">${code}</div><h2>${escHtml(title)}</h2><p class="muted">${escHtml(msg)}</p><p class="mt"><a class="btn primary" href="${back}">← 返回安全页面</a></p></div>`;
  return layout({ title: `${code} ${title}`, ctx, content });
}
