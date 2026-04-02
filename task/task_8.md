# Task 8 - Empaquetado, ejemplos, tests de integracion y verificacion final

Nota: esta task cubre el cierre operativo de la v1. La v2 sustituira el alta manual de repos y las escrituras admin remotas por un canal local `CLI/TUI`; ver `task/task_9.md` a `task/task_12.md`.

## Objetivo

Dejar el proyecto en condiciones de ser usado en produccion: ejemplo de workflow de GitHub Actions, guia de integracion de un repo nuevo, tests que cubren las rutas criticas del MVP, verificacion del build y documentacion operativa de arranque y operacion.

---

## Dependencias previas

- Tasks 1-7 completadas: el servicio esta completamente implementado y funcionando.

---

## Quehaceres

### 8.1 Ejemplo de workflow de GitHub Actions

Crear `.github/workflows/deploy.example.yml`:

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    outputs:
      image_tag: ${{ steps.meta.outputs.version }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Generate image tag
        id: meta
        run: echo "version=sha-$(echo ${{ github.sha }} | cut -c1-7)" >> $GITHUB_OUTPUT

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ steps.meta.outputs.version }}
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    if: success()

    steps:
      - name: Prepare webhook payload
        id: payload
        run: |
          PAYLOAD=$(jq -n \
            --arg repo "${{ github.repository }}" \
            --arg env "production" \
            --arg tag "${{ needs.build-and-push.outputs.image_tag }}" \
            --arg sha "${{ github.sha }}" \
            --arg workflow "${{ github.workflow }}" \
            --arg ref "${{ github.ref_name }}" \
            --argjson run_id "${{ github.run_id }}" \
            '{repository: $repo, environment: $env, tag: $tag, sha: $sha, workflow: $workflow, ref_name: $ref, run_id: $run_id}')
          echo "payload=$PAYLOAD" >> $GITHUB_OUTPUT

      - name: Calculate HMAC signature
        id: signature
        run: |
          TIMESTAMP=$(date +%s)
          PAYLOAD='${{ steps.payload.outputs.payload }}'
          MESSAGE="${TIMESTAMP}.${PAYLOAD}"
          SIGNATURE="sha256=$(echo -n "$MESSAGE" | openssl dgst -sha256 -hmac "${{ secrets.DEPLOY_HMAC_SECRET }}" | awk '{print $2}')"
          echo "timestamp=$TIMESTAMP" >> $GITHUB_OUTPUT
          echo "signature=$SIGNATURE" >> $GITHUB_OUTPUT

      - name: Call deploy webhook
        run: |
          curl --fail --silent --show-error \
            --request POST \
            --url "${{ secrets.DEPLOY_WEBHOOK_URL }}/deploy" \
            --header "Content-Type: application/json" \
            --header "Authorization: Bearer ${{ secrets.DEPLOY_BEARER_TOKEN }}" \
            --header "X-Deploy-Timestamp: ${{ steps.signature.outputs.timestamp }}" \
            --header "X-Deploy-Signature: ${{ steps.signature.outputs.signature }}" \
            --data '${{ steps.payload.outputs.payload }}'
```

**Secrets que hay que configurar en GitHub:**

- `DEPLOY_WEBHOOK_URL`: URL del servidor, ej `https://deploy.mi-dominio.com`.
- `DEPLOY_BEARER_TOKEN`: valor del Bearer token del repo en este servidor.
- `DEPLOY_HMAC_SECRET`: valor del HMAC secret del repo en este servidor.

### 8.2 Ejemplo de `docker-compose.yml` para un proyecto desplegado

Crear `docs/examples/target-stack.example.yml`:

```yaml
# Ejemplo de docker-compose.yml para un proyecto gestionado por docker-deploy-webhook
# Este archivo vive en el servidor, no en este repositorio.
#
# El archivo runtime_env_file (.deploy.env) se actualiza automaticamente
# antes de cada docker compose up -d con IMAGE_NAME e IMAGE_TAG.

services:
  api:
    image: ${IMAGE_NAME}:${IMAGE_TAG}
    container_name: mi-app-api
    restart: unless-stopped
    ports:
      - '3000:3000'
    env_file:
      - .env
      - .deploy.env # <-- IMAGE_NAME e IMAGE_TAG vienen de aqui
    healthcheck:
      test: ['CMD', 'wget', '-q', '--spider', 'http://localhost:3000/health']
      interval: 10s
      timeout: 5s
      retries: 3

  worker:
    image: ${IMAGE_NAME}:${IMAGE_TAG}
    container_name: mi-app-worker
    restart: unless-stopped
    command: ['node', 'dist/worker.js']
    env_file:
      - .env
      - .deploy.env
```

