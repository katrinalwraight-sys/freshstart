import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, DayData, MealPlan, PantryItem, Recipe, Rewards, ShoppingItem } from "@/src/api";

export function usePantry() {
  return useQuery({ queryKey: ["pantry"], queryFn: () => api<PantryItem[]>("/pantry") });
}

export function useShopping() {
  return useQuery({
    queryKey: ["shopping"],
    queryFn: () => api<ShoppingItem[]>("/shopping"),
    refetchInterval: (q) => ((q.state.data ?? []).some((i) => !i.checked && !Object.keys(i.prices || {}).length) ? 8000 : false),
  });
}

export function usePlan() {
  return useQuery({
    queryKey: ["plan"],
    queryFn: () => api<{ plan: MealPlan | null; latest_ready: MealPlan | null }>("/plans/current"),
    refetchInterval: (q) => (q.state.data?.plan?.status === "generating" ? 4000 : false),
  });
}

export type PlanBody = { scope: "week" | "day"; date?: string; mode: "pantry_only" | "pantry_plus"; schedule?: Record<string, string[]>; notes?: string };

export function useGeneratePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PlanBody) => api<MealPlan>("/plans/generate", { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan"] }),
  });
}

export function useRange(start: string, end: string) {
  return useQuery({ queryKey: ["range", start, end], queryFn: () => api<{ days: DayData[] }>(`/calendar/range?start=${start}&end=${end}`) });
}

export function useRewards() {
  return useQuery({ queryKey: ["rewards"], queryFn: () => api<Rewards>("/rewards") });
}

export function useFavorites() {
  return useQuery({ queryKey: ["favorites"], queryFn: () => api<Recipe[]>("/favorites") });
}
