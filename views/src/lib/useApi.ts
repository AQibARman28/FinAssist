"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import { cacheKey, load, readEntry, revalidateActive, subscribe, type CacheEntry } from "./apiCache";

// Read an API endpoint through the shared cache (lib/apiCache.ts).
//
//   const { data, isLoading, error, refresh } = useApi<Goal[]>("/goals");
//
// - `data` is the response's `data` field; `body` is the whole JSON body
//   (for `pagination` and friends).
// - A page you've already seen renders from the cache at once; it is
//   refetched in the background when older than MAX_AGE_MS.
// - `error` is set only when there is nothing to show. If a background
//   refresh fails, the last good data stays on screen, `refreshFailed` is
//   true and `updatedAt` says when that data was fetched.
// - Pass `null` as the url to skip the request (e.g. until an id is known).
// - Writes through lib/api.ts invalidate the cache, so after saving anything
//   the reads on screen refresh themselves; `refresh()` forces one.

// Navigating back to a page within this window costs no request at all.
const MAX_AGE_MS = 10_000;
// Coming back to the tab/app refreshes whatever is on screen if older than this.
const REFOCUS_AGE_MS = 30_000;

type Params = Record<string, string | number | boolean | undefined>;

export interface ApiBody<T> {
    success?: boolean;
    data?: T;
    pagination?: { page: number; limit: number; total: number; pages: number };
    [extra: string]: unknown;
}

const EMPTY: CacheEntry = Object.freeze({ fetchedAt: 0 });
const noopUnsubscribe = () => {};

let refocusInstalled = false;
function installRefocus() {
    if (refocusInstalled || typeof document === "undefined") return;
    refocusInstalled = true;
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") revalidateActive(REFOCUS_AGE_MS);
    });
}

export function useApi<T = unknown>(url: string | null, params?: Params) {
    // The key is the full, encoded request path, so it is also what we fetch.
    const key = url === null ? null : cacheKey(url, params);

    const subscribeKey = useCallback(
        (onChange: () => void) => (key === null ? noopUnsubscribe : subscribe(key, onChange)),
        [key],
    );
    const entry = useSyncExternalStore(
        subscribeKey,
        () => (key === null ? EMPTY : readEntry(key)),
        () => EMPTY,
    );

    const fetchKey = useCallback((maxAgeMs: number) => {
        if (key === null) return Promise.resolve();
        return load(key, () => api.get(key).then((res) => res.data), maxAgeMs);
    }, [key]);

    useEffect(() => {
        installRefocus();
        void fetchKey(MAX_AGE_MS);
    }, [fetchKey]);

    const refresh = useCallback(() => fetchKey(0), [fetchKey]);

    const body = entry.body as ApiBody<T> | undefined;
    return {
        data: body?.data,
        body,
        error: body === undefined ? entry.error : undefined,
        refreshFailed: body !== undefined && entry.error !== undefined,
        updatedAt: entry.bodyAt,
        isLoading: key !== null && body === undefined && entry.error === undefined,
        refresh,
    };
}
