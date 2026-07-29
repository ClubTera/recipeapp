import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 'YYYY-MM-DD' 文字列を、タイムゾーンのずれなくローカル日付として扱う */
export function parseDate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** その週の月曜日を返す */
export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const dow = d.getDay(); // 0=日
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function formatDateLabel(date: Date | string): string {
  const d = typeof date === "string" ? parseDate(date) : date;
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

export function formatShortDate(date: Date | string): string {
  const d = typeof date === "string" ? parseDate(date) : date;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function weekdayLabel(date: Date | string): string {
  const d = typeof date === "string" ? parseDate(date) : date;
  return WEEKDAYS[d.getDay()];
}

export function isToday(date: Date | string): boolean {
  const d = typeof date === "string" ? parseDate(date) : date;
  return toDateString(d) === toDateString(new Date());
}

/** 「3分前」「昨日」のような相対表記 */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 60) return "たった今";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}時間前`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}日前`;
  return formatDateLabel(new Date(then));
}

export const SLOT_LABELS: Record<string, string> = {
  breakfast: "朝食",
  lunch: "昼食",
  dinner: "夕食",
};

export const SLOT_SHORT: Record<string, string> = {
  breakfast: "朝",
  lunch: "昼",
  dinner: "夕",
};

export const MEAL_SLOTS = ["breakfast", "lunch", "dinner"] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  vegetable: "野菜",
  meat_fish: "肉・魚",
  dairy: "乳製品・卵",
  seasoning: "調味料",
  other: "その他",
};

export const CATEGORY_ORDER = ["vegetable", "meat_fish", "dairy", "seasoning", "other"] as const;

export const SOURCE_LABELS: Record<string, string> = {
  web: "Web",
  youtube: "YouTube",
  tiktok: "TikTok",
  x: "X",
  instagram: "Instagram",
  original: "自作",
};
