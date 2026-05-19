import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";

export const api = axios.create({
    baseURL: API_URL,
    // SEC-1 Phase 3: send the httpOnly session cookies (fa_access, fa_refresh,
    // fa_temp) on every API call. The browser refuses to attach them on
    // cross-site requests because the server marks them SameSite=Strict.
    withCredentials: true,
    headers: { "Content-Type": "application/json" },
});

// Defense-in-depth CSRF guard: the server requires X-Requested-With on every
// state-changing API call. Setting it on every request (including GETs) is
// harmless and keeps the client side simple.
api.interceptors.request.use((config) => {
    config.headers.set("X-Requested-With", "FinAssist");
    return config;
});

// Auth refresh flow on 401.
//
// On a 401 from any non-auth endpoint, attempt /auth/refresh exactly once. If
// refresh succeeds, retry the original request transparently. If it fails,
// clear local state and bounce to /login. Concurrent 401s during a single
// refresh window share one in-flight refresh promise so we don't spam the
// endpoint.
type RetryableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

let refreshPromise: Promise<unknown> | null = null;

function endpointSkipsRefresh(url: string | undefined): boolean {
    if (!url) return false;
    return url.includes("/auth/login")
        || url.includes("/auth/register")
        || url.includes("/auth/refresh")
        || url.includes("/auth/logout")
        || url.includes("/auth/2fa/verify");
}

api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const original = error.config as RetryableConfig | undefined;
        const status = error.response?.status;

        if (status !== 401 || !original || original._retried || endpointSkipsRefresh(original.url)) {
            return Promise.reject(error);
        }
        original._retried = true;

        try {
            refreshPromise = refreshPromise || api.post("/auth/refresh");
            await refreshPromise;
            refreshPromise = null;
            return api(original);
        } catch (refreshErr) {
            refreshPromise = null;
            // Refresh path failed — session is unrecoverable. Lazy-import the
            // store to avoid a circular dependency at module load time.
            try {
                const { useAuthStore } = await import("./store");
                useAuthStore.getState().setUser(null);
            } catch { /* swallow — we're already bouncing */ }
            if (typeof window !== "undefined") {
                window.location.href = "/login";
            }
            return Promise.reject(refreshErr);
        }
    }
);
