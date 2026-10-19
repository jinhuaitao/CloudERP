// 认证相关页面：初始化向导 / 登录 / 注册 / 找回密码（返回纯 HTML 片段，由路由层包裹 layout）
import { esc } from "../lib";
import { csrfInput, field, type ViewCtx } from "./layout";

/** 密保问题字段组（初始化 / 注册共用） */
function secQFields(): string {
  return `
    <div class="auth-secq-box">
      <div class="auth-secq-title">🔑 密保安全问题设置</div>
      <p class="muted small mb">用于忘记密码时自助验证身份，答案自动忽略空格与大小写</p>
      <div class="form-row">
        ${field(
          "密保问题 1",
          `<input type="text" name="q1" maxlength="100" required value="我的出生地或家乡是哪里？" placeholder="例如：我的小学班主任是谁？">`,
          "",
          true
        )}
        ${field("问题 1 答案", `<input type="text" name="a1" minlength="2" maxlength="100" required autocomplete="off" placeholder="至少 2 个字符">`, "", true)}
      </div>
      <div class="form-row">
        ${field(
          "密保问题 2",
          `<input type="text" name="q2" maxlength="100" required value="我最难忘的宠物或朋友名字？" placeholder="例如：我的第一份工作所在城市？">`,
          "",
          true
        )}
        ${field("问题 2 答案", `<input type="text" name="a2" minlength="2" maxlength="100" required autocomplete="off" placeholder="至少 2 个字符">`, "", true)}
      </div>
    </div>`;
}

/** 首次初始化向导：创建管理员账号 */
export function setupPage(ctx: ViewCtx): string {
  return `
    <div class="auth-header">
      <span class="badge blue">系统初始化向导</span>
      <h1 class="auth-title">创建超级管理员</h1>
      <p class="auth-sub">首次启用进销通，请设置管理员账号与密保问题（系统无默认密码）</p>
    </div>
    <form method="post" action="/setup">
      ${csrfInput(ctx.csrf)}
      <div class="form-row">
        ${field(
          "管理员用户名",
          `<input type="text" name="username" required minlength="3" maxlength="32" autocomplete="username" placeholder="3-32 位字母/数字/中文">`,
          "",
          true
        )}
        ${field("显示昵称", `<input type="text" name="nickname" required maxlength="32" placeholder="如：系统管理员">`, "", true)}
      </div>
      <div class="form-row">
        ${field(
          "登录密码",
          `<input type="password" name="password" required minlength="6" maxlength="64" autocomplete="new-password" placeholder="至少 6 位字符">`,
          "",
          true
        )}
        ${field(
          "确认密码",
          `<input type="password" name="confirm_password" required minlength="6" maxlength="64" autocomplete="new-password" placeholder="再次输入登录密码">`,
          "",
          true
        )}
      </div>
      ${secQFields()}
      <button class="btn primary block mt" type="submit">🚀 完成初始化并进入系统</button>
    </form>`;
}

/** 登录页 */
export function loginPage(ctx: ViewCtx): string {
  const appName = esc(ctx.settings.site_name || ctx.appName || "进销通");
  const allowReg = ctx.settings.allow_register !== "0";
  return `
    <div class="auth-header">
      <span class="badge blue">安全认证中心</span>
      <h1 class="auth-title">登录 ${appName}</h1>
      <p class="auth-sub">请输入您的管理员、销售员或客户账号凭证</p>
    </div>
    <form method="post" action="/login">
      ${csrfInput(ctx.csrf)}
      ${field(
        "登录账号",
        `<input type="text" name="username" required maxlength="32" autocomplete="username" placeholder="请输入用户名" autofocus>`,
        "",
        true
      )}
      ${field(
        "登录密码",
        `<input type="password" name="password" required maxlength="64" autocomplete="current-password" placeholder="请输入登录密码">`,
        "",
        true
      )}
      <div class="auth-options-row mb">
        <label class="checkbox-row">
          <input type="checkbox" id="remember" name="remember" value="1">
          <span>保持登录状态（30 天）</span>
        </label>
        <a href="/forgot" class="small">忘记密码？</a>
      </div>
      <button class="btn primary block" type="submit">立即登录 →</button>
    </form>
    <div class="auth-links">
      ${allowReg ? `还没有客户账号？ <a href="/register"><strong>免费注册客户账号</strong></a>` : `<span class="muted">如需开通账号请联系企业管理员</span>`}
    </div>`;
}

