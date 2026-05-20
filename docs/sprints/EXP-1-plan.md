# EXP-1 — Smart Expense Entry & Transaction History · Plan & Discovery (Phase 0)

**Branch:** `feat/exp-1-smart-expense-page` (created from `feature/initial-scaffolding`).
**Status:** Phase 0 complete — awaiting "continue" for Phase 1.

> **Path correction:** the brief references `frontend/src/...`. This repo's
> frontend lives in **`views/src/...`**. All paths below use the real location.

---

## 1. SEC-1 dependency check — all present ✓

| Dependency | Evidence |
|---|---|
| zod installed + `.strict()` validators | `Backend/validators/expense.js` (create/update/list/summaryParams) |
| IDOR scoping (`user: req.user._id`) | `expenseController.js` — every read/write filters on `user`; updates use `findOneAndUpdate({ _id, user })` |
| Mass-assignment whitelist | enforced via zod `.strict()` create/update schemas (not a separate allow-list) |
| Audit log helper | `Backend/utils/audit.js` → `module.exports = { logAudit, KNOWN_EVENTS }` |
| Error sanitization middleware | global handler mounted in `Backend/index.js` (SEC-1) |

SEC-1 is merged into the working line. **No halt required on SEC-1 grounds.**

---

## 2. ⚠ Coordination problem — the brief assumes a *pre-INC-1* codebase

INC-1 (user-owned categories + income, already merged) changed the expense
foundations the brief was written against. This is the EXP-1 analogue of the
"halt and surface" clause in the brief's Phase 0.

| Brief assumes | Actual state (post-INC-1) | Source |
|---|---|---|
| 8 hardcoded String categories | **User-owned `Category` collection**, ObjectId refs, typed `expense\|income\|both` | `models/Expense.js:12`, `models/Category.js` |
| Keyword auto-categorization exists | **Removed in INC-1 Part 3** | `expenseController.js:19-23` |
| `isAutoCategories` field | **Removed** | `models/Expense.js` (absent) |
| `category` is a String enum | `category` is `ObjectId ref 'Category'`, guarded by `assertCategoryOwnedAndTyped` | `validators/expense.js:12-20`, `utils/categoryGuard.js` |
| Branch from `main` | stale `origin/main` lacks SEC-1+INC-1; integrated line is `feature/initial-scaffolding` (origin/HEAD) | `git branch -a` |

**Decision taken (user-approved):**
- **Phase 4 = suggestion-only.** Learn from the user's category corrections and
  *surface* a suggested category (pre-highlight it in the picker / quick-add
  preview), but **never silently auto-assign**. No revival of `isAutoCategories`.
  This preserves INC-1's "categorization is an explicit user choice" rule while
  still delivering the learning + confidence-indicator value of the brief.
- **Branch base = `feature/initial-scaffolding`** (NOT `origin/main`, which would
  drop SEC-1 + INC-1).

---

## 3. Component inventory (expense UI today)

| File | Role |
|---|---|
| `views/src/app/dashboard/expenses/page.tsx` | Expenses page. Stat cards (Total Spent / Current Month / Daily Avg) + `ExpenseForm` + `ExpenseList`. Stats from `/expenses/summary/:y/:m`. |
| `views/src/components/dashboard/expenses/ExpenseForm.tsx` | Detailed add form: description, amount (`type=number`), date, `CategoryPicker(type=expense)`, private note. |
| `views/src/components/dashboard/expenses/ExpenseList.tsx` | "Transaction History" list — fetches `/expenses?limit=100` + categories, builds `_id→{name,color,icon}` map, delete button. **List is effectively current-window (see §6).** |
| `views/src/components/CategoryPicker.tsx` | Shared category dropdown w/ inline "+ New category" create. Used by expense + income forms. |
| `views/src/components/dashboard/RecentTransactions.tsx` | Dashboard-overview recent list (presentational; takes `transactions` prop). |
| `views/src/lib/categoryIcons.tsx` | `iconFor`, `CATEGORY_ICONS`, color/icon constants. |
| `views/src/lib/useCurrency.ts` | **NEW (Phase 0)** — `{ currency, format, formatExpense }` bound to `user.currency`. |

## 4. API inventory (`Backend/routes/expenseRoutes.js`, all behind `protect`)

| Method · Path | Validator | Request | Response |
|---|---|---|---|
| `GET /api/expenses` | `expense.list` | query: `page?`, `limit?`, `category?`(ObjectId), `startDate?`, `endDate?` | `{ success, data: Expense[], pagination:{page,limit,total,pages} }` — descriptions decrypted; sorted `date` desc. Calls `materializeRecurring` (no-op for Expense today). |
| `POST /api/expenses` | `expense.create` | body: `amount`, `category`(ObjectId), `description`, `date?`, `note?` | `201 { success, data: Expense }`. Runs `assertCategoryOwnedAndTyped(user,category,'expense')`; encrypts description (AES-GCM) + note (RSA-OAEP); signs `serverAttestation` (ECDSA). |
| `GET /api/expenses/:id` | `idParams` | — | `{ success, data: Expense }` (404 if not owner) |
| `PUT /api/expenses/:id` | `idParams` + `expense.update` | partial body | `{ success, data: Expense }`. Re-guards category if changed. `serverAttestation` NOT regenerated. |
| `DELETE /api/expenses/:id` | `idParams` | — | `{ success, message }` |
| `GET /api/expenses/summary/:year/:month` | `summaryParams` | params | `{ success, data:{ month, year, totalSpent, summary:[{categoryId, category(name), categoryColor, categoryIcon, amount, count, percentage}] } }` ($lookup for names). |

