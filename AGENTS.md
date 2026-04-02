# AGENTS.md

Documento de referencia para cualquier agente o desarrollador que trabaje en este repositorio. Define el objetivo, las reglas no negociables, las convenciones de codigo, los contratos de datos y los criterios de aceptacion de cada implementacion.

---

## Objetivo del repositorio

`docker-deploy-webhook` es un servicio HTTP autonomo que se instala una vez por servidor. Recibe webhooks de GitHub Actions, valida la peticion y ejecuta despliegues Docker Compose locales de forma controlada y segura.

No es un orquestador. No controla otros servidores. No genera infraestructura remota. Solo opera sobre configuracion local del propio host.

### Objetivo v2 acordado

- La API remota queda limitada a `POST /deploy` y endpoints de lectura.
- Las operaciones admin de escritura salen de la API y pasan a una interfaz local `CLI/TUI`.
- La misma imagen del proyecto debe soportar dos modos: `webhook` expuesto y contenedor admin puntual sin puertos.
- Los stacks gestionados se estandarizan bajo `/opt/stacks/<owner>/<repo>`.
- La interfaz local puede generar o actualizar configuracion local del stack y del repo, pero nunca a partir de datos remotos no confiables.

---

## Principios obligatorios

Estas reglas no son negociables y aplican a toda implementacion presente y futura.

### Arquitectura

- Una instancia del servicio por servidor.
- Un servidor solo despliega sus propios stacks Docker Compose locales.
- La coordinacion multi-servidor la realiza GitHub Actions, no este servicio.

### Seguridad

- La configuracion local manda. El payload nunca decide rutas, compose files, servicios ni comandos.
- Los secretos no viven en YAML ni en el repositorio. Solo en variables de entorno.
- No se ejecuta ningun comando shell construido con datos del payload o de la config.
- Solo se ejecuta `docker compose` sobre `compose_file` y `services` conocidos y validados.
- Los despliegues automaticos solo entran por `POST /deploy` con `Bearer + HMAC + anti-replay`.
- Los despliegues manuales, redeploys y retries admin en v2 solo entran por interfaz local autenticada, no por API remota.

### Cola y concurrencia

- La cola es global por servidor. Se ejecuta un unico job a la vez.
- Para un mismo `repo + environment`, solo se conserva el ultimo job pendiente.
- Los duplicados del mismo `repo + environment + tag` se ignoran (salvo `force` admin).
- Los jobs en estado `running` interrumpidos por reinicio del servicio se marcan como fallidos y no se reintentan automaticamente.

### Configuracion y arranque

- Si la configuracion YAML es invalida, falta un secreto requerido o un `compose_file` no existe, el servicio no arranca. Fail fast.
- La configuracion solo se carga al arrancar. Para aplicar cambios hay que reiniciar el servicio.

### Rollback

- El rollback automatico es limitado. Solo se intenta si existe un `previous_tag` fiable guardado.
- Solo se hace rollback si el fallo ocurre despues de haber aplicado el nuevo tag.
- El estado de rollback (`successful_tag`, `previous_tag`) se persiste en disco y en Redis.

---

## Convenciones de codigo

### Lenguaje y runtime

- Node.js + TypeScript estricto (`strict: true`).
- Sin `any` implicito. Tipar todo lo que entre o salga del sistema.

### Estructura de directorios esperada

```text
src/
├── config/           # Carga, validacion y tipos de configuracion
├── api/              # Rutas HTTP, middlewares y controladores
├── cli/              # Interfaz local CLI/TUI para administracion v2
├── auth/             # Validacion Bearer, HMAC, anti-replay, tokens admin
├── queue/            # Integracion Redis, cola global, worker
├── deploy/           # Motor de despliegue, executor Docker, healthcheck, rollback
├── state/            # Persistencia en disco y Redis (historial, rollback state)
├── notifications/    # Telegram y Resend
├── logger/           # Logger estructurado
└── index.ts          # Arranque del servicio
```

### Nombrado

