# Running FinAssist locally

The app runs end-to-end on this machine with no cloud account, no Docker and no
Atlas cluster.

```powershell
powershell -ExecutionPolicy Bypass -File .\start-local.ps1
```

Then open <http://localhost:3000>.

## What that starts

| Service  | Port  | Notes                                                        |
|----------|-------|--------------------------------------------------------------|
| MongoDB  | 27017 | `%USERPROFILE%\finassist-local-db` — data persists between runs |
| Backend  | 5000  | Express API, `NODE_ENV=development`, restarts on change (`node --watch`) |
| Frontend | 3000  | Next.js dev server; `src/proxy.ts` forwards `/api/*` to :5000 and sets the page CSP |

`PROXY_SHARED_SECRET` is normally left empty locally. If you set it, set the same
value in `Backend/.env` and `views/.env.local` (see `views/.env.local.example`), or
every API call returns 403.

Health check: <http://localhost:5000/api/health> — it now reports database state,
so `{"db":"connected"}` means genuinely healthy and a 503 means the API is up but
the database is not.

## Where the database came from

The Atlas cluster this project used (`90wfvt4`) no longer exists — all three of
its shard hostnames fail DNS lookup, which is what a deleted cluster looks like.
Local development now runs against a real `mongod` 8.2.6 extracted from the
`mongodb-memory-server` download cache into `%USERPROFILE%\finassist-local-db\bin`.

The old Atlas connection string is still in `Backend/.env`, commented out, in case
you want the database username and password back.

## Logging in

`NODE_ENV` is `development` locally, so session cookies are not `secure`-only and
work over plain `http://localhost`. Register any account at
<http://localhost:3000/register> and log straight in — email verification is off
in development unless `REQUIRE_EMAIL_VERIFICATION=true` is set (it is on by default
in production). With no mail provider configured, development prints each email,
including its code, to the backend window. New passwords need at least 8 characters
and can't be a common password.

A demo account already exists from the smoke test:

```
demo@finassist.local  /  Demo1234
```

## Stopping

Close each service window, or stop only what is listening on these ports —
do NOT run `Get-Process node | Stop-Process`, which would also kill your editor,
language servers and anything else running on Node:

```powershell
foreach ($port in 3000, 5000, 27017) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
}
```

## Tests

```powershell
cd Backend ; $env:MONGOMS_SYSTEM_BINARY = "$env:USERPROFILE\finassist-local-db\bin\mongod.exe" ; npx jest
cd views   ; npm test ; npx tsc --noEmit ; npm run lint
```

CI (`.github/workflows/ci.yml`) runs the same on every push, plus a production
build, `npm audit --omit=dev` in both workspaces and the crypto-lab import guard.

## Data migrations

The local database predates the October 2026 hardening. Run the same one-time
migrations as production (each is a dry run until you add `-- --apply`):

```powershell
cd Backend
npm run migrate:budget-categories -- --apply
npm run migrate:field-encryption -- --apply
npm run migrate:reattest -- --apply
npm run migrate:wrap-legacy-passwords -- --apply
npm run migrate:audit-retention
```

The `MONGOMS_SYSTEM_BINARY` override matters: the binary that
`mongodb-memory-server` cached in `Backend/node_modules/.cache` is truncated
(77,534,003 bytes instead of 77,552,128) and Windows refuses to run it.
