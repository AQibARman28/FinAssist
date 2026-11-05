import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { factorState } from "../healthFactor.ts";

describe("factorState", () => {
    it("a factor without data is not counted, never a warning", () => {
        assert.equal(factorState({ score: null }), "uncounted");
        assert.equal(factorState({ score: null, attention: false }), "uncounted");
    });

    it("follows the server's flag, so the icon matches the words", () => {
        // "1 of 2 goals out of reach" averages to 50 but still needs attention.
        assert.equal(factorState({ score: 50, attention: true }), "attention");
        assert.equal(factorState({ score: 30, attention: false }), "ok");
    });

    it("without the flag, falls back to the weak line at 50", () => {
        assert.equal(factorState({ score: 49 }), "attention");
        assert.equal(factorState({ score: 50 }), "ok");
    });
});
