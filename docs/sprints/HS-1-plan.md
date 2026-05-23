# HS-1 — Dynamic Financial Health Score + Category UX Cleanup · Plan & Discovery (Phase 0)

**Branch:** `feat/hs-1-health-score` — off `feature/initial-scaffolding` (user-confirmed).
**Status:** Phase 0 complete — awaiting "continue" for Phase 1.
**Model note:** brief requests `claude-sonnet-4-6`; Phase 0 done on Opus 4.7 (read-only). Switch via `/model` before code phases if desired.

> Branch-coordination note: the brief assumed EXP-1 and DASH-1 were in-flight/parallel.
> Both are already **merged** into `feature/initial-scaffolding` (EXP-1 Phases 0-2 + all
> of DASH-1), so HS-1 branches cleanly off the integrated line with no conflict.

---

## 1. ⚠ Stuck-at-20 root cause — CONFIRMED (brief's hypothesis REFUTED)

The brief guessed budgets (ObjectId mismatch → no matched budget → ratio>1 → 20). **The
current score never touches budgets.** Evidence:

- `Backend/controllers/aiController.js:162-198` — `financialHealthScore` scores purely on
  income vs current-month expense:
  ```
  const [monthlyIncome, monthlyExpense] = await Promise.all([
      monthlyEquivalentIncome(userId),                 // <-- income source
      expenseTotalForPeriod(userId, start, end),
  ]);
  if (monthlyIncome === 0 && monthlyExpense === 0) score = 100;
  else if (monthlyIncome === 0) score = 20;            // <-- STUCK PATH A
  else { const ratio = monthlyExpense / monthlyIncome;
         if (ratio > 1) score = 20; ... }              // <-- STUCK PATH B
  ```
- `Backend/utils/finance.js:100-110` + comment `:19-24` — `monthlyEquivalentIncome` sums
  **only recurring templates** (`Income.find({ isRecurring: true, parentRecurringId: null })`)
  and explicitly: *"One-off Income entries are intentionally NOT included."*

**Conclusion:** any user whose income isn't a *recurring template* reads `monthlyIncome === 0`
→ **score 20** (Path A, when expenses exist). If recurring income < expenses → ratio>1 →
**score 20** (Path B). No NaN/divide-by-zero (the `=== 0` branch guards it). 

**Fix (Phase 2):** the new model sources income via `incomeTotalForPeriod(userId, windowStart, now)`
(`finance.js:53` — counts one-off **and** recurring over the window), NOT `monthlyEquivalentIncome`.

**Related (real for the NEW budget factor):** `Backend/models/Budget.js:5-8` `category` is still a
**String enum** (`'Food'|...`) while `Expense.category` is an ObjectId ref. So Phase 2's
budget-adherence factor must resolve `Budget.category` (name) → the user's `Category._id` →
sum expenses by that id. The stale `Budget.spent` field is a no-op (its `updateBudgetSpent`
never matches due to the same string/ObjectId gap) — compute spent fresh.

## 2. Data shapes for the new model

- **Income** (`finance.js`): `incomeTotalForPeriod(userId, from, to)` → one-off + materialized
  + projected recurring, idempotent. Use this for savings-rate + expense-to-income.
- **Expense**: `expenseTotalForPeriod(userId, from, to)`. Category is ObjectId ref.
- **Budget** (`Budget.js`): `{ category(String enum), limit, spent(stale), month, year, isActive }`,
  unique per `{user,category,month,year}`. Monthly granularity → for a 90-day window, sum each
  category's `limit` across the overlapping months; match expenses by resolved Category id.
- **Goal** (`Goal.js`): `{ targetAmount, currentAmount(=Σcontributions, derived pre-save),
  targetDate(REQUIRED), status('Active'|'Completed'|'Paused'), contributions[], createdAt }`.
  Goal "start" = `createdAt`. targetDate always present (brief's no-targetDate branch is
  defensive only). Active = `status === 'Active'`.

## 3. Category surfaces — what lives ONLY on the standalone page (must be relocated, not lost)

