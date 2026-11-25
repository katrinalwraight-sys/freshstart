import Ionicons from "@react-native-vector-icons/ionicons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { daysUntil, todayISO } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Logo } from "@/src/components/Logo";
import { MacroCard } from "@/src/components/MacroCard";
import { RecipeCard } from "@/src/components/RecipeCard";
import { ExpiryTag, IconName, PressableScale } from "@/src/components/ui";
import { usePantry, useRange, useRewards } from "@/src/hooks";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, radius, shadow, spacing, useTheme } from "@/src/theme";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function Home() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const { user } = useAuth();
  const today = todayISO();
  const pantry = usePantry();
  const range = useRange(today, today);
  const rewards = useRewards();
  const [refreshing, setRefreshing] = useState(false);
  const currency = user?.profile.currency ?? "$";

  const expiring = useMemo(() => (pantry.data ?? []).filter((i) => { const d = daysUntil(i.expiry_date); return d !== null && d <= 4; }), [pantry.data]);
  const day = range.data?.days[0];
  const meals = day?.meals ?? [];
  const next = meals.find((m) => m.meal_type === "Dinner") ?? meals[0];
  const quest = rewards.data?.quests.find((q) => !q.claimed);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([pantry.refetch(), range.refetch(), rewards.refetch()]);
    setRefreshing(false);
  };

  const actions: { key: string; icon: IconName; title: string; onPress: () => void; tint: string; fg: string }[] = [
    { key: "scan-fridge", icon: "camera", title: "Scan fridge", onPress: () => router.push({ pathname: "/scan", params: { mode: "pantry" } }), tint: colors.brandTertiary, fg: colors.onBrandTertiary },
    { key: "scan-leftovers", icon: "sparkles", title: "Leftovers", onPress: () => router.push({ pathname: "/scan", params: { mode: "leftovers" } }), tint: colors.warningSoft, fg: colors.onBrandSecondary },
    { key: "log-meal", icon: "nutrition", title: "Log food", onPress: () => router.push({ pathname: "/log", params: { date: today } }), tint: colors.successSoft, fg: colors.success },
    { key: "craving", icon: "chatbubble-ellipses", title: "I'm craving…", onPress: () => router.push({ pathname: "/craving", params: { date: today } }), tint: colors.surfaceSecondary, fg: colors.brandPrimary },
  ];

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Logo size={44} testID="home-logo" />
        <View style={{ flex: 1 }}>
          <Text style={styles.hello}>{greeting()},</Text>
          <Text testID="home-user-name" style={styles.name} numberOfLines={1}>
            {user?.profile.name || "Chef"}
          </Text>
        </View>
        <PressableScale testID="home-points-pill" onPress={() => router.push("/rewards")} style={styles.points}>
          <Ionicons name="star" size={14} color={colors.onBrandSecondary} />
          <Text style={styles.pointsText}>{rewards.data?.points ?? 0}</Text>
        </PressableScale>
        <PressableScale testID="open-profile-button" onPress={() => router.push("/profile")} style={styles.avatar}>
          <Ionicons name="person" size={20} color={colors.onBrandPrimary} />
        </PressableScale>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingTop: spacing.sm, gap: spacing.xl, paddingBottom: bottomChrome + 120 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}>
        <Animated.View entering={FadeInDown.duration(350)} style={{ gap: spacing.md }}>
          <View style={styles.secHead}>
            <Text style={styles.secTitle}>Today&apos;s meals</Text>
            <Text testID="home-open-plan" style={styles.link} onPress={() => router.push("/plan")}>
              See plan
            </Text>
          </View>
          {next ? (
            <RecipeCard testID="home-next-meal" recipe={next} currency={currency} />
          ) : (
            <PressableScale testID="home-plan-cta" onPress={() => router.push("/plan")} style={styles.cta}>
              <Ionicons name="sparkles" size={22} color={colors.onBrandPrimary} />
              <Text style={styles.ctaText}>Nothing planned today. Let AI plan your day or week</Text>
            </PressableScale>
          )}
          {meals.length > 1 ? <Text style={styles.meta}>+{meals.length - 1} more planned today</Text> : null}
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(60).duration(350)} style={styles.grid}>
          {actions.map((a) => (
            <PressableScale key={a.key} testID={`home-${a.key}-button`} onPress={a.onPress} style={[styles.action, { backgroundColor: a.tint }]}>
              <Ionicons name={a.icon} size={22} color={a.fg} />
              <Text style={styles.actionTitle}>{a.title}</Text>
            </PressableScale>
          ))}
        </Animated.View>

        <MacroCard testID="home-macros" title="Eaten today" totals={day?.totals ?? { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }} />

        {quest ? (
          <PressableScale testID="home-quest-card" onPress={() => router.push("/rewards")} style={styles.quest}>
            <Ionicons name="trophy" size={22} color={colors.onBrandSecondary} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.questTitle}>{quest.complete ? "Quest complete! Claim it" : quest.title}</Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.round((quest.progress / quest.target) * 100)}%` }]} />
              </View>
            </View>
            <Text style={styles.questPts}>+{quest.points}</Text>
          </PressableScale>
        ) : null}

        <View style={{ gap: spacing.md }}>
          <View style={styles.secHead}>
            <Text style={styles.secTitle}>Use it up soon</Text>
            <Text testID="expiring-count" style={styles.meta}>
              {expiring.length} item{expiring.length === 1 ? "" : "s"}
            </Text>
          </View>
          {expiring.length === 0 ? (
            <Text testID="expiring-empty" style={styles.meta}>
              {(pantry.data ?? []).length ? "Nothing expiring in the next few days." : "Scan your fridge to track what's expiring."}
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -spacing.xl }} contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.md }}>
              {expiring.map((i) => (
                <PressableScale key={i.id} testID={`expiring-item-${i.id}`} onPress={() => router.push({ pathname: "/cook-with", params: { preselect: i.id, date: today } })} style={styles.expCard}>
                  <Text style={styles.expName} numberOfLines={1}>
                    {i.name}
                  </Text>
                  <ExpiryTag date={i.expiry_date} />
                  <Text style={styles.link}>Use it</Text>
                </PressableScale>
              ))}
            </ScrollView>
          )}
        </View>
      </ScrollView>

      <View pointerEvents="box-none" style={[styles.fabWrap, { bottom: bottomChrome + 16 }]}>
        <PressableScale testID="scan-fab" onPress={() => router.push({ pathname: "/scan", params: { mode: "pantry" } })} style={styles.fab}>
          <Ionicons name="scan" size={22} color={colors.onBrandPrimary} />
          <Text style={styles.fabText}>Scan Food</Text>
        </PressableScale>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xl, paddingBottom: spacing.md, backgroundColor: c.surface },
  hello: { fontFamily: fonts.text, fontSize: 14, color: c.muted, fontWeight: "700" },
  name: { fontFamily: fonts.display, fontSize: 24, fontWeight: "500", color: c.onSurface },
  points: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.brandSecondary, paddingHorizontal: 12, height: 36, borderRadius: radius.pill },
  pointsText: { fontFamily: fonts.text, fontSize: 14, fontWeight: "800", color: c.onBrandSecondary },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  secHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  secTitle: { fontFamily: fonts.display, fontSize: 21, fontWeight: "500", color: c.onSurface },
  link: { fontFamily: fonts.text, fontSize: 14, fontWeight: "800", color: c.brandPrimary },
  meta: { fontFamily: fonts.text, fontSize: 13, color: c.muted, fontWeight: "700" },
  cta: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.brandPrimary, borderRadius: radius.lg, padding: spacing.lg, ...shadow },
  ctaText: { flex: 1, fontFamily: fonts.display, fontSize: 16, color: c.onBrandPrimary },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  action: { width: "47%", flexGrow: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, minHeight: 88 },
  actionTitle: { fontFamily: fonts.display, fontSize: 17, fontWeight: "500", color: c.onSurface },
  quest: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.warningSoft, borderRadius: radius.lg, padding: spacing.lg },
  questTitle: { fontFamily: fonts.text, fontSize: 14, fontWeight: "800", color: c.onSurface },
  questPts: { fontFamily: fonts.display, fontSize: 16, color: c.onBrandSecondary },
  track: { height: 8, borderRadius: 4, backgroundColor: c.card, overflow: "hidden" },
  fill: { height: 8, backgroundColor: c.brandSecondary },
  expCard: { width: 130, backgroundColor: c.card, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: c.border },
  expName: { fontFamily: fonts.text, fontSize: 15, fontWeight: "800", color: c.onSurface },
  fabWrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  fab: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: c.brandPrimary, height: 56, paddingHorizontal: spacing.xl, borderRadius: radius.pill, ...shadow, shadowOpacity: 0.3 },
  fabText: { fontFamily: fonts.display, fontSize: 17, fontWeight: "500", color: c.onBrandPrimary },
}));
