# Sprint SEC-1 — Discovery & Plan

**Branch:** `feat/sec-1-native-crypto-hardening` (off `feature/initial-scaffolding`)
**Date:** 2026-05-20
**Author:** Phase 0 discovery — no code changes yet.

---

## 0. Layout reconciliation (brief vs reality)

The sprint brief named `Backend/python_crypto/`. The actual layout is:

| Brief said | Reality |
|---|---|
| `Backend/python_crypto/` | `Backend/utils/scratch_python/` (9 `.py` files + `crypto_cli.py`) |
| (not mentioned) | `Backend/utils/scratch/` (parallel **JS** implementations + `__test_*.js` files) — present but unused in the request path; the request path uses Python via `pyCrypto.js` |
| (not mentioned) | `Backend/routes/goalRoutes.js` exists alongside `goalsRoutes.js`; only `goalsRoutes.js` is mounted (`index.js:62`). `goalRoutes.js` is dead code. |
| `main` / `master` branch base | Current branch was `feature/initial-scaffolding`. Sprint branch was cut from there. No `main` exists locally. |
| (gitignore) | `Backend/.gitignore` does not exclude `__pycache__/` or `*.pyc` — currently untracked and showing as `??` in `git status`. Add to gitignore as part of Phase 1 cleanup. |

When Phase 1 moves things to `Backend/legacy_crypto/`, both `scratch/` (JS) and `scratch_python/` (Python) move together, since both are academic artifacts not used by production once `nativeCrypto.js` lands.

---

## 1. pyCrypto callsite inventory

`pyCrypto.callPython(op, args)` is the single entry point. The Python `crypto_cli.py` dispatcher supports 18 ops. All 18 are reachable from the Node request path.

### Direct callers (files that `require('./pyCrypto')` or equivalent)

| File:line | Op | Purpose |
|---|---|---|
| `Backend/utils/pyCrypto.js` | (the bridge itself) | spawns python subprocess; 30s timeout; `python` then `py` fallback on Win32 |
| `Backend/utils/encryption.js:17` | `aes_encrypt` | per-user AES-256-GCM encrypt (`_aesEncryptBuf`) |
| `Backend/utils/encryption.js:32` | `aes_decrypt` | per-user AES-256-GCM decrypt (`_aesDecryptBuf`) |
| `Backend/utils/encryption.js:85` | `hmac_sha256_hex` | record-integrity HMAC (`generateHMAC` / `verifyHMAC`) |
| `Backend/utils/encryption.js:112` | `sha256_hex` | `hashEmail` (lookup hash) |
| `Backend/utils/keyManagement.js:68` | `rsa_generate_keypair` | RSA-2048 keypair gen at registration |
| `Backend/utils/keyManagement.js:74` | `rsa_oaep_encrypt` | RSA-OAEP encrypt (notes) |
| `Backend/utils/keyManagement.js:83` | `rsa_oaep_decrypt` | RSA-OAEP decrypt (notes) |
| `Backend/utils/keyManagement.js:94` | `ecdsa_generate_keypair` | ECC P-256 keypair gen at registration |
| `Backend/utils/keyManagement.js:101` | `ecdsa_sign` | ECDSA sign (record signatures) |
| `Backend/utils/keyManagement.js:112` | `ecdsa_verify` | ECDSA verify (record signatures) |
| `Backend/middleware/authMiddleware.js:16` | `jwt_verify` | verify Bearer token in `protect` |
| `Backend/middleware/authMiddleware.js:52` | `jwt_sign` | full auth token (`generateToken`) |
| `Backend/middleware/authMiddleware.js:61` | `jwt_sign` | temp 2FA token (`generateTempToken`) |
| `Backend/models/User.js:42` | `pbkdf2_hash` | password hash in `pre('save')` |
| `Backend/models/User.js:47` | `pbkdf2_verify` | password check in `comparePassword` |
| `Backend/controllers/twoFactorController.js:10` | `totp_generate_secret` | 2FA setup — fresh secret |
| `Backend/controllers/twoFactorController.js:11` | `totp_otpauth_uri` | otpauth URI for QR code |
| `Backend/controllers/twoFactorController.js:44` | `totp_verify` | enable-2FA flow |
| `Backend/controllers/twoFactorController.js:66` | `totp_verify` | disable-2FA flow |
| `Backend/controllers/twoFactorController.js:92` | `jwt_verify` | verify temp 2FA token in `verify2FA` |
| `Backend/controllers/twoFactorController.js:108` | `totp_verify` | 2FA step-2 of login |

