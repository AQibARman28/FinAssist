import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { onboardingState } from "../onboarding.ts";

const none = { wallet: 0, recurringIncomes: 0, incomeThisMonth: 0, expenses: 0, budgets: 0, goals: 0 };

describe("onboardingState", () => {
    it("is a first run when nothing has been set up", () => {
        const s = onboardingState(none);
        assert.equal(s.firstRun, true);
        assert.equal(s.done, 0);
        assert.deepEqual(s.steps.map((x) => x.done), [false, false, false]);
        assert.equal(s.next, "income");
    });

    it("counts income from a recurring template, this month's income, or a wallet balance", () => {
        assert.equal(onboardingState({ ...none, recurringIncomes: 1 }).steps[0].done, true);
        assert.equal(onboardingState({ ...none, incomeThisMonth: 6000 }).steps[0].done, true);
        assert.equal(onboardingState({ ...none, wallet: 2500 }).steps[0].done, true);
    });

    it("does not count a wallet pushed below zero by spending as income", () => {
        const s = onboardingState({ ...none, wallet: -60, expenses: 1 });
        assert.equal(s.steps[0].done, false);
        assert.equal(s.next, "income");
    });

    it("moves on to the next undone step and stops being a first run", () => {
        const s = onboardingState({ ...none, recurringIncomes: 1 });
        assert.equal(s.firstRun, false);
        assert.equal(s.done, 1);
        assert.equal(s.next, "spending");
    });

    it("takes either a budget or a goal for the last step", () => {
        assert.equal(onboardingState({ ...none, budgets: 2 }).steps[2].done, true);
        assert.equal(onboardingState({ ...none, goals: 1 }).steps[2].done, true);
    });

    it("is complete with all three", () => {
        const s = onboardingState({ ...none, recurringIncomes: 1, expenses: 3, goals: 1 });
        assert.equal(s.done, 3);
        assert.equal(s.complete, true);
        assert.equal(s.next, null);
    });
});
