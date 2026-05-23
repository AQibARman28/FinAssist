# GOAL-1 — Cash-Flow-Aware Savings Plan · Plan & Discovery (Phase 0)

**Branch:** `feat/goal-1-savings-plan` — off `feature/initial-scaffolding` (user-confirmed).
**Status:** Phase 0 complete — awaiting "continue" for Phase 1.
**Model note:** brief requests `claude-sonnet-4-6`; Phase 0 done on Opus 4.7 (read-only). Switch via `/model` before code phases if desired.

## 1. Goals data shape (evidence)

`models/Goal.js`:
- `title`/`description` AES-encrypted; `note` RSA. `targetAmount` (>0). **`targetDate` REQUIRED.**
- `goalType` — **fixed enum of 7**: `Emergency Fund | Vacation | Car | House | Education | Investment | Other` (`validators/common.js` `goalTypeEnum`). NOT free-form → emergency detection = `goalType === 'Emergency Fund'`; **no `isEmergencyFund` flag needed**.
- `currentAmount` = Σ`contributions[].amount`, recomputed in a pre-save hook (also auto-flips Active→Completed at 100%). `contributions: [{ amount, date, note }]`.
- `status`: `Active | Completed | Paused`. Virtuals: `progressPercentage`, `remainingAmount`, `daysRemaining`, `isOverdue`.
- `serverAttestation` (ECDSA) covers `{title, targetAmount, goalType}` only — **not contributions**, so adding contributions needs no re-signing.
- **No `priority` field** (Phase 3 adds it).

`controllers/goalController.js`:
- `addContribution` (`POST /:id/contribute`): owner-scoped find → 400 if `Completed` → `contributions.push({amount,note,date})` → `save()`. **Phase 3 `POST /allocate` reuses this logic per goal.**
- `getGoalReminders`: heuristic (overdue / behind-schedule / contribution-reminder) using `daysRemaining`+`progressPercentage`. Phase 4 feeds it real-capacity (feasibility) data.
- `getGoalsDashboard`: totals incl. `totalSavedAmount` (the dashboard "Total Assets" tile).

`validators/goal.js`: create requires `title,targetAmount,targetDate,goalType`; update is partial `.strict()`. **Phase 3 adds `priority` to create + update + the model.**

## 2. Income / expense totaling

`utils/finance.js`: `incomeTotalForPeriod(userId, from, to)` (one-off + recurring, idempotent), `expenseTotalForPeriod(userId, from, to)`. These are the primitives the cash-flow service wraps.

## 3. Shared cash-flow service — ABSENT

HS-1's `services/healthScore.js` is pure scoring; its controller computed income/expense **inline** via the finance.js helpers. **There is no `services/cashFlow.js`.** Phase 1 creates it as the single source of surplus truth. HS-1 *could* later reuse it (optional refactor, out of scope here — noted so we don't duplicate).

## 4. SEC-1 / infra
zod `.strict()` ✓ · IDOR `user: req.user._id` ✓ · `logAudit` ✓ · error sanitization ✓ · `useCurrency()` ✓. Goals page + `GoalCard` currently hardcode `$` → Phase 4 routes through `useCurrency` (documented fix).

## 5. Route ordering (Phase 2/3)
`routes/goalsRoutes.js` order: `/` , `/dashboard`, `/reminders`, then `/:id`*. New `GET /plan`, `GET /allocation-suggestion`, `POST /allocate` MUST be added **before** `/:id` or they'll be shadowed.

---

## 6. Decision log

1. **Branch base:** `feat/goal-1-savings-plan` off `feature/initial-scaffolding`.
2. **Surplus window:** trailing **90 days**; `monthlyAvg = total / (windowDays/30)` (=/3 for 90d); `monthlySurplus = monthlyAvgIncome − monthlyAvgExpenses`.
3. **Cash-flow service:** new `services/cashFlow.js`, `getCashFlow(userId, windowDays=90)` → `{ income, expenses, surplus, monthlyAvgIncome, monthlyAvgExpenses, monthlySurplus }`; pure arithmetic split out + unit-tested; zero-income/zero-expense guarded (no NaN/Infinity).
4. **Feasibility (Phase 2, `services/goalPlanning.js`):** per active goal — `requiredMonthly=(target−current)/max(monthsUntil(targetDate),0.1)`; `actualMonthlyRate`=Σ contributions in last 90d / 3 (null if none); `forecastMonths=(target−current)/actualMonthlyRate` (null if no rate); `forecastDelta` vs targetDate. Status: On track / At risk (50–100% of required, or 1–3mo late) / Not feasible (<50%, >3mo late, or requiredMonthly>monthlySurplus). Undated → flexible (defensive; model forces dates).
5. **Portfolio:** `totalRequired`=Σ requiredMonthly (dated); `overcommitted = totalRequired > monthlySurplus`.
6. **Allocation tiers (Phase 3):** Tier 0 Emergency Fund up to `baseline = 3 × monthlyAvgExpenses` (need = `min(requiredMonthly, gapToBaseline)`); Tier 1 dated goals by soonest `targetDate`; Tier 2 remaining by `priority` (currently a **tiebreaker** among dated goals, since all goals are dated); Tier 3 undated (leftover only — dormant until undated goals exist). Greedy fill up to each `requiredMonthly`; leftover → `freeSurplus`; underfunded dated goals → `{shortfall, extendMonths}` tradeoffs.
7. **Recommend-and-confirm:** `GET /allocation-suggestion` records NOTHING; `POST /allocate` records via the addContribution path, IDOR-checked, `logAudit('goal.allocate')`; over-surplus → `warning` (not blocked). **Tracked intentions, not bank transfers** — UI must say so (honesty constraint).
8. **Advice-line:** allocating the user's own surplus across their own goals only. **No investment-product recommendations anywhere.**
9. **Audience goal seeds (Phase 4 create flow):** title templates mapped to the fixed enum — DPS→Investment, Hajj/Umrah→Other, Wedding→Other, Family support→Other, Land/Flat→House, Child's education→Education — all editable; + a priority control.

## 7. Test strategy
- `cashFlow.test.js`: seed income+expenses/90d → totals + monthly averages; zero-income / zero-expense edges.
- `goalPlanning.test.js` (pure): on-pace→On track; no-contributions→forecast null; ΣrequiredMonthly>surplus→overcommitted; undated/zero-history no NaN; scarce-surplus triage (emergency→deadline→priority); free-surplus; tradeoff math; `POST /allocate` records correct contributions + rejects non-owned.
- Full backend suite stays green; frontend tsc + existing 36 tests green.

## 8. Out of scope (per brief)
Real money movement · investment-product advice · auto/scheduled allocation · surplus/savings-rate trend charts · multi-currency goals · joint goals.
