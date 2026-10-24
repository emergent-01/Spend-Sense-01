import { useState } from "react";
import { Pressable, Switch, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import dayjs from "dayjs";
import { api, type Tx } from "@/src/api";
import { Badge, Btn, Card, CatIcon, Chip, ErrorState, Loading, Page, ScreenHeader, T, inputStyle } from "@/src/components/ui";
import { DEBIT_CATEGORIES, INCOME_CATEGORIES, inr } from "@/src/format";
import { makeStyles, useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const inp = inputStyle();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["tx", id], queryFn: () => api<Tx>(`/transactions/${id}`) });
  const [remember, setRemember] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<Tx & { updated_others: number }>(`/transactions/${id}`, { method: "PATCH", body }),
    onSuccess: (t, body) => {
      qc.setQueryData(["tx", id], t);
      qc.invalidateQueries({ predicate: (qq) => qq.queryKey[0] !== "tx" });
      if (body.category)
        toast(
          t.updated_others ? `Moved to ${t.category} · ${t.updated_others} other ${t.merchant} transactions updated` : `Moved to ${t.category}`,
          "success",
        );
      else if (body.reimbursable !== undefined) toast(body.reimbursable ? "Marked reimbursable" : "Removed from reimbursable", "success");
      else toast("Saved", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const del = useMutation({
    mutationFn: () => api(`/transactions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast("Transaction deleted");
      router.back();
    },
  });
  const recurring = useMutation({
    mutationFn: (t: Tx) =>
      api("/recurring", {
        method: "PUT",
        body: { merchant_key: t.merchant_key, status: "active", merchant: t.merchant, amount: t.amount, day: dayjs(t.ts).date() },
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast("Added to recurring bills", "success");
    },
  });

  const t = q.data;
  const cats = t?.direction === "credit" ? INCOME_CATEGORIES : DEBIT_CATEGORIES;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Transaction" onBack={() => router.back()} topInset={insets.top} />
      {q.isLoading ? (
        <Loading />
      ) : q.isError || !t ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (
        <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
          <Page style={{ padding: 16, gap: 16 }}>
            <View style={{ alignItems: "center", gap: 8, paddingVertical: 8 }}>
              <CatIcon category={t.category} size={56} />
              <T v="h2" testID="tx-merchant" style={{ textAlign: "center" }}>{t.merchant}</T>
              <T v="display" testID="tx-amount" style={{ color: t.direction === "credit" ? colors.success : colors.onSurface }}>
                {t.direction === "credit" ? "+" : "−"}
                {inr(t.amount, true)}
              </T>
              <T v="caption">{dayjs(t.ts).format("ddd, D MMM YYYY · h:mm A")}</T>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                {t.needs_review && <Badge label="Needs review" tone="warning" />}
                {t.is_salary && <Badge label="Salary" />}
                {t.merged_count > 1 && <Badge label={`Merged from ${t.merged_count} SMS`} tone="muted" />}
                {t.source === "manual" && <Badge label="Added manually" tone="muted" />}
              </View>
            </View>

            <Card style={{ gap: 10 }}>
              {[
                ["Bank", t.bank],
                ["Card", t.card_last4 ? `•••• ${t.card_last4}` : null],
                ["Account", t.account ? `XX${t.account}` : null],
                ["UPI ID", t.vpa],
                ["Mode", t.mode?.toUpperCase()],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <View key={k as string} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                    <T v="caption">{k}</T>
                    <T v="label" numberOfLines={1} style={{ flexShrink: 1 }}>{v}</T>
                  </View>
                ))}
            </Card>

            <Card style={{ gap: 12 }} testID="tx-category-card">
              <T v="h2">Category</T>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {cats.map((c) => (
                  <Chip
                    key={c}
                    testID={`tx-category-${c}`}
                    label={c}
                    selected={t.category === c && !t.needs_review}
                    onPress={() => patch.mutate({ category: c, apply_to_merchant: remember })}
                  />
                ))}
              </View>
              {t.direction === "debit" && t.merchant_key && (
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <T v="label">Remember for {t.merchant}</T>
                    <T v="caption">Apply this category to all past and future transactions from this merchant</T>
                  </View>
                  <Switch testID="tx-remember-switch" value={remember} onValueChange={setRemember} trackColor={{ true: colors.brandPrimary, false: colors.border }} />
                </View>
              )}
            </Card>

            <Card style={{ gap: 12 }}>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <T v="label">Reimbursable / claimable</T>
                  <T v="caption">Include in your work expense CSV export</T>
                </View>
                <Switch
                  testID="tx-reimbursable-switch"
                  value={t.reimbursable}
                  onValueChange={(v) => patch.mutate({ reimbursable: v })}
                  trackColor={{ true: colors.brandPrimary, false: colors.border }}
                />
              </View>
              <View>
                <T style={inp.label}>Note</T>
                <TextInput
                  testID="tx-note-input"
                  style={[inp.input, { minHeight: 72, paddingTop: 12, textAlignVertical: "top" }]}
                  multiline
                  value={note ?? t.note}
                  onChangeText={setNote}
                  placeholder="e.g. Client lunch with Acme"
                  placeholderTextColor={colors.muted}
                />
              </View>
              {note !== null && note !== t.note && (
                <Btn testID="tx-note-save-button" title="Save note" kind="secondary" loading={patch.isPending} onPress={() => patch.mutate({ note })} />
              )}
            </Card>

            {t.direction === "debit" && t.merchant_key && (
              <Btn testID="tx-mark-recurring-button" title="Mark as monthly recurring" kind="secondary" icon="repeat-outline" loading={recurring.isPending} onPress={() => recurring.mutate(t)} />
            )}

            {t.raw.length > 0 && (
              <Card style={{ gap: 8 }}>
                <Pressable testID="tx-raw-toggle" onPress={() => setShowRaw(!showRaw)} style={{ minHeight: 32, justifyContent: "center" }}>
                  <T v="label" style={{ color: colors.brandPrimary }}>{showRaw ? "Hide original SMS" : `Show original SMS (${t.raw.length})`}</T>
                </Pressable>
                {showRaw &&
                  t.raw.map((r, i) => (
                    <T key={i} v="caption" style={styles.raw}>{r}</T>
                  ))}
              </Card>
            )}

            {confirmDelete ? (
              <Card style={{ gap: 12, borderColor: colors.error }}>
                <T v="label">Delete this transaction?</T>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Btn testID="tx-delete-cancel" title="Cancel" kind="secondary" style={{ flex: 1 }} onPress={() => setConfirmDelete(false)} />
                  <Btn testID="tx-delete-confirm" title="Delete" kind="danger" style={{ flex: 1 }} loading={del.isPending} onPress={() => del.mutate()} />
                </View>
              </Card>
            ) : (
              <Btn testID="tx-delete-button" title="Delete transaction" kind="ghost" onPress={() => setConfirmDelete(true)} />
            )}
          </Page>
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  raw: { backgroundColor: c.surfaceTertiary, padding: 12, borderRadius: 12, color: c.onSurface },
}));
