import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import { LogBox, StyleSheet, View, ActivityIndicator } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { StatusBar } from "expo-status-bar";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider } from "@/src/auth";
import { ToastProvider } from "@/src/toast";
import { SyncBridge } from "@/src/sync-bridge";
import { colors } from "@/src/theme";

LogBox.ignoreAllLogs(true);

export default function RootLayout() {
  // Prewarm fonts incl. the icon font so icons render in Expo Go on Android.
  const [loaded] = useFonts({
    SpaceGrotesk: require("../assets/fonts/SpaceGrotesk.ttf"),
    Jakarta: require("../assets/fonts/PlusJakartaSans.ttf"),
    Ionicons: require("@react-native-vector-icons/ionicons/fonts/Ionicons.ttf"),
  });
  if (!loaded) {
    return (
      <View style={[styles.root, { alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }]}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }
  return (
    <GestureHandlerRootView style={styles.root}>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <KeyboardProvider>
            <AuthProvider>
              <ToastProvider>
                <StatusBar style="dark" />
                <SyncBridge />
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
                  <Stack.Screen name="add" options={{ presentation: "modal" }} />
                </Stack>
              </ToastProvider>
            </AuthProvider>
          </KeyboardProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
