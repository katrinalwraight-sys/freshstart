import Ionicons from "@react-native-vector-icons/ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api";
import { Button, EmptyState, IconName, Loading } from "@/src/components/ui";
import { useRewards } from "@/src/hooks";
import { fonts, makeStyles, radius, shadow, spacing, useTheme } from "@/src/theme";

const EARN = [
  { icon: "flame", text: "Cook a planned meal", pts: "+10" },
  { icon: "leaf", text: "Each expiring item rescued", pts: "+5" },
  { icon: "nutrition", text: "Log a meal (4/day)", pts: "+5" },
  { icon: "scan", text: "Scan fridge or leftovers", pts: "+5" },
  { icon: "calendar", text: "Add a meal to the calendar", pts: "+3" },
];

export default function RewardsScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isRefetching } = useRewards();
  const [claiming, setClaiming] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const claim = async (key: string) => {
    setClaiming(key);
    setMsg("");
    try {
      const r = await api<{ points_earned: number }>(`/rewards/quests/${key}/claim`, { method: "POST" });
      setMsg(`+${r.points_earned} points claimed!`);
      qc.invalidateQueries({ queryKey: ["rewards"] });
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setClaiming(null);
    }
  };

  const pct = data?.next_level_at ? Math.min(1, (data.points % 150) / 150) : 1;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="rewards-back-button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Rewards</Text>
      </View>
      {isLoading ? (
        <Loading testID="rewards-loading" />
      ) : isError || !data ? (
        <EmptyState testID="rewards-error" icon="cloud-offline" title="Couldn't load rewards" body="Check your connection and try again." action={<Button label="Retry" onPress={() => refetch()} />} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.xl, gap: spacing.xl, paddingBottom: insets.bottom + spacing["2xl"] }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
        >
          <Animated.View entering={FadeInDown.duration(350)} style={styles.hero}>
            <Text style={styles.heroLabel}>Your points</Text>
            <Text testID="rewards-points" style={styles.heroPoints}>
              {data.points}
            </Text>
            <View style={styles.levelPill}>
              <Ionicons name="medal" size={14} color={colors.onBrandSecondary} />
              <Text testID="rewards-level" style={styles.levelText}>
                Level {data.level_number} · {data.level}
              </Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(pct * 100)}%` }]} />
            </View>
            <Text style={styles.heroSub}>{data.next_level_at ? `${data.next_level_at - data.points} points to the next level` : "Top level reached!"}</Text>
          </Animated.View>

          <View style={{ gap: spacing.md }}>
            <Text style={styles.section}>This week&apos;s quests</Text>
            {msg ? (
              <Text testID="rewards-message" style={styles.msg}>
                {msg}
              </Text>
            ) : null}
            {data.quests.map((q, i) => (
              <Animated.View key={q.key} entering={FadeInDown.delay(i * 60)} testID={`quest-${q.key}`} style={styles.quest}>
                <View style={[styles.qIcon, q.complete && { backgroundColor: colors.successSoft }]}>
                  <Ionicons name={q.icon as IconName} size={20} color={q.complete ? colors.success : colors.onBrandTertiary} />
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={styles.qTitle}>{q.title}</Text>
                  <View style={styles.qTrack}>
                    <View style={[styles.qFill, { width: `${Math.round((q.progress / q.target) * 100)}%` }]} />
                  </View>
                  <Text style={styles.qMeta}>
                    {q.progress}/{q.target} · +{q.points} pts
                  </Text>
                </View>
                {q.claimed ? (
                  <View testID={`quest-claimed-${q.key}`} style={styles.claimed}>
                    <Ionicons name="checkmark" size={16} color={colors.success} />
                  </View>
                ) : q.complete ? (
                  <Button testID={`quest-claim-${q.key}`} small label="Claim" variant="secondary" onPress={() => claim(q.key)} loading={claiming === q.key} />
                ) : null}
              </Animated.View>
            ))}
          </View>

          <View style={{ gap: spacing.md }}>
            <Text style={styles.section}>Family badges</Text>
            <View style={styles.badges}>
              {data.badges.map((b) => (
                <View key={b.key} testID={`badge-${b.key}`} style={[styles.badge, !b.earned && { opacity: 0.55 }]}>
                  <View style={[styles.badgeIcon, b.earned && { backgroundColor: colors.brandSecondary }]}>
                    <Ionicons name={(b.earned ? b.icon : "lock-closed") as IconName} size={24} color={b.earned ? colors.onBrandSecondary : colors.muted} />
                  </View>
                  <Text style={styles.badgeTitle}>{b.title}</Text>
                  <Text style={styles.badgeDesc}>{b.desc}</Text>
                  {!b.earned ? (
                    <Text style={styles.badgeProg}>
                      {b.progress}/{b.target}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          </View>

          <View style={styles.earn}>
            <Text style={styles.section}>How to earn</Text>
            {EARN.map((e) => (
              <View key={e.text} style={styles.earnRow}>
                <Ionicons name={e.icon as IconName} size={18} color={colors.brandPrimary} />
                <Text style={styles.earnText}>{e.text}</Text>
                <Text style={styles.earnPts}>{e.pts}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: c.divider },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  headerTitle: { fontFamily: fonts.display, fontSize: 24, fontWeight: "500", color: c.onSurface },
  hero: { backgroundColor: c.brandPrimary, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.sm, ...shadow },
  heroLabel: { fontFamily: fonts.text, fontSize: 14, fontWeight: "800", color: c.onBrandPrimary, opacity: 0.9 },
  heroPoints: { fontFamily: fonts.display, fontSize: 56, fontWeight: "500", color: c.onBrandPrimary, lineHeight: 62 },
  levelPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: c.brandSecondary, paddingHorizontal: 12, height: 30, borderRadius: radius.pill },
  levelText: { fontFamily: fonts.text, fontSize: 13, fontWeight: "800", color: c.onBrandSecondary },
  track: { height: 10, borderRadius: 5, backgroundColor: c.brandTertiary, overflow: "hidden", marginTop: spacing.sm },
  fill: { height: 10, backgroundColor: c.brandSecondary },
  heroSub: { fontFamily: fonts.text, fontSize: 13, color: c.onBrandPrimary },
  section: { fontFamily: fonts.display, fontSize: 21, fontWeight: "500", color: c.onSurface },
  msg: { fontFamily: fonts.text, fontSize: 14, fontWeight: "800", color: c.success },
  quest: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border },
  qIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  qTitle: { fontFamily: fonts.text, fontSize: 15, fontWeight: "800", color: c.onSurface },
  qTrack: { height: 8, borderRadius: 4, backgroundColor: c.surfaceSecondary, overflow: "hidden" },
  qFill: { height: 8, backgroundColor: c.brandPrimary },
  qMeta: { fontFamily: fonts.text, fontSize: 12, color: c.muted, fontWeight: "700" },
  claimed: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.successSoft, alignItems: "center", justifyContent: "center" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  badge: { width: "47%", flexGrow: 1, backgroundColor: c.surfaceTertiary, borderRadius: radius.lg, padding: spacing.lg, gap: 4, alignItems: "center" },
  badgeIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: c.card, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  badgeTitle: { fontFamily: fonts.display, fontSize: 16, fontWeight: "500", color: c.onSurface, textAlign: "center" },
  badgeDesc: { fontFamily: fonts.text, fontSize: 12, color: c.muted, textAlign: "center" },
  badgeProg: { fontFamily: fonts.text, fontSize: 12, fontWeight: "800", color: c.onBrandTertiary },
  earn: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  earnRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  earnText: { flex: 1, fontFamily: fonts.text, fontSize: 14, color: c.onSurface },
  earnPts: { fontFamily: fonts.display, fontSize: 15, fontWeight: "500", color: c.brandPrimary },
}));
