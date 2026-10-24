import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { api, setUnauthorizedHandler, TOKEN_KEY, getToken } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { queryClient } from "@/src/query-client";
import { configureNativeSync } from "@/src/sms";

WebBrowser.maybeCompleteAuthSession();

const AUTH_URL = "https://auth.emergentagent.com/";
const sentSessionIds = new Set<string>();
const extractSessionId = (url?: string | null) => url?.match(/[?#&]session_id=([^&#]+)/)?.[1] ?? null;

export type User = {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  monthly_income: number;
  savings_target: number;
};

type AuthCtx = {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

function cleanWebUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("session_id");
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  hash.delete("session_id");
  const h = hash.toString();
  window.history.replaceState(window.history.state, "", url.pathname + url.search + (h ? `#${h}` : ""));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const clearLocal = useCallback(async () => {
    await storage.secureRemove(TOKEN_KEY);
    configureNativeSync(null);
    queryClient.clear();
    setUser(null);
  }, []);

  // Exchange the one-time session_id for our 7-day session_token (once per id).
  const exchange = useCallback(async (sessionId: string): Promise<boolean> => {
    if (sentSessionIds.has(sessionId)) return false;
    sentSessionIds.add(sessionId);
    const data = await api<{ session_token: string; user: User }>("/auth/session", {
      method: "POST",
      body: { session_id: sessionId },
    });
    await storage.secureSet(TOKEN_KEY, data.session_token);
    configureNativeSync(data.session_token);
    queryClient.clear();
    setUser(data.user);
    return true;
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearLocal();
    });
    let sub: { remove(): void } | null = null;
    (async () => {
      try {
        const incoming = Platform.OS === "web" ? window.location.href : await Linking.getInitialURL();
        const sid = extractSessionId(incoming);
        if (sid) {
          try {
            if (await exchange(sid)) {
              if (Platform.OS === "web") cleanWebUrl();
              return;
            }
          } catch {}
        }
        const t = await getToken();
        if (t) {
          try {
            setUser(await api<User>("/auth/me"));
            configureNativeSync(t);
          } catch {
            await clearLocal();
          }
        }
      } finally {
        setLoading(false);
      }
    })();
    if (Platform.OS !== "web") {
      sub = Linking.addEventListener("url", ({ url }) => {
        const sid = extractSessionId(url);
        if (sid) exchange(sid).catch(() => {});
      });
    }
    return () => {
      setUnauthorizedHandler(null);
      sub?.remove();
    };
  }, [clearLocal, exchange]);

  const signInWithGoogle = useCallback(async () => {
    if (Platform.OS === "web") {
      const redirect = window.location.origin + "/";
      window.location.href = `${AUTH_URL}?redirect=${encodeURIComponent(redirect)}`;
      return;
    }
    const redirect = Linking.createURL("");
    let captured: string | null = null;
    const listener = Linking.addEventListener("url", ({ url }) => {
      captured = url;
    });
    try {
      const result = await WebBrowser.openAuthSessionAsync(`${AUTH_URL}?redirect=${encodeURIComponent(redirect)}`, redirect);
      const url = (result.type === "success" ? result.url : null) ?? captured ?? (await Linking.getInitialURL());
      const sid = extractSessionId(url);
      if (!sid) throw new Error("Sign-in was cancelled");
      await exchange(sid);
    } finally {
      listener.remove();
    }
  }, [exchange]);

  const signOut = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {}
    await clearLocal();
  }, [clearLocal]);

  const value: AuthCtx = {
    user,
    loading,
    signInWithGoogle,
    signOut,
    refreshUser: async () => setUser(await api<User>("/auth/me")),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