**Count:** 21 callsites across **6 source files** (+ pyCrypto.js itself).
**Ops actually used:** `aes_encrypt`, `aes_decrypt`, `hmac_sha256_hex`, `sha256_hex`, `rsa_generate_keypair`, `rsa_oaep_encrypt`, `rsa_oaep_decrypt`, `ecdsa_generate_keypair`, `ecdsa_sign`, `ecdsa_verify`, `jwt_sign`, `jwt_verify`, `pbkdf2_hash`, `pbkdf2_verify`, `totp_generate_secret`, `totp_otpauth_uri`, `totp_verify` — 17 of the 18 dispatch entries. Unused: `totp_generate` (only used by `crypto_cli.py --selftest`). `pbkdf2_derive` is defined but only used by the selftest.

### Phase 1 import-replacement plan

Replace every `require('../utils/pyCrypto')` / `require('./pyCrypto')` with `require('../utils/nativeCrypto')` (relative path adjusts per directory). The 6 files to touch:

1. `Backend/utils/encryption.js`
2. `Backend/utils/keyManagement.js`
3. `Backend/middleware/authMiddleware.js`
4. `Backend/models/User.js`
5. `Backend/controllers/twoFactorController.js`
6. (`Backend/utils/pyCrypto.js` itself — moved to `legacy_crypto/`)

`encryption.js` and `keyManagement.js` already wrap callPython in their own helpers (`_aesEncryptBuf`, `rsaEncrypt`, etc.) — those wrappers are what callers actually use. The downstream call shape doesn't change; only the body of those wrappers does. So in practice the **two files that need real edits are `encryption.js` and `keyManagement.js`**; the other four just swap the import path and the callPython op-strings (e.g., `pbkdf2_hash` → `nativeCrypto.hashPassword`).

---

## 2. IDOR risk inventory

### Method:
walked every route file; for each handler that touches an `:id` from `req.params` or a user-supplied identifier, recorded whether the DB query filters by `req.user._id`.

