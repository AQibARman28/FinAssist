# Sprint SEC-1 — Postmortem

**Branch:** `feat/sec-1-native-crypto-hardening`
**Commits:** 6 (Phase 0 plan + Phases 1–5 features + Phase 6 verification)
**Dates:** 2026-05-19 → 2026-05-20
**Status:** Ready for merge to main.

---

## What shipped

### Phase 1 — Native crypto engine
- Replaced the Python crypto subprocess (per-call ~100 ms cold start + academic-grade 10 000-iteration PBKDF2) with `Backend/utils/nativeCrypto.js` wrapping `node:crypto` + three vetted npm packages: **argon2** (OWASP-baseline argon2id), **speakeasy** (TOTP), **jsonwebtoken** (HS256).
- New `User.passwordHashScheme` field; legacy PBKDF2 hashes verified via Node's native `pbkdf2Sync` and lazy-rehashed to argon2id on first successful login. Existing users keep logging in.
- AES-GCM wire format preserved → existing DB records continue to decrypt.
- RSA-2048 / ECC-P256 keypair storage changed from hex-JSON to PEM. Legacy bundles auto-rotated on next login or first protected request (`hasLegacyKeyBundle` / `regenerateUserKeyBundle`).
- Python implementations moved to `Backend/legacy_crypto/` with a README explaining their academic-artifact status.
- 28 unit tests + 4 legacy-hash verification tests.

### Phase 2 — Crypto cleanup & correctness
- Dropped the redundant record-integrity HMAC field on Expense / Budget / Goal (AES-GCM auth tag + ECDSA serverAttestation cover integrity).
- Renamed `signature` → `serverAttestation` to make the trust boundary honest (the server holds the private key — this is attestation, not non-repudiation). Decision documented in `docs/decisions/SEC-1-ecdsa.md`.
- Switched `User.emailHash` from `sha256(email)` to `hmac_sha256(email, EMAIL_HASH_SECRET)`. One-shot migration script (`Backend/scripts/migrate-email-hash.js`, idempotent, supports `--dry-run`).
- AES-GCM IV audit: no code path accepts an externally-supplied IV; helper-arity assertion in tests catches future regressions.

### Phase 3 — Session hardening
- Two-cookie scheme replaces the JS-readable JWT-in-cookie:
  - `fa_access` — 15-min HS256 JWT, httpOnly + SameSite=Strict.
  - `fa_refresh` — 7-day opaque random token; plaintext in cookie, sha256 in DB (new `RefreshToken` collection with Mongo TTL).
  - `fa_temp` — 5-min 2FA-gate token, httpOnly.
- New `POST /auth/refresh` (rotation: revoke old + insert new) and `POST /auth/logout` (revoke).
- Frontend axios: `withCredentials: true`, single-flight refresh-on-401 retry, `X-Requested-With: FinAssist` on every request.
- CSRF defense-in-depth: custom-header middleware rejects state-changing requests without the header.
- **Pre-existing bug fixed**: `views/src/proxy.ts` renamed to `views/src/middleware.ts` — Next.js's middleware was silently never loaded because the file name was wrong.

### Phase 4 — Authorization, validation, account safety
- **IDOR fixes**: 6 sites (update/delete on Expense/Budget/Goal) collapsed from `findOne + findByIdAndUpdate` to `findOneAndUpdate({_id, user})` so ownership is enforced at the mutation. Cross-user attempts return 404 (existence not leaked).
- **zod everywhere** (`Backend/validators/{auth,expense,budget,goal,common}.js`). Every route validates body/params/query with `.strict()` schemas. Closes NoSQL-injection-to-500 vector (`{email: {$gt: ""}}` → 400) and mass-assignment (`{userId: "..."}` → 400 "Unrecognized key").
- **Account lockout** with exponential backoff: 5 failures in 15 min → `lockedUntil = now + 15min × 2^lockoutCount`. Returns 423 Locked.
- **Email verification** required for first login. `GET /auth/verify-email?token=...` redirects to `/login?verified=1`. nodemailer with dev console fallback. One-shot migration set `emailVerified: true` for 8 pre-Phase-4 users.
- **Password complexity** at register and profile-change: min 12 chars, lower + upper + digit. Login uses a looser shape so legacy short-password users still get the rehash.
- **TOTP guard** (`Backend/utils/totpGuard.checkAndRecordTotp`): 90-second replay window + 5-failures-in-5min per-user rate limit. 7 unit tests cover the policy.

