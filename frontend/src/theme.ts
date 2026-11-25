// Design tokens for FridgeChef. Light theme (pink, yellow, warm white).
// Keys match the "color" block of /app/design_guidelines.json.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FFFCF9",
  onSurface: "#2D2426",
  surfaceSecondary: "#FFF4F7",
  onSurfaceSecondary: "#2D2426",
  surfaceTertiary: "#FFF8E7",
  onSurfaceTertiary: "#2D2426",
  surfaceInverse: "#2D2426",
  onSurfaceInverse: "#FFFFFF",
  muted: "#8A7B80",

  brand: "#FF4D79",
  onBrand: "#FFFFFF",
  brandPrimary: "#FF4D79",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#FFC857",
  onBrandSecondary: "#2D2426",
  brandTertiary: "#FFE5EC",
  onBrandTertiary: "#D81E5B",

  success: "#10B981",
  onSuccess: "#FFFFFF",
  warning: "#FFC857",
  onWarning: "#2D2426",
  error: "#EF476F",
  onError: "#FFFFFF",
  info: "#FFE5EC",
  onInfo: "#D81E5B",

  border: "#F2E3E7",
  borderStrong: "#FF4D79",
  divider: "#F5EAEF",

  card: "#FFFFFF",
  scrim: "rgba(45,36,38,0.78)",
  successSoft: "#E3F8F0",
  warningSoft: "#FFF1CC",
  errorSoft: "#FFE3EA",
};

export type ThemeColors = typeof light;

export const fonts = {
  display: "Fredoka",
  text: "Nunito",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = (system === "light" || system === "dark") && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export const colors = light;

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const shadow = {
  shadowColor: "#D81E5B",
  shadowOpacity: 0.12,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 4,
};