### 8.3 Guia de integracion de un repo nuevo

Crear `docs/how-to-add-repo.md`:

```markdown
# Como integrar un repositorio nuevo

## 1. En el servidor

### 1.1 Preparar el stack Docker Compose

- Asegurar que `docker-compose.yml` usa `${IMAGE_NAME}:${IMAGE_TAG}`.
- Crear el directorio del stack: `/opt/stacks/<nombre>/`.
- El archivo `.deploy.env` no necesita existir; se crea automaticamente.

### 1.2 Autenticar Docker contra GHCR

docker login ghcr.io -u <usuario> -p <personal_access_token>

### 1.3 Crear config del repo

Copiar `config/repos/example.repo.yml` a `config/repos/<nombre>.yml` y rellenar:

- `repository`: owner/repo del repositorio en GitHub.
- `webhook.bearer_token_env`: nombre de la env var con el Bearer.
- `webhook.hmac_secret_env`: nombre de la env var con el HMAC.
- `environments.production.image_name`: imagen GHCR sin tag.
- `environments.production.compose_file`: ruta absoluta al docker-compose.yml.
- `environments.production.runtime_env_file`: ruta absoluta al .deploy.env.
- `environments.production.services`: lista de servicios a actualizar.
- `environments.production.allowed_workflows`: nombre del workflow de deploy.
- `environments.production.allowed_branches`: ramas permitidas.
- `environments.production.allowed_tag_pattern`: regex del patron de tag.

### 1.4 Generar secretos

Generar Bearer y HMAC de forma segura:
openssl rand -hex 32 # para el Bearer
openssl rand -hex 32 # para el HMAC

### 1.5 Añadir variables al .env del servicio

NOMBRE_REPO_WEBHOOK_BEARER=<valor>
NOMBRE_REPO_WEBHOOK_HMAC=<valor>

### 1.6 Reiniciar el servicio

docker compose restart webhook

## 2. En GitHub

### 2.1 Añadir secrets al repositorio

- DEPLOY_WEBHOOK_URL: https://deploy.mi-dominio.com
- DEPLOY_BEARER_TOKEN: <valor del Bearer>
- DEPLOY_HMAC_SECRET: <valor del HMAC>

### 2.2 Añadir el workflow de deploy

Copiar el ejemplo de `.github/workflows/deploy.example.yml` al repo de la aplicacion.

## 3. Verificar

- Hacer push a main.
- Comprobar que el workflow de GitHub Actions termina bien.
- Consultar el estado del job:
  curl https://deploy.mi-dominio.com/deployments/recent \
   -H "Authorization: Bearer <admin_read_token>"
```

### 8.4 Runbook operativo

Crear `docs/runbook.md`:

```markdown
# Runbook operativo

## Arrancar el servicio

docker compose up -d

## Ver logs en tiempo real

docker compose logs -f webhook

## Consultar estado del servicio

curl https://deploy.mi-dominio.com/health

## Ver despliegues recientes

curl https://deploy.mi-dominio.com/deployments/recent \
 -H "Authorization: Bearer <admin_read_token>"

## Ver estado de un job concreto

curl https://deploy.mi-dominio.com/jobs/<job_id> \
 -H "Authorization: Bearer <admin_read_token>"

## Reintentar un job fallido

curl -X POST https://deploy.mi-dominio.com/admin/jobs/<job_id>/retry \
 -H "Authorization: Bearer <admin_write_token>"

## Hacer un deploy manual

curl -X POST https://deploy.mi-dominio.com/admin/deploy \
 -H "Authorization: Bearer <admin_write_token>" \
 -H "Content-Type: application/json" \
 -d '{"repository":"owner/repo","environment":"production","tag":"sha-abc1234"}'

## Redeployar la ultima version exitosa

curl -X POST https://deploy.mi-dominio.com/admin/deploy/redeploy-last-successful \
 -H "Authorization: Bearer <admin_write_token>" \
 -H "Content-Type: application/json" \
 -d '{"repository":"owner/repo","environment":"production"}'

## Añadir un repo nuevo

Ver docs/how-to-add-repo.md

## Rotar secretos de un repo

1. Generar nuevos valores con openssl rand -hex 32.
2. Actualizar .env del servicio.
3. Actualizar secrets en GitHub.
4. docker compose restart webhook.

## El servicio no arranca

Revisar logs: docker compose logs webhook
Las causas mas comunes son:

- Env var de secreto faltante o vacia.
- compose_file no existe en disco.
- allowed_tag_pattern no es una regex valida.
- Redis no disponible.
```

