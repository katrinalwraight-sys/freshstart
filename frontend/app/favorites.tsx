import Ionicons from "@react-native-vector-icons/ionicons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, todayISO } from "@/src/api";
import { useAuth } from "@/src/auth";
import { RecipeCard } from "@/src/components/RecipeCard";
import { Button, EmptyState, Loading } from "@/src/components/ui";
import { useFavorites } from "@/src/hooks";
import { queryClient } from "@/src/query-client";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

export default function Favorites() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { date } = useLocalSearchParams<{ date?: string }>();
  const day = date || todayISO();
  const { data, isLoading } = useFavorites();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);

  const add = async (id: string) => {
    setBusy(id);
    try {
      await api(`/recipes/${id}/schedule`, { method: "POST", body: { date: day } });
      queryClient.invalidateQueries();
      setDone((d) => [...d, id]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="favorites-back-button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Favourites</Text>
      </View>
      {isLoading ? (
        <Loading />
      ) : !(data ?? []).length ? (
        <EmptyState testID="favorites-empty" icon="heart-outline" title="No favourites yet" body="Tap the heart on any meal to save it here." />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.md, paddingBottom: insets.bottom + spacing.xl }}>
          {(data ?? []).map((r) => (
            <RecipeCard
              key={r.id}
              testID={`favorite-${r.id}`}
              recipe={r}
              currency={user?.profile.currency ?? "$"}
              footer={
                <Button
                  testID={`favorite-add-${r.id}`}
                  small
                  variant={done.includes(r.id) ? "outline" : "secondary"}
                  icon={done.includes(r.id) ? "checkmark" : "calendar"}
                  label={done.includes(r.id) ? "Added" : `Add to ${day === todayISO() ? "today" : new Date(day + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}`}
                  onPress={() => add(r.id)}
                  loading={busy === r.id}
                  disabled={done.includes(r.id)}
                  style={{ alignSelf: "flex-start", marginTop: spacing.sm }}
                />
              }
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: c.divider },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  headerTitle: { fontFamily: fonts.display, fontSize: 24, fontWeight: "500", color: c.onSurface },
}));
