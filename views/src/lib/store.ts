import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

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
    token: string | null;
    // Transient 2FA gate state (not persisted)
    requires2FA: boolean;
    tempToken: string | null;
    setAuth: (user: User, token: string) => void;
    set2FAGate: (tempToken: string) => void;
    clear2FAGate: () => void;
    logout: () => void;
}

// Cookie-backed storage so the Next.js proxy (proxy.ts) can read the auth
// state server-side. localStorage works only in the browser; the proxy runs
// on the server and would always see an unauthenticated request, redirecting
// every navigation to /dashboard back to /login.
const cookieStorage = {
    getItem: (name: string): string | null => {
        if (typeof document === "undefined") return null;
        const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
        return match ? decodeURIComponent(match[2]) : null;
    },
    setItem: (name: string, value: string): void => {
        if (typeof document === "undefined") return;
        // 30 days, path=/ so every route can read it, SameSite=Lax for normal nav.
        document.cookie =
            name + "=" + encodeURIComponent(value) +
            "; path=/; max-age=2592000; SameSite=Lax";
    },
    removeItem: (name: string): void => {
        if (typeof document === "undefined") return;
        document.cookie = name + "=; path=/; max-age=0";
    },
};

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            user: null,
            token: null,
            requires2FA: false,
            tempToken: null,
            setAuth: (user, token) => set({ user, token, requires2FA: false, tempToken: null }),
            set2FAGate: (tempToken) => set({ requires2FA: true, tempToken }),
            clear2FAGate: () => set({ requires2FA: false, tempToken: null }),
            logout: () => set({ user: null, token: null, requires2FA: false, tempToken: null }),
        }),
        {
            name: "finassist-auth",
            storage: createJSONStorage(() => cookieStorage),
            // Only persist user and token — 2FA gate state is session-only
            partialize: (state) => ({ user: state.user, token: state.token }),
        }
    )
);
