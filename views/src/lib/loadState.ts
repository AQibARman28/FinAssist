// One verdict for a screen made of several independent reads (lib/useApi.ts),
// so it can show a single notice instead of one per tile.
//
//   failed: some figures have nothing to show at all (first load failed).
//   stale:  everything has data, but a refresh failed; the screen is showing
//           figures fetched at `asOf` (the oldest of them).

export interface ReadState {
    error?: unknown;
    refreshFailed: boolean;
    updatedAt?: number;
}

export type LoadState =
    | { kind: "ok" }
    | { kind: "failed"; count: number }
    | { kind: "stale"; asOf: number | undefined };

export function summarizeLoadState(reads: ReadState[]): LoadState {
    const failed = reads.filter((r) => r.error !== undefined).length;
    if (failed > 0) return { kind: "failed", count: failed };

    const stale = reads.filter((r) => r.refreshFailed);
    if (stale.length === 0) return { kind: "ok" };
    const times = stale.map((r) => r.updatedAt).filter((t): t is number => t !== undefined);
    return { kind: "stale", asOf: times.length > 0 ? Math.min(...times) : undefined };
}
