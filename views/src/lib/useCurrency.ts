"use client";

import { useMemo } from "react";
import { useAuthStore } from "./store";

// Currency formatting bound to the signed-in user's profile currency.
// Use this everywhere amounts are displayed instead of a hardcoded "$".
// Analytics widgets already inline the same Intl pattern; new code (and the
// expense surface) should go through this hook so the locale/currency lives
// in one place.
export function useCurrency() {
    const currency = useAuthStore((s) => s.user?.currency) || "USD";
    return useMemo(() => {
        const fmt = new Intl.NumberFormat(undefined, { style: "currency", currency });
        const safe = (v: number) => fmt.format(Number.isFinite(v) ? v : 0);
        return {
            currency,
            // 350 -> "$350.00" / "৳350.00" (uses the currency's default digits)
            format: safe,
            // Outgoing/expense amount with a leading minus: "-$12.50"
            formatExpense: (v: number) => `-${safe(v)}`,
        };
    }, [currency]);
}
