// 认证相关页面：初始化向导 / 登录 / 注册 / 找回密码（均为未登录居中卡片样式）
import { esc } from "../lib";
import { layout, csrfInput, field, type ViewCtx } from "./layout";

/** 密保问题字段组（初始化 / 注册共用） */
function secQFields(): string {
  return `
    <h3 class="mt">🔑 密保问题</h3>
    <p class="muted small">用于找回密码，请牢记答案（答案不区分大小写）</p>
    ${field(
      "密保问题 1",
      `<input type="text" name="q1" maxlength="100" required placeholder="例如：我的小学班主任是谁？">`,
      "",
      true
    )}
    ${field("答案 1", `<input type="text" name="a1" maxlength="100" required autocomplete="off">`, "", true)}
    ${field("密保问题 2", `<input type="text" name="q2" maxlength="100" required>`, "", true)}
    ${field("答案 2", `<input type="text" name="a2" maxlength="100" required autocomplete="off">`, "", true)}`;
}

/** 首次初始化向导：创建管理员账号 */
export function setupPage(ctx: ViewCtx): string {
  const content = `
    <h1 class="auth-title">🎉 首次使用</h1>
    <p class="auth-sub">欢迎使用进销通，请先创建管理员账号</p>
    <form method="post" action="/setup">
      ${csrfInput(ctx.csrf)}
      ${field(
        "管理员用户名",
        `<input type="text" name="username" required minlength="3" maxlength="32" autocomplete="username" placeholder="3-32 位：字母 / 数字 / 中文 / 下划线">`,
        "",
        true
      )}
      ${field(
        "登录密码",
        `<input type="password" name="password" required minlength="6" maxlength="64" autocomplete="new-password" placeholder="至少 6 位">`,
        "",
        true
      )}
      ${field(
        "确认密码",
        `<input type="password" name="confirm_password" required minlength="6" maxlength="64" autocomplete="new-password" placeholder="再次输入密码">`,
        "",
        true
      )}
      ${field("昵称", `<input type="text" name="nickname" maxlength="32" placeholder="用于界面显示，默认为用户名">`)}
      ${secQFields()}
      <button class="btn primary block mt" type="submit">🚀 创建管理员并进入系统</button>
    </form>`;
  return layout({ title: "初始化", ctx, content });
}

/** 登录页 */
export function loginPage(ctx: ViewCtx): string {
  const appName = esc(ctx.settings.site_name || ctx.appName || "进销通");
  const content = `
    <h1 class="auth-title">🔐 登录</h1>
    <p class="auth-sub">欢迎回来，${appName}</p>
    <form method="post" action="/login">
      ${csrfInput(ctx.csrf)}
      ${field(
        "用户名",
        `<input type="text" name="username" required maxlength="32" autocomplete="username" placeholder="请输入用户名">`,
        "",
        true
      )}
      ${field(
        "密码",
        `<input type="password" name="password" required maxlength="64" autocomplete="current-password" placeholder="请输入密码">`,
        "",
        true
      )}
      <div class="checkbox-row mb">
        <input type="checkbox" id="remember" name="remember" value="1">
        <label for="remember">记住我（30 天免登录）</label>
      </div>
      <button class="btn primary block" type="submit">登录</button>
    </form>
    <div class="auth-links">
      <a href="/register">📝 注册账号</a>
      <a href="/forgot">❓ 忘记密码</a>
    </div>`;
  return layout({ title: "登录", ctx, content });
}

/** 注册页（客户自助注册） */
export function registerPage(ctx: ViewCtx, allow: boolean): string {
  if (!allow) {
    const content = `
      <h1 class="auth-title">🚫 注册已关闭</h1>
      <p class="auth-sub">当前系统不开放自主注册，请联系管理员为您开通账号</p>
      <a class="btn primary block" href="/login">返回登录</a>`;
    return layout({ title: "注册", ctx, content });
  }
  const content = `
    <h1 class="auth-title">📝 注册账号</h1>
    <p class="auth-sub">注册后即成为客户，可浏览商品并自助下单</p>
    <form method="post" action="/register">
      ${csrfInput(ctx.csrf)}
      ${field(
        "用户名",
        `<input type="text" name="username" required minlength="3" maxlength="32" autocomplete="username" placeholder="3-32 位：字母 / 数字 / 中文 / 下划线">`,
        "",
        true
      )}
      ${field(
        "密码",
        `<input type="password" name="password" required minlength="6" maxlength="64" autocomplete="new-password" placeholder="至少 6 位">`,
        "",
        true
      )}
      ${field(
        "确认密码",
        `<input type="password" name="confirm_password" required minlength="6" maxlength="64" autocomplete="new-password">`,
        "",
        true
      )}
      ${field("昵称", `<input type="text" name="nickname" maxlength="32" placeholder="用于界面显示">`)}
      ${field("手机号", `<input type="tel" name="phone" maxlength="20" autocomplete="tel" placeholder="选填，方便商家联系">`)}
      ${secQFields()}
      <button class="btn primary block mt" type="submit">✅ 注册</button>
    </form>
    <div class="auth-links">
      <a href="/login">已有账号？去登录</a>
    </div>`;
  return layout({ title: "注册", ctx, content });
}

/** 找回密码：三阶段向导 */
export function forgotPage(
  ctx: ViewCtx,
  stage: "username" | "questions" | "done",
  d?: { username?: string; q1?: string; q2?: string }
): string {
  let body = "";
  if (stage === "username") {
    body = `
      <h1 class="auth-title">❓ 找回密码</h1>
      <p class="auth-sub">第一步：请输入您的用户名</p>
      <form method="post" action="/forgot">
        ${csrfInput(ctx.csrf)}
        ${field(
          "用户名",
          `<input type="text" name="username" required maxlength="32" autocomplete="username" placeholder="请输入注册时的用户名">`,
          "",
          true
        )}
        <button class="btn primary block" type="submit">下一步</button>
      </form>`;
  } else if (stage === "questions") {
    body = `
      <h1 class="auth-title">🔑 身份验证</h1>
      <p class="auth-sub">请回答您设置的两道密保问题</p>
      <form method="post" action="/forgot/verify">
        ${csrfInput(ctx.csrf)}
        <input type="hidden" name="username" value="${esc(d?.username || "")}">
        <div class="field"><label>问题 1</label><p><strong>${esc(d?.q1 || "")}</strong></p>
          <input type="text" name="a1" required maxlength="100" autocomplete="off" placeholder="请输入答案 1">
        </div>
        <div class="field"><label>问题 2</label><p><strong>${esc(d?.q2 || "")}</strong></p>
          <input type="text" name="a2" required maxlength="100" autocomplete="off" placeholder="请输入答案 2">
        </div>
        <button class="btn primary block" type="submit">验证</button>
      </form>`;
  } else {
    body = `
      <h1 class="auth-title">✅ 验证通过</h1>
      <p class="auth-sub">身份验证通过，已为你自动登录<br>请尽快前往个人中心修改密码，并妥善保管密保答案</p>
      <a class="btn primary block" href="/profile/password">🔒 去修改密码</a>
      <div class="auth-links"><a href="/dashboard">直接进入系统</a></div>`;
  }
  const content = `${body}<div class="auth-links"><a href="/login">返回登录</a></div>`;
  return layout({ title: "找回密码", ctx, content });
}
