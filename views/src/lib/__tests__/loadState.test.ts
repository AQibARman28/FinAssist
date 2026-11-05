import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeLoadState } from "../loadState.ts";

const ok = { error: undefined, refreshFailed: false, updatedAt: 1_000 };

describe("summarizeLoadState", () => {
    it("is ok when every read has data and its last refresh worked", () => {
        assert.deepEqual(summarizeLoadState([ok, ok]), { kind: "ok" });
    });

    it("is ok while reads are still loading (no data, no error yet)", () => {
        assert.deepEqual(summarizeLoadState([{ refreshFailed: false }, ok]), { kind: "ok" });
    });

    it("reports failed when a read has nothing to show", () => {
        const failed = { error: new Error("down"), refreshFailed: false };
        assert.deepEqual(summarizeLoadState([ok, failed, failed]), { kind: "failed", count: 2 });
    });

    it("reports stale with the oldest figures' time when only refreshes failed", () => {
        const a = { refreshFailed: true, updatedAt: 5_000 };
        const b = { refreshFailed: true, updatedAt: 3_000 };
        assert.deepEqual(summarizeLoadState([ok, a, b]), { kind: "stale", asOf: 3_000 });
    });

    it("prefers failed over stale: missing figures matter more than old ones", () => {
        const failed = { error: new Error("down"), refreshFailed: false };
        const stale = { refreshFailed: true, updatedAt: 3_000 };
        assert.deepEqual(summarizeLoadState([stale, failed]), { kind: "failed", count: 1 });
    });

    it("leaves the time out of stale if no failed read knows it", () => {
        assert.deepEqual(summarizeLoadState([{ refreshFailed: true }]), { kind: "stale", asOf: undefined });
    });
});
