import { useEffect, useState } from "react";
import { Pressable, Switch, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { Btn, Card, Icon, Page, T, inputStyle } from "@/src/components/ui";
import { inr } from "@/src/format";
import { makeStyles, useTheme } from "@/src/theme";
import { usesNativeTabs } from "@/src/navigation";
import { useToast } from "@/src/toast";
import { isAndroid, smsNativeAvailable } from "@/src/sms";
import { getNotifPermission, requestNotifPermission, type NotifPermission } from "@/src/notify";
import { openAppSettings } from "@/src/sms";
import { useLoadSample } from "@/src/use-sample";

export default function More() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const inp = inputStyle();
  const { colors } = useTheme();
  const { user, signOut, refreshUser } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const sample = useLoadSample();
  const [income, setIncome] = useState(String(user?.monthly_income || ""));
  const [savings, setSavings] = useState(String(user?.savings_target || ""));
  const [notif, setNotif] = useState<NotifPermission>("unavailable");
  const review = useQuery({ queryKey: ["review"], queryFn: () => api<{ count: number }>("/review") });
  const rec = useQuery({ queryKey: ["recurring"], queryFn: () => api<{ items: any[]; monthly_total: number }>("/recurring") });

  useEffect(() => {
    getNotifPermission().then(setNotif);
  }, []);

  const save = useMutation({
    mutationFn: () =>
      api("/settings", { method: "PUT", body: { monthly_income: Number(income || 0), savings_target: Number(savings || 0) } }),
    onSuccess: async () => {
      await refreshUser();
      qc.invalidateQueries();
      toast("Income & savings target saved", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const toggleNotif = async () => {
    if (notif === "granted") return;
    if (notif === "blocked") return openAppSettings();
    setNotif(await requestNotifPermission());
  };

  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <Page style={{ paddingHorizontal: 16 }}>
          <T v="title">More</T>
          <T v="caption" testID="more-user-email">{user?.email}</T>
        </Page>
      </View>
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ paddingBottom: bottomChrome + 24 }} keyboardShouldPersistTaps="handled">
        <Page style={{ padding: 16, gap: 16 }}>
          <Card testID="income-savings-card" style={{ gap: 12 }}>
            <T v="h2">Income & savings</T>
            <T v="caption">
              Salary credits are detected from SMS automatically. Expected income is used until this month’s salary arrives.
            </T>
            <View>
              <T style={inp.label}>Expected monthly income (₹)</T>
              <TextInput
                testID="settings-income-input"
                style={inp.input}
                value={income}
                onChangeText={(t) => setIncome(t.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                placeholder="e.g. 95000"
                placeholderTextColor={colors.muted}
              />
            </View>
            <View>
              <T style={inp.label}>Monthly savings target (₹)</T>
              <TextInput
                testID="settings-savings-input"
                style={inp.input}
                value={savings}
                onChangeText={(t) => setSavings(t.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                placeholder="e.g. 20000"
                placeholderTextColor={colors.muted}
              />
            </View>
            <Btn testID="settings-save-button" title="Save" loading={save.isPending} onPress={() => save.mutate()} />
          </Card>

          <Card style={{ padding: 0, overflow: "hidden" }}>
            <Row
              testID="more-recurring-link"
              icon="repeat-outline"
              title="Recurring bills"
              sub={rec.data ? `${rec.data.items.length} found · ${inr(rec.data.monthly_total)}/month` : "Subscriptions, rent, SIPs"}
              onPress={() => router.push("/recurring")}
            />
            <Row
              testID="more-review-link"
              icon="help-circle-outline"
              title="Needs review"
              sub={review.data ? `${review.data.count} waiting` : "Unparsed or uncategorised"}
              onPress={() => router.push("/review")}
            />
            <Row testID="more-categories-link" icon="pricetags-outline" title="Categories" sub="Add, rename or delete your own categories" onPress={() => router.push("/categories")} />
            <Row testID="more-export-link" icon="document-text-outline" title="Claim report PDF" sub="Reimbursable spends with bank SMS proof" onPress={() => router.push("/export")} />
            <Row testID="more-alerts-link" icon="notifications-outline" title="Alerts" sub="Budget, recurring and weekly summaries" onPress={() => router.push("/alerts")} />
          </Card>

          <Card style={{ padding: 0, overflow: "hidden" }}>
            <Row
              testID="more-sms-link"
              icon="chatbox-ellipses-outline"
              title="SMS capture"
              sub={smsNativeAvailable ? "Permissions and 12-month inbox scan" : isAndroid ? "Available in the installed Android app" : "Android app only · paste SMS here instead"}
              onPress={() => router.push(smsNativeAvailable ? "/sms-setup" : "/add")}
            />
            {notif !== "unavailable" && (
              <Row
                testID="more-notifications-row"
                icon="phone-portrait-outline"
                title="Phone notifications"
                sub={notif === "granted" ? "On for budget & weekly alerts" : notif === "blocked" ? "Blocked · tap to open Settings" : "Get alerted at 70%, 90% and 100%"}
                onPress={toggleNotif}
                right={<Switch testID="more-notifications-switch" value={notif === "granted"} onValueChange={toggleNotif} trackColor={{ true: colors.brandPrimary, false: colors.border }} />}
              />
            )}
            <Row testID="more-sample-link" icon="flask-outline" title="Load sample messages" sub="Try the dashboard with demo bank SMS" onPress={() => sample.mutate()} />
          </Card>

          <View style={styles.trust}>
            <Icon name="lock-closed-outline" size={16} color={colors.brandPrimary} />
            <T v="caption" style={{ flex: 1 }}>
              Merchant names, UPI IDs, account numbers and raw SMS are encrypted at rest. Nothing is shared with third parties.
            </T>
          </View>

          <Btn testID="sign-out-button" title="Sign out" kind="danger" icon="log-out-outline" onPress={() => signOut()} />
        </Page>
      </KeyboardAwareScrollView>
    </View>
  );
}

function Row({ icon, title, sub, onPress, testID, right }: { icon: string; title: string; sub?: string; onPress?: () => void; testID: string; right?: React.ReactNode }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceTertiary }]}>
      <View style={styles.rowIcon}>
        <Icon name={icon as any} size={20} color={colors.brandPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <T v="label">{title}</T>
        {sub ? <T v="caption">{sub}</T> : null}
      </View>
      {right ?? <Icon name="chevron-forward" size={18} color={colors.muted} />}
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.divider, paddingBottom: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 60, borderBottomWidth: 1, borderBottomColor: c.divider },
  rowIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  trust: { flexDirection: "row", gap: 8, alignItems: "center", paddingHorizontal: 4 },
}));
