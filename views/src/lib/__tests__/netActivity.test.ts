import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { retryDelayMs, requestStarted, getActivity, subscribeActivity } from "../netActivity.ts";

describe("retryDelayMs — which failures are worth another try", () => {
    it("retries a read that never got a response, backing off", () => {
        assert.equal(retryDelayMs({ method: "get", status: undefined, attempt: 0 }), 1000);
        assert.equal(retryDelayMs({ method: "get", status: undefined, attempt: 1 }), 3000);
        assert.equal(retryDelayMs({ method: "get", status: undefined, attempt: 2 }), null);
    });
    it("retries reads the gateway couldn't complete (backend waking up)", () => {
        for (const status of [502, 503, 504]) {
            assert.equal(retryDelayMs({ method: "get", status, attempt: 0 }), 1000);
        }
    });
    it("never retries a write — it may already have happened", () => {
        for (const method of ["post", "put", "patch", "delete"]) {
            assert.equal(retryDelayMs({ method, status: undefined, attempt: 0 }), null);
            assert.equal(retryDelayMs({ method, status: 503, attempt: 0 }), null);
        }
    });
    it("doesn't retry answers that another try won't change", () => {
        for (const status of [400, 401, 403, 404, 429, 500]) {
            assert.equal(retryDelayMs({ method: "get", status, attempt: 0 }), null);
        }
    });
    it("doesn't retry a request the app cancelled", () => {
        assert.equal(retryDelayMs({ method: "get", status: undefined, attempt: 0, canceled: true }), null);
    });
});

describe("request activity", () => {
    it("tracks pending requests and the oldest start time", () => {
        assert.equal(getActivity().pending, 0);
        assert.equal(getActivity().since, null);
        const doneA = requestStarted();
        const first = getActivity();
        const doneB = requestStarted();
        assert.equal(getActivity().pending, 2);
        assert.equal(getActivity().since, first.since);
        doneA();
        doneA(); // finishing twice is harmless
        assert.equal(getActivity().pending, 1);
        doneB();
        assert.equal(getActivity().pending, 0);
        assert.equal(getActivity().since, null);
    });
    it("returns the same snapshot until something changes and notifies on change", () => {
        let calls = 0;
        const unsubscribe = subscribeActivity(() => { calls++; });
        const before = getActivity();
        assert.equal(getActivity(), before);
        const done = requestStarted();
        assert.notEqual(getActivity(), before);
        done();
        unsubscribe();
        assert.equal(calls, 2);
    });
});
