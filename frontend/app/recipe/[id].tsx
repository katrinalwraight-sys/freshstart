import Ionicons from "@react-native-vector-icons/ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Recipe } from "@/src/api";
import { useAuth } from "@/src/auth";
import { MacroCard } from "@/src/components/MacroCard";
import { MoveSheet, SwapSheet } from "@/src/components/Sheets";
import { Button, EmptyState, ErrorText, Loading } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function RecipeDetail() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const currency = user?.profile.currency ?? "$";
  const qc = useQueryClient();
  const { data: r, isLoading, isError, refetch } = useQuery({ queryKey: ["recipe", id], queryFn: () => api<Recipe>(`/recipes/${id}`) });
  const [servings, setServings] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [swap, setSwap] = useState<Recipe | null>(null);
  const [move, setMove] = useState<Recipe | null>(null);

  const run = async (key: string, path: string, body?: unknown, msg?: (res: any) => string) => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const res = await api(`/recipes/${id}/${path}`, { method: "POST", body });
      if (msg) setNotice(msg(res));
      qc.invalidateQueries();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const have = r?.ingredients.filter((i) => i.from_pantry) ?? [];
  const buy = r?.ingredients.filter((i) => !i.from_pantry) ?? [];
  const n = r?.nutrition;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="recipe-back-button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {r ? `${r.meal_type}${r.date ? ` · ${new Date(r.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}` : ""}` : "Recipe"}
        </Text>
        {r ? (
          <Pressable testID="recipe-favorite-button" onPress={() => run("fav", "favorite")} style={styles.iconBtn} hitSlop={8}>
            <Ionicons name={r.favorite ? "heart" : "heart-outline"} size={22} color={colors.brandPrimary} />
          </Pressable>
        ) : null}
      </View>
      {isLoading ? (
        <Loading testID="recipe-loading" />
      ) : isError || !r ? (
        <EmptyState testID="recipe-error" icon="alert-circle-outline" title="Meal not found" body="It may have been swapped or removed." action={<Button label="Retry" onPress={() => refetch()} />} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.xl, paddingBottom: insets.bottom + spacing["2xl"] }}>
          <View style={{ gap: spacing.sm }}>
            <Text style={styles.src}>{r.status === "manual" ? "Added by you" : r.status === "proposed" ? "AI suggestion" : r.status === "accepted" ? "AI planned · Accepted" : r.source === "leftover" ? "Leftover makeover" : "AI recipe"}</Text>
            <Text testID="recipe-title" style={styles.title}>
              {r.title}
            </Text>
            {r.description ? <Text style={styles.desc}>{r.description}</Text> : null}
            <View style={styles.metaRow}>
              <Meta icon="time-outline" text={`${r.time_minutes} min total`} />
              <Meta icon="people-outline" text={`Makes ${r.servings} servings`} />
              {r.est_cost > 0 ? <Meta icon="wallet-outline" text={`${currency}${r.est_cost.toFixed(2)}`} /> : null}
              {r.appliance ? <Meta icon="flame-outline" text={r.appliance} /> : null}
            </View>
          </View>

          {r.status === "proposed" ? (
            <View style={styles.row}>
              <Button testID="recipe-accept-button" small label="Accept" icon="checkmark" onPress={() => run("accept", "accept", undefined, () => "Locked into your plan.")} loading={busy === "accept"} style={{ flex: 1 }} />
              <Button testID="recipe-decline-button" small label="Decline" icon="close" variant="outline" onPress={async () => { await run("decline", "decline"); router.back(); }} loading={busy === "decline"} style={{ flex: 1 }} />
              <Button testID="recipe-move-button" small label="Move" icon="calendar-outline" variant="secondary" onPress={() => setMove(r)} />
            </View>
          ) : null}

          <View testID="recipe-eat-card" style={styles.eatCard}>
            <Text style={styles.section}>I ate this</Text>
            <Text style={styles.muted}>Adds only your portion to today&apos;s food log. Tapping again updates it, never duplicates.</Text>
            <View style={styles.stepper}>
              <Pressable testID="eat-servings-minus" onPress={() => setServings((s) => Math.max(0.5, s - 0.5))} style={styles.stepBtn}>
                <Ionicons name="remove" size={20} color={colors.onBrandTertiary} />
              </Pressable>
              <Text testID="eat-servings-value" style={styles.stepVal}>
                {servings} serving{servings === 1 ? "" : "s"}
              </Text>
              <Pressable testID="eat-servings-plus" onPress={() => setServings((s) => Math.min(10, s + 0.5))} style={styles.stepBtn}>
                <Ionicons name="add" size={20} color={colors.onBrandTertiary} />
              </Pressable>
            </View>
            {n?.calories ? <Text style={styles.muted}>= {Math.round(n.calories * servings)} kcal · P {Math.round(n.protein * servings)}g · C {Math.round(n.carbs * servings)}g · F {Math.round(n.fat * servings)}g · Fb {Math.round(n.fiber * servings)}g</Text> : null}
            <Button
              testID="recipe-eat-button"
              label={r.eaten_log_id ? "Update what I ate" : "I ate this"}
              icon="restaurant"
              onPress={() => run("eat", "eat", { servings }, (res) => `${res.updated ? "Updated" : "Added"} ${Math.round(res.calories)} kcal to your food log.`)}
              loading={busy === "eat"}
            />
          </View>

          {notice ? (
            <View testID="recipe-notice" style={styles.notice}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <Text style={styles.noticeText}>{notice}</Text>
            </View>
          ) : null}
          <ErrorText testID="recipe-action-error" text={error} />

          <View style={styles.row}>
            {!r.cooked ? (
              <Button
                testID="recipe-cook-button"
                small
                label="I cooked this"
                icon="flame"
                variant="secondary"
                onPress={() => run("cook", "cook", undefined, (res) => `+${res.points_earned} pts. Pantry updated: ${res.pantry_changes.join("; ") || "nothing matched"}`)}
                loading={busy === "cook"}
                style={{ flex: 1 }}
              />
            ) : (
              <View testID="recipe-cooked-state" style={[styles.notice, { flex: 1, padding: spacing.md }]}>
                <Text style={styles.noticeText}>Cooked ✓</Text>
              </View>
            )}
            <Button testID="recipe-swap-button" small label="Swap" icon="shuffle" variant="outline" onPress={() => setSwap(r)} />
            <Button testID="recipe-to-shopping-button" small label="List" icon="cart-outline" variant="outline" onPress={() => run("shop", "to-shopping", undefined, (res) => (res.added ? `Added ${res.added} item(s) to your shopping list.` : "Already covered — everything is in your pantry or on your list."))} loading={busy === "shop"} />
          </View>

          {n?.calories ? <MacroCard testID="recipe-macros" title="Nutrition per serving" totals={n} /> : null}

          <View style={{ gap: spacing.md }}>
            <Text style={styles.section}>Ingredients</Text>
            {have.length ? <Group title="In your pantry" color={colors.success} items={have} testID="ingredients-have" /> : null}
            {buy.length ? <Group title="Need to buy" color={colors.brandSecondary} items={buy} testID="ingredients-buy" /> : null}
          </View>

          <View style={{ gap: spacing.md }}>
            <Text style={styles.section}>Steps</Text>
            {r.steps.length === 0 ? <Text style={styles.muted}>No steps added.</Text> : null}
            {r.steps.map((s, i) => (
              <View key={i} style={styles.step}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{s}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
      <SwapSheet recipe={swap} onClose={() => setSwap(null)} navigate />
      <MoveSheet recipe={move} onClose={() => { setMove(null); refetch(); }} />
    </View>
  );
}

function Group({ title, color, items, testID }: { title: string; color: string; items: Recipe["ingredients"]; testID: string }) {
  const styles = useStyles();
  return (
    <View testID={testID} style={styles.card}>
      <View style={[styles.groupHead, { borderLeftColor: color }]}>
        <Text style={styles.groupTitle}>{title}</Text>
      </View>
      {items.map((i, idx) => (
        <View key={idx} style={styles.ingRow}>
          <Text style={styles.ingName}>{i.name}</Text>
          <Text style={styles.ingQty}>{i.quantity}</Text>
        </View>
      ))}
    </View>
  );
}

function Meta({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.meta}>
      <Ionicons name={icon} size={15} color={colors.onBrandTertiary} />
      <Text style={styles.metaText}>{text}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: c.divider },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  headerTitle: { flex: 1, fontFamily: fonts.display, fontSize: 18, fontWeight: "500", color: c.onSurface },
  src: { fontFamily: fonts.text, fontSize: 12, fontWeight: "800", color: c.onBrandTertiary, textTransform: "uppercase", letterSpacing: 0.5 },
  title: { fontFamily: fonts.display, fontSize: 28, fontWeight: "500", color: c.onSurface, lineHeight: 34 },
  desc: { fontFamily: fonts.text, fontSize: 15, color: c.muted, lineHeight: 22 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.brandTertiary, paddingHorizontal: 12, height: 32, borderRadius: radius.pill },
  metaText: { fontFamily: fonts.text, fontSize: 13, fontWeight: "800", color: c.onBrandTertiary },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  eatCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: c.card, borderRadius: radius.pill, padding: 4 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  stepVal: { fontFamily: fonts.display, fontSize: 18, fontWeight: "500", color: c.onSurface },
  muted: { fontFamily: fonts.text, fontSize: 13, color: c.muted, lineHeight: 19 },
  notice: { flexDirection: "row", gap: spacing.md, alignItems: "center", padding: spacing.lg, backgroundColor: c.successSoft, borderRadius: radius.lg },
  noticeText: { flex: 1, fontFamily: fonts.text, fontSize: 14, fontWeight: "700", color: c.onSurface },
  section: { fontFamily: fonts.display, fontSize: 21, fontWeight: "500", color: c.onSurface },
  card: { backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
  groupHead: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderLeftWidth: 4, backgroundColor: c.surfaceTertiary },
  groupTitle: { fontFamily: fonts.text, fontSize: 13, fontWeight: "800", color: c.onSurface },
  ingRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.lg, borderTopWidth: 1, borderTopColor: c.divider },
  ingName: { flex: 1, fontFamily: fonts.text, fontSize: 15, fontWeight: "700", color: c.onSurface },
  ingQty: { fontFamily: fonts.text, fontSize: 14, color: c.muted, maxWidth: 140, textAlign: "right" },
  step: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  stepNum: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  stepNumText: { fontFamily: fonts.display, fontSize: 15, color: c.onBrandPrimary },
  stepText: { flex: 1, fontFamily: fonts.text, fontSize: 15, color: c.onSurface, lineHeight: 23, paddingTop: 3 },
}));
