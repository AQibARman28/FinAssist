import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { api } from "./api";

// SEC-1 Phase 3: tokens no longer live in JS-readable storage. Authentication
// is carried by httpOnly + SameSite=Strict cookies set by the API. This store
// holds only the non-sensitive user profile (so the dashboard greeting and
// settings page can render before the next API call returns).

interface User {
    _id: string;
    name: string;
    email: string;
    currency: string;
    role?: string;
    twoFactorEnabled?: boolean;
}

interface AuthState {
    user: User | null;
    setUser: (user: User | null) => void;
    logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            user: null,
            setUser: (user) => set({ user }),
            logout: async () => {
                // Best-effort server-side revoke. If the call fails (network, 401
                // from already-expired access cookie), the server still clears
                // the cookies via Set-Cookie; we still wipe local state.
                try { await api.post("/auth/logout"); } catch { /* ignore */ }
                set({ user: null });
            },
        }),
        {
            name: "finassist-user",
            // Plain localStorage is fine — the user object has no auth-bearing
            // material. The Next middleware (src/middleware.ts) gates routes
            // on the httpOnly session cookies, not on this store.
            storage: createJSONStorage(() =>
                typeof window === "undefined"
                    ? { getItem: () => null, setItem: () => {}, removeItem: () => {} }
                    : window.localStorage
            ),
            partialize: (state) => ({ user: state.user }),
        }
    )
);
