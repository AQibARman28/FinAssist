# FinAssist

Personal finance management app — expenses, income, budgets, savings goals with a
cash-flow-aware planner, a financial health score and rule-based tips (no external AI
service is called).

## Structure

```
FinAssist/
├── Backend/          Express 4 REST API (port 5000), MongoDB via Mongoose 7
│   ├── app.js        builds the Express app (middleware, routes) — tested with supertest
│   ├── index.js      boots it: config check (utils/config.js), DB, listen
│   └── legacy_crypto/  from-scratch crypto lab (course work) — NEVER imported by the API
├── views/            Next.js 16 frontend (port 3000); src/proxy.ts is the Next proxy
├── docs/             sprint plans/postmortems, security decisions, HARDENING-2026-10
└── .github/workflows ci.yml (tests, lint, build, audit) and keep-alive.yml
```

## Running locally

See `RUNNING-LOCALLY.md` (`start-local.ps1` starts MongoDB, API and web app).

```bash
cd Backend && npm install && npm run dev     # node --watch
cd views && npm install && npm run dev
```

## Tests

```bash
cd Backend && npx jest        # Windows: set MONGOMS_SYSTEM_BINARY (see RUNNING-LOCALLY.md)
cd views && npm test && npx tsc --noEmit && npm run lint
```

Security fixes are test-first; tests drive controllers directly against
mongodb-memory-server, and `tests/http.test.js` drives the middleware chain through
`createApp()` with supertest.

## Security model (read before touching auth or data code)

- **Sessions:** httpOnly, SameSite=Strict cookies — `fa_access` (15-min HS256 JWT),
  `fa_refresh` (random, single-use, only its SHA-256 stored, rotated per refresh with
  reuse detection per family), `fa_temp` (5-min 2FA gate). No token is ever readable by
  page JavaScript; there is no Authorization header. `lib/store.ts` persists only the
  non-secret profile under `finassist-user`.
- **CSRF:** SameSite=Strict + every state-changing call must send
  `X-Requested-With: FinAssist` (lib/api.ts sets it).
- **Proxy secret:** the Next proxy adds `X-FinAssist-Proxy`; with `PROXY_SHARED_SECRET`
  set the API refuses anything else (except `/api/health`).
- **Sign-in:** one throttle keyed by the email's blind index (utils/loginThrottle.js) —
  identical for existing and unknown emails; unknown emails still pay an Argon2 verify.
- **Sensitive changes:** password/email changes need the current password (+ TOTP when
  2FA is on); a new email waits for a code; a password change revokes other sessions.
- **Data at rest:** per-user AES-256-GCM data keys wrapped by the master key ring
  (`mk2:<kid>:`). Encrypted fields use `sealField` / `openField` from utils/encryption.js
  with a name from `FIELDS` — the AAD binds every value to its owner and field. Never
  echo a value that fails to decrypt (that was the old `safeDecrypt` bug).
- **Attestations:** records are ECDSA-signed on create AND update; reads flag
  `integrity: 'missing' | 'invalid'`. Payload shapes: utils/attestationPayloads.js.
- **Validation:** every route uses a `.strict()` zod schema via `middleware/validate.js`.
- **Ownership:** every query filters on `user: req.user._id`.
- **Audit:** `utils/audit.js` allow-lists event names — add new ones there.

## Key decisions

- Budget route order: specific routes (`/tracking`, `/alerts`, `/reset`) must stay above `/:id`
- Expense route order: `/summary/:year/:month` must stay above `/:id`
- Budgets reference categories by ObjectId; spend is computed on read (services/budgetSpend.js)
- Wallet-changing writes run inside `services/walletLock.js`
- MongoDB Atlas connection string: `%` in password must be URL-encoded as `%25`
- Env setup: `Backend/.env.example`, `views/.env.local.example`, root `.env.example` (compose)
