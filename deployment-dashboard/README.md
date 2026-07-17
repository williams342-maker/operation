# Deployment & Server Management Dashboard

Secure local admin dashboard for deployment, PM2 service control, environment management, logs, MongoDB health checks, and backups.

## Stack

- Frontend: React + Vite + TypeScript + Tailwind CSS
- Backend: Node.js + Express + TypeScript
- Auth: JWT bearer token with `role: "admin"`
- Process manager: PM2
- Source control: GitHub / git remote
- Database: MongoDB Atlas or local MongoDB

## Development

Backend:

```powershell
cd deployment-dashboard\backend
npm install
npm run dev
```

Frontend:

```powershell
cd deployment-dashboard\frontend
npm install
npm run dev
```

URLs:

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000

## Security Model

- Every API route requires a JWT with `role: "admin"` unless explicitly disabled for local development.
- Mutating requests require a CSRF token header.
- Secret env values are never returned in plaintext. Secret fields are masked and may be kept unchanged on save.
- Shell execution is allowlisted and uses `spawn` without shell interpolation.
- Settings constrain server paths, PM2 process names, branch names, and command args.

## Configuration

Copy `backend/config.example.json` to `backend/config.local.json` and adjust paths/process names.

The backend resolves settings in this order:

1. `config.local.json`
2. `config.example.json`

Set `DASHBOARD_JWT_SECRET` to the same secret used by the existing admin JWT issuer, or configure a local token for development.

## Phase Coverage

Phase 1: Dashboard shell, auth guard, status page.

Phase 2: `.env` editor with validation and backups.

Phase 3: GitHub update checker and deployment pipeline.

Phase 4: PM2 controls and log viewer.

Phase 5: MongoDB test and health checks.

Phase 6: Backup/restore and deployment history foundation.
