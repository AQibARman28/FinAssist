# HS-1 — Dynamic Financial Health Score + Category UX Cleanup · Postmortem

**Branch:** `feat/hs-1-health-score` (off `feature/initial-scaffolding`).
**Status:** complete — awaiting "merge approved".

## What shipped

| Phase | Commit | Summary |
|---|---|---|
| 0 | `docs(analytics): HS-1 plan + discovery` | Root-cause evidence; category-surface map; data shapes; decision log. |
| 1 | `feat(categories): remove standalone management page, inline edit/delete, frictionless picker` | Deleted `/dashboard/categories` + nav link; relocated edit/recolor/archive/force-delete/show-archived into `CategoryPicker`; recently-used-first, type-to-filter, most-used default pre-select, `suggestedCategoryId` seam. |
| 2 | `feat(analytics): dynamic multi-factor financial health score` | Pure `services/healthScore.js` (5 factors, renormalization, bands, building state); endpoint rewrite; `healthScore.test.js`. |
| 3 | `feat(analytics): premium health-score widget with factor breakdown` | Count-up gauge, band color, contributor/detractor line, expandable factor breakdown, building-state CTAs. |
| 4 | `chore(analytics): HS-1 verification + postmortem` | This doc; full-suite verification. |

## Confirmed root cause (the stuck-at-20)

The brief guessed budgets. **Refuted.** The old `financialHealthScore`
(`aiController.js`) scored purely on income-vs-expense, sourcing income from
`monthlyEquivalentIncome` — which by design (`finance.js:19-24`) counts **only
recurring income templates**. So any user whose income wasn't a recurring
template read `income === 0` → the `monthlyIncome === 0 → 20` branch (or
`ratio > 1 → 20`). No budgets, no divide-by-zero — just an income measure that
ignored one-off income.

**Fix:** the new model sources income via `incomeTotalForPeriod` (one-off +
recurring) over the 90-day window. The brief's budget/ObjectId concern was real
but for a *different* surface — the new budget-adherence factor — where
`Budget.category` (String enum) is resolved to the user's `Category` ObjectId to
match expenses (the stale `Budget.spent` is ignored).

## The model

Trailing 90 days. Five factors, each `0-100` or `null` (null = excluded, weights
renormalized over active factors):

| Factor | Weight | Null when |
|---|---|---|
| Savings rate | 30 | no income |
| Budget adherence | 25 | no budgets in window |
| Goal progress | 20 | no active goals |
| Spending stability (CV) | 15 | < 3 weeks of spend data |
| Expense-to-income | 10 | no income |

Composite = round(Σ score·weight / Σ weight) over active factors. Bands: 0-39
Needs attention · 40-59 Fair · 60-79 Good · 80-100 Excellent. Zero active factors
→ `building` status (score `null` + guidance), **never a misleading number**.

## Verification

- Backend: **189/189** (jest). New `healthScore.test.js` covers every factor
  boundary, weight renormalization, all-null→building, a blended composite, and
  the **"no budgets ≠ 20"** + **"one-off income ≠ 20"** regressions.
- Frontend: **tsc clean**, **36/36** (node --test via tsx).

## Manual smoke checklist (auth-gated — for the user)

**Categories**
- The **Categories** sidebar item is gone; no 404s navigating the app.
- Open the category dropdown (Expenses/Income form): hover a row → **edit** +
  **delete**; edit renames/recolors/changes icon; deleting an **in-use** category
  is blocked with the ref-count message and offers **Archive**; deleting an
  unused one removes it; **Show archived** reveals archived rows with un-archive.
- Expenses form **pre-selects** your most-used category (with 30-day history);
  **Recent** group on top; typing **filters**; inline **+ New category**
  auto-selects.

**Health score**
- Score now **moves**: set a budget and stay under → score rises; overspend →
  budget-adherence factor drops; remove all budgets → recomputes on the rest
  (**NOT 20**); a brand-new account shows the **building** state + CTAs.
- "View breakdown" lists factors; data-less ones show "no data yet".

## Deferred / out of scope

- **Category reassignment-on-delete** — this sprint blocks in-use deletion with a
  message (+ archive); reassign-then-delete is a follow-up.
- **EXP-1 Phase 4 suggestion layer** — only the `suggestedCategoryId` seam is in
  place; the learning categorizer that feeds it is a separate track.
- **Income-diversification / historical score snapshots** — future (the latter
  would store daily snapshots to chart the trend).

## Tuning notes

- **Budget window:** budgets are monthly (`{category,month,year}`); the factor
  matches each in-window budget to that category's expenses *in that budget's
  month*. Budgets whose category name no longer resolves to a Category are
  excluded (not counted as 0-spent, which would falsely read as perfect adherence).
- **Spending stability:** CV is computed over weeks that *have* spend (via
  `$dateTrunc`), not all 13 calendar weeks — zero-spend weeks aren't filled in.
  A future refinement could fill gaps between first and last activity to penalize
  intermittent spending; the <3-week guard already protects brand-new accounts.
- **Savings/ratio income** uses the same `incomeTotalForPeriod` window total, so
  the two income-based factors move together; weights (30 vs 10) keep savings
  dominant.
