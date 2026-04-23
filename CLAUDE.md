# FinAssist

Personal finance management app — expense tracking, budgets, savings goals, AI analytics.

## Structure

```
FinAssist/
├── Backend/          Express 4 REST API (port 5000)
└── views/            Next.js 16 frontend (port 3000)
```

## Running locally

**Prerequisites:** MongoDB running on 27017 (or Atlas URI in .env)

```bash
# Terminal 1 — Backend
cd Backend && npm install && npm run dev

# Terminal 2 — Frontend
cd views && npm install && npm run dev
```

Open http://localhost:3000

## Environment setup

```bash
cp Backend/.env.example Backend/.env        # fill in your values
cp views/.env.local.example views/.env.local
```

## Running with Docker

```bash
cp .env.example .env   # fill in MONGO_URI and JWT_SECRET
docker-compose up --build
```

## API base

All endpoints prefixed `/api/` — see `Backend/routes/` for full list.
Auth: JWT Bearer token via `Authorization` header.

## Key decisions

- Budget route order: specific routes (`/tracking`, `/alerts`, `/reset`) must stay above `/:id`
- Expense route order: `/summary/:year/:month` must stay above `/:id`
- MongoDB Atlas connection string: `%` in password must be URL-encoded as `%25`
- Zustand auth persisted to `localStorage` under key `finassist-auth`
