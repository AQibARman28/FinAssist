"use client";

import { useMemo } from "react";
import { useAuthStore } from "./store";
import { moneyFormatter } from "./money";

// Currency formatting bound to the signed-in user's profile currency.
// Use this everywhere amounts are displayed instead of a hardcoded "$"; the
// rules themselves (৳ sign, lakh grouping, no ".00" on whole amounts) live in
// lib/money.ts.
export function useCurrency() {
    const currency = useAuthStore((s) => s.user?.currency) || "USD";
    // 350 -> "৳350" / "$350", 12.5 -> "$12.50"; formatExpense(12.5) -> "-$12.50"
    return useMemo(() => moneyFormatter(currency), [currency]);
}
