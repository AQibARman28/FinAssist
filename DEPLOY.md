# Deploying FinAssist — free, step by step

This puts FinAssist online at **$0/month** and makes it installable as an app (PWA):

- **Frontend** → Vercel (Hobby, free)
- **Backend** → Render (free web service, Docker)
- **Database** → MongoDB Atlas (M0, free forever)
- **Email** → Resend (free tier) — required: production proves email ownership

The app and API end up **same-origin** (Vercel's proxy forwards `/api` to Render),
which is what makes the secure login cookies work. The proxy also signs every API
call with a shared secret, and the API refuses anything that didn't come through it.

> ⚠️ **One thing you must not lose:** `MASTER_ENCRYPTION_KEY`. It protects every
> user's name, email, 2FA secret, descriptions and notes. If you lose it, that data
> is gone forever. Save all four secrets (below) in a password manager.

---

## 0. Push the code to GitHub (one time)

All three hosts deploy from GitHub.

1. Create an empty repo at <https://github.com/new> (e.g. `FinAssist`), **Private** is fine.
2. In a terminal at the project root, run (replace the URL with yours):
   ```bash
   git add -A
   git commit -m "Deploy-ready: PWA + same-origin + hosting config"
   git branch -M main
   git remote add origin https://github.com/<you>/FinAssist.git
   git push -u origin main
   ```
   The **CI** workflow (`.github/workflows/ci.yml`) now runs on every push: both test
   suites, type-check, lint, a production build and the dependency audit.

## 1. Generate your 4 secrets

Run this **four times** and keep each result (label them JWT, MASTER, EMAIL, PROXY):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Each must be exactly 64 hex characters; the API refuses to start otherwise.

## 2. Database — MongoDB Atlas (free)

1. Sign up at <https://www.mongodb.com/cloud/atlas/register> → **Create** a free **M0** cluster.
2. **Database Access** → Add a database user with **Read and write to any database**
   (not Atlas admin). Avoid `%` in the password (if you must use one, write it as `%25`).
3. **Network Access** → Add IP → **Allow access from anywhere** (`0.0.0.0/0`).
   *(Render's free tier has no fixed IP. The password and TLS protect the cluster.)*
4. **Connect → Drivers** → copy the connection string and add the database name before
   the `?`: `.../finassist?retryWrites=...`. This is your `MONGO_URI`.

## 3. Email — Resend (free)

Production keeps an account inactive until its owner enters the code we email, so the
API **won't start without a mail provider**.

1. Sign up at <https://resend.com>, verify your sending domain, and create an API key.
2. You'll paste it into Render as `RESEND_API_KEY` (Resend's HTTPS API — Render's free
   tier blocks SMTP ports, so use the key, not SMTP).

*(Only for a private demo: you can set `REQUIRE_EMAIL_VERIFICATION=false` instead. The
API then starts without email but warns in its log that ownership isn't proven.)*

## 4. Backend — Render (free)

1. Sign up at <https://render.com> with GitHub.
2. **New → Blueprint** → pick your repo. Render reads `render.yaml` and creates **finassist-api**.
3. Under the service's **Environment**, fill the secrets:
   | Key | Value |
   |-----|-------|
   | `MONGO_URI` | the Atlas string from step 2 |
   | `JWT_SECRET` | your JWT secret |
   | `MASTER_ENCRYPTION_KEY` | your MASTER secret |
   | `EMAIL_HASH_SECRET` | your EMAIL secret |
   | `PROXY_SHARED_SECRET` | your PROXY secret (same value goes into Vercel) |
   | `RESEND_API_KEY` | your Resend key from step 3 |
   | `FRONTEND_URL` | *leave blank for now — you'll set it in step 6* |
4. Deploy. When it's live, copy the URL: `https://finassist-api-XXXX.onrender.com`.
   Check `https://…onrender.com/api/health` returns `{"success":true,...}`. Any other
   API path called directly now answers 403 — that's the proxy secret doing its job.

## 5. Frontend — Vercel (free)

1. Sign up at <https://vercel.com> with GitHub → **Add New → Project** → pick your repo.
2. **Root Directory** → set to **`views`** (the Next.js app lives there).
3. **Environment Variables** → add:
   | Key | Value |
   |-----|-------|
   | `BACKEND_ORIGIN` | your Render URL, **no trailing slash**, e.g. `https://finassist-api-XXXX.onrender.com` |
   | `PROXY_SHARED_SECRET` | the same PROXY secret you gave Render |
4. **Deploy.** Copy your app URL: `https://finassist-XXXX.vercel.app`.

## 6. Connect the two

1. Back in **Render → finassist-api → Environment**, set `FRONTEND_URL` to your Vercel URL
   (no trailing slash). Save → it redeploys.
2. Open your Vercel URL → register. You'll get a 6-digit code by email.

## 7. Upgrading an existing deployment to the October 2026 hardening

Deploy the new code with the environment above, then run these **once**, in order,
from your machine with `Backend/.env` pointing `MONGO_URI` at the production
database (each is a dry run first; add `-- --apply` to write):

```bash
cd Backend
npm run migrate:budget-categories               # budgets: category names → category ids
npm run migrate:field-encryption                # v1 ciphertexts + RSA notes → owner/field-bound v2
npm run migrate:reattest                        # review the list, then: -- --apply
npm run migrate:wrap-legacy-passwords           # wrap old 10k-iteration PBKDF2 hashes in Argon2id
npm run migrate:audit-retention                 # applies the 180-day audit-log TTL index
```

`migrate:reattest` signs records whose attestation doesn't verify over their current
values. Read its dry-run list first: anything you don't recognise as old data
deserves a look before you accept it as the new baseline.

## 8. Keep the backend awake (free, optional but recommended)

Render's free backend sleeps after ~15 min idle (first visit then takes ~50s). To prevent that:
- GitHub repo → **Settings → Secrets and variables → Actions → Variables → New variable**:
  `BACKEND_HEALTH_URL` = `https://finassist-api-XXXX.onrender.com/api/health`.
- The included workflow (`.github/workflows/keep-alive.yml`) pings it every ~14 min.
  `/api/health` is exempt from the proxy secret and the rate limits.

## 9. Install it as an app 📱

FinAssist is a PWA, so it installs like a native app:
- **Android/Chrome:** open the site → menu → **Install app** / **Add to Home screen**.
- **iPhone/Safari:** **Share → Add to Home Screen**.
- **Desktop (Chrome/Edge):** an **Install** icon appears in the address bar.

It launches full-screen with its own icon and works offline for the app shell (your data
still needs a connection, by design — it's financial data).

---

### Rotating a secret later
- **MASTER_ENCRYPTION_KEY:** move the current value to `MASTER_ENCRYPTION_KEY_PREVIOUS`, set a
  new one, deploy, run `npm run rotate:master-key -- --apply`, then remove the previous key.
- **JWT_SECRET:** move it to `JWT_SECRET_PREVIOUS`, set a new one, deploy; remove the previous
  one after 15 minutes (one access-token lifetime). Nobody is signed out.
- **PROXY_SHARED_SECRET:** change it on Vercel and Render together.

See `docs/security/key-management.md` for the details.

### Updating later
Push to the branch Render and Vercel are connected to (for the live FinAssist site,
`feature/initial-scaffolding`, the repo's default branch) → CI runs → both auto-deploy.

### If login fails after deploy
Almost always one of: `FRONTEND_URL` (Render) or `BACKEND_ORIGIN` (Vercel) has a typo or a
trailing slash, `PROXY_SHARED_SECRET` differs between the two, or the Atlas IP allowlist
doesn't include `0.0.0.0/0`. If the API won't start at all, its log names the missing or
malformed setting.
