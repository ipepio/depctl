# Arquitectura

Nota: este documento describe la arquitectura y la superficie HTTP actuales de la v1. La arquitectura objetivo de la v2, con `CLI/TUI` local y sin escrituras admin remotas, se documenta en `docs/arquitectura-v2.md`.

## Resumen

`docker-deploy-webhook` es un servicio HTTP pequeno, desplegado una vez por servidor, que recibe eventos de GitHub Actions y ejecuta despliegues Docker Compose locales de forma controlada.

Cada servidor tiene su propia instancia del servicio, su propia URL de webhook y su propia configuracion YAML. No hay comunicacion entre instancias. La coordinacion multi-servidor la hace GitHub Actions llamando a varias URLs.

---

## Vista de componentes

```text
+-------------------------------------------------------------+
|  docker-deploy-webhook (contenedor Docker)                  |
|                                                             |
|  +-----------+    +------------+    +------------------+   |
|  | API HTTP  |--->| Auth Layer |--->| Request Handler  |   |
|  | Express   |    | Bearer     |    | Validacion       |   |
|  |           |    | HMAC       |    | payload vs config|   |
|  +-----------+    | Anti-replay|    +--------+---------+   |
|                   +------------+             |             |
|                                              v             |
|                                    +---------+----------+  |
|                                    | Queue Manager      |  |
|                                    | Deduplicacion      |  |
|                                    | Redis (BullMQ)     |  |
|                                    +---------+----------+  |
|                                              |             |
|                                              v             |
|                                    +---------+----------+  |
|                                    | Deploy Worker      |  |
|                                    | (concurrencia 1)   |  |
|                                    +---------+----------+  |
|                                              |             |
|             +--------------------------------+             |
|             |                |               |             |
|             v                v               v             |
|  +----------+--+  +----------+--+  +---------+----------+ |
|  | Executor     |  | State Store |  | Notifier           | |
|  | Docker CLI   |  | Redis       |  | Telegram           | |
|  | via socket   |  | Disco       |  | Resend             | |
|  +----------+--+  +-------------+  +--------------------+ |
|             |                                              |
+-------------|----------------------------------------------+
              |
              v
+-------------+-----------+
| Docker Engine del host  |
| /var/run/docker.sock    |
+-------------------------+
```

---

## Componentes

### 1. API HTTP (Express)

Expone todos los endpoints del servicio. Aplica middlewares en orden:

- Logger de peticiones.
- Rate limiter por IP y por ruta.
- Body parser (raw para poder validar HMAC sobre el body sin parsear).
- Enrutado hacia controladores.

Rutas:

- `POST /deploy` - webhook automatico
- `GET /health` - estado del servicio
- `GET /jobs/:id` - estado de un job (auth: admin read)
- `GET /deployments/recent` - historial (auth: admin read)
- `POST /admin/deploy` - deploy manual (auth: admin write)
- `POST /admin/deploy/redeploy-last-successful` - redeploy ultimo exitoso (auth: admin write)
- `POST /admin/jobs/:id/retry` - reintentar job (auth: admin write)

### 2. Capa de autenticacion

Dos flujos distintos:

**Webhook automatico (`POST /deploy`)**

1. Leer `Authorization: Bearer <token>` y extraer `repository` del body raw.
2. Buscar la config del repo en `config/repos/*.yml`.
3. Comparar el Bearer con el valor de `bearer_token_env` del repo (constante de tiempo via `timingSafeEqual`).
4. Reconstruir la firma: `HMAC_SHA256(hmac_secret, timestamp + "." + raw_body)`.
5. Comparar la firma recibida con la calculada (constante de tiempo).
6. Comprobar que `|now - timestamp| <= replay_window_seconds`.

**Endpoints admin**

1. Leer `Authorization: Bearer <token>`.
2. Comparar con `DEPLOY_ADMIN_READ_TOKEN` (endpoints de lectura).
3. Comparar con `DEPLOY_ADMIN_WRITE_TOKEN` (endpoints de escritura).

### 3. Validacion de payload

Despues de la autenticacion se valida el payload contra la config local del repo:

- `repository` existe en la config.
- `environment` existe en la config del repo.
- `workflow` esta en `allowed_workflows` del entorno.
- `ref_name` esta en `allowed_branches` del entorno.
- `tag` cumple el patron `allowed_tag_pattern` del entorno.

Si cualquier campo no cumple: `403 Forbidden` con mensaje generico.

### 4. Queue Manager

