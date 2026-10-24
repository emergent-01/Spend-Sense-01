import { useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import dayjs from "dayjs";
import { api, type Tx } from "@/src/api";
import { Btn, Card, Empty, ErrorState, IconBtn, Loading, Page, ScreenHeader, T } from "@/src/components/ui";
import { currentMonth, inr, monthLabel, shiftMonth } from "@/src/format";
import { makeStyles, useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function Export() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const [month, setMonth] = useState<string>(currentMonth());
  const q = useQuery({
    queryKey: ["transactions", month, "reimbursable", null, ""],
    queryFn: () => api<Tx[]>(`/transactions?month=${month}&filter=reimbursable`),
  });
  const total = (q.data ?? []).reduce((s, t) => s + t.amount, 0);

  const exp = useMutation({
    mutationFn: async () => {
      const csv = await api<string>(`/export/reimbursable?month=${month}`, { raw: true });
      const name = `spendsense-reimbursable-${month}.csv`;
      if (Platform.OS === "web") {
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      const file = new File(Paths.cache, name);
      if (file.exists) file.delete();
      file.create();
      file.write(csv);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: "text/csv", dialogTitle: "Share expense claim" });
    },
    onSuccess: () => toast("CSV ready", "success"),
    onError: (e: Error) => toast(e.message, "error"),
  });

  return (
    <View style={styles.root}>
      <ScreenHeader title="Reimbursable export" onBack={() => router.back()} topInset={insets.top} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <Page style={{ padding: 16, gap: 16 }}>
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <IconBtn testID="export-prev-month" icon="chevron-back" onPress={() => setMonth(month === "all" ? currentMonth() : shiftMonth(month, -1))} />
              <T v="label" testID="export-month-label" style={{ flex: 1, textAlign: "center" }}>{month === "all" ? "All time" : monthLabel(month)}</T>
              <IconBtn testID="export-next-month" icon="chevron-forward" onPress={() => month !== "all" && month < currentMonth() && setMonth(shiftMonth(month, 1))} />
            </View>
            <Btn testID="export-all-time-button" title={month === "all" ? "Back to this month" : "Show all time"} kind="ghost" onPress={() => setMonth(month === "all" ? currentMonth() : "all")} />
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <View>
                <T v="caption">Claimable total</T>
                <T v="title" testID="export-total">{inr(total, true)}</T>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <T v="caption">Transactions</T>
                <T v="title">{q.data?.length ?? 0}</T>
              </View>
            </View>
            <Btn testID="export-csv-button" title="Export CSV" icon="download-outline" disabled={!q.data?.length} loading={exp.isPending} onPress={() => exp.mutate()} />
            <T v="caption">Columns: Date, Merchant, Amount, Category, Note — ready for your expense claim.</T>
          </Card>

          {q.isLoading ? (
            <Loading />
          ) : q.isError ? (
            <ErrorState onRetry={() => q.refetch()} />
          ) : !q.data?.length ? (
            <Empty testID="export-empty" icon="briefcase-outline" title="Nothing flagged" body="Open any transaction and turn on “Reimbursable” to add it here." />
          ) : (
            <Card style={{ padding: 0, overflow: "hidden" }}>
              {q.data.map((t) => (
                <View key={t.id} style={styles.row} testID={`export-row-${t.id}`}>
                  <T v="caption" style={{ width: 56 }}>{dayjs(t.ts).format("D MMM")}</T>
                  <View style={{ flex: 1 }}>
                    <T v="label" numberOfLines={1}>{t.merchant}</T>
                    <T v="caption">{t.category}</T>
                  </View>
                  <T v="amount" style={{ color: colors.onSurface }}>{inr(t.amount, true)}</T>
                </View>
              ))}
            </Card>
          )}
        </Page>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: c.divider },
}));
