import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { axisNumber, barPath, niceMax } from "../chart.ts";

describe("niceMax", () => {
    it("rounds up to the next round step", () => {
        assert.equal(niceMax(1130), 1200);
        assert.equal(niceMax(41000), 50000);
        assert.equal(niceMax(2500), 2500);
        assert.equal(niceMax(7), 8);
    });
    it("never goes below the floor", () => {
        assert.equal(niceMax(0, 100), 100);
        assert.equal(niceMax(30, 100), 100);
    });
});

describe("barPath", () => {
    it("draws nothing for a bar with no height", () => {
        assert.equal(barPath(0, 50, 10, 50), "");
    });
    it("keeps the corner radius inside a short bar", () => {
        assert.equal(barPath(0, 48, 10, 50), "M0 50V50Q0 48 2 48H8Q10 48 10 50V50Z");
    });
});

describe("axisNumber", () => {
    // A 2.5K scale has its middle line at 1,250; "1.3K" would misstate it.
    it("labels a half-step exactly", () => {
        assert.equal(axisNumber.format(1250), "1.25K");
        assert.equal(axisNumber.format(2500), "2.5K");
        assert.equal(axisNumber.format(40000), "40K");
    });
});
