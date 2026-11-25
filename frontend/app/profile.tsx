import Ionicons from "@react-native-vector-icons/ionicons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DEFAULT_STORES, Profile } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Button, Chip, ErrorText, PressableScale } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const APPLIANCES = ["Stove", "Oven", "Microwave", "Air fryer", "Slow cooker", "Rice cooker", "Blender", "Grill", "Kettle", "Toaster", "Instant Pot"];
const ALLERGIES = ["Peanuts", "Tree nuts", "Dairy", "Eggs", "Gluten", "Soy", "Shellfish", "Fish", "Sesame"];
const DIETS = ["Vegetarian", "Vegan", "Halal", "Kosher", "Pescatarian", "Low carb", "Dairy-free", "Gluten-free", "Keto"];
const CURRENCIES = ["$", "£", "€", "₹", "A$", "C$", "¥"];

function toggle(list: string[], v: string) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export default function ProfileScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const isOnboarding = onboarding === "1";
  const { user, saveProfile, logout } = useAuth();
  const [p, setP] = useState<Profile>(user?.profile ?? ({} as Profile));
  const [budgetText, setBudgetText] = useState(String(user?.profile.weekly_budget ?? 80));
  const [customAllergy, setCustomAllergy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (patch: Partial<Profile>) => setP((x) => ({ ...x, ...patch }));

  const save = async () => {
    setError("");
    const budget = parseFloat(budgetText.replace(/[^0-9.]/g, ""));
    if (isNaN(budget) || budget <= 0) return setError("Enter a weekly budget");
    if (!p.appliances.length) return setError("Pick at least one appliance");
    setBusy(true);
    try {
      await saveProfile({ ...p, weekly_budget: budget, onboarded: true });
      if (isOnboarding) router.replace("/(tabs)");
      else router.back();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addAllergy = () => {
    const v = customAllergy.trim();
    if (v && !p.allergies.includes(v)) set({ allergies: [...p.allergies, v] });
    setCustomAllergy("");
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        {!isOnboarding ? (
          <Pressable testID="profile-back-button" onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
          </Pressable>
        ) : null}
        <Text style={styles.headerTitle}>{isOnboarding ? "Set up your kitchen" : "Household & Family"}</Text>
      </View>
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing["2xl"] }]}>
        {isOnboarding ? <Text style={styles.lead}>Tell us about your household so every plan fits your people, budget and kitchen.</Text> : null}

        <View style={styles.section}>
          <Text style={styles.label}>Your name</Text>
          <TextInput testID="profile-name-input" style={styles.input} value={p.name} onChangeText={(name) => set({ name })} placeholder="Alex" placeholderTextColor={colors.muted} />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Household size</Text>
          <View style={styles.stepper}>
            <PressableScale testID="household-minus" onPress={() => set({ household_size: Math.max(1, p.household_size - 1) })} style={styles.stepBtn}>
              <Ionicons name="remove" size={22} color={colors.onBrandTertiary} />
            </PressableScale>
            <View style={{ alignItems: "center", flex: 1 }}>
              <Text testID="household-size-value" style={styles.stepValue}>
                {p.household_size}
              </Text>
              <Text style={styles.hint}>{p.household_size === 1 ? "person" : "people"}</Text>
            </View>
            <PressableScale testID="household-plus" onPress={() => set({ household_size: Math.min(20, p.household_size + 1) })} style={styles.stepBtn}>
              <Ionicons name="add" size={22} color={colors.onBrandTertiary} />
            </PressableScale>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Weekly food budget</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {CURRENCIES.map((c) => (
              <Chip key={c} testID={`currency-${c}`} label={c} selected={p.currency === c} onPress={() => set({ currency: c })} />
            ))}
          </ScrollView>
          <View style={styles.budgetWrap}>
            <Text style={styles.budgetCur}>{p.currency}</Text>
            <TextInput testID="profile-budget-input" style={styles.budgetInput} value={budgetText} onChangeText={setBudgetText} keyboardType="decimal-pad" placeholder="80" placeholderTextColor={colors.muted} />
            <Text style={styles.hint}>/ week</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Grocery stores you shop at</Text>
          <View style={styles.wrap}>
            {DEFAULT_STORES.map((st) => (
              <Chip key={st} testID={`store-${st}`} label={st} selected={(p.stores ?? []).includes(st)} onPress={() => set({ stores: toggle(p.stores ?? [], st) })} />
            ))}
          </View>
          <Text style={styles.hint}>We compare estimated prices across these stores for your shopping list.</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Cooking appliances you have</Text>
          <View style={styles.wrap}>
            {APPLIANCES.map((a) => (
              <Chip key={a} testID={`appliance-${a}`} label={a} selected={p.appliances.includes(a)} onPress={() => set({ appliances: toggle(p.appliances, a) })} />
            ))}
          </View>
        </View>

        <View style={[styles.section, styles.familyCard]}>
          <View style={styles.familyRow}>
            <View style={styles.familyIcon}>
              <Ionicons name="people" size={22} color={colors.onBrandSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.familyTitle}>Family mode</Text>
              <Text style={styles.hint}>Strictly avoid allergens & respect diets in every meal</Text>
            </View>
            <Switch
              testID="family-mode-switch"
              value={p.family_mode}
              onValueChange={(family_mode) => set({ family_mode })}
              trackColor={{ true: colors.brandPrimary, false: colors.border }}
              thumbColor={colors.card}
            />
          </View>
          {p.family_mode ? (
            <>
              <Text style={styles.label}>Allergies</Text>
              <View style={styles.wrap}>
                {Array.from(new Set([...ALLERGIES, ...p.allergies])).map((a) => (
                  <Chip key={a} testID={`allergy-${a}`} label={a} icon={p.allergies.includes(a) ? "warning" : undefined} selected={p.allergies.includes(a)} onPress={() => set({ allergies: toggle(p.allergies, a) })} />
                ))}
              </View>
              <View style={styles.addRow}>
                <TextInput
                  testID="custom-allergy-input"
                  style={[styles.input, { flex: 1 }]}
                  value={customAllergy}
                  onChangeText={setCustomAllergy}
                  placeholder="Add another allergy"
                  placeholderTextColor={colors.muted}
                  onSubmitEditing={addAllergy}
                />
                <Button testID="add-allergy-button" small label="Add" variant="secondary" onPress={addAllergy} />
              </View>
              <Text style={styles.label}>Dietary restrictions</Text>
              <View style={styles.wrap}>
                {DIETS.map((d) => (
                  <Chip key={d} testID={`diet-${d}`} label={d} selected={p.diets.includes(d)} onPress={() => set({ diets: toggle(p.diets, d) })} />
                ))}
              </View>
            </>
          ) : null}
        </View>

        <ErrorText testID="profile-error" text={error} />
        <Button testID="profile-save-button" label={isOnboarding ? "Start cooking" : "Save changes"} icon="checkmark-circle" onPress={save} loading={busy} />
        {!isOnboarding ? (
          <Button
            testID="logout-button"
            label="Log out"
            variant="ghost"
            icon="log-out-outline"
            onPress={async () => {
              await logout();
              router.replace("/auth");
            }}
          />
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: c.divider, backgroundColor: c.surface },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  headerTitle: { fontFamily: fonts.display, fontSize: 24, fontWeight: "500", color: c.onSurface, paddingLeft: spacing.sm },
  content: { padding: spacing.xl, gap: spacing.xl },
  lead: { fontFamily: fonts.text, fontSize: 16, color: c.muted, lineHeight: 22 },
  section: { gap: spacing.md },
  label: { fontFamily: fonts.text, fontSize: 15, fontWeight: "800", color: c.onSurface },
  hint: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  input: { height: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.card, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 16, color: c.onSurface },
  stepper: { flexDirection: "row", alignItems: "center", backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1.5, borderColor: c.border, padding: spacing.sm },
  stepBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  stepValue: { fontFamily: fonts.display, fontSize: 30, fontWeight: "500", color: c.onSurface },
  chipRow: { gap: spacing.sm, paddingRight: spacing.lg },
  budgetWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1.5, borderColor: c.border, paddingHorizontal: spacing.lg, height: 64 },
  budgetCur: { fontFamily: fonts.display, fontSize: 26, color: c.brandPrimary, fontWeight: "500" },
  budgetInput: { flex: 1, fontFamily: fonts.display, fontSize: 26, color: c.onSurface, height: 60 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  familyCard: { backgroundColor: c.surfaceTertiary, borderRadius: radius.lg, padding: spacing.lg },
  familyRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  familyIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.brandSecondary, alignItems: "center", justifyContent: "center" },
  familyTitle: { fontFamily: fonts.display, fontSize: 18, fontWeight: "500", color: c.onSurface },
  addRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
}));
