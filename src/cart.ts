// 客户自助订货购物车：轻量 Cookie 存储（仅商品 id 与数量），由服务端渲染成订单明细
// 说明：购物车不是账务数据，不落 D1；Cookie 只保存 [[id, qty], ...]，价格一律以数据库实时售价为准
import type { Context } from "hono";
import type { AppEnv } from "./env";

export const CART_COOKIE = "jc_cart";
/** 单车最多行数（防止超长 Cookie 被浏览器丢弃） */
export const CART_MAX_LINES = 30;
/** 单行最大数量（真正的库存校验仍由 createSalesOrder 完成） */
export const CART_MAX_QTY = 9999;
const CART_TTL_DAYS = 30;

export interface CartLine {
  id: number;
  qty: number;
}

/**
 * 解析购物车 Cookie。
 * 容错优先：非法 JSON、越界数量、重复商品、超长列表一律安全降级，绝不抛错。
 */
export function parseCart(raw: string | null | undefined): CartLine[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(decodeURIComponent(raw));
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const out: CartLine[] = [];
  const seen = new Set<number>();
  for (const entry of data) {
    let rawId: unknown;
    let rawQty: unknown;
    if (Array.isArray(entry)) {
      rawId = entry[0];
      rawQty = entry[1];
    } else if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      rawId = o.i ?? o.id;
      rawQty = o.q ?? o.qty;
    } else {
      continue;
    }
    const id = Math.trunc(Number(rawId));
    const qty = Math.round(Number(rawQty) * 100) / 100;
    if (!Number.isFinite(id) || !Number.isFinite(qty) || id <= 0 || qty <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, qty: Math.min(qty, CART_MAX_QTY) });
    if (out.length >= CART_MAX_LINES) break;
  }
  return out;
}

/** 从请求 Cookie 中读取购物车 */
export function readCart(c: Context<AppEnv>): CartLine[] {
  const m = (c.req.header("cookie") || "").match(/(?:^|;\s*)jc_cart=([^;]*)/);
  return parseCart(m ? m[1] : null);
}

/** 写入购物车的 Set-Cookie 值（供客户端 JS 与服务端保持一致格式） */
export function cartCookieHeader(lines: CartLine[]): string {
  const compact = lines.slice(0, CART_MAX_LINES).map((l) => [l.id, l.qty]);
  const value = encodeURIComponent(JSON.stringify(compact));
  return `${CART_COOKIE}=${value}; Path=/; Max-Age=${CART_TTL_DAYS * 86400}; SameSite=Lax`;
}

/** 清空购物车的 Set-Cookie 值 */
export function clearCartCookieHeader(): string {
  return `${CART_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
