import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  type PressableProps,
  ScrollView,
  Text,
  type TextProps,
  type TextStyle,
  View,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import { Ionicons } from "@react-native-vector-icons/ionicons";
import dayjs from "dayjs";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { CATEGORY_ICON, inr } from "@/src/format";
import type { Tx } from "@/src/api";

export const Icon = Ionicons;

type TVariant = "display" | "title" | "h2" | "body" | "label" | "caption" | "amount";
export function T({ v = "body", style, ...p }: TextProps & { v?: TVariant; style?: StyleProp<TextStyle> }) {
  const s = useText();
  return <Text {...p} style={[s.base, s[v], style]} />;
}
const useText = makeStyles((c) => ({
  base: { color: c.onSurface, fontFamily: fonts.text },
  display: { fontFamily: fonts.display, fontSize: 40, letterSpacing: -1, fontWeight: "500" },
  title: { fontFamily: fonts.display, fontSize: 24, letterSpacing: -0.4, fontWeight: "500" },
  h2: { fontFamily: fonts.display, fontSize: 18, fontWeight: "500" },
  body: { fontSize: 14, lineHeight: 20 },
  label: { fontSize: 14, fontWeight: "500" },
  caption: { fontSize: 12, color: c.muted, lineHeight: 16 },
  amount: { fontFamily: fonts.display, fontSize: 16, fontWeight: "500" },
}));

// Centers content on wide web screens (dashboard) while staying full-width on phones.
export function Page({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ width: "100%", maxWidth: 960, alignSelf: "center" }, style]}>{children}</View>;
}

export function Card({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const s = useUi();
  return (
    <View testID={testID} style={[s.card, style]}>
      {children}
    </View>
  );
}

export function Btn({
  title,
  onPress,
  kind = "primary",
  loading,
  disabled,
  icon,
  testID,
  style,
}: {
  title: string;
  onPress?: () => void;
  kind?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  disabled?: boolean;
  icon?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useUi();
  const { colors } = useTheme();
  const fg = kind === "primary" ? colors.onBrandPrimary : kind === "danger" ? colors.error : colors.brandPrimary;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn,
        kind === "primary" && s.btnPrimary,
        kind === "secondary" && s.btnSecondary,
        kind === "danger" && s.btnDanger,
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon as any} size={18} color={fg} /> : null}
          <Text style={[s.btnText, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  testID,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
  icon?: string;
}) {
  const s = useUi();
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} style={[s.chip, selected && s.chipOn]}>
      {icon ? <Icon name={icon as any} size={14} color={selected ? colors.onBrandPrimary : colors.onSurfaceTertiary} /> : null}
      <Text style={[s.chipText, selected && s.chipTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ height: 56, flexGrow: 0 }}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 16, alignItems: "center" }}
    >
      {children}
    </ScrollView>
  );
}

export function Progress({ pct, status, height = 8 }: { pct: number; status?: string; height?: number }) {
  const { colors } = useTheme();
  const color =
    status === "over" || pct >= 100 ? colors.error : status === "danger" || status === "warning" || pct >= 70 ? colors.warning : colors.brandPrimary;
  return (
    <View style={{ height, borderRadius: 999, backgroundColor: colors.surfaceTertiary, overflow: "hidden" }}>
      <View style={{ width: `${Math.min(pct, 100)}%`, height: "100%", backgroundColor: color, borderRadius: 999 }} />
    </View>
  );
}

export function CatIcon({ category, size = 40 }: { category: string; size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.brandTertiary,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={(CATEGORY_ICON[category] ?? "pricetag-outline") as any} size={size * 0.48} color={colors.onBrandTertiary} />
    </View>
  );
}

export function TxRow({ tx, onPress }: { tx: Tx; onPress?: () => void }) {
  const s = useUi();
  const { colors } = useTheme();
  const credit = tx.direction === "credit";
  const sub = [tx.category, dayjs(tx.ts).format("h:mm A"), tx.bank, tx.card_last4 ? `••${tx.card_last4}` : tx.mode === "upi" ? "UPI" : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      testID={`tx-row-${tx.id}`}
      onPress={onPress}
      style={({ pressed }) => [s.row, tx.needs_review && s.rowReview, pressed && { backgroundColor: colors.surfaceTertiary }]}
    >
      <CatIcon category={tx.category} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T v="label" numberOfLines={1}>
          {tx.merchant}
        </T>
        <T v="caption" numberOfLines={1}>
          {sub}
        </T>
        {(tx.needs_review || tx.reimbursable) && (
          <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
            {tx.needs_review && <Badge label="Needs review" tone="warning" />}
            {tx.reimbursable && <Badge label="Reimbursable" tone="brand" />}
          </View>
        )}
      </View>
      <T v="amount" style={{ color: credit ? colors.success : colors.onSurface }}>
        {credit ? "+" : "−"}
        {inr(tx.amount, true)}
      </T>
    </Pressable>
  );
}

