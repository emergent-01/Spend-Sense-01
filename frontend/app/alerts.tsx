import { useEffect } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import dayjs from "dayjs";
import { api, type Alert } from "@/src/api";
import { Card, Empty, ErrorState, Icon, Loading, Page, ScreenHeader, T } from "@/src/components/ui";
import { makeStyles, useTheme } from "@/src/theme";

export default function Alerts() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["alerts"], queryFn: () => api<{ items: Alert[]; unread: number }>("/alerts") });

  useEffect(() => {
    if (q.data?.unread) {
      api("/alerts/read-all", { method: "POST" }).then(() => qc.invalidateQueries({ queryKey: ["overview"] }));
    }
  }, [q.data?.unread, qc]);

  const icon = (a: Alert) => (a.type === "weekly" ? "calendar-outline" : a.type === "recurring" ? "repeat-outline" : a.severity === "error" ? "alert-circle-outline" : "trending-up-outline");
  const tone = (a: Alert) => (a.severity === "error" ? colors.error : a.severity === "warning" ? colors.warning : colors.brandPrimary);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Alerts" onBack={() => router.back()} topInset={insets.top} />
      {q.isLoading ? (
        <Loading />
      ) : q.isError || !q.data ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={colors.brandPrimary} />}
        >
          <Page style={{ padding: 16, gap: 12 }}>
            {q.data.items.length === 0 ? (
              <Empty testID="alerts-empty" icon="notifications-off-outline" title="No alerts yet" body="You'll be alerted at 70%, 90% and 100% of any budget, plus a weekly summary." />
            ) : (
              q.data.items.map((a) => (
                <Card key={a.id} testID={`alert-${a.id}`} style={{ flexDirection: "row", gap: 12 }}>
                  <View style={[styles.dot, { borderColor: tone(a) }]}>
                    <Icon name={icon(a) as any} size={20} color={tone(a)} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                      <T v="label" style={{ flex: 1 }}>{a.title}</T>
                      {!a.read && <View style={[styles.unread, { backgroundColor: tone(a) }]} />}
                    </View>
                    <T>{a.message}</T>
                    <T v="caption">{dayjs(a.created_at).format("D MMM, h:mm A")}</T>
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
  dot: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary },
  unread: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
}));
