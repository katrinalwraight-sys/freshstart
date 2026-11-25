import { router } from "expo-router";
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, MEAL_TYPES, Recipe, toISO } from "@/src/api";
import { Button, Chip, ErrorText } from "@/src/components/ui";
import { queryClient } from "@/src/query-client";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

function Sheet({ visible, onClose, title, children, testID }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; testID?: string }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View testID={testID} style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.grabber} />
          <Text style={styles.title}>{title}</Text>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export { Sheet };

export function SwapSheet({ recipe, onClose, navigate }: { recipe: Recipe | null; onClose: () => void; navigate?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [reason, setReason] = useState("");
  const [craving, setCraving] = useState("");
  const [ings, setIngs] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!recipe) return;
    setBusy(true);
    setError("");
    try {
      const res = await api<{ recipe: Recipe }>(`/recipes/${recipe.id}/swap`, { method: "POST", body: { reason, craving, ingredients: ings } });
      queryClient.invalidateQueries();
      setReason("");
      setCraving("");
      setIngs("");
      onClose();
      if (navigate) router.replace({ pathname: "/recipe/[id]", params: { id: res.recipe.id } });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={!!recipe} onClose={onClose} title={`Swap “${recipe?.title ?? ""}”`} testID="swap-sheet">
      <TextInput testID="swap-reason-input" style={styles.input} value={reason} onChangeText={setReason} placeholder="Why not this meal? e.g. too heavy, kids won't eat it" placeholderTextColor={colors.muted} />
      <TextInput testID="swap-craving-input" style={styles.input} value={craving} onChangeText={setCraving} placeholder="What are you craving instead?" placeholderTextColor={colors.muted} />
      <TextInput testID="swap-ingredients-input" style={styles.input} value={ings} onChangeText={setIngs} placeholder="Ingredients to use or avoid" placeholderTextColor={colors.muted} />
      <ErrorText testID="swap-error" text={error} />
      <Button testID="swap-submit-button" label={busy ? "Finding a better meal…" : "Swap meal"} icon="shuffle" onPress={submit} loading={busy} />
    </Sheet>
  );
}

export function MoveSheet({ recipe, onClose }: { recipe: Recipe | null; onClose: () => void }) {
  const styles = useStyles();
  const [date, setDate] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const days = Array.from({ length: 21 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });
  const submit = async () => {
    if (!recipe) return;
    setBusy(true);
    try {
      await api(`/recipes/${recipe.id}/move`, { method: "POST", body: { date: date ?? recipe.date, meal_type: type ?? recipe.meal_type } });
      queryClient.invalidateQueries();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={!!recipe} onClose={onClose} title="Move to another day" testID="move-sheet">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {days.map((d) => {
          const iso = toISO(d);
          return <Chip key={iso} testID={`move-date-${iso}`} label={d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })} selected={(date ?? recipe?.date) === iso} onPress={() => setDate(iso)} />;
        })}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {MEAL_TYPES.map((m) => (
          <Chip key={m} testID={`move-type-${m}`} label={m} selected={(type ?? recipe?.meal_type) === m} onPress={() => setType(m)} />
        ))}
      </ScrollView>
      <Button testID="move-submit-button" label="Move meal" icon="calendar" onPress={submit} loading={busy} />
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: c.scrim },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.xl, gap: spacing.md, maxHeight: "90%" },
  grabber: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: c.border, marginBottom: spacing.sm },
  title: { fontFamily: fonts.display, fontSize: 22, fontWeight: "500", color: c.onSurface },
  input: { minHeight: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.card, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  row: { gap: spacing.sm, alignItems: "center", height: 56 },
}));
