# Security hardening — October 2026

**Scope:** the 28 findings and 7 product gaps from the 2026-10-20 source review
(the "FinAssist security review" dashboard), all closed in this pass.
**Method:** every code change was test-first — a failing test reproducing the
finding, then the fix, then the full suite. Configuration-only changes (Docker,
compose, CI, deploy blueprints) were validated by parsing and, where possible,
by running them.

## Results

| | Before | After |
|---|---|---|
| Backend tests (Jest) | 236 in 19 suites | 383 in 37 suites |
| Frontend tests (node:test) | 36 | see final run |
| Crypto-lab self-tests | 38 | 56 (+ RFC 6979, RFC 7515, Wycheproof vectors) |
| Crypto-lab cross-checks vs Node | 530/530 | 530/530 |
| Vulnerable shipped packages (npm audit --omit=dev) | 19 (2 critical) | 0 |
| All advisories incl. dev tooling — API | 49 (1 critical, 40 high) | 19 moderate (Jest coverage tooling, no fix upstream) |
| All advisories incl. dev tooling — web | 28 (1 critical, 19 high) | 5 high, all in `eslint-config-next`'s lint plugin (lint-time only, no fix upstream) |
| Findings open | 28 (3 high, 7 medium, 13 low, 5 info) | 0 |

## Finding → fix → proof

| # | Finding | Fix | Proof |
|---|---|---|---|
| F01 | Session could change password/email without re-auth | Current password (+TOTP when 2FA on) required; new email confirmed by code; password change revokes other sessions | `tests/accountSecurity.test.js` › profile changes |
| F02 | Shipped deps with critical advisories | Next 16.4.2, nodemailer 10, mathjs 15, patched transitive deps; unused `validator`, `vitest`, nodemon removed; CI audit gate | `npm audit --omit=dev` = 0 in both workspaces |
| F03 | Compose published unauthenticated MongoDB | Mongo internal-only with auth; least-privilege app user (`docker/mongo-init.js`); API not published | `docker-compose.yml` |
| F04 | Per-IP limits bypassable via direct calls + forged XFF | Proxy shared secret (`middleware/proxyGuard.js`, `views/src/proxy.ts`); per-account sign-in throttle independent of IP | `tests/http.test.js` › proxy shared secret; live probe: direct + forged XFF → 403 |
| F05 | CSP protected the API, not the pages | Per-request nonce CSP in `views/src/proxy.ts`; frame, MIME, referrer, permissions, COOP, HSTS headers in `next.config.ts` | production build + browser check |
| F06 | Failed decryption echoed the stored value | Strict `decryptOrNull`; v2 ciphertexts with AAD bound to owner + field | `tests/dataProtection.test.js`, `tests/recordIntegrity.test.js` |
| F07 | 2FA setup re-keyed an active secret | 409 while 2FA is on | `tests/twoFactor.test.js` |
| F08 | Unbounded, abusable account lockout | One throttle per email blind index, identical for unknown emails, capped at 1 h | `tests/accountSecurity.test.js` › sign-in throttle |
| F09 | HTML injection in welcome email | `escapeHtml` on every interpolation; name charset; no welcome to unproven addresses | `tests/mailer.test.js`, validators tests |
| F10 | 6-char passwords, no breach check | Min 8, common-password list, HIBP k-anonymity check (fail-open) | `tests/passwordStrength.test.js` |
| F11 | Account existence leaked | Dummy Argon2 verify; uniform 401/429; uniform sign-up response with verification on | `tests/accountSecurity.test.js` |
| F12 | Refresh rotation not atomic, no reuse detection | Atomic claim; token families; replay revokes family; 10 s parallel-tab grace; remember-me kept | `tests/sessions.test.js` |
| F13 | Dormant 10k-iteration PBKDF2 hashes | Argon2id wrapping + migration | `tests/legacyPasswords.test.js` |
| F14 | Attestations only warned, could be stripped | Three-state check, `integrity` flag + audit event, re-sign on update, baseline job | `tests/recordIntegrity.test.js`, `tests/dataMigrations.test.js` |
| F15 | Key rotation unbuilt; boot check looser than crypto | Key ids (`mk2:<kid>:`), `MASTER_ENCRYPTION_KEY_PREVIOUS`, `rotate:master-key`, `JWT_SECRET_PREVIOUS`, exact 64-hex boot check | `tests/dataProtection.test.js`, `tests/config.test.js` |
| F16 | Email verification off in production | On by default in production; boot refuses without a mail provider | `tests/config.test.js`, `tests/accountSecurity.test.js` |
| F17 | Auth limiter throttled session refresh | Strict limit on credential endpoints only; separate refresh limit | `tests/http.test.js` › rate-limit scoping |
| F18 | SHA-256 TOTP vs common apps; no recovery | SHA-1 for new enrolments (SHA-256 kept for existing); 10 single-use recovery codes | `tests/twoFactor.test.js` |
| F19 | Notes > 190 bytes crashed (RSA-OAEP) | Notes sealed with the AES data key; legacy RSA notes still read | `tests/dataProtection.test.js` › notes |
| F20 | 10 MB request bodies | 100 kB | `tests/http.test.js`; live probe → 413 |
| F21 | API container root on EOL Node 20 | Node 22, `USER node`, crypto lab excluded from the image | `Backend/Dockerfile`, `.dockerignore` |
| F22 | Security paths untested | supertest route tests + 12 new suites | this table |
| F23 | No CI gate | `.github/workflows/ci.yml`: tests, tsc, lint, build, audit, crypto-lab guard | YAML validated |
| F24 | Docs described pre-SEC-1 design | CLAUDE.md, DEPLOY.md, RUNNING-LOCALLY.md, key-management.md, ECDSA ADR revision | — |
| F25 | Audit log kept IPs forever; money moves unaudited | 180-day TTL (`AUDIT_RETENTION_DAYS`); expense/income/budget/goal events | `tests/recordIntegrity.test.js` |
| F26 | Codes logged when no mail provider | Redacted in production (subject included) | `tests/mailer.test.js` |
| F27 | Crypto-lab caveats | RFC 6979 / RFC 7515 / Wycheproof vectors; low-S + strict DER + range check; strict JWT base64url, required exp; constant-time TOTP window; PBKDF2 key-state reuse; corrected comments; documented timing limits; import guard | 56 self-tests, 530/530 cross-checks, `check-no-imports.js` |
| F28 | Dead code and leftovers | Removed unmounted goal routes, `adminOnly`, link verifier, `seed` script, unused deps, retired env vars | — |

## Product gaps

| # | Gap | Fix |
|---|---|---|
| G1 | Budgets never recorded spending | Budgets reference category ids; spend computed on read; migration |
| G2 | Month rollover could apply twice | Atomic per-month claim, 409 on repeat |
| G3 | Deleting a goal rewrote history | Archive + dated release; past closings unchanged |
| G4 | Savings moves check-then-write | Per-user wallet lock |
| G5 | Endpoints without screens | Goal plan + allocation UI, priority, expense edit, touch-safe delete |
| G6 | No income scored "Excellent" | Savings and ratio factors score 0 when spending with no income |
| G7 | No user/date index on expenses | `{user: 1, date: -1}` |

Also fixed along the way: turning a recurring income off now actually clears its
cadence (`$unset`), and `/goals/allocate` no longer accepts a client-chosen
(backdated) date.

## Deploy notes

See `DEPLOY.md` §7 for the one-time migration order and the new settings
(`PROXY_SHARED_SECRET` on both hosts, `RESEND_API_KEY`, `REQUIRE_EMAIL_VERIFICATION`).
