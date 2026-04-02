# Task 6 - Observabilidad y administracion

Nota: esta task describe el modelo de administracion remota de la v1. En la v2, las operaciones admin de escritura salen de la API HTTP y se sustituyen por una interfaz local `CLI/TUI`; ver `task/task_9.md` y `task/task_10.md`.

## Objetivo

Implementar todos los endpoints de consulta y administracion del servicio: estado de jobs, historial reciente, despliegues manuales, redeploy del ultimo exitoso y retry de jobs fallidos. Todos los endpoints admin estan protegidos con tokens diferenciados de lectura y escritura.

---

## Dependencias previas

- Task 1: servidor Express base con router y estructura `src/api/controllers/`.
- Task 2: config disponible con tokens admin resueltos.
- Task 3: rate limiter para admin disponible.
- Task 4: `getJob`, `getRecentJobs`, `enqueueDeployJob` disponibles.
- Task 5: `readRollbackState` disponible para `redeploy-last-successful`.

---

## Quehaceres

### 6.1 Implementar autenticacion admin (`src/auth/admin.auth.ts`)

**Middleware: `requireAdminRead`**

```typescript
export function requireAdminRead(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  const { adminReadToken, adminWriteToken } = getConfig().server.security;
  const validRead = crypto.timingSafeEqual(Buffer.from(token), Buffer.from(adminReadToken));
  const validWrite = crypto.timingSafeEqual(Buffer.from(token), Buffer.from(adminWriteToken));
  if (!validRead && !validWrite) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}
```

**Middleware: `requireAdminWrite`**
Igual pero solo acepta el write token:

```typescript
const valid = crypto.timingSafeEqual(Buffer.from(token), Buffer.from(adminWriteToken));
```

**Funcion auxiliar: `extractBearerToken(req): string`**

- Leer `Authorization` header.
- Si falta o no empieza por `Bearer `: lanzar error que el middleware convierte a `401`.

### 6.2 Implementar `GET /health` completo (`src/api/controllers/health.controller.ts`)

Ampliar el health basico de Task 1 con informacion del estado del sistema:

```json
{
  "status": "ok",
  "server_id": "prod-app-1",
  "uptime_seconds": 3600,
  "redis": "connected",
  "worker": "running",
  "queue": {
    "pending": 0,
    "running": 0
  },
  "version": "0.1.0"
}
```

- `redis`: verificar que el cliente Redis responde con PING.
- `worker`: estado del worker BullMQ.
- `queue.pending`: numero de jobs en estado `pending`.
- `queue.running`: 0 o 1.

Si Redis no responde: `{ "status": "degraded", "redis": "disconnected" }` con HTTP `503`.

### 6.3 Implementar `GET /jobs/:id` (`src/api/controllers/jobs.controller.ts`)

```
GET /jobs/:id
Auth: admin read
```

Respuesta si existe:

```json
{
  "id": "uuid",
  "status": "success",
  "payload": {
    "repository": "owner/repo",
    "environment": "production",
    "tag": "sha-abc1234",
    "triggeredBy": "webhook"
  },
  "createdAt": "2026-04-01T12:00:00Z",
  "startedAt": "2026-04-01T12:00:01Z",
  "finishedAt": "2026-04-01T12:00:46Z",
  "durationMs": 45000,
  "error": null,
  "rollbackTag": null,
  "logs": [
    "[2026-04-01T12:00:01Z] Running docker compose pull...",
    "[2026-04-01T12:00:30Z] Running docker compose up -d...",
    "[2026-04-01T12:00:45Z] Healthcheck passed",
    "[2026-04-01T12:00:46Z] Deployment successful"
  ]
}
```

Si no existe: `404 Not Found` con `{ "error": "job_not_found" }`.

### 6.4 Implementar `GET /deployments/recent` (`src/api/controllers/jobs.controller.ts`)

```
GET /deployments/recent
Auth: admin read
Query params:
  - repository: string (opcional, filtra por repo)
  - environment: string (opcional, filtra por entorno)
  - limit: number (opcional, max 100, default 20)
```

Respuesta:

```json
{
  "jobs": [
    {
      "id": "uuid",
      "repository": "owner/repo",
      "environment": "production",
      "tag": "sha-abc1234",
      "status": "success",
      "createdAt": "2026-04-01T12:00:00Z",
      "durationMs": 45000,
      "triggeredBy": "webhook"
    }
  ],
  "total": 1
}
```

Usar `getRecentJobs(repo?, env?, limit?)` del Queue Manager.
No incluir `logs` en la lista (solo en `GET /jobs/:id`).

### 6.5 Implementar `POST /admin/deploy` (`src/api/controllers/admin.controller.ts`)

```
POST /admin/deploy
Auth: admin write
```

**Body:**

```json
{
  "repository": "owner/repo",
  "environment": "production",
  "tag": "sha-abc1234",
  "force": false
}
```

**Validacion:**

Usar Zod:

```typescript
const AdminDeploySchema = z.object({
  repository: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
  environment: z.string().min(1),
  tag: z.string().min(1),
  force: z.boolean().default(false),
});
```

**Restricciones del target que SI se aplican:**

- `repository` debe existir en la config.
- `environment` debe existir en la config del repo.
- `tag` debe cumplir `allowed_tag_pattern`.
- El `runtime_env_file` y `compose_file` deben existir.

