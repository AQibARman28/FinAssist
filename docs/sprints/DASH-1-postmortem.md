# DASH-1 — Spending-Over-Time Curve & Dashboard Chart Switcher · Postmortem

**Branch:** `feat/dash-1-spending-timeline` (stacked on `feat/exp-1-smart-expense-page`).
**Status:** complete — awaiting "merge approved".

## What shipped

| Phase | Commit | Summary |
|---|---|---|
| 0 | `docs(dashboard): DASH-1 plan + discovery` | Mapped the real chart surface (existing chart = category AreaChart, not time-series), confirmed no timeline endpoint, chose the stacked branch base. |
| 1 | `feat(analytics): shared spending-timeline aggregation endpoint` | `GET /api/analytics/spending-timeline` — `$dateTrunc` buckets, `$topN` preview, `maxExpenseId`, decrypted preview descriptions, IDOR, zod validation. 12 tests. |
| 2 | `feat(dashboard): spending-over-time curve with outliers and bucket detail` | `SpendingTimelineChart` + `outliers.ts` (Tukey IQR, small-N guard) + hover tooltip + click-to-pin detail. 5 outlier tests. |
| 3 | `feat(dashboard): bar/pie/line type toggle for existing chart` | `SpendingChart` gains a `chartType` prop (line preserved, bar, category-colored pie) + segmented toggle; tooltip routed through `useCurrency`. |
| 4 | `feat(dashboard): chart switcher integration, responsive, a11y` | `DashboardChartPanel` unifies both graphs under one "Spending Breakdown ↔ Spending Over Time" switcher; wired into the dashboard; responsive + a11y. |

## Shared endpoint note (for EXP-1 Phase 5)

`GET /api/analytics/spending-timeline` is the **shared time-bucketing primitive**. EXP-1
Phase 5 (transaction history page) should consume it rather than building its own
aggregation. It already supports `granularity`, `from`/`to`, `category`, and a
`previewLimit`-bounded top-spender preview per bucket. Phase 5's "expand a bucket to
see all" can reuse the same `GET /expenses?startDate&endDate` pattern the curve's
click-to-pin detail uses. The one thing Phase 5 will add on top: a custom date-range
picker (intentionally out of scope here — dashboard uses default ranges only).

## Architecture notes

- **Outlier detection is client-side** (`flagOutliers`, Tukey upper fence `Q3+1.5·IQR`,
  guard at <5 buckets). It depends on the visible window, so the endpoint stays pure.
- **State is lifted into `DashboardChartPanel`** (view, chart type, granularity), so a
  user's sub-selection survives switching graphs within a session. Switching to the
  timeline refetches it (cheap); the breakdown reuses the dashboard's already-fetched
  summary data (no refetch).
- **`SpendingTimelineChart` is now body-only + controlled granularity** — the panel owns
  the card chrome and both sub-toggles. `SpendingChart` is likewise controlled via a
  `chartType` prop.
- **Currency** everywhere via `useCurrency`; the old hardcoded `$` in `SpendingChart`'s
  tooltip is gone.

## Accessibility & responsive

- All toggles are real `<button>`s with `aria-pressed`, `type="button"`, and visible
  focus rings; toggle groups have `role="group"` + `aria-label`. Chart regions carry
  `aria-label`. The pinned bucket detail is dismissible via its close button **and** the
  Escape key.
- Header wraps on narrow widths; sub-toggle labels collapse to icons (`hidden sm:inline`).
  Pin-to-detail is driven by `onClick`, so it works on touch (tap) where hover is absent.

## Audit log

**None added — confirmed.** All DASH-1 surfaces are read-only views (no create/update/
delete), so no `logAudit` events are appropriate.

## Performance

- Backend seed test: ~100 expenses across 90 days, aggregated per granularity. The
  monthly 90-day case (seed + `$dateTrunc`/`$topN` aggregation + decrypt) completes in
  ~145 ms in `mongodb-memory-server`; the full 12-test timeline suite runs in ~3 s. The
  aggregation itself is the cheap part; preview-description decryption is bounded by
  `previewLimit` (default 8) per bucket.
- `$topN` keeps per-bucket memory bounded regardless of bucket size (vs `$push`-ing all
  rows then slicing).

## Operational note

During testing, a `/spending-timeline` 404 surfaced in the browser. Root cause: the
backend was running as plain `node index.js` (no auto-reload) and predated the Phase 1
route. Lesson: run the API under `nodemon` (`npm run dev`) during multi-phase work so
new routes load without a manual restart. (An unauthenticated probe returns 401 from the
router's `protect` middleware *before* route-matching, so it can't confirm a specific
subpath exists — use an authenticated request to verify route presence.)

## Deferred / out of scope (per brief)

EXP-1 Phases 3–6 · new analytics widgets beyond this panel · custom date-range picker on
the curve (EXP-1 Phase 5 concern) · chart export/download · realtime/streaming updates ·
income overlay on the timeline (expense-only this sprint).
