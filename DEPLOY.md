# Deploying FinAssist — free, step by step

This puts FinAssist online at **$0/month** and makes it installable as an app (PWA):

- **Frontend** → Vercel (Hobby, free)
- **Backend** → Render (free web service, Docker)
- **Database** → MongoDB Atlas (M0, free forever)

The app and API end up **same-origin** (Vercel proxies `/api` to Render), which is
what makes the secure login cookies work. You don't need to understand that — just
follow the steps.

> ⚠️ **One thing you must not lose:** `MASTER_ENCRYPTION_KEY`. It encrypts every
> user's email, name, goal titles, and notes. If you lose it, that data is gone
> forever. Save all three secrets (below) in a password manager.

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

## 1. Generate your 3 secrets

Run this **three times** and keep each result (label them JWT, MASTER, EMAIL):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Save them in your password manager. You'll paste them into Render in step 3.

## 2. Database — MongoDB Atlas (free)

1. Sign up at <https://www.mongodb.com/cloud/atlas/register> → **Create** a free **M0** cluster.
2. **Database Access** → Add a database user (username + password). Avoid `%` in the
   password (if you must use one, write it as `%25` in the connection string).
3. **Network Access** → Add IP → **Allow access from anywhere** (`0.0.0.0/0`).
   *(Render's free tier has no fixed IP, so this is required.)*
4. **Connect → Drivers** → copy the connection string. It looks like:
   `mongodb+srv://USER:PASSWORD@cluster.mongodb.net/?retryWrites=true&w=majority`
   Add the database name before the `?`: `.../finassist?retryWrites=...`. This is your `MONGO_URI`.

## 3. Backend — Render (free)

1. Sign up at <https://render.com> with GitHub.
2. **New → Blueprint** → pick your repo. Render reads `render.yaml` and creates **finassist-api**.
3. When prompted (or under the service's **Environment**), fill the secrets:
   | Key | Value |
   |-----|-------|
   | `MONGO_URI` | the Atlas string from step 2 |
   | `JWT_SECRET` | your JWT secret |
   | `MASTER_ENCRYPTION_KEY` | your MASTER secret |
   | `EMAIL_HASH_SECRET` | your EMAIL secret |
   | `FRONTEND_URL` | *leave blank for now — you'll set it in step 5* |
   | `SMTP_*` | optional — see step 6 |
4. Deploy. When it's live, copy the URL: `https://finassist-api-XXXX.onrender.com`.
   Check `https://…onrender.com/api/health` returns `{"success":true,...}`.

## 4. Frontend — Vercel (free)

1. Sign up at <https://vercel.com> with GitHub → **Add New → Project** → pick your repo.
2. **Root Directory** → set to **`views`** (important — the Next.js app lives there).
3. **Environment Variables** → add:
   | Key | Value |
   |-----|-------|
   | `BACKEND_ORIGIN` | your Render URL from step 3, **no trailing slash**, e.g. `https://finassist-api-XXXX.onrender.com` |
4. **Deploy.** Copy your app URL: `https://finassist-XXXX.vercel.app`.

## 5. Connect the two

1. Back in **Render → finassist-api → Environment**, set `FRONTEND_URL` to your Vercel URL
   (no trailing slash), e.g. `https://finassist-XXXX.vercel.app`. Save → it redeploys.
2. Open your Vercel URL → register an account.

## 6. Email verification (so you can actually log in)

New accounts must verify their email before login. Pick one:

- **Best (free): Resend.** Sign up at <https://resend.com> (3,000 emails/mo free), create an API
  key, then in Render set: `SMTP_HOST=smtp.resend.com`, `SMTP_USER=resend`,
  `SMTP_PASS=<your API key>`, `SMTP_PORT=587`. Redeploy. Verification emails now send.
- **Quick fallback (just your own account):** in Atlas → Collections → `users`, find your
  user and set `emailVerified` to `true`. Then log in.

## 7. Keep the backend awake (free, optional but recommended)

Render's free backend sleeps after ~15 min idle (first visit then takes ~50s). To prevent that:
- GitHub repo → **Settings → Secrets and variables → Actions → Variables → New variable**:
  `BACKEND_HEALTH_URL` = `https://finassist-api-XXXX.onrender.com/api/health`.
- The included workflow (`.github/workflows/keep-alive.yml`) pings it every ~14 min.

## 8. Install it as an app 📱

FinAssist is a PWA, so it installs like a native app:
- **Android/Chrome:** open the site → menu → **Install app** / **Add to Home screen**.
- **iPhone/Safari:** **Share → Add to Home Screen**.
- **Desktop (Chrome/Edge):** an **Install** icon appears in the address bar.

It launches full-screen with its own icon and works offline for the app shell (your data
still needs a connection, by design — it's financial data).

---

### Updating later
Push to `main` → Render and Vercel auto-deploy. That's it.

### If login fails after deploy
Almost always one of: `FRONTEND_URL` (Render) or `BACKEND_ORIGIN` (Vercel) has a typo or a
trailing slash, or the Atlas IP allowlist doesn't include `0.0.0.0/0`. Re-check those three.
