# GOAL-1 — Cash-Flow-Aware Savings Plan · Postmortem

**Branch:** `feat/goal-1-savings-plan` (off `feature/initial-scaffolding`).
**Status:** complete — awaiting "merge approved".

## What shipped

| Phase | Commit | Summary |
|---|---|---|
| 0 | `docs(goals): GOAL-1 plan + discovery` | Goals/income shapes; absence of a cash-flow service; decision log. |
| 1 | `feat(goals): shared cash-flow/surplus service` | `services/cashFlow.js` (`getCashFlow` + pure `summarizeCashFlow`). |
| 2 | `feat(goals): feasibility + forecast engine` | Pure `services/goalPlanning.js` + `GET /goals/plan`. |
| 3 | `feat(goals): surplus allocation decider (recommend-and-confirm)` | `allocateSurplus` + `GET /allocation-suggestion` + `POST /allocate`; `Goal.priority`. |
| 4 | `feat(goals): savings-plan UI with feasibility, forecast, and decider` | Surplus header, per-goal badges/forecast, the decider card, audience seeds + priority. |
| 5 | `chore(goals): GOAL-1 verification + postmortem` | This doc; full-suite verification. |

## Shared cash-flow service (for HS-1 reuse)

`services/cashFlow.js` is the **single source of surplus truth**:
`getCashFlow(userId, windowDays=90)` → `{ income, expenses, surplus,
monthlyAvgIncome, monthlyAvgExpenses, monthlySurplus }`, wrapping
`finance.js`'s `incomeTotalForPeriod` + `expenseTotalForPeriod`; arithmetic in a
pure `summarizeCashFlow`. **HS-1's savings-rate factor currently computes
income/expense inline** in its controller — it can be refactored to call
`getCashFlow` for one source of truth (deferred, no behavior change).

## Allocation algorithm + tiers

`allocateSurplus({ goals, monthlySurplus, monthlyAvgExpenses })`:
- **Tier 0 — Emergency Fund** (`goalType === 'Emergency Fund'`): fund up to
  `baseline = 3 × monthlyAvgExpenses`; need = `min(requiredMonthly, gapToBaseline)`.
- **Tier 1 — dated goals** by soonest `targetDate` (priority desc tiebreak).
- **Tier 2/3 — undated** by priority / leftover (dormant: the model requires a
  `targetDate`, so `priority` currently acts as a Tier-1 tiebreaker).
- Greedy-fill each up to its monthly need; leftover → `freeSurplus`; underfunded
  dated goals → `{ shortfall, extendMonths }` (extendMonths null when nothing
  was allocated).

**Recommend-and-confirm:** `GET /allocation-suggestion` records nothing;
`POST /allocate` validates every goal is user-owned + active up front (404/400,
records nothing on a bad request), then records each via the same push+save
contribute path; over-surplus returns a `warning` (never blocks);
`logAudit('goal.allocate')`. **Honesty:** allocations are tracked goal
contributions, not money movement — the UI says so. **Advice line:** no
investment-product recommendation anywhere.

## Status classification (resolved ambiguity)

The brief's status conditions overlap (a 50%-rate goal is also "many months
late"). Resolved with **rate-ratio primary**: ≥100% On track · 50–100% At risk ·
<50% Not feasible · `requiredMonthly > monthlySurplus` → Not feasible; forecast
lateness only *worsens* an otherwise on-track goal.

## Verification

- Backend **209/209** (jest): `cashFlow.test.js` (arithmetic + DB + zero edges),
  `goalPlanning.test.js` (status boundaries, portfolio overcommitted, triage,
  free-surplus, tradeoff math, `GET /plan`, `POST /allocate` records + rejects
  non-owned).
- Frontend **tsc clean + 36/36** (node --test/tsx).

## Manual smoke checklist (auth-gated — for the user)

- Set income + expenses for a surplus → Savings Plan header shows surplus /
  committed / free; per-goal cards show feasibility badge + forecast.
- Create goals exceeding surplus → header/decider show overcommitted + tradeoffs.
- Open the decider → adjust the proposed split → **Confirm** → contributions
  recorded; progress bars update; reopening reflects the new state.
- An Emergency-Fund goal is prioritized to the 3× baseline before others.
- Nothing is recorded until Confirm is pressed.
- Amounts reflect the profile currency; "no income" shows the building state.

## Deferred / tuning notes

- **`/goals/reminders` not rewired** — it has no frontend consumer today, so
  feeding it feasibility data would be invisible. The per-goal cards now carry
  the real-capacity signal (badge + forecast). Rewiring/ surfacing reminders is a
  follow-up.
- **HS-1 → cashFlow refactor** (one surplus source) — deferred.
- **Undated/flexible goals** — the model requires `targetDate`; the undated code
  paths are defensive. Making `targetDate` optional (true flexible goals,
  activating Tiers 2/3) is a future option.
- **Month length** = 30 days throughout (consistent with cashFlow's `/30`); good
  enough for planning UI, not calendar-exact.
- Out of scope (per brief): real money movement, investment advice, auto/scheduled
  allocation, surplus trend charts, multi-currency goals, joint goals.
