# CareDesk

CareDesk is a full-stack care-support platform with:

- NestJS backend API
- React + Vite frontend
- Real-time messaging over WebSocket
- AI-assisted triage and response support
- Queue + DLQ processing for resilient async flows
- Analytics and evaluation features for specialist performance

## Project Structure

- `server`: NestJS backend
- `client`: React frontend
- `package.json` (root): workspace-level scripts for running both apps

## Prerequisites

- Node.js 20+
- npm 10+
- MongoDB running locally or remotely
- Redis running locally or remotely

Default local ports:

- Backend: `3000`
- Frontend: `5173`

## Quick Start (Recommended)

1. Install dependencies for both backend and frontend:

```bash
npm install
npm run install:all
```

2. Configure environment files:

- Backend env:
  - Copy `server/.env.example` to `server/.env`
  - Fill required values (especially `JWT_SECRET` and AI provider keys)
- Frontend env:
  - Copy `client/.env.example` to `client/.env`

3. Start both apps together from repository root:

```bash
npm run dev
```

This runs:

- `server` with Nest watch mode
- `client` with Vite dev server

## Running Apps Separately

Backend only:

```bash
npm run dev:server
```

Frontend only:

```bash
npm run dev:client
```

## Environment Variables

### Backend (`server/.env`)

Use `server/.env.example` as the source of truth. Key variables include:

- `PORT`
- `NODE_ENV`
- `MONGODB_URI`
- `REDIS_URL`
- `JWT_SECRET`
- `JWT_EXPIRATION`
- `JWT_REFRESH_EXPIRATION`
- `OPENROUTER_API_KEY` (primary AI provider)
- `GEMINI_API_KEY` (fallback)
- `OPENAI_API_KEY` (fallback)
- `WS_CORS_ORIGIN`

Optional operations/security settings are also documented in `server/.env.example`:

- Rate limiter configuration
- Idempotency mode
- Trust proxy
- Admin bootstrap controls

### Frontend (`client/.env`)

Use `client/.env.example`:

- `VITE_API_URL` (backend HTTP URL)
- `VITE_WS_URL` (backend WebSocket URL)

For local development:

- `VITE_API_URL=http://localhost:3000`
- `VITE_WS_URL=http://localhost:3000`

## Build

Build both apps from root:

```bash
npm run build
```

Or per app:

```bash
npm run build:server
npm run build:client
```

## Test and Lint

Backend lint:

```bash
npm run lint
```

Backend unit tests:

```bash
npm run test
```

Backend e2e tests:

```bash
npm run test:e2e
```

## Useful Operational CLI Commands

Create specialist account:

```bash
cd server
npm run create:specialist
```

Reset database (development only, destructive):

```bash
cd server
npm run db:reset
```

## Troubleshooting

- If `npm run dev` at root fails, ensure root `npm install` was run.
- If backend cannot start, check:
  - MongoDB availability
  - Redis availability (or fallback behavior if intentionally unavailable)
  - `server/.env` values
- If frontend opens on another port (for example `5174`), update `WS_CORS_ORIGIN` in backend env if needed.
- If port `3000` is already in use, stop the conflicting process or change `PORT` in backend env.

## Production Notes

- Set `NODE_ENV=production`
- Use strong secrets for JWT and admin bootstrap values
- Use strict CORS origins
- Prefer `IDEMPOTENCY_MODE=redis-required` in production
- Ensure MongoDB and Redis are managed services with proper backups/monitoring
