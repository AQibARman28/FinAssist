import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cacheKey, load, readEntry, subscribe, invalidateAll, clearAll, revalidateActive } from "../apiCache.ts";

// A loader that counts calls and resolves with whatever `next` says.
function counter(next: () => unknown) {
    const fn = async () => { fn.calls++; return next(); };
    fn.calls = 0;
    return fn;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => clearAll());

describe("apiCache — keys", () => {
    it("is stable regardless of param order and skips undefined", () => {
        assert.equal(cacheKey("/expenses", { limit: 5, page: 1 }), cacheKey("/expenses", { page: 1, limit: 5, category: undefined }));
        assert.notEqual(cacheKey("/expenses", { limit: 5 }), cacheKey("/expenses", { limit: 6 }));
        assert.equal(cacheKey("/goals"), "/goals");
    });
});

describe("apiCache — loading", () => {
    it("shares one in-flight request between callers", async () => {
        const loader = counter(() => ({ data: 1 }));
        await Promise.all([load("k", loader, 10_000), load("k", loader, 10_000), load("k", loader, 10_000)]);
        assert.equal(loader.calls, 1);
        assert.deepEqual(readEntry("k").body, { data: 1 });
    });

    it("serves a fresh entry without a request, refetches a stale one", async () => {
        const loader = counter(() => ({ data: loader.calls }));
        await load("k", loader, 10_000);
        await load("k", loader, 10_000);
        assert.equal(loader.calls, 1);
        await load("k", loader, 0);
        assert.equal(loader.calls, 2);
        assert.deepEqual(readEntry("k").body, { data: 2 });
    });

    it("keeps the last good body when a refetch fails, and retries next time", async () => {
        let fail = false;
        const loader = counter(() => { if (fail) throw new Error("down"); return { data: "ok" }; });
        await load("k", loader, 0);
        fail = true;
        await load("k", loader, 0);
        const entry = readEntry("k");
        assert.deepEqual(entry.body, { data: "ok" });
        assert.ok(entry.error instanceof Error);
        fail = false;
        await load("k", loader, 10_000); // errored entries are never "fresh"
        assert.equal(loader.calls, 3);
        assert.equal(readEntry("k").error, undefined);
    });

    it("notifies subscribers when an entry changes", async () => {
        let notified = 0;
        const unsubscribe = subscribe("k", () => { notified++; });
        await load("k", counter(() => ({ data: 1 })), 0);
        unsubscribe();
        await load("k", counter(() => ({ data: 2 })), 0);
        assert.equal(notified, 1);
    });
});

describe("apiCache — returning to the app", () => {
    it("refetches only watched entries older than the given age", async () => {
        const old = counter(() => ({ data: "old" }));
        const unwatched = counter(() => ({ data: "u" }));
        await load("old", old, 0);
        await load("unwatched", unwatched, 0);
        const unsubscribe = subscribe("old", () => {});

        revalidateActive(60_000);       // everything is younger than a minute
        await tick();
        assert.equal(old.calls, 1);

        revalidateActive(0);
        await tick();
        assert.equal(old.calls, 2);
        assert.equal(unwatched.calls, 1);
        unsubscribe();
    });
});

describe("apiCache — invalidation", () => {
    it("refetches watched keys right away and marks the rest stale", async () => {
        const watched = counter(() => ({ data: "w" }));
        const unwatched = counter(() => ({ data: "u" }));
        await load("watched", watched, 0);
        await load("unwatched", unwatched, 0);
        const unsubscribe = subscribe("watched", () => {});

        invalidateAll();
        await tick();
        assert.equal(watched.calls, 2);
        assert.equal(unwatched.calls, 1);
        // Stale data stays readable (no flash back to a spinner)...
        assert.deepEqual(readEntry("unwatched").body, { data: "u" });
        // ...but the next load goes to the network even inside maxAge.
        await load("unwatched", unwatched, 10_000);
        assert.equal(unwatched.calls, 2);
        unsubscribe();
    });

    it("refetches again when invalidated while a request is in flight", async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        let n = 0;
        const loader = async () => { n++; if (n === 1) await gate; return { data: n }; };
        const unsubscribe = subscribe("k", () => {});
        const first = load("k", loader, 0);
        invalidateAll();          // a write landed while the read was in flight
        release();
        await first;
        await tick();
        await tick();
        assert.equal(n, 2);
        assert.deepEqual(readEntry("k").body, { data: 2 });
        unsubscribe();
    });

    it("clearAll forgets everything (sign-out)", async () => {
        await load("k", counter(() => ({ data: "secret" })), 0);
        clearAll();
        assert.equal(readEntry("k").body, undefined);
    });

    it("a request that started before clearAll cannot repopulate the cache", async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const pending = load("k", async () => { await gate; return { data: "previous user" }; }, 0);
        clearAll();
        release();
        await pending;
        assert.equal(readEntry("k").body, undefined);
    });
});
