# Deployment Plan: Vercel now, VPS later

## Current stage (testing on Vercel)

### 1) Frontend hosting
- Host `index.html` app on Vercel as static site.
- Host `worker-app` as a separate Vercel project (recommended), or as a separate route/domain.
- Keep HTTPS enabled for PWA and browser notifications permission flow.

### 2) Backend hosting for test
- Do NOT host ASP.NET API on Vercel serverless for this architecture.
- Run backend on a temporary VM/service (Railway/Render/Fly.io/VPS).
- Expose API via HTTPS domain, example: `https://api-test.yourdomain.com`.

### 3) Configure clients for test
- Set browser `localStorage.api_base` in each frontend to your test API base URL.
- Update backend CORS `Frontend:AllowedOrigins` with exact Vercel domains.
- Verify JWT login, notify flow, worker ack flow.

### 4) Test checklist
- Auth register/login for VIP and Worker.
- Transaction save + Notify worker.
- Worker inbox + acknowledge.
- PWA install prompt on both apps.
- Service worker offline shell behavior.

## Production stage (VPS)

### 1) Infrastructure
- 1 VPS for API + reverse proxy (Nginx/Caddy).
- PostgreSQL on managed service or dedicated DB VPS.
- Optional: Redis for queues/cache and future realtime fan-out.

### 2) Domains
- `vip.yourdomain.com` -> VIP frontend
- `worker.yourdomain.com` -> Worker frontend
- `api.yourdomain.com` -> ASP.NET API

### 3) Security baseline
- Strong JWT secret in environment variables, not in source files.
- Enforce HTTPS only.
- Add rate limiting for auth and notify endpoints.
- Add request logging and error monitoring.

### 4) Runtime and operations
- Dockerize backend for reproducible deploys.
- CI/CD pipeline for build/test/deploy.
- Daily DB backup and restore test.
- Health check and uptime monitor.

### 5) Production readiness tasks
- Replace polling notifications with SignalR realtime transport.
- Add audit trail for notify + worker cash actions.
- Add refresh token strategy if long sessions need safer rotation.
- Add role-based admin/developer page only for internal users.

## Migration path from test to production
- Keep API contracts stable (`/api/auth`, `/api/notifications`, `/api/workercashactions`).
- Move `api_base` from localStorage to environment-driven config build-time variables.
- Roll out frontend first, then switch DNS for API after smoke tests.
