import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    statusTone, statusLabel, formatMonths, describeForecast,
    parseAllocationInput, suggestionToInputs, buildAllocations, allocationTotal,
    priorityLevel,
} from "../goalPlanModel.ts";

const base = { currentAmount: 0, targetAmount: 12_000 };

describe("goal plan status", () => {
    it("maps the three server statuses to tones", () => {
        assert.equal(statusTone("On track"), "good");
        assert.equal(statusTone("At risk"), "warn");
        assert.equal(statusTone("Not feasible at current rate"), "bad");
        assert.equal(statusTone(undefined), "neutral");
    });
    it("shortens the not-feasible label for the badge", () => {
        assert.equal(statusLabel("Not feasible at current rate"), "Not feasible");
        assert.equal(statusLabel("On track"), "On track");
        assert.equal(statusLabel(null), "No plan");
    });
});

describe("formatMonths", () => {
    it("never renders NaN", () => {
        assert.equal(formatMonths(Number.NaN), "—");
        assert.equal(formatMonths(-1), "—");
    });
    it("rounds months and switches to years past 24", () => {
        assert.equal(formatMonths(0.4), "<1 mo");
        assert.equal(formatMonths(7.6), "8 mo");
        assert.equal(formatMonths(30), "2.5 yr");
    });
});

describe("describeForecast", () => {
    it("null forecast → no-history wording, not NaN", () => {
        const f = describeForecast({ ...base, forecastMonths: null, forecastDelta: null });
        assert.match(f.text, /No forecast yet/);
        assert.equal(f.tone, "neutral");
    });
    it("late by more than 3 months → bad", () => {
        const f = describeForecast({ ...base, forecastMonths: 20, forecastDelta: 8 });
        assert.equal(f.text, "Done in ~20 mo · ~8 mo late");
        assert.equal(f.tone, "bad");
    });
    it("slightly late → warn; early → good; ~0 → on schedule", () => {
        assert.equal(describeForecast({ ...base, forecastMonths: 14, forecastDelta: 2 }).tone, "warn");
        assert.match(describeForecast({ ...base, forecastMonths: 10, forecastDelta: -2 }).text, /early/);
        assert.match(describeForecast({ ...base, forecastMonths: 12, forecastDelta: 0.2 }).text, /on schedule/);
    });
    it("undated goal with a rate shows only the finish estimate", () => {
        assert.equal(describeForecast({ ...base, forecastMonths: 5, forecastDelta: null }).text, "Done in ~5 mo");
    });
    it("fully funded goal says so", () => {
        assert.equal(describeForecast({ currentAmount: 500, targetAmount: 500, forecastMonths: null, forecastDelta: null }).text, "Fully funded");
    });
});

describe("allocation form helpers", () => {
    it("parses only positive amounts", () => {
        assert.equal(parseAllocationInput(""), null);
        assert.equal(parseAllocationInput("0"), null);
        assert.equal(parseAllocationInput("-5"), null);
        assert.equal(parseAllocationInput("abc"), null);
        assert.equal(parseAllocationInput(" 1,250.5 "), 1250.5);
        assert.equal(parseAllocationInput("10.129"), 10.13);
    });
    it("prefills inputs from the suggestion, blank when 0", () => {
        assert.deepEqual(
            suggestionToInputs([{ goalId: "a", suggested: 5000 }, { goalId: "b", suggested: 0 }]),
            { a: "5000", b: "" },
        );
    });
    it("builds the POST body with only amount > 0 rows, in goal order", () => {
        const goals = [{ goalId: "a" }, { goalId: "b" }, { goalId: "c" }];
        const rows = buildAllocations(goals, { a: "100", b: "", c: "50.5" });
        assert.deepEqual(rows, [{ goalId: "a", amount: 100 }, { goalId: "c", amount: 50.5 }]);
        assert.equal(allocationTotal(rows), 150.5);
        assert.deepEqual(buildAllocations(goals, {}), []);
    });
});

describe("priorityLevel", () => {
    it("snaps stored ints onto Normal/High/Top", () => {
        assert.equal(priorityLevel(undefined), 0);
        assert.equal(priorityLevel(0), 0);
        assert.equal(priorityLevel(1), 1);
        assert.equal(priorityLevel(2), 2);
        assert.equal(priorityLevel(700), 2);
    });
});
