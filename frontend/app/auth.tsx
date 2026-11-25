import Ionicons from "@react-native-vector-icons/ionicons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth";
import { Logo } from "@/src/components/Logo";
import { Button, ErrorText } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const HERO = "https://images.unsplash.com/photo-1535473895227-bdecb20fb157?crop=entropy&cs=srgb&fm=jpg&q=80&w=900";

export default function AuthScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    if (!email.trim() || !password) return setError("Please enter your email and password");
    if (mode === "register" && password.length < 6) return setError("Password must be at least 6 characters");
    setBusy(true);
    try {
      if (mode === "login") await login(email.trim(), password);
      else await register(name.trim(), email.trim(), password);
      router.replace("/");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
        <View style={styles.hero}>
          <Image source={{ uri: HERO }} style={StyleSheet_abs} contentFit="cover" transition={300} />
          <LinearGradient colors={["transparent", colors.scrim]} style={StyleSheet_abs} />
          <View style={[styles.heroContent, { paddingTop: insets.top + spacing.lg }]}>
            <View style={styles.logo}>
              <Logo size={38} testID="app-logo" />
            </View>
            <Text style={styles.brand}>Fresh Start</Text>
            <Text style={styles.tagline}>Turn what&apos;s in your kitchen into affordable weekly meals.</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.switchRow}>
            {(["register", "login"] as const).map((m) => (
              <Pressable key={m} testID={`auth-mode-${m}`} onPress={() => setMode(m)} style={[styles.switchBtn, mode === m && styles.switchActive]}>
                <Text style={[styles.switchText, mode === m && styles.switchTextActive]}>{m === "login" ? "Log in" : "Sign up"}</Text>
              </Pressable>
            ))}
          </View>

          {mode === "register" ? (
            <View style={styles.field}>
              <Text style={styles.label}>Your name</Text>
              <TextInput testID="auth-name-input" style={styles.input} value={name} onChangeText={setName} placeholder="Alex" placeholderTextColor={colors.muted} />
            </View>
          ) : null}
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="auth-email-input"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <View>
              <TextInput
                testID="auth-password-input"
                style={[styles.input, { paddingRight: 52 }]}
                value={password}
                onChangeText={setPassword}
                placeholder="At least 6 characters"
                placeholderTextColor={colors.muted}
                secureTextEntry={!showPw}
                onSubmitEditing={submit}
              />
              <Pressable testID="auth-toggle-password" onPress={() => setShowPw((s) => !s)} style={styles.eye} hitSlop={8}>
                <Ionicons name={showPw ? "eye-off-outline" : "eye-outline"} size={20} color={colors.muted} />
              </Pressable>
            </View>
          </View>
          <ErrorText testID="auth-error" text={error} />
          <Button testID="auth-submit-button" label={mode === "login" ? "Log in" : "Create account"} onPress={submit} loading={busy} style={{ marginTop: spacing.sm }} />
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const StyleSheet_abs = { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 };

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  hero: { height: 320, justifyContent: "flex-end" },
  heroContent: { padding: spacing.xl, paddingBottom: spacing["3xl"], gap: spacing.sm },
  logo: { width: 60, height: 60, borderRadius: 18, backgroundColor: c.card, alignItems: "center", justifyContent: "center" },
  brand: { fontFamily: fonts.display, fontSize: 38, fontWeight: "500", color: c.onSurfaceInverse },
  tagline: { fontFamily: fonts.text, fontSize: 16, color: c.onSurfaceInverse, lineHeight: 22, maxWidth: 300 },
  card: { marginTop: -spacing.xl, backgroundColor: c.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.xl, gap: spacing.lg },
  switchRow: { flexDirection: "row", backgroundColor: c.surfaceSecondary, borderRadius: radius.pill, padding: 4 },
  switchBtn: { flex: 1, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  switchActive: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  switchText: { fontFamily: fonts.display, fontSize: 16, color: c.muted, fontWeight: "500" },
  switchTextActive: { color: c.brandPrimary },
  field: { gap: 6 },
  label: { fontFamily: fonts.text, fontSize: 14, fontWeight: "800", color: c.onSurface },
  input: { height: 54, borderRadius: radius.md, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.card, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 16, color: c.onSurface },
  eye: { position: "absolute", right: 14, top: 0, bottom: 0, justifyContent: "center" },
}));
