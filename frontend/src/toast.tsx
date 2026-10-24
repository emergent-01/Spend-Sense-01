import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts, makeStyles } from "@/src/theme";

type Toast = { msg: string; kind: "info" | "error" | "success" };
const Ctx = createContext<(msg: string, kind?: Toast["kind"]) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const show = useCallback((msg: string, kind: Toast["kind"] = "info") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, kind });
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && (
        <Animated.View
          entering={FadeInUp}
          exiting={FadeOutUp}
          pointerEvents="none"
          style={[styles.wrap, { top: insets.top + 8 }]}
        >
          <View testID="toast" style={[styles.toast, toast.kind === "error" && styles.err, toast.kind === "success" && styles.ok]}>
            <Text style={styles.text}>{toast.msg}</Text>
          </View>
        </Animated.View>
      )}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

const useStyles = makeStyles((c) => ({
  wrap: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  toast: { backgroundColor: c.surfaceInverse, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, maxWidth: 520 },
  err: { backgroundColor: c.error },
  ok: { backgroundColor: c.success },
  text: { color: c.onSurfaceInverse, fontFamily: fonts.text, fontSize: 14 },
}));
