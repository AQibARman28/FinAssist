import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flagOutliers } from "../outliers.ts";

describe("flagOutliers", () => {
    it("small-N guard: fewer than 5 values -> all false", () => {
        assert.deepEqual(flagOutliers([10, 500]), [false, false]);
        assert.deepEqual(flagOutliers([1, 2, 3, 4]), [false, false, false, false]);
        assert.deepEqual(flagOutliers([]), []);
    });

    it("all-equal values -> no outliers (IQR = 0)", () => {
        assert.deepEqual(flagOutliers([5, 5, 5, 5, 5, 5]), [false, false, false, false, false, false]);
    });

    it("uniform-ish data -> no outliers", () => {
        assert.deepEqual(flagOutliers([10, 11, 12, 13, 14]), [false, false, false, false, false]);
    });

    it("one clear spike -> only the spike flagged", () => {
        const flags = flagOutliers([10, 12, 11, 13, 9, 500]);
        assert.deepEqual(flags, [false, false, false, false, false, true]);
    });

    it("preserves input order/length", () => {
        const input = [9, 500, 10, 11, 12, 13];
        const flags = flagOutliers(input);
        assert.equal(flags.length, input.length);
        assert.equal(flags[1], true);  // the 500, in its original position
        assert.equal(flags[0], false);
    });
});
