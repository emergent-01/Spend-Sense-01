import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { Btn, Card, Icon, Page, Progress, T } from "@/src/components/ui";
import { makeStyles, useTheme } from "@/src/theme";
import { backfill, checkSmsPermission, isAndroid, openAppSettings, requestSmsPermission, smsNativeAvailable, type SmsPermission, BACKFILL_KEY } from "@/src/sms";
import { getNotifPermission, requestNotifPermission } from "@/src/notify";
import { storage } from "@/src/utils/storage";

const POINTS = [
  ["chatbubbles-outline", "Reads only bank, card and UPI alerts", "OTPs, promotions and personal chats are skipped on your phone."],
  ["time-outline", "Starts with your last 12 months", "We scan your inbox once so budgets and recurring bills work from day one."],
  ["flash-outline", "Captures new spends live", "New transaction SMS are added in the background, even when the app is closed."],
  ["lock-closed-outline", "Private by design", "Data is encrypted at rest and never shared with anyone."],
];

export default function SmsSetup() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [perm, setPerm] = useState<SmsPermission>("denied");
  const [asked, setAsked] = useState(0);
  const [phase, setPhase] = useState<"intro" | "scanning" | "done">("intro");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ created: number; review: number; merged: number } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    checkSmsPermission().then(setPerm);
  }, []);

  const start = async () => {
    setErr("");
    let p = perm;
    if (p !== "granted") {
      p = await requestSmsPermission();
      setAsked((n) => n + 1);
      setPerm(p);
    }
    if (p !== "granted") return;
    setPhase("scanning");
    try {
      const r = await backfill((done, total) => setProgress({ done, total }));
      setResult(r);
      setPhase("done");
      qc.invalidateQueries();
      if ((await getNotifPermission()) === "undetermined") await requestNotifPermission();
    } catch (e: any) {
      setErr(e.message);
      setPhase("intro");
    }
  };

  const skip = async () => {
    await storage.setItem(BACKFILL_KEY, true);
    router.replace("/(tabs)");
  };

  const blocked = perm === "blocked" || (perm === "denied" && asked >= 2);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }}>
        <Page style={{ gap: 16, maxWidth: 560 }}>
          <View style={styles.badge}>
            <Icon name="chatbox-ellipses-outline" size={28} color={colors.brandPrimary} />
          </View>
          <T v="title">Let SpendSense read your transaction SMS</T>
          <T style={{ color: colors.muted }}>
            Indian banks send an SMS for every card swipe and UPI payment. SpendSense turns those into a clean, categorised history automatically.
          </T>

          {phase === "intro" && (
            <>
              <Card style={{ gap: 16 }}>
                {POINTS.map(([icon, title, body]) => (
                  <View key={title} style={{ flexDirection: "row", gap: 12 }}>
                    <Icon name={icon as any} size={22} color={colors.brandPrimary} />
                    <View style={{ flex: 1 }}>
                      <T v="label">{title}</T>
                      <T v="caption">{body}</T>
                    </View>
                  </View>
                ))}
              </Card>
              {!isAndroid || !smsNativeAvailable ? (
                <Card testID="sms-unavailable-card" style={{ gap: 8, borderColor: colors.warning }}>
                  <T v="label">Automatic SMS reading needs the installed Android app</T>
                  <T v="caption">
                    In this preview you can paste any bank SMS from the + button, or load sample messages to explore the dashboard.
                  </T>
                </Card>
              ) : blocked ? (
                <Card testID="sms-blocked-card" style={{ gap: 12, borderColor: colors.warning }}>
                  <T v="label">SMS access is turned off</T>
                  <T v="caption">Open Settings → Permissions → SMS and choose Allow, then come back here.</T>
                  <Btn testID="sms-open-settings-button" title="Open Settings" kind="secondary" icon="settings-outline" onPress={openAppSettings} />
                  <Btn testID="sms-retry-check-button" title="I've allowed it" kind="ghost" onPress={() => checkSmsPermission().then(setPerm)} />
                </Card>
              ) : (
                <>
                  {perm === "denied" && asked > 0 && (
                    <T testID="sms-denied-text" style={{ color: colors.warning }}>
                      Without SMS access you’ll need to add every transaction by hand. You can allow it once more.
                    </T>
                  )}
                  <Btn testID="sms-allow-button" title={perm === "granted" ? "Scan my last 12 months" : "Allow SMS access"} icon="shield-checkmark-outline" onPress={start} />
                </>
              )}
              {!!err && <T style={{ color: colors.error }}>{err}</T>}
              <Btn testID="sms-skip-button" title={isAndroid && smsNativeAvailable ? "Not now" : "Continue to dashboard"} kind="ghost" onPress={skip} />
            </>
          )}

          {phase === "scanning" && (
            <Card testID="sms-scan-progress" style={{ gap: 12 }}>
              <T v="label">Scanning your inbox…</T>
              <Progress pct={progress.total ? (progress.done / progress.total) * 100 : 5} />
              <T v="caption">
                {progress.total ? `${progress.done} of ${progress.total} bank messages processed` : "Looking for bank and UPI messages"}
              </T>
            </Card>
          )}

          {phase === "done" && result && (
            <Card testID="sms-scan-result" style={{ gap: 8 }}>
              <T v="h2">All set</T>
              <T>
                {result.created} transactions imported, {result.merged} duplicates merged, {result.review} sent to Needs review.
              </T>
              <T v="caption">New SMS will be captured automatically from now on.</T>
              <Btn testID="sms-done-button" title="Open my dashboard" onPress={() => router.replace("/(tabs)")} style={{ marginTop: 8 }} />
            </Card>
          )}
        </Page>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  badge: { width: 56, height: 56, borderRadius: 16, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
}));
