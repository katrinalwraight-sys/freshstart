import Ionicons from "@react-native-vector-icons/ionicons";
import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Platform, Pressable, RefreshControl, ScrollView, Share, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, BACKEND_URL, DEFAULT_STORES, ShoppingItem } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Sheet } from "@/src/components/Sheets";
import { Button, Chip, EmptyState, Loading, tap } from "@/src/components/ui";
import { useShopping } from "@/src/hooks";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Shopping() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const qc = useQueryClient();
  const { user } = useAuth();
  const cur = user?.profile.currency ?? "$";
  const budget = user?.profile.weekly_budget ?? 0;
  const { data, isLoading, isError, refetch, isRefetching } = useShopping();
  const [newItem, setNewItem] = useState("");
  const [detail, setDetail] = useState<ShoppingItem | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const items = useMemo(() => data ?? [], [data]);
  const open = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);

  const stores = useMemo(() => {
    const seen = new Set<string>(user?.profile.stores?.length ? user.profile.stores : []);
    items.forEach((i) => Object.keys(i.prices || {}).forEach((s) => seen.add(s)));
    return seen.size ? [...seen] : DEFAULT_STORES.slice(0, 2);
  }, [items, user]);
  const totals = useMemo(() => Object.fromEntries(stores.map((s) => [s, open.reduce((t, i) => t + (i.prices?.[s] ?? i.est_cost ?? 0), 0)])), [stores, open]);
  const cheapest = stores.reduce((a, b) => (totals[b] < totals[a] ? b : a), stores[0]);
  const [store, setStore] = useState<string | null>(null);
  const active = store ?? cheapest;
  const total = totals[active] ?? 0;
  const groups = useMemo(() => {
    const m: Record<string, ShoppingItem[]> = {};
    open.forEach((i) => (m[i.aisle] = [...(m[i.aisle] ?? []), i]));
    return Object.entries(m);
  }, [open]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["shopping"] });
  const toggle = async (it: ShoppingItem) => {
    tap();
    qc.setQueryData<ShoppingItem[]>(["shopping"], (old) => (old ?? []).map((x) => (x.id === it.id ? { ...x, checked: !x.checked } : x)));
    await api(`/shopping/${it.id}`, { method: "PATCH", body: { checked: !it.checked } }).catch(refresh);
  };
  const add = async () => {
    const name = newItem.trim();
    if (!name) return;
    setNewItem("");
    await api("/shopping", { method: "POST", body: { name } });
    refresh();
  };
  const toPantry = async (id?: string) => {
    await api(id ? `/shopping/${id}/to-pantry` : "/shopping/checked-to-pantry", { method: "POST" });
    setDetail(null);
    refresh();
    qc.invalidateQueries({ queryKey: ["pantry"] });
  };
  const share = async () => {
    const r = await api<{ path: string }>("/shopping/share", { method: "POST" });
    setCopied(false);
    setShareUrl(`${BACKEND_URL}${r.path}`);
  };

  const Row = ({ it }: { it: ShoppingItem }) => (
    <Pressable testID={`shopping-item-${it.id}`} onPress={() => setDetail(it)} style={styles.row}>
      <Pressable testID={`shopping-check-${it.id}`} onPress={() => toggle(it)} hitSlop={10} style={[styles.check, it.checked && styles.checkOn]}>
        {it.checked ? <Ionicons name="checkmark" size={18} color={colors.onBrandPrimary} /> : null}
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowName, it.checked && styles.struck]} numberOfLines={1}>
          {it.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {[it.quantity, it.reason === "top_up" ? "top up" : "", it.needed_for.length > 1 ? `${it.needed_for.length} meals` : it.needed_for[0]?.title].filter(Boolean).join(" · ")}
        </Text>
      </View>
      {(it.prices?.[active] ?? it.est_cost) > 0 ? (
        <Text style={[styles.price, it.checked && styles.struck]}>
          {cur}
          {(it.prices?.[active] ?? it.est_cost).toFixed(2)}
        </Text>
      ) : null}
    </Pressable>
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Shopping</Text>
          <Pressable testID="shopping-share-button" onPress={share} style={styles.shareBtn} hitSlop={6}>
            <Ionicons name="share-social" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
        <View testID="shopping-budget" style={styles.budget}>
          <Text testID="shopping-running-total" style={styles.total}>
            {cur}
            {total.toFixed(2)}
          </Text>
          <Text style={[styles.budgetText, total > budget && { color: colors.error }]}>
            at {active} · budget {cur}
            {budget} {total > budget ? "· over budget" : "· on track"}
          </Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(100, budget ? (total / budget) * 100 : 0)}%`, backgroundColor: total > budget ? colors.error : colors.brandPrimary }]} />
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginHorizontal: -spacing.xl }} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.xl, height: 56, alignItems: "center" }}>
          {stores.map((s) => (
            <Chip key={s} testID={`store-chip-${s}`} label={`${s} ${cur}${(totals[s] ?? 0).toFixed(0)}${s === cheapest ? " ★" : ""}`} selected={active === s} onPress={() => setStore(s)} />
          ))}
        </ScrollView>
        <View style={styles.addRow}>
          <TextInput testID="shopping-add-input" style={styles.input} value={newItem} onChangeText={setNewItem} placeholder="Add an item…" placeholderTextColor={colors.muted} onSubmitEditing={add} returnKeyType="done" />
          <Pressable testID="shopping-add-button" onPress={add} style={styles.addBtn}>
            <Ionicons name="add" size={24} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <Loading testID="shopping-loading" />
      ) : isError ? (
        <EmptyState testID="shopping-error" icon="cloud-offline" title="Couldn't load list" body="Check your connection and try again." action={<Button label="Retry" onPress={() => refetch()} />} />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg, paddingBottom: bottomChrome + spacing.xl }} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}>
          {items.length === 0 ? (
            <EmptyState testID="shopping-empty" icon="cart-outline" title="Nothing to buy yet" body="Plan meals and only what's missing from your pantry lands here." action={<Button testID="shopping-go-plan-button" label="Plan meals" icon="calendar" onPress={() => router.push("/plan")} />} />
          ) : null}
          {groups.map(([aisle, list]) => (
            <View key={aisle} style={{ gap: spacing.sm }}>
              <Text style={styles.aisle}>{aisle}</Text>
              <View style={styles.card}>
                {list.map((it) => (
                  <Row key={it.id} it={it} />
                ))}
              </View>
            </View>
          ))}
          {done.length ? (
            <View style={{ gap: spacing.sm }}>
              <View style={styles.doneHead}>
                <Text style={styles.aisle}>Bought ({done.length})</Text>
                <Pressable testID="shopping-clear-checked" onPress={async () => { await api("/shopping/checked", { method: "DELETE" }); refresh(); }} hitSlop={8}>
                  <Text style={styles.link}>Clear</Text>
                </Pressable>
              </View>
              <Button testID="shopping-checked-to-pantry" small variant="secondary" icon="file-tray-stacked" label="Add bought items to pantry" onPress={() => toPantry()} />
              <View style={[styles.card, { opacity: 0.7 }]}>
                {done.map((it) => (
                  <Row key={it.id} it={it} />
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}

      <Sheet visible={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? ""} testID="shopping-detail-sheet">
        {detail ? (
          <ScrollView contentContainerStyle={{ gap: spacing.md }}>
            <View style={styles.pills}>
              <View style={[styles.pill, { backgroundColor: detail.reason === "top_up" ? colors.warningSoft : colors.brandTertiary }]}>
                <Text style={styles.pillText}>{detail.reason === "top_up" ? `Top up — you have ${detail.pantry_have || "some"}, not enough` : detail.reason === "missing" ? "Not in your pantry" : "Added by you"}</Text>
              </View>
              {detail.quantity ? (
                <View style={[styles.pill, { backgroundColor: colors.surfaceSecondary }]}>
                  <Text style={styles.pillText}>Need {detail.quantity}</Text>
                </View>
              ) : null}
            </View>
            {detail.needed_for.length ? (
              <View style={styles.box}>
                <Text style={styles.boxTitle}>{detail.needed_for.length > 1 ? `Needed for ${detail.needed_for.length} meals` : "Needed for"}</Text>
                {detail.needed_for.map((n, i) => (
                  <Pressable key={i} testID={`shopping-needed-${i}`} onPress={() => { setDetail(null); if (n.recipe_id) router.push({ pathname: "/recipe/[id]", params: { id: n.recipe_id } }); }} style={styles.needRow}>
                    <Text style={styles.needText}>{n.title || "Meal plan"}</Text>
                    <Text style={styles.rowMeta}>{n.quantity}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {Object.keys(detail.prices || {}).length ? (
              <View style={styles.box}>
                <Text style={styles.boxTitle}>Price comparison (AI estimate)</Text>
                {detail.product ? <Text style={styles.rowMeta}>{detail.product}</Text> : null}
                {Object.entries(detail.prices).sort((a, b) => a[1] - b[1]).map(([s, p], i) => (
                  <View key={s} style={styles.needRow}>
                    <Text style={[styles.needText, i === 0 && { color: colors.success }]}>{s}{i === 0 ? " · cheapest" : ""}</Text>
                    <Text style={styles.price}>
                      {cur}
                      {p.toFixed(2)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            <Button testID="shopping-bought-to-pantry" label="Bought — add to pantry" icon="file-tray-stacked" onPress={() => toPantry(detail.id)} />
            <Button testID="shopping-delete-item" label="Remove from list" icon="trash-outline" variant="ghost" onPress={async () => { await api(`/shopping/${detail.id}`, { method: "DELETE" }); setDetail(null); refresh(); }} />
          </ScrollView>
        ) : null}
      </Sheet>

      <Sheet visible={!!shareUrl} onClose={() => setShareUrl(null)} title="Share with your household" testID="share-sheet">
        <Text style={styles.rowMeta}>Anyone with this link can see the list and tick items off — no account needed.</Text>
        <Text testID="share-url" selectable style={styles.url}>
          {shareUrl}
        </Text>
        <View style={styles.addRow}>
          <Button testID="share-copy-button" small variant="outline" icon={copied ? "checkmark" : "copy-outline"} label={copied ? "Copied" : "Copy link"} onPress={async () => { await Clipboard.setStringAsync(shareUrl ?? ""); setCopied(true); }} style={{ flex: 1 }} />
          {Platform.OS !== "web" ? <Button testID="share-native-button" small icon="share-outline" label="Share" onPress={() => Share.share({ message: `Our Fresh Start shopping list: ${shareUrl}` })} style={{ flex: 1 }} /> : null}
        </View>
        <Button testID="share-revoke-button" small variant="ghost" icon="close-circle-outline" label="Stop sharing" onPress={async () => { try { await api("/shopping/share/revoke", { method: "POST" }); } catch {} setShareUrl(null); }} />
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { paddingHorizontal: spacing.xl, gap: spacing.sm, paddingBottom: spacing.md, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.divider },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontFamily: fonts.display, fontSize: 30, fontWeight: "500", color: c.onSurface },
  shareBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  budget: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, gap: 4 },
  total: { fontFamily: fonts.display, fontSize: 26, color: c.brandPrimary },
  budgetText: { fontFamily: fonts.text, fontSize: 13, fontWeight: "800", color: c.onSurface },
  track: { height: 8, borderRadius: 4, backgroundColor: c.brandTertiary, overflow: "hidden", marginTop: 4 },
  fill: { height: 8 },
  addRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: { flex: 1, height: 46, borderRadius: radius.pill, backgroundColor: c.surfaceSecondary, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  addBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  aisle: { fontFamily: fonts.display, fontSize: 18, fontWeight: "500", color: c.onSurface },
  doneHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  link: { fontFamily: fonts.text, fontSize: 14, fontWeight: "800", color: c.brandPrimary },
  card: { backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 60, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  check: { width: 28, height: 28, borderRadius: 10, borderWidth: 2, borderColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: c.brandPrimary },
  rowName: { fontFamily: fonts.text, fontSize: 16, fontWeight: "800", color: c.onSurface },
  rowMeta: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  price: { fontFamily: fonts.text, fontSize: 14, fontWeight: "800", color: c.onSurface },
  struck: { textDecorationLine: "line-through", color: c.muted },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  pillText: { fontFamily: fonts.text, fontSize: 13, fontWeight: "800", color: c.onSurface },
  box: { backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.md, gap: spacing.sm },
  boxTitle: { fontFamily: fonts.display, fontSize: 16, fontWeight: "500", color: c.onSurface },
  needRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 40 },
  needText: { flex: 1, fontFamily: fonts.text, fontSize: 14, fontWeight: "700", color: c.onSurface },
  url: { fontFamily: fonts.text, fontSize: 13, color: c.onBrandTertiary, backgroundColor: c.brandTertiary, padding: spacing.md, borderRadius: radius.md },
}));
