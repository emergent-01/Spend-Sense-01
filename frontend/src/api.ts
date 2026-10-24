import { storage } from "@/src/utils/storage";

export const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL as string;
export const TOKEN_KEY = "auth_token";

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export async function getToken(): Promise<string | null> {
  return (await storage.secureGet<string | null>(TOKEN_KEY, null)) as string | null;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = "Something went wrong";
    try {
      const d = JSON.parse(text);
      if (typeof d.detail === "string") msg = d.detail;
      else if (Array.isArray(d.detail)) msg = d.detail[0]?.msg ?? msg;
    } catch {}
    if (res.status === 401 && token) onUnauthorized?.();
    throw new Error(msg);
  }
  if (opts.raw) return text as unknown as T;
  return text ? JSON.parse(text) : (null as T);
}

export type Tx = {
  id: string;
  ts: string;
  amount: number;
  direction: "debit" | "credit";
  category: string;
  needs_review: boolean;
  reimbursable: boolean;
  is_salary: boolean;
  source: string;
  merchant_key: string | null;
  merchant: string;
  vpa: string | null;
  card_last4: string | null;
  account: string | null;
  bank: string | null;
  mode: string | null;
  note: string;
  raw: string[];
  merged_count: number;
};

export type Budget = {
  category: string;
  budget: number;
  spent: number;
  pct: number;
  remaining: number;
  projected: number;
  expected_pct: number;
  status: "none" | "ok" | "warning" | "danger" | "over";
  count: number;
  day: number;
  days_in_month: number;
};

export type Recurring = {
  merchant_key: string;
  merchant: string;
  category: string;
  amount: number;
  expected_day: number;
  months_seen: number;
  last_charged: string | null;
  charged_this_month: boolean;
  status: "active" | "cancelled";
  warning: "missing" | "still_charging" | null;
  source: string;
};

export type Alert = {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "error";
  read: boolean;
  created_at: string;
};
