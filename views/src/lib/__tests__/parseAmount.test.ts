import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAmount } from "../parseAmount.ts";

// Narrow helper: assert ok and return the value.
function value(input: string): number {
    const r = parseAmount(input);
    if (!r.ok) throw new Error(`expected ok for "${input}", got ${r.reason}`);
    return r.value;
}

describe("parseAmount — plain numbers", () => {
    it("integers and decimals", () => {
        assert.equal(value("350"), 350);
        assert.equal(value("12.50"), 12.5);
        assert.equal(value("0.99"), 0.99);
    });
    it("plain numbers are not expressions", () => {
        const r = parseAmount("350");
        assert.equal(r.ok && r.isExpression, false);
    });
});

describe("parseAmount — k/K suffix", () => {
    it("expands ×1000", () => {
        assert.equal(value("1.2k"), 1200);
        assert.equal(value("2K"), 2000);
        assert.equal(value("1.5k+500"), 2000);
    });
});

describe("parseAmount — math expressions", () => {
    it("evaluates arithmetic", () => {
        assert.equal(value("4*250"), 1000);
        assert.equal(value("12.50+8.99"), 21.49);
        assert.equal(value("3500-200"), 3300);
        assert.equal(value("100/4"), 25);
        assert.equal(value("(100+50)*2"), 300);
    });
    it("flags isExpression", () => {
        const r = parseAmount("4*250");
        assert.equal(r.ok && r.isExpression, true);
    });
});

describe("parseAmount — currency symbols", () => {
    it("strips symbols anywhere", () => {
        assert.equal(value("৳350"), 350);
        assert.equal(value("$12.50"), 12.5);
        assert.equal(value("tk 1.2k"), 1200);
    });
});

describe("parseAmount — whitespace", () => {
    it("tolerates surrounding and internal spaces", () => {
        assert.equal(value(" 1.2k + 500 "), 1700);
    });
});

describe("parseAmount — rounding", () => {
    it("rounds to 2 decimals", () => {
        assert.equal(value("100/3"), 33.33);
    });
});

describe("parseAmount — rejections", () => {
    const cases: Array<[string, string]> = [
        ["abc", "invalid"],
        ["1+", "invalid"],
        ["*100", "invalid"],
        ["", "empty"],
        ["   ", "empty"],
        ["-50", "negative"],
        ["0", "invalid"],
    ];
    for (const [input, reason] of cases) {
        it(`rejects ${JSON.stringify(input)} as ${reason}`, () => {
            const r = parseAmount(input);
            assert.equal(r.ok, false);
            if (!r.ok) assert.equal(r.reason, reason);
        });
    }

    it("rejects results over 1e12", () => {
        const r = parseAmount("9999999999999"); // ~1e13
        assert.equal(r.ok, false);
        if (!r.ok) assert.equal(r.reason, "too_large");
    });
});

describe("parseAmount — injection attempts are rejected", () => {
    const attempts = [
        "process.exit()",
        "1; alert(1)",
        "1+console.log",
        "import('x')",
        "createUnit('m')",
        "1e3", // scientific notation contains a letter -> rejected by whitelist
    ];
    for (const input of attempts) {
        it(`rejects ${JSON.stringify(input)}`, () => {
            assert.equal(parseAmount(input).ok, false);
        });
    }
});