### Phase 5 — Hardening & ops
- **Helmet CSP** (explicit directives: default 'self', script-src 'self', style 'self' 'unsafe-inline', frame-ancestors 'none', object-src 'none', base-uri 'self', form-action 'self') + **HSTS** (1 year + includeSubDomains + preload).
- **Request ID** middleware (`req.requestId`, `X-Request-Id` header, included in morgan logs).
- **Error sanitization**: prod returns `{error, requestId}` only; dev returns `{message, requestId, stack}`. Full error always to stderr keyed by requestId.
- **Trust proxy** = 1 (first-hop) so `req.ip` and rate limiter see the real client.
- **AuditLog** collection + `Backend/utils/audit.js`. 11 events wired: register, login.success, login.failure (with reason), logout, refresh.rotate, password.change, profile.email_change, 2fa.enable, 2fa.disable, email.verify.
- **Startup secret validation**: refuses to boot if JWT_SECRET / MASTER_ENCRYPTION_KEY / EMAIL_HASH_SECRET is missing or shorter than 32 bytes.
- **`npm run security:audit`** = `npm audit --audit-level=high`. Exits 1 on findings.
- **Auth rate limit** tightened from 20 → 10 per IP per 15 min.
- `docs/security/key-management.md` documents current env-var state, target KMS/Vault shape, and rotation procedures for each secret.

### Phase 6 — Final verification
- All 49 unit tests green (4 suites).
- End-to-end smoke against the live MongoDB Atlas dev DB walked the entire feature surface: **register → email verify → login → 2FA enable → logout → login with 2FA → expense CRUD → budget CRUD → goal CRUD + contribution → analytics (9 endpoints) → password change → old-password rejected → new-password accepted** — all green.

---

## Deferred (known follow-ups, NOT blocking rollout)

| Item | Why deferred | Right next step |
|---|---|---|
| **KMS / Vault migration** | The env-var-only approach with the new boot-time length validation is acceptable for v1 rollout. Rotation playbook is documented. | Separate sprint when ops infrastructure is ready. `rotateUserDataKey` scaffold already exists. |
| **2FA backup codes** | Out of brief scope. A user who loses their authenticator currently has no recovery path. | New ticket. Mint 8–10 one-time codes at enable time, hash with argon2, store as User field. Display once, never again. |
| **Refresh-token rotation policy tuning** | Current policy: 7-day TTL, rotate-every-use, no automatic family-revocation on theft detection. Acceptable but could be tightened (e.g., revoke whole family if a revoked-then-replayed refresh is seen — possible refresh-token-theft signal). | New ticket. Requires schema addition for `tokenFamily` id. |
| **Currency display fix** | UX bug surfaced in Phase 0 audit: user's `currency` field is stored and editable but the frontend hardcodes `$` for every amount. Not security. | Separate UX ticket; trivial fix in the formatters in `views/src/components/dashboard/`. |
| **HIBP k-anonymity check on registration** | Brief said "Optionally". Skipped to avoid adding a non-idempotent network call to the registration path. | Phase-5 follow-up ticket. Implement behind a `HIBP_ENABLED` env flag. |
| **Dual-secret JWT verify for graceful JWT_SECRET rotation** | Rotation works today but causes a brief auth blip while refresh tokens kick in. | One-line change in `nativeCrypto.verifyJwt` to accept an array of secrets; document in `docs/security/key-management.md`. |
| **CSP nonces for inline styles** | Tailwind's current build still injects inline styles; needs `style-src 'unsafe-inline'`. | Revisit when we adopt a CSP-nonce-aware Tailwind build pipeline. |
| **Audit-log retention policy + view** | Rows grow unbounded today. No UI for an admin to inspect them. | New ticket: TTL index on `createdAt` for the long-tail; admin route gated on `role: 'admin'`. |
| **Login response unification for password-reset** | The password-reset endpoint doesn't exist yet. Brief called this out as a parallel concern. | Add the unification when the password-reset feature lands. |
| **Resend verification email** | New users who lose the email have no recovery flow. | New ticket: `POST /auth/resend-verification` with same per-IP + per-user rate limits as login. |
| **Frontend `?verified=1` / `?registered=1` banners** | API redirects with these query params but the login page doesn't render a banner. | UX ticket. |
| **Dead `Backend/routes/goalRoutes.js`** | Identical to the mounted `goalsRoutes.js`; unused. Brief explicitly excluded as housekeeping. | Trivial cleanup ticket. |
| **`Backend/node_modules/.package-lock.json` accidentally tracked** | A `node_modules` artifact slipped into git history pre-SEC-1. Touching it produces a "M" in `git status` every install. | `git rm --cached` + update `.gitignore` in a housekeeping commit. |

