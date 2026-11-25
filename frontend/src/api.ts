import { storage } from "@/src/utils/storage";
import { uploadForm } from "@/src/utils/upload";

export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
export const TOKEN_KEY = "auth_token";

export type Profile = {
  name: string;
  household_size: number;
  weekly_budget: number;
  currency: string;
  appliances: string[];
  family_mode: boolean;
  allergies: string[];
  diets: string[];
  stores: string[];
  onboarded: boolean;
};
export type User = { id: string; email: string; profile: Profile };
export type PantryItem = { id: string; name: string; quantity: string; category: string; expiry_date: string | null };
export type Ingredient = { name: string; quantity: string; from_pantry: boolean };
export type Nutrition = { calories: number; protein: number; carbs: number; fat: number; fiber: number };
export type MealLog = Nutrition & { id: string; date: string; meal_type: string; name: string; recipe_id: string };
export type CalendarEntry = { id: string; date: string; meal_type: string; title: string; note: string; ingredients: string[] };
export type DayData = { date: string; meals: Recipe[]; logs: MealLog[]; totals: Nutrition };
export const MEAL_TYPES = ["Breakfast", "Lunch", "Snack", "Dinner"] as const;
export const DEFAULT_STORES = ["Walmart", "Fortinos", "Sobeys", "No Frills", "Longos", "Costco"];
export type Quest = { key: string; title: string; target: number; points: number; icon: string; progress: number; complete: boolean; claimed: boolean };
export type Badge = { key: string; title: string; desc: string; target: number; icon: string; progress: number; earned: boolean };
export type Rewards = { points: number; level: string; level_number: number; next_level_at: number | null; week: string; quests: Quest[]; badges: Badge[]; recent: { type: string; points: number; date: string }[] };
export type Recipe = {
  date: string;
  status: "proposed" | "accepted" | "manual" | "declined" | "";
  favorite: boolean;
  eaten_log_id: string;
  cooked: boolean;
  nutrition: Nutrition;
  id: string;
  source: string;
  meal_type: string;
  title: string;
  description: string;
  time_minutes: number;
  servings: number;
  est_cost: number;
  appliance: string;
  ingredients: Ingredient[];
  steps: string[];
  uses_expiring: string[];
};
export type PlanDay = { day: string; date: string; meals: Recipe[] };
export type MealPlan = { id: string; status: "generating" | "ready" | "failed"; error: string; week_start: string; days: PlanDay[]; total_cost: number; tips: string[]; created_at: string; grocery?: { store_totals: Record<string, number>; cheapest_store: string; substitutions: string[]; budget: number } };
export type ShoppingItem = { id: string; name: string; quantity: string; aisle: string; est_cost: number; checked: boolean; source: string; needed_for: { recipe_id: string; title: string; quantity: string }[]; reason: string; pantry_have: string; product: string; prices: Record<string, number> };
export type FoodEstimate = { name: string; serving_label: string; serving_g: number; density_g_per_ml: number; unit_grams: Record<string, number>; per_100g: Nutrition; suggested_quantity: number; suggested_unit: string };
export type ScannedItem = { name: string; quantity: string; category: string; expiry_date: string | null };

export async function getToken(): Promise<string | null> {
  return storage.secureGet<string | null>(TOKEN_KEY, null);
}

async function parse(res: Response | { ok: boolean; status: number; text: () => Promise<string> }) {
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const detail = typeof data.detail === "string" ? data.detail : Array.isArray(data.detail) ? data.detail[0]?.msg : null;
    const err: any = new Error(detail || `Something went wrong (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BACKEND_URL}/api${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return parse(res);
}

export async function uploadScan<T = any>(path: string, asset: { uri: string; fileName?: string | null; mimeType?: string | null }): Promise<T> {
  const token = await getToken();
  const res = await uploadForm(`${BACKEND_URL}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    files: { file: { uri: asset.uri, name: asset.fileName ?? "scan.jpg", mimeType: asset.mimeType ?? "image/jpeg" } },
  });
  return parse(res as any);
}

export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export function todayISO(): string {
  return toISO(new Date());
}

export function toISO(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