### 8.5 Tests de integracion

Crear `src/__tests__/integration/deploy-flow.test.ts`:

Usar un Redis real (test container o instancia local) y mocks de `executor.ts`.

**Test 1: Flujo completo automatico exitoso**

1. Cargar config de test con un repo y entorno de prueba.
2. Llamar a `POST /deploy` con payload valido y headers correctos.
3. Verificar respuesta `202` con `job_id`.
4. Esperar a que el worker procese el job.
5. Consultar `GET /jobs/:id`.
6. Verificar estado `success`.
7. Verificar que `runtimeEnvFile` fue escrito con `IMAGE_NAME` e `IMAGE_TAG` correctos.

**Test 2: Deduplicacion en el flujo completo**

1. Llamar dos veces a `POST /deploy` con el mismo payload.
2. Ambas responden `202` con el mismo `job_id`.
3. El job se procesa una sola vez.

**Test 3: Sustitucion de pendiente**

1. Enviar job con tag `sha-aaa`.
2. Antes de que el worker lo procese, enviar job con tag `sha-bbb` (mismo repo+env).
3. Verificar que el job `sha-aaa` queda `cancelled`.
4. Verificar que solo se despliega `sha-bbb`.

**Test 4: Rollback en el flujo completo**

1. Desplegar `sha-aaa` exitosamente.
2. Desplegar `sha-bbb` con mock de executor que falla en el up.
3. Verificar que el job termina en `rolled_back`.
4. Verificar que `runtimeEnvFile` tiene `IMAGE_TAG=sha-aaa` al terminar.

**Test 5: Deploy manual desde admin**

1. Llamar a `POST /admin/deploy` con payload valido.
2. Verificar `202`.
3. Verificar que el job se procesa y termina en `success`.

### 8.6 Verificacion del build y arranque

Verificar que:

1. `npm run build` produce `dist/` sin errores.
2. `npm run lint` pasa sin errores.
3. `npm test` pasa todos los tests con cobertura > 70% en modulos criticos.
4. `docker compose build` construye la imagen sin errores.
5. `docker compose up` arranca el servicio y Redis.
6. `GET /health` responde `200 ok`.
7. El servicio falla con mensaje claro si se elimina una env var critica del `.env`.

### 8.7 Actualizar README con instrucciones de instalacion en produccion

Añadir seccion `## Instalacion en produccion` al README con:

1. Requisitos del sistema (Docker, Docker Compose v2, acceso a GHCR).
2. Pasos para levantar el servicio por primera vez.
3. Referencia a `docs/how-to-add-repo.md` para integrar repos.
4. Referencia a `docs/runbook.md` para operacion.

---

## Criterios de aceptacion

- [ ] El workflow de ejemplo esta documentado y funciona con los secrets indicados.
- [ ] `docs/how-to-add-repo.md` es una guia suficiente para integrar un repo sin leer codigo.
- [ ] `docs/runbook.md` cubre los escenarios operativos mas comunes.
- [ ] Los tests de integracion cubren el flujo completo: webhook -> cola -> despliegue -> estado.
- [ ] `npm run build` compila limpio.
- [ ] `npm test` pasa con cobertura acceptable en auth, config, cola y motor.
- [ ] `docker compose up` arranca y el servicio pasa el healthcheck.
- [ ] El README tiene una seccion de instalacion en produccion clara y completa.
