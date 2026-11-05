import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { moneyFormatter } from "../money.ts";

describe("moneyFormatter — Taka", () => {
    const bdt = moneyFormatter("BDT");

    it("uses the ৳ sign, not the BDT code", () => {
        assert.equal(bdt.format(350), "৳350");
    });

    it("groups in lakhs, as written in Bangladesh", () => {
        assert.equal(bdt.format(123456), "৳1,23,456");
    });

    it("shows paisa only when there are any", () => {
        assert.equal(bdt.format(350.5), "৳350.50");
        assert.equal(bdt.format(350.004), "৳350");
    });

    it("treats a missing amount as zero rather than printing NaN", () => {
        assert.equal(bdt.format(Number.NaN), "৳0");
    });

    it("marks money going out with a minus sign", () => {
        assert.equal(bdt.formatExpense(60), "-৳60");
        assert.equal(bdt.format(-200), "-৳200");
    });

    it("has a short form for chart axes", () => {
        const short = moneyFormatter("BDT", { compact: true }).format(12000);
        assert.ok(short.startsWith("৳"), short);
        assert.ok(short.length < bdt.format(12000).length, short);
    });
});

describe("moneyFormatter — other currencies", () => {
    it("uses the narrow symbol and standard grouping for dollars", () => {
        assert.equal(moneyFormatter("USD").format(1234.5), "$1,234.50");
    });
});
