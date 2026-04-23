import { create } from "zustand";
import { persist } from "zustand/middleware";

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
            // Only persist user and token — 2FA gate state is session-only
            partialize: (state) => ({ user: state.user, token: state.token }),
        }
    )
);
