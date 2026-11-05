# FinAssist web app

The Next.js 16 frontend of FinAssist. The project overview, screenshots and setup
are in the [root README](../README.md); this page covers only this folder.

```bash
npm install
cp .env.local.example .env.local
npm run dev        # http://localhost:3000, with the API running on :5000
```

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev server. `src/proxy.ts` forwards `/api/*` to `BACKEND_ORIGIN` and sets the page's CSP |
| `npm test` | Unit tests (node:test, files in `src/**/__tests__/`) |
| `npx tsc --noEmit` | Type-check |
| `npm run lint` | ESLint |
| `npm run build` | Production build |

## Where things are

- `src/app/` — routes: `(auth)` sign-in, register and password reset; `dashboard/*` the app.
- `src/components/dashboard/ui.tsx` — the shared pieces every page is built from
  (page header, hero figure, card, meter, notices, empty states).
- `src/lib/` — data and maths kept out of components and unit-tested: the
  stale-while-revalidate `useApi` cache, money formatting, dates, the safe-to-spend
  and pay-period model, quick-add parsing.
- `DESIGN.md` — the visual system (colour, type, motion, charts) and its rules.
- `PRODUCT.md` — who it's for, what it does today, and what it must never claim.
