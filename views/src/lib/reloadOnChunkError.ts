// A lazily loaded chunk can vanish when a new version deploys while this tab
// is open: every deploy renames the chunks, and the old ones stop being served.
// Instead of letting next/dynamic crash the page, reload once to pick up the
// new version. The timestamp guard makes sure it can never loop.

const KEY = "finassist-chunk-reload";
const MIN_GAP_MS = 30_000;

export function reloadOnChunkError<T>(load: () => Promise<T>): () => Promise<T> {
    return () => load().catch((err: unknown) => {
        if (typeof window === "undefined") throw err;
        let last = 0;
        try { last = Number(window.sessionStorage.getItem(KEY)) || 0; } catch { /* storage blocked */ }
        if (Date.now() - last < MIN_GAP_MS) throw err;
        try { window.sessionStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked */ }
        window.location.reload();
        return new Promise<T>(() => {});   // never settles: the page is going away
    });
}