Standalone page `views/src/app/dashboard/categories/page.tsx` (route `/dashboard/categories`,
nav link `Sidebar.tsx:22` `Tag`/"Categories"):
- **Edit** (rename / recolor / change icon) — modal; `PUT /categories/:id {name,color,icon}`. *(picker lacks this)*
- **Archive** (soft-delete) — `DELETE /categories/:id` (no force). *(picker lacks this)*
- **Force-delete** (only offered for already-archived) — `DELETE /categories/:id?force=true`;
  409 + `refs:{expenses,incomes}` when in use. *(picker lacks this)*
- **Show-archived** toggle (`?includeArchived=true`). *(picker lacks this)*

`CategoryPicker.tsx` today: list-by-type, select, inline "+ New category" (name/color/icon).
Backend already supports everything safely: `categoryController.js` (archive default,
force-delete with ref-count 409) and `validators/category.js` `update` accepts
`name,color,icon,isArchived,sortOrder` (so **un-archive is possible** via `PUT {isArchived:false}`,
though the old page never exposed it). **No backend change needed for Phase 1.**

Deletion nuance: the ref-count check covers Expense + Income (ObjectId refs). **Budgets
reference categories by string name, not ObjectId**, so deleting a Category doesn't orphan a
budget in the ref sense — budget coupling is by name and out of scope here. Documented.

## 4. SEC-1 / infra confirmation
zod `.strict()` ✓ · IDOR `user: req.user._id` ✓ · `logAudit` ✓ (category routes already audit) ·
error sanitization ✓ · `useCurrency()` ✓.

---

## 5. Decision log

1. **Branch base:** `feat/hs-1-health-score` off `feature/initial-scaffolding`.
2. **Scoring window:** trailing **90 days** (`HEALTH_WINDOW_DAYS = 90`) — stable, not daily-swinging.
3. **Income for score:** `incomeTotalForPeriod` over the window (fixes the root cause), not `monthlyEquivalentIncome`.
4. **Factors + weights** (each `{score:0-100|null, weight, label, detail}`; `null`=excluded, weights renormalized over active factors):
   savings-rate **30** · budget-adherence **25** · goal-progress **20** · spending-stability **15** · expense-to-income **10**.
5. **Budget factor matching:** resolve `Budget.category` (name) → `Category._id` → sum window expenses; ignore stale `Budget.spent`; budgets in window = months overlapping the 90 days.
6. **Goal factor:** start=`createdAt`; `expected=clamp((now-start)/(targetDate-start),0,1)`; `actual=current/target`; per-goal `clamp(actual/max(expected,0.01),0,1)×100`; average active goals.
7. **Bands:** 0-39 Needs attention · 40-59 Fair · 60-79 Good · 80-100 Excellent.
8. **Building state:** zero active factors (or only stability with <3 weeks) → `{status:'building', score:null, message}` — **never a misleading 20**.
9. **Math in a pure service** `Backend/services/healthScore.js` (DB-independent, unit-tested at boundaries); controller fetches inputs + calls it.
10. **Category cleanup:** delete the standalone page + nav link; relocate edit/recolor/archive/force-delete/show-archived into `CategoryPicker` as inline per-row affordances; add recently-used-first ordering, type-to-filter, opt-in most-used-30d default pre-select, inline-create auto-select, and an unused-but-documented `suggestedCategoryId` seam (EXP-1 Phase 4). No schema change.

## 6. Test strategy
- **Backend** `Backend/tests/healthScore.test.js` (jest): each factor mapping at boundaries;
  weight renormalization with null factors; all-null → `building`; blended realistic scenario;
  **regression: "no budgets" excludes the budget factor and does NOT yield 20**; "no income"
  handled. Pure service tested without DB.
- **Frontend**: tsc clean; existing 36-test suite stays green (no new frontend unit tests
  required — category UX + widget verified via tsc + the user's live smoke test).

## 7. Out of scope (per brief)
EXP-1 learning categorizer (only the `suggestedCategoryId` seam) · category reassignment-on-delete
(block-with-message only) · DASH-1 work · income-diversification factors · historical score snapshots/trend.