| Route | Handler | DB op | Owner-scoped? | Notes |
|---|---|---|---|---|
| `GET    /expenses/:id` | `getExpenseById` (expenseController.js:117) | `Expense.findOne({_id, user})` | ✅ scoped | clean |
| `PUT    /expenses/:id` | `updateExpense` (expenseController.js:136) | `findOne({_id, user})` then `findByIdAndUpdate(id)` | ⚠️ **TOCTOU** | ownership checked, but the update uses `_id` alone — defense-in-depth wants `findOneAndUpdate({_id, user}, …)` |
| `DELETE /expenses/:id` | `deleteExpense` (expenseController.js:175) | `findOne({_id, user})` then `findByIdAndDelete(id)` | ⚠️ **TOCTOU** | same |
| `GET    /budgets/:id` | `getBudgetById` (budgetController.js:86) | `findOne({_id, user})` | ✅ scoped | clean |
| `PUT    /budgets/:id` | `updateBudget` (budgetController.js:106) | `findOne` then `findByIdAndUpdate(id)` | ⚠️ **TOCTOU** | same |
| `DELETE /budgets/:id` | `deleteBudget` (budgetController.js:134) | `findOne` then `findByIdAndDelete(id)` | ⚠️ **TOCTOU** | same |
| `GET    /goals/:id` | `getGoalById` (goalController.js:75) | `findOne({_id, user})` | ✅ scoped | clean |
| `PUT    /goals/:id` | `updateGoal` (goalController.js:96) | `findOne` then `findByIdAndUpdate(id)` | ⚠️ **TOCTOU** | same |
| `DELETE /goals/:id` | `deleteGoal` (goalController.js:135) | `findOne` then `findByIdAndDelete(id)` | ⚠️ **TOCTOU** | same |
| `POST   /goals/:id/contribute` | `addContribution` (goalController.js:149) | `findOne({_id, user})` then mutate + save | ✅ scoped | mutation happens through the loaded doc, no `findByIdAndUpdate` call |
| `GET    /goals/:id/progress` | `getGoalProgress` (goalController.js:171) | `findOne({_id, user})` | ✅ scoped | clean |
| `GET    /auth/profile` | `getUserProfile` (userController.js:113) | uses `req.user` (already loaded in middleware) | ✅ scoped | clean |
| `PUT    /auth/profile` | `updateUserProfile` (userController.js:131) | `User.findById(req.user._id)` | ✅ scoped | id comes from req.user, not user-supplied |
| `POST   /auth/2fa/setup` | `setup2FA` (twoFactorController.js:8) | `User.findById(req.user._id)` | ✅ scoped | same |
| `POST   /auth/2fa/enable` | `enable2FA` (twoFactorController.js:33) | `User.findById(req.user._id)` | ✅ scoped | same |
| `POST   /auth/2fa/disable` | `disable2FA` (twoFactorController.js:60) | `User.findById(req.user._id)` | ✅ scoped | same |
| `POST   /auth/2fa/verify` | `verify2FA` (twoFactorController.js:83) | `User.findById(decoded.id)` (from temp JWT) | ✅ scoped | id comes from cryptographically signed token |
| (middleware) `protect` | authMiddleware.js:23 | `User.findById(decoded.id).select('-password')` | ✅ scoped | id comes from JWT signed by server |
| `GET /budgets/tracking/:year/:month` | params are dates, not record ids | n/a | — | scoped via `{user, month, year}` filter |
| `GET /expenses/summary/:year/:month` | params are dates | n/a | — | scoped via `{user, date range}` filter |

**Summary:** No straight IDOR (every `findOne` by id includes the owner filter). Six handlers use `findByIdAndUpdate` / `findByIdAndDelete` **after** an owner-scoped `findOne`, leaving a theoretical TOCTOU window where a deleted-then-recreated `_id` could be confused. The Phase 4 deliverable is to rewrite these as `findOneAndUpdate({_id, user})` / `findOneAndDelete({_id, user})` so the owner filter is enforced at the mutation itself.

---

## 3. Mass-assignment risk inventory

Walked every `Model.create(…)`, `Model.findByIdAndUpdate(…)`, and explicit document assignment.

| Site | Pattern | Risk |
|---|---|---|
| `userController.js:44` `User.create({…})` | explicit field literal: `{name: encName, email: encEmail, emailHash, password, currency, encryptedDataKey, …keyBundle}` | ✅ whitelisted by construction |
| `userController.js:138-154` `user.X = req.body.X` | per-field `if (req.body.X)` assignments — name, email, currency, password | ✅ whitelisted, but values unvalidated (no email regex, no password complexity, no currency enum check) |
| `expenseController.js:50` `Expense.create({…})` | explicit literal; `user: req.user._id` hard-coded | ✅ no userId spoof possible |
| `expenseController.js:144-153` `updates.X` builder | per-field `if (req.body.X !== undefined)` for amount, category, description, date, note | ✅ whitelisted |
| `budgetController.js:36, 240` `Budget.create({…})` | explicit literal; `user: req.user._id` hard-coded | ✅ |
| `budgetController.js:112-114` `updates.X` builder | per-field for limit, alertThreshold, isActive | ✅ whitelisted |
| `goalController.js:28` `Goal.create({…})` | explicit literal; `user: req.user._id` hard-coded | ✅ |
| `goalController.js:101-117` `updates.X` builder | per-field for description, note, targetAmount, targetDate, goalType, status, title | ✅ whitelisted |
| `goalController.js:160` `goal.contributions.push({amount, note, date})` | explicit literal | ✅ |

**Summary:** No mass-assignment bugs. The codebase consistently uses per-field assignment. **However**, Phase 4 still needs to:

