# DASH-1 — Spending-Over-Time Curve & Dashboard Chart Switcher · Plan & Discovery (Phase 0)

**Branch:** `feat/dash-1-spending-timeline` — **stacked on `feat/exp-1-smart-expense-page`** (user-chosen Option B).
**Status:** Phase 0 complete — awaiting "continue" for Phase 1.
**Model note:** brief requests `claude-sonnet-4-6`; Phase 0 was done on Opus 4.7 (read-only discovery). User to switch via `/model` before code phases if desired.

> Branch stacking caveat: DASH-1 history sits on top of unmerged EXP-1 Phases 0-2.
> Both tracks stay entangled until EXP-1 merges. `useCurrency()` and the expense
> surface come along for free because they already exist on the EXP-1 branch.

---

## 1. Dashboard component inventory (`views/src/app/dashboard/page.tsx`)

| Component | Kind | Notes |
|---|---|---|
| `StatCard` ×4 (Total Assets, Income, Monthly Spend, Recent Activity) | stat tile | not a chart |
| **`SpendingChart`** | **CHART** | the single dashboard chart — see §2 |
| `RecentTransactions` | list | not a chart |

The analytics-rework components (`SpendingComparisonChart`, `DashboardStatsStrip`,
`ExpenseIncomeRatio`, `HighSpendingAlerts`, `RecurringIncomeList`, `StatTile`) live
on the **analytics page**, NOT the dashboard. DASH-1 touches only the dashboard's
`SpendingChart`.

## 2. The existing chart — data-shape finding (no assumptions)

`SpendingChart.tsx` is a Recharts **`AreaChart`** (`type="monotone"`, stroke `#a855f7`
width 3, gradient `id=colorAmount` purple 0.3→0). It is **category-based, not
time-based**:

- **Data source:** `GET /expenses/summary/:year/:month` (current month).
- **Shape consumed:** `data.summary[]` mapped in `page.tsx` to `{ name: categoryName, amount }`.
  - The summary endpoint also returns `categoryId`, `categoryColor`, `categoryIcon`,
    `count`, `percentage` per row — but `page.tsx` currently **drops color/icon** in
    its `.map`. Phase 3's pie needs `categoryColor`, so the mapping will be enriched
    to carry it through (no endpoint change required).
- **Quirk:** the tooltip hardcodes `` `$${value}` `` (line 49). Phase 3 routes this
  through `useCurrency()` (a fix, documented; the area/line *visual* is otherwise
  preserved byte-for-byte).

**Implication for Phase 3:** dataset is category-based → bar / pie / line are all
natural (pie = one slice per category, colored by `categoryColor`). No data invention.

## 3. Analytics API inventory (`Backend/routes/analyticsRoutes.js`, all behind `protect`)

| Path | Returns |
|---|---|
| `GET /monthly-analytics?year&month` | current vs prev month by category (+ MoM delta/pct) |
| `GET /recurring-expenses` | deprecated, `{ data: [], deprecated: true }` |
| `GET /recurring-income` | recurring income templates + monthly equivalents |
| `GET /high-spending` | categories whose 3-mo total > 1.5× mean |
| `GET /expense-income-ratio` | `{ totalIncome, totalExpense, ratio }` |
| `GET /savings-rate` | month savings rate + daily average |
| `GET /dashboard-stats` | one-shot header strip (income/expense/savings/MoM/topCategories) |

Existing analytics endpoints **parse `req.query` manually** (no zod). The expense
routes use `validate({ query, body, params })` with zod `.strict()`.

