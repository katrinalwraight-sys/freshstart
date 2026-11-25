import Ionicons from "@react-native-vector-icons/ionicons";
import * as ImagePicker from "expo-image-picker";
import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, FoodEstimate, MEAL_TYPES, todayISO, uploadScan } from "@/src/api";
import { MacroCard } from "@/src/components/MacroCard";
import { Button, Chip, ErrorText } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const UNITS = ["serving", "g", "kg", "mL", "L", "cups", "oz", "lbs", "kcal", "handful", "bag", "pinch", "scoop", "bowlful", "package"];
const FLEX_DEFAULT: Record<string, number> = { handful: 30, bag: 150, pinch: 0.5, scoop: 30, bowlful: 250, package: 200, cup: 240 };
const KEYS = ["calories", "protein", "carbs", "fat", "fiber"] as const;
type Key = (typeof KEYS)[number];

function gramsFor(est: FoodEstimate, qty: number, unit: string): number {
  const d = est.density_g_per_ml || 1;
  const ug = est.unit_grams || {};
  switch (unit) {
    case "g": return qty;
    case "kg": return qty * 1000;
    case "oz": return qty * 28.35;
    case "lbs": return qty * 453.6;
    case "mL": return qty * d;
    case "L": return qty * 1000 * d;
    case "cups": return qty * (ug.cup || 240 * d);
    case "kcal": return est.per_100g.calories ? (qty / est.per_100g.calories) * 100 : 0;
    case "serving": return qty * (est.serving_g || 100);
    default: return qty * (ug[unit] || FLEX_DEFAULT[unit] || est.serving_g || 100);
  }
}

