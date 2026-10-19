// 环境与上下文类型
export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  APP_NAME?: string;
  SESSION_TTL_HOURS?: string;
  REMEMBER_TTL_DAYS?: string;
  MAX_LOGIN_ATTEMPTS?: string;
  LOCK_MINUTES?: string;
  MAX_UPLOAD_MB?: string;
}

// 脱敏后的登录用户信息（放进请求上下文）
export interface SafeUser {
  id: number;
  username: string;
  role: "admin" | "sales" | "customer";
  nickname: string;
  sales_level: number;
  parent_id: number | null;
  avatar_key: string;
  /** 客户可用余额（元），仅 customer 有实际意义 */
  balance: number;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: SafeUser | null;
    csrfToken: string;
    settings: Record<string, string>;
    lowStockCount: number;
  };
};

export function toSafeUser(u: {
  id: number;
  username: string;
  role: string;
  nickname: string;
  sales_level: number;
  parent_id: number | null;
  avatar_key: string;
  balance?: number;
}): SafeUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role as SafeUser["role"],
    nickname: u.nickname || u.username,
    sales_level: u.sales_level,
    parent_id: u.parent_id,
    avatar_key: u.avatar_key,
    balance: u.balance || 0,
  };
}
