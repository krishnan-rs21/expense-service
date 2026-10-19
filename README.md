# Expense Service

A small Express API backed by PostgreSQL. It stores people and project funding records in INR.

## Requirements

- Node.js 20 or later
- PostgreSQL 14 or later

## Setup

1. Create a PostgreSQL database, for example `expense_service`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to your database connection string.
3. Install dependencies and create/populate the tables:

```sh
npm install
npm run db:setup
```

4. Start the API:

```sh
npm run dev
```

The server listens on `http://localhost:3000` by default.

## Endpoints

- `GET /health` - verifies the database connection
- `GET /api/people` - lists people and roles
- `GET /api/projects` - lists project budgets and funds received
- `GET /api/orders` - lists project orders with requester, amount, description, and status
- `POST /api/auth/login` - signs in with a seeded email and the shared local seed password
- `GET /api/requests?status=` - lists requests visible to the signed-in user
- `POST /api/requests` - creates a request
- `GET /api/requests/:id` - gets a request with its history
- `PATCH /api/requests/:id` - edits a request before manager review
- `POST /api/requests/:id/cancel` - cancels a request awaiting review
- `POST /api/requests/:id/approve` and `/api/requests/:id/reject` - processes the current approval step
- `GET /api/approvals` - lists requests waiting for the signed-in user's role

`npm run db:migrate` applies pending migrations. `npm run db:seed` can be rerun safely to insert or update the provided sample data.

All `/api` routes except login require `Authorization: Bearer <token>`. Managers approve first; accounts then finalize. For local development, all seeded users share the password `Test@123`, defined in `src/seed.js`.
