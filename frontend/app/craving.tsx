import Ionicons from "@react-native-vector-icons/ionicons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, MEAL_TYPES, Recipe, todayISO } from "@/src/api";
import { Button, Chip, ErrorText } from "@/src/components/ui";
import { queryClient } from "@/src/query-client";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

// Feature 1: describe a craving → one AI meal.
export default function Craving() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { date } = useLocalSearchParams<{ date?: string }>();
  const day = date || todayISO();
  const [prompt, setPrompt] = useState("");
  const [context, setContext] = useState("");
  const [showCtx, setShowCtx] = useState(false);
  const [type, setType] = useState("Dinner");
  const [addToDay, setAddToDay] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const go = async () => {
    setError("");
    if (prompt.trim().length < 2) return setError("Tell us what you're in the mood for");
    setBusy(true);
    try {
      const res = await api<{ recipe: Recipe }>("/meals/generate", { method: "POST", body: { kind: "craving", prompt, context, meal_type: type, date: addToDay ? day : null } });
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
        <Pressable testID="craving-close-button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name="close" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>AI meal generator</Text>
      </View>
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing["2xl"] }]}>
        <Text style={styles.lead}>What are you craving?</Text>
        <TextInput
          testID="craving-input"
          style={styles.big}
          value={prompt}
          onChangeText={setPrompt}
          multiline
          placeholder="e.g. Something spicy and comforting, like a creamy curry, ready in 30 minutes"
          placeholderTextColor={colors.muted}
        />
        {showCtx ? (
          <TextInput
            testID="craving-context-input"
            style={styles.big}
            value={context}
            onChangeText={setContext}
            multiline
            placeholder="More context: who's eating, restrictions, equipment, what to avoid, leftovers to use…"
            placeholderTextColor={colors.muted}
          />
        ) : (
          <Button testID="craving-add-context-button" small variant="outline" icon="add" label="Add context" onPress={() => setShowCtx(true)} style={{ alignSelf: "flex-start" }} />
        )}
        <View style={styles.chips}>
          {MEAL_TYPES.map((t) => (
            <Chip key={t} testID={`craving-type-${t}`} label={t} selected={type === t} onPress={() => setType(t)} />
          ))}
        </View>
        <View style={styles.switchRow}>
          <Text style={[styles.label, { flex: 1 }]}>Add to {day === todayISO() ? "today" : new Date(day + "T00:00:00").toDateString()} as a suggestion</Text>
          <Switch testID="craving-add-to-day-switch" value={addToDay} onValueChange={setAddToDay} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.card} />
        </View>
        <ErrorText testID="craving-error" text={error} />
        <Button testID="craving-generate-button" label={busy ? "Cooking up an idea…" : "Generate meal"} icon="sparkles" onPress={go} loading={busy} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: c.divider },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  headerTitle: { fontFamily: fonts.display, fontSize: 22, fontWeight: "500", color: c.onSurface },
  content: { padding: spacing.xl, gap: spacing.lg },
  lead: { fontFamily: fonts.display, fontSize: 26, fontWeight: "500", color: c.onSurface },
  big: { minHeight: 140, borderRadius: radius.lg, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.card, padding: spacing.lg, fontFamily: fonts.text, fontSize: 16, color: c.onSurface, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  label: { fontFamily: fonts.text, fontSize: 14, fontWeight: "800", color: c.onSurface },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg },
}));