1. Reject unknown fields with 400 (currently they're silently dropped — acceptable, but the brief calls for explicit reject).
2. Validate values, not just keys (currently almost no input validation — see §4).

---

## 4. Input validation gaps

Inventory of every route handler that reads request input without validation. Mongoose schema enums + min/max catch some, but blow up at save time as 500 rather than 400.

| Handler | Inputs | Current validation | Gap |
|---|---|---|---|
| `registerUser` | body: name, email, password, currency | manual presence check; `password.length < 6` | no email format; no password complexity (Phase 4: ≥12, mix); no name length cap; no currency enum |
| `loginUser` | body: email, password | manual presence check | **NoSQL injection vector**: `email` is fed to `hashEmail(email)` which calls `.toLowerCase()` — if email is `{$gt: ""}` this throws **500**, not 400. Zod fixes. |
| `verify2FA` | body: tempToken, token | manual presence check | token format (6 digit numeric) not enforced |
| `enable2FA`, `disable2FA` | body: token | manual presence check | same |
| `updateUserProfile` | body: name, email, currency, password | none beyond presence | same gaps as register; no field-by-field length caps |
| `setup2FA` | none | n/a | clean |
| `createExpense` | body: amount, category, description, date, note | Mongoose enum on category at save | amount sign + cap; description length; date sanity (no year 9999); note length |
| `getExpenses` | query: page, limit, category, startDate, endDate | none | **`limit` is unbounded** — `limit=1000000` is accepted; startDate/endDate accept any Date-parseable string and `new Date('invalid')` produces `Invalid Date` |
| `updateExpense` | body: amount, category, description, date, note | same as create | same |
| `getMonthlySummary` | params: year, month | `parseInt` only — NaN not checked | bogus dates created if non-numeric |
| `createBudget` | body: category, limit, month, year, alertThreshold | Mongoose enum + min/max at save | should validate before the aggregation query runs |
| `getBudgets` | query: month, year, category | `parseInt` only | NaN not checked |
| `getBudgetTracking` | params: year, month | `parseInt` only | same |
| `updateBudget` | body: limit, alertThreshold, isActive | Mongoose min/max | alertThreshold % bounds not checked at controller layer |
| `resetBudgets` | body: fromMonth, fromYear, toMonth, toYear | none | range and integer checks missing |
| `createGoal` | body: title, description, targetAmount, targetDate, goalType, note | Mongoose enum on goalType | title length cap; targetAmount sign; targetDate in future |
| `getGoals` | query: status, goalType | none | enum check missing |
| `updateGoal` | body: many | none beyond presence | same |
| `addContribution` | body: amount, note | none | sign check; note length |
| `monthlyAnalytics` | query: year, month | **explicit** NaN/range check | ✅ already correct (controller-layer; serves as the template) |
| `recurringExpenses`, `highSpendingCategories`, `expenseIncomeRatio`, AI routes | no user input | n/a | clean |

**Phase 4 strategy:**
- Install `zod`.
- One schema file per resource: `Backend/validators/{auth,expense,budget,goal}.js`.
- Validate at the controller entry; reject with 400 + flat error map.
- `z.string()` for any user-supplied string in a DB filter — eliminates `{$gt: ""}`-style injection naturally.
- Cap `limit` at 100; cap string lengths; require positive numbers where the schema does.

---

## 5. Schema field inventory — encrypted / hashed / signed / sensitive

### User (`Backend/models/User.js`)

| Field | Treatment | Notes |
|---|---|---|
| `name` | AES-256-GCM-encrypted with per-user dataKey | PII |
| `email` | AES-256-GCM-encrypted with per-user dataKey | PII; UNIQUE via `emailHash` |
| `emailHash` | `sha256(email.lowercase().trim())` | **unkeyed** — Phase 2 switches to `hmac_sha256(email, EMAIL_HASH_SECRET)` |
| `password` | PBKDF2-SHA256, 10 000 iters, stored as `pbkdf2-sha256$<iter>$<saltHex>$<dkHex>` | **dev-mode iteration count** — Phase 1 migrates to argon2id |
| `encryptedDataKey` | AES-256-GCM-encrypted with `MASTER_ENCRYPTION_KEY` | wraps the per-user 32-byte dataKey |
| `rsaPublicKey` | plaintext JSON `{"n","e"}` (hex) | not secret, but identifying |
| `encryptedRsaPrivateKey` | AES-256-GCM-encrypted with dataKey | wraps `{"n","e","d","p","q"}` JSON |
| `eccPublicKey` | plaintext JSON `{"x","y"}` (hex) | not secret |
| `encryptedEccPrivateKey` | AES-256-GCM-encrypted with dataKey | wraps `{"d"}` JSON |
| `keyVersion` | int | for `rotateUserDataKey` (scaffolded, unused) |
| `twoFactorEnabled` | bool | flag |
| `twoFactorSecret` | AES-256-GCM-encrypted with dataKey | TOTP base32 secret; stored only after `setup2FA`; cleared on `disable2FA` |
| `role` | enum `'user' \| 'admin'` | RBAC; `adminMiddleware.adminOnly` exists but is **not wired to any route** |

### Expense (`Backend/models/Expense.js`)

| Field | Treatment | Notes |
|---|---|---|
| `user` | ObjectId ref User | required |
| `amount` | plaintext Number (min 0) | |
| `category` | plaintext enum (8 values) | |
| `description` | AES-256-GCM-encrypted | (Note: `isAutoCategories` is true when the controller auto-categorized from the description) |
| `date` | plaintext Date | |
| `isAutoCategories` | plaintext bool | |
| `hmac` | HMAC-SHA256 over `{amount, category, _uid}` | Phase 2: drop — GCM tag already covers integrity for `description`, and `{amount, category}` are not the primary risk surface |
| `signature` | ECDSA-P256 over `{amount, category}` (canonical JSON) | **set on creation only**; never regenerated on update → becomes stale after any update — silent warning only. Phase 2: rename to `serverAttestation` + decision doc |
| `note` | RSA-OAEP-encrypted with user's RSA public key | optional |

### Budget (`Backend/models/Budget.js`)

| Field | Treatment | Notes |
|---|---|---|
| `user` | ObjectId ref User | required |
| `category, limit, spent, month, year, alertThreshold, isActive` | plaintext | unique compound index on `(user, category, month, year)` |
| `hmac` | HMAC-SHA256 over `{category, limit, month, year, _uid}` | Phase 2: drop |
| `signature` | ECDSA-P256 over `{category, limit, month, year}` | created on **first** create only; on update path, hmac is regenerated but signature is **not** — also goes stale. Phase 2: rename to `serverAttestation`. |

### Goal (`Backend/models/Goal.js`)

| Field | Treatment | Notes |
|---|---|---|
| `user` | ObjectId ref User | required |
| `title` | AES-256-GCM-encrypted | |
| `description` | AES-256-GCM-encrypted | |
| `targetAmount, currentAmount, targetDate, goalType, status` | plaintext | `currentAmount` recomputed by `pre('save')` hook |
| `contributions[]` | nested `{amount, date, note}` | **`note` is PLAINTEXT** here — inconsistent with the top-level `note` which is RSA-encrypted. Worth flagging; possible follow-up. |
| `hmac` | HMAC-SHA256 over `{title, targetAmount, goalType, _uid}` | Phase 2: drop |
| `signature` | ECDSA-P256 over `{title, targetAmount, goalType}` | set on creation only; goes stale on update (same pattern as Expense/Budget). Phase 2: rename. |
| `note` | RSA-OAEP-encrypted | optional top-level note |

---

## 6. Other findings worth capturing (out-of-scope for Phase 0 fix, in-scope for the sprint)

- **PBKDF2 iterations = 10 000** is well below OWASP 2023 (≥600 000 for SHA-256, or argon2id). Phase 1 replaces with argon2id at `memoryCost: 19456, timeCost: 2, parallelism: 1`.
- **JWT in JS-readable cookie** (`finassist-auth` written by Zustand persist, `SameSite=Lax`, no `httpOnly`, no `Secure`). Any XSS pops the token. Phase 3 fixes.
- **Email enumeration on register & profile-update** — `"Email already registered"` and `"Email already in use"` both leak existence. Login is correctly unified. Phase 5 task §5.3 should extend the unification to register/update as well (the brief only calls out login + password-reset, but the issue is identical).
- **`safeDecrypt` swallows errors** and returns the ciphertext verbatim. Stated reason: legacy compat. Means a corrupted record will silently surface garbage to the user (e.g., displayed expense description = base64 ciphertext). Out of scope; flag in postmortem.
- **`req.body` size limit is 10 MB** (`index.js:22`). Generous; consider 100 KB cap. Out of scope this sprint.
- **`__pycache__/*.pyc`** is not gitignored. Add to `.gitignore` as part of Phase 1's `legacy_crypto/` move.
- **`getExpenses` `limit` query param is unbounded** — `limit=1000000` would pull a million rows. Phase 4 caps via zod.
- **Mongo connect lacks `serverSelectionTimeoutMS` / `socketTimeoutMS`** — ops, not security. Out of scope.
- **`pre('save')` hook on Goal recalculates `currentAmount`** from contributions; if a record is ever re-saved without contributions populated (e.g., from a `lean()` query), `currentAmount` could be zeroed. Currently no code path triggers this, but worth noting.
- **`signature` stale after update** — across Expense, Budget, Goal: the controllers HMAC-regenerate but do **not** re-sign on update. `verifyRecord` will emit a `console.warn` and continue. Phase 2's rename to `serverAttestation` is honest naming; deciding whether to re-sign on update vs. let it go stale is part of `docs/decisions/SEC-1-ecdsa.md`. Recommendation in the decision doc: re-sign on every save (the server holds the private key, so it can; staleness is a bug not a feature).
- **Two route files for goals:** `routes/goalRoutes.js` is unused dead code (`index.js` mounts `goalsRoutes.js`). Brief calls this out as housekeeping; leave for a separate ticket per the explicit out-of-scope list.

---

## 7. Phase mapping (cross-reference)

| Finding | Phase that fixes it |
|---|---|
| pyCrypto subprocess → node:crypto + argon2 | **Phase 1** |
| PBKDF2 → argon2id + per-login lazy re-hash, `passwordHashScheme` field | **Phase 1** |
| Redundant HMAC field on Expense/Budget/Goal | **Phase 2** |
| `signature` → `serverAttestation` + re-sign-on-update policy | **Phase 2** |
| Unkeyed `emailHash` → keyed HMAC with `EMAIL_HASH_SECRET` | **Phase 2** |
| AES IV audit + uniqueness test | **Phase 2** |
| JWT in JS-readable cookie → httpOnly + refresh token rotation | **Phase 3** |
| CSRF guard (custom-header) | **Phase 3** |
| IDOR TOCTOU on update/delete (6 sites) | **Phase 4** |
| Input validation gaps (zod everywhere) | **Phase 4** |
| Account lockout, email verification, password complexity | **Phase 4** |
| 2FA verify rate limit + replay protection | **Phase 4** |
| CSP / HSTS, error sanitization | **Phase 5** |
| Email-enum on register/update (recommendation to extend Phase 5 unification) | **Phase 5** |
| AuditLog, npm audit, secret-length validation at startup | **Phase 5** |
| Tighten /auth/login limiter | **Phase 5** |
| Key management doc | **Phase 5** |

---

## Checkpoint 0 — Acceptance

- [x] `SEC-1-plan.md` exists and lists every pyCrypto callsite (21 across 6 files)
- [x] Every route/controller/model/middleware read in full (not just grepped) — 17 backend files + 3 frontend
- [x] IDOR table complete (no TBD entries)
- [x] Mass-assignment inventory complete
- [x] Input-validation gaps enumerated per handler
- [x] Schema field inventory complete for User / Expense / Budget / Goal
- [x] Brief-vs-reality layout reconciled (`scratch_python` not `python_crypto`; sprint branch off `feature/initial-scaffolding`)
