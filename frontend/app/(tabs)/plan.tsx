import Ionicons from "@react-native-vector-icons/ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, MEAL_TYPES, Recipe, todayISO, toISO } from "@/src/api";
import { useAuth } from "@/src/auth";
import { MacroCard } from "@/src/components/MacroCard";
import { MealCard } from "@/src/components/MealCard";
import { MoveSheet, Sheet, SwapSheet } from "@/src/components/Sheets";
import { Button, ErrorText, Loading, PressableScale } from "@/src/components/ui";
import { PlanBody, useGeneratePlan, usePlan, useRange } from "@/src/hooks";
import { usesNativeTabs } from "@/src/navigation";
import { busyTimes, calendarSupported, getCalendarPermission, requestCalendarPermission } from "@/src/schedule";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

function weekStart(iso: string) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export default function Plan() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const qc = useQueryClient();
  const { user } = useAuth();
  const currency = user?.profile.currency ?? "$";
  const [sel, setSel] = useState(todayISO());
  const [view, setView] = useState<"day" | "week">("day");
  const [planOpen, setPlanOpen] = useState(false);
  const [moveR, setMoveR] = useState<Recipe | null>(null);
  const [swapR, setSwapR] = useState<Recipe | null>(null);
  const ws = weekStart(sel);
  const week = Array.from({ length: 7 }, (_, i) => toISO(addDays(ws, i)));
  const range = useRange(week[0], week[6]);
  const plan = usePlan();
  const gen = useGeneratePlan();
  const generating = plan.data?.plan?.status === "generating" || gen.isPending;
  const failed = plan.data?.plan?.status === "failed" && !gen.isPending;
  const g = plan.data?.latest_ready?.grocery;
  const positive = Object.fromEntries(Object.entries(g?.store_totals ?? {}).filter(([, v]) => v > 0));
  const cheapestStore = Object.keys(positive).sort((a, b) => positive[a] - positive[b])[0];
  const grocery = g && cheapestStore ? { ...g, store_totals: positive, cheapest_store: cheapestStore } : undefined;

  const readyId = plan.data?.latest_ready?.id;
  useEffect(() => {
    if (readyId) {
      qc.invalidateQueries({ queryKey: ["range"] });
      qc.invalidateQueries({ queryKey: ["shopping"] });
    }
  }, [readyId, qc]);

  const days = useMemo(() => range.data?.days ?? [], [range.data]);
  const day = days.find((d) => d.date === sel);
  const today = todayISO();

  const deleteLog = async (id: string) => {
    await api(`/logs/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["range"] });
  };

  const cards = (meals: Recipe[], prefix: string) =>
    meals.map((m, i) => <MealCard key={m.id} testID={`${prefix}-${m.meal_type.toLowerCase()}-${i}`} recipe={m} currency={currency} onMove={setMoveR} onSwap={setSwapR} />);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Meal plan</Text>
          <Button testID="plan-open-sheet-button" small icon="sparkles" label={generating ? "Planning…" : "AI plan"} loading={generating} onPress={() => setPlanOpen(true)} />
        </View>
        <View style={styles.weekNav}>
          <Pressable testID="week-prev" onPress={() => setSel(toISO(addDays(ws, -7)))} style={styles.navBtn} hitSlop={6}>
            <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
          </Pressable>
          <View style={styles.strip}>
            {week.map((iso) => {
              const d = new Date(iso + "T00:00:00");
              const active = iso === sel;
              const has = (days.find((x) => x.date === iso)?.meals.length ?? 0) > 0;
              return (
                <Pressable key={iso} testID={`day-${iso}`} onPress={() => setSel(iso)} style={[styles.dayBtn, active && styles.dayActive, iso === today && !active && styles.dayToday]}>
                  <Text style={[styles.dayName, active && styles.onBrand]}>{d.toLocaleDateString(undefined, { weekday: "narrow" })}</Text>
                  <Text style={[styles.dayNum, active && styles.onBrand]}>{d.getDate()}</Text>
                  <View style={[styles.dot, { backgroundColor: has ? (active ? colors.onBrandPrimary : colors.brandPrimary) : "transparent" }]} />
                </Pressable>
              );
            })}
          </View>
          <Pressable testID="week-next" onPress={() => setSel(toISO(addDays(ws, 7)))} style={styles.navBtn} hitSlop={6}>
            <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
          </Pressable>
        </View>
        <View style={styles.seg}>
          {(["day", "week"] as const).map((v) => (
            <Pressable key={v} testID={`view-${v}`} onPress={() => setView(v)} style={[styles.segBtn, view === v && styles.segActive]}>
              <Text style={[styles.segText, view === v && styles.onBrand]}>{v === "day" ? "Day" : "Week"}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg, paddingBottom: bottomChrome + spacing["2xl"] }}
        refreshControl={<RefreshControl refreshing={range.isRefetching} onRefresh={() => { range.refetch(); plan.refetch(); }} tintColor={colors.brandPrimary} />}
      >
        {generating ? (
          <View testID="plan-generating-banner" style={styles.banner}>
            <ActivityIndicator color={colors.onBrandTertiary} />
            <Text style={styles.bannerText}>AI is planning around your pantry, budget and schedule. Missing ingredients will land on your shopping list.</Text>
          </View>
        ) : null}
        {failed ? <ErrorText testID="plan-failed-text" text={plan.data?.plan?.error || "Plan failed. Try again."} /> : null}

        <View style={styles.tools}>
          <PressableScale testID="open-craving-generator" onPress={() => router.push({ pathname: "/craving", params: { date: sel } })} style={[styles.tool, { backgroundColor: colors.brandTertiary }]}>
            <Ionicons name="chatbubble-ellipses" size={20} color={colors.onBrandTertiary} />
            <Text style={styles.toolText}>AI meal generator</Text>
          </PressableScale>
          <PressableScale testID="open-ingredient-generator" onPress={() => router.push({ pathname: "/cook-with", params: { date: sel } })} style={[styles.tool, { backgroundColor: colors.warningSoft }]}>
            <Ionicons name="basket" size={20} color={colors.onBrandSecondary} />
            <Text style={styles.toolText}>Cook with my ingredients</Text>
          </PressableScale>
          <PressableScale testID="open-favorites" onPress={() => router.push({ pathname: "/favorites", params: { date: sel } })} style={[styles.tool, { backgroundColor: colors.surfaceSecondary }]}>
            <Ionicons name="heart" size={20} color={colors.brandPrimary} />
            <Text style={styles.toolText}>Favourites</Text>
          </PressableScale>
        </View>

        {grocery?.store_totals && Object.keys(grocery.store_totals).length ? (
          <Pressable testID="plan-grocery-summary" onPress={() => router.push("/shopping")} style={styles.grocery}>
            <Ionicons name="cart" size={20} color={colors.onBrandSecondary} />
            <Text style={styles.groceryText}>
              Est. groceries {currency}
              {Math.min(...Object.values(grocery.store_totals)).toFixed(2)} at {grocery.cheapest_store || "cheapest store"} · budget {currency}
              {grocery.budget}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ) : null}

        {range.isLoading ? (
          <Loading testID="plan-loading" />
        ) : view === "day" ? (
          <>
            <Text testID="selected-day-label" style={styles.dayTitle}>
              {sel === today ? "Today" : new Date(sel + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}
            </Text>
            {MEAL_TYPES.map((mt) => {
              const meals = (day?.meals ?? []).filter((m) => m.meal_type === mt);
              return (
                <View key={mt} testID={`section-${mt.toLowerCase()}`} style={{ gap: spacing.md }}>
                  <View style={styles.secHead}>
                    <Text style={styles.secTitle}>{mt}</Text>
                    <Pressable testID={`add-${mt.toLowerCase()}`} onPress={() => router.push({ pathname: "/entry", params: { date: sel, meal_type: mt } })} style={styles.addBtn} hitSlop={6}>
                      <Ionicons name="add" size={18} color={colors.brandPrimary} />
                      <Text style={styles.addText}>Add</Text>
                    </Pressable>
                  </View>
                  {meals.length ? cards(meals, "meal") : <Text style={styles.empty}>No {mt.toLowerCase()} planned.</Text>}
                </View>
              );
            })}
            <MacroCard totals={day?.totals ?? { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }} title="Eaten this day" testID="day-macros" />
            <View style={{ gap: spacing.md }}>
              <View style={styles.secHead}>
                <Text style={styles.secTitle}>Food log</Text>
                <Pressable testID="log-food-button" onPress={() => router.push({ pathname: "/log", params: { date: sel } })} style={styles.addBtn} hitSlop={6}>
                  <Ionicons name="add" size={18} color={colors.brandPrimary} />
                  <Text style={styles.addText}>Log food</Text>
                </Pressable>
              </View>
              {(day?.logs ?? []).length === 0 ? <Text style={styles.empty}>Tap “I ate this” on a meal, or log a snack.</Text> : null}
              {(day?.logs ?? []).map((l) => (
                <View key={l.id} testID={`log-${l.id}`} style={styles.logRow}>
                  <View style={styles.kcalBox}>
                    <Text style={styles.kcal}>{Math.round(l.calories)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.logName} numberOfLines={1}>
                      {l.name}
                    </Text>
                    <Text style={styles.logMeta}>
                      {l.quantity} {l.unit} · P {l.protein}g · C {l.carbs}g · F {l.fat}g · Fb {l.fiber}g
                    </Text>
                  </View>
                  <Pressable testID={`log-delete-${l.id}`} onPress={() => deleteLog(l.id)} style={styles.del} hitSlop={6}>
                    <Ionicons name="trash-outline" size={18} color={colors.error} />
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        ) : (
          days.map((d) => (
            <View key={d.date} testID={`week-day-${d.date}`} style={{ gap: spacing.md }}>
              <Pressable onPress={() => { setSel(d.date); setView("day"); }} style={styles.secHead}>
                <Text style={styles.secTitle}>{new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}</Text>
                <Text style={styles.addText}>{Math.round(d.totals.calories)} kcal eaten</Text>
              </Pressable>
              {d.meals.length ? cards([...d.meals].sort((a, b) => MEAL_TYPES.indexOf(a.meal_type as any) - MEAL_TYPES.indexOf(b.meal_type as any)), `week-${d.date}`) : <Text style={styles.empty}>Nothing planned.</Text>}
            </View>
          ))
        )}
      </ScrollView>

      <PlanSheet open={planOpen} onClose={() => setPlanOpen(false)} sel={sel} onSubmit={(b) => gen.mutate(b)} />
      <MoveSheet recipe={moveR} onClose={() => setMoveR(null)} />
      <SwapSheet recipe={swapR} onClose={() => setSwapR(null)} />
    </View>
  );
}

function PlanSheet({ open, onClose, sel, onSubmit }: { open: boolean; onClose: () => void; sel: string; onSubmit: (b: PlanBody) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [scope, setScope] = useState<"week" | "day">("week");
  const [mode, setMode] = useState<"pantry_only" | "pantry_plus">("pantry_plus");
  const [useCal, setUseCal] = useState(false);
  const [calBlocked, setCalBlocked] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const toggleCal = async (on: boolean) => {
    if (!on) return setUseCal(false);
    let p = await getCalendarPermission();
    if (!p.granted && p.canAskAgain) p = await requestCalendarPermission();
    setCalBlocked(!p.granted && !p.canAskAgain);
    setUseCal(p.granted);
  };

  const start = sel < todayISO() ? todayISO() : sel;
  const submit = async () => {
    setBusy(true);
    let schedule: Record<string, string[]> | undefined;
    if (useCal) {
      const s = new Date(start + "T00:00:00");
      const dates = Array.from({ length: scope === "week" ? 7 : 1 }, (_, i) => toISO(addDays(s, i)));
      schedule = await busyTimes(dates).catch(() => undefined);
    }
    onSubmit({ scope, date: start, mode, schedule, notes });
    setBusy(false);
    onClose();
  };

  return (
    <Sheet visible={open} onClose={onClose} title="Let AI plan" testID="plan-sheet">
      <View style={styles.optRow}>
        {(["week", "day"] as const).map((s) => (
          <Pressable key={s} testID={`plan-scope-${s}`} onPress={() => setScope(s)} style={[styles.opt, scope === s && styles.optOn]}>
            <Ionicons name={s === "week" ? "calendar" : "today"} size={20} color={scope === s ? colors.onBrandPrimary : colors.onSurface} />
            <Text style={[styles.optText, scope === s && styles.onBrand]}>{s === "week" ? "Plan my week" : "Plan my day"}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.optRow}>
        {(["pantry_only", "pantry_plus"] as const).map((m) => (
          <Pressable key={m} testID={`plan-mode-${m}`} onPress={() => setMode(m)} style={[styles.opt, mode === m && styles.optOnAlt]}>
            <Ionicons name={m === "pantry_only" ? "file-tray-stacked" : "cart"} size={20} color={colors.onSurface} />
            <Text style={styles.optText}>{m === "pantry_only" ? "Use only my pantry" : "Pantry + new ingredients"}</Text>
          </Pressable>
        ))}
      </View>
      {calendarSupported ? (
        <View style={styles.calRow}>
          <Ionicons name="time" size={20} color={colors.onBrandTertiary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.optText}>Fit meals around my calendar</Text>
            <Text style={styles.empty}>Reads your phone calendar to see how much time you have. Never changes events.</Text>
          </View>
          <Switch testID="plan-calendar-switch" value={useCal} onValueChange={toggleCal} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.card} />
        </View>
      ) : null}
      {calBlocked ? <Button testID="calendar-open-settings" small variant="outline" label="Open Settings to allow calendar" icon="settings-outline" onPress={() => Linking.openSettings()} /> : null}
      <TextInput testID="plan-notes-input" style={styles.notes} value={notes} onChangeText={setNotes} multiline placeholder="Anything else? e.g. meat-free Monday, quick lunches" placeholderTextColor={colors.muted} />
      <Button testID="plan-generate-button" label={scope === "week" ? "Plan my week" : "Plan my day"} icon="sparkles" onPress={submit} loading={busy} />
      <Text style={styles.empty}>Starts {new Date(start + "T00:00:00").toDateString()}</Text>
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.divider },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.sm },
  title: { fontFamily: fonts.display, fontSize: 30, fontWeight: "500", color: c.onSurface },
  weekNav: { flexDirection: "row", alignItems: "center", gap: 4 },
  navBtn: { width: 32, height: 56, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  strip: { flex: 1, flexDirection: "row", gap: 4 },
  dayBtn: { flex: 1, height: 60, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  dayActive: { backgroundColor: c.brandPrimary },
  dayToday: { borderWidth: 1.5, borderColor: c.brandPrimary },
  dayName: { fontFamily: fonts.text, fontSize: 11, fontWeight: "800", color: c.muted },
  dayNum: { fontFamily: fonts.display, fontSize: 18, fontWeight: "500", color: c.onSurface },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
  onBrand: { color: c.onBrandPrimary },
  seg: { flexDirection: "row", backgroundColor: c.surfaceSecondary, borderRadius: radius.pill, padding: 4 },
  segBtn: { flex: 1, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  segActive: { backgroundColor: c.brandPrimary },
  segText: { fontFamily: fonts.text, fontSize: 14, fontWeight: "800", color: c.muted },
  banner: { flexDirection: "row", gap: spacing.md, alignItems: "center", padding: spacing.lg, borderRadius: radius.lg, backgroundColor: c.brandTertiary },
  bannerText: { flex: 1, fontFamily: fonts.text, fontSize: 13, color: c.onBrandTertiary, fontWeight: "700" },
  tools: { flexDirection: "row", gap: spacing.sm },
  tool: { flex: 1, borderRadius: radius.lg, padding: spacing.md, gap: 6, minHeight: 84 },
  toolText: { fontFamily: fonts.text, fontSize: 13, fontWeight: "800", color: c.onSurface },
  grocery: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: c.warningSoft },
  groceryText: { flex: 1, fontFamily: fonts.text, fontSize: 13, fontWeight: "800", color: c.onSurface },
  dayTitle: { fontFamily: fonts.display, fontSize: 24, fontWeight: "500", color: c.onSurface },
  secHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  secTitle: { fontFamily: fonts.display, fontSize: 19, fontWeight: "500", color: c.onSurface },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 2, height: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: c.brandTertiary },
  addText: { fontFamily: fonts.text, fontSize: 13, fontWeight: "800", color: c.brandPrimary },
  empty: { fontFamily: fonts.text, fontSize: 13, color: c.muted, lineHeight: 19 },
  logRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border },
  kcalBox: { width: 48, height: 48, borderRadius: 14, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  kcal: { fontFamily: fonts.display, fontSize: 14, color: c.onBrandTertiary },
  logName: { fontFamily: fonts.text, fontSize: 15, fontWeight: "800", color: c.onSurface },
  logMeta: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  del: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.errorSoft },
  optRow: { flexDirection: "row", gap: spacing.sm },
  opt: { flex: 1, minHeight: 72, borderRadius: radius.lg, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.card, padding: spacing.md, gap: 6 },
  optOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  optOnAlt: { backgroundColor: c.warningSoft, borderColor: c.brandSecondary },
  optText: { fontFamily: fonts.text, fontSize: 14, fontWeight: "800", color: c.onSurface },
  calRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: c.surfaceSecondary },
  notes: { minHeight: 64, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.card, padding: spacing.md, fontFamily: fonts.text, fontSize: 15, color: c.onSurface, textAlignVertical: "top" },
}));