- Clases: `PascalCase`.
- Funciones, variables, propiedades: `camelCase`.
- Constantes globales: `UPPER_SNAKE_CASE`.
- Archivos: `kebab-case.ts`.
- Tests: `kebab-case.test.ts` junto al archivo que testean.

### Errores

- Usar clases de error propias para cada dominio: `ConfigError`, `AuthError`, `DeployError`, etc.
- No capturar errores y silenciarlos. Loguear siempre con contexto suficiente.
- Los errores en el arranque deben terminar el proceso con codigo de salida no cero.

### Logger

- Logger estructurado (JSON en produccion, formato legible en desarrollo).
- Cada log debe incluir: `level`, `timestamp`, `message` y contexto relevante (`repo`, `environment`, `job_id`, `tag`).
- No usar `console.log` fuera del logger.

---

## Convenciones de configuracion

### Archivos

- Config base del servidor: `config/server.yml`
- Config por repositorio: `config/repos/<nombre>.yml`
- Root de stacks gestionados: `/opt/stacks/<owner>/<repo>`

### Identificador de repositorio

- Siempre en formato `owner/repo`. Ejemplo: `acme/clash-hub-api`.

### Variables de compose estandar

- `IMAGE_NAME`: imagen Docker completa sin tag. Ejemplo: `ghcr.io/acme/clash-hub-api`.
- `IMAGE_TAG`: tag inmutable del despliegue. Ejemplo: `sha-abc1234`.
- El archivo `runtime_env_file` del target recibira estas dos variables antes de cada despliegue.

### Secretos

- Nunca en YAML. El YAML solo referencia el nombre de la variable de entorno.
- El servicio lee el valor de esa variable en tiempo de arranque.
- Si la variable no existe o esta vacia, el servicio no arranca.

### Host Docker

- El host ya debe estar autenticado contra GHCR. El servicio no gestiona `docker login`.
- El socket Docker del host se monta en el contenedor del servicio: `/var/run/docker.sock`.
- El servicio `webhook` y el contenedor admin deben poder ver el root de stacks configurado.

---

## Contrato del webhook automatico

### Headers requeridos

```
Authorization: Bearer <bearer_token_del_repo>
X-Deploy-Timestamp: <unix-seconds>
X-Deploy-Signature: sha256=<hex>
Content-Type: application/json
```

### Body

```json
{
  "repository": "owner/repo",
  "environment": "production",
  "tag": "sha-abc1234",
  "sha": "abc1234567890abcdef",
  "workflow": "deploy-production",
  "ref_name": "main",
  "run_id": 123456789
}
```

### Calculo de la firma

```
raw_body = string JSON sin modificar tal como llega en el body HTTP
signature = HMAC_SHA256(hmac_secret_del_repo, timestamp + "." + raw_body)
header = "sha256=" + hex(signature)
```

### Ventana anti-replay

- El `X-Deploy-Timestamp` debe estar dentro de `replay_window_seconds` respecto al momento de recepcion.
- Por defecto: `300` segundos (5 minutos).
- Peticiones con timestamp fuera de la ventana se rechazan con `401`.

### Respuesta esperada

```json
{ "status": "accepted", "job_id": "<uuid>" }
```

HTTP `202 Accepted`.

---

## Contrato de administracion local v2

### Principios

- No se exponen endpoints HTTP remotos de escritura para operaciones admin.
- La administracion local se ejecuta en un contenedor admin puntual, sin puertos publicados.
- Los cambios de configuracion se aplican tras reiniciar el servicio.

### Capacidades esperadas de la interfaz local

- Alta y edicion de repositorios y entornos.
- Generacion de secrets `Bearer` y `HMAC` por repo y almacenamiento local.
- Visualizacion bajo demanda de esos secrets para copiarlos a GitHub Secrets.
- Validacion local de config, rutas, `compose_file`, `runtime_env_file` y servicios.
- Deploy manual, redeploy del ultimo exitoso y retry de jobs fallidos via CLI/TUI local.
- Wizard de stack con catalogo de servicios soportados.

### Contrato de los archivos del stack