Gestiona la cola global del servidor usando Redis.

**Responsabilidades:**

- Crear jobs con UUID, metadata completa y estado inicial `pending`.
- Aplicar semantica de deduplicacion antes de encolar:
  1. Si ya existe un job `pending` o `running` con el mismo `repo + environment + tag`: ignorar (devolver `job_id` del existente).
  2. Si ya existe un job `pending` (no `running`) para el mismo `repo + environment` con distinto tag: cancelar el pendiente y encolar el nuevo.
  3. En cualquier otro caso: encolar normalmente.
- Persistir toda la metadata del job en Redis con TTL configurado.
- Al arrancar: revisar si hay jobs en estado `running` y marcarlos `failed` (reinicio detectado).

### 5. Deploy Worker

Loop que procesa jobs de la cola de uno en uno (concurrencia 1).

**Ciclo de vida de un job:**

```
1. Tomar siguiente job de la cola (bloquea si esta vacia)
2. Marcar job como running
3. Ejecutar motor de despliegue
4. Marcar job como success/failed/rolled_back/rollback_failed
5. Registrar en historial Redis
6. Actualizar estado en disco si corresponde
7. Enviar notificaciones
8. Volver al paso 1
```

### 6. Motor de despliegue (Executor)

Ejecuta los pasos del despliegue para un target dado.

**Pasos en orden:**

```
1. Resolver config del target (compose_file, runtime_env_file, services, image_name)
2. Leer current successful_tag del disco -> guardarlo como previous_tag
3. Escribir IMAGE_NAME e IMAGE_TAG en runtime_env_file
4. docker compose -f <compose_file> --env-file <runtime_env_file> pull <services>
   (con timeout, reintentos para errores de red)
5. docker compose -f <compose_file> --env-file <runtime_env_file> up -d <services>
   (con timeout)
6. Si healthcheck.enabled: polling HTTP hasta success o timeout
7. Si todo ok: actualizar successful_tag en disco y Redis, retornar success
8. Si fallo en paso 3+: intentar rollback (ver abajo)
9. Si fallo en paso 1-2: retornar failed sin rollback
```

**Rollback:**

```
1. Si no hay previous_tag: no se puede hacer rollback, retornar failed
2. Escribir IMAGE_NAME e IMAGE_TAG=previous_tag en runtime_env_file
3. docker compose pull <services> (sin reintento, timeout normal)
4. docker compose up -d <services>
5. Si healthcheck.enabled: verificar salud
6. Si ok: retornar rolled_back
7. Si falla: retornar rollback_failed
```

**Ejecucion de comandos Docker:**

- Usar `child_process.execFile` o `spawn` con array de argumentos. Nunca template strings.
- Capturar stdout y stderr siempre.
- Aplicar timeout via `AbortController`.
- En caso de timeout: matar el proceso y tratar como fallo transitorio.

### 7. State Store

Dos niveles de persistencia:

**Redis (corto plazo)**

- `job:<id>` - metadata completa del job (estado, timestamps, logs, resultado).
- `jobs:recent:<repo>:<env>` - lista de IDs de jobs recientes (maximo `max_jobs`, TTL `ttl_seconds`).
- `state:pending:<repo>:<env>` - ID del job pendiente actual para ese target.
- `state:running` - ID del job actualmente en ejecucion.

**Disco (largo plazo, rollback)**

- `data/state/<owner>/<repo>/<environment>.json`:

```json
{
  "successful_tag": "sha-abc1234",
  "previous_tag": "sha-xyz9876",
  "deployed_at": "2026-04-01T12:00:00Z",
  "job_id": "uuid"
}
```

Este archivo se actualiza solo cuando un despliegue termina en `success` o `rolled_back`.

### 8. Notificaciones

Sistema opcional de notificaciones al finalizar cada job.

**Resolucion de destinatarios:**

1. Tomar config base del servidor (`notifications.telegram.chat_ids`, `notifications.email.recipients`).
2. Si el repo/environment tiene override, usar esos en su lugar (no merge, reemplaza).

**Mensaje de notificacion (ejemplo):**

```
[SUCCESS] acme/clash-hub-api
Entorno: production
Tag: sha-abc1234
Servidor: prod-app-1
Job: <uuid>
Duracion: 45s
```

**Comportamiento:**

- Las notificaciones son fire-and-forget. Un fallo al notificar no cambia el estado del job.
- Se aplica un timeout de red por cada intento de notificacion (10s).
- Si ninguna notificacion esta configurada, el bloque se salta completamente.

