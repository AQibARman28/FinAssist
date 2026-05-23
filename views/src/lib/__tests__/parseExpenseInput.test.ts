import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseExpenseInput, type CategoryOption } from "../parseExpenseInput.ts";

const CATS: CategoryOption[] = [
    { _id: "food", name: "Food" },
    { _id: "transport", name: "Transport" },
    { _id: "entertainment", name: "Entertainment" },
    { _id: "shopping", name: "Shopping" },
    { _id: "bills", name: "Bills" },
    { _id: "healthcare", name: "Healthcare" },
    { _id: "education", name: "Education" },
    { _id: "other", name: "Other" },
];

const parse = (s: string) => parseExpenseInput(s, CATS);

function ymd(d: Date): string {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function shiftedYmd(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return ymd(d);
}

describe("parseExpenseInput — full parse", () => {
    it('"lunch 350 food" -> all four fields', () => {
        const r = parse("lunch 350 food");
        assert.equal(r.amount, 350);
        assert.equal(r.category?.name, "Food");
        assert.equal(r.description, "lunch");
        assert.equal(ymd(r.date), ymd(new Date())); // today
    });

    it('"uber to office 280 yesterday" -> date/category/desc', () => {
        const r = parse("uber to office 280 yesterday");
        assert.equal(r.amount, 280);
        assert.equal(r.category?.name, "Transport");
        assert.equal(r.description, "uber to office");
        assert.equal(ymd(r.date), shiftedYmd(-1));
    });

    it('"1.2k netflix" -> amount 1200, no category', () => {
        const r = parse("1.2k netflix");
        assert.equal(r.amount, 1200);
        assert.equal(r.category, null);
        assert.equal(r.description, "netflix");
    });

    it('"350" -> only amount, description fallback', () => {
        const r = parse("350");
        assert.equal(r.amount, 350);
        assert.equal(r.category, null);
        assert.equal(r.description, "Expense");
    });

    it('"coffee tomorrow" -> null amount blocks commit', () => {
        const r = parse("coffee tomorrow");
        assert.equal(r.amount, null);
        assert.equal(ymd(r.date), shiftedYmd(1));
        assert.ok(r.warnings.includes("No amount detected"));
    });

    it('"had pizza last friday 850" -> date mid-sentence parsed', () => {
        const r = parse("had pizza last friday 850");
        assert.equal(r.amount, 850);
        assert.equal(r.category?.name, "Food");
        assert.equal(r.description, "had pizza");
    });

    it('"groceries 1200" -> synonym maps to Food', () => {
        const r = parse("groceries 1200");
        assert.equal(r.amount, 1200);
        assert.equal(r.category?.name, "Food");
    });
});

describe("parseExpenseInput — suggestions never silently override", () => {
    it("unknown category stays null (user must pick)", () => {
        const r = parse("widget 99");
        assert.equal(r.amount, 99);
        assert.equal(r.category, null);
    });
    it("synonym to a category the user does not own stays null", () => {
        const r = parseExpenseInput("uber 200", [{ _id: "x", name: "Misc" }]);
        assert.equal(r.category, null);
    });
});
