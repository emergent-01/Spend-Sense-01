import { useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Platform } from "react-native";
import { api, type Budget } from "@/src/api";
import { Btn, Card, CatIcon, ErrorState, Loading, Page, Progress, T, inputStyle } from "@/src/components/ui";
import { inr, monthLabel } from "@/src/format";
import { makeStyles, useTheme } from "@/src/theme";
import { usesNativeTabs } from "@/src/navigation";
import { useToast } from "@/src/toast";
import { AddCategoryChip } from "@/src/components/AddCategory";

type BudgetsResp = { month: string; items: Budget[]; total_budget: number; total_spent_budgeted: number; total_spent: number };

export default function Budgets() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const q = useQuery({ queryKey: ["budgets"], queryFn: () => api<BudgetsResp>("/budgets") });
  const [editing, setEditing] = useState<Budget | null>(null);
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const d = q.data;
  const first = d?.items[0];
  const overallPct = d && d.total_budget ? (d.total_spent_budgeted / d.total_budget) * 100 : 0;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Page style={{ paddingHorizontal: 16 }}>
          <T v="title">Budgets</T>
          <T v="caption">{d ? `${monthLabel(d.month)} · day ${first?.day} of ${first?.days_in_month}` : " "}</T>
        </Page>
      </View>
      {q.isLoading ? (
        <Loading />
      ) : q.isError || !d ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: bottomChrome + 24 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={colors.brandPrimary} />}
        >
          <Page style={{ padding: 16, gap: 16 }}>
            <Card testID="budgets-summary-card" style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
                <View>
                  <T v="caption">Spent in budgeted categories</T>
                  <T v="title" testID="budgets-total-spent">{inr(d.total_spent_budgeted)}</T>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <T v="caption">Total budget</T>
                  <T v="h2" testID="budgets-total-budget">{inr(d.total_budget)}</T>
                </View>
              </View>
              <View>
                <Progress pct={overallPct} height={12} />
                {first && first.days_in_month > 0 && (
                  <View style={[styles.paceMark, { left: `${Math.min(first.expected_pct, 100)}%` }]} />
                )}
              </View>
              <T v="caption">
                {d.total_budget
                  ? `${Math.round(overallPct)}% used · ${Math.round(first?.expected_pct ?? 0)}% of month gone (marker shows where you should be)`
                  : "Tap a category below to set its monthly budget. Alerts fire at 70%, 90% and 100%."}
              </T>
            </Card>

            <View style={styles.grid}>
              {d.items.map((b) => (
                <Pressable key={b.category} testID={`budget-card-${b.category}`} onPress={() => setEditing(b)} style={styles.cell}>
                  {({ pressed }) => (
                    <Card style={[{ gap: 10, height: "100%" }, pressed && { opacity: 0.85 }, b.status === "over" && { borderColor: colors.error }]}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <CatIcon category={b.category} size={36} />
                        {b.budget > 0 ? (
                          <T v="label" style={{ color: b.pct >= 100 ? colors.error : b.pct >= 70 ? colors.warning : colors.brandPrimary }}>
                            {Math.round(b.pct)}%
                          </T>
                        ) : (
                          <T v="caption" style={{ color: colors.brandPrimary }}>Set</T>
                        )}
                      </View>
                      <T v="label" numberOfLines={1}>{b.category}</T>
                      <T v="caption" numberOfLines={1}>
                        {inr(b.spent)}
                        {b.budget > 0 ? ` / ${inr(b.budget)}` : " spent"}
                      </T>
                      {b.budget > 0 ? (
                        <>
                          <Progress pct={b.pct} status={b.status} />
                          <T v="caption" numberOfLines={2} style={{ color: b.projected > b.budget ? colors.warning : colors.muted }}>
                            {b.pct >= 100
                              ? `Over by ${inr(-b.remaining)}`
                              : b.projected > b.budget
                                ? `On track for ${inr(b.projected)}`
                                : `${inr(b.remaining)} left`}
                          </T>
                        </>
                      ) : (
                        <T v="caption">No limit yet</T>
                      )}
                    </Card>
                  )}
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <AddCategoryChip testID="budgets-add-category" />
            </View>
          </Page>
        </ScrollView>
      )}
      <BudgetSheet budget={editing} onClose={() => setEditing(null)} />
    </View>
  );
}

function BudgetSheet({ budget, onClose }: { budget: Budget | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const inp = inputStyle();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [prev, setPrev] = useState<string | null>(null);
  if (budget && prev !== budget.category) {
    setPrev(budget.category);
    setValue(budget.budget ? String(budget.budget) : "");
  }
  if (!budget && prev !== null) setPrev(null);

  const m = useMutation({
    mutationFn: (amount: number) => api<{ alerts: any[] }>("/budgets", { method: "PUT", body: { category: budget!.category, amount } }),
    onSuccess: (r) => {
      qc.invalidateQueries();
      toast(r.alerts?.[0]?.title ?? "Budget saved", r.alerts?.length ? "info" : "success");
      onClose();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const suggestions = budget ? [Math.max(1000, Math.ceil((budget.projected * 1.1) / 500) * 500), 5000, 10000, 20000] : [];

  return (
    <Modal visible={!!budget} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <Pressable testID="budget-sheet-backdrop" style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <Page style={{ gap: 16, maxWidth: 560 }}>
            <View style={styles.grabber} />
            <T v="h2">{budget?.category} budget</T>
            {budget && (
              <T v="caption">
                Spent {inr(budget.spent)} this month · on pace for {inr(budget.projected)}
              </T>
            )}
            <View>
              <T style={inp.label}>Monthly limit (₹)</T>
              <TextInput
                testID="budget-amount-input"
                style={inp.input}
                value={value}
                onChangeText={(t) => setValue(t.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                placeholder="e.g. 8000"
                placeholderTextColor={colors.muted}
                autoFocus
              />
            </View>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {[...new Set(suggestions)].map((s) => (
                <Pressable key={s} testID={`budget-suggest-${s}`} onPress={() => setValue(String(s))} style={styles.suggest}>
                  <T v="caption" style={{ color: colors.onBrandTertiary }}>{inr(s)}</T>
                </Pressable>
              ))}
            </View>
            <Btn testID="budget-save-button" title="Save budget" loading={m.isPending} onPress={() => m.mutate(Number(value || 0))} />
            {!!budget?.budget && (
              <Btn testID="budget-remove-button" title="Remove budget" kind="ghost" onPress={() => m.mutate(0)} />
            )}
          </Page>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.divider, paddingBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -6 },
  cell: { width: "50%", padding: 6 },
  paceMark: { position: "absolute", top: -3, width: 2, height: 18, backgroundColor: c.onSurface, borderRadius: 1 },
  backdrop: { flex: 1, backgroundColor: c.scrimLight },
  sheet: { backgroundColor: c.surfaceSecondary, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: c.border },
  suggest: { backgroundColor: c.brandTertiary, borderRadius: 999, paddingHorizontal: 12, minHeight: 36, justifyContent: "center" },
}));
