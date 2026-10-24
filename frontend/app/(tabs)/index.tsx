import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import Animated, { FadeInDown } from "react-native-reanimated";
import { api, type Budget, type Recurring, type Tx } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Badge, Btn, Card, Empty, ErrorState, Icon, IconBtn, Loading, Page, Progress, SectionTitle, T, TxRow, CatIcon } from "@/src/components/ui";
import { categoryColor, inr, monthLabel } from "@/src/format";
import { makeStyles, useTheme } from "@/src/theme";
import { usesNativeTabs } from "@/src/navigation";
import { smsNativeAvailable } from "@/src/sms";
import { useLoadSample } from "@/src/use-sample";

const HERO = "https://images.unsplash.com/photo-1693389107440-afe980ccbb8d?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200";

type Overview = {
  month: string;
  income: number;
  income_source: string;
  spent: number;
  committed: number;
  savings_target: number;
  safe_to_spend: number;
  daily_safe: number;
  days_left: number;
  day: number;
  days_in_month: number;
  by_category: { category: string; spent: number; count: number }[];
  budgets: Budget[];
  recurring: Recurring[];
  review_count: number;
  unread_alerts: number;
  recent: Tx[];
  has_data: boolean;
};

export default function Home() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("/overview") });
  const sample = useLoadSample();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const d = q.data;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Page style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16 }}>
          <View style={{ flex: 1 }}>
            <T v="caption">{d ? monthLabel(d.month) : " "}</T>
            <T v="h2" numberOfLines={1}>
              Hi{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
            </T>
          </View>
          <IconBtn testID="home-alerts-button" icon="notifications-outline" badge={d?.unread_alerts} onPress={() => router.push("/alerts")} />
        </Page>
      </View>

      {q.isLoading ? (
        <Loading />
      ) : q.isError || !d ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: bottomChrome + 96 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={colors.brandPrimary} />}
        >
          <Page style={{ padding: 16, gap: 16 }}>
            <Animated.View entering={FadeInDown.duration(400)}>
              <View testID="safe-to-spend-card" style={styles.hero}>
                <Image source={{ uri: HERO }} style={styles.abs} contentFit="cover" />
                <LinearGradient colors={["transparent", colors.scrimLight, colors.scrim]} style={styles.abs} />
                <View style={{ padding: 20, gap: 4 }}>
                  <T v="label" style={styles.heroMuted}>Safe to spend this month</T>
                  <T testID="safe-to-spend-amount" v="display" style={{ color: d.safe_to_spend < 0 ? colors.errorSoft : colors.onSurfaceInverse }}>
                    {inr(d.safe_to_spend)}
                  </T>
                  <T style={styles.heroMuted}>
                    {d.safe_to_spend > 0
                      ? `About ${inr(d.daily_safe)}/day for the next ${d.days_left} days`
                      : !d.has_data && d.income === 0
                        ? "Add your income in More to see what's safe to spend"
                        : "You're past your safe limit for this month"}
                  </T>
                  <View style={styles.breakdown}>
                    {[
                      ["Income", d.income, d.income_source === "expected" ? "expected" : "received"],
                      ["Bills due", d.committed, "recurring"],
                      ["Savings", d.savings_target, "target"],
                      ["Spent", d.spent, "so far"],
                    ].map(([k, v, sub]) => (
                      <View key={k as string} style={{ flex: 1 }} testID={`breakdown-${(k as string).toLowerCase().replace(" ", "-")}`}>
                        <T v="caption" style={styles.heroMuted}>{k as string}</T>
                        <T v="amount" style={{ color: colors.onSurfaceInverse, fontSize: 15 }} numberOfLines={1}>
                          {inr(v as number)}
                        </T>
                        <T v="caption" style={[styles.heroMuted, { fontSize: 10 }]}>{sub as string}</T>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            </Animated.View>

            {!d.has_data && (
              <Card testID="home-empty-card">
                <Empty
                  icon="chatbox-ellipses-outline"
                  title="No transactions yet"
                  body={
                    smsNativeAvailable
                      ? "Allow SMS access and we'll import your last 12 months automatically."
                      : "Paste a bank SMS with the + button, or load sample messages to explore."
                  }
                >
                  <View style={{ gap: 8, alignSelf: "stretch", marginTop: 8 }}>
                    {smsNativeAvailable && <Btn testID="home-setup-sms-button" title="Set up SMS capture" onPress={() => router.push("/sms-setup")} />}
                    <Btn testID="home-load-sample-button" title="Load sample messages" kind="secondary" loading={sample.isPending} onPress={() => sample.mutate()} />
                    {d.income === 0 && <Btn testID="home-set-income-button" title="Set monthly income" kind="ghost" onPress={() => router.push("/(tabs)/more")} />}
                  </View>
                </Empty>
              </Card>
            )}

            {d.review_count > 0 && (
              <Pressable testID="home-review-card" onPress={() => router.push("/review")}>
                <Card style={{ borderColor: colors.warning, flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={styles.warnDot}>
                    <Icon name="help-circle-outline" size={22} color={colors.warning} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <T v="label">{d.review_count} need your review</T>
                    <T v="caption">Unread SMS formats or unknown merchants. Tap to sort them out.</T>
                  </View>
                  <Icon name="chevron-forward" size={20} color={colors.muted} />
                </Card>
              </Pressable>
            )}

            <BudgetsPreview budgets={d.budgets} day={d.day} dim={d.days_in_month} />

            {d.by_category.length > 0 && <CategoryChart data={d.by_category} total={d.spent} />}

            {d.recurring.length > 0 && (
              <Card testID="home-recurring-card">
                <SectionTitle title="Recurring bills" action="See all" testID="home-recurring-see-all" onAction={() => router.push("/recurring")} />
                {d.recurring.slice(0, 4).map((r) => (
                  <View key={r.merchant_key} style={styles.recRow}>
                    <CatIcon category={r.category} size={32} />
                    <View style={{ flex: 1 }}>
                      <T v="label" numberOfLines={1}>{r.merchant}</T>
                      <T v="caption">Around day {r.expected_day}</T>
                    </View>
                    {r.warning === "missing" ? <Badge label="Missing" tone="warning" /> : r.charged_this_month ? <Badge label="Paid" tone="muted" /> : <Badge label="Due" tone="brand" />}
                    <T v="amount" style={{ minWidth: 72, textAlign: "right" }}>{inr(r.amount)}</T>
                  </View>
                ))}
              </Card>
            )}

            {d.recent.length > 0 && (
              <Card style={{ paddingHorizontal: 0, paddingBottom: 4 }}>
                <View style={{ paddingHorizontal: 16 }}>
                  <SectionTitle title="Recent activity" action="View all" testID="home-recent-view-all" onAction={() => router.push("/(tabs)/activity")} />
                </View>
                {d.recent.map((t) => (
                  <TxRow key={t.id} tx={t} onPress={() => router.push(`/transaction/${t.id}`)} />
                ))}
              </Card>
            )}
          </Page>
        </ScrollView>
      )}

      <Pressable testID="home-add-fab" onPress={() => router.push("/add")} style={[styles.fab, { bottom: bottomChrome + 16 }]}>
        <BlurView intensity={30} tint="light" style={styles.fabInner}>
          <Icon name="add" size={22} color={colors.onBrandPrimary} />
          <T v="label" style={{ color: colors.onBrandPrimary }}>Add / Paste SMS</T>
        </BlurView>
      </Pressable>
    </View>
  );
}

function BudgetsPreview({ budgets, day, dim }: { budgets: Budget[]; day: number; dim: number }) {
  const { colors } = useTheme();
  const set = budgets.filter((b) => b.budget > 0).sort((a, b) => b.pct - a.pct);
  return (
    <Card testID="home-budgets-card">
      <SectionTitle title="Budgets" action={set.length ? "Manage" : "Set up"} testID="home-budgets-manage" onAction={() => router.push("/(tabs)/budgets")} />
      {set.length === 0 ? (
        <T v="caption">Set a monthly limit per category to get alerts at 70%, 90% and 100%.</T>
      ) : (
        <View style={{ gap: 16 }}>
          <T v="caption">Day {day} of {dim} · {Math.round((day / dim) * 100)}% of the month gone</T>
          {set.slice(0, 4).map((b) => (
            <View key={b.category} style={{ gap: 6 }} testID={`home-budget-${b.category}`}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <T v="label">{b.category}</T>
                <T v="caption" style={{ color: b.pct >= 100 ? colors.error : b.pct >= 70 ? colors.warning : colors.muted }}>
                  {inr(b.spent)} / {inr(b.budget)} · {Math.round(b.pct)}%
                </T>
              </View>
              <Progress pct={b.pct} status={b.status} />
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

function CategoryChart({ data, total }: { data: { category: string; spent: number }[]; total: number }) {
  const { colors } = useTheme();
  return (
    <Card testID="home-category-chart">
      <SectionTitle title="Spend by category" />
      <View style={{ flexDirection: "row", height: 14, borderRadius: 999, overflow: "hidden", gap: 2, marginBottom: 16 }}>
        {data.map((c) => (
          <View key={c.category} style={{ flex: Math.max(c.spent, total * 0.01), backgroundColor: categoryColor(colors, c.category) }} />
        ))}
      </View>
      <View style={{ gap: 12 }}>
        {data.map((c) => (
          <Pressable
            key={c.category}
            testID={`chart-cat-${c.category}`}
            onPress={() => router.push({ pathname: "/(tabs)/activity", params: { category: c.category } })}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 28 }}
          >
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: categoryColor(colors, c.category) }} />
            <T style={{ flex: 1 }}>{c.category}</T>
            <T v="caption">{total ? Math.round((c.spent / total) * 100) : 0}%</T>
            <T v="amount" style={{ fontSize: 14, minWidth: 80, textAlign: "right" }}>{inr(c.spent)}</T>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { backgroundColor: c.surface, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.divider },
  hero: { borderRadius: 20, overflow: "hidden", minHeight: 240, justifyContent: "flex-end", backgroundColor: c.brandPrimary },
  abs: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  heroMuted: { color: c.onSurfaceInverse, opacity: 0.85 },
  breakdown: { flexDirection: "row", gap: 8, marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.scrimLight },
  warnDot: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.warningSoft, alignItems: "center", justifyContent: "center" },
  recRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  fab: { position: "absolute", right: 16, borderRadius: 999, overflow: "hidden", backgroundColor: c.brandPrimary, elevation: 4, shadowColor: c.surfaceInverse, shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  fabInner: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, height: 52 },
}));
