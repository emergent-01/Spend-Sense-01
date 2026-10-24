// Design tokens for SpendSense (light theme). Keys match the "color" block of
// /app/design_guidelines.json. Components read colors via makeStyles/useTheme.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FDFDFB",
  onSurface: "#1C1F1D",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#1C1F1D",
  surfaceTertiary: "#F4F5F0",
  onSurfaceTertiary: "#4A7856",
  surfaceInverse: "#1C1F1D",
  onSurfaceInverse: "#FDFDFB",
  muted: "#6D736F",

  brand: "#4A7856",
  onBrand: "#FFFFFF",
  brandPrimary: "#4A7856",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#C9D8CB",
  onBrandSecondary: "#1C1F1D",
  brandTertiary: "#E7EFE8",
  onBrandTertiary: "#4A7856",

  success: "#3E7754",
  onSuccess: "#FFFFFF",
  warning: "#D18D27",
  onWarning: "#FFFFFF",
  warningSoft: "#FBF1E1",
  error: "#BC4B42",
  onError: "#FFFFFF",
  errorSoft: "#F8E6E4",
  info: "#1C1F1D",
  onInfo: "#FFFFFF",

  border: "#EAECE5",
  borderStrong: "#C9D8CB",
  divider: "#EAECE5",

  scrim: "rgba(28,31,29,0.7)",
  scrimLight: "rgba(28,31,29,0.2)",

  // chart palette (no blues/purples)
  chart1: "#4A7856",
  chart2: "#D18D27",
  chart3: "#BC4B42",
  chart4: "#7FA38A",
  chart5: "#8C6A43",
  chart6: "#2F4F3A",
  chart7: "#E3B566",
  chart8: "#A35D4F",
  chart9: "#5E6B63",
  chart10: "#B7C9B9",
};

export type ThemeColors = typeof light;

export const fonts = {
  display: "SpaceGrotesk",
  text: "Jakarta",
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export const colors = light;

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = (system === "light" || system === "dark") && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
