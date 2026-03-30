import { create } from "zustand";
import api from "../lib/api";
import { connectSocket, disconnectSocket } from "../lib/socket";
import { QueryClient } from "@tanstack/react-query";
import { useChatStore } from "./chatStore";

// Shared query client reference — set from main.tsx
let queryClientRef: QueryClient | null = null;
export function setQueryClient(qc: QueryClient) {
  queryClientRef = qc;
}

interface User {
  _id: string;
  name: string;
  email: string;
  role: "patient" | "agent";
}

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (
    name: string,
    email: string,
    password: string,
    role: string,
  ) => Promise<void>;
  loadProfile: () => Promise<void>;
  logout: () => void;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  refreshToken: null,
  isAuthenticated: false,
  isLoading: false,

  hydrate: () => {
    const token = localStorage.getItem("token");
    const refreshToken = localStorage.getItem("refreshToken");
    const userStr = localStorage.getItem("user");
    if (token && refreshToken && userStr) {
      try {
        const user = JSON.parse(userStr) as User;
        set({ token, refreshToken, user, isAuthenticated: true });
        connectSocket();
      } catch {
        localStorage.removeItem("token");
        localStorage.removeItem("refreshToken");
        localStorage.removeItem("user");
      }
    }
  },

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const res = await api.post("/api/auth/login", { email, password });
      const { accessToken, refreshToken, user } = res.data.data;
      // Clear previous user's state before setting new user
      useChatStore.getState().resetStore();
      queryClientRef?.clear();
      localStorage.setItem("token", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
      localStorage.setItem("user", JSON.stringify(user));
      set({
        token: accessToken,
        refreshToken,
        user,
        isAuthenticated: true,
        isLoading: false,
      });
      connectSocket();
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  register: async (name, email, password, role) => {
    set({ isLoading: true });
    try {
      const res = await api.post("/api/auth/register", {
        name,
        email,
        password,
        role,
      });
      const { accessToken, refreshToken, user } = res.data.data;
      localStorage.setItem("token", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
      localStorage.setItem("user", JSON.stringify(user));
      set({
        token: accessToken,
        refreshToken,
        user,
        isAuthenticated: true,
        isLoading: false,
      });
      connectSocket();
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  loadProfile: async () => {
    try {
      const res = await api.get("/api/auth/profile");
      const user = res.data.data;
      localStorage.setItem("user", JSON.stringify(user));
      set({ user });
    } catch {
      get().logout();
    }
  },

  logout: () => {
    // Reset ALL chat state first — must happen before token clear
    // to prevent the next user from seeing the previous user's activeConversationId
    useChatStore.getState().resetStore();
    queryClientRef?.clear();
    localStorage.removeItem("token");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
    disconnectSocket();
    set({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
    });
  },
}));

// ── Global 401 handler ──────────────────────────────────────────────
// Fired by api.ts interceptor when any request returns 401 (expired token).
// Triggers a clean logout without a hard page reload.
if (typeof window !== "undefined") {
  window.addEventListener("auth:token-refreshed", (event) => {
    const customEvent = event as CustomEvent<{ accessToken?: string }>;
    const tokenFromEvent = customEvent.detail?.accessToken;
    const token = tokenFromEvent ?? localStorage.getItem("token");

    if (!token) return;

    const state = useAuthStore.getState();
    if (state.isAuthenticated) {
      useAuthStore.setState({ token });
      connectSocket();
    }
  });

  window.addEventListener("auth:unauthorized", () => {
    const state = useAuthStore.getState();
    if (state.isAuthenticated) {
      state.logout();
    }
  });
}
