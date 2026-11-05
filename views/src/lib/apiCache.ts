// In-memory cache of GET response bodies, shared by every component that reads
// through lib/useApi.ts. It is what makes moving between pages instant: a page
// you have seen renders from here immediately and refreshes in the background.
//
// Rules:
//   - One request per key at a time; concurrent readers share it.
//   - An entry younger than the caller's maxAge is served without a request.
//   - Any successful write through lib/api.ts calls invalidateAll(): watched
//     entries refetch at once, the rest refetch on their next read. Stale data
//     stays visible meanwhile, so nothing flashes back to a spinner.
//   - clearAll() on sign-in/sign-out: no financial data outlives the session.
//   - Memory only. Nothing here is persisted (the service worker never caches
//     /api either).

export interface CacheEntry {
    body?: unknown;
    error?: unknown;
    fetchedAt: number;
}

type Loader = () => Promise<unknown>;

interface Slot {
    entry: CacheEntry;
    listeners: Set<() => void>;
    inflight: Promise<void> | null;
    loader: Loader | null;
    stale: boolean;
}

const EMPTY: CacheEntry = Object.freeze({ fetchedAt: 0 });
const slots = new Map<string, Slot>();
// Bumped by clearAll so a response that arrives after sign-out is dropped.
let epoch = 0;

function slotFor(key: string): Slot {
    let s = slots.get(key);
    if (!s) {
        s = { entry: EMPTY, listeners: new Set(), inflight: null, loader: null, stale: false };
        slots.set(key, s);
    }
    return s;
}

function write(s: Slot, entry: CacheEntry) {
    s.entry = entry;
    for (const fn of s.listeners) fn();
}

// "/expenses" + { page: 1, limit: 5 } → "/expenses?limit=5&page=1"
export function cacheKey(url: string, params?: Record<string, unknown>): string {
    const pairs = Object.entries(params ?? {})
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    if (pairs.length === 0) return url;
    return `${url}${url.includes("?") ? "&" : "?"}${pairs.join("&")}`;
}

export function readEntry(key: string): CacheEntry {
    return slots.get(key)?.entry ?? EMPTY;
}

export function subscribe(key: string, fn: () => void): () => void {
    const s = slotFor(key);
    s.listeners.add(fn);
    return () => { s.listeners.delete(fn); };
}

export function load(key: string, loader: Loader, maxAgeMs: number): Promise<void> {
    const s = slotFor(key);
    s.loader = loader;
    if (s.inflight) return s.inflight;

    const { entry } = s;
    const fresh = !s.stale && entry.error === undefined && entry.fetchedAt > 0
        && Date.now() - entry.fetchedAt < maxAgeMs;
    if (fresh) return Promise.resolve();

    s.stale = false;
    const started = epoch;
    const run = (async () => {
        try {
            const body = await loader();
            if (started === epoch) write(s, { body, fetchedAt: Date.now() });
        } catch (error) {
            if (started === epoch) write(s, { body: s.entry.body, error, fetchedAt: Date.now() });
        } finally {
            s.inflight = null;
        }
        // Invalidated while in flight: what we got may predate the write.
        if (started === epoch && s.stale && s.listeners.size > 0 && s.loader) {
            await load(key, s.loader, 0);
        }
    })();
    s.inflight = run;
    return run;
}

export function invalidateAll(): void {
    for (const [key, s] of slots) {
        s.stale = true;
        if (s.listeners.size > 0 && s.loader && !s.inflight) void load(key, s.loader, 0);
    }
}

// Refetch what is on screen if it is older than maxAgeMs (tab/app refocus).
export function revalidateActive(maxAgeMs: number): void {
    const now = Date.now();
    for (const [key, s] of slots) {
        if (s.listeners.size > 0 && s.loader && now - s.entry.fetchedAt >= maxAgeMs) void load(key, s.loader, maxAgeMs);
    }
}

export function clearAll(): void {
    epoch++;
    for (const s of slots.values()) write(s, EMPTY);
    for (const [key, s] of slots) if (s.listeners.size === 0) slots.delete(key);
    for (const s of slots.values()) { s.inflight = null; s.stale = false; }
}
