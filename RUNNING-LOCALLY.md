# Running FinAssist locally

You need **Node.js 22** and **MongoDB 8**: either
[MongoDB Community Server](https://www.mongodb.com/try/download/community), or Docker:

```bash
docker run -d --name finassist-mongo -p 27017:27017 mongo:8
```

## 1. Install

```bash
cd Backend && npm install
cd ../views && npm install
```

## 2. Configure

```bash
cp Backend/.env.example Backend/.env
cp views/.env.local.example views/.env.local
```

`Backend/.env` already points `MONGO_URI` at a local `mongod`
(`mongodb://127.0.0.1:27017/finassist`). Fill in the three secrets; the API refuses to
start without them (`Backend/utils/config.js`). Generate each one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variable | Rule |
|----------|------|
| `JWT_SECRET` | at least 32 bytes |
| `MASTER_ENCRYPTION_KEY` | exactly 64 hex characters |
| `EMAIL_HASH_SECRET` | exactly 64 hex characters |

Leave `PROXY_SHARED_SECRET` empty in both files. If you do set it, use the same value
in `Backend/.env` and `views/.env.local`, or every API call returns 403.

## 3. Start

In two terminals:

```bash
cd Backend && npm run dev     # API on :5000, restarts on change (node --watch)
cd views && npm run dev       # web app on :3000; src/proxy.ts forwards /api/* to :5000
```

On Windows, `start-local.ps1` opens both in their own windows, starts `mongod` if it
can find one, and installs packages on the first run:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-local.ps1
```

Open <http://localhost:3000> and create an account. The health check at
<http://localhost:5000/api/health> reports the database too: `{"db":"connected"}`
means healthy, and a 503 means the API is up but the database is not.

## Signing up locally

Email verification is off in development unless `REQUIRE_EMAIL_VERIFICATION=true`.
With no mail provider configured, development prints every email (including the
codes for a password reset or an email change) to the API's console. Passwords need
at least 8 characters and can't be a common password. Session cookies aren't
`secure`-only in development, so plain `http://localhost` works.

## Tests

```bash
cd Backend && npx jest
cd ../views && npm test && npx tsc --noEmit && npm run lint
```

The API tests start an in-memory MongoDB (`mongodb-memory-server`), which downloads a
`mongod` binary on the first run. If that download is blocked or comes down corrupt
(it has on Windows), point the tests at a local binary instead:

```powershell
$env:MONGOMS_SYSTEM_BINARY = "C:\path\to\mongod.exe"
```

CI (`.github/workflows/ci.yml`) runs the same on every push, plus a production build,
`npm audit --omit=dev` in both apps and the crypto-lab import guard.

## Stopping

Stop each terminal with Ctrl+C. On Windows, to stop only what is listening on these
ports (not every Node process, which would also stop your editor's tools):

```powershell
foreach ($port in 3000, 5000, 27017) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
}
```

## An older database

A database created before the October 2026 hardening needs the one-time migrations
in [DEPLOY.md §7](DEPLOY.md#7-upgrading-an-existing-deployment-to-the-october-2026-hardening).
