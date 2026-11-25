import Ionicons from "@react-native-vector-icons/ionicons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, MEAL_TYPES, Recipe, todayISO } from "@/src/api";
import { Button, Chip, EmptyState, ErrorText, ExpiryTag, Loading } from "@/src/components/ui";
import { usePantry } from "@/src/hooks";
import { queryClient } from "@/src/query-client";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

// Feature 2: pick pantry ingredients → one AI recipe built on them.
export default function CookWith() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { date, preselect } = useLocalSearchParams<{ date?: string; preselect?: string }>();
  const day = date || todayISO();
  const { data, isLoading } = usePantry();
  const [picked, setPicked] = useState<string[]>(preselect ? [preselect] : []);
  const [extra, setExtra] = useState(true);
  const [type, setType] = useState("Dinner");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const go = async () => {
    setError("");
    if (!picked.length) return setError("Pick at least one ingredient");
    setBusy(true);
    try {
      const res = await api<{ recipe: Recipe }>("/meals/generate", { method: "POST", body: { kind: "ingredients", pantry_ids: picked, allow_extra: extra, meal_type: type, context: note, date: day } });
      queryClient.invalidateQueries();
      router.replace({ pathname: "/recipe/[id]", params: { id: res.recipe.id } });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="cookwith-close-button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name="close" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Cook with my ingredients</Text>
          <Text testID="cookwith-selected-count" style={styles.hint}>
            {picked.length} selected
          </Text>
        </View>
      </View>
      {isLoading ? (
        <Loading />
      ) : !(data ?? []).length ? (
        <EmptyState testID="cookwith-empty" icon="file-tray-outline" title="Pantry is empty" body="Scan your fridge first, then pick ingredients here." action={<Button label="Scan fridge" icon="camera" onPress={() => router.replace({ pathname: "/scan", params: { mode: "pantry" } })} />} />
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.sm, paddingBottom: 260 + insets.bottom }}>
            {(data ?? []).map((p) => {
              const on = picked.includes(p.id);
              return (
                <Pressable key={p.id} testID={`cookwith-item-${p.id}`} onPress={() => toggle(p.id)} style={[styles.row, on && styles.rowOn]}>
                  <View style={[styles.check, on && styles.checkOn]}>{on ? <Ionicons name="checkmark" size={16} color={colors.onBrandPrimary} /> : null}</View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{p.name}</Text>
                    {p.quantity ? <Text style={styles.hint}>{p.quantity}</Text> : null}
                  </View>
                  <ExpiryTag date={p.expiry_date} />
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {MEAL_TYPES.map((t) => (
                <Chip key={t} testID={`cookwith-type-${t}`} label={t} selected={type === t} onPress={() => setType(t)} />
              ))}
            </ScrollView>
            <View style={styles.switchRow}>
              <Text style={[styles.label, { flex: 1 }]}>AI may suggest a few ingredients to buy</Text>
              <Switch testID="cookwith-extra-switch" value={extra} onValueChange={setExtra} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.card} />
            </View>
            <TextInput testID="cookwith-note-input" style={styles.input} value={note} onChangeText={setNote} placeholder="Optional: style or extra context" placeholderTextColor={colors.muted} />
            <ErrorText testID="cookwith-error" text={error} />
            <Button testID="cookwith-generate-button" label={busy ? "Creating recipe…" : "Create a meal"} icon="sparkles" onPress={go} loading={busy} />
          </View>
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: c.divider },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  headerTitle: { fontFamily: fonts.display, fontSize: 21, fontWeight: "500", color: c.onSurface },
  hint: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 60, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.card },
  rowOn: { borderColor: c.brandPrimary, backgroundColor: c.surfaceSecondary },
  check: { width: 26, height: 26, borderRadius: 9, borderWidth: 2, borderColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: c.brandPrimary },
  name: { fontFamily: fonts.text, fontSize: 15, fontWeight: "800", color: c.onSurface },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.lg, gap: spacing.sm, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.divider },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  label: { fontFamily: fonts.text, fontSize: 14, fontWeight: "800", color: c.onSurface },
  input: { height: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.card, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
}));
