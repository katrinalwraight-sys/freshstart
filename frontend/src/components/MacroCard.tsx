import React from "react";
import { Text, View } from "react-native";

import { Nutrition } from "@/src/api";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export function MacroCard({ totals, testID, title = "Daily nutrition" }: { totals: Nutrition; testID?: string; title?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const macros = [
    { key: "protein", label: "Protein", value: totals.protein, color: colors.brandPrimary },
    { key: "carbs", label: "Carbs", value: totals.carbs, color: colors.brandSecondary },
    { key: "fat", label: "Fat", value: totals.fat, color: colors.onBrandTertiary },
    { key: "fiber", label: "Fibre", value: totals.fiber, color: colors.success },
  ];
  return (
    <View testID={testID} style={styles.card}>
      <View style={styles.top}>
        <Text style={styles.title}>{title}</Text>
        <Text testID={testID ? `${testID}-calories` : undefined} style={styles.kcal}>
          {Math.round(totals.calories)} <Text style={styles.kcalUnit}>kcal</Text>
        </Text>
      </View>
      <View style={styles.row}>
        {macros.map((m) => (
          <View key={m.key} style={styles.macro}>
            <View style={[styles.bar, { backgroundColor: m.color }]} />
            <Text testID={testID ? `${testID}-${m.key}` : undefined} style={styles.value}>
              {Math.round(m.value)}g
            </Text>
            <Text style={styles.label}>{m.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  top: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  title: { fontFamily: fonts.display, fontSize: 17, fontWeight: "500", color: c.onSurface },
  kcal: { fontFamily: fonts.display, fontSize: 24, fontWeight: "500", color: c.brandPrimary },
  kcalUnit: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  row: { flexDirection: "row", gap: spacing.sm },
  macro: { flex: 1, backgroundColor: c.card, borderRadius: radius.md, padding: spacing.sm, alignItems: "center", gap: 2 },
  bar: { width: 24, height: 4, borderRadius: 2, marginBottom: 4 },
  value: { fontFamily: fonts.display, fontSize: 18, fontWeight: "500", color: c.onSurface },
  label: { fontFamily: fonts.text, fontSize: 11, fontWeight: "800", color: c.muted },
}));