`Expense` doc shape: `{ _id, user, amount, category(ObjectId), description(decrypted on read), date, note(decrypted|null), serverAttestation?, parentRecurringId, createdAt, updatedAt }`.

---

## 5. Decision log

1. **Expense list scope:** main `/dashboard/expenses` list → **recent 30 by `date` desc, regardless of month** (Phase 6 task #1). Stat cards (total spent, daily avg, count) **remain current-calendar-month scoped** via `/expenses/summary`. This divergence is intentional. *Today the list fetches `limit=100` with no date filter, which the recurring-materialization window doesn't bound — Phase 6 will tighten to "recent 30".*
2. **History page route:** `/dashboard/expenses/history` (Phase 5).
3. **Currency:** read from `user.currency` everywhere via the new `useCurrency()` hook. **Applied in Phase 0** to the three hardcoded-`$` spots (`expenses/page.tsx`, `ExpenseList.tsx`, `RecentTransactions.tsx`); analytics widgets already use the inline Intl pattern. Phase 6 verifies full coverage.
4. **Path correction:** `frontend/` → `views/` throughout.
5. **Branch base:** `feature/initial-scaffolding` (see §2).
6. **Phase 4 = suggestion-only** (see §2).
7. **Schema additions deferred to their phases:** `externalTrxId` + `paymentProvider` (Phase 3, additive + zod `.strict()` update); learning lives in a new `CategoryLearning` collection keyed by `categoryId` not a String enum (Phase 4).

---

## 6. Per-phase adaptation notes (given INC-1)

- **Phase 1 (amount parser):** unaffected — pure utility in `views/src/lib/parseAmount.ts`. Wire into `ExpenseForm` amount field. Install `mathjs` in `views`.
- **Phase 2 (NL quick-add):** category matching resolves against the **user's actual categories** (already a param) → returns a `categoryId | null`. The brief's hardcoded 8-name list + synonym map become *seed synonyms* matched by category **name**; unmatched → null (user picks). `ExpenseCategory` type no longer exists — use `{ _id, name }[]`.
- **Phase 3 (SMS paste):** confirm-modal category field **reuses `CategoryPicker(type=expense)`**. Add `externalTrxId` (sparse, per-user unique) + `paymentProvider` to `Expense` + zod schemas. **Needs real bKash/Nagad/Rocket sample SMS — see §8 (blocking for Phase 3).**
- **Phase 4 (learning):** `CategoryLearning { userId, token, categoryId(ref), weight, lastUsed }`, compound-unique `(userId, token, categoryId)`. `suggest()` returns a `categoryId` + source/confidence; **the client pre-selects it but the user must confirm** (no server-side auto-assign). `learn()` fires on create/update when the user picks/changes a category.
- **Phase 5 (history):** category filter is by ObjectId(s); bucket previews `$lookup` category names; descriptions decrypted post-aggregation (search = slow path, documented). `$dateTrunc` for buckets.
- **Phase 6 (polish):** recent-30 list change; currency coverage check; optimistic updates + undo; a11y; audit-log wiring (`expense.create|update|delete|recategorize`).

---

## 7. Test strategy

- **Unit (frontend, jest):** `parseAmount` (incl. injection rejection), `parseExpenseInput`, `paymentSmsParser` (≥3 real samples/provider).
- **Integration (backend, jest + mongodb-memory-server):** `/expenses/history` aggregation (seed 100 expenses / 90 days, all four granularities), IDOR boundary (user A never sees user B), learning categorizer ("starbucks→Bills learned over keyword"), tokenizer stopword/short-token stripping.
- Force indexes in `beforeAll` via `Model.init()` (established INC-1 pattern).

## 8. Open items / blockers

- **Phase 3 SMS samples (BLOCKING for Phase 3, not earlier):** need 3–5 real
  bKash / Nagad / Rocket SMS strings per provider. Do **not** invent formats.
  Drop them into `Backend/tests/fixtures/sample-sms.txt` before Phase 3 starts.
- **Repo hygiene (pre-existing, not EXP-1 scope):** `Backend/node_modules/.package-lock.json`
  is tracked — node_modules should be gitignored. Flagged, not fixed here.
- **Follow-up (out of scope, per brief):** `CategoryLearning` periodic cleanup
  (drop weight=1 rows older than 90 days).
