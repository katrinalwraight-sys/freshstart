import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api, Profile, TOKEN_KEY, User } from "@/src/api";
import { queryClient } from "@/src/query-client";
import { storage } from "@/src/utils/storage";

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  saveProfile: (p: Profile) => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await storage.secureGet<string | null>(TOKEN_KEY, null);
      if (token) {
        try {
          setUser(await api<User>("/auth/me"));
        } catch (e: any) {
          if (e.status === 401) await storage.secureRemove(TOKEN_KEY);
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ access_token: string; user: User }>("/auth/login", { method: "POST", body: { email, password } });
    await storage.secureSet(TOKEN_KEY, res.access_token);
    queryClient.clear();
    setUser(res.user);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const res = await api<{ access_token: string; user: User }>("/auth/register", { method: "POST", body: { name, email, password } });
    await storage.secureSet(TOKEN_KEY, res.access_token);
    queryClient.clear();
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    await storage.secureRemove(TOKEN_KEY);
    queryClient.clear();
    setUser(null);
  }, []);

  const saveProfile = useCallback(async (p: Profile) => {
    const profile = await api<Profile>("/profile", { method: "PUT", body: p });
    setUser((u) => (u ? { ...u, profile } : u));
  }, []);

  return <Ctx.Provider value={{ user, loading, login, register, logout, saveProfile }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside provider");
  return c;
}
