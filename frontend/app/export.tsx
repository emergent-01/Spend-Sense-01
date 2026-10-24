import { useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import dayjs from "dayjs";
import { api, type Tx } from "@/src/api";
import { useAuth } from "@/src/auth";
import { claimReportHtml } from "@/src/claim-report";
import { Btn, Card, Empty, ErrorState, IconBtn, Loading, Page, ScreenHeader, T } from "@/src/components/ui";
import { currentMonth, inr, monthLabel, shiftMonth } from "@/src/format";
import { makeStyles, useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function Export() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const [month, setMonth] = useState<string>(currentMonth());
  const q = useQuery({
    queryKey: ["transactions", month, "reimbursable", null, ""],
    queryFn: () => api<Tx[]>(`/transactions?month=${month}&filter=reimbursable`),
  });
  const total = (q.data ?? []).reduce((s, t) => s + t.amount, 0);

  const exp = useMutation({
    mutationFn: async () => {
      const html = claimReportHtml(q.data ?? [], month === "all" ? "All time" : monthLabel(month), user?.name ?? null, user?.email);
      if (Platform.OS === "web") {
        // print the report from a hidden frame; the browser's "Save as PDF" produces the file
        const frame = document.createElement("iframe");
        frame.style.position = "fixed";
        frame.style.width = "0";
        frame.style.height = "0";
        frame.style.border = "0";
        document.body.appendChild(frame);
        frame.contentDocument!.open();
        frame.contentDocument!.write(html);
        frame.contentDocument!.close();
        setTimeout(() => {
          frame.contentWindow!.focus();
          frame.contentWindow!.print();
          frame.contentWindow!.addEventListener("afterprint", () => frame.remove());
          setTimeout(() => frame.remove(), 120000);
        }, 300);
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync())
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "Share claim report" });
    },
    onSuccess: () => toast(Platform.OS === "web" ? "Choose “Save as PDF” in the print dialog" : "Claim report ready", "success"),
    onError: (e: Error) => toast(e.message, "error"),
  });

  return (
    <View style={styles.root}>
      <ScreenHeader title="Claim report" onBack={() => router.back()} topInset={insets.top} />
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
            <Btn testID="export-pdf-button" title="Create claim report PDF" icon="document-text-outline" disabled={!q.data?.length} loading={exp.isPending} onPress={() => exp.mutate()} />
            <T v="caption">Date, merchant, amount and category for each item, with the original bank SMS attached as proof.</T>
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