export function Badge({ label, tone = "brand" }: { label: string; tone?: "brand" | "warning" | "error" | "muted" }) {
  const { colors } = useTheme();
  const map = {
    brand: [colors.brandTertiary, colors.onBrandTertiary],
    warning: [colors.warningSoft, colors.warning],
    error: [colors.errorSoft, colors.error],
    muted: [colors.surfaceTertiary, colors.muted],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
      <Text style={{ color: fg, fontSize: 11, fontFamily: fonts.text, fontWeight: "500" }}>{label}</Text>
    </View>
  );
}

export function Empty({ icon, title, body, children, testID }: { icon: string; title: string; body?: string; children?: React.ReactNode; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ alignItems: "center", padding: 32, gap: 8 }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon as any} size={28} color={colors.brandPrimary} />
      </View>
      <T v="h2" style={{ textAlign: "center", marginTop: 8 }}>
        {title}
      </T>
      {body ? <T style={{ textAlign: "center", color: colors.muted }}>{body}</T> : null}
      {children}
    </View>
  );
}

export function ErrorState({ onRetry, message }: { onRetry: () => void; message?: string }) {
  return (
    <Empty testID="error-state" icon="cloud-offline-outline" title="Couldn't load" body={message ?? "Check your connection and try again."}>
      <Btn testID="retry-button" title="Retry" onPress={onRetry} style={{ marginTop: 8 }} />
    </Empty>
  );
}

export function Loading() {
  const { colors } = useTheme();
  return (
    <View testID="loading" style={{ padding: 48, alignItems: "center" }}>
      <ActivityIndicator color={colors.brandPrimary} />
    </View>
  );
}

export function IconBtn({ icon, onPress, testID, badge }: { icon: string; onPress: () => void; testID?: string; badge?: number }) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? colors.surfaceTertiary : "transparent",
      })}
    >
      <Icon name={icon as any} size={24} color={colors.onSurface} />
      {badge ? (
        <View
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: colors.error,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 3,
          }}
        >
          <Text style={{ color: colors.onError, fontSize: 10, fontFamily: fonts.text }}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function ScreenHeader({ title, onBack, right, topInset }: { title: string; onBack?: () => void; right?: React.ReactNode; topInset: number }) {
  const s = useUi();
  return (
    <View style={[s.header, { paddingTop: topInset + 4 }]}>
      <Page style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8 }}>
        {onBack ? <IconBtn testID="header-back-button" icon="chevron-back" onPress={onBack} /> : <View style={{ width: 8 }} />}
        <T v="h2" style={{ flex: 1 }} numberOfLines={1}>
          {title}
        </T>
        {right}
      </Page>
    </View>
  );
}

export function SectionTitle({ title, action, onAction, testID }: { title: string; action?: string; onAction?: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
      <T v="h2">{title}</T>
      {action ? (
        <Pressable testID={testID} onPress={onAction} hitSlop={10} style={{ minHeight: 44, justifyContent: "center" }}>
          <T v="label" style={{ color: colors.brandPrimary }}>
            {action}
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}

export const inputStyle = makeStyles((c) => ({
  input: {
    backgroundColor: c.surfaceTertiary,
    borderRadius: 12,
    paddingHorizontal: 16,
    minHeight: 48,
    fontSize: 16,
    fontFamily: fonts.text,
    color: c.onSurface,
    borderWidth: 1,
    borderColor: c.border,
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as any) : {}),
  },
  label: { fontFamily: fonts.text, fontSize: 12, color: c.muted, marginBottom: 6, fontWeight: "500" },
}));

const useUi = makeStyles((c) => ({
  card: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: c.border,
    shadowColor: c.surfaceInverse,
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  btn: {
    minHeight: 48,
    borderRadius: 999,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  btnPrimary: { backgroundColor: c.brandPrimary },
  btnSecondary: { backgroundColor: c.brandTertiary },
  btnDanger: { backgroundColor: c.errorSoft },
  btnText: { fontFamily: fonts.text, fontSize: 15, fontWeight: "500" },
  chip: {
    height: 36,
    flexShrink: 0,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: c.surfaceTertiary,
    borderWidth: 1,
    borderColor: c.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chipOn: { backgroundColor: c.brandPrimary, borderColor: c.brandPrimary },
  chipText: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceTertiary, fontWeight: "500" },
  chipTextOn: { color: c.onBrandPrimary },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: c.surface },
  rowReview: { borderLeftWidth: 3, borderLeftColor: c.warning },
  header: { backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.divider, paddingBottom: 4 },
}));
