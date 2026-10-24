import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, setUnauthorizedHandler, TOKEN_KEY, getToken } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { queryClient } from "@/src/query-client";
import { configureNativeSync } from "@/src/sms";

export type User = { id: string; email: string; name: string | null; monthly_income: number; savings_target: number };

type AuthCtx = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const signOut = useCallback(async () => {
    await storage.secureRemove(TOKEN_KEY);
    configureNativeSync(null);
    queryClient.clear();
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      signOut();
    });
    (async () => {
      const t = await getToken();
      if (t) {
        try {
          setUser(await api<User>("/auth/me"));
          configureNativeSync(t);
        } catch {
          await storage.secureRemove(TOKEN_KEY);
        }
      }
      setLoading(false);
    })();
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const finish = async (data: { access_token: string; user: User }) => {
    await storage.secureSet(TOKEN_KEY, data.access_token);
    configureNativeSync(data.access_token);
    queryClient.clear();
    setUser(data.user);
  };

  const value: AuthCtx = {
    user,
    loading,
    signIn: async (email, password) => finish(await api("/auth/login", { method: "POST", body: { email, password } })),
    signUp: async (email, password, name) =>
      finish(await api("/auth/register", { method: "POST", body: { email, password, name } })),
    signOut,
    refreshUser: async () => setUser(await api<User>("/auth/me")),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
