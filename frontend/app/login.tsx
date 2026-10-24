import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ActivityIndicator } from "react-native";
import { useAuth } from "@/src/auth";
import { Icon, Page, T } from "@/src/components/ui";
import { fonts, makeStyles, useTheme } from "@/src/theme";

const HERO =
  "https://images.unsplash.com/photo-1693389107440-afe980ccbb8d?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200";

export default function Login() {
  const { signInWithGoogle } = useAuth();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setError("");
    setBusy(true);
    try {
      await signInWithGoogle(); // root gate moves to the app once signed in
    } catch (e: any) {
      setError(e.message ?? "Sign-in failed, please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 24 }}>
        <View style={[styles.hero, { paddingTop: insets.top + 32 }]}>
          <Image source={{ uri: HERO }} style={styles.abs} contentFit="cover" />
          <LinearGradient colors={["transparent", colors.scrimLight, colors.scrim]} style={styles.abs} />
          <Page style={{ paddingHorizontal: 24, gap: 8 }}>
            <View style={styles.logo}>
              <Icon name="leaf-outline" size={22} color={colors.onBrandPrimary} />
            </View>
            <T v="title" style={{ color: colors.onSurfaceInverse, fontSize: 32 }}>SpendSense</T>
            <T style={{ color: colors.onSurfaceInverse, opacity: 0.9 }}>
              Your bank SMS, turned into budgets, alerts and a live safe-to-spend number.
            </T>
          </Page>
        </View>
        <Page style={{ padding: 24, gap: 16, maxWidth: 480 }}>
          <T v="h2">Sign in to sync your phone and web dashboard</T>
          <Pressable
            testID="google-signin-button"
            onPress={signIn}
            disabled={busy}
            style={({ pressed }) => [styles.google, pressed && { opacity: 0.85 }, busy && { opacity: 0.6 }]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onSurface} />
            ) : (
              <>
                <Icon name="logo-google" size={20} color="#4285F4" />
                <T style={styles.googleText}>Continue with Google</T>
              </>
            )}
          </Pressable>
          {!!error && (
            <T testID="auth-error" style={{ color: colors.error }}>
              {error}
            </T>
          )}
          <View style={styles.trust}>
            <Icon name="lock-closed-outline" size={16} color={colors.brandPrimary} />
            <T v="caption" style={{ flex: 1 }}>
              Your transactions are encrypted at rest and never shared with third parties. Signed up earlier with email? Use the same Google
              email and your data carries over.
            </T>
          </View>
        </Page>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  abs: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  hero: { minHeight: 320, justifyContent: "flex-end", paddingBottom: 32, overflow: "hidden", backgroundColor: c.brandPrimary },
  logo: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  google: {
    minHeight: 52,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.borderStrong,
    backgroundColor: c.surfaceSecondary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  googleText: { fontFamily: fonts.text, fontSize: 16, fontWeight: "500" },
  trust: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 8 },
}));
