import Ionicons from "@react-native-vector-icons/ionicons";
import * as Haptics from "expo-haptics";
import React from "react";
import { ActivityIndicator, Platform, Pressable, PressableProps, StyleProp, Text, View, ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { daysUntil } from "@/src/api";
import { fonts, makeStyles, radius, shadow, spacing, useTheme } from "@/src/theme";

export type IconName = React.ComponentProps<typeof Ionicons>["name"];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressableScale({ style, onPressIn, onPressOut, children, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  const scale = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(e) => {
        scale.value = withSpring(0.96, { damping: 15, stiffness: 300 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, { damping: 10, stiffness: 260 });
        onPressOut?.(e);
      }}
      style={[style, aStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}

export function tap() {
  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

type BtnProps = {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  variant?: "primary" | "secondary" | "ghost" | "outline";
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
};

export function Button({ label, onPress, icon, variant = "primary", loading, disabled, testID, style, small }: BtnProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const bg = { primary: colors.brandPrimary, secondary: colors.brandSecondary, ghost: "transparent", outline: colors.card }[variant];
  const fg = { primary: colors.onBrandPrimary, secondary: colors.onBrandSecondary, ghost: colors.onBrandTertiary, outline: colors.onSurface }[variant];
  return (
    <PressableScale
      testID={testID}
      disabled={disabled || loading}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={[
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: bg, opacity: disabled ? 0.5 : 1 },
        variant === "outline" && { borderWidth: 1.5, borderColor: colors.border },
        variant === "primary" && shadow,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={small ? 16 : 20} color={fg} /> : null}
          <Text style={[styles.btnText, small && { fontSize: 14 }, { color: fg }]}>{label}</Text>
        </>
      )}
    </PressableScale>
  );
}

export function Chip({ label, selected, onPress, testID, icon }: { label: string; selected?: boolean; onPress?: () => void; testID?: string; icon?: IconName }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={[styles.chip, { backgroundColor: selected ? colors.brandPrimary : colors.card, borderColor: selected ? colors.brandPrimary : colors.border }]}
    >
      {icon ? <Ionicons name={icon} size={14} color={selected ? colors.onBrandPrimary : colors.muted} /> : null}
      <Text style={[styles.chipText, { color: selected ? colors.onBrandPrimary : colors.onSurface }]}>{label}</Text>
    </Pressable>
  );
}

export function ExpiryTag({ date, testID }: { date: string | null; testID?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const d = daysUntil(date);
  if (d === null) return null;
  let bg = colors.successSoft;
  let fg = colors.success;
  let label = `${d}d left`;
  if (d < 0) {
    bg = colors.errorSoft;
    fg = colors.error;
    label = "Expired";
  } else if (d <= 2) {
    bg = colors.errorSoft;
    fg = colors.error;
    label = d === 0 ? "Today" : d === 1 ? "Tomorrow" : `${d} days`;
  } else if (d <= 5) {
    bg = colors.warningSoft;
    fg = colors.onWarning;
  }
  return (
    <View testID={testID} style={[styles.tag, { backgroundColor: bg }]}>
      <Text style={[styles.tagText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({ icon, title, body, action, testID }: { icon: IconName; title: string; body: string; action?: React.ReactNode; testID?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View testID={testID} style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={44} color={colors.brandPrimary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action}
    </View>
  );
}

export function Loading({ label, testID }: { label?: string; testID?: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View testID={testID} style={styles.loading}>
      <ActivityIndicator size="large" color={colors.brandPrimary} />
      {label ? <Text style={styles.emptyBody}>{label}</Text> : null}
    </View>
  );
}

export const ErrorText = ({ text, testID }: { text: string; testID?: string }) => {
  const styles = useStyles();
  return text ? (
    <Text testID={testID} style={styles.error}>
      {text}
    </Text>
  ) : null;
};

const useStyles = makeStyles((c) => ({
  btn: {
    minHeight: 54,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  btnSmall: { minHeight: 44, paddingHorizontal: spacing.lg },
  btnText: { fontFamily: fonts.display, fontSize: 17, fontWeight: "500" },
  chip: {
    height: 36,
    flexShrink: 0,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chipText: { fontFamily: fonts.text, fontSize: 14, fontWeight: "700" },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: "flex-start" },
  tagText: { fontFamily: fonts.text, fontSize: 12, fontWeight: "800" },
  empty: { alignItems: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing["2xl"], gap: spacing.md },
  emptyIcon: { width: 96, height: 96, borderRadius: 48, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  emptyTitle: { fontFamily: fonts.display, fontSize: 22, fontWeight: "500", color: c.onSurface, textAlign: "center" },
  emptyBody: { fontFamily: fonts.text, fontSize: 15, color: c.muted, textAlign: "center", lineHeight: 22, marginBottom: spacing.sm },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xl },
  error: { fontFamily: fonts.text, color: c.error, fontSize: 14, fontWeight: "700" },
}));