---

## Flujo automatico completo

```
GitHub Actions
    |
    | POST /deploy
    | Headers: Authorization, X-Deploy-Timestamp, X-Deploy-Signature
    | Body: { repository, environment, tag, sha, workflow, ref_name, run_id }
    v
API HTTP
    |
    |--> Rate limiter: rechazar si excede limite por IP
    |--> Auth: validar Bearer del repo
    |--> Auth: validar HMAC del body
    |--> Auth: validar anti-replay por timestamp
    |--> Validacion: resolver repo en config local
    |--> Validacion: environment, workflow, ref_name, tag contra config
    |
    v
Queue Manager
    |
    |--> Caso A: mismo repo+env+tag ya en cola/running -> ignorar, devolver job_id existente
    |--> Caso B: mismo repo+env con distinto tag en pending -> cancelar pending, encolar nuevo
    |--> Caso C: normal -> crear job, encolar
    |
    v (202 Accepted + job_id al caller)
    |
Deploy Worker (async)
    |
    |--> Leer config del target
    |--> Guardar previous_tag
    |--> Escribir runtime_env_file
    |--> docker compose pull
    |--> docker compose up -d
    |--> healthcheck (si configurado)
    |
    |--> [success] -> actualizar successful_tag, notificar
    |--> [fallo post-tag] -> rollback si hay previous_tag, notificar
    |--> [fallo pre-tag] -> marcar failed, notificar
```

---

## Flujo manual (admin)

```
Operador
    |
    | POST /admin/deploy
    | Authorization: Bearer <admin_write_token>
    | Body: { repository, environment, tag, force? }
    v
API HTTP
    |
    |--> Auth: validar admin write token
    |--> Validacion: resolver repo en config local
    |--> Validacion: environment y tag contra config del target
    |    (se omiten: workflow, ref_name, run_id)
    |--> Deduplicacion normal (salvo si force=true)
    |
    v
Queue Manager -> Deploy Worker (mismo flujo que automatico)
```

---

## Semantica de cola detallada

| Situacion                                                    | Comportamiento                               |
| ------------------------------------------------------------ | -------------------------------------------- |
| Cola vacia                                                   | El worker bloquea esperando el siguiente job |
| Job A en running, llega job B (repo distinto)                | Job B se encola, espera a que A termine      |
| Job A en running, llega job B (mismo repo+env, distinto tag) | Job B se encola como pendiente               |
| Job pendiente X, llega job Y (mismo repo+env, distinto tag)  | X se cancela, Y se encola                    |
| Llega job con mismo repo+env+tag que uno pending o running   | Se ignora, se devuelve job_id del existente  |
| Servicio reinicia con job en running                         | El job se marca failed al arrancar           |
| Admin con force=true, mismo repo+env+tag                     | Se encola aunque sea duplicado               |

---

## Estructura de configuracion

### `config/server.yml`

```yaml
server:
  id: <string> # Identificador unico del servidor
  port: <number> # Puerto HTTP (default: 8080)
  history:
    max_jobs: <number> # Maximo de jobs en historial Redis (default: 250)
    ttl_seconds: <number> # TTL de jobs en Redis (default: 604800 = 7 dias)
  rate_limit:
    webhook_per_minute: <number> # Requests al webhook por IP por minuto
    admin_per_minute: <number> # Requests a endpoints admin por IP por minuto
  security:
    replay_window_seconds: <number> # Ventana anti-replay (default: 300)
    admin_read_token_env: <string> # Nombre de la env var con el token de lectura
    admin_write_token_env: <string> # Nombre de la env var con el token de escritura
  defaults:
    pull_timeout_ms: <number>
    up_timeout_ms: <number>
    healthcheck_timeout_ms: <number>
    healthcheck_interval_ms: <number>
    retry_attempts: <number>
    retry_backoff_ms: <number>
  notifications:
    telegram:
      enabled: <boolean>
      bot_token_env: <string> # Nombre de la env var con el token del bot
      chat_ids: <string[]> # Chat IDs destino por defecto
    email:
      enabled: <boolean>
      resend_api_key_env: <string> # Nombre de la env var con la API key de Resend
      from: <string> # Direccion remitente
      recipients: <string[]> # Destinatarios por defecto
```

### `config/repos/<nombre>.yml`