/** 注册页（客户自助注册，支持录入或注册后进入个人中心配置收货人、电话与地址） */
export function registerPage(ctx: ViewCtx, allow: boolean): string {
  if (!allow) {
    return `
      <div class="auth-header">
        <span class="badge yellow">访问受限</span>
        <h1 class="auth-title">暂未开放自助注册</h1>
        <p class="auth-sub">当前企业已关闭自助注册通道，请联系管理员或专属销售代表为您开通账号。</p>
      </div>
      <a class="btn primary block" href="/login">← 返回登录页</a>`;
  }
  return `
    <div class="auth-header">
      <span class="badge green">客户入驻</span>
      <h1 class="auth-title">注册客户订货账号</h1>
      <p class="auth-sub">注册后将自动进入收货设置与订货中心，随时维护收货人、联系电话与配送地址</p>
    </div>
    <form method="post" action="/register">
      ${csrfInput(ctx.csrf)}
      <div class="form-row">
        ${field(
          "登录用户名",
          `<input type="text" name="username" required minlength="3" maxlength="32" autocomplete="username" placeholder="3-32 位字母/数字/中文">`,
          "",
          true
        )}
        ${field("客户名称 / 昵称", `<input type="text" name="nickname" required maxlength="32" placeholder="公司名称或您的称呼">`, "", true)}
      </div>
      <div class="form-row">
        ${field(
          "设置密码",
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
      </div>
      <div class="auth-secq-box mb">
        <div class="auth-secq-title">📍 默认收货信息（选填，注册后也可在「收货信息与个人中心」随时添加或修改）</div>
        <div class="form-row mt-xs">
          ${field("收货人姓名", `<input type="text" name="shipping_name" maxlength="32" placeholder="默认同客户昵称">`)}
          ${field("收货联系电话", `<input type="tel" name="phone" maxlength="20" autocomplete="tel" placeholder="手机或固话号码">`)}
        </div>
        ${field("详细收货地址", `<input type="text" name="address" maxlength="200" placeholder="省 / 市 / 区 / 街道门牌号，方便商家安排发货">`)}
      </div>
      ${secQFields()}
      <button class="btn primary block mt" type="submit">✅ 提交注册并进入收货设置</button>
    </form>
    <div class="auth-links">
      已有账号？ <a href="/login"><strong>返回登录</strong></a>
    </div>`;
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
      <div class="auth-header">
        <span class="badge yellow">步骤 1 / 2</span>
        <h1 class="auth-title">密保找回密码</h1>
        <p class="auth-sub">请输入您需要找回密码的用户名以读取密保问题</p>
      </div>
      <form method="post" action="/forgot">
        ${csrfInput(ctx.csrf)}
        ${field(
          "用户名",
          `<input type="text" name="username" required maxlength="32" autocomplete="username" placeholder="请输入注册时的用户名" autofocus>`,
          "",
          true
        )}
        <button class="btn primary block" type="submit">下一步：验证密保 →</button>
      </form>`;
  } else if (stage === "questions") {
    body = `
      <div class="auth-header">
        <span class="badge blue">步骤 2 / 2</span>
        <h1 class="auth-title">回答密保问题</h1>
        <p class="auth-sub">正在验证账号 <strong>@${esc(d?.username || "")}</strong> 的密保信息</p>
      </div>
      <form method="post" action="/forgot/verify">
        ${csrfInput(ctx.csrf)}
        <input type="hidden" name="username" value="${esc(d?.username || "")}">
        <div class="field">
          <label>密保问题 1</label>
          <div class="secq-prompt">${esc(d?.q1 || "")}</div>
          <input type="text" name="a1" required maxlength="100" autocomplete="off" placeholder="请输入问题 1 的答案" autofocus>
        </div>
        <div class="field">
          <label>密保问题 2</label>
          <div class="secq-prompt">${esc(d?.q2 || "")}</div>
          <input type="text" name="a2" required maxlength="100" autocomplete="off" placeholder="请输入问题 2 的答案">
        </div>
        <button class="btn primary block" type="submit">✅ 验证并登录重置密码</button>
      </form>`;
  } else {
    body = `
      <div class="auth-header">
        <span class="badge green">验证通过</span>
        <h1 class="auth-title">身份验证成功</h1>
        <p class="auth-sub">已为您建立临时安全会话，请立即前往设置新密码</p>
      </div>
      <a class="btn primary block" href="/profile/password">🔒 立即修改密码</a>`;
  }
  return `${body}<div class="auth-links"><a href="/login">← 返回登录页面</a></div>`;
}
