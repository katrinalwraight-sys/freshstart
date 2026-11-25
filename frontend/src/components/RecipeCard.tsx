import Ionicons from "@react-native-vector-icons/ionicons";
import { router } from "expo-router";
import React from "react";
import { Text, View } from "react-native";

import { Recipe } from "@/src/api";
import { PressableScale } from "@/src/components/ui";
import { fonts, makeStyles, radius, shadow, spacing, useTheme } from "@/src/theme";

const MEAL_ICON: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  Breakfast: "sunny",
  Lunch: "restaurant",
  Dinner: "moon",
};

export function RecipeCard({ recipe, currency, testID, footer, tag }: { recipe: Recipe; currency: string; testID?: string; footer?: React.ReactNode; tag?: { label: string; tone: "ai" | "ok" | "me" } }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const fromPantry = recipe.ingredients.filter((i) => i.from_pantry).length;
  const tint = recipe.meal_type === "Breakfast" ? colors.brandSecondary : recipe.meal_type === "Lunch" ? colors.brandTertiary : colors.brandPrimary;
  const tintFg = recipe.meal_type === "Breakfast" ? colors.onBrandSecondary : recipe.meal_type === "Lunch" ? colors.onBrandTertiary : colors.onBrandPrimary;
  return (
    <PressableScale testID={testID} onPress={() => router.push({ pathname: "/recipe/[id]", params: { id: recipe.id } })} style={styles.card}>
      <View style={[styles.side, { backgroundColor: tint }]}>
        <Ionicons name={MEAL_ICON[recipe.meal_type] ?? "restaurant"} size={26} color={tintFg} />
        <Text style={[styles.sideText, { color: tintFg }]}>{recipe.meal_type}</Text>
      </View>
      <View style={styles.body}>
        {tag ? (
          <View style={[styles.tagPill, { backgroundColor: tag.tone === "ai" ? colors.brandTertiary : tag.tone === "ok" ? colors.successSoft : colors.warningSoft }]}>
            <Text style={[styles.tagText, { color: tag.tone === "ai" ? colors.onBrandTertiary : tag.tone === "ok" ? colors.success : colors.onBrandSecondary }]}>{tag.label}</Text>
          </View>
        ) : null}
        <Text style={styles.title} numberOfLines={2}>
          {recipe.title}
        </Text>
        {recipe.cooked ? (
          <View testID={testID ? `${testID}-cooked` : undefined} style={styles.cookedPill}>
            <Ionicons name="checkmark-circle" size={13} color={colors.success} />
            <Text style={styles.cookedText}>Cooked</Text>
          </View>
        ) : null}
        <Text style={styles.desc} numberOfLines={2}>
          {recipe.description}
        </Text>
        <View style={styles.metaRow}>
          <View style={styles.meta}>
            <Ionicons name="time-outline" size={14} color={colors.muted} />
            <Text style={styles.metaText}>{recipe.time_minutes}m</Text>
          </View>
          {recipe.est_cost > 0 ? (
            <View style={styles.meta}>
              <Ionicons name="wallet-outline" size={14} color={colors.muted} />
              <Text style={styles.metaText}>
                {currency}
                {recipe.est_cost.toFixed(2)}
              </Text>
            </View>
          ) : null}
          {fromPantry > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{fromPantry} from pantry</Text>
            </View>
          ) : null}
        </View>
        {recipe.uses_expiring.length > 0 ? (
          <View style={styles.expRow}>
            <Ionicons name="alarm-outline" size={14} color={colors.onBrandTertiary} />
            <Text style={styles.expText} numberOfLines={1}>
              Uses up {recipe.uses_expiring.join(", ")}
            </Text>
          </View>
        ) : null}
        {footer}
      </View>
    </PressableScale>
  );
}

const useStyles = makeStyles((c) => ({
  card: { flexDirection: "row", backgroundColor: c.card, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: c.border, ...shadow, shadowOpacity: 0.06 },
  side: { width: 84, alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: spacing.lg },
  sideText: { fontFamily: fonts.text, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  body: { flex: 1, padding: spacing.lg, gap: 6 },
  title: { fontFamily: fonts.display, fontSize: 18, fontWeight: "500", color: c.onSurface },
  desc: { fontFamily: fonts.text, fontSize: 13, color: c.muted, lineHeight: 18 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, flexWrap: "wrap", marginTop: 2 },
  meta: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontFamily: fonts.text, fontSize: 13, color: c.muted, fontWeight: "700" },
  badge: { backgroundColor: c.successSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  tagPill: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  tagText: { fontFamily: fonts.text, fontSize: 11, fontWeight: "800" },
  cookedPill: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: c.successSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  cookedText: { fontFamily: fonts.text, fontSize: 11, color: c.success, fontWeight: "800" },
  badgeText: { fontFamily: fonts.text, fontSize: 11, color: c.success, fontWeight: "800" },
  expRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  expText: { flex: 1, fontFamily: fonts.text, fontSize: 12, color: c.onBrandTertiary, fontWeight: "700" },
}));
