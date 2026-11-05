"use client";

import { useMemo } from "react";
import { useApi } from "./useApi";

export interface CategoryRow {
    _id: string;
    name: string;
    isArchived?: boolean;
}

const NONE: never[] = [];

// The user's categories of one type, archived ones included, from a single
// cached request shared by every list, chart and quick-add on screen (the
// Expenses page used to fetch them three times). `active` is what a picker
// should offer; `all` resolves names on older rows filed under archived ones.
export function useCategories<T extends CategoryRow = CategoryRow>(type: "expense" | "income") {
    const query = useApi<T[]>("/categories", { type, includeArchived: true });
    const all = query.data ?? (NONE as T[]);
    const active = useMemo(() => all.filter((c) => !c.isArchived), [all]);
    return { ...query, all, active };
}
