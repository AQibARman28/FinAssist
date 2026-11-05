// The three steps that get a new account to its first "safe to spend" figure.
// Progress comes from the account's own data, not a stored checklist, so it
// is right on every device and ticks off the moment a step is really done.

export type StepKey = "income" | "spending" | "plan";

export interface OnboardingInput {
    wallet: number;
    recurringIncomes: number;
    incomeThisMonth: number;
    expenses: number;
    budgets: number;
    goals: number;
}

export interface OnboardingState {
    steps: { key: StepKey; done: boolean }[];
    done: number;
    // The first step still to do, or null when all are done.
    next: StepKey | null;
    // Nothing set up at all: the dashboard shows only the start panel.
    firstRun: boolean;
    complete: boolean;
}

export function onboardingState(input: OnboardingInput): OnboardingState {
    const steps: { key: StepKey; done: boolean }[] = [
        // A positive wallet means income was recorded at some point; a negative
        // one only means spending came first.
        { key: "income", done: input.recurringIncomes > 0 || input.incomeThisMonth > 0 || input.wallet > 0 },
        { key: "spending", done: input.expenses > 0 },
        { key: "plan", done: input.budgets > 0 || input.goals > 0 },
    ];
    const done = steps.filter((s) => s.done).length;
    return {
        steps,
        done,
        next: steps.find((s) => !s.done)?.key ?? null,
        firstRun: done === 0,
        complete: done === steps.length,
    };
}
