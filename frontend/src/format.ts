import dayjs from "dayjs";
import type { ThemeColors } from "@/src/theme";

export const SPEND_CATEGORIES = [
  "Food", "Groceries", "Transport", "Shopping", "Bills & Utilities",
  "Entertainment", "Health", "Travel", "Rent", "Other",
];
export const P2P = "Transfer / P2P";
export const DEBIT_CATEGORIES = [...SPEND_CATEGORIES, P2P];
export const INCOME_CATEGORIES = ["Income", "Refund", "Transfer In"];

export const CATEGORY_ICON: Record<string, string> = {
  Food: "fast-food-outline",
  Groceries: "basket-outline",
  Transport: "car-outline",
  Shopping: "bag-handle-outline",
  "Bills & Utilities": "flash-outline",
  Entertainment: "film-outline",
  Health: "medkit-outline",
  Travel: "airplane-outline",
  Rent: "home-outline",
  Other: "ellipsis-horizontal-circle-outline",
  "Transfer / P2P": "people-outline",
  Income: "cash-outline",
  Refund: "return-down-back-outline",
  "Transfer In": "arrow-down-circle-outline",
};

export function categoryColor(c: ThemeColors, cat: string): string {
  const list = [c.chart1, c.chart2, c.chart3, c.chart4, c.chart5, c.chart6, c.chart7, c.chart8, c.chart9, c.chart10];
  const i = SPEND_CATEGORIES.indexOf(cat);
  return i >= 0 ? list[i] : c.chart9;
}

function group(n: number): string {
  const s = String(Math.floor(Math.abs(n)));
  if (s.length <= 3) return s;
  const head = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${head},${s.slice(-3)}`;
}

export function inr(n: number, decimals = false): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  let out = "₹" + group(decimals ? abs : Math.round(abs));
  if (decimals) {
    const frac = Math.round((abs % 1) * 100);
    if (frac) out += "." + String(frac).padStart(2, "0");
  }
  return neg ? "-" + out : out;
}

export function compactInr(n: number): string {
  const a = Math.abs(n);
  if (a >= 100000) return `${n < 0 ? "-" : ""}₹${(a / 100000).toFixed(a >= 1000000 ? 0 : 1)}L`;
  if (a >= 1000) return `${n < 0 ? "-" : ""}₹${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k`;
  return inr(n);
}

export const currentMonth = () => dayjs().format("YYYY-MM");
export const monthLabel = (m: string) => dayjs(m + "-01").format("MMMM YYYY");
export const shiftMonth = (m: string, d: number) => dayjs(m + "-01").add(d, "month").format("YYYY-MM");

export function dayLabel(iso: string): string {
  const d = dayjs(iso);
  if (d.isSame(dayjs(), "day")) return "Today";
  if (d.isSame(dayjs().subtract(1, "day"), "day")) return "Yesterday";
  return d.format("ddd, D MMM YYYY");
}