```yaml
repository: <owner/repo>
webhook:
  bearer_token_env: <string> # Nombre de la env var con el Bearer del repo
  hmac_secret_env: <string> # Nombre de la env var con el HMAC secret del repo
environments:
  <nombre_entorno>:
    image_name: <string> # ghcr.io/owner/image (sin tag)
    compose_file: <string> # Ruta absoluta al docker-compose.yml del target
    runtime_env_file: <string> # Ruta absoluta al .env que recibira IMAGE_NAME/TAG
    services: <string[]> # Lista de servicios a actualizar
    allowed_workflows: <string[]> # Nombres de workflow permitidos
    allowed_branches: <string[]> # Ramas o refs permitidos
    allowed_tag_pattern: <string> # Regex que debe cumplir el tag
    healthcheck:
      enabled: <boolean>
      url: <string> # URL HTTP a interrogar (debe devolver 2xx)
      timeout_ms?: <number> # Override del timeout global
      interval_ms?: <number> # Override del intervalo global
    timeouts?: # Overrides opcionales de los defaults del servidor
      pull_timeout_ms: <number>
      up_timeout_ms: <number>
      retry_attempts: <number>
      retry_backoff_ms: <number>
    notifications?: # Override de destinatarios del servidor
      telegram?:
        chat_ids: <string[]>
      email?:
        recipients: <string[]>
```

---

## Variables de entorno del servicio

| Variable                     | Requerida                | Descripcion                                               |
| ---------------------------- | ------------------------ | --------------------------------------------------------- |
| `NODE_ENV`                   | No                       | `production` o `development`                              |
| `CONFIG_PATH`                | No                       | Ruta a `server.yml` (default: `./config/server.yml`)      |
| `REPOS_CONFIG_PATH`          | No                       | Glob a configs de repos (default: `./config/repos/*.yml`) |
| `REDIS_URL`                  | Si                       | URL de conexion a Redis. Ej: `redis://localhost:6379`     |
| `STATE_DIR`                  | No                       | Directorio para estado en disco (default: `./data/state`) |
| `DEPLOY_ADMIN_READ_TOKEN`    | Si                       | Token admin de solo lectura                               |
| `DEPLOY_ADMIN_WRITE_TOKEN`   | Si                       | Token admin de escritura                                  |
| Por cada repo: bearer y HMAC | Si                       | Definidos en la config del repo                           |
| `DEPLOY_TELEGRAM_BOT_TOKEN`  | Si (si telegram enabled) | Token del bot de Telegram                                 |
| `DEPLOY_RESEND_API_KEY`      | Si (si email enabled)    | API key de Resend                                         |

---

## Consideraciones de seguridad

### Docker socket

Montar `/var/run/docker.sock` en el contenedor da acceso completo al Docker del host. Esto es equivalente a acceso root en la maquina. Por tanto:

- El servicio debe ser la unica app con acceso al socket.
- El contenedor no debe exponer puertos innecesarios.
- Las imagenes base deben ser minimas y actualizadas.

### Construccion de comandos

- Usar siempre `execFile(binary, [arg1, arg2, ...])` o `spawn`.
- Nunca `exec('docker compose ' + variable)`.
- Los argumentos como `compose_file`, `services`, `runtime_env_file` vienen de la config local, no del payload.

### Exposicion publica

- El servicio debe estar detras de un reverse proxy con TLS (Nginx, Traefik, Caddy).
- El proxy debe forzar HTTPS.
- Considerar restriccion de IPs de GitHub Actions como capa extra.

### Rotacion de secretos

- Cada repo tiene su propio `Bearer` y `HMAC`. Rotar uno no afecta a los demas.
- Para rotar un secreto: actualizar la variable de entorno y reiniciar el servicio.

---

## Criterios de MVP completado

- [ ] Servicio arranca y falla correctamente si la config esta mal.
- [ ] Webhook rechaza peticiones invalidas (auth, firma, replay, validaciones).
- [ ] Cola persiste en Redis y ejecuta jobs en serie.
- [ ] Deduplicacion y sustitucion de pendientes funciona correctamente.
- [ ] Motor ejecuta pull, up -d, healthcheck y rollback.
- [ ] Estado de rollback persiste en disco.
- [ ] Endpoints admin con autenticacion diferenciada.
- [ ] Deploy manual y retry funcionan con restricciones.
- [ ] Notificaciones Telegram y Resend opcionales.
- [ ] Rate limiting activo en webhook y admin.
- [ ] Tests cubren rutas criticas de auth, cola y deploy.
- [ ] Existe ejemplo de workflow de GitHub Actions.
- [ ] Existe guia de integracion de un repo nuevo.
