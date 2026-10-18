// 初始化 / 登录 / 注册 / 找回密码
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Context } from "hono";
import { Store } from "../db";
import type { User } from "../db";
import {
  hashPassword,
  verifyPassword,
  hashAnswer,
  sha256hex,
  randHex,
  validateUsername,
  validatePassword,
  clientIP,
  userAgent,
} from "../lib";
import type { AppEnv, SafeUser } from "../env";
import { layout, errorPage } from "../views/layout";
import { setupPage, loginPage, registerPage, forgotPage } from "../views/auth";
import {
  store,
  looseCtx,
  parseForm,
  redirectWith,
  sidFromCookie,
  isHttps,
} from "./helpers";

function homeFor(role: SafeUser["role"]): string {
  return role === "customer" ? "/catalog" : "/dashboard";
}

/** 创建登录会话，返回待设置的 Set-Cookie 头值 */
async function issueSession(
  c: Context<AppEnv>,
  s: Store,
  u: User,
  remember: boolean
): Promise<{ token: string; cookie: string; maxAge: number }> {
  const ip = clientIP(c);
  const token = randHex();
  const digest = await sha256hex(token);
  const ttlMs = remember ? 30 * 86400000 : 12 * 3600000;
  await s.createSession(digest, u.id, new Date(Date.now() + ttlMs).toISOString(), ip, userAgent(c));
  const maxAge = Math.floor(ttlMs / 1000);
  const secure = isHttps(c);
  return {
    token,
    maxAge,
    cookie: `sid=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`,
  };
}

/** 登录成功后的统一收尾：记录审计 + 带 cookie 跳转 */
async function finishLogin(
  c: Context<AppEnv>,
  s: Store,
  u: User,
  remember: boolean,
  msg?: string
): Promise<Response> {
  const { cookie } = await issueSession(c, s, u, remember);
  await s.audit(u.id, "登录", "账号", `用户 ${u.username} 登录成功`, clientIP(c));
  const res = redirectWith(c, homeFor(u.role as SafeUser["role"]), msg);
  res.headers.append("Set-Cookie", cookie);
  return res;
}

