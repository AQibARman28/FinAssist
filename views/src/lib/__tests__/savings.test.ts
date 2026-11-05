import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { savingsByMonth } from "../savings.ts";

// Local noon on 5 Nov 2026 is "now" in every test, whatever the machine's zone.
const NOW = new Date(2026, 10, 5, 12);
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 15, 30).toISOString();

describe("savingsByMonth", () => {
    it("gives the closing balance of each of the last months, oldest first", () => {
        const rows = savingsByMonth([
            { amount: 1000, direction: "deposit", date: at(2026, 8, 10) },
            { amount: 500, direction: "deposit", date: at(2026, 10, 2) },
            { amount: 200, direction: "withdraw", date: at(2026, 10, 20) },
            { amount: 300, direction: "deposit", date: at(2026, 11, 3) },
        ], NOW, 4);
        assert.deepEqual(rows.map((r) => r.key), ["2026-08", "2026-09", "2026-10", "2026-11"]);
        assert.deepEqual(rows.map((r) => r.closing), [1000, 1000, 1300, 1600]);
        assert.deepEqual(rows.map((r) => r.net), [1000, 0, 300, 300]);
        assert.equal(rows[3].label, "Nov");
        assert.equal(rows[3].title, "November 2026");
    });

    it("counts entries from before the window in the first month's balance", () => {
        const rows = savingsByMonth([{ amount: 800, direction: "deposit", date: at(2025, 1, 4) }], NOW, 2);
        assert.deepEqual(rows.map((r) => r.closing), [800, 800]);
        assert.deepEqual(rows.map((r) => r.net), [0, 0]);
    });

    it("places a month-end transfer dated at UTC midnight on its own day", () => {
        // A rollover saved at the start of November is stored as 1 Nov 00:00 UTC.
        const rows = savingsByMonth([{ amount: 400, direction: "deposit", date: "2026-11-01T00:00:00.000Z" }], NOW, 2);
        assert.deepEqual(rows.map((r) => r.closing), [0, 400]);
    });
});
