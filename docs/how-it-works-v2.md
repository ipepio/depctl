# Como Funciona La v2

## Resumen

La v2 divide el sistema en dos superficies:

- una superficie **remota** minima para recibir el webhook y consultar estado
- una superficie **local** para toda la administracion sensible

Esto permite que el servicio expuesto sea mas pequeno y predecible, mientras que la operacion del servidor sigue siendo potente desde la `CLI/TUI` local.

---

## Componentes

### 1. `webhook`

Es el modo expuesto del servicio.

Responsabilidades:

- recibir `POST /deploy`
- validar auth y firma
- resolver `repository + environment` contra config local
- encolar trabajos
- exponer lectura remota (`/health`, `/jobs/:id`, `/deployments/recent`)

No hace:

- altas de repos
- edicion de config
- deploy manual por HTTP
- retry por HTTP

### 2. `admin`

Es el modo local de administracion.

Responsabilidades:

- crear y editar `config/repos/*.yml`
- generar y mostrar secrets del repo
- escribir el `.env` del servicio
- validar configuracion antes del restart
- crear y editar stacks gestionados
- lanzar deploy manual, redeploy y retry de forma local
- ejecutar la `TUI`
- ayudar en migraciones desde la v1

No expone puertos.

---

## Flujo Automático

1. GitHub Actions construye y publica una imagen en `GHCR`.
2. GitHub Actions envia un `POST /deploy` al servidor.
3. El servicio valida:
   - `Authorization: Bearer <token>`
   - `X-Deploy-Timestamp`
   - `X-Deploy-Signature`
4. El servicio busca el repo en `config/repos/*.yml`.
5. Valida que el payload encaja con la config local:
   - repo existente
   - entorno existente
   - workflow permitido
   - branch permitida
   - tag valido
6. Encola el job en Redis.
7. El worker procesa el job en serie.
8. El motor de despliegue:
   - escribe `.deploy.env`
   - hace `docker compose pull`
   - hace `docker compose up -d`
   - ejecuta healthcheck opcional
   - guarda estado de rollback
9. Si falla despues de escribir el nuevo tag y existe un `previous_tag`, intenta rollback.

---

## Flujo Local De Admin

La operacion local se hace con comandos sobre el contenedor `admin`.

Ejemplo:

```bash
docker compose --profile admin run --rm admin repo add --repository acme/payments-api
```

La `CLI/TUI` opera directamente sobre:

- `config/repos/*.yml`
- `.env` del servicio
- `/opt/stacks/<owner>/<repo>`
- Redis, cuando hay que encolar jobs o leer estado

No hace llamadas HTTP a `localhost` para las acciones admin: usa la capa interna del proyecto.

---

## Configuracion Del Servicio

### `config/server.yml`

Contiene:

- puerto
- rate limiting
- tokens admin de lectura
- defaults de timeouts y reintentos
- notificaciones

### `config/repos/*.yml`

Cada repo define:

- `repository`
- nombres de env vars para `Bearer` y `HMAC`
- uno o varios entornos

Cada entorno define:

- `image_name`
- `compose_file`
- `runtime_env_file`
- `services`
- `allowed_workflows`
- `allowed_branches`
- `allowed_tag_pattern`
- healthcheck opcional

---

## Secrets Del Repo

Cada repo tiene dos secrets de webhook:

- `Bearer`
- `HMAC`

La CLI los genera y los guarda en el `.env` del servicio dentro de bloques gestionados.

Ejemplo conceptual:

```env
# BEGIN docker-deploy-webhook repo acme/payments-api
ACME_PAYMENTS_API_WEBHOOK_BEARER=...
ACME_PAYMENTS_API_WEBHOOK_HMAC=...
# END docker-deploy-webhook repo acme/payments-api
```

Luego se pueden revelar bajo demanda con:

```bash
docker compose --profile admin run --rm admin repo secrets show --repository acme/payments-api
```

---

## Stacks Gestionados

Cada stack vive bajo:

```text
/opt/stacks/<owner>/<repo>/
```

Archivos principales:

- `docker-compose.yml`
- `.env`
- `.deploy.env`

### `.env`

Contiene configuracion y secretos propios del stack, por ejemplo de `postgres` o `redis`.

### `.deploy.env`

Contiene solo:

- `IMAGE_NAME`
- `IMAGE_TAG`

El motor lo sobreescribe antes de cada despliegue.

### Metadata de stack gestionado

El compose generado por la herramienta incluye metadata `x-deploy-webhook`.

Esto permite:

- saber si el stack lo gestiona la herramienta
- editarlo incrementalmente desde `CLI/TUI`
- diferenciarlo de un compose manual externo

---

## Servicios Desplegables Y Auxiliares

La v2 separa dos tipos de servicios en un stack.

### Desplegables

Usan:

```text
${IMAGE_NAME}:${IMAGE_TAG}
```

Ejemplos:

- `app`
- `worker`

Estos servicios si entran en `environments.<env>.services` y son los que el motor actualiza.

### Auxiliares

No forman parte del artefacto versionado del repo.

Ejemplos:

- `postgres`
- `redis`
- `nginx`

Estos viven en el stack, pero no se meten en `services` del entorno de deploy.

---

## Validacion Antes Del Restart

La CLI ofrece:

```bash
docker compose --profile admin run --rm admin validate
```

Comprueba como minimo:

- schema de `server.yml`
- schema de `repos/*.yml`
- env vars requeridas
- existencia de `compose_file`
- existencia del directorio de `runtime_env_file`
- servicios declarados realmente presentes en el compose
- patrones de tag validos

Si `validate` falla, no deberias reiniciar `webhook`.

---

## Aplicacion De Cambios

La v2 sigue siendo `fail fast` y `reload by restart`.

Flujo:

1. editar o generar config con `admin`
2. ejecutar `validate`
3. reiniciar `webhook`

```bash
docker compose --profile admin run --rm admin validate
docker compose restart webhook
```

---

## TUI

La TUI es una interfaz local guiada que reutiliza la misma capa de aplicacion que la CLI.

Se ejecuta con:

```bash
docker compose --profile admin run --rm admin tui
```

Sirve para:

- listar repos
- crear repos y entornos
- generar y mostrar secrets
- validar
- lanzar deploy manual
- crear stacks y anadir servicios
- preparar migraciones

---

## Migracion Desde v1

La CLI incorpora comandos de ayuda:

```bash
docker compose --profile admin run --rm admin migrate scan
docker compose --profile admin run --rm admin migrate plan
docker compose --profile admin run --rm admin migrate apply
```

`apply` es conservador: automatiza solo acciones seguras, como renombrar ficheros de repo a su nombre canonico cuando no hay conflicto. El resto lo deja reportado para ejecucion manual.