**Restricciones que NO se aplican en admin:**

- `allowed_workflows` (no hay workflow en deploy manual).
- `allowed_branches` (no hay ref_name).
- No se valida `run_id`.

**Flujo:**

- Construir `DeployJobPayload` con `triggeredBy: 'admin'`, `workflow: 'manual'`, `refName: 'manual'`, `runId: 0`.
- Llamar a `enqueueDeployJob(payload)`.
- Responder `202 Accepted` con `{ status, job_id }`.

### 6.6 Implementar `POST /admin/deploy/redeploy-last-successful` (`src/api/controllers/admin.controller.ts`)

```
POST /admin/deploy/redeploy-last-successful
Auth: admin write
```

**Body:**

```json
{
  "repository": "owner/repo",
  "environment": "production",
  "force": false
}
```

**Flujo:**

1. Validar que `repository` y `environment` existen en config.
2. Leer `readRollbackState(repository, environment)`.
3. Si `successfulTag` es `null`: responder `404` con `{ error: 'no_successful_deployment_found' }`.
4. Construir payload con `tag: state.successfulTag`, `triggeredBy: 'admin'`.
5. Llamar a `enqueueDeployJob(payload)` (con `force` si se indico).
6. Responder `202 Accepted` con `{ status, job_id, tag: state.successfulTag }`.

### 6.7 Implementar `POST /admin/jobs/:id/retry` (`src/api/controllers/admin.controller.ts`)

```
POST /admin/jobs/:id/retry
Auth: admin write
```

**Query params:**

- `force=true` (opcional, para saltar deduplicacion).

**Flujo:**

1. Leer job por ID via `getJob(id)`.
2. Si no existe: `404 Not Found`.
3. Si el job no esta en estado `failed`, `rolled_back` o `rollback_failed`: responder `409 Conflict` con `{ error: 'job_not_retryable', current_status: job.status }`.
4. Construir nuevo `DeployJobPayload` a partir del payload del job original, con `triggeredBy: 'admin'`.
5. Si `force=true`: pasar `force: true` al encolado.
6. Llamar a `enqueueDeployJob`.
7. Responder `202 Accepted` con el nuevo `job_id`.

### 6.8 Router completo (`src/api/router.ts`)

```typescript
import { adminRateLimiter, webhookRateLimiter } from './middlewares/rate-limiter';
import { requireAdminRead, requireAdminWrite } from '../auth/admin.auth';

router.post('/deploy', webhookRateLimiter, rawBodyMiddleware, deployController);
router.get('/health', healthController);
router.get('/jobs/:id', adminRateLimiter, requireAdminRead, getJobController);
router.get('/deployments/recent', adminRateLimiter, requireAdminRead, getRecentController);
router.post('/admin/deploy', adminRateLimiter, requireAdminWrite, adminDeployController);
router.post(
  '/admin/deploy/redeploy-last-successful',
  adminRateLimiter,
  requireAdminWrite,
  adminRedeployLastController,
);
router.post('/admin/jobs/:id/retry', adminRateLimiter, requireAdminWrite, adminRetryController);
```

### 6.9 Tests de endpoints admin

Crear `src/api/controllers/admin.controller.test.ts`:

- `GET /health` responde `200` con campos esperados.
- `GET /health` responde `503` si Redis no responde.
- `GET /jobs/:id` responde `200` para job existente con todos los campos.
- `GET /jobs/:id` responde `404` para job inexistente.
- `GET /jobs/:id` responde `401` sin token.
- `GET /jobs/:id` responde `200` con token de lectura.
- `GET /jobs/:id` responde `200` con token de escritura.
- `GET /deployments/recent` devuelve lista paginada.
- `GET /deployments/recent` filtra por repo y environment.
- `POST /admin/deploy` responde `202` con payload valido.
- `POST /admin/deploy` responde `403` con tag que no cumple patron.
- `POST /admin/deploy` responde `404` para repo desconocido.
- `POST /admin/deploy` responde `401` con token de lectura (requiere escritura).
- `POST /admin/deploy/redeploy-last-successful` responde `404` si no hay successful deployment.
- `POST /admin/jobs/:id/retry` responde `409` si el job esta en estado `pending`.
- `POST /admin/jobs/:id/retry` responde `202` para job fallido.
- `POST /admin/jobs/:id/retry` con `force=true` salta deduplicacion.

---

## Criterios de aceptacion

- [ ] `GET /health` refleja estado real de Redis y la cola.
- [ ] `GET /jobs/:id` incluye logs detallados del despliegue.
- [ ] `GET /deployments/recent` soporta filtrado por repo y environment.
- [ ] Token de lectura da acceso a consultas pero NO a operaciones.
- [ ] Token de escritura da acceso a todo.
- [ ] `POST /admin/deploy` aplica restricciones del target (patron de tag, repo y env en config).
- [ ] `POST /admin/deploy` NO aplica restricciones de workflow ni branch.
- [ ] `POST /admin/deploy/redeploy-last-successful` devuelve error claro si no hay historial.
- [ ] `POST /admin/jobs/:id/retry` solo funciona para jobs en estado fallido.
- [ ] Tests cubren diferenciacion de tokens y restricciones de deploy manual.