export default function LogFood() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { date } = useLocalSearchParams<{ date?: string }>();
  const day = date || todayISO();
  const [type, setType] = useState<string>(() => {
    const h = new Date().getHours();
    return h < 11 ? "Breakfast" : h < 15 ? "Lunch" : h < 21 ? "Dinner" : "Snack";
  });
  const [desc, setDesc] = useState("");
  const [est, setEst] = useState<FoodEstimate | null>(null);
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("serving");
  const [manual, setManual] = useState<Record<Key, string>>({ calories: "", protein: "", carbs: "", fat: "", fiber: "" });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const q = Math.max(0, parseFloat(qty.replace(",", ".")) || 0);
  const grams = est ? gramsFor(est, q, unit) : 0;
  const computed = useMemo(() => {
    if (!est) return null;
    const out: Record<Key, number> = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    KEYS.forEach((k) => (out[k] = Math.round(((est.per_100g[k] || 0) * grams) / 10) / 10));
    if (unit === "kcal") out.calories = q;
    return out;
  }, [est, grams, unit, q]);

  const apply = (r: FoodEstimate) => {
    setEst(r);
    setName(r.name);
    setQty(String(r.suggested_quantity || 1));
    setUnit(UNITS.includes(r.suggested_unit) ? r.suggested_unit : "serving");
  };

  const estimate = async () => {
    setError("");
    if (desc.trim().length < 2) return setError("Describe what you ate, e.g. “goldfish crackers”");
    setBusy(true);
    try {
      apply(await api<FoodEstimate>("/nutrition/estimate", { method: "POST", body: { text: desc.trim() } }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const fromPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.5 });
    if (res.canceled || !res.assets[0]) return;
    setBusy(true);
    setError("");
    try {
      apply(await uploadScan<FoodEstimate>("/nutrition/estimate-photo", res.assets[0]));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setError("");
    const n = name.trim() || desc.trim();
    if (!n) return setError("Give the food a name");
    const vals = computed ?? (Object.fromEntries(KEYS.map((k) => [k, Math.max(0, parseFloat(manual[k]) || 0)])) as Record<Key, number>);
    setSaving(true);
    try {
      await api("/logs", { method: "POST", body: { date: day, meal_type: type, name: n, quantity: q || 1, unit, ...vals } });
      qc.invalidateQueries({ queryKey: ["range"] });
      qc.invalidateQueries({ queryKey: ["rewards"] });
      router.back();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="log-close-button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name="close" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Log food</Text>
          <Text style={styles.hint}>{day === todayISO() ? "Today" : new Date(day + "T00:00:00").toDateString()}</Text>
        </View>
      </View>
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing["2xl"] }]}>
        <View style={styles.chips}>
          {MEAL_TYPES.map((t) => (
            <Chip key={t} testID={`log-type-${t}`} label={t} selected={type === t} onPress={() => setType(t)} />
          ))}
        </View>
        <View style={styles.aiCard}>
          <TextInput testID="log-description-input" style={[styles.input, { height: 72, paddingTop: spacing.md, textAlignVertical: "top" }]} value={desc} onChangeText={setDesc} multiline placeholder="What did you eat? e.g. a handful of goldfish crackers" placeholderTextColor={colors.muted} />
          <View style={styles.row}>
            <Button testID="log-estimate-button" small label="Find nutrition" icon="sparkles" onPress={estimate} loading={busy} style={{ flex: 1 }} />
            <Button testID="log-photo-button" small label="Photo" icon="image-outline" variant="outline" onPress={fromPhoto} disabled={busy} />
          </View>
        </View>

        <TextInput testID="log-name-input" style={styles.input} value={name} onChangeText={setName} placeholder="Food name" placeholderTextColor={colors.muted} />

        {est ? (
          <View testID="log-serving-card" style={{ gap: spacing.md }}>
            <Text testID="log-serving-label" style={styles.suggest}>
              Suggested serving: {est.serving_label || `1 serving (${Math.round(est.serving_g)} g)`} · AI estimate, edit freely
            </Text>
            <View style={styles.row}>
              <TextInput testID="log-quantity-input" style={[styles.input, { width: 100, textAlign: "center" }]} value={qty} onChangeText={setQty} keyboardType="decimal-pad" />
              <Text style={styles.unitNow}>{unit}</Text>
              <Text style={styles.hint}>≈ {Math.round(grams)} g</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, height: 56, alignItems: "center" }}>
              {UNITS.map((u) => (
                <Chip key={u} testID={`log-unit-${u}`} label={u} selected={unit === u} onPress={() => setUnit(u)} />
              ))}
            </ScrollView>
            {computed ? <MacroCard testID="log-macros" title="Nutrition for this amount" totals={computed} /> : null}
          </View>
        ) : (
          <View style={styles.grid}>
            {KEYS.map((k) => (
              <View key={k} style={styles.field}>
                <Text style={styles.label}>{k === "fiber" ? "Fibre (g)" : k === "calories" ? "Calories" : `${k[0].toUpperCase()}${k.slice(1)} (g)`}</Text>
                <TextInput testID={`log-${k}-input`} style={styles.input} value={manual[k]} onChangeText={(v) => setManual((m) => ({ ...m, [k]: v }))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.muted} />
              </View>
            ))}
          </View>
        )}
        <ErrorText testID="log-error" text={error} />
        <Button testID="log-save-button" label="Save to food log" icon="checkmark-circle" onPress={save} loading={saving} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: c.divider },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  headerTitle: { fontFamily: fonts.display, fontSize: 22, fontWeight: "500", color: c.onSurface },
  hint: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  content: { padding: spacing.xl, gap: spacing.lg },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  aiCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  suggest: { fontFamily: fonts.text, fontSize: 13, fontWeight: "800", color: c.onBrandTertiary },
  unitNow: { fontFamily: fonts.display, fontSize: 18, color: c.onSurface },
  label: { fontFamily: fonts.text, fontSize: 13, fontWeight: "800", color: c.onSurface },
  input: { height: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.card, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 16, color: c.onSurface },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  field: { width: "47%", flexGrow: 1, gap: 6 },
}));
