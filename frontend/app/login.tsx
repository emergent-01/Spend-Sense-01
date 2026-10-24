import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { router } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "@/src/auth";
import { Btn, Icon, inputStyle, Page, T } from "@/src/components/ui";
import { makeStyles, useTheme } from "@/src/theme";

const HERO =
  "https://images.unsplash.com/photo-1693389107440-afe980ccbb8d?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200";

export default function Login() {
  const { signIn, signUp } = useAuth();
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const inp = inputStyle();
  const { colors } = useTheme();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    if (!email.trim() || password.length < 6) {
      setError("Enter your email and a password of at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") await signIn(email.trim(), password);
      else await signUp(email.trim(), password, name.trim());
      router.replace("/");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
        <View style={[styles.hero, { paddingTop: insets.top + 32 }]}>
          <Image source={{ uri: HERO }} style={StyleSheetAbsolute} contentFit="cover" />
          <LinearGradient colors={["transparent", colors.scrimLight, colors.scrim]} style={StyleSheetAbsolute} />
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
          <View style={styles.seg}>
            {(["login", "register"] as const).map((m) => (
              <Pressable key={m} testID={`auth-mode-${m}`} onPress={() => setMode(m)} style={[styles.segItem, mode === m && styles.segOn]}>
                <T v="label" style={{ color: mode === m ? colors.onSurface : colors.muted }}>
                  {m === "login" ? "Sign in" : "Create account"}
                </T>
              </Pressable>
            ))}
          </View>
          {mode === "register" && (
            <View>
              <T style={inp.label}>Name</T>
              <TextInput testID="auth-name-input" style={inp.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={colors.muted} />
            </View>
          )}
          <View>
            <T style={inp.label}>Email</T>
            <TextInput
              testID="auth-email-input"
              style={inp.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              placeholder="you@company.com"
              placeholderTextColor={colors.muted}
            />
          </View>
          <View>
            <T style={inp.label}>Password</T>
            <TextInput
              testID="auth-password-input"
              style={inp.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="At least 6 characters"
              placeholderTextColor={colors.muted}
              onSubmitEditing={submit}
            />
          </View>
          {!!error && (
            <T testID="auth-error" style={{ color: colors.error }}>
              {error}
            </T>
          )}
          <Btn testID="auth-submit-button" title={mode === "login" ? "Sign in" : "Create account"} onPress={submit} loading={busy} />
          <View style={styles.trust}>
            <Icon name="lock-closed-outline" size={16} color={colors.brandPrimary} />
            <T v="caption" style={{ flex: 1 }}>
              Your transactions are encrypted at rest and never shared with third parties.
            </T>
          </View>
        </Page>
      </KeyboardAwareScrollView>
    </View>
  );
}

const StyleSheetAbsolute = { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 };

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  hero: { minHeight: 300, justifyContent: "flex-end", paddingBottom: 32, overflow: "hidden", backgroundColor: c.brandPrimary },
  logo: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  seg: { flexDirection: "row", backgroundColor: c.surfaceTertiary, borderRadius: 999, padding: 4 },
  segItem: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 999 },
  segOn: { backgroundColor: c.surfaceSecondary },
  trust: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 8 },
}));