- `docker-compose.yml`: definicion del stack local.
- `.env`: configuracion y secretos propios del stack generados o mantenidos localmente.
- `.deploy.env`: solo `IMAGE_NAME` e `IMAGE_TAG`, gestionados por el motor de despliegue.

---

## Estados de un job

```
pending -> running -> success
                   -> failed -> (rollback si procede)
                   -> rolled_back
                   -> rollback_failed
```

- `pending`: en cola, esperando turno.
- `running`: siendo procesado por el worker.
- `success`: desplegado correctamente.
- `failed`: error en alguno de los pasos.
- `rolled_back`: el despliegue fallo y el rollback fue exitoso.
- `rollback_failed`: el despliegue fallo y el rollback tambien fallo.

---

## Pasos del motor de despliegue

Para un job en estado `running`, el worker ejecuta en orden:

1. Leer la config del target (`compose_file`, `runtime_env_file`, `services`).
2. Guardar el `current_tag` como `previous_tag` en disco y Redis.
3. Escribir `IMAGE_NAME` e `IMAGE_TAG` en `runtime_env_file`.
4. Ejecutar `docker compose -f <compose_file> --env-file <runtime_env_file> pull <services>`.
5. Ejecutar `docker compose -f <compose_file> --env-file <runtime_env_file> up -d <services>`.
6. Si hay healthcheck configurado, esperar e interrogar la URL hasta timeout.
7. Si todos los pasos pasan: guardar `successful_tag`, marcar job `success`, notificar.
8. Si algun paso falla despues del paso 3 y existe `previous_tag`: intentar rollback.
   - Rollback: volver a escribir `previous_tag` en `runtime_env_file` y repetir pasos 4 y 5.
   - Si el rollback pasa: marcar job `rolled_back`, notificar.
   - Si el rollback falla: marcar job `rollback_failed`, notificar con urgencia.
9. Si el fallo ocurre antes del paso 3: marcar job `failed`, notificar.

---

## Reintentos y timeouts

- Solo se reintenta si el fallo es transitorio (`pull` falla por red, timeout de red, etc.).
- No se reintenta si el error es de configuracion, compose invalido o imagen inexistente.
- Valores por defecto (override posible por repo/environment):
  - `pull_timeout_ms`: 300000 (5 min)
  - `up_timeout_ms`: 300000 (5 min)
  - `healthcheck_timeout_ms`: 60000 (1 min)
  - `healthcheck_interval_ms`: 5000 (5 seg entre intentos)
  - `retry_attempts`: 2
  - `retry_backoff_ms`: 5000

---

## Restricciones de implementacion

- Nunca interpolar datos del payload en strings de comandos shell.
- Nunca usar `exec` ni `execSync` con strings construidos desde datos externos.
- Siempre usar `execFile` o `spawnSync` con argumentos como array separado.
- Validar siempre `repository`, `environment`, `workflow`, `ref_name` y `tag` contra la config antes de crear el job.
- No exponer informacion interna (rutas, configs, secretos) en respuestas HTTP de error.
- No dejar puertos de debug o herramientas de administracion expuestos en produccion.
- No mezclar permisos de escritura del contenedor admin con el contenedor `webhook` expuesto salvo necesidad explicita y documentada.

---

## Definicion de hecho

Una implementacion se considera completa cuando:

- Carga y valida toda la configuracion y secretos al arrancar. Falla si algo esta mal.
- Rechaza peticiones no autenticadas, mal firmadas o fuera de ventana temporal.
- Encola trabajos en Redis y ejecuta un unico worker por servidor.
- Ejecuta `pull`, `up -d`, checks opcionales y rollback limitado segun corresponda.
- Guarda historial corto consultable en Redis y estado de rollback en disco.
- Expone solo webhook automatico y endpoints remotos de lectura.
- La administracion local de escritura vive en CLI/TUI y respeta las restricciones del target.
- Notifica exito y fallo cuando Telegram o Resend estan configurados.
- Hay tests que cubren config, auth, cola, deduplicacion y motor de despliegue.
- La documentacion queda actualizada si cambia el comportamiento.
