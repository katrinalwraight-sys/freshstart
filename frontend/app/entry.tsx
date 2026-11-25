import Ionicons from "@react-native-vector-icons/ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, MEAL_TYPES, todayISO } from "@/src/api";
import { Button, Chip, ErrorText } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function AddEntry() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ date?: string; meal_type?: string }>();
  const day = params.date || todayISO();
  const [type, setType] = useState<string>(params.meal_type || "Dinner");
  const [title, setTitle] = useState("");
  const [ings, setIngs] = useState("");
  const [note, setNote] = useState("");
  const [aiFill, setAiFill] = useState(true);
  const [toShop, setToShop] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    if (!title.trim()) return setError("What's the meal called?");
    setSaving(true);
    try {
      await api("/meals/manual", {
        method: "POST",
        body: { date: day, meal_type: type, title: title.trim(), notes: note, ingredients: ings.split(/[,\n]/).map((s) => s.trim()).filter(Boolean), ai_fill: aiFill, add_to_shopping: toShop },
      });
      qc.invalidateQueries();
      router.back();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const Toggle = ({ icon, label, hint, value, onChange, id }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; hint: string; value: boolean; onChange: (v: boolean) => void; id: string }) => (
    <View style={styles.switchRow}>
      <Ionicons name={icon} size={22} color={colors.onBrandSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Switch testID={id} value={value} onValueChange={onChange} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.card} />
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="entry-close-button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name="close" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Add my own meal</Text>
          <Text style={styles.hint}>{new Date(day + "T00:00:00").toDateString()}</Text>
        </View>
      </View>
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing["2xl"] }]}>
        <View style={styles.chips}>
          {MEAL_TYPES.map((t) => (
            <Chip key={t} testID={`entry-type-${t}`} label={t} selected={type === t} onPress={() => setType(t)} />
          ))}
        </View>
        <TextInput testID="entry-title-input" style={styles.input} value={title} onChangeText={setTitle} placeholder="Meal name, e.g. Taco night" placeholderTextColor={colors.muted} />
        <TextInput
          testID="entry-ingredients-input"
          style={[styles.input, { height: 90, paddingTop: spacing.md, textAlignVertical: "top" }]}
          value={ings}
          onChangeText={setIngs}
          multiline
          placeholder="Ingredients (optional), comma separated"
          placeholderTextColor={colors.muted}
        />
        <TextInput testID="entry-note-input" style={styles.input} value={note} onChangeText={setNote} placeholder="Notes (optional)" placeholderTextColor={colors.muted} />
        <Toggle id="entry-ai-fill-switch" icon="sparkles" label="Fill in recipe & macros with AI" hint="Steps, quantities, times and nutrition — same detail as AI meals" value={aiFill} onChange={setAiFill} />
        <Toggle id="entry-shopping-switch" icon="cart" label="Add missing ingredients to list" hint="Skips what's already in your pantry" value={toShop} onChange={setToShop} />
        <ErrorText testID="entry-error" text={error} />
        <Button testID="entry-save-button" label={saving && aiFill ? "Writing the recipe…" : "Add to day"} icon="calendar" onPress={save} loading={saving} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: c.divider },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  headerTitle: { fontFamily: fonts.display, fontSize: 22, fontWeight: "500", color: c.onSurface },
  hint: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  content: { padding: spacing.xl, gap: spacing.lg },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  label: { fontFamily: fonts.text, fontSize: 14, fontWeight: "800", color: c.onSurface },
  input: { height: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.card, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 16, color: c.onSurface },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.surfaceTertiary, borderRadius: radius.lg, padding: spacing.lg },
}));
