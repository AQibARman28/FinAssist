import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDay, monthSoFar } from "../dates.ts";

// Local noon on 5 Nov 2026: "now" in every test, whatever the machine's zone.
const NOW = new Date(2026, 10, 5, 12, 0, 0);

describe("formatDay", () => {
    it("reads a date-only entry (stored as UTC midnight) as that calendar day", () => {
        assert.equal(formatDay("2026-11-02T00:00:00.000Z", NOW), "Mon 2 Nov");
    });

    it("says Today and Yesterday", () => {
        assert.equal(formatDay(new Date(2026, 10, 5, 9, 30).toISOString(), NOW), "Today");
        assert.equal(formatDay("2026-11-04T00:00:00.000Z", NOW), "Yesterday");
    });

    it("adds the year outside the current one", () => {
        assert.equal(formatDay("2025-12-31T00:00:00.000Z", NOW), "31 Dec 2025");
    });

    it("never shows a time of day", () => {
        assert.doesNotMatch(formatDay("2026-11-03T00:00:00.000Z", NOW), /\d:\d\d/);
    });
});

describe("monthSoFar", () => {
    it("names the days of this month covered so far", () => {
        assert.deepEqual(monthSoFar(NOW), { day: 5, days: 30, label: "1–5 Nov" });
    });

    it("handles the first of the month", () => {
        assert.equal(monthSoFar(new Date(2026, 11, 1, 8)).label, "1 Dec");
    });
});
