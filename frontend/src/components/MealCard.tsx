import Ionicons from "@react-native-vector-icons/ionicons";
import React from "react";
import { Pressable, View } from "react-native";

import { api, Recipe } from "@/src/api";
import { RecipeCard } from "@/src/components/RecipeCard";
import { queryClient } from "@/src/query-client";
import { makeStyles, spacing, useTheme } from "@/src/theme";

// One card for AI and manual meals. AI proposals get accept / decline / move controls.
export function MealCard({ recipe, currency, onMove, onSwap, testID }: { recipe: Recipe; currency: string; onMove: (r: Recipe) => void; onSwap: (r: Recipe) => void; testID: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const act = async (a: "accept" | "decline") => {
    await api(`/recipes/${recipe.id}/${a}`, { method: "POST" });
    queryClient.invalidateQueries({ queryKey: ["range"] });
    if (a === "decline") queryClient.invalidateQueries({ queryKey: ["shopping"] });
  };
  const manual = recipe.status === "manual";
  const tag = manual ? { label: "Added by you", tone: "me" as const } : recipe.status === "accepted" ? { label: "AI planned · Accepted", tone: "ok" as const } : { label: "AI suggestion", tone: "ai" as const };
  const Btn = ({ icon, color, bg, onPress, id }: { icon: React.ComponentProps<typeof Ionicons>["name"]; color: string; bg: string; onPress: () => void; id: string }) => (
    <Pressable testID={`${testID}-${id}`} onPress={onPress} style={[styles.ctl, { backgroundColor: bg }]} hitSlop={4}>
      <Ionicons name={icon} size={18} color={color} />
    </Pressable>
  );
  return (
    <RecipeCard
      testID={testID}
      recipe={recipe}
      currency={currency}
      tag={tag}
      footer={
        <View style={styles.row}>
          {recipe.status === "proposed" ? (
            <>
              <Btn id="accept" icon="checkmark" color={colors.onBrandPrimary} bg={colors.success} onPress={() => act("accept")} />
              <Btn id="decline" icon="close" color={colors.error} bg={colors.errorSoft} onPress={() => act("decline")} />
              <Btn id="move" icon="calendar-outline" color={colors.onBrandSecondary} bg={colors.warningSoft} onPress={() => onMove(recipe)} />
            </>
          ) : null}
          {!manual && recipe.status === "accepted" ? <Btn id="move" icon="calendar-outline" color={colors.onBrandSecondary} bg={colors.warningSoft} onPress={() => onMove(recipe)} /> : null}
          <View style={{ flex: 1 }} />
          <Btn id="swap" icon="shuffle" color={colors.onBrandTertiary} bg={colors.brandTertiary} onPress={() => onSwap(recipe)} />
        </View>
      }
    />
  );
}

const useStyles = makeStyles(() => ({
  row: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, alignItems: "center" },
  ctl: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
}));