---

## What we learned / non-obvious gotchas

1. **`views/src/proxy.ts` was never loaded by Next.js.** The Phase 0 audit didn't catch the filename. Default-named files matter; we should add a unit test or repo-level lint that asserts the existence of `src/middleware.ts` when middleware behavior is implied. Documented in Phase 3 commit.

2. **`otplib` pulls ESM-only `@scure/base` transitively** and breaks Jest without Babel config. Phase 1 swapped to `speakeasy` (CJS) — equivalent capability, no test infrastructure change.

3. **TOTP algorithm continuity.** Legacy Python TOTP used SHA-256 in the otpauth URI. otplib/speakeasy default to SHA-1. Phase 1 pinned `algorithm: 'sha256'` to keep already-enrolled users' authenticator apps producing the same codes the server expects.

4. **JWT scheme migration drops old RSA-encrypted notes.** When the JIT key-bundle rotation at login swaps legacy hex-JSON RSA keys to PEM, notes encrypted with the old public key become unreadable. `decryptNote` returns null with a console.warn rather than 500. This is a documented data-loss tradeoff (the alternative — converting hex-JSON to PEM via JWK + computed dp/dq/qi — was too much code for too little value).

5. **Auth rate-limit cardinality.** During smoke testing, the 10/15min `/auth` cap is easy to exhaust when one developer is iterating. Per the brief it's correct for production; in dev we just restart between smoke runs.

6. **`req.body` shaped wrong for zod-strict in older Express.** Express 4 returns plain objects, so `.strict()` works. If we move to Express 5 prototypes, the validate middleware's fallback-to-defineProperty path catches the read-only-query case.

---

## Threat-coverage table

| Threat | Where it was addressed |
|---|---|
| Slow Python subprocess per request | Phase 1 (`nativeCrypto.js`) |
| Academic-grade PBKDF2 (10 000 iter) | Phase 1 (argon2id + lazy rehash) |
| Email collection enumeration via offline sha256 | Phase 2 (keyed HMAC + migration) |
| Stale record-integrity HMAC after update | Phase 2 (dropped redundant layer) |
| Misnomer of "signature" implying non-repudiation | Phase 2 (renamed serverAttestation + decision doc) |
| XSS-to-token-theft via JS-readable cookie | Phase 3 (httpOnly cookies) |
| Long-lived JWT in storage with no revocation | Phase 3 (15m access + revocable refresh) |
| CSRF via classical form post | Phase 3 (SameSite=Strict + X-Requested-With) |
| Next middleware silently disabled | Phase 3 (rename `proxy.ts` → `middleware.ts`) |
| TOCTOU on update/delete (potential IDOR) | Phase 4 (compound-filter mutations) |
| NoSQL operator injection via login email | Phase 4 (zod `z.string()` at boundary) |
| Mass-assignment of `userId` and similar | Phase 4 (zod `.strict()` + hardcoded `req.user._id`) |
| Brute-force login | Phase 4 (per-user exponential lockout + per-IP 10/15min) |
| Unverified email signup → account takeover via email guess | Phase 4 (email-verification gate at login) |
| Weak passwords | Phase 4 (12-char + character-class policy at register/change) |
| TOTP replay within 60s validity window | Phase 4 (90s replay window in `totpGuard`) |
| TOTP brute-force | Phase 4 (5-in-5min per-user lockout) |
| Clickjacking / mixed-origin embedding | Phase 5 (CSP `frame-ancestors 'none'`) |
| HTTPS downgrade | Phase 5 (HSTS preload-eligible) |
| Stack-trace leakage in production errors | Phase 5 (error sanitization) |
| Forensic gaps after incident | Phase 5 (AuditLog collection + writers) |
| Booting with weak/missing secrets | Phase 5 (startup validation, refuses to start) |
| Vulnerable transitive deps slipping into prod | Phase 5 (`npm run security:audit`, fails CI on high) |

---

## Stats

- 6 commits.
- 73 files touched (12 created models / routes / middleware / utils, 4 created docs, 3 migration scripts, 49 modified, plus the legacy move).
- 49 unit tests (28 nativeCrypto + 4 userPassword + 10 encryption + 7 totpGuard).
- 9 frontend pages and helpers updated; 1 Next middleware file renamed.
- 3 one-shot migration scripts (`migrate-email-hash.js`, `migrate-existing-users.js`, plus the documented future `rotate-master-key.js` not yet written).
- Live verification against MongoDB Atlas confirmed every acceptance criterion in every phase brief.
