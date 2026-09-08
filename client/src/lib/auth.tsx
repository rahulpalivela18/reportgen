import {
  createContext,
  useContext,
  ReactNode,
  useState,
  useEffect,
} from "react";
import { api, setOnUnauthorized } from "./api";
import { offlineFetch } from "./offline";
import { isOfflineError } from "./offline";
import { db } from "./db";

const CACHED_AUTH_KEY = "cachedAuth";

async function cacheAuth(user: User, workspace: Workspace) {
  await db.offlineMeta
    .put({ key: CACHED_AUTH_KEY, value: { user, workspace }, updatedAt: Date.now() })
    .catch(() => {});
}

export async function getCachedAuth(): Promise<{
  user: User;
  workspace: Workspace;
} | null> {
  const row = await db.offlineMeta.get(CACHED_AUTH_KEY).catch(() => undefined);
  return (row?.value as any) ?? null;
}

// Tiny, rarely-changing datasets a zero-bars site visit needs to CREATE
// anything (new reports seed from templates, assignees from team).
// Fire-and-forget: responses populate the step-3 GET cache via offlineFetch.
function prefetchGlobalEssentials() {
  try {
    api.getChecklistTemplates().catch(() => {});
    api.getTeam().catch(() => {});
    api.getProjects().catch(() => {});
  } catch {
    // never block auth on prefetch
  }
}
import { queryClient, setQueryOnUnauthorized } from "./queryClient";

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  workspaceId: string;
  phone?: string | null;
  avatarUrl?: string | null;
};

type Workspace = {
  id: string;
  name: string;
  logoUrl?: string;
  address?: string;
  email?: string;
  phone?: string;
  taxRate?: string;
  plan?: string;
  planStatus?: string;
  trialEndsAt?: string | null;
};

type TrialInfo = {
  isTrial: boolean;
  daysRemaining: number | null;
  isExpired: boolean;
  trialEndsAt: string | null;
  limits: { maxProjects: number; maxCaptures: number } | null;
  usage: { projects: number; captures: number } | null;
};

type AuthContextType = {
  user: User | null;
  workspace: Workspace | null;
  isLoading: boolean;
  trial: TrialInfo | null;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    name: string;
    email: string;
    password: string;
    companyName: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshWorkspace: (data: Partial<Workspace>) => void;
  refreshUser: (data: Partial<User>) => void;
  refreshTrial: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [trial, setTrial] = useState<TrialInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTrialStatus = async () => {
    try {
      const res = await offlineFetch("/api/workspace/trial-status", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setTrial(data);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const onUnauth = () => {
      queryClient.clear();
      setUser(null);
      setWorkspace(null);
      setTrial(null);
      if (!["/", "/login", "/register", "/contact"].includes(window.location.pathname) && !window.location.pathname.startsWith("/shared/")) {
        window.location.href = "/";
      }
    };
    setOnUnauthorized(onUnauth);
    setQueryOnUnauthorized(onUnauth);

    if (window.location.pathname.startsWith("/shared/")) {
      setIsLoading(false);
      return;
    }

    api
      .me()
      .then(({ user, workspace }) => {
        setUser(user);
        setWorkspace(workspace);
        cacheAuth(user, workspace);
        fetchTrialStatus();
        // Returning session (not a fresh login): still warm the globals so
        // offline creation works without ever opening the right page first.
        prefetchGlobalEssentials();
      })
      .catch((err) => {
        // Offline with a previous login → fall back to cached identity so
        // the app opens instead of bouncing to /login (step 6).
        if (isOfflineError(err)) {
          getCachedAuth().then((cached) => {
            if (cached) {
              setUser(cached.user);
              setWorkspace(cached.workspace);
            }
          });
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const data = await api.login(email, password);
    queryClient.clear();
    setUser(data.user);
    setWorkspace(data.workspace);
    cacheAuth(data.user, data.workspace);
    fetchTrialStatus();
    prefetchGlobalEssentials();
  };

  const register = async (formData: {
    name: string;
    email: string;
    password: string;
    companyName: string;
  }) => {
    const data = await api.register(formData);
    queryClient.clear();
    setUser(data.user);
    setWorkspace(data.workspace);
    cacheAuth(data.user, data.workspace);
    fetchTrialStatus();
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      queryClient.clear();
      setUser(null);
      setWorkspace(null);
      setTrial(null);
      db.offlineMeta.delete(CACHED_AUTH_KEY).catch(() => {});
    }
  };

  const refreshWorkspace = (data: Partial<Workspace>) => {
    setWorkspace((prev) => (prev ? { ...prev, ...data } : prev));
  };

  const refreshUser = (data: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...data } : prev));
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        workspace,
        isLoading,
        trial,
        login,
        register,
        logout,
        refreshWorkspace,
        refreshUser,
        refreshTrial: fetchTrialStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