**Reusable helpers in `analyticsController.js`:** `getMonthDateRange(y,m)` (UTC bounds),
`CATEGORY_LOOKUP_STAGES` (join `_id`→categories; only fits group-by-category, NOT the
timeline's group-by-bucket, so Phase 1 writes a dedicated per-row category `$lookup`).
Description decryption: `safeDecrypt(cipher, req.dataKey)` (as in `expenseController`).

**No `spending-timeline` endpoint exists** → Phase 1 builds `GET /api/analytics/spending-timeline`
as the **shared primitive that EXP-1 Phase 5 (history page) will reuse**.

## 4. SEC-1 / infra confirmation

zod `.strict()` ✓ · IDOR `user: req.user._id` ✓ · `logAudit`/`KNOWN_EVENTS` ✓ (none
needed — read-only views) · error sanitization ✓ · `views/src/lib/useCurrency.ts` ✓ ·
`Category.color`(hex)/`.icon`(enum) ✓.

**Dependency:** the timeline pipeline uses `$dateTrunc` (MongoDB 5.0+). Atlas is
assumed 5+; if a seed/integration test errors on `$dateTrunc`, that's the signal to
check the cluster version.

---

## 5. Decision log

1. **Branch base:** `feat/dash-1-spending-timeline` off `feat/exp-1-smart-expense-page` (stacked, Option B).
2. **Shared endpoint:** `GET /api/analytics/spending-timeline` (Phase 1) — zod `.strict()`
   query via `validate()` (consistency upgrade over the manual-parse analytics endpoints).
   EXP-1 Phase 5 reuses it.
3. **Granularity model:** `daily` (last 30d), `weekly` (last 12 ISO weeks, Mon–Sun via
   `$dateTrunc startOfWeek:'monday'`), `monthly` (last 12mo), `yearly` (all years with
   data). Buckets sorted **ascending** (chronological x-axis for the curve).
4. **Per-bucket payload:** `total`, `count`, up to `previewLimit` (default 8, max 50)
   `topExpenses` (amount-desc, descriptions decrypted server-side, category name/color/icon
   via `$lookup`), `maxExpenseId` (largest single expense), `hasMore`.
5. **Outlier rule (client-side, `views/src/lib/outliers.ts`):** Tukey IQR — compute Q1,
   Q3 over the visible bucket totals; `upperFence = Q3 + 1.5·IQR`; bucket is an outlier
   iff `total > upperFence`. **Small-N guard: `totals.length < 5` → all-false.** Computed
   client-side because it depends on the visible window; endpoint stays pure (no outlier math).
6. **Hover detail:** glassmorphism `<Tooltip>` — bucket label, total (gold via `useCurrency`),
   count, then `topExpenses` rows (description + category chip + amount); the row with
   `_id === maxExpenseId` flagged red (red text + red left-border). If `hasMore`: "+N more — click to see all".
7. **Click-to-pin:** `TimelineBucketDetail` card below the chart lists ALL expenses for the
   pinned bucket — if the bucket exceeds `previewLimit`, fetch the full list via
   `GET /expenses?startDate&endDate` with the bucket bounds. Max flagged red, scrollable,
   close to unpin. (Touch: tap-to-pin since hover is unavailable.)
8. **Phase 3 modes:** line/area = current look preserved; bar = purple bars same dataset;
   pie = slice per category colored by `categoryColor`. Segmented type toggle + granularity
   toggle share one visual style; Framer Motion transitions.
9. **Phase 4 container:** `DashboardChartPanel` with top switcher "Spending Breakdown" ↔
   "Spending Over Time"; each graph keeps its own sub-toggle; state preserved within session.
   Replaces the standalone `SpendingChart` in `page.tsx` in-place.

## 6. Test strategy

- **Backend (`Backend/tests/`):** seed ~100 expenses across 90 days; assert bucket
  counts/totals for daily/weekly/monthly/yearly; `topExpenses` capped at `previewLimit`
  and amount-desc; `maxExpenseId` = largest; category filter; zod rejects bad granularity /
  non-ObjectId category; **IDOR** (user A never sees user B's buckets). Force indexes via
  `Model.init()` in `beforeAll`.
- **Frontend (`outliers.test.ts`, node:test + tsx):** Tukey math, small-N (<5) guard,
  all-equal → none, single clear spike → flagged.

## 7. Out of scope (per brief)
EXP-1 Phases 3–6 · new analytics widgets · custom date-range picker on the curve ·
chart export · realtime/streaming · income overlay on the timeline.
