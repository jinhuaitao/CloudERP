// 通用工具：转义、格式化、密码学、校验、CSV、分页
import { hash as bHash, compare as bCompare } from "bcryptjs";
import type { Context } from "hono";
import type { AppEnv } from "./env";

/** HTML 转义 */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 金额格式化 */
export function money(n: number | null | undefined): string {
  const v = Number(n || 0);
  return "¥" + v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 数量格式化（去多余小数） */
export function qty(n: number | null | undefined): string {
  const v = Number(n || 0);
  return String(Math.round(v * 100) / 100);
}

export function nowISO(): string {
  return new Date().toISOString();
}

/** "2026-10-18T12:00:00.000Z" -> "2026-10-18 20:00"（按东八区展示） */
export function fmtDT(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = (x: number) => String(x).padStart(2, "0");
  const t = new Date(d.getTime() + 8 * 3600 * 1000); // UTC+8
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

export function fmtDate(iso?: string | null): string {
  return fmtDT(iso).slice(0, 10);
}

/** 东八区今天的日期 "YYYY-MM-DD" */
export function todayUTC8(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 东八区某日期对应 UTC 起止 ISO（供 D1 created_at 范围查询用） */
export function utc8Range(dateStr: string): { start: string; end: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  const startUTC = Date.UTC(y, m - 1, d, 0, 0, 0) - 8 * 3600 * 1000;
  return { start: new Date(startUTC).toISOString(), end: new Date(startUTC + 86400000).toISOString() };
}

/** 单号生成：前缀 + 日期 + 4位随机，如 PO202610180123 */
export function uid(prefix: string): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  const date = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}${date}${rand}`;
}

// ---------- 密码学 ----------

export async function hashPassword(pw: string): Promise<string> {
  return bHash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  try {
    return await bCompare(pw, hash);
  } catch {
    return false;
  }
}

/** 密保答案归一化：去首尾空格、转小写、全角转半角 */
export function normAnswer(s: string): string {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "");
}

export async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hashAnswer(s: string): Promise<string> {
  return sha256hex("secqa:" + normAnswer(s));
}

/** 随机 token（会话 / CSRF 用） */
export function randHex(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- 请求信息 ----------

export function clientIP(c: Context<AppEnv>): string {
  return (
    c.req.header("CF-Connecting-IP") ||
    (c.req.header("X-Forwarded-For") || "").split(",")[0].trim() ||
    "unknown"
  );
}

export function userAgent(c: Context<AppEnv>): string {
  return (c.req.header("User-Agent") || "").slice(0, 200);
}

// ---------- 分页 ----------

export function getPagination(c: Context<AppEnv>, defSize = 20): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query("pageSize") || String(defSize), 10) || defSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

// ---------- CSV 导出（BOM 防中文乱码 + 公式注入防护） ----------

function csvCell(v: string | number | null | undefined): string {
  let s = String(v ?? "");
  // 公式注入防护：以 = + - @ 开头的单元格加前导单引号
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCSV(rows: (string | number | null | undefined)[][]): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

// ---------- 表单校验 ----------

export function validateUsername(u: string): string | null {
  u = (u || "").trim();
  if (u.length < 3 || u.length > 32) return "用户名长度需在 3-32 个字符之间";
  if (!/^[a-zA-Z0-9_.\u4e00-\u9fa5-]+$/.test(u)) return "用户名仅支持字母、数字、下划线、横线、中文";
  return null;
}

export function validatePassword(p: string): string | null {
  if (!p || p.length < 6) return "密码长度至少 6 位";
  if (p.length > 64) return "密码长度不能超过 64 位";
  return null;
}

/** 管理员是否被锁定（登录限流）：5 次失败 / 15 分钟 */
export function isLocked(failCount: number, maxAttempts: number): boolean {
  return failCount >= maxAttempts;
}

/** R2 对象 key 生成 */
export function r2Key(prefix: string, filename: string): string {
  const ext = (filename.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${prefix}/${d.getFullYear()}${p(d.getMonth() + 1)}/${Date.now()}-${randHex(4)}.${ext}`;
}

/** 从 multipart 表单安全读取文件 */
export function validImage(file: File | null, maxMB: number): string | null {
  if (!file || file.size === 0) return null; // 没上传算合法（可选上传）
  const okType = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type);
  if (!okType) return "仅支持 JPG / PNG / WebP / GIF 图片";
  if (file.size > maxMB * 1024 * 1024) return `图片不能超过 ${maxMB}MB`;
  return null;
}