export function registerSetupAuth(app: Hono<AppEnv>) {
  // ---------- 初始化 ----------
  app.get("/setup", async (c) => {
    const s = store(c);
    if ((await s.countAdmins()) > 0) return c.redirect("/login", 302);
    const ctx = looseCtx(c);
    return c.html(layout({ title: "初始化设置", ctx, content: setupPage(ctx) }));
  });

  app.post("/setup", async (c) => {
    const s = store(c);
    try {
      if ((await s.countAdmins()) > 0) {
        throw new HTTPException(403, { res: c.html(errorPage(looseCtx(c), 403, "禁止访问", "系统已完成初始化，无需重复设置。"), 403) });
      }
      const { fields } = await parseForm(c);
      const username = (fields.username || "").trim();
      const password = fields.password || "";
      const nickname = (fields.nickname || "").trim();
      const q1 = (fields.q1 || "").trim();
      const a1 = (fields.a1 || "").trim();
      const q2 = (fields.q2 || "").trim();
      const a2 = (fields.a2 || "").trim();
      const err =
        validateUsername(username) ||
        validatePassword(password) ||
        (!nickname ? "昵称不能为空" : null) ||
        (password !== (fields.confirm || "") ? "两次输入的密码不一致" : null) ||
        (!q1 || !a1 || !q2 || !a2 ? "请完整填写两个密保问题及答案" : null) ||
        (q1 === q2 ? "两个密保问题不能相同" : null);
      if (err) return redirectWith(c, "/setup", undefined, err);
      if (await s.getUserByUsername(username)) return redirectWith(c, "/setup", undefined, "用户名已存在");
      const id = await s.createUser({
        username,
        password_hash: await hashPassword(password),
        role: "admin",
        nickname,
      });
      await s.setSecurityQuestions(id, q1, await hashAnswer(a1), q2, await hashAnswer(a2));
      await s.audit(id, "初始化", "管理员账号", `创建初始管理员 ${username}`, clientIP(c));
      return redirectWith(c, "/login", "管理员创建成功，请登录");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/setup", undefined, "初始化失败：" + (e as Error).message);
    }
  });

  // ---------- 登录 ----------
  app.get("/login", (c) => {
    const u = c.get("user");
    if (u) return c.redirect(homeFor(u.role), 302);
    const ctx = looseCtx(c);
    return c.html(layout({ title: "登录", ctx, content: loginPage(ctx) }));
  });

  app.post("/login", async (c) => {
    const s = store(c);
    try {
      const { fields } = await parseForm(c);
      const username = (fields.username || "").trim();
      const password = fields.password || "";
      const remember = fields.remember === "on" || fields.remember === "1";
      const ip = clientIP(c);
      const maxAttempts = parseInt(c.env.MAX_LOGIN_ATTEMPTS || "5", 10) || 5;
      if (username && (await s.countRecentFailures(username, ip, 15)) >= maxAttempts) {
        return redirectWith(c, "/login", undefined, "登录尝试过多，请15分钟后再试");
      }
      const u = username ? await s.getUserByUsername(username) : null;
      if (!u) {
        if (username) await s.recordLoginAttempt(username, ip, false);
        return redirectWith(c, "/login", undefined, "用户名或密码错误");
      }
      if (u.status !== "active") {
        await s.recordLoginAttempt(username, ip, false);
        return redirectWith(c, "/login", undefined, "账号已被禁用，请联系管理员");
      }
      if (!(await verifyPassword(password, u.password_hash))) {
        await s.recordLoginAttempt(username, ip, false);
        return redirectWith(c, "/login", undefined, "用户名或密码错误");
      }
      await s.recordLoginAttempt(username, ip, true);
      return await finishLogin(c, s, u, remember, "欢迎回来，" + (u.nickname || u.username));
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/login", undefined, "登录失败：" + (e as Error).message);
    }
  });

  app.post("/logout", async (c) => {
    const s = store(c);
    const sid = sidFromCookie(c);
    if (sid) {
      try {
        await s.deleteSession(await sha256hex(sid));
      } catch {
        /* 忽略 */
      }
    }
    const res = c.redirect("/login", 302);
    res.headers.append("Set-Cookie", "sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
    return res;
  });

  // ---------- 注册 ----------
  app.get("/register", (c) => {
    const u = c.get("user");
    if (u) return c.redirect(homeFor(u.role), 302);
    const allow = c.get("settings").allow_register === "1";
    const ctx = looseCtx(c);
    return c.html(layout({ title: "注册", ctx, content: registerPage(ctx, allow) }));
  });

  app.post("/register", async (c) => {
    const s = store(c);
    try {
      if (c.get("settings").allow_register !== "1") {
        return redirectWith(c, "/register", undefined, "当前未开放自主注册");
      }
      const { fields } = await parseForm(c);
      const username = (fields.username || "").trim();
      const password = fields.password || "";
      const nickname = (fields.nickname || "").trim();
      const q1 = (fields.q1 || "").trim();
      const a1 = (fields.a1 || "").trim();
      const q2 = (fields.q2 || "").trim();
      const a2 = (fields.a2 || "").trim();
      const err =
        validateUsername(username) ||
        validatePassword(password) ||
        (!nickname ? "昵称不能为空" : null) ||
        (password !== (fields.confirm || "") ? "两次输入的密码不一致" : null) ||
        (!q1 || !a1 || !q2 || !a2 ? "请完整填写两个密保问题及答案" : null) ||
        (q1 === q2 ? "两个密保问题不能相同" : null) ||
        (a1.length < 2 || a2.length < 2 ? "密保答案至少 2 个字符" : null);
      if (err) return redirectWith(c, "/register", undefined, err);
      if (await s.getUserByUsername(username)) return redirectWith(c, "/register", undefined, "用户名已存在");
      const id = await s.createUser({
        username,
        password_hash: await hashPassword(password),
        role: "customer",
        nickname,
      });
      await s.setSecurityQuestions(id, q1, await hashAnswer(a1), q2, await hashAnswer(a2));
      await s.audit(id, "注册", "账号", `客户 ${username} 自主注册`, clientIP(c));
      return redirectWith(c, "/login", "注册成功，请登录");
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/register", undefined, "注册失败：" + (e as Error).message);
    }
  });

  // ---------- 找回密码 ----------
  app.get("/forgot", (c) => {
    const ctx = looseCtx(c);
    return c.html(layout({ title: "找回密码", ctx, content: forgotPage(ctx, "username") }));
  });

  app.post("/forgot", async (c) => {
    const s = store(c);
    try {
      const { fields } = await parseForm(c);
      const username = (fields.username || "").trim();
      if (!username) return redirectWith(c, "/forgot", undefined, "请输入用户名");
      const u = await s.getUserByUsername(username);
      const secq = u ? await s.getSecurityQuestions(u.id) : null;
      if (!u || !secq) return redirectWith(c, "/forgot", undefined, "用户不存在或未设置密保问题");
      if ((await s.countRecentRecoveryFailures(username, 15)) >= 5) {
        return redirectWith(c, "/forgot", undefined, "验证尝试过多，请15分钟后再试");
      }
      const ctx = looseCtx(c);
      return c.html(
        layout({
          title: "找回密码",
          ctx,
          content: forgotPage(ctx, "questions", { username, q1: secq.q1, q2: secq.q2 }),
        })
      );
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/forgot", undefined, "操作失败：" + (e as Error).message);
    }
  });

  app.post("/forgot/verify", async (c) => {
    const s = store(c);
    try {
      const { fields } = await parseForm(c);
      const username = (fields.username || "").trim();
      const a1 = fields.a1 || "";
      const a2 = fields.a2 || "";
      const ip = clientIP(c);
      const u = username ? await s.getUserByUsername(username) : null;
      const secq = u ? await s.getSecurityQuestions(u.id) : null;
      if (!u || !secq) return redirectWith(c, "/forgot", undefined, "用户不存在或未设置密保问题");
      if (u.status !== "active") return redirectWith(c, "/forgot", undefined, "账号已被禁用，请联系管理员");
      if ((await s.countRecentRecoveryFailures(username, 15)) >= 5) {
        return redirectWith(c, "/forgot", undefined, "验证尝试过多，请15分钟后再试");
      }
      const ok = (await hashAnswer(a1)) === secq.a1_hash && (await hashAnswer(a2)) === secq.a2_hash;
      if (!ok) {
        await s.recordRecoveryAttempt(username, ip, false);
        return redirectWith(c, "/forgot", undefined, "密保答案不正确，请重试");
      }
      await s.recordRecoveryAttempt(username, ip, true);
      // 验证通过：直接创建会话登录（12 小时有效期）
      const { cookie } = await issueSession(c, s, u, false);
      await s.audit(u.id, "找回密码", "账号", "通过密保验证登录", ip);
      const res = redirectWith(c, "/profile/password", "身份验证通过，请立即设置新密码");
      res.headers.append("Set-Cookie", cookie);
      return res;
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      return redirectWith(c, "/forgot", undefined, "操作失败：" + (e as Error).message);
    }
  });
}
