# SEC-1: pre-rollout security hardening

Replaces the academic Python crypto stack with production-grade primitives,
closes pre-rollout authorization / validation / account-safety gaps, and
lays down operational security primitives. Every phase has its own commit
and was independently STOP-&-VERIFY'd before moving on.

## Summary

- Replaces hand-rolled Python crypto (subprocess per request) with `node:crypto` + argon2id + speakeasy + jsonwebtoken.
- Drops a redundant record-integrity HMAC layer; renames misleading `signature` field to `serverAttestation`.
- Migrates email-lookup hash from `sha256(email)` to keyed `hmac_sha256(email, EMAIL_HASH_SECRET)`.
- Replaces JS-readable JWT cookies with httpOnly + SameSite=Strict access/refresh cookies, server-side revocable refresh, custom-header CSRF guard.
- Closes IDOR TOCTOU, NoSQL injection, mass-assignment, weak passwords, brute-force, unverified-email signup, TOTP replay.
- Adds CSP/HSTS, request-id correlation, prod error sanitization, AuditLog, startup secret validation, `npm run security:audit`.
- Three one-shot migration scripts. Idempotent. All `--dry-run`-able.
- 49 unit tests + a full end-to-end live smoke against MongoDB Atlas.

Detailed phase-by-phase walkthrough below. Full postmortem in `docs/sprints/SEC-1-postmortem.md`.

## Commits

### `docs(sprint): SEC-1 phase 0 — discovery & plan`
**Threat addressed:** unknown unknowns. Pre-work: 272-line `docs/sprints/SEC-1-plan.md` mapping 21 pyCrypto callsites across 6 files, IDOR risk inventory (6 TOCTOU sites identified, zero straight IDORs), mass-assignment audit (no `...req.body` spreads — clean), input-validation gaps per handler, schema field inventory for all four models. No code change.

### `feat(crypto): replace python subprocess with node:crypto + argon2id`
**Threats addressed:** ~100 ms cold start per crypto call; academic 10 000-iter PBKDF2 unfit for prod.
- New `Backend/utils/nativeCrypto.js` — single Node-native crypto engine wrapping `argon2`, `speakeasy`, `jsonwebtoken`.
- New `User.passwordHashScheme` + legacy PBKDF2 verifier via Node's native `crypto.pbkdf2Sync`. Successful legacy login triggers a transparent argon2id rehash.
- RSA/ECC keypair storage moved from hex-JSON to PEM. Legacy bundles auto-rotated at next login by `authMiddleware.protect`.
- AES-GCM stored-blob format unchanged → existing DB records still decrypt.
- TOTP algorithm pinned to SHA-256 in speakeasy config so previously-enrolled authenticator apps keep producing matching codes.
- Legacy Python implementations moved to `Backend/legacy_crypto/` (academic artifact, not in the request path).
- 28 unit tests cover the whole engine. 4 tests cover the legacy-PBKDF2 verify path.

### `refactor(crypto): drop redundant HMAC, keyed email hash, IV audit`
**Threats addressed:** offline membership-test on a leaked User collection (sha256 emailHash); misleading "signature" field that implied non-repudiation when it was really server-attestation; redundant integrity layer with no security property the GCM tag didn't already provide.
- Drops the `hmac` field from Expense / Budget / Goal. AES-GCM auth tag covers integrity for encrypted fields; ECDSA serverAttestation covers it for plaintext fields.
- Renames `signature` → `serverAttestation`. New `docs/decisions/SEC-1-ecdsa.md` documents what the attestation protects against (DB tampering, at-rest corruption) and what it does NOT (a malicious operator holding all keys).
- `hashEmail()` switches from `sha256(email)` to `hmac_sha256(email, EMAIL_HASH_SECRET)`. One-shot migration script `Backend/scripts/migrate-email-hash.js` (idempotent, `--dry-run`-able). Ran cleanly against dev Atlas: 5 users migrated, 1 already-keyed unchanged.
- AES-GCM IV audit: no encryption helper accepts an external IV. `tests/encryption.test.js` codifies this with a function-arity assertion and a same-plaintext-different-ciphertext check.

### `feat(auth): httpOnly cookie sessions + refresh token rotation + CSRF guard`
**Threats addressed:** XSS-to-token-theft via JS-readable cookie; long-lived JWT with no revocation; classical CSRF; pre-existing Next-middleware silently never loaded.
- Two-cookie scheme: `fa_access` (15-min HS256) + `fa_refresh` (7-day opaque, sha256-stored in new `RefreshToken` collection with Mongo TTL). All cookies `HttpOnly; SameSite=Strict; Secure` (in prod).
- New `POST /auth/refresh` rotates the refresh row (revoke old + insert new). New `POST /auth/logout` revokes the active refresh.
- Frontend `axios.withCredentials = true` + single-flight refresh-on-401 retry + `X-Requested-With: FinAssist` on every request.
- New `Backend/middleware/csrf.js` rejects state-changing requests without the custom header.
- **Bug fix:** renamed `views/src/proxy.ts` → `views/src/middleware.ts` and `proxy()` → `middleware()`. Next.js was never loading the old name — the `/dashboard` route guard had been silently inactive since day one.
- Zustand store dropped `token`/`tempToken` and the cookie-backed persist; user profile now lives in plain localStorage (non-sensitive).

