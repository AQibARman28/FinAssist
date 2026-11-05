// Network resilience helpers used by lib/api.ts.
//
// The backend runs on a free Render instance that sleeps when idle; the first
// request after that can take ~50 s while it boots, and the gateway in front
// may give up first (502/503/504). Reads are retried a couple of times so the
// page fills in once the server is up, and the pending-request tracker lets
// components/NetworkStatus.tsx tell the user what is going on instead of
// leaving a silent spinner.

const RETRY_DELAYS_MS = [1000, 3000];
const GATEWAY_STATUSES = new Set([502, 503, 504]);

// Delay before retrying a failed request, or null to give up. Only reads are
// retried: a write that timed out may still have been applied, and repeating
// it could, say, record an expense twice.
export function retryDelayMs({ method, status, attempt, canceled = false }: {
    method: string | undefined;
    status: number | undefined;
    attempt: number;
    canceled?: boolean;
}): number | null {
    if (canceled || (method ?? "get").toLowerCase() !== "get") return null;
    if (status !== undefined && !GATEWAY_STATUSES.has(status)) return null;
    return RETRY_DELAYS_MS[attempt] ?? null;
}

// ── Pending-request tracker (a tiny external store for useSyncExternalStore) ─

export interface Activity {
    pending: number;
    since: number | null;   // when the oldest pending request started
}

let starts: number[] = [];
let snapshot: Activity = { pending: 0, since: null };
const listeners = new Set<() => void>();

function publish() {
    snapshot = { pending: starts.length, since: starts.length ? Math.min(...starts) : null };
    for (const fn of listeners) fn();
}

// Call when a request goes out; call the returned function when it settles.
export function requestStarted(): () => void {
    const startedAt = Date.now();
    starts.push(startedAt);
    publish();
    let done = false;
    return () => {
        if (done) return;
        done = true;
        const i = starts.indexOf(startedAt);
        if (i !== -1) starts = [...starts.slice(0, i), ...starts.slice(i + 1)];
        publish();
    };
}

export const getActivity = (): Activity => snapshot;

export function subscribeActivity(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}
