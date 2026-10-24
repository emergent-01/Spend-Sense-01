import { RefreshControl, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import dayjs from "dayjs";
import { api, type Recurring } from "@/src/api";
import { Badge, Btn, Card, CatIcon, Empty, ErrorState, Loading, Page, ScreenHeader, T } from "@/src/components/ui";
import { inr } from "@/src/format";
import { makeStyles, useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function RecurringScreen() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ["recurring"],
    queryFn: () => api<{ items: Recurring[]; monthly_total: number; remaining_this_month: number }>("/recurring"),
  });
  const set = useMutation({
    mutationFn: (b: { merchant_key: string; status: string }) => api("/recurring", { method: "PUT", body: b }),
    onSuccess: (_, b) => {
      qc.invalidateQueries();
      toast(b.status === "cancelled" ? "Marked cancelled — we'll warn you if it still charges" : b.status === "ignored" ? "Removed from recurring" : "Marked active", "success");
    },
  });
  const d = q.data;
  return (
    <View style={styles.root}>
      <ScreenHeader title="Recurring bills" onBack={() => router.back()} topInset={insets.top} />
      {q.isLoading ? (
        <Loading />
      ) : q.isError || !d ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={colors.brandPrimary} />}
        >
          <Page style={{ padding: 16, gap: 16 }}>
            <Card style={{ flexDirection: "row", gap: 16 }} testID="recurring-summary">
              <View style={{ flex: 1 }}>
                <T v="caption">Committed per month</T>
                <T v="title" testID="recurring-monthly-total">{inr(d.monthly_total)}</T>
              </View>
              <View style={{ flex: 1 }}>
                <T v="caption">Still due this month</T>
                <T v="title" testID="recurring-remaining" style={{ color: colors.warning }}>{inr(d.remaining_this_month)}</T>
              </View>
            </Card>
            <T v="caption">
              Detected from charges that repeat every month (Netflix, gym, rent, SIPs…). Bills still due are reserved in your safe-to-spend.
            </T>
            {d.items.length === 0 ? (
              <Empty testID="recurring-empty" icon="repeat-outline" title="No recurring bills yet" body="They appear once a charge repeats in two different months, or mark one from a transaction." />
            ) : (
              d.items.map((r) => (
                <Card key={r.merchant_key} testID={`recurring-${r.merchant_key}`} style={[{ gap: 12 }, r.warning && { borderColor: r.warning === "still_charging" ? colors.error : colors.warning }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <CatIcon category={r.category} />
                    <View style={{ flex: 1 }}>
                      <T v="label" numberOfLines={1}>{r.merchant}</T>
                      <T v="caption">
                        Around day {r.expected_day} · seen {r.months_seen} month{r.months_seen === 1 ? "" : "s"}
                        {r.last_charged ? ` · last ${dayjs(r.last_charged).format("D MMM")}` : ""}
                      </T>
                    </View>
                    <T v="amount">{inr(r.amount)}</T>
                  </View>
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    {r.status === "cancelled" ? <Badge label="Cancelled" tone="muted" /> : r.charged_this_month ? <Badge label="Paid this month" tone="muted" /> : <Badge label="Due this month" />}
                    {r.warning === "missing" && <Badge label="Expected charge missing" tone="warning" />}
                    {r.warning === "still_charging" && <Badge label="Cancelled but still charging" tone="error" />}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {r.status === "active" ? (
                      <Btn testID={`recurring-cancel-${r.merchant_key}`} title="I cancelled this" kind="secondary" style={{ flex: 1 }} onPress={() => set.mutate({ merchant_key: r.merchant_key, status: "cancelled" })} />
                    ) : (
                      <Btn testID={`recurring-activate-${r.merchant_key}`} title="Still active" kind="secondary" style={{ flex: 1 }} onPress={() => set.mutate({ merchant_key: r.merchant_key, status: "active" })} />
                    )}
                    <Btn testID={`recurring-ignore-${r.merchant_key}`} title="Not recurring" kind="ghost" style={{ flex: 1 }} onPress={() => set.mutate({ merchant_key: r.merchant_key, status: "ignored" })} />
                  </View>
                </Card>
              ))
            )}
          </Page>
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
}));