### `feat(security): IDOR fix, input validation, account lockout, email verification, 2FA hardening`
**Threats addressed:** TOCTOU IDOR on update/delete; NoSQL operator injection; mass assignment via spoofed body keys; brute-force login; account takeover via email-guess against an unverified account; weak passwords; TOTP brute-force; TOTP replay inside the 60-second validity window.
- IDOR: 6 sites (`updateExpense`, `deleteExpense`, `updateBudget`, `deleteBudget`, `updateGoal`, `deleteGoal`) refactored from `findOne + findByIdAndUpdate` to `findOneAndUpdate({_id, user})`. Cross-user GET / PUT / DELETE all return 404.
- zod validators in `Backend/validators/{auth,expense,budget,goal,common}.js` + generic `Backend/middleware/validate.js`. Every route validates body / params / query with `.strict()` schemas. `{email: {"$gt": ""}}` → 400, no longer crashes downstream.
- Account lockout with exponential backoff: 5 failures in 15 min → 423 Locked for `15min × 2^lockoutCount`.
- Email verification: registration writes a pending user, sends a verification email via `Backend/utils/mailer.js` (SMTP in prod, console fallback in dev), and returns 201 + "Check your email" — no session established. Login returns 403 with a clear message until verified. Migration script `Backend/scripts/migrate-existing-users.js` marked 8 pre-Phase-4 users as `emailVerified: true`.
- Password complexity at register and PUT /profile: 12+ chars + lower/upper/digit. Login uses a looser shape so legacy short-password users get one more rehash.
- TOTP guard (`Backend/utils/totpGuard.js`) implements 90-second replay window + 5-failures-in-5min per-user lockout. 7 unit tests pin the policy.

### `feat(ops): CSP/HSTS, error sanitization, audit log, secret validation`
**Threats addressed:** clickjacking; HTTPS downgrade; stack-trace leakage in production errors; forensic gaps after incident; booting with missing/weak secrets; vulnerable transitive deps; auth brute-force from a single IP.
- Helmet CSP with explicit directives (default-src 'self', script-src 'self', style-src 'self' 'unsafe-inline', frame-ancestors 'none', object-src 'none', etc.) + HSTS (1yr + includeSubDomains + preload).
- Per-request `X-Request-Id` header + included in morgan production log format for correlation.
- Global error handler: prod returns `{success:false, error:'Internal server error', requestId}` only; dev still returns `message + stack + requestId`. Full error always logged to stderr keyed by requestId.
- New `AuditLog` collection + `Backend/utils/audit.js` writer. Wired into 11 events: register, login.success, login.failure (with reason: unknown_email / locked / wrong_password / email_unverified), logout, refresh.rotate, password.change, profile.email_change, 2fa.enable, 2fa.disable, email.verify.
- Boot-time secret validation refuses to start if `JWT_SECRET` / `MASTER_ENCRYPTION_KEY` / `EMAIL_HASH_SECRET` is missing or under 32 bytes.
- `npm run security:audit` = `npm audit --audit-level=high`. Exits 1 on findings.
- Auth limiter tightened from 20 → 10 per IP per 15 min.
- `docs/security/key-management.md` documents the current env-var state, target KMS/Vault shape, and rotation procedures for each secret.

## Test plan

- [x] `cd Backend && npm test` — 49/49 green across 4 suites.
- [x] Live end-to-end smoke against MongoDB Atlas dev DB (Phase 6): register → email verify → login → 2FA enable → logout → login with 2FA → expense CRUD → budget CRUD → goal CRUD + contribution → 9 analytics endpoints → password change → old-password rejected → new-password accepted. All green.
- [x] Boot-refusal smoke: empty + too-short `MASTER_ENCRYPTION_KEY` both produce clear refusal messages.
- [x] CSRF guard smoke: state-changing requests without `X-Requested-With: FinAssist` → 403.
- [x] IDOR smoke: User B GET/PUT/DELETE of User A's expense id → 404 each; User A's record unaffected.
- [x] NoSQL-injection smoke: `POST /auth/login {email: {"$gt": ""}}` → 400 from zod.
- [x] Mass-assignment smoke: `POST /expenses {userId: '...'}` → 400 "Unrecognized key: userId".
- [x] Lockout smoke: 5 wrong passwords → 401; 6th + correct password → 423.
- [x] Refresh rotation smoke: rotated, replayed old refresh → 401.
- [x] `npm run security:audit` exits non-zero on the current 4 high-severity transitive advisories.

## Deploy checklist

1. Set new env vars on prod (see `Backend/.env.example`):
   - `EMAIL_HASH_SECRET` (64 hex chars).
   - `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` for verification email delivery.
2. Run migrations against prod in this order (each is idempotent):
   - `npm run migrate:email-hash`     — recomputes `User.emailHash` for the new keyed HMAC. Required; without it, all pre-Phase-2 users fail to log in (lookup miss).
   - `npm run migrate:existing-users` — sets `emailVerified: true` for pre-Phase-4 users. Required; without it, every pre-Phase-4 user gets 403 at login.
3. Roll the new build. Boot will refuse if `JWT_SECRET` / `MASTER_ENCRYPTION_KEY` / `EMAIL_HASH_SECRET` are missing or short.
4. Verify `/api/health` returns CSP + HSTS headers + a `X-Request-Id`.
5. Verify `Set-Cookie` on a fresh `/auth/login` shows `HttpOnly; SameSite=Strict`.

## Out of scope (postmortem follow-ups)

See `docs/sprints/SEC-1-postmortem.md` for the full list. Summary: KMS/Vault migration, 2FA backup codes, refresh-token theft detection, frontend currency display, HIBP check, dual-secret JWT rotation, CSP nonces, audit-log retention, password-reset endpoint, "resend verification" UX, dead `goalRoutes.js`, and the accidentally-tracked `node_modules/.package-lock.json`. None are blocking rollout.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
