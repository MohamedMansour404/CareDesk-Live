import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "",
  headers: { "Content-Type": "application/json" },
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const refreshToken = localStorage.getItem("refreshToken");
    if (!refreshToken) return null;

    try {
      const response = await axios.post(
        "/api/auth/refresh",
        { refreshToken },
        {
          baseURL: import.meta.env.VITE_API_URL || "",
          headers: { "Content-Type": "application/json" },
        },
      );

      const { accessToken, refreshToken: newRefreshToken } = response.data.data;
      localStorage.setItem("token", accessToken);
      localStorage.setItem("refreshToken", newRefreshToken);
      window.dispatchEvent(
        new CustomEvent("auth:token-refreshed", {
          detail: { accessToken },
        }),
      );
      return accessToken;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 → dispatch event for clean logout (handled by authStore)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as
      | (typeof error.config & { _retry?: boolean })
      | undefined;

    const isUnauthorized = error.response?.status === 401;
    const isRefreshRequest =
      typeof originalRequest?.url === "string" &&
      originalRequest.url.includes("/api/auth/refresh");

    if (
      isUnauthorized &&
      originalRequest &&
      !originalRequest._retry &&
      !isRefreshRequest
    ) {
      originalRequest._retry = true;
      const newAccessToken = await refreshAccessToken();

      if (newAccessToken) {
        originalRequest.headers = originalRequest.headers ?? {};
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      }
    }

    if (isUnauthorized) {
      sessionStorage.setItem(
        "auth_notice",
        "Your session expired. Please sign in again.",
      );
      // Dispatch a global event — authStore listens and performs a clean logout
      // (clears Zustand, React Query, WebSocket) without a hard page reload
      window.dispatchEvent(new Event("auth:unauthorized"));
    }

    return Promise.reject(error);
  },
);

export default api;
