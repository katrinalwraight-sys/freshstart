import Ionicons from "@react-native-vector-icons/ionicons";
import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, Recipe, ScannedItem, uploadScan } from "@/src/api";
import { useAuth } from "@/src/auth";
import { RecipeCard } from "@/src/components/RecipeCard";
import { Button, ErrorText, ExpiryTag, Loading, PressableScale } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Mode = "pantry" | "leftovers";
type Stage = "pick" | "permission" | "scanning" | "review" | "error";

export default function Scan() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ mode?: Mode }>();
  const [mode, setMode] = useState<Mode>(params.mode === "leftovers" ? "leftovers" : "pantry");
  const [stage, setStage] = useState<Stage>("pick");
  const [photo, setPhoto] = useState<string | null>(null);
  const [items, setItems] = useState<(ScannedItem & { keep: boolean })[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [leftovers, setLeftovers] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const process = async (asset: ImagePicker.ImagePickerAsset) => {
    setPhoto(asset.uri);
    setStage("scanning");
    setError("");
    try {
      if (mode === "pantry") {
        const res = await uploadScan<{ items: ScannedItem[] }>("/scan/pantry", asset);
        setItems(res.items.map((i) => ({ ...i, keep: true })));
      } else {
        const res = await uploadScan<{ recipes: Recipe[]; leftovers: string[] }>("/scan/leftovers", asset);
        setRecipes(res.recipes);
        setLeftovers(res.leftovers);
      }
      setStage("review");
    } catch (e: any) {
      setError(e.message || "We couldn't read that photo clearly.");
      setStage("error");
    }
  };

  const launchCamera = async () => {
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.5 });
    if (!res.canceled && res.assets[0]) process(res.assets[0]);
  };

  const takePhoto = async () => {
    if (Platform.OS === "web") return launchCamera();
    const perm = await ImagePicker.getCameraPermissionsAsync();
    if (perm.granted) return launchCamera();
    setBlocked(!perm.canAskAgain && perm.status === "denied");
    setStage("permission");
  };

  const requestCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.granted) {
      setStage("pick");
      return launchCamera();
    }
    setBlocked(!perm.canAskAgain);
  };

  const pickLibrary = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.5 });
    if (!res.canceled && res.assets[0]) process(res.assets[0]);
  };

  const addToPantry = async () => {
    const keep = items.filter((i) => i.keep && i.name.trim());
    if (!keep.length) return setError("Select at least one item");
    setSaving(true);
    try {
      await api("/pantry/bulk", { method: "POST", body: { items: keep.map(({ keep: _k, ...rest }) => rest) } });
      await qc.invalidateQueries({ queryKey: ["pantry"] });
      router.replace("/(tabs)/pantry");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setStage("pick");
    setPhoto(null);
    setItems([]);
    setRecipes([]);
    setError("");
  };

  const keepCount = items.filter((i) => i.keep).length;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="scan-close-button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)"))} style={styles.iconBtn} hitSlop={8}>
          <Ionicons name="close" size={24} color={colors.onSurface} />
        </Pressable>
        <View style={styles.seg}>
          {(["pantry", "leftovers"] as Mode[]).map((m) => (
            <Pressable
              key={m}
              testID={`scan-mode-${m}`}
              disabled={stage === "scanning"}
              onPress={() => {
                setMode(m);
                reset();
              }}
              style={[styles.segBtn, mode === m && styles.segActive]}
            >
              <Text style={[styles.segText, mode === m && styles.segTextActive]}>{m === "pantry" ? "Fridge & pantry" : "Leftovers"}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {stage === "pick" || stage === "permission" ? (
        <ScrollView contentContainerStyle={[styles.pad, { paddingBottom: insets.bottom + spacing.xl }]}>
          <Animated.View entering={FadeInDown.duration(350)} style={styles.intro}>
            <View style={styles.bigIcon}>
              <Ionicons name={mode === "pantry" ? "scan" : "sparkles"} size={48} color={colors.brandPrimary} />
            </View>
            <Text style={styles.h1}>{mode === "pantry" ? "Snap your fridge or pantry" : "Snap your leftovers"}</Text>
            <Text style={styles.body}>
              {mode === "pantry"
                ? "Our AI spots every item, estimates how long it'll last and adds it to your pantry."
                : "We'll turn what's left into brand-new meals you haven't had recently."}
            </Text>
          </Animated.View>

          {stage === "permission" ? (
            <Animated.View entering={FadeIn} testID="camera-permission-card" style={styles.permCard}>
              <Ionicons name="camera" size={26} color={colors.onBrandTertiary} />
              <Text style={styles.permTitle}>Camera access</Text>
              <Text style={styles.body}>
                {blocked ? "Camera access is turned off. Enable it in Settings to scan your food, or choose a photo instead." : "We use the camera only to photograph your food so the AI can recognise it."}
              </Text>
              {blocked ? (
                <Button testID="open-settings-button" label="Open Settings" icon="settings-outline" onPress={() => Linking.openSettings()} />
              ) : (
                <Button testID="allow-camera-button" label="Allow camera" icon="camera" onPress={requestCamera} />
              )}
              <Button testID="permission-use-library-button" label="Choose from photos instead" variant="ghost" onPress={pickLibrary} />
            </Animated.View>
          ) : (
            <View style={{ gap: spacing.md }}>
              <Button testID="scan-take-photo-button" label="Take a photo" icon="camera" onPress={takePhoto} />
              <Button testID="scan-pick-library-button" label="Choose from photos" icon="images-outline" variant="outline" onPress={pickLibrary} />
            </View>
          )}

          <View style={styles.tipBox}>
            <Text style={styles.tipTitle}>Tips for a great scan</Text>
            <Text style={styles.tip}>• Open the door wide and use good light</Text>
            <Text style={styles.tip}>• Scan each shelf or cupboard separately</Text>
            <Text style={styles.tip}>• Labels facing the camera help a lot</Text>
          </View>
        </ScrollView>
      ) : null}

      {stage === "scanning" ? (
        <View testID="scan-loading" style={styles.scanning}>
          {photo ? <Image source={{ uri: photo }} style={styles.thumbLarge} contentFit="cover" /> : null}
          <Loading label={mode === "pantry" ? "Spotting ingredients…" : "Inventing new meals…"} />
        </View>
      ) : null}

      {stage === "error" ? (
        <View testID="scan-error" style={[styles.pad, { flex: 1, justifyContent: "center" }]}>
          <View style={styles.intro}>
            <View style={[styles.bigIcon, { backgroundColor: colors.errorSoft }]}>
              <Ionicons name="alert-circle" size={48} color={colors.error} />
            </View>
            <Text style={styles.h1}>Hmm, that didn&apos;t work</Text>
            <Text style={styles.body}>{error}</Text>
          </View>
          <Button testID="scan-retry-button" label="Try another photo" icon="refresh" onPress={reset} />
        </View>
      ) : null}

      {stage === "review" && mode === "pantry" ? (
        <>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.pad, { paddingBottom: insets.bottom + 110 }]}>
            {photo ? <Image source={{ uri: photo }} style={styles.thumb} contentFit="cover" /> : null}
            <Text testID="scan-found-count" style={styles.h2}>
              Found {items.length} item{items.length === 1 ? "" : "s"}
            </Text>
            <Text style={styles.body}>Tap to deselect anything wrong, or edit names before adding.</Text>
            {items.length === 0 ? <Text style={styles.body}>No food spotted. Try a closer, brighter photo.</Text> : null}
            {items.map((it, idx) => (
              <Animated.View key={idx} entering={FadeInDown.delay(idx * 40)} style={[styles.itemRow, !it.keep && { opacity: 0.45 }]}>
                <Pressable testID={`scan-item-toggle-${idx}`} onPress={() => setItems((l) => l.map((x, i) => (i === idx ? { ...x, keep: !x.keep } : x)))} style={[styles.check, it.keep && styles.checkOn]} hitSlop={6}>
                  {it.keep ? <Ionicons name="checkmark" size={18} color={colors.onBrandPrimary} /> : null}
                </Pressable>
                <View style={{ flex: 1 }}>
                  <TextInput
                    testID={`scan-item-name-${idx}`}
                    style={styles.itemName}
                    value={it.name}
                    onChangeText={(name) => setItems((l) => l.map((x, i) => (i === idx ? { ...x, name } : x)))}
                  />
                  <Text style={styles.itemMeta}>{[it.quantity, it.category].filter(Boolean).join(" · ")}</Text>
                </View>
                <ExpiryTag date={it.expiry_date} />
              </Animated.View>
            ))}
            <ErrorText testID="scan-review-error" text={error} />
          </ScrollView>
          <View style={[styles.sticky, { paddingBottom: insets.bottom + spacing.lg }]}>
            <Button testID="scan-rescan-button" label="Retake" variant="outline" onPress={reset} style={{ flex: 1 }} />
            <Button testID="scan-add-to-pantry-button" label={`Add ${keepCount} items`} icon="add-circle" onPress={addToPantry} loading={saving} disabled={!keepCount} style={{ flex: 2 }} />
          </View>
        </>
      ) : null}

      {stage === "review" && mode === "leftovers" ? (
        <ScrollView contentContainerStyle={[styles.pad, { paddingBottom: insets.bottom + spacing.xl }]}>
          {photo ? <Image source={{ uri: photo }} style={styles.thumb} contentFit="cover" /> : null}
          {leftovers.length ? (
            <View testID="leftovers-found" style={styles.leftWrap}>
              {leftovers.map((l) => (
                <View key={l} style={styles.leftChip}>
                  <Text style={styles.leftText}>{l}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Text style={styles.h2}>New meals from your leftovers</Text>
          {recipes.length === 0 ? <Text style={styles.body}>No ideas this time. Try a clearer photo.</Text> : null}
          {recipes.map((r, i) => (
            <Animated.View key={r.id} entering={FadeInDown.delay(i * 80)}>
              <RecipeCard testID={`leftover-recipe-${i}`} recipe={r} currency={user?.profile.currency ?? "$"} />
            </Animated.View>
          ))}
          <PressableScale testID="leftovers-scan-again" onPress={reset} style={styles.againBtn}>
            <Ionicons name="camera-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.againText}>Scan more leftovers</Text>
          </PressableScale>
        </ScrollView>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: c.divider },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  seg: { flex: 1, flexDirection: "row", backgroundColor: c.surfaceSecondary, borderRadius: radius.pill, padding: 4 },
  segBtn: { flex: 1, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  segActive: { backgroundColor: c.brandPrimary },
  segText: { fontFamily: fonts.text, fontSize: 14, fontWeight: "800", color: c.muted },
  segTextActive: { color: c.onBrandPrimary },
  pad: { padding: spacing.xl, gap: spacing.lg },
  intro: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl },
  bigIcon: { width: 112, height: 112, borderRadius: 56, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  h1: { fontFamily: fonts.display, fontSize: 26, fontWeight: "500", color: c.onSurface, textAlign: "center" },
  h2: { fontFamily: fonts.display, fontSize: 22, fontWeight: "500", color: c.onSurface },
  body: { fontFamily: fonts.text, fontSize: 15, color: c.muted, lineHeight: 22, textAlign: "center" },
  permCard: { backgroundColor: c.brandTertiary, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md, alignItems: "center" },
  permTitle: { fontFamily: fonts.display, fontSize: 20, fontWeight: "500", color: c.onSurface },
  tipBox: { backgroundColor: c.surfaceTertiary, borderRadius: radius.lg, padding: spacing.lg, gap: 6, marginTop: spacing.sm },
  tipTitle: { fontFamily: fonts.display, fontSize: 16, fontWeight: "500", color: c.onSurface, marginBottom: 2 },
  tip: { fontFamily: fonts.text, fontSize: 14, color: c.onSurface },
  scanning: { flex: 1, alignItems: "center", paddingTop: spacing["2xl"] },
  thumbLarge: { width: 220, height: 220, borderRadius: radius.lg },
  thumb: { width: "100%", height: 180, borderRadius: radius.lg },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 64, padding: spacing.md, backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border },
  check: { width: 28, height: 28, borderRadius: 10, borderWidth: 2, borderColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: c.brandPrimary },
  itemName: { fontFamily: fonts.text, fontSize: 16, fontWeight: "800", color: c.onSurface, paddingVertical: 2 },
  itemMeta: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  sticky: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.md, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.divider },
  leftWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  leftChip: { backgroundColor: c.brandSecondary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  leftText: { fontFamily: fonts.text, fontSize: 13, fontWeight: "800", color: c.onBrandSecondary },
  againBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, height: 52, borderRadius: radius.pill, borderWidth: 1.5, borderColor: c.brandPrimary },
  againText: { fontFamily: fonts.display, fontSize: 16, fontWeight: "500", color: c.brandPrimary },
}));
