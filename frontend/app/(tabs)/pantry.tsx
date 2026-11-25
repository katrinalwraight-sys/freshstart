import Ionicons from "@react-native-vector-icons/ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, PantryItem } from "@/src/api";
import { Button, Chip, EmptyState, ErrorText, ExpiryTag, Loading, PressableScale } from "@/src/components/ui";
import { usePantry } from "@/src/hooks";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const CATEGORIES = ["Produce", "Dairy", "Meat", "Seafood", "Bakery", "Pantry", "Frozen", "Drinks", "Condiments", "Snacks", "Other"];
const EXPIRY_PRESETS = [
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
  { label: "6 months", days: 180 },
];

function plusDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
}

export default function Pantry() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch, isRefetching } = usePantry();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [editing, setEditing] = useState<Partial<PantryItem> | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [expiryDays, setExpiryDays] = useState<number | null>(7);

  const cats = useMemo(() => ["All", ...CATEGORIES.filter((c) => (data ?? []).some((i) => i.category === c))], [data]);
  const items = useMemo(
    () => (data ?? []).filter((i) => (cat === "All" || i.category === cat) && i.name.toLowerCase().includes(q.trim().toLowerCase())),
    [data, cat, q],
  );

  const openNew = () => {
    setFormError("");
    setExpiryDays(7);
    setEditing({ name: "", quantity: "", category: "Produce", expiry_date: null });
  };

  const save = async () => {
    if (!editing?.name?.trim()) return setFormError("Give the item a name");
    setSaving(true);
    try {
      const body = { name: editing.name, quantity: editing.quantity ?? "", category: editing.category ?? "Other", expiry_date: editing.id ? editing.expiry_date : expiryDays ? plusDays(expiryDays) : null };
      if (editing.id) await api(`/pantry/${editing.id}`, { method: "PUT", body });
      else await api("/pantry", { method: "POST", body });
      await qc.invalidateQueries({ queryKey: ["pantry"] });
      setEditing(null);
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    qc.setQueryData<PantryItem[]>(["pantry"], (old) => (old ?? []).filter((i) => i.id !== id));
    try {
      await api(`/pantry/${id}`, { method: "DELETE" });
    } finally {
      qc.invalidateQueries({ queryKey: ["pantry"] });
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Pantry</Text>
          <Text testID="pantry-count" style={styles.count}>
            {(data ?? []).length} items
          </Text>
        </View>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput testID="pantry-search-input" style={styles.searchInput} value={q} onChangeText={setQ} placeholder="Search your kitchen" placeholderTextColor={colors.muted} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
          {cats.map((c) => (
            <Chip key={c} testID={`pantry-cat-${c}`} label={c} selected={cat === c} onPress={() => setCat(c)} />
          ))}
        </ScrollView>
      </View>

      {isLoading ? (
        <Loading testID="pantry-loading" />
      ) : isError ? (
        <EmptyState testID="pantry-error" icon="cloud-offline" title="Couldn't load pantry" body="Check your connection and try again." action={<Button label="Retry" onPress={() => refetch()} />} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: spacing.xl, paddingTop: spacing.md, gap: spacing.md, paddingBottom: bottomChrome + 100 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
          ListEmptyComponent={
            <EmptyState
              testID="pantry-empty"
              icon="file-tray-outline"
              title={q || cat !== "All" ? "No matches" : "Your pantry is bare"}
              body={q || cat !== "All" ? "Try a different search or category." : "Snap a photo of your fridge or cupboard and we'll add everything for you."}
              action={!q && cat === "All" ? <Button testID="pantry-empty-scan-button" label="Scan my fridge" icon="camera" onPress={() => router.push({ pathname: "/scan", params: { mode: "pantry" } })} /> : undefined}
            />
          }
          renderItem={({ item }) => (
            <PressableScale
              testID={`pantry-item-${item.id}`}
              onPress={() => {
                setFormError("");
                setEditing(item);
              }}
              style={styles.row}
            >
              <View style={styles.rowIcon}>
                <Text style={styles.rowLetter}>{item.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {[item.quantity, item.category].filter(Boolean).join(" · ")}
                </Text>
              </View>
              <ExpiryTag date={item.expiry_date} testID={`pantry-row-expiry-${item.id}`} />
              <Pressable testID={`pantry-delete-${item.id}`} onPress={() => remove(item.id)} hitSlop={10} style={styles.del}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
              </Pressable>
            </PressableScale>
          )}
        />
      )}

      <View pointerEvents="box-none" style={[styles.fabWrap, { bottom: bottomChrome + 16 }]}>
        <PressableScale testID="pantry-scan-button" onPress={() => router.push({ pathname: "/scan", params: { mode: "pantry" } })} style={[styles.fab, styles.fabAlt]}>
          <Ionicons name="camera" size={22} color={colors.onBrandSecondary} />
        </PressableScale>
        <PressableScale testID="pantry-add-button" onPress={openNew} style={styles.fab}>
          <Ionicons name="add" size={26} color={colors.onBrandPrimary} />
        </PressableScale>
      </View>

      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <Pressable style={styles.backdrop} onPress={() => setEditing(null)} />
          <View testID="pantry-item-sheet" style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.grabber} />
            <Text style={styles.sheetTitle}>{editing?.id ? "Edit item" : "Add item"}</Text>
            <TextInput testID="pantry-name-input" style={styles.input} value={editing?.name ?? ""} onChangeText={(name) => setEditing((e) => ({ ...e, name }))} placeholder="e.g. Spinach" placeholderTextColor={colors.muted} />
            <TextInput testID="pantry-quantity-input" style={styles.input} value={editing?.quantity ?? ""} onChangeText={(quantity) => setEditing((e) => ({ ...e, quantity }))} placeholder="Remaining quantity, e.g. 450 ml" placeholderTextColor={colors.muted} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowSheet}>
              {CATEGORIES.map((c) => (
                <Chip key={c} testID={`pantry-form-cat-${c}`} label={c} selected={editing?.category === c} onPress={() => setEditing((e) => ({ ...e, category: c }))} />
              ))}
            </ScrollView>
            {!editing?.id ? (
              <>
                <Text style={styles.label}>Expires in</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowSheet}>
                  {EXPIRY_PRESETS.map((p) => (
                    <Chip key={p.days} testID={`pantry-expiry-${p.days}`} label={p.label} selected={expiryDays === p.days} onPress={() => setExpiryDays(p.days)} />
                  ))}
                  <Chip testID="pantry-expiry-none" label="No date" selected={expiryDays === null} onPress={() => setExpiryDays(null)} />
                </ScrollView>
              </>
            ) : (
              <View style={styles.expRow}>
                <Text style={styles.label}>Expiry</Text>
                <ExpiryTag date={editing.expiry_date ?? null} />
                <View style={{ flex: 1 }} />
                {[3, 7, 14].map((d) => (
                  <Chip key={d} testID={`pantry-edit-expiry-${d}`} label={`+${d}d`} onPress={() => setEditing((e) => ({ ...e, expiry_date: plusDays(d) }))} />
                ))}
              </View>
            )}
            {editing?.id ? (
              <Button
                testID="pantry-use-in-meal-button"
                label="Use in a meal"
                icon="restaurant"
                variant="secondary"
                onPress={() => {
                  const id = editing.id;
                  setEditing(null);
                  router.push({ pathname: "/cook-with", params: { preselect: id } });
                }}
              />
            ) : null}
            <ErrorText testID="pantry-form-error" text={formError} />
            <Button testID="pantry-save-button" label={editing?.id ? "Save" : "Add to pantry"} onPress={save} loading={saving} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.xl, gap: spacing.md, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.divider },
  titleRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  title: { fontFamily: fonts.display, fontSize: 32, fontWeight: "500", color: c.onSurface },
  count: { fontFamily: fonts.text, fontSize: 14, color: c.muted, fontWeight: "700" },
  search: { flexDirection: "row", alignItems: "center", gap: spacing.sm, height: 48, borderRadius: radius.pill, backgroundColor: c.surfaceSecondary, paddingHorizontal: spacing.lg },
  searchInput: { flex: 1, fontFamily: fonts.text, fontSize: 15, color: c.onSurface, height: 48 },
  chipScroll: { height: 56, flexGrow: 0, marginHorizontal: -spacing.xl },
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.xl, alignItems: "center" },
  chipRowSheet: { gap: spacing.sm, alignItems: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 68, padding: spacing.md, backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border },
  rowIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  rowLetter: { fontFamily: fonts.display, fontSize: 20, color: c.onBrandTertiary, fontWeight: "500" },
  rowName: { fontFamily: fonts.text, fontSize: 16, fontWeight: "800", color: c.onSurface },
  rowMeta: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  del: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.errorSoft },
  fabWrap: { position: "absolute", right: spacing.xl, flexDirection: "row", gap: spacing.md },
  fab: { width: 56, height: 56, borderRadius: 28, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center", shadowColor: "#D81E5B", shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  fabAlt: { backgroundColor: c.brandSecondary },
  backdrop: { flex: 1, backgroundColor: c.scrim },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.xl, gap: spacing.md },
  grabber: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: c.border, marginBottom: spacing.sm },
  sheetTitle: { fontFamily: fonts.display, fontSize: 24, fontWeight: "500", color: c.onSurface },
  label: { fontFamily: fonts.text, fontSize: 14, fontWeight: "800", color: c.onSurface },
  input: { height: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.card, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 16, color: c.onSurface },
  expRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
}));
